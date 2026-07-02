import { beforeEach, describe, expect, it, vi } from "vitest"

const authGetUser = vi.fn()
const rpcMock = vi.fn()
const fromSelectMock = vi.fn()
const fromEqMock = vi.fn()
const fromIsMock = vi.fn()
const fromMaybeSingleMock = vi.fn()
const createDesktopDraftMock = vi.fn()
const getWorkspaceDetailMock = vi.fn()
const assignMock = vi.fn()
const tauriListRecentFilesMock = vi.fn()

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: { getUser: authGetUser },
    rpc: rpcMock,
    from: () => ({
      select: fromSelectMock,
    }),
  }),
}))

vi.mock("@/lib/services/document-service-factory", () => ({
  createDesktopDraft: createDesktopDraftMock,
}))

vi.mock("@/lib/services/workspace-service", () => ({
  getWorkspaceAssignmentService: () => ({
    isAvailable: true,
    listWorkspaces: vi.fn(),
    listAssignments: vi.fn(),
    getAssignment: vi.fn(),
    getWorkspaceDetail: getWorkspaceDetailMock,
    assign: assignMock,
    clearAssignment: vi.fn(),
    createWorkspace: vi.fn(),
  }),
}))

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriListRecentFiles: tauriListRecentFilesMock,
}))

describe("desktop shared reading service", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_TAURI_BUILD = "true"

    authGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })

    fromSelectMock.mockReturnValue({
      eq: fromEqMock,
    })
    fromEqMock.mockReturnValue({
      is: fromIsMock,
    })
    fromIsMock.mockReturnValue({
      maybeSingle: fromMaybeSingleMock,
    })
  })

  it("loads a shared writing and builds desktop prev/next hrefs", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          title: "First",
          slug: "first",
          body_text: "First body",
          updated_at: "2026-07-01T00:00:00.000Z",
          author_username: "author-1",
          author_display_name: "Author One",
        },
        {
          id: "writing-2",
          title: "Second",
          slug: "second",
          body_text: "Second body",
          updated_at: "2026-07-02T00:00:00.000Z",
          author_username: "author-2",
          author_display_name: "Author Two",
        },
      ],
      error: null,
    })

    fromMaybeSingleMock.mockResolvedValue({
      data: {
        id: "writing-2",
        title: "Second",
        body_json: { type: "doc", content: [] },
        body_text: "Second body",
        updated_at: "2026-07-02T00:00:00.000Z",
      },
      error: null,
    })

    const { loadDesktopSharedReading } = await import("@/lib/services/shared-reading-service")
    const result = await loadDesktopSharedReading("writing-2")

    expect(result.error).toBeNull()
    expect(result.data?.sequencePosition).toBe(2)
    expect(result.data?.sequenceTotal).toBe(2)
    expect(result.data?.prevWritingHref).toBe("/shared?id=writing-1")
    expect(result.data?.nextWritingHref).toBeNull()
    expect(result.data?.author).toEqual({
      username: "author-2",
      displayName: "Author Two",
    })
  })

  it("copies the shared writing into the chosen workspace folder as a new local draft", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: "shared-1",
          title: "Shared Note",
          slug: "shared-note",
          body_text: "Shared body",
          updated_at: "2026-07-02T00:00:00.000Z",
          author_username: "author-1",
          author_display_name: "Author One",
        },
      ],
      error: null,
    })

    fromMaybeSingleMock.mockResolvedValue({
      data: {
        id: "shared-1",
        title: "Shared Note",
        body_json: { type: "doc", content: [{ type: "paragraph" }] },
        body_text: "Shared body",
        updated_at: "2026-07-02T00:00:00.000Z",
      },
      error: null,
    })

    getWorkspaceDetailMock.mockResolvedValue({
      slug: "letters",
      name: "Letters",
      rootPath: "/Users/hugo/Letters",
      status: "ready",
      selectedPaths: [],
      source: "existing-folder",
      missingReason: null,
      addedAt: "2026-07-01T00:00:00.000Z",
      lastOpenedAt: null,
      fileCount: 0,
      folderCount: 0,
      updatedAt: null,
      files: [],
    })

    tauriListRecentFilesMock.mockResolvedValue([
      {
        path: "/Users/hugo/Letters/Drafts/Shared Note.md",
        name: "Shared Note",
        modifiedAt: 0,
        size: 0,
      },
    ])

    createDesktopDraftMock.mockResolvedValue({
      data: { id: "local-copy-1" },
      error: null,
    })

    const { copyDesktopSharedWritingToWorkspace } = await import("@/lib/services/shared-reading-service")
    const result = await copyDesktopSharedWritingToWorkspace({
      identifier: "shared-1",
      workspaceSlug: "letters",
      destinationFolder: "Drafts",
    })

    expect(result).toEqual({
      data: { writingId: "local-copy-1" },
      error: null,
    })
    expect(createDesktopDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: "user-1",
        title: "Shared Note",
        preferredPath: "/Users/hugo/Letters/Drafts/Shared Note 2.md",
        initialBodyText: "Shared body",
      }),
    )
    expect(assignMock).toHaveBeenCalledWith("local-copy-1", "letters")
  })
})
