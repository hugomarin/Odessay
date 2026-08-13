"use client"

import type { AssetService, LocalImageAsset, UploadImageAssetInput, WritingAsset } from "@/lib/services/contracts/asset-service"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"
import { err, ok } from "@/lib/services/service-response"

type UploadApiResult = {
  data: { assetId: string; url: string; alt: string | null } | null
  error: { code: string; message: string } | null
}

export class WebAssetService implements AssetService {
  async readLocalImageAsset(): Promise<ServiceResponse<LocalImageAsset>> {
    return err({
      code: "UNSUPPORTED",
      message: "Local image files are available in the desktop app",
      retryable: false,
    })
  }

  async uploadImageAsset(input: UploadImageAssetInput): Promise<ServiceResponse<WritingAsset>> {
    const formData = new FormData()
    const blob = new Blob([input.bytes.buffer as ArrayBuffer], { type: input.contentType })
    formData.append("file", new File([blob], input.fileName, { type: input.contentType }))
    if (input.alt) formData.append("alt", input.alt)

    let res: Response
    try {
      res = await fetch(`/api/writings/${input.writingId}/images`, { method: "POST", body: formData })
    } catch {
      return err({ code: "STORAGE_ERROR", message: "Network error uploading image", retryable: true })
    }

    const result = (await res.json()) as UploadApiResult

    if (!res.ok || result.error) {
      return err({
        code: result.error?.code ?? "STORAGE_ERROR",
        message: result.error?.message ?? "Failed to upload image",
        retryable: res.status >= 500,
      })
    }

    return ok({
      assetId: result.data!.assetId,
      writingId: input.writingId,
      url: result.data!.url,
      alt: result.data!.alt,
      mimeType: input.contentType,
      sizeBytes: input.sizeBytes,
    })
  }
}

export const webAssetService = new WebAssetService()
