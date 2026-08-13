import type { AssetService } from "@/lib/services/contracts/asset-service"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"

const MAX_CLOUD_IMAGE_BYTES = 5 * 1024 * 1024

export async function backUpLocalImage(input: {
  service: AssetService
  writingId: string
  documentPath: string
  source: string
  alt: string
  replaceSource: (onlineUrl: string) => (() => boolean) | null
  persistDocument: () => Promise<boolean>
}): Promise<ServiceResponse<{ onlineUrl: string }>> {
  const local = await input.service.readLocalImageAsset({
    documentPath: input.documentPath,
    source: input.source,
  })
  if (local.error) return local
  if (local.data.sizeBytes > MAX_CLOUD_IMAGE_BYTES) {
    return {
      data: null,
      error: {
        code: "INVALID_INPUT",
        message: "Image is too large to back up. Maximum size is 5 MB.",
        retryable: false,
      },
    }
  }

  const uploaded = await input.service.uploadImageAsset({
    writingId: input.writingId,
    fileName: local.data.fileName,
    contentType: local.data.mimeType,
    sizeBytes: local.data.sizeBytes,
    bytes: local.data.bytes,
    alt: input.alt || null,
  })
  if (uploaded.error) return uploaded

  const rollback = input.replaceSource(uploaded.data.url)
  if (!rollback) {
    return {
      data: null,
      error: {
        code: "CONFLICT",
        message: "The image changed before the upload completed. Its local path was preserved.",
        retryable: false,
      },
    }
  }

  if (!(await input.persistDocument())) {
    rollback()
    return {
      data: null,
      error: {
        code: "STORAGE_ERROR",
        message: "The image was uploaded, but the document could not be saved. Its local path was restored.",
        retryable: true,
        details: { orphanedAssetId: uploaded.data.assetId },
      },
    }
  }

  return { data: { onlineUrl: uploaded.data.url }, error: null }
}
