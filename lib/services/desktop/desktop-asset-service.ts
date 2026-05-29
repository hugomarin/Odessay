import type {
  AssetService,
  UploadImageAssetInput,
  WritingAsset,
} from "@/lib/services/contracts/asset-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { tauriResolveAssetPath } from "@/lib/services/desktop/tauri-commands"

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(code: ServiceError["code"], message: string): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable: false } }
}

/**
 * Desktop adapter for AssetService.
 *
 * Architecture Contract §ODE-210:
 *  - Resolves relative asset paths against the document's directory.
 *  - Does not modify the .md; only resolves and verifies paths.
 *  - No dependency on Next.js, Supabase, cookies, or window.
 */
export class DesktopAssetService implements AssetService {
  /**
   * Resolve a relative asset path against the document's directory.
   * Returns the absolute filesystem path if the file exists.
   */
  async resolveAssetPath(docPath: string, relativePath: string): Promise<ServiceResponse<string>> {
    try {
      const absolute = await tauriResolveAssetPath(docPath, relativePath)
      return ok(absolute)
    } catch (e) {
      return err(
        "NOT_FOUND",
        e instanceof Error ? e.message : `Asset not found: ${relativePath}`,
      )
    }
  }

  /**
   * Upload an image asset for a writing.
   * On desktop, this copies the file to an `assets/` sibling directory
   * of the document and returns a local file:// URL.
   */
  async uploadImageAsset(input: UploadImageAssetInput): Promise<ServiceResponse<WritingAsset>> {
    // TODO: implement local asset storage when there is a UI consumer.
    // For now, return an error indicating local asset upload is not yet implemented.
    void input
    return err("UNAVAILABLE", "Local asset upload is not yet implemented on desktop")
  }
}
