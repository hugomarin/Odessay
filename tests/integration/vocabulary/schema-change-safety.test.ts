import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  configureRealDesktopDoubles,
  failNextBulkDualWrite,
  resetCatalogDoubles,
  resetSettingsStoreDouble,
  tauriCatalogBulkDualWriteDouble,
  tauriCatalogDualWriteDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListDouble,
  tauriPathModuleDouble,
  tauriSettingsDeleteDouble,
  tauriSettingsReadDouble,
  tauriSettingsWriteDouble,
} from "../documents/support/real-desktop-doubles"

vi.mock("@tauri-apps/api/path", () => tauriPathModuleDouble)

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriCatalogList: tauriCatalogListDouble,
  tauriCatalogBulkDualWrite: tauriCatalogBulkDualWriteDouble,
  tauriSettingsRead: tauriSettingsReadDouble,
  tauriSettingsWrite: tauriSettingsWriteDouble,
  tauriSettingsDelete: tauriSettingsDeleteDouble,
}))

const { DesktopSettingsService } = await import("@/lib/services/desktop/desktop-settings-service")

let workspaceRoot: string
let configDir: string

beforeAll(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "odessay-config07-"))
  configureRealDesktopDoubles(workspaceRoot)
  configDir = join(workspaceRoot, "config")
})

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

afterEach(() => {
  resetCatalogDoubles()
  resetSettingsStoreDouble()
})

async function seedCatalogRow(id: string, status: string) {
  await tauriCatalogDualWriteDouble(await dbPath(), {
    document: {
      id, localPresent: true, cloudPresent: false, cloudAccountId: null, syncStatus: "local-only",
      title: `Doc ${id}`, slug: null, status, artifactType: "general", visibility: "private",
      version: 1, deletedAt: null, createdAt: Date.now(), modifiedAt: Date.now(),
    },
    binding: null,
    mutation: null,
  })
}

async function dbPath(): Promise<string> {
  const { appConfigDir, join: joinAsync } = tauriPathModuleDouble
  return joinAsync(await appConfigDir(), "desktop-index.sqlite3")
}

/**
 * CONFIG-07 (desktop half) — Existing documents survive schema change
 *
 * Property: deleting a custom vocabulary item must rewrite every catalog
 * row that carried its key to the base value, in the same operation, and
 * must not touch rows with a different status. A failed rewrite must not
 * leave a corrupted mix — the vocabulary item stays defined and the catalog
 * stays at its old (valid) values, never a half-applied state.
 *
 * Real collaborators: `DesktopSettingsService` (real, unmodified) driving
 * a real (behavioral, not spy-based) in-memory catalog double and a real
 * in-memory settings-store double. Allowed fakes/simplifications: same
 * native-Tauri-transport boundary as the document-lifecycle proofs (see
 * support/real-desktop-doubles.ts) — this is application-side integration
 * with that boundary replaced by a real test double, not RUNTIME evidence
 * against the actual Rust/SQLite engine. See
 * supabase/tests/delete_vocabulary_item_rewrite.test.sql for the other real
 * engine this scenario's chain touches (the cloud/Postgres side).
 */
describe("CONFIG-07 — existing documents survive a status deletion (desktop)", () => {
  it("rewrites every matching catalog row to the base status and leaves others untouched", async () => {
    const settings = new DesktopSettingsService(configDir)

    const created = await settings.createVocabularyItem({
      kind: "status",
      name: "In review",
      icon: "eye",
      color: "#5B5BD6",
    })
    expect(created.error).toBeNull()
    const item = created.data!

    await seedCatalogRow("doc-a", item.key)
    await seedCatalogRow("doc-b", item.key)
    await seedCatalogRow("doc-c", "exploring")

    const result = await settings.deleteVocabularyItem(item.id)

    expect(result.error).toBeNull()
    expect(result.data!.rewrittenCount).toBe(2)

    const rowA = await tauriCatalogGetByIdDouble(await dbPath(), "doc-a")
    const rowB = await tauriCatalogGetByIdDouble(await dbPath(), "doc-b")
    const rowC = await tauriCatalogGetByIdDouble(await dbPath(), "doc-c")
    expect(rowA?.status).toBe("draft")
    expect(rowB?.status).toBe("draft")
    expect(rowC?.status).toBe("exploring")

    const remaining = await settings.listVocabulary()
    expect(remaining.data!.some((i) => i.id === item.id)).toBe(false)
  })

  it("FAILURE — a failed rewrite leaves the item defined and the catalog at its prior values, not a partial mix", async () => {
    const settings = new DesktopSettingsService(configDir)

    const created = await settings.createVocabularyItem({
      kind: "status",
      name: "Needs edit",
      icon: "eye",
      color: "#2E7D4F",
    })
    const item = created.data!

    await seedCatalogRow("doc-x", item.key)

    failNextBulkDualWrite(() => {
      throw new Error("simulated SQLite transaction failure")
    })

    const result = await settings.deleteVocabularyItem(item.id)

    expect(result.error).not.toBeNull()

    // Catalog untouched — the rewrite never committed.
    const row = await tauriCatalogGetByIdDouble(await dbPath(), "doc-x")
    expect(row?.status).toBe(item.key)

    // Item definition still exists — deleteVocabularyItem only removes it
    // from the store after the rewrite succeeds.
    const remaining = await settings.listVocabulary()
    expect(remaining.data!.some((i) => i.id === item.id)).toBe(true)
  })

  it("deleting a status nobody uses rewrites nothing and still removes the item", async () => {
    const settings = new DesktopSettingsService(configDir)
    const created = await settings.createVocabularyItem({
      kind: "status",
      name: "Unused",
      icon: "eye",
      color: "#8E837B",
    })
    const item = created.data!

    const result = await settings.deleteVocabularyItem(item.id)

    expect(result.error).toBeNull()
    expect(result.data!.rewrittenCount).toBe(0)
    const remaining = await settings.listVocabulary()
    expect(remaining.data!.some((i) => i.id === item.id)).toBe(false)
  })
})
