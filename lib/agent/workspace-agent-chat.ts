import type {
  ArchiveCandidate,
  BrokenReferenceProposal,
  ClassificationProposal,
  ContradictionProposal,
  WorkflowDraftProposal,
} from "@/lib/agent/workspace-agent-analysis"
import type {
  WorkspaceAgentAction,
  WorkspaceAgentApproval,
} from "@/lib/services/contracts/workspace-agent"
import type {
  WorkspaceAgentCitedDocument,
  WorkspaceAgentClassificationRequestedDocument,
  WorkspaceAgentService,
} from "@/lib/services/workspace-agent-service"
import type { MergeReviewToolResult } from "@/components/agent/workspace-agent-review-merge"

export type WorkspaceAgentContextAttachment = {
  kind: "file" | "folder"
  id?: string
  path: string
  label: string
}

/**
 * The structured result of a predetermined action, carried by the chat
 * message that announced it instead of a parallel `useState` per card type
 * (ODE-491). This is what lets the review card render inline, right under
 * the message that produced it, and keeps every past run's card visible in
 * history instead of one run silently overwriting another's UI state.
 */
export type ToolResult =
  | { kind: "workflow"; proposal: WorkflowDraftProposal }
  | { kind: "broken-links"; proposals: BrokenReferenceProposal[] }
  | {
      kind: "classification"
      summary: string
      proposals: ClassificationProposal[]
      requestedDocumentIds: string[]
      requestedDocuments: WorkspaceAgentClassificationRequestedDocument[]
    }
  | { kind: "archive"; candidates: ArchiveCandidate[] }
  | { kind: "contradictions"; proposals: ContradictionProposal[] }
  | { kind: "merge"; merge: MergeReviewToolResult }

export type AgentMessage = {
  id: string
  role: "user" | "agent"
  text: string
  attachments?: WorkspaceAgentContextAttachment[]
  /** A short processing note (e.g. which artifacts were auto-selected), rendered separately from the answer itself. */
  note?: string | null
  isError?: boolean
  /** Documents the model could see while answering, used to turn `` `filename` `` mentions into open-document links. */
  citedDocuments?: WorkspaceAgentCitedDocument[]
  /** The predetermined action's result, if this message announced one. */
  toolResult?: ToolResult
}

let messageSequence = 0

/**
 * A timestamp alone can collide when two messages are created in the same
 * millisecond (e.g. two predetermined actions run back to back); a stray
 * counter closes that gap so every message id stays unique, and running the
 * same action twice always produces two distinct history entries instead of
 * one silently colliding with (and being mistaken for) the other.
 */
export function createAgentMessageId(prefix: "user" | "agent"): string {
  messageSequence += 1
  return `${prefix}-${Date.now()}-${messageSequence}`
}

export function createToolResultMessage(text: string, toolResult?: ToolResult, id?: string): AgentMessage {
  return { id: id ?? createAgentMessageId("agent"), role: "agent", text, toolResult }
}

export function createApproval(action: WorkspaceAgentAction, resource: string): WorkspaceAgentApproval {
  const approvalId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${action}-${resource}-${Date.now()}`
  return {
    action,
    approvalId,
    approved: true,
    approvedAt: new Date().toISOString(),
    resource,
  }
}

/**
 * Approving a review card always executes a tool through the existing
 * approval-gated edit/write path (ODE-491's principle 2) — never the LLM
 * again. These wrappers are the single place that pairs each review card
 * kind with its action and resource, so the modal's "approve" buttons and
 * the tests that cover them share the same logic.
 */
export function approveWorkflowDraft(service: WorkspaceAgentService, proposal: WorkflowDraftProposal) {
  const resource = proposal.existingDocumentId ?? proposal.canonicalPath
  return service.applyWorkflow(proposal, createApproval("write", resource))
}

export function approveClassificationProposal(service: WorkspaceAgentService, proposal: ClassificationProposal) {
  return service.applyClassification(proposal, createApproval("edit", proposal.documentId))
}

export function approveArchiveCandidate(service: WorkspaceAgentService, candidate: ArchiveCandidate) {
  return service.applyArchiveCandidate(candidate, createApproval("edit", candidate.documentId))
}
