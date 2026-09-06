"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react"
import {
  Archive,
  Bot,
  Check,
  ChevronRight,
  FileText,
  Folder,
  GitCompareArrows,
  Loader2,
  MessageCircle,
  Paperclip,
  Send,
  Sparkles,
  Workflow,
  X,
} from "lucide-react"
import {
  getWorkspaceAgentService,
  type WorkspaceAgentAskRun,
  type WorkspaceAgentCitedDocument,
  type WorkspaceAgentClassificationRun,
  type WorkspaceAgentClassificationRequestedDocument,
  type WorkspaceAgentSelection,
  type WorkspaceAgentService,
} from "@/lib/services/workspace-agent-service"
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
import { MAX_WORKSPACE_CLASSIFICATION_TARGETS } from "@/lib/ai/workspace-classification"
import { MAX_WORKSPACE_ASK_TARGETS } from "@/lib/ai/workspace-ask"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const CHAT_TEXTAREA_MAX_HEIGHT = 160
const MAX_SESSION_ACTIONS_CONTEXT = 8

export type WorkspaceAgentScope =
  | { kind: "document"; id: string }
  | { kind: "workspace"; rootId: string }

export type WorkspaceAgentContextAttachment = {
  kind: "file" | "folder"
  id?: string
  path: string
  label: string
}

export type WorkspaceAgentPanelProps = {
  scope: WorkspaceAgentScope
  workspaceRootPath?: string | null
  scopeLabel?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Opens a document by id (e.g. in a preview) when the user clicks a file the agent cited in chat. */
  onOpenDocument?: (documentId: string) => void
}

/**
 * The structured result of a predetermined action, carried by the chat
 * message that announced it instead of a parallel `useState` per card type.
 * This is what lets the review card render inline, right under the message
 * that produced it, and keeps every past run's card visible in history
 * instead of one run silently overwriting another's UI state.
 */
type ToolResult =
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

type AgentMessage = {
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

/**
 * Chat must never go silent: every submitted question resolves to either an
 * answer or an explicit error, and submitChat always turns this into a chat
 * bubble rather than only a side-panel feedback line the user may not see.
 */
type AskOutcome =
  | { ok: true; run: WorkspaceAgentAskRun; autoSelectedNotice: string | null }
  | { ok: false; message: string }

function createApproval(action: WorkspaceAgentAction, resource: string): WorkspaceAgentApproval {
  const approvalId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${action}-${Date.now()}`
  return {
    action,
    approvalId,
    approved: true,
    approvedAt: new Date().toISOString(),
    resource,
  }
}

function parseAttachment(event: DragEvent<HTMLElement>): WorkspaceAgentContextAttachment | null {
  const raw = event.dataTransfer.getData("application/x-odessay-agent-context") || event.dataTransfer.getData("text/plain")
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceAgentContextAttachment>
    if ((parsed.kind !== "file" && parsed.kind !== "folder") || !parsed.path || !parsed.label) return null
    return {
      kind: parsed.kind,
      id: parsed.id,
      path: parsed.path,
      label: parsed.label,
    }
  } catch {
    return null
  }
}

function uniqueDocumentIds(attachments: WorkspaceAgentContextAttachment[], scope: WorkspaceAgentScope): string[] {
  const ids = attachments
    .filter((attachment): attachment is WorkspaceAgentContextAttachment & { id: string } => attachment.kind === "file" && Boolean(attachment.id))
    .map((attachment) => attachment.id)
  if (scope.kind === "document") ids.unshift(scope.id)
  return [...new Set(ids)]
}

function classificationSelection(
  attachments: WorkspaceAgentContextAttachment[],
  scope: WorkspaceAgentScope,
): WorkspaceAgentSelection[] {
  const selection: WorkspaceAgentSelection[] = []
  if (scope.kind === "document") {
    selection.push({ kind: "file", documentId: scope.id })
  }
  for (const attachment of attachments) {
    selection.push({
      kind: attachment.kind,
      documentId: attachment.id,
      path: attachment.path,
    })
  }
  return selection
}

function workflowNote(proposal: WorkflowDraftProposal): string {
  return proposal.existingDocumentId
    ? "A new workflow.md revision is ready to review below."
    : "A workflow.md draft is ready to review below."
}

function brokenReferencesNote(proposals: BrokenReferenceProposal[]): string {
  return proposals.length === 0
    ? "No broken internal references were found."
    : `${proposals.length} broken reference(s) need review below.`
}

function askChatMessage(run: WorkspaceAgentAskRun): string {
  const additionalContext = run.requestedDocuments.length > 0
    ? ` I could give a more complete answer with: ${run.requestedDocuments.map((document) => document.title).join(", ")}.`
    : ""
  return `${run.answer}${additionalContext}`
}

/**
 * Free-text chat and the Classify action both need a bounded document
 * selection to ground the model. When nothing is explicitly attached and the
 * scope is the whole workspace (not a single open document), fall back to
 * the most recently updated artifacts instead of dead-ending the request.
 */
async function resolveChatSelection(
  attachments: WorkspaceAgentContextAttachment[],
  scope: WorkspaceAgentScope,
  service: WorkspaceAgentService,
  maxTargets: number,
): Promise<
  | { ok: true; selection: WorkspaceAgentSelection[]; autoSelectedNotice: string | null }
  | { ok: false; message: string }
> {
  const selection = classificationSelection(attachments, scope)
  if (selection.length > 0) return { ok: true, selection, autoSelectedNotice: null }
  if (scope.kind !== "workspace") {
    return { ok: false, message: "Attach an artifact or open a document before asking the Workspace agent." }
  }

  const context = await service.getContext()
  if (context.error || !context.data) {
    return { ok: false, message: context.error?.message ?? "Workspace context could not be loaded." }
  }
  const recent = context.data.documents
    .filter((document) => !document.deletedAt && document.id !== context.data.existingWorkflow?.id)
    .sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0))
    .slice(0, maxTargets)
  if (recent.length === 0) {
    return { ok: false, message: "This workspace has no artifacts yet to review." }
  }
  return {
    ok: true,
    selection: recent.map((document) => ({ kind: "file" as const, documentId: document.id })),
    autoSelectedNotice: `No artifact was attached, so I used the ${recent.length} most recently updated artifact(s): ${recent.map((document) => document.title?.trim() || document.binding?.relativePath || document.id).join(", ")}.`,
  }
}

function archiveCandidatesNote(candidates: ArchiveCandidate[]): string {
  return candidates.length === 0
    ? "No stale or duplicate artifacts were found."
    : `${candidates.length} archive candidate(s) need review below.`
}

/** Renders `` `filename.md` `` spans from agent prose as bold text instead of literal backticks. */
/** Maps a document's title, path, and filename to its id so chat citations can be matched back to a real document. */
function buildCitationLookup(documents: WorkspaceAgentCitedDocument[] | undefined): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const document of documents ?? []) {
    const candidates = [document.title, document.path, document.path?.split("/").pop()]
    for (const candidate of candidates) {
      const key = candidate?.trim().toLowerCase()
      if (key) lookup.set(key, document.documentId)
    }
  }
  return lookup
}

function renderMessageText(
  text: string,
  citationLookup: Map<string, string>,
  onOpenDocument?: (documentId: string) => void,
): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      const label = part.slice(1, -1)
      const documentId = citationLookup.get(label.trim().toLowerCase())
      if (documentId && onOpenDocument) {
        return (
          <button
            key={index}
            type="button"
            onClick={() => onOpenDocument(documentId)}
            className="font-semibold text-cursor underline decoration-cursor/40 underline-offset-2 hover:decoration-cursor"
          >
            {label}
          </button>
        )
      }
      return <strong key={index} className="font-semibold text-ink">{label}</strong>
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index} className="font-semibold text-ink">{part.slice(2, -2)}</strong>
    }
    return <span key={index}>{part}</span>
  })
}

function WorkspaceAgentPanelSession({
  scope,
  workspaceRootPath,
  scopeLabel,
  open = true,
  onOpenChange,
  onOpenDocument,
}: WorkspaceAgentPanelProps) {
  const [service, setService] = useState<WorkspaceAgentService | null>(null)
  const [serviceLoading, setServiceLoading] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [attachments, setAttachments] = useState<WorkspaceAgentContextAttachment[]>([])
  const [brokenReferenceReplacements, setBrokenReferenceReplacements] = useState<Record<string, string>>({})
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())
  /** Which message's review card is open in the full-detail modal — same click-to-preview pattern as citations. */
  const [activeReviewMessageId, setActiveReviewMessageId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [chatDraft, setChatDraft] = useState("")
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const hasShownAutoSelectNotice = useRef(false)
  const [isActionsExpanded, setIsActionsExpanded] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  /** A rolling memory of what happened earlier in this session, fed to askAgent so it stays consistent with prior actions and answers. */
  const sessionActionLogRef = useRef<string[]>([])

  const storageKey = `odessay.workspace-agent.resolved.${scope.kind}.${scope.kind === "workspace" ? scope.rootId : scope.id}`

  useEffect(() => {
    if (!open || typeof window === "undefined") return
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored) setResolvedIds(new Set(JSON.parse(stored) as string[]))
    } catch {
      // Local UI memory is optional; a storage failure must not block the panel.
    }
  }, [open, storageKey])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length, busyAction])

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = "auto"
    const nextHeight = Math.min(node.scrollHeight, CHAT_TEXTAREA_MAX_HEIGHT)
    node.style.height = `${nextHeight}px`
    node.style.overflowY = node.scrollHeight > CHAT_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden"
  }, [chatDraft])

  useEffect(() => {
    if (!open || !workspaceRootPath) {
      setService(null)
      setServiceError(null)
      return
    }
    let cancelled = false
    setServiceLoading(true)
    setServiceError(null)
    void getWorkspaceAgentService(workspaceRootPath).then((result) => {
      if (cancelled) return
      if (result.error || !result.data) {
        setServiceError(result.error?.message ?? "The Workspace agent is unavailable.")
      } else {
        setService(result.data)
      }
    }).catch((error: unknown) => {
      if (!cancelled) setServiceError(error instanceof Error ? error.message : "The Workspace agent is unavailable.")
    }).finally(() => {
      if (!cancelled) setServiceLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, workspaceRootPath])

  const hasActiveContradictionReview = useMemo(
    () => messages.some((message) => (
      message.toolResult?.kind === "contradictions"
      && message.toolResult.proposals.some((proposal) => !resolvedIds.has(proposal.id))
    )),
    [messages, resolvedIds],
  )
  const documentIds = useMemo(() => uniqueDocumentIds(attachments, scope), [attachments, scope])
  const canCompare = Boolean(service) && documentIds.length >= 2
  const canClassify = Boolean(service)

  /**
   * A predetermined action (Workflow, Broken links, ...) carries its
   * structured result on the chat message that announced it, so the review
   * card renders inline with the conversation instead of in a separate,
   * disconnected area — and a repeat run adds a new message/card instead of
   * silently overwriting the previous one.
   */
  const pushAgentNote = useCallback((text: string, toolResult?: ToolResult) => {
    setMessages((current) => [...current, { id: `agent-${Date.now()}`, role: "agent", text, toolResult }])
    setFeedback(null)
  }, [])

  const recordSessionAction = useCallback((text: string) => {
    const entries = sessionActionLogRef.current
    entries.push(text.length > 300 ? `${text.slice(0, 300)}…` : text)
    if (entries.length > MAX_SESSION_ACTIONS_CONTEXT) entries.splice(0, entries.length - MAX_SESSION_ACTIONS_CONTEXT)
  }, [])

  /** Announces a predetermined action's outcome in chat and records it as session memory so later questions stay consistent with it. */
  const announceToolResult = useCallback((text: string, toolResult?: ToolResult) => {
    pushAgentNote(text, toolResult)
    recordSessionAction(text)
  }, [pushAgentNote, recordSessionAction])

  /** Immutably updates the `toolResult` carried by one message — used when approving part of a review card. */
  const updateMessageToolResult = useCallback(<K extends ToolResult["kind"]>(
    messageId: string,
    kind: K,
    updater: (toolResult: Extract<ToolResult, { kind: K }>) => ToolResult | null,
  ) => {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId || message.toolResult?.kind !== kind) return message
      const next = updater(message.toolResult as Extract<ToolResult, { kind: K }>)
      return { ...message, toolResult: next ?? undefined }
    }))
  }, [])

  const runAction = useCallback(async (action: string, operation: () => Promise<void>) => {
    setBusyAction(action)
    setFeedback(null)
    try {
      await operation()
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : "The agent action could not be completed.")
    } finally {
      setBusyAction(null)
    }
  }, [])

  const getWorkflowReadApproval = useCallback(async (): Promise<WorkspaceAgentApproval | null | undefined> => {
    if (!service) return null
    const context = await service.getContext()
    if (context.error || !context.data) {
      setFeedback(context.error?.message ?? "Workspace context could not be loaded.")
      return null
    }
    return context.data.existingWorkflow
      ? createApproval("read", context.data.existingWorkflow.id)
      : undefined
  }, [service])

  const runWorkflow = useCallback(() => runAction("workflow", async () => {
    if (!service) return
    const context = await service.getContext()
    if (context.error || !context.data) {
      setFeedback(context.error?.message ?? "Workspace context could not be loaded.")
      return
    }
    const workflowApproval = context.data.existingWorkflow
      ? createApproval("read", context.data.existingWorkflow.id)
      : undefined
    const proposal = await service.proposeWorkflow(workflowApproval)
    if (proposal.error || !proposal.data) {
      setFeedback(proposal.error?.message ?? "Workflow draft could not be generated.")
      return
    }
    announceToolResult(workflowNote(proposal.data), { kind: "workflow", proposal: proposal.data })
  }), [announceToolResult, runAction, service])

  const runBrokenReferences = useCallback(() => runAction("broken-links", async () => {
    if (!service) return
    const workflowReadApproval = await getWorkflowReadApproval()
    if (workflowReadApproval === null) return
    const response = await service.findBrokenReferences(workflowReadApproval)
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "Broken references could not be checked.")
      return
    }
    setBrokenReferenceReplacements({})
    announceToolResult(brokenReferencesNote(response.data), { kind: "broken-links", proposals: response.data })
  }), [announceToolResult, getWorkflowReadApproval, runAction, service])

  const executeClassification = useCallback(async (request: string): Promise<WorkspaceAgentClassificationRun | null> => {
    if (!service) {
      setFeedback("The Workspace agent is not available in this runtime.")
      return null
    }
    const resolved = await resolveChatSelection(attachments, scope, service, MAX_WORKSPACE_CLASSIFICATION_TARGETS)
    if (!resolved.ok) {
      setFeedback(resolved.message)
      return null
    }
    const workflowReadApproval = await getWorkflowReadApproval()
    if (workflowReadApproval === null) return null
    const response = await service.suggestClassification({
      request,
      selection: resolved.selection,
      workflowReadApproval,
    })
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "Classification could not be completed.")
      return null
    }
    const run = resolved.autoSelectedNotice
      ? { ...response.data, summary: `${resolved.autoSelectedNotice} ${response.data.summary}` }
      : response.data
    announceToolResult(
      run.proposals.length === 0 ? run.summary : `${run.summary} See the review below.`,
      {
        kind: "classification",
        summary: run.summary,
        proposals: run.proposals,
        requestedDocumentIds: run.requestedDocumentIds,
        requestedDocuments: run.requestedDocuments,
      },
    )
    if (run.requestedDocumentIds.length > 0) {
      setFeedback("The agent needs more document evidence before it can make a firmer classification.")
    }
    return run
  }, [announceToolResult, attachments, getWorkflowReadApproval, scope, service])

  const executeAsk = useCallback(async (question: string): Promise<AskOutcome> => {
    if (!service) {
      return { ok: false, message: "The Workspace agent is not available in this runtime." }
    }
    const resolved = await resolveChatSelection(attachments, scope, service, MAX_WORKSPACE_ASK_TARGETS)
    if (!resolved.ok) {
      return { ok: false, message: resolved.message }
    }
    const workflowReadApproval = await getWorkflowReadApproval()
    if (workflowReadApproval === null) {
      return { ok: false, message: "Workspace context could not be loaded." }
    }
    const response = await service.askAgent({
      question,
      selection: resolved.selection,
      workflowReadApproval,
      sessionContext: sessionActionLogRef.current.slice(-MAX_SESSION_ACTIONS_CONTEXT),
    })
    if (response.error || !response.data) {
      return { ok: false, message: response.error?.message ?? "The Workspace agent could not answer right now." }
    }
    const autoSelectedNotice = hasShownAutoSelectNotice.current ? null : resolved.autoSelectedNotice
    if (resolved.autoSelectedNotice) hasShownAutoSelectNotice.current = true
    return { ok: true, run: response.data, autoSelectedNotice }
  }, [attachments, getWorkflowReadApproval, scope, service])

  const runClassification = useCallback(() => runAction("classification", async () => {
    await executeClassification("Review these artifacts and propose their type and status with evidence.")
  }), [executeClassification, runAction])

  const runArchiveCandidates = useCallback(() => runAction("archive", async () => {
    if (!service) return
    const workflowReadApproval = await getWorkflowReadApproval()
    if (workflowReadApproval === null) return
    const response = await service.findArchiveCandidates(undefined, workflowReadApproval)
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "Archive candidates could not be checked.")
      return
    }
    announceToolResult(archiveCandidatesNote(response.data), { kind: "archive", candidates: response.data })
  }), [announceToolResult, getWorkflowReadApproval, runAction, service])

  const runContradictions = useCallback(() => runAction("contradictions", async () => {
    if (!service || documentIds.length < 2) {
      setFeedback("Attach at least two artifacts to compare their claims.")
      return
    }
    const readApprovals = Object.fromEntries(documentIds.map((documentId) => [documentId, createApproval("read", documentId)]))
    const workflowReadApproval = await getWorkflowReadApproval()
    if (workflowReadApproval === null) return
    const response = await service.findContradictions(documentIds, readApprovals, workflowReadApproval)
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "Contradictions could not be compared.")
      return
    }
    announceToolResult(
      response.data.length === 0
        ? "No contradictions were found in the selected artifacts."
        : `${response.data.length} contradiction(s) added to the review queue below.`,
      { kind: "contradictions", proposals: response.data },
    )
  }), [announceToolResult, documentIds, getWorkflowReadApproval, runAction, service])

  const applyWorkflow = useCallback((messageId: string, proposal: WorkflowDraftProposal) => runAction("apply-workflow", async () => {
    if (!service) return
    const resource = proposal.existingDocumentId ?? proposal.canonicalPath
    const response = await service.applyWorkflow(proposal, createApproval("write", resource))
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "The workflow draft could not be written.")
      return
    }
    updateMessageToolResult(messageId, "workflow", () => null)
    setFeedback("workflow.md was updated through the approved desktop write path.")
  }), [runAction, service, updateMessageToolResult])

  const applyClassification = useCallback((messageId: string, proposal: ClassificationProposal) => runAction("apply-classification", async () => {
    if (!service) return
    const response = await service.applyClassification(proposal, createApproval("edit", proposal.documentId))
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "The vocabulary classification could not be applied.")
      return
    }
    updateMessageToolResult(messageId, "classification", (toolResult) => ({
      ...toolResult,
      proposals: toolResult.proposals.filter((item) => item.documentId !== proposal.documentId),
    }))
    setFeedback(`Updated ${proposal.documentTitle} through the approved edit path.`)
  }), [runAction, service, updateMessageToolResult])

  const applyArchiveCandidate = useCallback((messageId: string, candidate: ArchiveCandidate) => runAction("apply-archive", async () => {
    if (!service) return
    const response = await service.applyArchiveCandidate(candidate, createApproval("edit", candidate.documentId))
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "The archive candidate could not be updated.")
      return
    }
    updateMessageToolResult(messageId, "archive", (toolResult) => {
      const next = toolResult.candidates.filter((item) => item.documentId !== candidate.documentId)
      return next.length > 0 ? { ...toolResult, candidates: next } : null
    })
    setFeedback(`${candidate.title} was marked with the suggested vocabulary status.`)
  }), [runAction, service, updateMessageToolResult])

  const removeBrokenReferenceProposal = useCallback((messageId: string, proposal: BrokenReferenceProposal) => {
    updateMessageToolResult(messageId, "broken-links", (toolResult) => {
      const next = toolResult.proposals.filter((item) => (
        `${item.sourceDocumentId}:${item.referenceKind}:${item.reference}`
        !== `${proposal.sourceDocumentId}:${proposal.referenceKind}:${proposal.reference}`
      ))
      return next.length > 0 ? { ...toolResult, proposals: next } : null
    })
  }, [updateMessageToolResult])

  const applyBrokenReference = useCallback((messageId: string, proposal: BrokenReferenceProposal) => runAction("apply-broken-link", async () => {
    if (!service) return
    const key = `${messageId}:${proposal.sourceDocumentId}:${proposal.referenceKind}:${proposal.reference}`
    const replacement = (brokenReferenceReplacements[key] ?? proposal.suggestedReference ?? "").trim()
    if (!replacement) {
      setFeedback("Enter a replacement reference before approving this fix.")
      return
    }
    const response = await service.applyBrokenReference(proposal, replacement, {
      read: createApproval("read", proposal.sourceDocumentId),
      edit: createApproval("edit", proposal.sourceDocumentId),
    })
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "The broken reference could not be fixed.")
      return
    }
    removeBrokenReferenceProposal(messageId, proposal)
    setBrokenReferenceReplacements((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setFeedback(`Updated ${proposal.sourceTitle} through the approved edit path.`)
  }), [brokenReferenceReplacements, removeBrokenReferenceProposal, runAction, service])

  const removeBrokenReference = useCallback((messageId: string, proposal: BrokenReferenceProposal) => runAction("remove-broken-link", async () => {
    if (!service) return
    const response = await service.removeBrokenReference(proposal, {
      read: createApproval("read", proposal.sourceDocumentId),
      edit: createApproval("edit", proposal.sourceDocumentId),
    })
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "The broken reference could not be removed.")
      return
    }
    removeBrokenReferenceProposal(messageId, proposal)
    setFeedback(`Removed the link from ${proposal.sourceTitle} through the approved edit path.`)
  }), [removeBrokenReferenceProposal, runAction, service])

  const createDocumentForBrokenReference = useCallback((messageId: string, proposal: BrokenReferenceProposal) => runAction("create-broken-link-doc", async () => {
    if (!service) return
    const response = await service.createDocumentForBrokenReference(proposal, createApproval("write", proposal.reference))
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "The new document could not be created.")
      return
    }
    removeBrokenReferenceProposal(messageId, proposal)
    setFeedback(`Created ${response.data.document.title ?? proposal.reference} through the approved write path.`)
  }), [removeBrokenReferenceProposal, runAction, service])

  const persistResolvedIds = useCallback((next: Set<string>) => {
    setResolvedIds(next)
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]))
      } catch {
        // Local persistence is a convenience for close/reopen, not a source of truth.
      }
    }
  }, [storageKey])

  const resolveContradiction = useCallback((proposal: ContradictionProposal, resolution: "left" | "right" | "discard") => runAction("resolve", async () => {
    if (!service) return
    const target = resolution === "left" ? proposal.right : proposal.left
    const approvals = resolution === "discard"
      ? undefined
      : {
          read: createApproval("read", target.documentId),
          edit: createApproval("edit", target.documentId),
        }
    const response = await service.resolveContradiction(proposal, resolution, approvals)
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "This contradiction could not be resolved.")
      return
    }
    const next = new Set(resolvedIds)
    next.add(proposal.id)
    persistResolvedIds(next)
    setFeedback(resolution === "discard" ? "Finding discarded from this review queue." : "The selected evidence was applied to the target artifact.")
  }), [persistResolvedIds, resolvedIds, runAction, service])

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDropTarget(false)
    const attachment = parseAttachment(event)
    if (!attachment) return
    setAttachments((current) => {
      if (current.some((item) => item.path === attachment.path && item.kind === attachment.kind)) return current
      return [...current, attachment]
    })
    setFeedback(`${attachment.label} added as agent context.`)
  }, [])

  const submitChat = useCallback(() => {
    const text = chatDraft.trim()
    if (!text) return
    const messageAttachments = attachments.map((attachment) => ({ ...attachment }))
    const messageTimestamp = Date.now()
    setMessages((current) => [
      ...current,
      { id: `user-${messageTimestamp}`, role: "user", text, attachments: messageAttachments.length > 0 ? messageAttachments : undefined },
    ])
    setChatDraft("")
    setIsActionsExpanded(false)
    void runAction("ask", async () => {
      // Chat must never go silent: whatever happens, exactly one agent bubble
      // is appended — the answer, a handled error, or an unexpected one.
      let outcome: AskOutcome
      try {
        outcome = await executeAsk(text)
      } catch (thrown) {
        outcome = { ok: false, message: thrown instanceof Error ? thrown.message : "The Workspace agent could not answer right now." }
      }
      setMessages((current) => [
        ...current,
        outcome.ok
          ? {
              id: `agent-${messageTimestamp + 1}`,
              role: "agent",
              text: askChatMessage(outcome.run),
              note: outcome.autoSelectedNotice,
              citedDocuments: outcome.run.documents,
            }
          : {
              id: `agent-${messageTimestamp + 1}`,
              role: "agent",
              text: outcome.message,
              isError: true,
            },
      ])
      if (outcome.ok) {
        recordSessionAction(`Q: ${text}\nA: ${outcome.run.answer}`)
      }
    })
  }, [attachments, chatDraft, executeAsk, recordSessionAction, runAction])

  if (!open) {
    return (
      <button
        type="button"
        data-testid="workspace-agent-rail"
        aria-label="Open Workspace agent"
        onClick={() => onOpenChange?.(true)}
        className="flex h-full min-h-0 w-9 shrink-0 items-center justify-center border-l-[0.5px] border-border bg-muted/70 text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink"
      >
        <Bot className="h-4 w-4" strokeWidth={1.5} />
      </button>
    )
  }

  return (
    <aside
      data-testid="workspace-agent-panel"
      data-section="workspace-agent-panel"
      data-scope={scope.kind}
      data-scope-id={scope.kind === "workspace" ? scope.rootId : scope.id}
      onDragEnter={() => setIsDropTarget(true)}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={handleDrop}
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col border-l-[0.5px] border-border bg-muted/70 font-sans",
        hasActiveContradictionReview ? "w-[344px]" : "w-[276px]",
        isDropTarget && "bg-surface-selected/80",
      )}
    >
      <header className="flex h-[46px] shrink-0 items-center gap-2 border-b-[0.5px] border-border bg-muted/35 px-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-muted text-ink-3">
          <Bot className="h-[15px] w-[15px]" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-ink">Workspace agent</p>
          <p className="truncate text-[10px] text-ink-4">{scopeLabel ?? (scope.kind === "workspace" ? "Workspace context" : "Current artifact")}</p>
        </div>
        <button
          type="button"
          aria-label="Close Workspace agent"
          onClick={() => onOpenChange?.(false)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted-hover hover:text-ink"
        >
          <X className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </button>
      </header>

      <div className="od-scroll max-h-[38vh] shrink-0 overflow-y-auto border-b-[0.5px] border-border/70 px-3 py-3">
        {messages.length === 0 ? (
          <div className="rounded-[9px] border-[0.5px] border-border bg-bg/70 px-2.5 py-2.5">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cursor" strokeWidth={1.5} />
              <p className="text-[11px] leading-[1.45] text-ink-3">
                Add artifacts here to give the agent focused context. Drops work anywhere in this panel.
              </p>
            </div>
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="mt-3 space-y-1.5" data-testid="workspace-agent-context">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-4">Context</p>
              <span className="text-[10px] text-ink-4">{attachments.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <span key={`${attachment.kind}:${attachment.path}`} className="inline-flex max-w-full items-center gap-1 rounded-[6px] border-[0.5px] border-border bg-bg/80 px-1.5 py-1 text-[10px] text-ink-3">
                  {attachment.kind === "folder" ? <Folder className="h-3 w-3 shrink-0" strokeWidth={1.5} /> : <FileText className="h-3 w-3 shrink-0" strokeWidth={1.5} />}
                  <span className="truncate">{attachment.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.label}`}
                    onClick={() => setAttachments((current) => current.filter((item) => item.path !== attachment.path))}
                    className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-ink-4 hover:text-ink"
                  >
                    <X className="h-2.5 w-2.5" strokeWidth={1.5} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4">
          <button
            type="button"
            onClick={() => setIsActionsExpanded((current) => !current)}
            aria-expanded={isActionsExpanded}
            className="mb-2 flex w-full items-center justify-between text-left"
          >
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-4">
              <ChevronRight className={cn("h-3 w-3 transition-transform", isActionsExpanded && "rotate-90")} strokeWidth={1.5} />
              Actions
            </span>
            {serviceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-4" strokeWidth={1.5} /> : null}
          </button>
          {isActionsExpanded ? (
            <div className="grid grid-cols-2 gap-1.5">
              <AgentActionButton icon={<Workflow />} label="Workflow" busy={busyAction === "workflow"} disabled={!service} onClick={() => void runWorkflow()} />
              <AgentActionButton icon={<GitCompareArrows />} label="Compare" busy={busyAction === "contradictions"} disabled={!canCompare} onClick={() => void runContradictions()} />
              <AgentActionButton icon={<MessageCircle />} label="Broken links" busy={busyAction === "broken-links"} disabled={!service} onClick={() => void runBrokenReferences()} />
              <AgentActionButton icon={<Sparkles />} label="Classify" busy={busyAction === "classification"} disabled={!canClassify} onClick={() => void runClassification()} />
              <AgentActionButton icon={<Archive />} label="Archive" busy={busyAction === "archive"} disabled={!service} onClick={() => void runArchiveCandidates()} />
            </div>
          ) : null}
        </div>

        {serviceError ? <p className="mt-3 rounded-[8px] border-[0.5px] border-border bg-bg px-2.5 py-2 text-[11px] leading-[1.45] text-ink-3">{serviceError}</p> : null}
        {!workspaceRootPath ? <p className="mt-3 text-[10.5px] leading-[1.45] text-ink-4">Open this artifact from a desktop Workspace to run local agent actions.</p> : null}
        {feedback ? <p className="mt-3 text-[11px] leading-[1.45] text-ink-3" role="status">{feedback}</p> : null}

      </div>

      <section
        className="od-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3"
        aria-label="Agent conversation"
        data-testid="workspace-agent-chat"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
            <Bot className="h-5 w-5 text-ink-4" strokeWidth={1.5} />
            <p className="text-[12px] leading-[1.45] text-ink-4">Ask anything about this workspace or the open artifact.</p>
          </div>
        ) : messages.map((message) => {
          const toolResult = message.toolResult
          return (
            <div key={message.id} className={cn("flex flex-col", message.role === "user" ? "items-end" : "items-start")}>
              {message.note ? (
                <details className="group mb-1 max-w-[90%]">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] text-ink-4 hover:text-ink-3">
                    <ChevronRight className="h-2.5 w-2.5 shrink-0 transition-transform group-open:rotate-90" strokeWidth={1.5} />
                    <Sparkles className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} />
                    <span>Context used</span>
                  </summary>
                  <p className="mt-1 pl-4 text-[10.5px] italic leading-[1.4] text-ink-4" data-testid="workspace-agent-message-note">{message.note}</p>
                </details>
              ) : null}
              <div className={cn(
                "text-[13px] leading-[1.6]",
                message.role === "user"
                  ? "max-w-[90%] rounded-[10px] bg-ink px-3 py-2 text-bg"
                  : message.isError
                    ? "max-w-[90%] rounded-[10px] border-[0.5px] border-danger-border bg-danger-surface px-3 py-2 text-cursor"
                    : "w-full px-0.5 py-1 text-ink",
              )}>
                <p className="whitespace-pre-wrap">{renderMessageText(message.text, buildCitationLookup(message.citedDocuments), onOpenDocument)}</p>
                {message.attachments?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1" data-testid="workspace-agent-message-context" aria-label="Message context">
                    {message.attachments.map((attachment) => (
                      <span key={`${attachment.kind}:${attachment.path}`} className="inline-flex max-w-full items-center gap-1 rounded-[5px] border-[0.5px] border-border/70 bg-bg/50 px-1.5 py-1 text-[9px] text-ink-3">
                        {attachment.kind === "folder" ? <Folder className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} /> : <FileText className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} />}
                        <span className="truncate">{attachment.label}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              {toolResult ? (
                <ReviewSummaryRow
                  toolResult={toolResult}
                  resolvedIds={resolvedIds}
                  onOpen={() => setActiveReviewMessageId(message.id)}
                />
              ) : null}
            </div>
          )
        })}

        {busyAction === "ask" ? (
          <div className="flex items-start" data-testid="workspace-agent-thinking">
            <div className="rounded-[10px] border-[0.5px] border-border bg-bg px-3 py-2.5">
              <span className="flex items-center gap-1" aria-label="Thinking">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4" />
              </span>
            </div>
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </section>

      <form
        className="shrink-0 border-t-[0.5px] border-border bg-muted/35 p-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          submitChat()
        }}
      >
        <div className="flex flex-col gap-1.5 rounded-[10px] border-[0.5px] border-border bg-bg/80 px-2.5 py-2 focus-within:border-ink-3">
          <textarea
            ref={textareaRef}
            value={chatDraft}
            onChange={(event) => setChatDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                submitChat()
              }
            }}
            placeholder="Ask about this context…"
            rows={1}
            className="min-h-6 w-full resize-none bg-transparent text-[13px] leading-[1.5] text-ink outline-none placeholder:text-ink-4"
            style={{ maxHeight: CHAT_TEXTAREA_MAX_HEIGHT }}
            aria-label="Message Workspace agent"
          />
          <div className="flex items-center justify-between">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-4" strokeWidth={1.5} />
            <button type="submit" aria-label="Send message" disabled={!chatDraft.trim()} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-ink text-bg transition-opacity disabled:opacity-30">
              <Send className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </form>

      <WorkspaceAgentReviewModal
        message={messages.find((message) => message.id === activeReviewMessageId) ?? null}
        busyAction={busyAction}
        brokenReferenceReplacements={brokenReferenceReplacements}
        onReplacementChange={(key, value) => setBrokenReferenceReplacements((current) => ({ ...current, [key]: value }))}
        resolvedIds={resolvedIds}
        onClose={() => setActiveReviewMessageId(null)}
        onApplyWorkflow={applyWorkflow}
        onApplyClassification={applyClassification}
        onApplyArchiveCandidate={applyArchiveCandidate}
        onApplyBrokenReference={applyBrokenReference}
        onRemoveBrokenReference={removeBrokenReference}
        onCreateDocumentForBrokenReference={createDocumentForBrokenReference}
        onResolveContradiction={(proposal, resolution) => void resolveContradiction(proposal, resolution)}
      />
    </aside>
  )
}

export function WorkspaceAgentPanel(props: WorkspaceAgentPanelProps) {
  const scopeKey = props.scope.kind === "workspace"
    ? `workspace:${props.scope.rootId}`
    : `document:${props.scope.id}`

  return <WorkspaceAgentPanelSession key={scopeKey} {...props} />
}

function AgentActionButton({
  icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[7px] border-[0.5px] border-border px-1.5 text-[10px] text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} /> : <span className="[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0 [&>svg]:stroke-[1.5]">{icon}</span>}
      {label}
    </button>
  )
}

/**
 * Compact, clickable row for a predetermined action's result — the chat
 * surface. Clicking it opens the full-detail modal for decision-making,
 * the same click-to-preview pattern already used for cited documents.
 */
function ReviewSummaryRow({
  toolResult,
  resolvedIds,
  onOpen,
}: {
  toolResult: ToolResult
  resolvedIds: Set<string>
  onOpen: () => void
}) {
  const summary = (() => {
    switch (toolResult.kind) {
      case "workflow":
        return {
          icon: <Workflow className="h-3.5 w-3.5 shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "workflow.md draft",
          subtitle: toolResult.proposal.existingDocumentId ? "Revision ready to review" : "New draft ready to review",
          testId: "workspace-agent-workflow-review",
        }
      case "broken-links":
        return toolResult.proposals.length === 0 ? null : {
          icon: <MessageCircle className="h-3.5 w-3.5 shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "Broken references",
          subtitle: `${toolResult.proposals.length} to review`,
          testId: "workspace-agent-broken-links-review",
        }
      case "classification": {
        const actionable = toolResult.proposals.length > 0 || toolResult.requestedDocumentIds.length > 0
        return !actionable ? null : {
          icon: <Sparkles className="h-3.5 w-3.5 shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "Semantic classification",
          subtitle: toolResult.requestedDocumentIds.length > 0 ? "Needs more evidence" : `${toolResult.proposals.length} proposal(s)`,
          testId: "workspace-agent-classification-review",
        }
      }
      case "archive":
        return toolResult.candidates.length === 0 ? null : {
          icon: <Archive className="h-3.5 w-3.5 shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "Archive candidate",
          subtitle: toolResult.candidates[0].title,
          testId: "workspace-agent-archive-review",
        }
      case "contradictions": {
        const activeCount = toolResult.proposals.filter((proposal) => !resolvedIds.has(proposal.id)).length
        return activeCount === 0 ? null : {
          icon: <GitCompareArrows className="h-3.5 w-3.5 shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "Contradiction queue",
          subtitle: `${activeCount} finding(s) to resolve`,
          testId: "workspace-agent-review-queue",
        }
      }
    }
  })()
  if (!summary) return null

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={summary.testId}
      className="mt-2 flex w-full items-center gap-2 rounded-[10px] border-[0.5px] border-border bg-bg px-2.5 py-2 text-left transition-colors hover:bg-muted-hover"
    >
      {summary.icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-ink">{summary.title}</p>
        <p className="truncate text-[10px] text-ink-4">{summary.subtitle}</p>
      </div>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-4" strokeWidth={1.5} />
    </button>
  )
}

function WorkflowReviewBody({
  proposal,
  busy,
  onApprove,
}: {
  proposal: WorkflowDraftProposal
  busy: boolean
  onApprove: () => void
}) {
  return (
    <div>
      <pre className="od-scroll max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-[8px] border-[0.5px] border-border/70 bg-bg/80 p-2.5 text-[11px] leading-[1.5] text-ink-3">{proposal.markdown}</pre>
      <button type="button" disabled={busy} onClick={onApprove} className="mt-3 inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-[7px] bg-ink px-2 text-[11px] font-medium text-bg transition-colors hover:bg-ink/90 disabled:opacity-50">
        <Check className="h-3.5 w-3.5" strokeWidth={1.5} /> Approve workflow update
      </button>
    </div>
  )
}

function ClassificationReviewBody({
  toolResult,
  busy,
  onApprove,
}: {
  toolResult: Extract<ToolResult, { kind: "classification" }>
  busy: boolean
  onApprove: (proposal: ClassificationProposal) => void
}) {
  return (
    <div>
      {toolResult.summary ? <p className="text-[12px] leading-[1.5] text-ink-3">{toolResult.summary}</p> : null}
      {toolResult.requestedDocumentIds.length > 0 ? (
        <p className="mt-2 rounded-[8px] border-[0.5px] border-border/70 bg-surface-selected px-2.5 py-2 text-[11px] leading-[1.45] text-ink-3">
          Needs {toolResult.requestedDocumentIds.length} additional catalog document(s) to reduce uncertainty. Attach them to continue.
          {toolResult.requestedDocuments.length > 0 ? (
            <span className="mt-1 block text-ink-4">
              {toolResult.requestedDocuments.map((document) => document.path ?? document.title).join(" · ")}
            </span>
          ) : null}
        </p>
      ) : null}
      {toolResult.proposals.length === 0 ? (
        <p className="mt-2 rounded-[8px] bg-muted px-2.5 py-2 text-[11px] leading-[1.45] text-ink-4">
          No metadata change is ready. The agent needs more evidence before making a responsible classification.
        </p>
      ) : null}
      <div className="mt-3 space-y-3">
        {toolResult.proposals.map((proposal) => (
          <article key={proposal.documentId} className="rounded-[9px] border-[0.5px] border-border/70 bg-bg/80 p-2.5" data-testid={`workspace-agent-classification-${proposal.documentId}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11.5px] font-medium text-ink">{proposal.documentTitle}</p>
                {proposal.documentPath ? <p className="truncate font-mono text-[9.5px] text-ink-4">{proposal.documentPath}</p> : null}
              </div>
              <span className={cn(
                "shrink-0 rounded-[5px] px-1.5 py-0.5 text-[8.5px] font-medium uppercase tracking-[0.06em]",
                proposal.decision === "change" ? "bg-success-tint text-success" : "bg-muted text-ink-4",
              )}>
                {proposal.decision === "change" ? "Proposed" : proposal.decision === "keep" ? "Keep" : "Review"}
              </span>
            </div>
            <p className="mt-2 text-[11.5px] leading-[1.5] text-ink">{proposal.change}</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <div className="rounded-[7px] bg-muted/70 px-2 py-1.5">
                <p className="text-[8.5px] font-medium uppercase tracking-[0.08em] text-ink-4">Current</p>
                <p className="mt-1 text-[10.5px] leading-[1.4] text-ink-3">{proposal.currentArtifactType ?? "No type"} · {proposal.currentStatus ?? "No status"}</p>
              </div>
              <div className="rounded-[7px] bg-surface-selected px-2 py-1.5">
                <p className="text-[8.5px] font-medium uppercase tracking-[0.08em] text-ink-4">Proposed</p>
                <p className="mt-1 text-[10.5px] leading-[1.4] text-ink-3">{proposal.artifactType ?? "No type"} · {proposal.status ?? "No status"}</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-[1.45] text-ink-3"><span className="font-medium text-ink">Why:</span> {proposal.reason}</p>
            <p className="mt-1 text-[11px] leading-[1.45] text-ink-3"><span className="font-medium text-ink">Benefit:</span> {proposal.benefit}</p>
            {proposal.uncertainty ? <p className="mt-1 text-[11px] leading-[1.45] text-ink-4"><span className="font-medium text-ink-3">Uncertainty:</span> {proposal.uncertainty}</p> : null}
            {proposal.evidence.length > 0 ? (
              <div className="mt-2 space-y-1">
                <p className="text-[8.5px] font-medium uppercase tracking-[0.08em] text-ink-4">Evidence</p>
                {proposal.evidence.map((evidence) => (
                  <div key={`${evidence.sourceId}:${evidence.line ?? "unknown"}:${evidence.quote ?? evidence.detail}`} className="rounded-[7px] border-[0.5px] border-border/70 bg-bg px-2 py-1.5 text-[10.5px] leading-[1.45] text-ink-3">
                    {evidence.quote ? <p className="font-lora italic text-ink">“{evidence.quote}”</p> : null}
                    <p className={evidence.quote ? "mt-0.5 text-ink-4" : "text-ink-3"}>{evidence.detail}</p>
                  </div>
                ))}
              </div>
            ) : <p className="mt-2 text-[10.5px] text-ink-4">No exact evidence could be verified for this proposal.</p>}
            {proposal.decision === "change" ? (
              <button type="button" disabled={busy} onClick={() => onApprove(proposal)} className="mt-2.5 inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-[7px] bg-ink px-2 text-[11px] font-medium text-bg transition-colors hover:bg-ink/90 disabled:opacity-50">
                <Check className="h-3.5 w-3.5" strokeWidth={1.5} /> Approve metadata change
              </button>
            ) : (
              <p className="mt-2.5 rounded-[7px] bg-muted px-2 py-1.5 text-[10.5px] leading-[1.4] text-ink-4">
                {proposal.decision === "keep" ? "No metadata change recommended." : "No change is available until the uncertainty is resolved."}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

function ArchiveReviewBody({
  candidate,
  busy,
  onApprove,
}: {
  candidate: ArchiveCandidate
  busy: boolean
  onApprove: () => void
}) {
  return (
    <div>
      <p className="text-[12px] font-medium text-ink-3">{candidate.title}</p>
      <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-4">{candidate.reason}</p>
      <button type="button" disabled={busy || !candidate.suggestedStatus} onClick={onApprove} className="mt-3 inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-[7px] bg-ink px-2 text-[11px] font-medium text-bg transition-colors hover:bg-ink/90 disabled:opacity-50">
        <Check className="h-3.5 w-3.5" strokeWidth={1.5} /> Approve archive status
      </button>
    </div>
  )
}

function BrokenLinksReviewBody({
  messageId,
  proposals,
  busy,
  busyAction,
  replacements,
  onReplacementChange,
  onApprove,
  onRemove,
  onCreate,
}: {
  messageId: string
  proposals: BrokenReferenceProposal[]
  busy: boolean
  busyAction: string | null
  replacements: Record<string, string>
  onReplacementChange: (key: string, value: string) => void
  onApprove: (proposal: BrokenReferenceProposal) => void
  onRemove: (proposal: BrokenReferenceProposal) => void
  onCreate: (proposal: BrokenReferenceProposal) => void
}) {
  return (
    <div className="space-y-3">
      {proposals.map((proposal) => {
        const key = `${messageId}:${proposal.sourceDocumentId}:${proposal.referenceKind}:${proposal.reference}`
        const isSlug = proposal.referenceKind === "slug"
        return (
          <div key={key} className="rounded-[9px] border-[0.5px] border-border/70 bg-bg/80 p-2.5">
            <p className="text-[9.5px] font-medium uppercase tracking-[0.08em] text-ink-4">In {proposal.sourceTitle}</p>
            <p className="mt-1.5 text-[12px] leading-[1.55] text-ink">
              Broken {isSlug ? "reference" : "link"} to{" "}
              <span className="rounded-[4px] bg-danger-surface px-1 py-0.5 font-mono text-[11px] text-cursor">{proposal.reference}</span>
              {" — "}this {isSlug ? "reference" : "document"} doesn&apos;t exist in the workspace.
            </p>
            {proposal.candidateTitle ? (
              <p className="mt-1.5 text-[11px] leading-[1.4] text-ink-3">Closest match: <span className="font-medium text-ink">{proposal.candidateTitle}</span></p>
            ) : null}

            <label className="mt-2.5 block text-[9.5px] font-medium uppercase tracking-[0.08em] text-ink-4">
              Point it to
              <input
                value={replacements[key] ?? proposal.suggestedReference ?? ""}
                onChange={(event) => onReplacementChange(key, event.target.value)}
                placeholder={isSlug ? "slug" : "path/to/document.md"}
                aria-label={`Replacement for ${proposal.reference}`}
                className="mt-1 h-8 w-full rounded-[7px] border-[0.5px] border-border bg-bg px-2 text-[11px] font-normal normal-case tracking-normal text-ink outline-none placeholder:text-ink-4 focus:border-ink-3"
              />
            </label>
            <button
              type="button"
              disabled={busy || !(replacements[key] ?? proposal.suggestedReference ?? "").trim()}
              onClick={() => onApprove(proposal)}
              className="mt-1.5 inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-[7px] bg-ink px-2 text-[11px] font-medium text-bg transition-colors hover:bg-ink/90 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.5} /> Point to this document
            </button>

            <div className="mt-1.5 flex items-center gap-1.5">
              {!isSlug ? (
                <button
                  type="button"
                  disabled={busyAction === "create-broken-link-doc"}
                  onClick={() => onCreate(proposal)}
                  className="inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-[7px] border-[0.5px] border-border px-2 text-[10.5px] font-medium text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink disabled:opacity-50"
                >
                  <FileText className="h-3.5 w-3.5" strokeWidth={1.5} /> Create as new document
                </button>
              ) : null}
              <button
                type="button"
                disabled={busyAction === "remove-broken-link"}
                onClick={() => onRemove(proposal)}
                className="inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-[7px] border-[0.5px] border-border px-2 text-[10.5px] font-medium text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} /> Remove this link
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const REVIEW_MODAL_TITLES: Record<ToolResult["kind"], string> = {
  workflow: "Review workflow.md",
  classification: "Semantic classification",
  archive: "Archive candidate",
  "broken-links": "Broken references",
  contradictions: "Contradiction queue",
}

/**
 * Full-detail modal for a predetermined action's result, opened by clicking
 * its compact chat card — the same click-to-preview pattern
 * `onOpenDocument`/`WritingPreviewModal` already use for cited documents.
 * Approving here still executes through the same approval-gated tools calls
 * as before; the modal only changes where the decision gets made.
 */
function WorkspaceAgentReviewModal({
  message,
  busyAction,
  brokenReferenceReplacements,
  onReplacementChange,
  resolvedIds,
  onClose,
  onApplyWorkflow,
  onApplyClassification,
  onApplyArchiveCandidate,
  onApplyBrokenReference,
  onRemoveBrokenReference,
  onCreateDocumentForBrokenReference,
  onResolveContradiction,
}: {
  message: AgentMessage | null
  busyAction: string | null
  brokenReferenceReplacements: Record<string, string>
  onReplacementChange: (key: string, value: string) => void
  resolvedIds: Set<string>
  onClose: () => void
  onApplyWorkflow: (messageId: string, proposal: WorkflowDraftProposal) => void
  onApplyClassification: (messageId: string, proposal: ClassificationProposal) => void
  onApplyArchiveCandidate: (messageId: string, candidate: ArchiveCandidate) => void
  onApplyBrokenReference: (messageId: string, proposal: BrokenReferenceProposal) => void
  onRemoveBrokenReference: (messageId: string, proposal: BrokenReferenceProposal) => void
  onCreateDocumentForBrokenReference: (messageId: string, proposal: BrokenReferenceProposal) => void
  onResolveContradiction: (proposal: ContradictionProposal, resolution: "left" | "right" | "discard") => void
}) {
  const toolResult = message?.toolResult
  const open = Boolean(message && toolResult)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        data-testid="workspace-agent-review-modal"
        className="max-h-[calc(100vh-80px)] w-[520px] max-w-[calc(100vw-40px)] overflow-y-auto font-sans"
      >
        {message && toolResult ? (
          <>
            <DialogTitle>{REVIEW_MODAL_TITLES[toolResult.kind]}</DialogTitle>
            <div className="mt-1">
              {toolResult.kind === "workflow" ? (
                <WorkflowReviewBody
                  proposal={toolResult.proposal}
                  busy={busyAction === "apply-workflow"}
                  onApprove={() => onApplyWorkflow(message.id, toolResult.proposal)}
                />
              ) : null}
              {toolResult.kind === "classification" ? (
                <ClassificationReviewBody
                  toolResult={toolResult}
                  busy={busyAction === "apply-classification"}
                  onApprove={(proposal) => onApplyClassification(message.id, proposal)}
                />
              ) : null}
              {toolResult.kind === "archive" && toolResult.candidates.length > 0 ? (
                <ArchiveReviewBody
                  candidate={toolResult.candidates[0]}
                  busy={busyAction === "apply-archive"}
                  onApprove={() => onApplyArchiveCandidate(message.id, toolResult.candidates[0])}
                />
              ) : null}
              {toolResult.kind === "broken-links" ? (
                <BrokenLinksReviewBody
                  messageId={message.id}
                  proposals={toolResult.proposals}
                  busy={busyAction === "apply-broken-link"}
                  busyAction={busyAction}
                  replacements={brokenReferenceReplacements}
                  onReplacementChange={onReplacementChange}
                  onApprove={(proposal) => onApplyBrokenReference(message.id, proposal)}
                  onRemove={(proposal) => onRemoveBrokenReference(message.id, proposal)}
                  onCreate={(proposal) => onCreateDocumentForBrokenReference(message.id, proposal)}
                />
              ) : null}
              {toolResult.kind === "contradictions" ? (
                <ContradictionReviewCard
                  proposals={toolResult.proposals}
                  resolvedIds={resolvedIds}
                  busy={busyAction === "resolve"}
                  onResolve={onResolveContradiction}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/**
 * One review per Compare run's message, always showing the first
 * unresolved proposal — the queue advances on its own as resolvedIds grows.
 */
function ContradictionReviewCard({
  proposals,
  resolvedIds,
  busy,
  onResolve,
}: {
  proposals: ContradictionProposal[]
  resolvedIds: Set<string>
  busy: boolean
  onResolve: (proposal: ContradictionProposal, resolution: "left" | "right" | "discard") => void
}) {
  const active = proposals.filter((proposal) => !resolvedIds.has(proposal.id))
  const current = active[0] ?? null
  if (!current) return null

  return (
    <div data-testid="workspace-agent-review-queue">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.1em] text-ink-4">{current.topic}</p>
        <span className="shrink-0 text-[10px] text-ink-4">1 / {active.length}</span>
      </div>
      <EvidenceCard
        title={current.left.title}
        text={current.left.fragment.text}
        line={current.left.fragment.line}
        updatedAt={current.left.updatedAt}
        suggested={current.suggestedDocumentId === current.left.documentId}
      />
      <EvidenceCard
        title={current.right.title}
        text={current.right.fragment.text}
        line={current.right.fragment.line}
        updatedAt={current.right.updatedAt}
        suggested={current.suggestedDocumentId === current.right.documentId}
      />
      <div className="mt-2 flex items-center gap-1.5">
        <button type="button" disabled={busy} onClick={() => onResolve(current, "left")} className="inline-flex min-h-7 flex-1 items-center justify-center gap-1 rounded-[6px] bg-ink px-2 text-[10px] font-medium text-bg transition-colors hover:bg-ink/90 disabled:opacity-50">
          <Check className="h-3 w-3" strokeWidth={1.5} /> Use left
        </button>
        <button type="button" disabled={busy} onClick={() => onResolve(current, "right")} className="inline-flex min-h-7 flex-1 items-center justify-center gap-1 rounded-[6px] border-[0.5px] border-border px-2 text-[10px] font-medium text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink disabled:opacity-50">
          <Check className="h-3 w-3" strokeWidth={1.5} /> Use right
        </button>
      </div>
      <button type="button" disabled={busy} onClick={() => onResolve(current, "discard")} className="mt-1.5 inline-flex h-6 w-full items-center justify-center text-[10px] text-ink-4 hover:text-ink disabled:opacity-50">Discard finding</button>
    </div>
  )
}

function EvidenceCard({
  title,
  text,
  line,
  updatedAt,
  suggested = false,
}: {
  title: string
  text: string
  line: number
  updatedAt: string
  suggested?: boolean
}) {
  return (
    <div className="mt-2 rounded-[7px] border-[0.5px] border-border/70 bg-bg/80 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-[10px] font-medium text-ink-3">{title}</p>
          {suggested ? <span className="shrink-0 rounded-[4px] bg-muted px-1 py-0.5 text-[8px] font-medium text-cursor">Suggested</span> : null}
        </div>
        <span className="shrink-0 text-[9px] text-ink-4">line {line} · {updatedAt.slice(0, 10)}</span>
      </div>
      <p className="mt-1 text-[10.5px] leading-[1.4] text-ink">{text}</p>
    </div>
  )
}
