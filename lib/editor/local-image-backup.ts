import type { AssetService } from "@/lib/services/contracts/asset-service"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"

const MAX_CLOUD_IMAGE_BYTES = 5 * 1024 * 1024

export async function backUpLocalImage(input: {
  service: AssetService
  writingId: string
  documentPath: string
  source: string
  alt: string
  replaceSource: (onlineUrl: string) => boolean
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

  if (!input.replaceSource(uploaded.data.url)) {
    return {
      data: null,
      error: {
        code: "CONFLICT",
        message: "The image changed before the upload completed. Its local path was preserved.",
        retryable: false,
      },
    }
  }

  return { data: { onlineUrl: uploaded.data.url }, error: null }
}
