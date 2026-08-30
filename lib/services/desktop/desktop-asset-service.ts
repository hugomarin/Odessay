import type {
  AssetService,
  LocalImageAsset,
  UploadImageAssetInput,
  WritingAsset,
} from "@/lib/services/contracts/asset-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { tauriReadLocalImageAsset, tauriResolveAssetPath } from "@/lib/services/desktop/tauri-commands"
import { createDesktopClient } from "@/lib/supabase/desktop-client"
import { desktopCatalogSyncService } from "@/lib/sync/desktop-catalog-sync-service"

const WRITING_ASSET_PATH = /^\/api\/writing-assets\/[0-9a-f-]+$/i

function getWebRuntimeOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (!configured) return null
  try {
    const url = new URL(configured)
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null
  } catch {
    return null
  }
}

// ODE-404: writing_assets.writing_id has an FK to writings. A desktop-first
// document may not have its cloud row yet (mutation still queued), so the
// insert would surface a raw Postgres FK violation in the editor modal.
const NOT_SYNCED_MESSAGE = "Document not yet synced — retry in a moment"

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(code: ServiceError["code"], message: string, retryable = false): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable } }
}

export class DesktopAssetService implements AssetService {
  async resolveImageAssetUrl(source: string): Promise<ServiceResponse<string>> {
    const origin = getWebRuntimeOrigin()
    if (!origin) return ok(source)

    let url: URL
    try {
      url = new URL(source, origin)
    } catch {
      return ok(source)
    }
    if (url.origin !== origin || !WRITING_ASSET_PATH.test(url.pathname)) return ok(source)

    const supabase = createDesktopClient()
    const { data, error } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (error || !token) return err("UNAUTHORIZED", "Not authenticated")

    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) return err("NOT_FOUND", "Asset not found")
      return ok(response.url)
    } catch {
      return err("UNAVAILABLE", "Unable to resolve online image", true)
    }
  }

  async readLocalImageAsset(input: {
    documentPath: string
    source: string
  }): Promise<ServiceResponse<LocalImageAsset>> {
    try {
      const asset = await tauriReadLocalImageAsset(input.documentPath, input.source)
      return ok({ ...asset, bytes: new Uint8Array(asset.bytes) })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const code = message.includes("unsupported image type") ? "INVALID_INPUT" : "NOT_FOUND"
      return err(code, message)
    }
  }

  async resolveAssetPath(docPath: string, relativePath: string): Promise<ServiceResponse<string>> {
    try {
      const absolute = await tauriResolveAssetPath(docPath, relativePath)
      return ok(absolute)
    } catch (e) {
      return err("NOT_FOUND", e instanceof Error ? e.message : `Asset not found: ${relativePath}`)
    }
  }

  /**
   * Pre-flight (ODE-404): verify the parent writing row exists in the cloud
   * before uploading. If it is absent, flush the sync queue once (the queued
   * mutation for this artifact rides along) and re-check. The result is an
   * actionable, retryable error instead of a raw FK violation.
   */
  private async writingExistsInCloud(
    supabase: ReturnType<typeof createDesktopClient>,
    writingId: string,
    userId: string,
  ): Promise<boolean> {
    const { count, error } = await supabase
      .from("writings")
      .select("id", { count: "exact", head: true })
      .eq("id", writingId)
      .eq("author_id", userId)
    if (error) throw new Error(error.message)
    return (count ?? 0) > 0
  }

  async uploadImageAsset(input: UploadImageAssetInput): Promise<ServiceResponse<WritingAsset>> {
    const supabase = createDesktopClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return err("UNAUTHORIZED", "Not authenticated")
    }

    try {
      let exists = await this.writingExistsInCloud(supabase, input.writingId, user.id)
      if (!exists) {
        await desktopCatalogSyncService.flushPending()
        exists = await this.writingExistsInCloud(supabase, input.writingId, user.id)
      }
      if (!exists) {
        return err("UNAVAILABLE", NOT_SYNCED_MESSAGE, true)
      }
    } catch {
      return err("UNAVAILABLE", NOT_SYNCED_MESSAGE, true)
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
      // FK race after a passing pre-flight (e.g. the writing was deleted in the
      // cloud mid-upload): keep the message actionable, never raw Postgres.
      if ((dbError as { code?: string }).code === "23503") {
        return err("UNAVAILABLE", NOT_SYNCED_MESSAGE, true)
      }
      return err("DB_ERROR", dbError.message)
    }

    const origin = getWebRuntimeOrigin()
    if (!origin) return err("UNAVAILABLE", "NEXT_PUBLIC_APP_URL is not configured")

    return ok({
      assetId,
      writingId: input.writingId,
      url: `${origin}/api/writing-assets/${assetId}`,
      alt: input.alt ?? null,
      mimeType: input.contentType,
      sizeBytes: input.sizeBytes,
    })
  }
}

export const desktopAssetService = new DesktopAssetService()
