import { tauriOpenFile } from "@/lib/services/desktop/tauri-commands"
import { describeOpenFileReadFailure } from "@/lib/services/open-document-factory"

/**
 * Frontend preflight shared by the four `open_file` entries (Cmd+O in and
 * outside Write, plus the OS "Open With"/Dock path drained from
 * `PendingOpenPaths`). It reads the native adapter, classifies a reader
 * failure, shows the user-facing message for the one recoverable case
 * (non-UTF-8 bytes) and returns `rejected` so the caller stops before any
 * callback, route, identity or durable state.
 *
 * It owns no UUID, root or catalog: on `read` the caller still goes through
 * `openDocumentByPath` (Write) or the one-slot pending-file handoff (outside
 * Write). The pre-read bytes are never used to hydrate the editor. A rejected
 * file is not retried automatically; the user can open it again.
 */
export type OpenFilePreflight =
  | { status: "read"; content: string }
  | { status: "rejected" }

export async function preflightOpenFile(path: string): Promise<OpenFilePreflight> {
  let content: string
  try {
    content = await tauriOpenFile(path)
  } catch (error) {
    const message = describeOpenFileReadFailure(error)
    if (!message) throw error
    if (typeof window !== "undefined") window.alert(message)
    return { status: "rejected" }
  }
  return { status: "read", content }
}
