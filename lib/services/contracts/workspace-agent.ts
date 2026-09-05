import type { ArtifactType, WritingRecord } from "@/lib/services/contracts/document-service"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"
import type { WritingStatus } from "@/lib/writings/status"

export const WORKSPACE_AGENT_ACTIONS = ["read", "write", "move", "edit", "delete"] as const
export type WorkspaceAgentAction = (typeof WORKSPACE_AGENT_ACTIONS)[number]

/**
 * An approval is deliberately part of every tool input. There is no session
 * level trust flag: one approval id authorizes one named action for one
 * resource only.
 */
export type WorkspaceAgentApproval = {
  action: WorkspaceAgentAction
  approvalId: string
  approved: boolean
  approvedAt: string
  resource: string
}

export type WorkspaceAgentDocumentTarget =
  | { documentId: string }
  | { canonicalPath: string }

export type WorkspaceAgentDocument = {
  documentId: string
  canonicalPath: string
  title: string | null
  markdown: string
  catalogRecord: DocumentCatalogRecord
}

export type WorkspaceAgentExecutionReceipt = {
  action: WorkspaceAgentAction
  approvalId: string
  executedAt: string
}

export type WorkspaceAgentReadInput = {
  documentId: string
  approval: WorkspaceAgentApproval
}

export type WorkspaceAgentWriteInput = {
  target: WorkspaceAgentDocumentTarget
  markdown: string
  approval: WorkspaceAgentApproval
}

export type WorkspaceAgentMoveInput = {
  documentId: string
  destinationPath: string
  approval: WorkspaceAgentApproval
}

export type WorkspaceAgentEditInput = {
  documentId: string
  markdown?: string
  metadata?: {
    status?: WritingStatus
    artifactType?: ArtifactType
  }
  approval: WorkspaceAgentApproval
}

export type WorkspaceAgentDeleteInput = {
  documentId: string
  approval: WorkspaceAgentApproval
}

export type WorkspaceAgentMutationResult = {
  document: WorkspaceAgentDocument
  receipt: WorkspaceAgentExecutionReceipt
}

export type WorkspaceAgentReadResult = {
  document: WorkspaceAgentDocument
  receipt: WorkspaceAgentExecutionReceipt
}

export interface WorkspaceAgentToolsService {
  read(input: WorkspaceAgentReadInput): Promise<ServiceResponse<WorkspaceAgentReadResult>>
  write(input: WorkspaceAgentWriteInput): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  move(input: WorkspaceAgentMoveInput): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  edit(input: WorkspaceAgentEditInput): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  delete(input: WorkspaceAgentDeleteInput): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
}

export const WORKSPACE_AGENT_TOOLS_CONTRACT = {
  name: "WorkspaceAgentToolsService",
  summary:
    "Desktop-only read, write, move, edit and delete tools for the Workspace agent, with a one-action approval gate in every call.",
  layer: ["application", "adapter"],
  runtimeScope: ["desktop"],
  owner: "architecture-first",
  invariants: [
    "Every operation receives an action-specific approval in the same call; there is no global trust mode.",
    "A rejected approval performs no filesystem, manifest, catalog or sync mutation.",
    "UUID-to-path resolution always goes through DocumentCatalog before a filesystem adapter is called.",
    "The materialized .md remains the content authority and metadata is never written into frontmatter.",
    "Move and delete preserve the existing catalog identity and use the established desktop write path.",
  ],
  errorEnvelope: "ServiceResponse<T>",
  operations: WORKSPACE_AGENT_ACTIONS.map((name) => ({
    name,
    kind: name === "read" ? "query" : "command",
    summary: `${name} a workspace document after explicit approval for this action`,
    input: ["action-specific WorkspaceAgentApproval"],
    output: ["WorkspaceAgentDocument and execution receipt"],
    errorCodes: ["FORBIDDEN", "INVALID_INPUT", "NOT_FOUND", "STORAGE_ERROR", "UNAVAILABLE"],
  })),
  hotspots: [{
    id: "workspace-agent-approval",
    summary: "Agent proposals are approved per action before the desktop adapter is invoked.",
    layer: ["application", "adapter"],
    runtimeScope: ["desktop"],
    owner: "architecture-first",
    currentEntrypoints: [
      "lib/services/workspace-agent-service.ts",
      "lib/services/desktop/workspace-agent-tools.ts",
    ],
  }],
  requiredDocs: [
    "workflow/context/core/odessay-adr-identidad.md",
    "workflow/context/features/odessay-desktop-document-catalog.md",
    "lib/services/contracts/document-service.ts",
    "lib/queries/document-catalog.ts",
  ],
} as const

export type WorkspaceAgentDocumentMetadataPatch = NonNullable<WorkspaceAgentEditInput["metadata"]>
export type WorkspaceAgentRecord = WritingRecord
