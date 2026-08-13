import { describe, expect, it, vi } from "vitest"
import { backUpLocalImage } from "@/lib/editor/local-image-backup"
import type { AssetService } from "@/lib/services/contracts/asset-service"

function service(overrides: Partial<AssetService> = {}): AssetService {
  return {
    readLocalImageAsset: vi.fn(async () => ({
      data: {
        sourcePath: "/docs/image.png",
        fileName: "image.png",
        mimeType: "image/png",
        sizeBytes: 3,
        bytes: new Uint8Array([1, 2, 3]),
      },
      error: null,
    })),
    uploadImageAsset: vi.fn(async () => ({
      data: {
        assetId: "asset-1",
        writingId: "writing-1",
        url: "https://cdn.example.com/image.png",
        alt: null,
        mimeType: "image/png",
        sizeBytes: 3,
      },
      error: null,
    })),
    ...overrides,
  }
}

describe("backUpLocalImage", () => {
  it("replaces the local source only after upload succeeds", async () => {
    const assetService = service()
    const replaceSource = vi.fn(() => vi.fn(() => true))

    const result = await backUpLocalImage({
      service: assetService,
      writingId: "writing-1",
      documentPath: "/docs/essay.md",
      source: "image.png",
      alt: "Diagram",
      replaceSource,
      persistDocument: vi.fn(async () => true),
    })

    expect(result.error).toBeNull()
    const readOrder = vi.mocked(assetService.readLocalImageAsset).mock.invocationCallOrder[0]
    const uploadOrder = vi.mocked(assetService.uploadImageAsset).mock.invocationCallOrder[0]
    expect(readOrder).toBeLessThan(uploadOrder)
    expect(replaceSource).toHaveBeenCalledWith("https://cdn.example.com/image.png")
  })

  it("preserves the local source when upload fails", async () => {
    const replaceSource = vi.fn(() => vi.fn(() => true))
    const assetService = service({
      uploadImageAsset: vi.fn(async () => ({
        data: null,
        error: { code: "STORAGE_ERROR", message: "offline", retryable: true },
      })),
    })

    const result = await backUpLocalImage({
      service: assetService,
      writingId: "writing-1",
      documentPath: "/docs/essay.md",
      source: "image.png",
      alt: "",
      replaceSource,
      persistDocument: vi.fn(async () => true),
    })

    expect(result.error?.message).toBe("offline")
    expect(replaceSource).not.toHaveBeenCalled()
  })

  it("restores the local source when canonical document persistence fails", async () => {
    const rollback = vi.fn(() => true)
    const replaceSource = vi.fn(() => rollback)

    const result = await backUpLocalImage({
      service: service(),
      writingId: "writing-1",
      documentPath: "/docs/essay.md",
      source: "image.png",
      alt: "",
      replaceSource,
      persistDocument: vi.fn(async () => false),
    })

    expect(result.error?.code).toBe("STORAGE_ERROR")
    expect(result.error?.details).toEqual({ orphanedAssetId: "asset-1" })
    expect(rollback).toHaveBeenCalledOnce()
  })

  it("rejects oversized images before upload", async () => {
    const uploadImageAsset = vi.fn()
    const assetService = service({
      readLocalImageAsset: vi.fn(async () => ({
        data: {
          sourcePath: "/docs/image.png",
          fileName: "image.png",
          mimeType: "image/png",
          sizeBytes: 5 * 1024 * 1024 + 1,
          bytes: new Uint8Array(),
        },
        error: null,
      })),
      uploadImageAsset,
    })

    const result = await backUpLocalImage({
      service: assetService,
      writingId: "writing-1",
      documentPath: "/docs/essay.md",
      source: "image.png",
      alt: "",
      replaceSource: () => vi.fn(() => true),
      persistDocument: vi.fn(async () => true),
    })

    expect(result.error?.code).toBe("INVALID_INPUT")
    expect(uploadImageAsset).not.toHaveBeenCalled()
  })
})
