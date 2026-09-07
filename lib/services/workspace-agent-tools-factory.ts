import { getDocumentCatalog } from "@/lib/services/document-catalog-factory"
import {
  getDocumentService,
  importDesktopWritingFile,
  relocateDesktopWriting,
} from "@/lib/services/document-service-factory"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { tauriValidateWorkspaceAgentPath } from "@/lib/services/desktop/tauri-commands"
import {
  createDesktopWorkspaceAgentToolsService,
  type DesktopWorkspaceAgentToolsService,
} from "@/lib/services/desktop/workspace-agent-tools"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"

export async function getWorkspaceAgentToolsService(
  workspaceRootPath: string,
): Promise<ServiceResponse<DesktopWorkspaceAgentToolsService>> {
  if (!isDesktopRuntime()) {
    return {
      data: null,
      error: { code: "UNSUPPORTED", message: "Workspace agent tools require the desktop runtime.", retryable: false },
    }
  }
  const [catalog, documentService] = await Promise.all([getDocumentCatalog(), getDocumentService()])
  return {
    data: createDesktopWorkspaceAgentToolsService(workspaceRootPath, {
      catalog,
      documentService,
      importDocument: importDesktopWritingFile,
      relocateDocument: relocateDesktopWriting,
      validatePath: tauriValidateWorkspaceAgentPath,
    }),
    error: null,
  }
}
