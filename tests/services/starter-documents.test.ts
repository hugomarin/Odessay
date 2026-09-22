import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  isDesktopRuntime: vi.fn(() => true),
  getById: vi.fn(),
  createDesktopDraft: vi.fn(),
  parseMarkdownToSnapshot: vi.fn(() => ({ bodyJson: { type: "doc", content: [] }, bodyText: "", markdown: "" })),
  getBindingRoots: vi.fn(async () => [{ id: "managed-root", rootPath: "/config/artifact-studio-managed", kind: "managed" }]),
  ensureManagedRoot: vi.fn(async (rootPath: string) => ({ id: "managed-root", rootPath, kind: "managed" })),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: mocks.isDesktopRuntime,
}))

vi.mock("@/lib/services/desktop/sqlite-document-catalog", () => ({
  SqliteDocumentCatalog: class {
    getById = mocks.getById
  },
}))

vi.mock("@/lib/services/document-service-factory", () => ({
  createDesktopDraft: mocks.createDesktopDraft,
}))

vi.mock("@/lib/editor/document-serialization", () => ({
  parseMarkdownToSnapshot: mocks.parseMarkdownToSnapshot,
}))

vi.mock("@/lib/services/desktop/desktop-settings-service", () => ({
  DesktopSettingsService: class {
    getBindingRoots = mocks.getBindingRoots
    ensureManagedRoot = mocks.ensureManagedRoot
  },
}))

vi.mock("@/lib/services/desktop/open-document-desktop", () => ({
  MANAGED_ROOT_DIRNAME: "artifact-studio-managed",
}))

vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: async () => "/config",
  join: async (...parts: string[]) => parts.join("/"),
}))

import { STARTER_DOCUMENTS, seedStarterDocuments } from "@/lib/services/desktop/starter-documents"

describe("seedStarterDocuments (ODE-449)", () => {
  const [firstDoc, secondDoc] = STARTER_DOCUMENTS

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isDesktopRuntime.mockReturnValue(true)
    mocks.getBindingRoots.mockResolvedValue([
      { id: "managed-root", rootPath: "/config/artifact-studio-managed", kind: "managed" },
    ])
    mocks.parseMarkdownToSnapshot.mockReturnValue({
      bodyJson: { type: "doc", content: [] },
      bodyText: "",
      markdown: "",
    })
  })

  it("is a no-op on web", async () => {
    mocks.isDesktopRuntime.mockReturnValue(false)
    const result = await seedStarterDocuments()
    expect(result).toEqual({ created: [], kept: [], failed: [] })
    expect(mocks.getById).not.toHaveBeenCalled()
  })

  it("creates both starter documents on a fresh install", async () => {
    mocks.getById.mockResolvedValue(null)
    mocks.createDesktopDraft.mockResolvedValue({ data: { id: "ok" }, error: null })

    const result = await seedStarterDocuments()

    expect(result.created).toEqual([firstDoc.id, secondDoc.id])
    expect(result.kept).toEqual([])
    expect(result.failed).toEqual([])
    expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(2)
    expect(mocks.createDesktopDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        writingId: firstDoc.id,
        preferredPath: `/config/artifact-studio-managed/${firstDoc.filename}`,
      }),
    )
  })

  it("is idempotent — a second run keeps both and writes nothing", async () => {
    mocks.getById.mockImplementation(async (id: string) => ({ id, deletedAt: null }))

    const result = await seedStarterDocuments()

    expect(result.created).toEqual([])
    expect(result.kept).toEqual([firstDoc.id, secondDoc.id])
    expect(mocks.createDesktopDraft).not.toHaveBeenCalled()
  })

  it("recreates only the starter document the user deleted", async () => {
    mocks.getById.mockImplementation(async (id: string) => {
      if (id === firstDoc.id) return { id, deletedAt: null }
      return { id, deletedAt: "2026-09-01T00:00:00.000Z" }
    })
    mocks.createDesktopDraft.mockResolvedValue({ data: { id: "ok" }, error: null })

    const result = await seedStarterDocuments()

    expect(result.kept).toEqual([firstDoc.id])
    expect(result.created).toEqual([secondDoc.id])
    expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1)
    expect(mocks.createDesktopDraft).toHaveBeenCalledWith(
      expect.objectContaining({ writingId: secondDoc.id }),
    )
  })

  it("reports a write failure for one seed without affecting the other", async () => {
    mocks.getById.mockResolvedValue(null)
    mocks.createDesktopDraft.mockImplementation(async ({ writingId }: { writingId: string }) => {
      if (writingId === firstDoc.id) {
        return { data: null, error: { code: "STORAGE_ERROR", message: "Disk full", retryable: false } }
      }
      return { data: { id: writingId }, error: null }
    })

    const result = await seedStarterDocuments()

    expect(result.failed).toEqual([{ id: firstDoc.id, title: firstDoc.title, message: "Disk full" }])
    expect(result.created).toEqual([secondDoc.id])
  })
})
