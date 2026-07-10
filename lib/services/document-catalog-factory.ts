import type { DocumentCatalog } from "@/lib/services/contracts/document-catalog"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import { webDocumentCatalog } from "@/lib/services/web-document-catalog"

let desktopCatalogPromise: Promise<DocumentCatalog> | null = null

export async function getDocumentCatalog(): Promise<DocumentCatalog> {
  if (!isDesktopRuntime()) return webDocumentCatalog
  if (!desktopCatalogPromise) {
    desktopCatalogPromise = (async () => {
      const { appConfigDir, join } = await import("@tauri-apps/api/path")
      return new SqliteDocumentCatalog(await join(await appConfigDir(), "desktop-index.sqlite3"))
    })()
  }
  return desktopCatalogPromise
}
