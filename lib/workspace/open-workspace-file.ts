"use client"

import type { useRouter } from "next/navigation"
import { getDesktopWorkspaceService } from "@/lib/services/desktop/workspace-service"
import {
  describeOpenOutcome,
  isUnifiedOpenEnabled,
  openDocumentByPath,
} from "@/lib/services/open-document-factory"
import type { WorkspaceFile } from "@/lib/workspace/types"

/**
 * Opens a workspace file through the one unified opener (ODE-375 M3). With the
 * catalog pipeline enabled, path → UUID goes through `openDocumentByPath`, which
 * resolves identity via the catalog/manifest before hydration and never seeds or
 * replaces IndexedDB records destructively.
 */
export async function openWorkspaceFileInEditor(
  file: WorkspaceFile,
  router: ReturnType<typeof useRouter>,
  onError?: (message: string) => void,
): Promise<void> {
  try {
    if (isUnifiedOpenEnabled()) {
      let result = await openDocumentByPath(file.path)
      if (result.status === "needs-binding-root-confirmation") {
        const accept = window.confirm(
          `Register “${result.parentDir}” so Artifact Studio can keep this file’s identity across moves and renames?`,
        )
        if (!accept) return
        result = await openDocumentByPath(file.path, {
          confirmRegisterRoot: true,
        })
      }
      if (result.status === "opened") {
        router.push(`/write?id=${encodeURIComponent(result.documentId)}`)
        return
      }
      onError?.(describeOpenOutcome(result))
      return
    }

    const service = await getDesktopWorkspaceService()
    const writingId = await service.openFileInEditor(file.path, file.id)
    router.push(`/write?id=${encodeURIComponent(writingId)}`)
  } catch (error) {
    onError?.(error instanceof Error ? error.message : "Failed to open file")
  }
}
