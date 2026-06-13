import { isTauriRuntime } from "@/lib/runtime/detect"
import { createDesktopSharingService } from "@/lib/services/desktop/desktop-sharing-service"
import { createBrowserSharingService, type BrowserSharingService } from "@/lib/services/web-sharing-service"

/**
 * Returns the sharing service for the current runtime.
 *
 * - Web: the fetch-based browser service that calls the Next.js API routes.
 * - Desktop (Tauri): a service that talks to Supabase directly, because the
 *   API routes are not available in the static export.
 */
export function createSharingService(): BrowserSharingService {
  if (isTauriRuntime()) {
    return createDesktopSharingService()
  }

  return createBrowserSharingService()
}
