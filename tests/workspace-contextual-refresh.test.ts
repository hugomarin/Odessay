import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ContextualWorkspace } from "@/lib/workspace/types"

const isTauriRuntime = vi.fn(() => true)
const findWorkspaceRecord = vi.fn()
const loadWorkspaceDocumentJoin = vi.fn()

vi.mock("@/lib/runtime/detect", () => ({
  isTauriRuntime: () => isTauriRuntime(),
  isWebRuntime: () => !isTauriRuntime(),
}))

vi.mock("@/lib/services/desktop/workspace-service", () => ({
  getDesktopWorkspaceService: async () => ({
    findWorkspaceRecord: (slug: string) => findWorkspaceRecord(slug),
  }),
}))

vi.mock("@/lib/queries/workspace-catalog-source", () => ({
  loadWorkspaceDocumentJoin: (rootPath: string) =>
    loadWorkspaceDocumentJoin(rootPath),
}))

vi.mock("@/lib/queries/document-catalog", () => ({
  subscribeToCatalog: () => () => {},
}))

vi.mock("@/lib/services/document-catalog-factory", () => ({
  getDocumentCatalog: async () => ({ getById: async () => null }),
}))

const { refreshContextualWorkspaceDocuments } = await import(
  "@/lib/services/workspace-service"
)

const ROOT = "/Users/hugo/Aplyca"
const ACTIVE_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ID = "22222222-2222-4222-8222-222222222222"
const NEW_ID = "33333333-3333-4333-8333-333333333333"

const workspace: ContextualWorkspace = {
  slug: "aplyca",
  name: "Aplyca",
  status: "ready",
  missingReason: null,
  documents: [
    {
      id: ACTIVE_ID,
      name: "analisis.md",
      relativePath: "03-analisis/analisis.md",
      state: "synced",
      openable: true,
    },
    {
      id: OTHER_ID,
      name: "sesion.md",
      relativePath: "04-sesiones/sesion.md",
      state: "synced",
      openable: true,
    },
    // Discovered on disk but not reconciled into the catalog yet.
    {
      id: null,
      name: "borrador.md",
      relativePath: "borrador.md",
      state: "rebuilding",
      openable: false,
    },
  ],
}

const join = (entries: Array<[string, string, string]>) =>
  new Map(
    entries.map(([canonicalPath, id, state]) => [
      canonicalPath,
      { id, state, status: "draft", artifactType: "general", excerpt: null },
    ]),
  )

const READY_JOIN: Array<[string, string, string]> = [
  [`${ROOT}/03-analisis/analisis.md`, ACTIVE_ID, "synced"],
  [`${ROOT}/04-sesiones/sesion.md`, OTHER_ID, "synced"],
]

describe("refreshContextualWorkspaceDocuments", () => {
  beforeEach(() => {
    isTauriRuntime.mockReturnValue(true)
    findWorkspaceRecord.mockReset()
    findWorkspaceRecord.mockResolvedValue({
      slug: "aplyca",
      name: "Aplyca",
      rootPath: ROOT,
      source: "existing-folder",
      addedAt: "2026-08-01T00:00:00.000Z",
      lastOpenedAt: null,
    })
    loadWorkspaceDocumentJoin.mockReset()
    loadWorkspaceDocumentJoin.mockResolvedValue(join(READY_JOIN))
  })

  it("returns null when the change moved nothing the tree renders", async () => {
    const result = await refreshContextualWorkspaceDocuments(workspace, [
      ACTIVE_ID,
    ])

    // An autosave bumps content, not the tree — the panel must not re-render.
    expect(result).toBeNull()
  })

  it("never touches the filesystem", async () => {
    await refreshContextualWorkspaceDocuments(workspace, [ACTIVE_ID])

    // findWorkspaceRecord is the scan-free lookup; getWorkspace would sync the
    // whole root. Only the catalog join is read.
    expect(findWorkspaceRecord).toHaveBeenCalledWith("aplyca")
    expect(loadWorkspaceDocumentJoin).toHaveBeenCalledWith(ROOT)
  })

  it("follows a rename without rescanning the root", async () => {
    loadWorkspaceDocumentJoin.mockResolvedValue(
      join([
        [`${ROOT}/03-analisis/analisis-v2.md`, ACTIVE_ID, "synced"],
        [`${ROOT}/04-sesiones/sesion.md`, OTHER_ID, "synced"],
      ]),
    )

    const result = await refreshContextualWorkspaceDocuments(workspace, [
      ACTIVE_ID,
    ])

    const renamed = result?.documents.find((entry) => entry.id === ACTIVE_ID)
    expect(renamed?.relativePath).toBe("03-analisis/analisis-v2.md")
    expect(renamed?.name).toBe("analisis-v2.md")
  })

  it("appends a document the same transaction registered under the root", async () => {
    loadWorkspaceDocumentJoin.mockResolvedValue(
      join([...READY_JOIN, [`${ROOT}/02-discovery/nuevo.md`, NEW_ID, "local"]]),
    )

    const result = await refreshContextualWorkspaceDocuments(workspace, [NEW_ID])

    expect(result?.documents.map((entry) => entry.id)).toContain(NEW_ID)
    expect(
      result?.documents.find((entry) => entry.id === NEW_ID)?.relativePath,
    ).toBe("02-discovery/nuevo.md")
  })

  it("drops a document that left the root", async () => {
    loadWorkspaceDocumentJoin.mockResolvedValue(
      join([[`${ROOT}/03-analisis/analisis.md`, ACTIVE_ID, "synced"]]),
    )

    const result = await refreshContextualWorkspaceDocuments(workspace, [
      OTHER_ID,
    ])

    expect(result?.documents.map((entry) => entry.id)).not.toContain(OTHER_ID)
  })

  it("keeps documents the change did not name, including unreconciled files", async () => {
    loadWorkspaceDocumentJoin.mockResolvedValue(
      join([...READY_JOIN, [`${ROOT}/02-discovery/nuevo.md`, NEW_ID, "local"]]),
    )

    const result = await refreshContextualWorkspaceDocuments(workspace, [NEW_ID])

    // The on-disk file with no catalog identity must survive a patch, or every
    // save would erase files reconciliation has not reached yet.
    const orphan = result?.documents.find((entry) => entry.id === null)
    expect(orphan?.relativePath).toBe("borrador.md")
    expect(orphan?.state).toBe("rebuilding")
  })

  it("declines to patch an unavailable root", async () => {
    const result = await refreshContextualWorkspaceDocuments(
      { ...workspace, status: "missing", missingReason: "folder gone" },
      [ACTIVE_ID],
    )

    expect(result).toBeNull()
    expect(loadWorkspaceDocumentJoin).not.toHaveBeenCalled()
  })
})
