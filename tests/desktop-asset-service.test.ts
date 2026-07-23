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

  it("uploadImageAsset uploads to storage, inserts DB record, and returns asset with signed URL", async () => {
    const user = { id: "user-123" }
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null })
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
      alt: "A test image",
    })

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      writingId: "doc-1",
      url: "https://cdn.example.com/signed-url",
      alt: "A test image",
      mimeType: "image/png",
      sizeBytes: 1024,
    })
    expect(result.data?.assetId).toBeTypeOf("string")

    expect(mockStorageUpload).toHaveBeenCalledOnce()
    expect(mockFromInsert).toHaveBeenCalledOnce()
    expect(mockStorageCreateSignedUrl).toHaveBeenCalledOnce()
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
