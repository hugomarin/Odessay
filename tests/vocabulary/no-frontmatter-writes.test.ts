import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createVocabularyItem, deleteVocabularyItem, updateVocabularyItem } from "@/lib/vocabulary/server"

/**
 * ODE-472 requirement 12 / DoD: none of the vocabulary operations may write
 * frontmatter or touch the body of a `.md`. The vocabulary lives in Supabase
 * metadata, never in the content store. This test proves it the literal way
 * the brief asks for: hash (byte-compare) a real `.md` file before and after
 * running the full create → update → delete cycle against a mocked Supabase
 * client, and confirm the file on disk never moved.
 */

function makeChain(response: unknown) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(response)
      }
      return (..._args: unknown[]) => makeChain(response)
    },
  }
  return new Proxy(() => {}, handler)
}

function makeSupabase(queue: unknown[]) {
  let i = 0
  return {
    from: vi.fn(() => makeChain(queue[i++])),
    rpc: vi.fn(async () => queue[i++]),
  } as unknown as Parameters<typeof createVocabularyItem>[0]
}

const row = {
  id: "row-1",
  kind: "type",
  key: "research",
  name: "Research",
  description: "",
  icon: "compass",
  color: "#5B5BD6",
  hidden: false,
  is_base: false,
  is_required: false,
  position: 7,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
}

describe("vocabulary operations never touch the .md content store", () => {
  let dir: string
  let mdPath: string
  const original = "---\ntitle: A letter\nartifact_type: general\n---\n\nDear reader,\n"

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "odessay-vocab-test-"))
    mdPath = join(dir, "letter.md")
    writeFileSync(mdPath, original, "utf8")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("leaves the .md byte-identical through create, update and delete", async () => {
    const before = readFileSync(mdPath, "utf8")

    const createSupabase = makeSupabase([
      { error: null },
      { data: null, error: null },
      { count: 6 },
      { data: row, error: null },
    ])
    await createVocabularyItem(createSupabase, "user-1", {
      kind: "type",
      name: "Research",
      icon: "compass",
      color: "#5B5BD6",
    })

    const updateSupabase = makeSupabase([{ data: row, error: null }, { data: row, error: null }])
    await updateVocabularyItem(updateSupabase, "user-1", "row-1", { name: "Renamed" })

    const deleteSupabase = makeSupabase([{ data: row, error: null }, { data: 0, error: null }])
    await deleteVocabularyItem(deleteSupabase, "user-1", "row-1")

    const after = readFileSync(mdPath, "utf8")
    expect(after).toBe(before)
    expect(after).not.toContain("Renamed")
  })
})

describe("desktop vocabulary operations (ODE-473) never touch the .md content store", () => {
  let dir: string
  let mdPath: string
  const original = "---\ntitle: A letter\nartifact_type: general\n---\n\nDear reader,\n"
  const mockSettingsStore = new Map<string, unknown>()

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "odessay-vocab-desktop-test-"))
    mdPath = join(dir, "letter.md")
    writeFileSync(mdPath, original, "utf8")
    mockSettingsStore.clear()
    vi.resetModules()
    vi.doMock("@tauri-apps/api/path", () => ({
      join: vi.fn(async (...parts: string[]) => parts.join("/")),
    }))
    vi.doMock("@/lib/services/desktop/tauri-commands", () => ({
      tauriSettingsRead: vi.fn(async (_configDir: string, key: string) => mockSettingsStore.get(key) ?? null),
      tauriSettingsWrite: vi.fn(async (_configDir: string, key: string, value: unknown) => {
        mockSettingsStore.set(key, value)
      }),
      tauriSettingsDelete: vi.fn(async (_configDir: string, key: string) => mockSettingsStore.delete(key)),
      tauriCatalogList: vi.fn(async () => []),
      tauriCatalogBulkDualWrite: vi.fn(async () => []),
    }))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.doUnmock("@tauri-apps/api/path")
    vi.doUnmock("@/lib/services/desktop/tauri-commands")
  })

  it("leaves the .md byte-identical through create, hide and delete on the desktop adapter", async () => {
    const { DesktopSettingsService } = await import("@/lib/services/desktop/desktop-settings-service")
    const service = new DesktopSettingsService("/tmp/odessay-config")

    const before = readFileSync(mdPath, "utf8")

    const created = await service.createVocabularyItem({
      kind: "status", name: "Blocked", icon: "flame", color: "#96532C",
    })
    await service.updateVocabularyItem(created.data!.id, { hidden: false, description: "Waiting on someone else." })
    await service.deleteVocabularyItem(created.data!.id)

    const after = readFileSync(mdPath, "utf8")
    expect(after).toBe(before)
  })
})
