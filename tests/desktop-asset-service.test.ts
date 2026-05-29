import { beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopAssetService } from "@/lib/services/desktop/desktop-asset-service"

const mockFiles = new Map<string, string>()

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriResolveAssetPath: vi.fn(async (docPath: string, relativePath: string) => {
    const dir = docPath.split("/").slice(0, -1).join("/")
    const resolved = `${dir}/${relativePath}`
    if (!mockFiles.has(resolved)) throw new Error(`Asset not found: ${resolved}`)
    return resolved
  }),
}))

describe("DesktopAssetService", () => {
  let service: DesktopAssetService

  beforeEach(() => {
    mockFiles.clear()
    service = new DesktopAssetService()
    vi.clearAllMocks()
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

  it("uploadImageAsset returns UNAVAILABLE (not yet implemented)", async () => {
    const result = await service.uploadImageAsset({
      writingId: "doc-1",
      fileName: "test.png",
      contentType: "image/png",
      sizeBytes: 1024,
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("UNAVAILABLE")
  })
})
