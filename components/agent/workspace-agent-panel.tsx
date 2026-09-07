"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlertCircle,
  Archive,
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CornerDownLeft,
  FileText,
  Folder,
  GitCompareArrows,
  Link2Off,
  Loader2,
  Merge as MergeIcon,
  MessageCircle,
  Paperclip,
  PanelRightOpen,
  PictureInPicture2,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Workflow,
  X,
  Zap,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  askAboutDocument,
  getWorkspaceAgentService,
  type WorkspaceAgentAskRun,
  type WorkspaceAgentCitedDocument,
  type WorkspaceAgentClassificationRun,
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
  WorkspaceAgentApproval,
} from "@/lib/services/contracts/workspace-agent"
import { MAX_WORKSPACE_CLASSIFICATION_TARGETS } from "@/lib/ai/workspace-classification"
import { MAX_WORKSPACE_ASK_TARGETS } from "@/lib/ai/workspace-ask"
import {
  approveArchiveCandidate,
  approveClassificationProposal,
  approveWorkflowDraft,
  createApproval,
  createToolResultMessage,
  type AgentMessage,
  type ToolResult,
  type WorkspaceAgentContextAttachment,
  type WorkspaceAgentMessageContext,
} from "@/lib/agent/workspace-agent-chat"
import { useWorkspaceAgentDropZone, type WorkspaceAgentDragPayload } from "@/components/agent/workspace-agent-drag"
import {
  ReviewShellCancelButton,
  ReviewShellPrimaryButton,
  WorkspaceAgentReviewShell,
} from "@/components/agent/workspace-agent-review-shell"
import { WorkflowReviewBody } from "@/components/agent/workspace-agent-review-workflow"
import {
  BrokenLinksReviewBody,
  type WorkspaceAgentSearchableDocument,
} from "@/components/agent/workspace-agent-review-links"
import { ClassificationReviewBody } from "@/components/agent/workspace-agent-review-classify"
import { ArchiveReviewBody } from "@/components/agent/workspace-agent-review-archive"
import { ContradictionReviewCard } from "@/components/agent/workspace-agent-review-contradict"
import { buildMergeMock, MergeReviewBody } from "@/components/agent/workspace-agent-review-merge"
import { cn } from "@/lib/utils"

const CHAT_TEXTAREA_MAX_HEIGHT = 160
const MAX_SESSION_ACTIONS_CONTEXT = 8

export type WorkspaceAgentScope =
  | { kind: "document"; id: string }
  | { kind: "workspace"; rootId: string }

export type { WorkspaceAgentContextAttachment }

export type WorkspaceAgentDocumentSnapshot = {
  documentId: string
  title: string | null
  markdown: string
}

export type WorkspaceAgentPanelProps = {
  scope: WorkspaceAgentScope
  workspaceRootPath?: string | null
  scopeLabel?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Opens a document by id (e.g. in a preview) when the user clicks a file the agent cited in chat. */
  onOpenDocument?: (documentId: string) => void
  /**
   * Returns the current Writing's live content (id, title, markdown) on
   * demand, read straight from the editor in memory. Chat falls back to
   * this — no Workspace, BindingRoot, or filesystem needed — whenever no
   * Workspace is available: an unmaterialized draft, or a Writing outside
   * any visible Workspace (ODE-490). Predetermined actions still require a
   * real Workspace `service` and stay disabled without one.
   */
  getDocumentSnapshot?: () => WorkspaceAgentDocumentSnapshot | null
}

export type { ToolResult, AgentMessage }

/**
 * Chat must never go silent: every submitted question resolves to either an
 * answer or an explicit error, and submitChat always turns this into a chat
 * bubble rather than only a side-panel feedback line the user may not see.
 */
type AskOutcome =
  | { ok: true; run: WorkspaceAgentAskRun; autoSelectedNotice: string | null }
  | { ok: false; message: string }

/**
 * Snapshots which Writing/Workspace a message is being produced against.
 * Called with the scope/label/root captured by whichever closure is
 * currently running (ODE-502) — a workflow started against Writing A keeps
 * pointing at Writing A even if the caller's own render was recreated for
 * Writing B in the meantime, because JS closures freeze their bindings at
 * creation, not at call time.
 */
function buildMessageContext(
  scope: WorkspaceAgentScope,
  scopeLabel: string | null | undefined,
  workspaceRootPath: string | null | undefined,
): WorkspaceAgentMessageContext {
  return {
    scopeKind: scope.kind,
    scopeId: scope.kind === "workspace" ? scope.rootId : scope.id,
    scopeLabel: scopeLabel ?? null,
    workspaceRootPath: workspaceRootPath ?? null,
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

/**
 * These build the deterministic, factual bullets handed to the presentation
 * stage (ODE-491) — the LLM call only decides how to phrase them in the
 * conversation's language/tone, it never adds to or drops from this list.
 */
function workflowFacts(proposal: WorkflowDraftProposal): string[] {
  return [proposal.existingDocumentId
    ? "A new workflow.md revision is ready to review below."
    : "A workflow.md draft is ready to review below."]
}

function brokenReferencesFacts(proposals: BrokenReferenceProposal[]): string[] {
  return [proposals.length === 0
    ? "No broken internal references were found."
    : `${proposals.length} broken reference(s) need review below.`]
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

function archiveCandidatesFacts(candidates: ArchiveCandidate[]): string[] {
  return [candidates.length === 0
    ? "No stale or duplicate artifacts were found."
    : `${candidates.length} archive candidate(s) need review below.`]
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
  getDocumentSnapshot,
}: WorkspaceAgentPanelProps) {
  const [service, setService] = useState<WorkspaceAgentService | null>(null)
  const [serviceLoading, setServiceLoading] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
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
  const [actionsOpen, setActionsOpen] = useState(false)
  const [dockMode, setDockMode] = useState<"sidebar" | "float">("sidebar")
  const [attachPickerOpen, setAttachPickerOpen] = useState(false)
  const [attachPickerQuery, setAttachPickerQuery] = useState("")
  const [workspaceDocuments, setWorkspaceDocuments] = useState<WorkspaceAgentSearchableDocument[] | null>(null)
  const [reviewCursor, setReviewCursor] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  /** A rolling memory of what happened earlier in this session, fed to askAgent so it stays consistent with prior actions and answers. */
  const sessionActionLogRef = useRef<string[]>([])

  const storageKey = `odessay.workspace-agent.resolved.${scope.kind}.${scope.kind === "workspace" ? scope.rootId : scope.id}`
  const dockStorageKey = "odessay.workspace-agent.dock-mode"

  useEffect(() => {
    if (!open || typeof window === "undefined") return
    // The session no longer remounts on scope change (ODE-502), so this must
    // explicitly reset to empty for a scope with no stored ids instead of
    // leaving the previous scope's set in place.
    try {
      const stored = window.localStorage.getItem(storageKey)
      setResolvedIds(stored ? new Set(JSON.parse(stored) as string[]) : new Set())
    } catch {
      // Local UI memory is optional; a storage failure must not block the panel.
      setResolvedIds(new Set())
    }
  }, [open, storageKey])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const stored = window.localStorage.getItem(dockStorageKey)
      if (stored === "sidebar" || stored === "float") setDockMode(stored)
    } catch {
      // Anchoring preference is a convenience, not a source of truth.
    }
  }, [])

  const setDockModePersisted = useCallback((mode: "sidebar" | "float") => {
    setDockMode(mode)
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(dockStorageKey, mode)
    } catch {
      // Anchoring preference is a convenience, not a source of truth.
    }
  }, [])

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
    const context = buildMessageContext(scope, scopeLabel, workspaceRootPath)
    setMessages((current) => [...current, createToolResultMessage(text, toolResult, undefined, context)])
    setFeedback(null)
  }, [scope, scopeLabel, workspaceRootPath])

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
    const note = await service.presentNote("workflow", workflowFacts(proposal.data), sessionActionLogRef.current)
    announceToolResult(note, { kind: "workflow", proposal: proposal.data })
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
    const note = await service.presentNote("broken-links", brokenReferencesFacts(response.data), sessionActionLogRef.current)
    announceToolResult(note, { kind: "broken-links", proposals: response.data })
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
    const classificationFacts = [
      run.summary,
      run.proposals.length > 0 ? "The proposals are ready to review below." : null,
    ].filter((fact): fact is string => Boolean(fact))
    const note = await service.presentNote("classification", classificationFacts, sessionActionLogRef.current)
    announceToolResult(
      note,
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
      // No Workspace to ground the full evidence-driven pipeline in — an
      // unmaterialized draft, or a Writing outside any visible Workspace.
      // The chat must still work: fall back to the current document's live
      // content directly, with no filesystem/catalog involved (ODE-490).
      const snapshot = getDocumentSnapshot?.()
      if (!snapshot) {
        return { ok: false, message: "The Workspace agent is not available in this runtime." }
      }
      const response = await askAboutDocument({
        question,
        documentId: snapshot.documentId,
        title: snapshot.title,
        markdown: snapshot.markdown,
        sessionContext: sessionActionLogRef.current.slice(-MAX_SESSION_ACTIONS_CONTEXT),
      })
      if (response.error || !response.data) {
        return { ok: false, message: response.error?.message ?? "The Workspace agent could not answer right now." }
      }
      return { ok: true, run: response.data, autoSelectedNotice: null }
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
  }, [attachments, getDocumentSnapshot, getWorkflowReadApproval, scope, service])

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
    const note = await service.presentNote("archive", archiveCandidatesFacts(response.data), sessionActionLogRef.current)
    announceToolResult(note, { kind: "archive", candidates: response.data })
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
    const contradictionFacts = [
      response.data.length === 0
        ? "No contradictions were found in the selected artifacts."
        : `${response.data.length} contradiction(s) added to the review queue below.`,
    ]
    const note = await service.presentNote("contradictions", contradictionFacts, sessionActionLogRef.current)
    announceToolResult(note, { kind: "contradictions", proposals: response.data })
  }), [announceToolResult, documentIds, getWorkflowReadApproval, runAction, service])

  /**
   * Merge (Fase H) — UI-only mock: reads the real markdown of the attached
   * documents through the same approval-gated read tool other actions use,
   * then builds the combined-document preview client-side (no merge tool
   * exists on the backend yet). "Crear el documento" stays disabled in the
   * body for that reason.
   */
  const runMerge = useCallback(() => runAction("merge", async () => {
    if (!service || documentIds.length < 2) {
      setFeedback("Attach at least two artifacts to combine them.")
      return
    }
    const targets = documentIds.slice(0, 4)
    const sources: { documentId: string; title: string; markdown: string }[] = []
    for (const documentId of targets) {
      const response = await service.tools.read({ documentId, approval: createApproval("read", documentId) })
      if (response.error || !response.data) {
        setFeedback(response.error?.message ?? "One of the attached artifacts could not be read.")
        return
      }
      sources.push({
        documentId,
        title: response.data.document.title?.trim() || response.data.document.canonicalPath.split("/").pop() || documentId,
        markdown: response.data.document.markdown,
      })
    }
    const merge = buildMergeMock(sources)
    const mergeFacts = [`Combined ${sources.length} artifacts into a ${merge.sections.length}-section draft (preview only).`]
    const note = await service.presentNote("merge", mergeFacts, sessionActionLogRef.current)
    announceToolResult(note, { kind: "merge", merge })
  }), [announceToolResult, documentIds, runAction, service])

  /**
   * Data-driven catalog for the Actions popover — one entry per predetermined
   * action, in the exact order/copy the design handoff specifies. "Merge" has
   * no backend yet (mock-only, see workspace-agent-review-merge.tsx once
   * built) so it stays disabled here until that lands.
   */
  const agentActionCatalog = useMemo(() => ([
    {
      key: "workflow",
      label: "Workflow",
      description: "Coordina los documentos del workspace en un plan de trabajo.",
      icon: <Workflow className="h-[17px] w-[17px] text-ink-4" strokeWidth={1.5} />,
      disabled: !service,
      busy: busyAction === "workflow",
      onRun: () => { setActionsOpen(false); void runWorkflow() },
    },
    {
      key: "compare",
      label: "Compare",
      description: "Requiere dos artifacts seleccionados en la lista.",
      icon: <GitCompareArrows className="h-[17px] w-[17px] text-ink-5" strokeWidth={1.5} />,
      disabled: true,
      busy: false,
      onRun: () => {},
    },
    {
      key: "broken-links",
      label: "Broken links",
      description: "Revisa referencias entre artifacts y rutas locales.",
      icon: <Link2Off className="h-[17px] w-[17px] text-ink-4" strokeWidth={1.5} />,
      disabled: !service,
      busy: busyAction === "broken-links",
      onRun: () => { setActionsOpen(false); void runBrokenReferences() },
    },
    {
      key: "classify",
      label: "Classify",
      description: "Asigna status y tipo según el contenido de cada archivo.",
      icon: <Sparkles className="h-[17px] w-[17px] text-[#5B5BD6]" strokeWidth={1.5} />,
      disabled: !canClassify,
      busy: busyAction === "classification",
      onRun: () => { setActionsOpen(false); void runClassification() },
    },
    {
      key: "contradictions",
      label: "Contradictions",
      description: "Cruza un grupo de documentos y marca las ideas que se contraponen.",
      icon: <AlertCircle className="h-[17px] w-[17px] text-cursor" strokeWidth={1.5} />,
      disabled: !canCompare,
      busy: busyAction === "contradictions",
      onRun: () => { setActionsOpen(false); void runContradictions() },
    },
    {
      key: "merge",
      label: "Merge",
      description: "Propone una estructura única y reparte qué parte aporta cada documento.",
      icon: <MergeIcon className="h-[17px] w-[17px] text-ink-4" strokeWidth={1.5} />,
      disabled: !canCompare,
      busy: busyAction === "merge",
      onRun: () => { setActionsOpen(false); void runMerge() },
    },
    {
      key: "archive",
      label: "Archive",
      description: "Propone candidatos sin cambios en las últimas semanas.",
      icon: <Archive className="h-[17px] w-[17px] text-ink-4" strokeWidth={1.5} />,
      disabled: !service,
      busy: busyAction === "archive",
      onRun: () => { setActionsOpen(false); void runArchiveCandidates() },
    },
  ]), [busyAction, canClassify, canCompare, runArchiveCandidates, runBrokenReferences, runClassification, runContradictions, runMerge, runWorkflow, service])

  const applyWorkflow = useCallback((messageId: string, proposal: WorkflowDraftProposal) => runAction("apply-workflow", async () => {
    if (!service) return
    const response = await approveWorkflowDraft(service, proposal)
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "The workflow draft could not be written.")
      return
    }
    updateMessageToolResult(messageId, "workflow", () => null)
    setFeedback("workflow.md was updated through the approved desktop write path.")
  }), [runAction, service, updateMessageToolResult])

  /** Discards a workflow draft without writing anything — nothing was applied, so this is purely local UI state. */
  const discardWorkflow = useCallback((messageId: string) => {
    updateMessageToolResult(messageId, "workflow", () => null)
    setFeedback("Workflow draft discarded.")
  }, [updateMessageToolResult])

  const applyClassification = useCallback((messageId: string, proposal: ClassificationProposal) => runAction("apply-classification", async () => {
    if (!service) return
    const response = await approveClassificationProposal(service, proposal)
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

  /** Applies a batch of classification proposals sequentially (each through the same approval-gated edit path) — the Fase E bulk "Aplicar los N cambios" footer. */
  const applyClassificationMany = useCallback((messageId: string, proposals: ClassificationProposal[]) => runAction("apply-classification", async () => {
    if (!service || proposals.length === 0) return
    const appliedIds = new Set<string>()
    let failure: string | null = null
    for (const proposal of proposals) {
      const response = await approveClassificationProposal(service, proposal)
      if (response.error || !response.data) {
        failure = response.error?.message ?? `${proposal.documentTitle} could not be updated.`
        break
      }
      appliedIds.add(proposal.documentId)
    }
    if (appliedIds.size > 0) {
      updateMessageToolResult(messageId, "classification", (toolResult) => ({
        ...toolResult,
        proposals: toolResult.proposals.filter((item) => !appliedIds.has(item.documentId)),
      }))
    }
    setFeedback(failure ?? `Updated ${appliedIds.size} artifact(s) through the approved edit path.`)
  }), [runAction, service, updateMessageToolResult])

  const applyArchiveCandidate = useCallback((messageId: string, candidate: ArchiveCandidate) => runAction("apply-archive", async () => {
    if (!service) return
    const response = await approveArchiveCandidate(service, candidate)
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

  /** Applies a batch of archive candidates sequentially — the Fase F bulk "Aplicar los N cambios" footer. */
  const applyArchiveCandidateMany = useCallback((messageId: string, candidates: ArchiveCandidate[]) => runAction("apply-archive", async () => {
    if (!service || candidates.length === 0) return
    const appliedIds = new Set<string>()
    let failure: string | null = null
    for (const candidate of candidates) {
      const response = await approveArchiveCandidate(service, candidate)
      if (response.error || !response.data) {
        failure = response.error?.message ?? `${candidate.title} could not be updated.`
        break
      }
      appliedIds.add(candidate.documentId)
    }
    if (appliedIds.size > 0) {
      updateMessageToolResult(messageId, "archive", (toolResult) => {
        const next = toolResult.candidates.filter((item) => !appliedIds.has(item.documentId))
        return next.length > 0 ? { ...toolResult, candidates: next } : null
      })
    }
    setFeedback(failure ?? `Updated ${appliedIds.size} artifact(s) with their suggested vocabulary status.`)
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

  const handleAgentDrop = useCallback((attachment: WorkspaceAgentDragPayload) => {
    setAttachments((current) => {
      if (current.some((item) => item.path === attachment.path && item.kind === attachment.kind)) return current
      return [...current, attachment]
    })
    setFeedback(`${attachment.label} added as agent context.`)
  }, [])
  const { ref: composerDropZoneRef, isOver: isDropTarget } = useWorkspaceAgentDropZone(handleAgentDrop)

  // The cache below is scoped to a Workspace, not to a Writing — a tab
  // switch inside the same Workspace must not force a refetch (ODE-502), but
  // moving to a different Workspace (a different `service`/root) must not
  // keep serving the previous Workspace's document list either.
  useEffect(() => {
    setWorkspaceDocuments(null)
  }, [workspaceRootPath])

  /** Lazily loads the workspace's documents once — backs both the attach popover and the Broken links "Apuntar a" search. */
  const ensureWorkspaceDocuments = useCallback(() => {
    if (!service || workspaceDocuments !== null) return
    void service.getContext().then((result) => {
      if (result.error || !result.data) return
      setWorkspaceDocuments(result.data.documents.map((document) => ({
        id: document.id,
        title: document.title?.trim() || document.binding?.relativePath || document.id,
        path: document.binding?.relativePath ?? undefined,
      })))
    })
  }, [service, workspaceDocuments])

  const openAttachPicker = useCallback(() => {
    setAttachPickerOpen(true)
    ensureWorkspaceDocuments()
  }, [ensureWorkspaceDocuments])

  const attachDocument = useCallback((document: WorkspaceAgentSearchableDocument) => {
    setAttachments((current) => {
      if (current.some((item) => item.kind === "file" && item.id === document.id)) return current
      return [...current, { kind: "file", id: document.id, path: document.path ?? document.id, label: document.title }]
    })
    setAttachPickerOpen(false)
    setAttachPickerQuery("")
  }, [])

  /**
   * The only explicit way to end a session (ODE-502) — everything else
   * (switching tabs, the Workspace container changing, a runtime losing the
   * agent capability) must leave history, draft, attachments and pending
   * review state untouched. `service` and the workspace document cache are
   * kept: they're runtime/workspace-scoped, not session-scoped.
   */
  const startNewConversation = useCallback(() => {
    setMessages([])
    setChatDraft("")
    setAttachments([])
    setBrokenReferenceReplacements({})
    setActiveReviewMessageId(null)
    setFeedback(null)
    setReviewCursor(0)
    setActionsOpen(false)
    sessionActionLogRef.current = []
  }, [])

  const submitChat = useCallback(() => {
    const text = chatDraft.trim()
    if (!text) return
    const messageAttachments = attachments.map((attachment) => ({ ...attachment }))
    const messageTimestamp = Date.now()
    // Frozen at submit time — the turn stays anchored to the Writing/Workspace
    // the question was actually asked from, even if the user switches tabs
    // before the answer comes back (ODE-502).
    const turnContext = buildMessageContext(scope, scopeLabel, workspaceRootPath)
    setMessages((current) => [
      ...current,
      { id: `user-${messageTimestamp}`, role: "user", text, attachments: messageAttachments.length > 0 ? messageAttachments : undefined, context: turnContext },
    ])
    setChatDraft("")
    setActionsOpen(false)
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
              context: turnContext,
            }
          : {
              id: `agent-${messageTimestamp + 1}`,
              role: "agent",
              text: outcome.message,
              isError: true,
              context: turnContext,
            },
      ])
      if (outcome.ok) {
        recordSessionAction(`Q: ${text}\nA: ${outcome.run.answer}`)
      }
    })
  }, [attachments, chatDraft, executeAsk, recordSessionAction, runAction, scope, scopeLabel, workspaceRootPath])

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

  const isFloat = dockMode === "float"

  const header = (
    <header className={cn("flex h-[52px] shrink-0 items-center gap-2.5 border-b-[0.5px] border-border bg-sb pl-4 pr-2.5", isFloat && "cursor-grab")}>
      <Bot className="h-5 w-5 shrink-0 text-[#5B5BD6]" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-[1.2] text-ink">Workspace agent</p>
        <p className="mt-0.5 truncate font-mono text-[11px] leading-[1.2] text-ink-4">{scopeLabel ?? (scope.kind === "workspace" ? "Workspace context" : "Current artifact")}</p>
      </div>
      <button
        type="button"
        title="New conversation"
        aria-label="New conversation"
        onClick={startNewConversation}
        disabled={messages.length === 0}
        data-testid="workspace-agent-new-conversation"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-ink-4 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-4"
      >
        <Plus className="h-[17px] w-[17px]" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        title="Anclar como sidebar"
        aria-label="Anclar como sidebar"
        aria-pressed={dockMode === "sidebar"}
        onClick={() => setDockModePersisted("sidebar")}
        data-testid="workspace-agent-dock-sidebar"
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition-colors",
          dockMode === "sidebar" ? "bg-surface-selected text-ink" : "text-ink-4 hover:bg-muted hover:text-ink",
        )}
      >
        <PanelRightOpen className="h-[17px] w-[17px]" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        title="Ventana flotante"
        aria-label="Ventana flotante"
        aria-pressed={dockMode === "float"}
        onClick={() => setDockModePersisted("float")}
        data-testid="workspace-agent-dock-float"
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition-colors",
          dockMode === "float" ? "bg-surface-selected text-ink" : "text-ink-4 hover:bg-muted hover:text-ink",
        )}
      >
        <PictureInPicture2 className="h-[17px] w-[17px]" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Close Workspace agent"
        onClick={() => onOpenChange?.(false)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
      >
        <X className="h-[17px] w-[17px]" strokeWidth={1.5} />
      </button>
    </header>
  )

  const chatSection = (
    <section
      className="od-scroll min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4"
      aria-label="Agent conversation"
      data-testid="workspace-agent-chat"
    >
      {serviceError ? <p className="rounded-[9px] border-[0.5px] border-border bg-bg px-2.5 py-2 text-[11px] leading-[1.45] text-ink-3">{serviceError}</p> : null}
      {!workspaceRootPath ? <p className="text-[11px] leading-[1.45] text-ink-4">Open this artifact from a desktop Workspace to run local agent actions.</p> : null}
      {feedback ? <p className="text-[11px] leading-[1.45] text-ink-3" role="status">{feedback}</p> : null}

      {messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
          {serviceLoading ? <Loader2 className="h-5 w-5 animate-spin text-ink-4" strokeWidth={1.5} /> : <Bot className="h-5 w-5 text-ink-4" strokeWidth={1.5} />}
          <p className="text-[12px] leading-[1.45] text-ink-4">Ask anything about this workspace or the open artifact.</p>
        </div>
      ) : messages.map((message) => {
        const toolResult = message.toolResult
        const messageScopeId = message.context?.scopeId
        const currentScopeId = scope.kind === "workspace" ? scope.rootId : scope.id
        // A message keeps the label of the Writing/Workspace it was actually
        // produced against; only show it once the user has since moved
        // elsewhere, so old turns aren't silently re-read as belonging here.
        const fromOtherScope = Boolean(messageScopeId) && messageScopeId !== currentScopeId
        return (
          <div key={message.id} className={cn("flex flex-col", message.role === "user" ? "items-end" : "items-start")}>
            {fromOtherScope && message.context?.scopeLabel ? (
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-5" data-testid="workspace-agent-message-scope">
                {message.context.scopeLabel}
              </p>
            ) : null}
            {message.note ? (
              <details className="group mb-1 max-w-[90%]">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-ink-4 hover:text-ink-3">
                  <Sparkles className="h-[15px] w-[15px] shrink-0 text-[#5B5BD6]" strokeWidth={1.5} />
                  <span>Contexto usado</span>
                  <ChevronRight className="h-[15px] w-[15px] shrink-0 text-ink-5 transition-transform group-open:rotate-90" strokeWidth={1.5} />
                </summary>
                <p className="mt-2 text-[12px] italic leading-[1.5] text-ink-4" data-testid="workspace-agent-message-note">{message.note}</p>
              </details>
            ) : null}
            <div className={cn(
              "text-[13px] leading-[1.6]",
              message.role === "user"
                ? "max-w-[80%] rounded-[12px] bg-muted-hover px-3.5 py-2.5 text-ink"
                : message.isError
                  ? "max-w-[90%] rounded-[10px] border-[0.5px] border-danger-border bg-danger-surface px-3 py-2 text-cursor"
                  : "w-full px-0 py-0.5 text-ink",
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
                onOpen={() => { setReviewCursor(0); setActiveReviewMessageId(message.id) }}
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
      <p className="mt-auto text-[11px] leading-[1.5] text-ink-5">Las respuestas las genera un modelo. Nada se modifica sin tu confirmación.</p>
      <div ref={messagesEndRef} />
    </section>
  )

  const composer = (
    <form
      className="relative shrink-0 px-3.5 pb-3"
      onSubmit={(event) => {
        event.preventDefault()
        submitChat()
      }}
    >
      <div
        ref={composerDropZoneRef}
        className={cn(
          "relative rounded-[14px] bg-sb p-3 shadow-[0_1px_2px_rgba(35,24,15,0.05)] transition-colors",
          isDropTarget ? "border border-dashed border-[#5B5BD6]" : "border-[0.5px] border-border",
        )}
      >
        {attachments.length > 0 ? (
          <div className="mb-2.5 flex flex-wrap gap-1.5" data-testid="workspace-agent-context">
            {attachments.map((attachment) => (
              <span key={`${attachment.kind}:${attachment.path}`} className="inline-flex h-[26px] max-w-full items-center gap-1.5 rounded-[7px] bg-muted pl-2 pr-1.5 text-[12px] text-ink-2">
                {attachment.kind === "folder" ? <Folder className="h-3.5 w-3.5 shrink-0 text-ink-4" strokeWidth={1.5} /> : <FileText className="h-3.5 w-3.5 shrink-0 text-ink-4" strokeWidth={1.5} />}
                <span className="max-w-[150px] truncate">{attachment.label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.label}`}
                  onClick={() => setAttachments((current) => current.filter((item) => item.path !== attachment.path))}
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] text-ink-4 transition-colors hover:bg-border hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
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
          placeholder="Pregunta sobre este contexto…"
          rows={1}
          className="min-h-[56px] w-full resize-none bg-transparent pr-6 text-[13.5px] leading-[1.55] text-ink outline-none placeholder:text-ink-5"
          style={{ maxHeight: CHAT_TEXTAREA_MAX_HEIGHT }}
          aria-label="Message Workspace agent"
        />
        {isDropTarget ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-[14px] bg-[rgba(250,250,248,0.92)]">
            <span className="h-[17px] w-[17px] rounded-full bg-[#5B5BD6]" />
            <span className="text-[12.5px] font-medium text-ink">Suelta para adjuntarlo al contexto</span>
          </div>
        ) : null}
        <CornerDownLeft className="pointer-events-none absolute bottom-[10px] right-3 h-4 w-4 text-border" strokeWidth={1.5} />
      </div>

      <div className="mt-2 flex items-center gap-0.5">
        <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Acciones del agente"
              data-testid="workspace-agent-actions-trigger"
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-[12px] transition-colors",
                actionsOpen ? "bg-surface-selected text-ink" : "text-ink-3 hover:bg-muted hover:text-ink",
              )}
            >
              <Zap className="h-[17px] w-[17px]" strokeWidth={1.5} />
              Acciones
              {actionsOpen ? <ChevronDown className="h-[15px] w-[15px]" strokeWidth={1.5} /> : <ChevronUp className="h-[15px] w-[15px]" strokeWidth={1.5} />}
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" sideOffset={8} className="w-[280px] max-w-[280px] p-2" data-testid="workspace-agent-actions-popover">
            <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Acciones del agente</p>
            <div className="flex flex-col">
              {agentActionCatalog.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  disabled={action.disabled || action.busy}
                  onClick={action.onRun}
                  data-testid={`workspace-agent-action-${action.key}`}
                  className={cn(
                    "flex items-start gap-2.5 rounded-[9px] px-2.5 py-2.5 text-left transition-colors",
                    action.disabled ? "cursor-default opacity-55" : "cursor-pointer hover:bg-[#FAFAF8]",
                  )}
                >
                  {action.icon}
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium text-ink">{action.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-[1.4] text-ink-4">{action.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={attachPickerOpen} onOpenChange={setAttachPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Attach a document"
              title="Attach a document"
              onClick={openAttachPicker}
              className="flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-ink-3 transition-colors hover:bg-muted hover:text-ink"
            >
              <Paperclip className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" sideOffset={8} className="w-[280px] max-w-[280px] p-2">
            <input
              autoFocus
              value={attachPickerQuery}
              onChange={(event) => setAttachPickerQuery(event.target.value)}
              placeholder="Buscar un artifact…"
              className="mb-1.5 h-8 w-full rounded-[8px] border-[0.5px] border-border bg-bg px-2.5 text-[12px] text-ink outline-none placeholder:text-ink-5"
            />
            <div className="od-scroll max-h-[220px] overflow-y-auto">
              {workspaceDocuments === null ? (
                <p className="px-2 py-2 text-[11px] text-ink-4">Loading…</p>
              ) : workspaceDocuments.filter((document) => document.title.toLowerCase().includes(attachPickerQuery.trim().toLowerCase())).length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-ink-4">No documents found.</p>
              ) : (
                workspaceDocuments
                  .filter((document) => document.title.toLowerCase().includes(attachPickerQuery.trim().toLowerCase()))
                  .slice(0, 30)
                  .map((document) => (
                    <button
                      key={document.id}
                      type="button"
                      onClick={() => attachDocument(document)}
                      className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left transition-colors hover:bg-muted"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-ink-4" strokeWidth={1.5} />
                      <span className="min-w-0 truncate text-[12px] text-ink">{document.title}</span>
                    </button>
                  ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </form>
  )

  const reviewModal = (
    <WorkspaceAgentReviewModal
      message={messages.find((message) => message.id === activeReviewMessageId) ?? null}
      busyAction={busyAction}
      brokenReferenceReplacements={brokenReferenceReplacements}
      onReplacementChange={(key, value) => setBrokenReferenceReplacements((current) => ({ ...current, [key]: value }))}
      resolvedIds={resolvedIds}
      onClose={() => setActiveReviewMessageId(null)}
      onApplyWorkflow={applyWorkflow}
      onDiscardWorkflow={discardWorkflow}
      onAskFollowUp={async (question) => {
        const outcome = await executeAsk(question)
        return outcome.ok ? { ok: true, answer: outcome.run.answer } : { ok: false, answer: outcome.message }
      }}
      onApplyClassification={applyClassification}
      onApplyClassificationMany={applyClassificationMany}
      onApplyArchiveCandidate={applyArchiveCandidate}
      onApplyArchiveCandidateMany={applyArchiveCandidateMany}
      onApplyBrokenReference={applyBrokenReference}
      onRemoveBrokenReference={removeBrokenReference}
      onCreateDocumentForBrokenReference={createDocumentForBrokenReference}
      onResolveContradiction={(proposal, resolution) => void resolveContradiction(proposal, resolution)}
      onOpenDocument={onOpenDocument}
      reviewCursor={reviewCursor}
      onReviewCursorChange={setReviewCursor}
      workspaceDocuments={workspaceDocuments}
      onLoadWorkspaceDocuments={ensureWorkspaceDocuments}
    />
  )

  const sharedProps = {
    "data-testid": "workspace-agent-panel",
    "data-section": "workspace-agent-panel",
    "data-scope": scope.kind,
    "data-scope-id": scope.kind === "workspace" ? scope.rootId : scope.id,
    "data-dock": dockMode,
  } as const

  if (isFloat) {
    return (
      <>
        <div
          {...sharedProps}
          className="absolute bottom-5 right-5 z-[5] flex h-[600px] w-[372px] flex-col overflow-hidden rounded-[14px] border-[0.5px] border-border bg-sb shadow-[0_32px_80px_-20px_rgba(35,24,15,0.36),0_2px_6px_rgba(35,24,15,0.10)] font-sans"
        >
          {header}
          {chatSection}
          {composer}
        </div>
        {reviewModal}
      </>
    )
  }

  return (
    <aside
      {...sharedProps}
      className="my-2.5 mr-2.5 flex h-[calc(100%-20px)] min-h-0 w-[344px] shrink-0 flex-col overflow-hidden rounded-[14px] border-[0.5px] border-border bg-sb font-sans shadow-float"
    >
      {header}
      {chatSection}
      {composer}
      {reviewModal}
    </aside>
  )
}

/**
 * A stable session across scope changes (ODE-502): `scope` is just the
 * currently-focused Writing/Workspace the panel should ground new turns in,
 * not the session's identity. `WorkspaceAgentPanelSession` used to remount
 * on every `key={scopeKey}` change — destroying history, the composer draft,
 * attachments, pending reviews and the in-memory service every time the user
 * switched tabs. It no longer carries a scope-derived key, so React keeps
 * the same instance and its state alive while `scope` simply flows through
 * as an updated prop.
 */
export function WorkspaceAgentPanel(props: WorkspaceAgentPanelProps) {
  return <WorkspaceAgentPanelSession {...props} />
}

type ReviewCardFinding = { value: string; origin: string }

type ReviewCardSummary = {
  icon: ReactNode
  title: string
  subtitle: string
  testId: string
  findings: ReviewCardFinding[]
}

/**
 * Card shown right under the chat message that announced a predetermined
 * action's result — header (icon/title/count), a compact list of findings,
 * and a full-width CTA into the detail modal. The card never resolves
 * anything itself; it only ever leads to the review shell.
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
  const summary: ReviewCardSummary | null = (() => {
    switch (toolResult.kind) {
      case "workflow":
        return {
          icon: <Workflow className="h-[17px] w-[17px] shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "workflow.md draft",
          subtitle: toolResult.proposal.existingDocumentId ? "Revisión lista para revisar" : "Borrador nuevo listo para revisar",
          testId: "workspace-agent-workflow-review",
          findings: [],
        }
      case "broken-links":
        return toolResult.proposals.length === 0 ? null : {
          icon: <MessageCircle className="h-[17px] w-[17px] shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "Referencias rotas",
          subtitle: `${toolResult.proposals.length} por revisar`,
          testId: "workspace-agent-broken-links-review",
          findings: toolResult.proposals.map((proposal) => ({ value: proposal.reference, origin: proposal.sourceTitle })),
        }
      case "classification": {
        const actionable = toolResult.proposals.length > 0 || toolResult.requestedDocumentIds.length > 0
        return !actionable ? null : {
          icon: <Sparkles className="h-[17px] w-[17px] shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "Clasificación semántica",
          subtitle: toolResult.requestedDocumentIds.length > 0 ? "Necesita más evidencia" : `${toolResult.proposals.length} propuesta(s)`,
          testId: "workspace-agent-classification-review",
          findings: toolResult.proposals.map((proposal) => ({
            value: proposal.documentTitle,
            origin: [proposal.artifactType, proposal.status].filter(Boolean).join(" · ") || "Sin cambios",
          })),
        }
      }
      case "archive":
        return toolResult.candidates.length === 0 ? null : {
          icon: <Archive className="h-[17px] w-[17px] shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "Candidatos para archivar",
          subtitle: `${toolResult.candidates.length} por revisar`,
          testId: "workspace-agent-archive-review",
          findings: toolResult.candidates.map((candidate) => ({ value: candidate.title, origin: candidate.reason })),
        }
      case "contradictions": {
        const active = toolResult.proposals.filter((proposal) => !resolvedIds.has(proposal.id))
        return active.length === 0 ? null : {
          icon: <GitCompareArrows className="h-[17px] w-[17px] shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "Contradicciones",
          subtitle: `${active.length} por revisar`,
          testId: "workspace-agent-review-queue",
          findings: active.map((proposal) => ({ value: proposal.topic, origin: `${proposal.left.title} vs ${proposal.right.title}` })),
        }
      }
      case "merge":
        return {
          icon: <MergeIcon className="h-[17px] w-[17px] shrink-0 text-cursor" strokeWidth={1.5} />,
          title: "Documento combinado (vista previa)",
          subtitle: `${toolResult.merge.sections.length} sección(es) · ${toolResult.merge.sourceDocuments.length} documentos`,
          testId: "workspace-agent-merge-review",
          findings: toolResult.merge.sections
            .filter((section) => section.status === "conflict")
            .map((section) => ({ value: section.heading, origin: "elige una versión" })),
        }
    }
  })()
  if (!summary) return null

  return (
    <div
      data-testid={summary.testId}
      className="mt-2 w-full overflow-hidden rounded-[12px] border-[0.5px] border-border bg-sb"
    >
      <div className="flex items-center gap-2.5 border-b-[0.5px] border-[#F0EEEB] px-3 py-2.5">
        {summary.icon}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-ink">{summary.title}</p>
          <p className="truncate text-[11px] text-ink-4">{summary.subtitle}</p>
        </div>
      </div>
      {summary.findings.length > 0 ? (
        <div className="flex flex-col">
          {summary.findings.slice(0, 4).map((finding, index) => (
            <div key={`${finding.value}-${index}`} className="flex items-baseline gap-2 border-b-[0.5px] border-[#F7F5F3] px-3 py-2 last:border-b-0">
              <span className="min-w-0 truncate font-mono text-[11px] text-cursor">{finding.value}</span>
              <span className="shrink-0 text-[11px] text-ink-5">{finding.origin}</span>
            </div>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        className="flex h-[38px] w-full items-center justify-center gap-1.5 bg-ink text-[12.5px] font-medium text-bg transition-colors hover:bg-[#3F3731]"
      >
        Revisar en contexto
        <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  )
}

/**
 * Header copy for the review shell — pager text (left-most, count-shaped)
 * and the uppercase action label next to it. Broken links is the only kind
 * paged one-at-a-time so far (Fase C); the others still show a plain count
 * until their own redesign (Fases D–H) wires up real navigation.
 */
function reviewShellCopy(toolResult: ToolResult, cursor: number): { pagerLabel: string; actionLabel: string } {
  switch (toolResult.kind) {
    case "workflow":
      return { pagerLabel: toolResult.proposal.existingDocumentId ? "Revisión" : "Borrador", actionLabel: "Revisión de workflow" }
    case "broken-links":
      return { pagerLabel: `${Math.min(cursor, Math.max(toolResult.proposals.length - 1, 0)) + 1} de ${toolResult.proposals.length}`, actionLabel: "Referencias rotas" }
    case "classification":
      return { pagerLabel: `${toolResult.proposals.length} propuesta(s)`, actionLabel: "Classify" }
    case "archive":
      return { pagerLabel: `${toolResult.candidates.length} candidato(s)`, actionLabel: "Archive" }
    case "contradictions": {
      return { pagerLabel: `${toolResult.proposals.length} conflicto(s)`, actionLabel: "Contradicciones" }
    }
    case "merge":
      return { pagerLabel: `${toolResult.merge.sections.length} secciones`, actionLabel: "Combinar" }
  }
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
  onDiscardWorkflow,
  onAskFollowUp,
  onApplyClassification,
  onApplyClassificationMany,
  onApplyArchiveCandidate,
  onApplyArchiveCandidateMany,
  onApplyBrokenReference,
  onRemoveBrokenReference,
  onCreateDocumentForBrokenReference,
  onResolveContradiction,
  onOpenDocument,
  reviewCursor,
  onReviewCursorChange,
  workspaceDocuments,
  onLoadWorkspaceDocuments,
}: {
  message: AgentMessage | null
  busyAction: string | null
  brokenReferenceReplacements: Record<string, string>
  onReplacementChange: (key: string, value: string) => void
  resolvedIds: Set<string>
  onClose: () => void
  onApplyWorkflow: (messageId: string, proposal: WorkflowDraftProposal) => void
  onDiscardWorkflow: (messageId: string) => void
  onAskFollowUp: (question: string) => Promise<{ ok: boolean; answer: string }>
  onApplyClassification: (messageId: string, proposal: ClassificationProposal) => void
  onApplyClassificationMany: (messageId: string, proposals: ClassificationProposal[]) => void
  onApplyArchiveCandidate: (messageId: string, candidate: ArchiveCandidate) => void
  onApplyArchiveCandidateMany: (messageId: string, candidates: ArchiveCandidate[]) => void
  onApplyBrokenReference: (messageId: string, proposal: BrokenReferenceProposal) => void
  onRemoveBrokenReference: (messageId: string, proposal: BrokenReferenceProposal) => void
  onCreateDocumentForBrokenReference: (messageId: string, proposal: BrokenReferenceProposal) => void
  onResolveContradiction: (proposal: ContradictionProposal, resolution: "left" | "right" | "discard") => void
  onOpenDocument?: (documentId: string) => void
  reviewCursor: number
  onReviewCursorChange: (index: number) => void
  workspaceDocuments: WorkspaceAgentSearchableDocument[] | null
  onLoadWorkspaceDocuments: () => void
}) {
  const toolResult = message?.toolResult
  const open = Boolean(message && toolResult)
  const copy = toolResult ? reviewShellCopy(toolResult, reviewCursor) : null

  const brokenLinksTotal = toolResult?.kind === "broken-links" ? toolResult.proposals.length : 0
  const brokenLinksCursor = Math.min(reviewCursor, Math.max(brokenLinksTotal - 1, 0))
  const activeProposal = toolResult?.kind === "broken-links" ? toolResult.proposals[brokenLinksCursor] ?? null : null

  const advanceBrokenLinks = () => {
    if (brokenLinksCursor < brokenLinksTotal - 1) onReviewCursorChange(brokenLinksCursor + 1)
    else onClose()
  }

  return (
    <WorkspaceAgentReviewShell
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      pagerLabel={copy?.pagerLabel ?? ""}
      actionLabel={copy?.actionLabel ?? ""}
      testId="workspace-agent-review-modal"
      onBack={toolResult?.kind === "broken-links" && brokenLinksCursor > 0 ? () => onReviewCursorChange(brokenLinksCursor - 1) : undefined}
      onForward={toolResult?.kind === "broken-links" && brokenLinksCursor < brokenLinksTotal - 1 ? () => onReviewCursorChange(brokenLinksCursor + 1) : undefined}
      pill={toolResult?.kind === "merge" ? {
        icon: <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />,
        label: `${toolResult.merge.sourceDocuments.length} documentos`,
      } : undefined}
      footer={toolResult?.kind === "broken-links" && activeProposal ? (
        <>
          <span className="flex-1" />
          <ReviewShellCancelButton onClick={advanceBrokenLinks} label="Saltar por ahora" />
          <ReviewShellPrimaryButton onClick={advanceBrokenLinks}>Siguiente</ReviewShellPrimaryButton>
        </>
      ) : undefined}
    >
      {message && toolResult ? (
        <div className={cn(
          "h-full",
          toolResult.kind !== "broken-links"
            && toolResult.kind !== "workflow"
            && toolResult.kind !== "classification"
            && toolResult.kind !== "archive"
            && toolResult.kind !== "contradictions"
            && toolResult.kind !== "merge"
            && "od-scroll overflow-y-auto p-6",
        )}>
          {toolResult.kind === "workflow" ? (
            <WorkflowReviewBody
              proposal={toolResult.proposal}
              busy={busyAction === "apply-workflow"}
              onApprove={() => onApplyWorkflow(message.id, toolResult.proposal)}
              onDiscard={() => onDiscardWorkflow(message.id)}
              onAskFollowUp={onAskFollowUp}
            />
          ) : null}
          {toolResult.kind === "classification" ? (
            <ClassificationReviewBody
              toolResult={toolResult}
              busy={busyAction === "apply-classification"}
              onApprove={(proposal) => onApplyClassification(message.id, proposal)}
              onApproveMany={(proposals) => onApplyClassificationMany(message.id, proposals)}
            />
          ) : null}
          {toolResult.kind === "archive" ? (
            <ArchiveReviewBody
              candidates={toolResult.candidates}
              busy={busyAction === "apply-archive"}
              onApprove={(candidate) => onApplyArchiveCandidate(message.id, candidate)}
              onApproveMany={(candidates) => onApplyArchiveCandidateMany(message.id, candidates)}
            />
          ) : null}
          {toolResult.kind === "broken-links" && activeProposal ? (
            <BrokenLinksReviewBody
              messageId={message.id}
              proposal={activeProposal}
              busy={busyAction === "apply-broken-link"}
              busyAction={busyAction}
              replacements={brokenReferenceReplacements}
              onReplacementChange={onReplacementChange}
              onApprove={(proposal) => onApplyBrokenReference(message.id, proposal)}
              onRemove={(proposal) => onRemoveBrokenReference(message.id, proposal)}
              onCreate={(proposal) => onCreateDocumentForBrokenReference(message.id, proposal)}
              documents={workspaceDocuments}
              onLoadDocuments={onLoadWorkspaceDocuments}
            />
          ) : null}
          {toolResult.kind === "contradictions" ? (
            <ContradictionReviewCard
              proposals={toolResult.proposals}
              resolvedIds={resolvedIds}
              busy={busyAction === "resolve"}
              onResolve={onResolveContradiction}
              onOpenDocument={onOpenDocument}
            />
          ) : null}
          {toolResult.kind === "merge" ? (
            <MergeReviewBody toolResult={toolResult.merge} onCreate={() => {}} />
          ) : null}
        </div>
      ) : null}
    </WorkspaceAgentReviewShell>
  )
}
