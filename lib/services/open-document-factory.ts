import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import type { OpenDocumentResult } from "@/lib/services/open-document"

/**
 * The unified opener (ODE-375 M3) is part of the Fase 9 catalog pipeline, so it is
 * the single desktop opener after the ODE-374 compatibility retirement.
 */
export function isUnifiedOpenEnabled(): boolean {
  return isDesktopRuntime()
}

/** Opens a document through the catalog-backed unified opener. Desktop only. */
export async function openDocumentByPath(
  path: string,
  options: { confirmRegisterRoot?: boolean } = {},
): Promise<OpenDocumentResult> {
  const { openDesktopDocument } = await import(
    "@/lib/services/desktop/open-document-desktop"
  )
  return openDesktopDocument({
    kind: "path",
    path,
    confirmRegisterRoot: options.confirmRegisterRoot ?? false,
  })
}

/** Opens a document by UUID through the catalog-backed unified opener. */
export async function openDocumentById(id: string): Promise<OpenDocumentResult> {
  const { openDesktopDocument } = await import(
    "@/lib/services/desktop/open-document-desktop"
  )
  return openDesktopDocument({ kind: "id", id })
}

/** Human-readable, non-alarming message for a non-open outcome (no draft). */
export function describeOpenOutcome(result: OpenDocumentResult): string {
  switch (result.status) {
    case "ambiguous":
      return "This file matches more than one document. Pick which one to open."
    case "conflict":
      return "This document has local and cloud changes that conflict. Resolve them before editing."
    case "orphaned":
      return "This document is no longer available on disk or in the cloud."
    case "failed":
      return result.reason
    default:
      return "This document could not be opened."
  }
}
