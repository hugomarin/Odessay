import type {
  AssetService,
  UploadImageAssetInput,
  WritingAsset,
} from "@/lib/services/contracts/asset-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { tauriResolveAssetPath } from "@/lib/services/desktop/tauri-commands"
import { createDesktopClient } from "@/lib/supabase/desktop-client"

const TEN_YEARS_SECONDS = 315_360_000

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(code: ServiceError["code"], message: string, retryable = false): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable } }
}

export class DesktopAssetService implements AssetService {
  async resolveAssetPath(docPath: string, relativePath: string): Promise<ServiceResponse<string>> {
    try {
      const absolute = await tauriResolveAssetPath(docPath, relativePath)
      return ok(absolute)
    } catch (e) {
      return err("NOT_FOUND", e instanceof Error ? e.message : `Asset not found: ${relativePath}`)
    }
  }

  async uploadImageAsset(input: UploadImageAssetInput): Promise<ServiceResponse<WritingAsset>> {
    const supabase = createDesktopClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return err("UNAUTHORIZED", "Not authenticated")
    }

    const ext = input.fileName.split(".").pop()?.toLowerCase() ?? "bin"
    const assetId = crypto.randomUUID()
    const storagePath = `${user.id}/${input.writingId}/${assetId}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from("writing-assets")
      .upload(storagePath, input.bytes, { contentType: input.contentType, upsert: false })

    if (uploadError) {
      return err("STORAGE_ERROR", uploadError.message, true)
    }

    const { error: dbError } = await supabase.from("writing_assets").insert({
      id: assetId,
      writing_id: input.writingId,
      author_id: user.id,
      storage_path: storagePath,
      mime_type: input.contentType,
      size_bytes: input.sizeBytes,
    })

    if (dbError) {
      void supabase.storage.from("writing-assets").remove([storagePath])
      return err("DB_ERROR", dbError.message)
    }

    const { data: signed, error: signError } = await supabase.storage
      .from("writing-assets")
      .createSignedUrl(storagePath, TEN_YEARS_SECONDS)

    if (signError || !signed) {
      return err("STORAGE_ERROR", "Failed to create asset URL", true)
    }

    return ok({
      assetId,
      writingId: input.writingId,
      url: signed.signedUrl,
      alt: input.alt ?? null,
      mimeType: input.contentType,
      sizeBytes: input.sizeBytes,
    })
  }
}

export const desktopAssetService = new DesktopAssetService()
