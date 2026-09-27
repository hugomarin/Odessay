/** @vitest-environment happy-dom */
import { mkdtempSync, rmSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  configureRealDesktopDoubles,
  resetCatalogDoubles,
  resetWriteFileFailureState,
  tauriCatalogApplyCloudSnapshotsDouble,
  tauriCatalogDetachLocalFileDouble,
  tauriCatalogDualWriteDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListDouble,
  tauriCatalogResolvePathDouble,
  tauriCreateFileDouble,
  tauriListRecentFilesDouble,
  tauriOpenFileDouble,
  tauriPathModuleDouble,
  tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFileDouble,
  tauriWriteFileDouble,
} from "./integration/documents/support/real-desktop-doubles"

function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(`WATCH-07 regression: unexpected Tauri command ${name}`)
  })
}

vi.mock("@tauri-apps/api/path", () => tauriPathModuleDouble)

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriCreateFile: tauriCreateFileDouble,
  tauriWriteFile: tauriWriteFileDouble,
  tauriOpenFile: tauriOpenFileDouble,
  tauriListRecentFiles: tauriListRecentFilesDouble,
  tauriRenameFile: unimplemented("tauriRenameFile"),
  tauriRelocateFile: unimplemented("tauriRelocateFile"),
  tauriWorkspaceSync: tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFile: tauriWorkspaceTouchFileDouble,
  tauriCatalogDualWrite: tauriCatalogDualWriteDouble,
  tauriCatalogBulkDualWrite: unimplemented("tauriCatalogBulkDualWrite"),
  tauriCatalogGetById: tauriCatalogGetByIdDouble,
  tauriCatalogResolvePath: tauriCatalogResolvePathDouble,
  tauriCatalogList: tauriCatalogListDouble,
  tauriCatalogDetachLocalFile: tauriCatalogDetachLocalFileDouble,
  tauriCatalogHydrateExcerpts: vi.fn(async () => []),
  tauriCatalogApplyReconcile: unimplemented("tauriCatalogApplyReconcile"),
  tauriCatalogApplyCloudSnapshots: tauriCatalogApplyCloudSnapshotsDouble,
  tauriCatalogApplyWorkspaceRemoval: unimplemented("tauriCatalogApplyWorkspaceRemoval"),
  tauriCatalogActivateBindingRoot: unimplemented("tauriCatalogActivateBindingRoot"),
  tauriCatalogCountBindingRootDocuments: unimplemented("tauriCatalogCountBindingRootDocuments"),
  tauriCatalogListBindingRootDocuments: unimplemented("tauriCatalogListBindingRootDocuments"),
  tauriCatalogListRetiredBindingRoots: unimplemented("tauriCatalogListRetiredBindingRoots"),
  tauriCatalogReactivateBindingRoot: unimplemented("tauriCatalogReactivateBindingRoot"),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))

vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { createDesktopDraft, getDocumentService } = await import("@/lib/services/document-service-factory")
const { computeMarkdownContentHash } = await import("@/lib/content-hash")
const { createPersistenceCoordinator } = await import("@/lib/editor/persistence-coordinator")
const { computeHasPendingLocalEdit, resolveExternalContentChange } = await import(
  "@/lib/editor/external-change-policy"
)

const bodyJson = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

let workspaceRoot: string

beforeAll(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "odessay-watch07-failed-save-"))
  configureRealDesktopDoubles(workspaceRoot)
})

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

afterEach(() => {
  resetCatalogDoubles()
  resetWriteFileFailureState()
  rmSync(join(workspaceRoot, "data"), { recursive: true, force: true })
  rmSync(join(workspaceRoot, "config"), { recursive: true, force: true })
})

async function desktopDbPath(): Promise<string> {
  const { appConfigDir, join: joinAsync } = tauriPathModuleDouble
  return joinAsync(await appConfigDir(), "desktop-index.sqlite3")
}

describe("WATCH-07 — external change after a rejected autosave", () => {
  it("keeps the local edit dirty after a real CONFLICT has settled and a bulk change arrives", async () => {
    const draft = await createDesktopDraft({ title: "External edit race", initialBodyJson: bodyJson("disk v1") })
    const record = draft.data!
    const service = await getDocumentService()
    const catalogRow = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
    const canonicalPath = catalogRow!.canonicalPath!
    const initialDiskContent = await readFile(canonicalPath, "utf8")
    const baselineContentHash = await computeMarkdownContentHash(initialDiskContent)
    const externalContent = "# External Edit\n\nThe disk version wins until the user chooses.\n"
    const externalContentHash = await computeMarkdownContentHash(externalContent)
    const errors: string[] = []

    const coordinator = createPersistenceCoordinator(
      {
        runtime: "desktop",
        persistenceDebounceMs: 0,
        documentService: service,
        createWritingId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      },
      { onError: ({ error }) => error && errors.push(error.code) },
    )
    const target = { writingId: record.id }
    coordinator.setDurableContentHash(record.id, baselineContentHash)

    // External editor writes after the shell seeded H1 but before autosave.
    await writeFile(canonicalPath, externalContent, "utf8")
    await expect(
      coordinator.persist({
        writingId: record.id,
        createdAt: record.createdAt,
        version: record.version,
        title: record.title ?? "Untitled",
        bodyJson: bodyJson("local text the author just typed"),
        bodyText: "local text the author just typed",
        status: "draft",
        artifactType: "general",
        visibility: "private",
        lifecycle: "local-only",
      }),
    ).resolves.toBe(false)

    expect(errors).toContain("CONFLICT")
    expect(await readFile(canonicalPath, "utf8")).toBe(externalContent)
    expect(coordinator.hasPending(target)).toBe(false)

    // This is the shell's production decision after its pre-handoff ref was
    // cleared: the coordinator must still report the failed local content.
    expect(coordinator.hasUnconfirmedContent(target)).toBe(true)
    const hasPendingLocalEdit = computeHasPendingLocalEdit({
      hasUnconfirmedLocalEdit: false,
      hasUnconfirmedPersistedContent: coordinator.hasUnconfirmedContent(target),
    })
    expect(
      resolveExternalContentChange({
        baselineContentHash,
        currentContentHash: externalContentHash,
        hasPendingLocalEdit,
        reason: "bulk",
      }),
    ).toEqual({ action: "conflict" })
  })
})
