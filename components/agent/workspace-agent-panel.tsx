"use client"

import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react"
import {
  Archive,
  Bot,
  Check,
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
  type WorkspaceAgentService,
} from "@/lib/services/workspace-agent-service"
import type {
  ArchiveCandidate,
  BrokenReferenceProposal,
  ClassificationProposal,
  ContradictionProposal,
  EvidenceCitation,
  WorkflowDraftProposal,
} from "@/lib/agent/workspace-agent-analysis"
import type {
  WorkspaceAgentAction,
  WorkspaceAgentApproval,
} from "@/lib/services/contracts/workspace-agent"
import { cn } from "@/lib/utils"

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
}

type AgentResult = {
  label: string
  summary: string
  evidence: EvidenceCitation[]
}

type AgentMessage = {
  id: string
  role: "user" | "agent"
  text: string
  attachments?: WorkspaceAgentContextAttachment[]
}

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

function resultFromWorkflow(proposal: WorkflowDraftProposal): AgentResult {
  return {
    label: "Workflow draft",
    summary: proposal.existingDocumentId ? "A new workflow.md revision is ready to review." : "A workflow.md draft is ready to review.",
    evidence: proposal.evidence,
  }
}

function resultFromBrokenReferences(proposals: BrokenReferenceProposal[]): AgentResult {
  return {
    label: "Broken links",
    summary: proposals.length === 0 ? "No broken internal references were found." : `${proposals.length} reference(s) need review.`,
    evidence: proposals.slice(0, 3).flatMap((proposal) => proposal.evidence),
  }
}

function resultFromClassification(proposal: ClassificationProposal): AgentResult {
  return {
    label: "Vocabulary fit",
    summary: proposal.reason,
    evidence: proposal.evidence,
  }
}

function resultFromArchiveCandidates(candidates: ArchiveCandidate[]): AgentResult {
  return {
    label: "Archive candidates",
    summary: candidates.length === 0 ? "No stale or duplicate artifacts were found." : `${candidates.length} candidate(s) need review.`,
    evidence: candidates.slice(0, 3).flatMap((candidate) => candidate.evidence),
  }
}

function formatEvidence(evidence: EvidenceCitation): string {
  return `${evidence.label}: ${evidence.detail}`
}

export function WorkspaceAgentPanel({
  scope,
  workspaceRootPath,
  scopeLabel,
  open = true,
  onOpenChange,
}: WorkspaceAgentPanelProps) {
  const [service, setService] = useState<WorkspaceAgentService | null>(null)
  const [serviceLoading, setServiceLoading] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [attachments, setAttachments] = useState<WorkspaceAgentContextAttachment[]>([])
  const [results, setResults] = useState<AgentResult[]>([])
  const [workflowProposal, setWorkflowProposal] = useState<WorkflowDraftProposal | null>(null)
  const [brokenReferences, setBrokenReferences] = useState<BrokenReferenceProposal[]>([])
  const [brokenReferenceReplacements, setBrokenReferenceReplacements] = useState<Record<string, string>>({})
  const [classificationProposal, setClassificationProposal] = useState<ClassificationProposal | null>(null)
  const [archiveCandidates, setArchiveCandidates] = useState<ArchiveCandidate[]>([])
  const [contradictions, setContradictions] = useState<ContradictionProposal[]>([])
  const [reviewIndex, setReviewIndex] = useState(0)
  const [isReviewExpanded, setIsReviewExpanded] = useState(false)
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [chatDraft, setChatDraft] = useState("")
  const [messages, setMessages] = useState<AgentMessage[]>([])

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

  const activeContradictions = useMemo(
    () => contradictions.filter((proposal) => !resolvedIds.has(proposal.id)),
    [contradictions, resolvedIds],
  )
  const activeContradiction = activeContradictions[reviewIndex] ?? null
  const documentIds = useMemo(() => uniqueDocumentIds(attachments, scope), [attachments, scope])
  const canCompare = Boolean(service) && documentIds.length >= 2

  const recordResult = useCallback((result: AgentResult) => {
    setResults((current) => [result, ...current.filter((item) => item.label !== result.label)].slice(0, 4))
    setFeedback(null)
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
    setWorkflowProposal(proposal.data)
    recordResult(resultFromWorkflow(proposal.data))
  }), [recordResult, runAction, service])

  const runBrokenReferences = useCallback(() => runAction("broken-links", async () => {
    if (!service) return
    const workflowReadApproval = await getWorkflowReadApproval()
    if (workflowReadApproval === null) return
    const response = await service.findBrokenReferences(workflowReadApproval)
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "Broken references could not be checked.")
      return
    }
    setBrokenReferences(response.data)
    setBrokenReferenceReplacements({})
    recordResult(resultFromBrokenReferences(response.data))
  }), [getWorkflowReadApproval, recordResult, runAction, service])

  const runClassification = useCallback(() => runAction("classification", async () => {
    if (!service) return
    const documentId = documentIds[0]
    if (!documentId) {
      setFeedback("Attach an artifact or open a document before asking for a vocabulary fit.")
      return
    }
    const workflowReadApproval = await getWorkflowReadApproval()
    if (workflowReadApproval === null) return
    const response = await service.suggestClassification(documentId, workflowReadApproval)
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "Classification could not be suggested.")
      return
    }
    setClassificationProposal(response.data)
    recordResult(resultFromClassification(response.data))
  }), [documentIds, getWorkflowReadApproval, recordResult, runAction, service])

  const runArchiveCandidates = useCallback(() => runAction("archive", async () => {
    if (!service) return
    const workflowReadApproval = await getWorkflowReadApproval()
    if (workflowReadApproval === null) return
    const response = await service.findArchiveCandidates(undefined, workflowReadApproval)
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "Archive candidates could not be checked.")
      return
    }
    setArchiveCandidates(response.data)
    recordResult(resultFromArchiveCandidates(response.data))
  }), [getWorkflowReadApproval, recordResult, runAction, service])

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
    setContradictions(response.data)
    setReviewIndex(0)
    setIsReviewExpanded(response.data.length > 0)
    setFeedback(response.data.length === 0 ? "No contradictions were found in the selected artifacts." : `${response.data.length} contradiction(s) added to the review queue.`)
  }), [documentIds, getWorkflowReadApproval, runAction, service])

  const applyWorkflow = useCallback(() => runAction("apply-workflow", async () => {
    if (!service || !workflowProposal) return
    const resource = workflowProposal.existingDocumentId ?? workflowProposal.canonicalPath
    const response = await service.applyWorkflow(workflowProposal, createApproval("write", resource))
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "The workflow draft could not be written.")
      return
    }
    setWorkflowProposal(null)
    setFeedback("workflow.md was updated through the approved desktop write path.")
  }), [runAction, service, workflowProposal])

  const applyClassification = useCallback(() => runAction("apply-classification", async () => {
    if (!service || !classificationProposal) return
    const response = await service.applyClassification(classificationProposal, createApproval("edit", classificationProposal.documentId))
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "The vocabulary classification could not be applied.")
      return
    }
    setClassificationProposal(null)
    setFeedback("Vocabulary classification applied through the approved edit path.")
  }), [classificationProposal, runAction, service])

  const applyArchiveCandidate = useCallback(() => runAction("apply-archive", async () => {
    if (!service || archiveCandidates.length === 0) return
    const candidate = archiveCandidates[0]
    const response = await service.applyArchiveCandidate(candidate, createApproval("edit", candidate.documentId))
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "The archive candidate could not be updated.")
      return
    }
    setArchiveCandidates((current) => current.slice(1))
    setFeedback(`${candidate.title} was marked with the suggested vocabulary status.`)
  }), [archiveCandidates, runAction, service])

  const applyBrokenReference = useCallback((proposal: BrokenReferenceProposal) => runAction("apply-broken-link", async () => {
    if (!service) return
    const key = `${proposal.sourceDocumentId}:${proposal.referenceKind}:${proposal.reference}`
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
    setBrokenReferences((current) => current.filter((item) => (
      `${item.sourceDocumentId}:${item.referenceKind}:${item.reference}` !== key
    )))
    setBrokenReferenceReplacements((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setFeedback(`Updated ${proposal.sourceTitle} through the approved edit path.`)
  }), [brokenReferenceReplacements, runAction, service])

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

  const resolveContradiction = useCallback((resolution: "left" | "right" | "discard") => runAction("resolve", async () => {
    if (!service || !activeContradiction) return
    const target = resolution === "left" ? activeContradiction.right : activeContradiction.left
    const approvals = resolution === "discard"
      ? undefined
      : {
          read: createApproval("read", target.documentId),
          edit: createApproval("edit", target.documentId),
        }
    const response = await service.resolveContradiction(activeContradiction, resolution, approvals)
    if (response.error || !response.data) {
      setFeedback(response.error?.message ?? "This contradiction could not be resolved.")
      return
    }
    const next = new Set(resolvedIds)
    next.add(activeContradiction.id)
    persistResolvedIds(next)
    const remainingCount = Math.max(0, activeContradictions.length - 1)
    setReviewIndex((current) => Math.min(current, Math.max(0, remainingCount - 1)))
    setIsReviewExpanded(remainingCount > 0)
    setFeedback(resolution === "discard" ? "Finding discarded from this review queue." : "The selected evidence was applied to the target artifact.")
  }), [activeContradiction, activeContradictions.length, persistResolvedIds, resolvedIds, runAction, service])

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
      { id: `agent-${messageTimestamp + 1}`, role: "agent", text: "Context noted for this session. Choose an analysis action to produce an evidence-backed result." },
    ])
    setChatDraft("")
  }, [attachments, chatDraft])

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
      onDragEnter={() => setIsDropTarget(true)}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={handleDrop}
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col border-l-[0.5px] border-border bg-muted/70 font-sans",
        isReviewExpanded ? "w-[344px]" : "w-[276px]",
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

      <div className="od-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="rounded-[9px] border-[0.5px] border-border bg-bg/70 px-2.5 py-2.5">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cursor" strokeWidth={1.5} />
            <p className="text-[11px] leading-[1.45] text-ink-3">
              Add artifacts here to give the agent focused context. Drops work anywhere in this panel.
            </p>
          </div>
        </div>

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
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-4">Actions</p>
            {serviceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-4" strokeWidth={1.5} /> : null}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <AgentActionButton icon={<Workflow />} label="Workflow" busy={busyAction === "workflow"} disabled={!service} onClick={() => void runWorkflow()} />
            <AgentActionButton icon={<GitCompareArrows />} label="Compare" busy={busyAction === "contradictions"} disabled={!canCompare} onClick={() => void runContradictions()} />
            <AgentActionButton icon={<MessageCircle />} label="Broken links" busy={busyAction === "broken-links"} disabled={!service} onClick={() => void runBrokenReferences()} />
            <AgentActionButton icon={<Sparkles />} label="Classify" busy={busyAction === "classification"} disabled={!service || documentIds.length === 0} onClick={() => void runClassification()} />
            <AgentActionButton icon={<Archive />} label="Archive" busy={busyAction === "archive"} disabled={!service} onClick={() => void runArchiveCandidates()} />
          </div>
        </div>

        {serviceError ? <p className="mt-3 rounded-[8px] border-[0.5px] border-border bg-bg px-2.5 py-2 text-[11px] leading-[1.45] text-ink-3">{serviceError}</p> : null}
        {!workspaceRootPath ? <p className="mt-3 text-[10.5px] leading-[1.45] text-ink-4">Open this artifact from a desktop Workspace to run local agent actions.</p> : null}
        {feedback ? <p className="mt-3 text-[11px] leading-[1.45] text-ink-3" role="status">{feedback}</p> : null}

        {workflowProposal ? (
          <section className="mt-4 rounded-[10px] border-[0.5px] border-border bg-bg p-2.5" data-testid="workspace-agent-workflow-review">
            <div className="flex items-center gap-1.5">
              <Workflow className="h-3.5 w-3.5 text-cursor" strokeWidth={1.5} />
              <p className="text-[11px] font-medium text-ink">Review workflow.md</p>
            </div>
            <pre className="od-scroll mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-[7px] border-[0.5px] border-border/70 bg-bg/80 p-2 text-[10px] leading-[1.45] text-ink-3">{workflowProposal.markdown}</pre>
            <button type="button" disabled={busyAction === "apply-workflow"} onClick={() => void applyWorkflow()} className="mt-2 inline-flex min-h-7 w-full items-center justify-center gap-1 rounded-[6px] bg-ink px-2 text-[10px] font-medium text-bg transition-colors hover:bg-ink/90 disabled:opacity-50">
              <Check className="h-3 w-3" strokeWidth={1.5} /> Approve workflow update
            </button>
          </section>
        ) : null}

        {classificationProposal ? (
          <section className="mt-4 rounded-[10px] border-[0.5px] border-border bg-bg p-2.5" data-testid="workspace-agent-classification-review">
            <p className="text-[11px] font-medium text-ink">Review vocabulary fit</p>
            <p className="mt-1 text-[10.5px] leading-[1.45] text-ink-3">{classificationProposal.reason}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-ink-3">
              {classificationProposal.artifactType ? <span className="rounded-[6px] bg-muted px-1.5 py-1">Type: {classificationProposal.artifactType}</span> : null}
              {classificationProposal.status ? <span className="rounded-[6px] bg-muted px-1.5 py-1">Status: {classificationProposal.status}</span> : null}
            </div>
            <button type="button" disabled={busyAction === "apply-classification"} onClick={() => void applyClassification()} className="mt-2 inline-flex min-h-7 w-full items-center justify-center gap-1 rounded-[6px] bg-ink px-2 text-[10px] font-medium text-bg transition-colors hover:bg-ink/90 disabled:opacity-50">
              <Check className="h-3 w-3" strokeWidth={1.5} /> Approve classification
            </button>
          </section>
        ) : null}

        {archiveCandidates.length > 0 ? (
          <section className="mt-4 rounded-[10px] border-[0.5px] border-border bg-bg p-2.5" data-testid="workspace-agent-archive-review">
            <div className="flex items-center gap-1.5">
              <Archive className="h-3.5 w-3.5 text-cursor" strokeWidth={1.5} />
              <p className="text-[11px] font-medium text-ink">Review archive candidate</p>
            </div>
            <p className="mt-1 text-[10.5px] font-medium text-ink-3">{archiveCandidates[0].title}</p>
            <p className="mt-1 text-[10.5px] leading-[1.45] text-ink-4">{archiveCandidates[0].reason}</p>
            <button type="button" disabled={busyAction === "apply-archive" || !archiveCandidates[0].suggestedStatus} onClick={() => void applyArchiveCandidate()} className="mt-2 inline-flex min-h-7 w-full items-center justify-center gap-1 rounded-[6px] bg-ink px-2 text-[10px] font-medium text-bg transition-colors hover:bg-ink/90 disabled:opacity-50">
              <Check className="h-3 w-3" strokeWidth={1.5} /> Approve archive status
            </button>
          </section>
        ) : null}

        {brokenReferences.length > 0 ? (
          <section className="mt-4 rounded-[10px] border-[0.5px] border-border bg-bg p-2.5" data-testid="workspace-agent-broken-links-review">
            <p className="text-[11px] font-medium text-ink">Broken references</p>
            <div className="mt-2 space-y-1.5">
              {brokenReferences.slice(0, 3).map((proposal) => (
                <div key={`${proposal.sourceDocumentId}:${proposal.referenceKind}:${proposal.reference}`} className="rounded-[7px] border-[0.5px] border-border/70 bg-bg/80 px-2 py-1.5 text-[10px] leading-[1.4] text-ink-3">
                  <span className="font-medium text-ink">{proposal.reference}</span> in {proposal.sourceTitle}
                  {proposal.candidateTitle ? <span className="block text-ink-4">Nearest catalog match: {proposal.candidateTitle}</span> : null}
                  <label className="mt-2 block text-[9px] font-medium uppercase tracking-[0.08em] text-ink-4">
                    Replacement {proposal.referenceKind}
                    <input
                      value={brokenReferenceReplacements[`${proposal.sourceDocumentId}:${proposal.referenceKind}:${proposal.reference}`] ?? proposal.suggestedReference ?? ""}
                      onChange={(event) => setBrokenReferenceReplacements((current) => ({
                        ...current,
                        [`${proposal.sourceDocumentId}:${proposal.referenceKind}:${proposal.reference}`]: event.target.value,
                      }))}
                      placeholder={proposal.referenceKind === "slug" ? "slug" : "path/to/document.md"}
                      aria-label={`Replacement for ${proposal.reference}`}
                      className="mt-1 h-7 w-full rounded-[6px] border-[0.5px] border-border bg-bg px-2 text-[10px] font-normal normal-case tracking-normal text-ink outline-none placeholder:text-ink-4 focus:border-ink-3"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busyAction === "apply-broken-link" || !(brokenReferenceReplacements[`${proposal.sourceDocumentId}:${proposal.referenceKind}:${proposal.reference}`] ?? proposal.suggestedReference ?? "").trim()}
                    onClick={() => void applyBrokenReference(proposal)}
                    className="mt-1.5 inline-flex min-h-7 w-full items-center justify-center gap-1 rounded-[6px] bg-ink px-2 text-[10px] font-medium text-bg transition-colors hover:bg-ink/90 disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" strokeWidth={1.5} /> Approve fix
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {activeContradiction ? (
          <section className="mt-4 rounded-[10px] border-[0.5px] border-border bg-bg p-2.5" data-testid="workspace-agent-review-queue">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <GitCompareArrows className="h-3.5 w-3.5 shrink-0 text-cursor" strokeWidth={1.5} />
                <p className="truncate text-[11px] font-medium text-ink">Contradiction queue</p>
              </div>
              <span className="shrink-0 text-[10px] text-ink-4">{reviewIndex + 1} / {activeContradictions.length}</span>
            </div>
            <p className="mt-2 text-[10px] uppercase tracking-[0.1em] text-ink-4">{activeContradiction.topic}</p>
            <EvidenceCard
              title={activeContradiction.left.title}
              text={activeContradiction.left.fragment.text}
              line={activeContradiction.left.fragment.line}
              updatedAt={activeContradiction.left.updatedAt}
              suggested={activeContradiction.suggestedDocumentId === activeContradiction.left.documentId}
            />
            <EvidenceCard
              title={activeContradiction.right.title}
              text={activeContradiction.right.fragment.text}
              line={activeContradiction.right.fragment.line}
              updatedAt={activeContradiction.right.updatedAt}
              suggested={activeContradiction.suggestedDocumentId === activeContradiction.right.documentId}
            />
            <div className="mt-2 flex items-center gap-1.5">
              <button type="button" disabled={busyAction === "resolve"} onClick={() => void resolveContradiction("left")} className="inline-flex min-h-7 flex-1 items-center justify-center gap-1 rounded-[6px] bg-ink px-2 text-[10px] font-medium text-bg transition-colors hover:bg-ink/90 disabled:opacity-50">
                <Check className="h-3 w-3" strokeWidth={1.5} /> Use left
              </button>
              <button type="button" disabled={busyAction === "resolve"} onClick={() => void resolveContradiction("right")} className="inline-flex min-h-7 flex-1 items-center justify-center gap-1 rounded-[6px] border-[0.5px] border-border px-2 text-[10px] font-medium text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink disabled:opacity-50">
                <Check className="h-3 w-3" strokeWidth={1.5} /> Use right
              </button>
            </div>
            <button type="button" disabled={busyAction === "resolve"} onClick={() => void resolveContradiction("discard")} className="mt-1.5 inline-flex h-6 w-full items-center justify-center text-[10px] text-ink-4 hover:text-ink disabled:opacity-50">Discard finding</button>
          </section>
        ) : null}

        {results.length > 0 ? (
          <section className="mt-4 space-y-2" data-testid="workspace-agent-results">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-4">Evidence</p>
            {results.map((result) => (
              <article key={result.label} className="rounded-[9px] border-[0.5px] border-border bg-bg px-2.5 py-2">
                <p className="text-[11px] font-medium text-ink">{result.label}</p>
                <p className="mt-1 text-[10.5px] leading-[1.45] text-ink-3">{result.summary}</p>
                {result.evidence.slice(0, 2).map((evidence) => <p key={`${evidence.sourceId}:${evidence.detail}`} className="mt-1 truncate text-[10px] text-ink-4">{formatEvidence(evidence)}</p>)}
              </article>
            ))}
          </section>
        ) : null}

        {messages.length > 0 ? (
          <section
            className="od-scroll mt-4 max-h-56 space-y-2 overflow-y-auto pr-1"
            aria-label="Agent conversation"
            data-testid="workspace-agent-chat"
          >
            {messages.map((message) => (
              <div key={message.id} className={cn("rounded-[8px] px-2.5 py-2 text-[10.5px] leading-[1.45]", message.role === "user" ? "ml-4 bg-muted text-ink" : "mr-4 border-[0.5px] border-border text-ink-3")}>
                <p>{message.text}</p>
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
            ))}
          </section>
        ) : null}
      </div>

      <form
        className="shrink-0 border-t-[0.5px] border-border bg-muted/35 p-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          submitChat()
        }}
      >
        <div className="flex items-end gap-1.5 rounded-[8px] border-[0.5px] border-border bg-bg/80 px-2 py-1.5 focus-within:border-ink-3">
          <Paperclip className="mb-1 h-3.5 w-3.5 shrink-0 text-ink-4" strokeWidth={1.5} />
          <textarea
            value={chatDraft}
            onChange={(event) => setChatDraft(event.target.value)}
            placeholder="Ask about this context…"
            rows={1}
            className="max-h-20 min-h-6 min-w-0 flex-1 resize-none bg-transparent text-[11px] leading-5 text-ink outline-none placeholder:text-ink-4"
            aria-label="Message Workspace agent"
          />
          <button type="submit" aria-label="Send message" disabled={!chatDraft.trim()} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-ink text-bg transition-opacity disabled:opacity-30">
            <Send className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
      </form>
    </aside>
  )
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
