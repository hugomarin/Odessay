import { beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopAssetService } from "@/lib/services/desktop/desktop-asset-service"

const mockFiles = new Map<string, string>()

const mockStorageRemove = vi.fn()
const mockStorageUpload = vi.fn()
const mockStorageCreateSignedUrl = vi.fn()
const mockFromInsert = vi.fn()
// ODE-404 pre-flight: head-count of the parent writing row in the cloud.
const mockWritingsCount = vi.fn()
const mockFlushPending = vi.fn()

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
    getSession: vi.fn(),
  },
  storage: {
    from: vi.fn(() => ({
      upload: mockStorageUpload,
      remove: mockStorageRemove,
      createSignedUrl: mockStorageCreateSignedUrl,
    })),
  },
  from: vi.fn((table: string) =>
    table === "writings"
      ? { select: () => ({ eq: () => ({ eq: mockWritingsCount }) }) }
      : { insert: mockFromInsert },
  ),
}

vi.mock("@/lib/sync/desktop-catalog-sync-service", () => ({
  desktopCatalogSyncService: {
    flushPending: (...args: unknown[]) => mockFlushPending(...args),
  },
}))

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriResolveAssetPath: vi.fn(async (docPath: string, relativePath: string) => {
    const dir = docPath.split("/").slice(0, -1).join("/")
    const resolved = `${dir}/${relativePath}`
    if (!mockFiles.has(resolved)) throw new Error(`Asset not found: ${resolved}`)
    return resolved
  }),
  tauriReadLocalImageAsset: vi.fn(async (documentPath: string, source: string) => {
    const dir = documentPath.split("/").slice(0, -1).join("/")
    const sourcePath = source.startsWith("/") ? source : `${dir}/${source}`
    if (!mockFiles.has(sourcePath)) throw new Error(`Asset not found: ${sourcePath}`)
    return {
      sourcePath,
      fileName: sourcePath.split("/").pop()!,
      mimeType: "image/png",
      sizeBytes: 3,
      bytes: [1, 2, 3],
    }
  }),
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: vi.fn(() => mockSupabase),
}))

describe("DesktopAssetService", () => {
  let service: DesktopAssetService

  beforeEach(() => {
    mockFiles.clear()
    service = new DesktopAssetService()
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = "https://app.odessay.test"
    // Default: parent writing row already present in the cloud.
    mockWritingsCount.mockResolvedValue({ count: 1, error: null })
    mockFlushPending.mockResolvedValue({ data: { processedMutations: 0, failedMutations: [], nextRetryAt: null }, error: null })
  })

  it("resolveAssetPath returns the absolute path for an existing asset", async () => {
    const docPath = "/home/user/writings/essay.md"
    mockFiles.set("/home/user/writings/images/photo.png", "png-content")

    const result = await service.resolveAssetPath(docPath, "images/photo.png")
    expect(result.error).toBeNull()
    expect(result.data).toBe("/home/user/writings/images/photo.png")
  })

  it("resolveAssetPath returns NOT_FOUND for a missing asset", async () => {
    const docPath = "/home/user/writings/essay.md"
    const result = await service.resolveAssetPath(docPath, "images/missing.png")
    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("NOT_FOUND")
  })

  it("readLocalImageAsset returns validated bytes for relative and absolute paths", async () => {
    const documentPath = "/home/user/writings/essay.md"
    mockFiles.set("/home/user/writings/images/photo.png", "png-content")

    const relative = await service.readLocalImageAsset({ documentPath, source: "images/photo.png" })
    const absolute = await service.readLocalImageAsset({
      documentPath,
      source: "/home/user/writings/images/photo.png",
    })

    expect(relative.error).toBeNull()
    expect(relative.data?.bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(absolute.data?.sourcePath).toBe("/home/user/writings/images/photo.png")
  })

  it("uploadImageAsset returns UNAUTHORIZED when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") })

    const result = await service.uploadImageAsset({
      writingId: "doc-1",
      fileName: "test.png",
      contentType: "image/png",
      sizeBytes: 1024,
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("UNAUTHORIZED")
  })

  it("uploadImageAsset uploads to storage, inserts DB record, and returns a durable asset URL", async () => {
    const user = { id: "user-123" }
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null })
    mockStorageUpload.mockResolvedValue({ error: null })
    mockFromInsert.mockResolvedValue({ error: null })

    const result = await service.uploadImageAsset({
      writingId: "doc-1",
      fileName: "test.png",
      contentType: "image/png",
      sizeBytes: 1024,
      bytes: new Uint8Array([1, 2, 3]),
      alt: "A test image",
    })

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      writingId: "doc-1",
      url: expect.stringMatching(/^https:\/\/app\.odessay\.test\/api\/writing-assets\/[0-9a-f-]+$/),
      alt: "A test image",
      mimeType: "image/png",
      sizeBytes: 1024,
    })
    expect(result.data?.assetId).toBeTypeOf("string")

    expect(mockStorageUpload).toHaveBeenCalledOnce()
    expect(mockFromInsert).toHaveBeenCalledOnce()
    expect(mockStorageCreateSignedUrl).not.toHaveBeenCalled()
  })

  it("resolves a durable asset URL through the authenticated web route", async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "desktop-token" } },
      error: null,
    })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      url: "https://storage.example.com/signed-render-url",
    } as Response)

    const result = await service.resolveImageAssetUrl(
      "https://app.odessay.test/api/writing-assets/123e4567-e89b-12d3-a456-426614174000",
    )

    expect(result.data).toBe("https://storage.example.com/signed-render-url")
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      { headers: { Authorization: "Bearer desktop-token" } },
    )
  })

  it("uploadImageAsset returns STORAGE_ERROR on upload failure", async () => {
    const user = { id: "user-123" }
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null })
    mockStorageUpload.mockResolvedValue({ error: { message: "Network error" } })

    const result = await service.uploadImageAsset({
      writingId: "doc-1",
      fileName: "test.png",
      contentType: "image/png",
      sizeBytes: 1024,
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("STORAGE_ERROR")
    expect(result.error?.retryable).toBe(true)
  })

  it("uploadImageAsset cleans up storage and returns DB_ERROR on DB insert failure", async () => {
    const user = { id: "user-123" }
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null })
    mockStorageUpload.mockResolvedValue({ error: null })
    mockFromInsert.mockResolvedValue({ error: { message: "constraint violation" } })

    const result = await service.uploadImageAsset({
      writingId: "doc-1",
      fileName: "test.png",
      contentType: "image/png",
      sizeBytes: 1024,
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("DB_ERROR")
    expect(mockStorageRemove).toHaveBeenCalledOnce()
  })

  // ── ODE-404: pre-flight flush before writing_assets insert (FK) ─────────────

  it("flushes the sync queue when the writing is missing in the cloud and proceeds once present", async () => {
    const user = { id: "user-123" }
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null })
    mockWritingsCount
      .mockResolvedValueOnce({ count: 0, error: null })
      .mockResolvedValueOnce({ count: 1, error: null })
    mockStorageUpload.mockResolvedValue({ error: null })
    mockFromInsert.mockResolvedValue({ error: null })
    mockStorageCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://cdn.example.com/signed-url" },
      error: null,
    })

    const result = await service.uploadImageAsset({
      writingId: "doc-1",
      fileName: "test.png",
      contentType: "image/png",
      sizeBytes: 1024,
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(result.error).toBeNull()
    expect(mockFlushPending).toHaveBeenCalledOnce()
    expect(mockStorageUpload).toHaveBeenCalledOnce()
    expect(mockFromInsert).toHaveBeenCalledOnce()
  })

  it("returns an actionable retryable error when the writing is still absent after the pre-flight flush", async () => {
    const user = { id: "user-123" }
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null })
    mockWritingsCount.mockResolvedValue({ count: 0, error: null })

    const result = await service.uploadImageAsset({
      writingId: "doc-1",
      fileName: "test.png",
      contentType: "image/png",
      sizeBytes: 1024,
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("UNAVAILABLE")
    expect(result.error?.retryable).toBe(true)
    expect(result.error?.message).toBe("Document not yet synced — retry in a moment")
    // Nothing was uploaded or inserted: no orphaned storage object, no raw FK error.
    expect(mockFlushPending).toHaveBeenCalledOnce()
    expect(mockStorageUpload).not.toHaveBeenCalled()
    expect(mockFromInsert).not.toHaveBeenCalled()
  })

  it("maps a residual FK violation after a passing pre-flight to the actionable message", async () => {
    const user = { id: "user-123" }
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null })
    mockStorageUpload.mockResolvedValue({ error: null })
    mockFromInsert.mockResolvedValue({
      error: { message: 'insert or update on table "writing_assets" violates foreign key constraint "writing_assets_writing_id_fkey"', code: "23503" },
    })

    const result = await service.uploadImageAsset({
      writingId: "doc-1",
      fileName: "test.png",
      contentType: "image/png",
      sizeBytes: 1024,
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("UNAVAILABLE")
    expect(result.error?.message).toBe("Document not yet synced — retry in a moment")
    expect(mockStorageRemove).toHaveBeenCalledOnce()
  })
})
