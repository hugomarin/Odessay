import type { CollectionSummary } from "@/lib/collections/collections"
import { findInlineAnnotationMarkers } from "@/lib/editor/annotation-markdown"
import {
  buildWorkflowDraft,
  detectBrokenDocumentReferences,
  findArchiveCandidates,
  removeBrokenDocumentReference,
  replaceBrokenDocumentReference,
  replaceContradictionFragment,
  resolveBrokenReferenceTargetPath,
  suggestArtifactClassification,
  type ArchiveCandidate,
  type BrokenReferenceProposal,
  type ClassificationProposal,
  type ClassificationEvidenceSource,
  type ContradictionProposal,
  type ContradictionResolution,
  type EvidenceCitation,
  buildAcceptedUnresolvedMergeBody,
  type MergeReviewToolResult,
  type MergeSection,
  type MergeSectionSource,
  type WorkflowDraftProposal,
} from "@/lib/agent/workspace-agent-analysis"
import {
  splitWorkflowMarkdown,
} from "@/lib/agent/workflow-instructions"
import type {
  AIService,
  WorkspaceAskEvidence,
  WorkspaceAskRequest,
  WorkspaceAskResult,
  WorkspaceClassificationAnnotation,
  WorkspaceClassificationDocument,
  WorkspaceClassificationRequest,
  WorkspaceClassificationResult,
  WorkspaceSemanticInputItem,
  WorkspaceSemanticOperation,
  WorkspaceSemanticToolDescriptor,
  WorkspaceToolPresentationRequest,
} from "@/lib/services/contracts/ai-service"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import type {
  WorkspaceAgentApproval,
  WorkspaceAgentEvidence,
  WorkspaceAgentEvidenceReadInput,
  WorkspaceAgentEvidenceReadResult,
  WorkspaceAgentEditInput,
  WorkspaceAgentMutationResult,
  WorkspaceAgentToolsService,
} from "@/lib/services/contracts/workspace-agent"
import { getDocumentCatalog } from "@/lib/services/document-catalog-factory"
import { getAIService } from "@/lib/services/ai-service-factory"
import { loadDesktopCollections } from "@/lib/services/desktop/desktop-collection-service"
import { getWorkspaceAgentToolsService } from "@/lib/services/workspace-agent-tools-factory"
import { getVocabularyCatalogSnapshot } from "@/lib/vocabulary/catalog"
import {
  DEFAULT_EXTRACTION_POLICY,
  buildContextAcquisitionPlan,
  createContextArtifactStore,
  createContextLedger,
  estimateTokenCount,
  resolveEvidenceBundle,
  type ContextArtifactStore,
  type ContextLedger,
} from "@/lib/services/context"
import {
  createWorkspaceExecutionContext,
  type WorkspaceExecutionContext,
  type WorkspaceExecutionReceipt,
} from "@/lib/ai/workspace-execution-receipt"
import {
  runWorkspaceSemanticLoop,
  type WorkspaceSemanticLoopCaps,
  type WorkspaceSemanticLoopResult,
} from "@/lib/ai/workspace-semantic-loop"
import {
  createWorkspaceSemanticToolRegistry,
  type WorkspaceSemanticDocumentSnapshot,
  type WorkspaceSemanticReadArguments,
} from "@/lib/ai/workspace-semantic-tool-registry"
import { digest } from "@/lib/ai/workspace-semantic-utils"
import {
  buildWorkspaceDocumentRelationsRequest,
  isResolvableSemanticContradiction,
  parseWorkspaceDocumentRelationsResult,
  type WorkspaceDocumentRelation,
  type WorkspaceDocumentRelationSource,
  type WorkspaceRelationConfidence,
  type WorkspaceRelationVerdict,
  type WorkspaceDocumentRelationsResult,
} from "@/lib/ai/workspace-document-relations"
import {
  buildWorkspaceMergeRequest,
  lineRangeForMergeSource,
  parseWorkspaceMergeResult,
  type MergeAlignedSection,
  type WorkspaceMergeReviewResult,
  type WorkspaceMergeSource,
} from "@/lib/ai/workspace-merge"

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function error<T>(code: ServiceError["code"], message: string): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable: false } }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
}

const MAX_MERGE_DESTINATION_NAME_CHARS = 160

/** A merge destination is a filename in the confirmed BindingRoot, never a user-supplied subpath. */
export function normalizeMergeDestinationName(value: string): string | null {
  const trimmed = value.trim()
  if (
    !trimmed
    || trimmed.length > MAX_MERGE_DESTINATION_NAME_CHARS
    || trimmed === "."
    || trimmed === ".."
    || trimmed.includes("/")
    || trimmed.includes("\\")
    || trimmed.includes("..")
    || /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) return null
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`
}

export function mergeDestinationPath(workspaceRootPath: string, destinationName: string): string | null {
  const name = normalizeMergeDestinationName(destinationName)
  const root = normalizePath(workspaceRootPath.trim())
  if (!name || !root || root === ".") return null
  return `${root}/${name}`
}

const INTERNAL_WORKSPACE_DIR_NAMES = new Set([".odessay", [".ody", "ssey"].join("")])

function canonicalizeLexicalPath(path: string): string {
  const normalized = normalizePath(path)
  const drive = normalized.match(/^[A-Za-z]:/)?.[0] ?? ""
  const remainder = drive ? normalized.slice(drive.length) : normalized
  const absolute = remainder.startsWith("/")
  const parts: string[] = []

  for (const part of remainder.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      const previous = parts.at(-1)
      if (previous && previous !== "..") parts.pop()
      else if (!absolute) parts.push("..")
      continue
    }
    parts.push(part)
  }

  const prefix = drive ? `${drive}${absolute ? "/" : ""}` : absolute ? "/" : ""
  return `${prefix}${parts.join("/")}` || prefix || "."
}

function hasInternalWorkspaceComponent(path: string): boolean {
  return canonicalizeLexicalPath(path)
    .split("/")
    .some((component) => INTERNAL_WORKSPACE_DIR_NAMES.has(component.toLocaleLowerCase()))
}

function isInsideRoot(path: string | null | undefined, rootPath: string): boolean {
  if (!path) return false
  const candidate = canonicalizeLexicalPath(path)
  const root = canonicalizeLexicalPath(rootPath)
  if (hasInternalWorkspaceComponent(candidate) || hasInternalWorkspaceComponent(root)) return false
  if (candidate === root) return false
  return root === "/" ? candidate.startsWith("/") : candidate.startsWith(`${root}/`)
}

function workflowPath(rootPath: string): string {
  return `${normalizePath(rootPath)}/workflow.md`
}

function isWithinOrEqualPath(path: string, rootPath: string): boolean {
  const candidate = canonicalizeLexicalPath(path)
  const root = canonicalizeLexicalPath(rootPath)
  if (hasInternalWorkspaceComponent(candidate) || hasInternalWorkspaceComponent(root)) return false
  return candidate === root || (root === "/" ? candidate.startsWith("/") : candidate.startsWith(`${root}/`))
}

function selectionPath(path: string | undefined, rootPath: string): string | null {
  const trimmed = path?.trim()
  if (!trimmed) return null
  const normalized = canonicalizeLexicalPath(trimmed)
  const isAbsolute = normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
  return canonicalizeLexicalPath(isAbsolute ? normalized : `${rootPath}/${normalized}`)
}

/**
 * Cache key material for the Context Artifact Store (ODE-501): prefers the
 * content hash so any content change invalidates prior artifacts; falls
 * back to version+modifiedAt for catalog implementations that don't carry
 * a hash yet. Either way, an edit that changes the document changes this
 * key, so a stale artifact can never be served as current evidence.
 */
function artifactVersionKey(record: DocumentCatalogRecord): string {
  return record.binding?.contentHash ?? `v${record.version ?? 0}@${record.modifiedAt ?? 0}`
}

function scopeFingerprintFor(
  workspaceRootPath: string,
  action: string,
  documents: readonly { documentId: string; documentVersion: string; contentHash: string | null }[],
): string {
  return `scope:${digest(JSON.stringify({
    workspaceRootPath: normalizePath(workspaceRootPath),
    action,
    documents: [...documents]
      .sort((left, right) => left.documentId.localeCompare(right.documentId)),
  }))}`
}

function matchesDocumentSnapshot(
  record: DocumentCatalogRecord,
  expected: WorkspaceSemanticDocumentSnapshot,
): boolean {
  return artifactVersionKey(record) === expected.documentVersion
    && (expected.contentHash === null || (record.binding?.contentHash ?? null) === expected.contentHash)
}

function createInternalReadApproval(documentId: string): WorkspaceAgentApproval {
  const approvalId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `workspace-agent-read-${documentId}-${Date.now()}`
  return {
    action: "read",
    approvalId,
    approved: true,
    approvedAt: new Date().toISOString(),
    resource: documentId,
  }
}

function lineForQuote(markdown: string, quote: string): number | null {
  const start = markdown.indexOf(quote)
  if (start < 0) return null
  return markdown.slice(0, start).split("\n").length
}

function annotationEvidence(documentId: string, markdown: string): WorkspaceClassificationAnnotation[] {
  return findInlineAnnotationMarkers(markdown)
    .filter((annotation) => annotation.text.trim().length > 0)
    .slice(0, 24)
    .map((annotation) => ({
      documentId,
      type: annotation.type,
      anchorText: annotation.text.slice(0, 500),
      note: annotation.text.slice(0, 1_000),
    }))
}

function lineStartOffset(markdown: string, line: number): number {
  if (line <= 1) return 0
  const lines = markdown.split("\n")
  return lines.slice(0, line - 1).reduce((total, value) => total + value.length + 1, 0)
}

function fragmentFromRelationEvidence(
  source: WorkspaceDocumentRelationSource,
  evidence: WorkspaceDocumentRelation["provenance"][number],
): ContradictionProposal["left"]["fragment"] {
  const expectedStart = lineStartOffset(source.markdown, evidence.lineStart)
  const lineEnd = lineStartOffset(source.markdown, evidence.lineEnd + 1)
  const foundStart = source.markdown.indexOf(evidence.text, expectedStart)
  const start = foundStart >= expectedStart && foundStart < Math.max(lineEnd, expectedStart + evidence.text.length)
    ? foundStart
    : expectedStart
  return {
    text: evidence.text,
    start,
    end: start + evidence.text.length,
    line: evidence.lineStart,
  }
}

export type WorkspaceAgentSemanticRelationSummary = {
  relationId: string
  verdict: WorkspaceRelationVerdict
  confidence: WorkspaceRelationConfidence
  rationale: string
  evidenceIds: string[]
  left: ContradictionProposal["left"]
  right: ContradictionProposal["right"]
  suggestedDocumentId: string | null
  suggestedReason: string | null
}

export type WorkspaceAgentContradictionsRun = {
  proposals: ContradictionProposal[]
  /** Semantic relations that were valid but are intentionally non-actionable. */
  nonActionable: WorkspaceAgentSemanticRelationSummary[]
  review: WorkspaceDocumentRelationsResult
}

function relationSummary(
  relation: WorkspaceDocumentRelation,
  sourcesById: ReadonlyMap<string, WorkspaceDocumentRelationSource>,
): WorkspaceAgentSemanticRelationSummary | null {
  const firstEvidence = relation.provenance.find((item) => item.evidenceId === relation.evidenceIds[0])
  const leftEvidence = relation.leftDocumentId === relation.rightDocumentId
    ? firstEvidence
    : relation.provenance.find((item) => item.documentId === relation.leftDocumentId)
  const rightEvidence = relation.leftDocumentId === relation.rightDocumentId
    ? relation.provenance.find((item) => item.evidenceId !== firstEvidence?.evidenceId)
    : relation.provenance.find((item) => item.documentId === relation.rightDocumentId)
  const leftSource = sourcesById.get(relation.leftDocumentId)
  const rightSource = sourcesById.get(relation.rightDocumentId)
  if (!leftEvidence || !rightEvidence || !leftSource || !rightSource) return null
  return {
    relationId: relation.relationId,
    verdict: relation.verdict,
    confidence: relation.confidence,
    rationale: relation.rationale,
    evidenceIds: relation.evidenceIds,
    left: {
      documentId: relation.leftDocumentId,
      title: leftSource.title,
      updatedAt: leftSource.updatedAt ?? "",
      fragment: fragmentFromRelationEvidence(leftSource, leftEvidence),
    },
    right: {
      documentId: relation.rightDocumentId,
      title: rightSource.title,
      updatedAt: rightSource.updatedAt ?? "",
      fragment: fragmentFromRelationEvidence(rightSource, rightEvidence),
    },
    suggestedDocumentId: relation.suggestedDocumentId,
    suggestedReason: relation.suggestedReason,
  }
}

function semanticRelationTopic(summary: WorkspaceAgentSemanticRelationSummary): string {
  const firstSentence = summary.rationale.split(/[.!?](?:\s|$)/, 1)[0]?.trim()
  return (firstSentence || summary.left.fragment.text || "document claim").slice(0, 120)
}

function semanticProposal(
  relation: WorkspaceDocumentRelation,
  summary: WorkspaceAgentSemanticRelationSummary,
  review: WorkspaceDocumentRelationsResult,
): ContradictionProposal {
  return {
    id: summary.relationId,
    topic: semanticRelationTopic(summary),
    left: summary.left,
    right: summary.right,
    suggestedDocumentId: summary.suggestedDocumentId,
    evidence: [
      {
        kind: "document",
        sourceId: summary.left.documentId,
        label: summary.left.title,
        detail: `line ${summary.left.fragment.line} · evidence ${summary.evidenceIds.find((id) => relation.provenance.find((item) => item.evidenceId === id)?.documentId === summary.left.documentId) ?? "unknown"}`,
        quote: summary.left.fragment.text,
        line: summary.left.fragment.line,
      },
      {
        kind: "document",
        sourceId: summary.right.documentId,
        label: summary.right.title,
        detail: `line ${summary.right.fragment.line} · evidence ${summary.evidenceIds.find((id) => relation.provenance.find((item) => item.evidenceId === id)?.documentId === summary.right.documentId) ?? "unknown"}`,
        quote: summary.right.fragment.text,
        line: summary.right.fragment.line,
      },
      {
        kind: "catalog",
        sourceId: summary.relationId,
        label: "Semantic review",
        detail: `${summary.verdict} · ${summary.confidence} · evidence IDs: ${summary.evidenceIds.join(", ")} · coverage: ${review.coverage}`,
        quote: summary.rationale,
      },
    ],
    semanticVerdict: summary.verdict,
    semanticConfidence: summary.confidence,
    semanticRationale: summary.rationale,
    semanticEvidenceIds: [...summary.evidenceIds],
    semanticSuggestedReason: summary.suggestedReason,
    semanticSourceSnapshots: Object.fromEntries([
      [summary.left.documentId, {
        documentVersion: relation.provenance.find((item) => item.documentId === summary.left.documentId)?.documentVersion ?? "",
        contentHash: relation.provenance.find((item) => item.documentId === summary.left.documentId)?.contentHash ?? null,
      }],
      [summary.right.documentId, {
        documentVersion: relation.provenance.find((item) => item.documentId === summary.right.documentId)?.documentVersion ?? "",
        contentHash: relation.provenance.find((item) => item.documentId === summary.right.documentId)?.contentHash ?? null,
      }],
    ]),
  }
}

function mapSemanticRelationsToContradictions(
  review: WorkspaceDocumentRelationsResult,
  sources: readonly WorkspaceDocumentRelationSource[],
): Pick<WorkspaceAgentContradictionsRun, "proposals" | "nonActionable"> {
  const sourcesById = new Map(sources.map((source) => [source.documentId, source]))
  const proposals: ContradictionProposal[] = []
  const nonActionable: WorkspaceAgentSemanticRelationSummary[] = []
  for (const relation of review.relations) {
    const summary = relationSummary(relation, sourcesById)
    if (!summary) continue
    if (isResolvableSemanticContradiction(relation)) proposals.push(semanticProposal(relation, summary, review))
    else nonActionable.push(summary)
  }
  return { proposals, nonActionable }
}

type WorkspaceAgentContext = {
  rootPath: string
  documents: DocumentCatalogRecord[]
  collections: CollectionSummary[]
  documentCollectionIds: Record<string, string[]>
  existingWorkflow: DocumentCatalogRecord | null
  workflowMarkdown: string | null
  /** Ambient operating instructions section of workflow.md (ODE-504 hybrid model). */
  workflowInstructions: string | null
  /** Descriptor of workflow.md when only instructions were loaded ambiently. */
  workflowDescriptor: {
    documentId: string
    version: string
    instructionsTruncated: boolean
    definitionsChars: number
    scopeSummary: string[]
  } | null
}

export type WorkspaceAgentSelection = {
  kind: "file" | "folder"
  documentId?: string
  path?: string
}

export type WorkspaceAgentClassificationInput = {
  request?: string
  selection: readonly WorkspaceAgentSelection[]
  workflowReadApproval?: WorkspaceAgentApproval
  execution?: WorkspaceExecutionContext | null
}

export type WorkspaceAgentClassificationRequestedDocument = {
  documentId: string
  title: string
  path: string | null
}

export type WorkspaceAgentClassificationRun = {
  summary: string
  proposals: ClassificationProposal[]
  requestedDocumentIds: string[]
  requestedDocuments: WorkspaceAgentClassificationRequestedDocument[]
  targetDocumentIds: string[]
  executionContext: WorkspaceExecutionContext
  executionReceipt: WorkspaceExecutionReceipt | null
}

export type WorkspaceAgentAskInput = {
  question: string
  selection: readonly WorkspaceAgentSelection[]
  workflowReadApproval?: WorkspaceAgentApproval
  /** Short summaries of what already happened earlier in this chat session, most recent last. */
  sessionContext?: readonly string[]
  /**
   * The currently open Writing's live editor content, when it's part of
   * `selection` — grounds the ask in what's on screen instead of the last-
   * persisted catalog version (ODE-489/490 follow-up). Absent when there's
   * no live-editor context to prefer (e.g. asking about a different,
   * unopened document).
   */
  liveOverride?: { documentId: string; markdown: string }
  /**
   * The id of the Writing currently open. It is informational unless the
   * caller also includes it in `selection`; an open document is not an
   * authorization to read or guess additional Workspace scope.
   */
  focusedDocumentId?: string | null
  previousResponseId?: string | null
  previousScopeFingerprint?: string | null
  execution?: WorkspaceExecutionContext | null
}

export type WorkspaceAgentCitedDocument = {
  documentId: string
  title: string
  path: string | null
}

export type WorkspaceAgentAskRun = {
  answer: string
  evidence: EvidenceCitation[]
  requestedDocumentIds: string[]
  requestedDocuments: WorkspaceAgentClassificationRequestedDocument[]
  targetDocumentIds: string[]
  /** Every document the model could see while answering, so the UI can turn `` `filename` `` mentions into open-document links. */
  documents: WorkspaceAgentCitedDocument[]
  /**
   * Set only when the model judged the user was explicitly asking to run
   * one of the predetermined actions, not just discuss it (ODE-489/491
   * follow-up). Null from `askAboutDocument` — there's no Workspace/service
   * available there to dispatch anything to.
   */
  suggestedAction: "workflow" | "broken-links" | "classification" | "archive" | "contradictions" | null
  scopeStatus: "ready" | "needs_scope" | "staged" | "incomplete"
  responseId: string | null
  scopeFingerprint: string | null
  compactionCount: number
  executionContext: WorkspaceExecutionContext
  executionReceipt: WorkspaceExecutionReceipt | null
}

export type WorkspaceAgentPresentationRun = {
  note: string
  executionContext: WorkspaceExecutionContext
  executionReceipt: WorkspaceExecutionReceipt | null
}

export type WorkspaceAgentSemanticReviewInput = {
  operation: WorkspaceSemanticOperation
  /** Evidence already admitted by the owning feature's context plan. */
  initialEvidence: readonly WorkspaceAgentEvidence[]
  /** Application-authored task/evidence messages; never a provider payload. */
  initialInput: readonly WorkspaceSemanticInputItem[]
  tools?: readonly WorkspaceSemanticToolDescriptor[]
  execution?: WorkspaceExecutionContext | null
  signal?: AbortSignal
  caps?: WorkspaceSemanticLoopCaps
}

export type WorkspaceAgentSemanticReviewRun = WorkspaceSemanticLoopResult

export type WorkspaceAgentDocumentRelationsInput = {
  documentIds: readonly string[]
  readApprovals: Readonly<Record<string, WorkspaceAgentApproval>>
  execution?: WorkspaceExecutionContext | null
  signal?: AbortSignal
}

export type WorkspaceAgentDocumentRelationsRun = WorkspaceDocumentRelationsResult

export type WorkspaceAgentMergeReviewRun = MergeReviewToolResult

export type WorkspaceAgentMergeSectionSelection = {
  id: string
  body: string
  primarySourceDocumentId: string | null
  acceptedUnresolved: boolean
}

export type WorkspaceAgentMergeCreateInput = {
  draft: WorkspaceAgentMergeReviewRun
  destinationName: string
  sections: readonly WorkspaceAgentMergeSectionSelection[]
  approval: WorkspaceAgentApproval
}

/**
 * Used only to correlate this one in-memory ask's request/response (target
 * id, citation matching) — never persisted, never resolved through
 * DocumentCatalog, and never a stand-in for real document identity.
 */
const EPHEMERAL_CONVERSATION_DOCUMENT_ID = "conversation-draft"

export type WorkspaceAgentDocumentAskInput = {
  question: string
  /** Null for a still-blank draft with no identity yet (ODE-490 follow-up) — conversation must not require materializing one first. */
  documentId: string | null
  title: string | null
  markdown: string
  sessionContext?: readonly string[]
  previousResponseId?: string | null
  previousScopeFingerprint?: string | null
  execution?: WorkspaceExecutionContext | null
}

/**
 * Answers a question grounded in a single document's live content — the
 * Writing currently open in the editor — without a Workspace, BindingRoot,
 * or DocumentCatalog. Nothing here touches the filesystem or the desktop
 * tools layer, so it works for an unmaterialized draft, a Writing outside
 * any visible Workspace, and on the web/cloud runtime alike (ODE-490).
 */
export async function askAboutDocument(input: WorkspaceAgentDocumentAskInput): Promise<ServiceResponse<WorkspaceAgentAskRun>> {
  const documentId = input.documentId ?? EPHEMERAL_CONVERSATION_DOCUMENT_ID
  const title = input.title?.trim() || null
  const markdown = input.markdown
  const execution = input.execution ?? createWorkspaceExecutionContext("ask", "web")
  const scopeFingerprint = scopeFingerprintFor("ephemeral-document", "ask", [{
    documentId,
    documentVersion: "live",
    contentHash: digest(markdown),
  }])

  // This path already has the live `.md`/editor content. It is explicit
  // document scope, so the first provider request receives the full content;
  // no metadata-only discovery round can guess or omit the source.
  const aiResult = await getAIService().askWorkspace({
    question: input.question.slice(0, 2_000),
    targetDocumentIds: [documentId],
    documents: [{
      id: documentId,
      title,
      relativePath: null,
      currentArtifactType: null,
      currentStatus: null,
      visibility: null,
      version: null,
      modifiedAt: null,
      excerpt: null,
      references: [],
      markdown,
    }],
    collections: [],
    documentCollectionIds: {},
    annotations: [],
    workflow: null,
    catalogTruncated: false,
    recentSessionActions: input.sessionContext ? [...input.sessionContext] : undefined,
    focusedDocumentId: documentId,
    previousResponseId: input.previousScopeFingerprint === scopeFingerprint
      ? (input.previousResponseId ?? null)
      : null,
    scopeFingerprint,
    execution: { ...execution, stage: "context-acquisition" },
  })
  if (aiResult.error || !aiResult.data) {
    return error(aiResult.error?.code ?? "AI_REQUEST_FAILED", aiResult.error?.message ?? "The Workspace agent could not answer right now.")
  }

  const validEvidence = aiResult.data.evidence.filter((item) => item.documentId === documentId && markdown.includes(item.quote))
  const evidence: EvidenceCitation[] = validEvidence.flatMap((item) => {
    const line = lineForQuote(markdown, item.quote)
    if (line === null) return []
    return [{
      kind: "document",
      sourceId: documentId,
      label: title ?? documentId,
      detail: item.reason,
      quote: item.quote,
      line,
    }]
  })

  return ok({
    answer: aiResult.data.answer,
    evidence,
    requestedDocumentIds: aiResult.data.requestedDocumentIds,
    requestedDocuments: [],
    targetDocumentIds: [documentId],
    // No real identity to cite back to when the draft is still unmaterialized
    // — an empty `documents` list means the panel won't turn any `` `name` ``
    // mention into a (broken) open-document link for a document that doesn't
    // exist yet.
    documents: input.documentId ? [{ documentId, title: title ?? documentId, path: null }] : [],
    // No Workspace/service here to dispatch a predetermined action to, even
    // if the model still suggested one.
    suggestedAction: null,
    scopeStatus: aiResult.data.scopeStatus ?? "ready",
    responseId: aiResult.data.responseId ?? null,
    scopeFingerprint,
    compactionCount: aiResult.data.compactionCount ?? 0,
    executionContext: execution,
    executionReceipt: aiResult.data.executionReceipt ?? null,
  })
}

const DEFAULT_CLASSIFICATION_REQUEST = "Review these artifacts and propose their type and status with evidence."

export type BrokenReferenceFixApprovals = {
  read: WorkspaceAgentApproval
  edit: WorkspaceAgentApproval
}

async function loadContext(rootPath: string): Promise<ServiceResponse<WorkspaceAgentContext>> {
  try {
    const [catalog, collectionState] = await Promise.all([
      getDocumentCatalog(),
      loadDesktopCollections(),
    ])
    // ODE-481: wait for the desktop catalog's rebuildable destination
    // projection before analysing. The agent still receives metadata only;
    // native hydration stores link targets, not document bodies.
    await catalog.hydrateContentProjections?.()
    const documents = (await catalog.list({ includeDeleted: false }))
      .filter((record) => isInsideRoot(record.binding?.canonicalPath, rootPath))
    const counts = new Map<string, number>()
    const documentCollectionIds = new Map<string, string[]>()
    for (const assignment of collectionState.writingCollections) {
      if (documents.some((record) => record.id === assignment.writing_id)) {
        counts.set(assignment.collection_id, (counts.get(assignment.collection_id) ?? 0) + 1)
        const current = documentCollectionIds.get(assignment.writing_id) ?? []
        if (!current.includes(assignment.collection_id)) current.push(assignment.collection_id)
        documentCollectionIds.set(assignment.writing_id, current)
      }
    }
    const collections = collectionState.collections
      .filter((collection) => !collection.deleted_at)
      .map((collection): CollectionSummary => ({
        id: collection.id,
        name: collection.name,
        description: collection.description ?? null,
        visibility: collection.visibility,
        writingsCount: counts.get(collection.id) ?? 0,
        updatedAt: collection.updated_at,
      }))
    return ok({
      rootPath,
      documents,
      collections,
      documentCollectionIds: Object.fromEntries(documentCollectionIds),
      existingWorkflow: documents.find((record) => normalizePath(record.binding?.canonicalPath ?? "") === workflowPath(rootPath)) ?? null,
      workflowMarkdown: null,
      workflowInstructions: null,
      workflowDescriptor: null,
    })
  } catch (cause) {
    return error("DB_ERROR", cause instanceof Error ? cause.message : "Workspace context could not be loaded.")
  }
}

function resolveSelectionDocumentIds(
  context: WorkspaceAgentContext,
  selection: readonly WorkspaceAgentSelection[],
): string[] {
  const activeDocuments = context.documents.filter((record) => !record.deletedAt)
  const selected = new Set<string>()
  const add = (record: DocumentCatalogRecord | undefined) => {
    if (record && !record.deletedAt) selected.add(record.id)
  }

  for (const item of selection) {
    if (item.kind === "file") {
      if (item.documentId) {
        add(activeDocuments.find((record) => record.id === item.documentId))
      }
      const filePath = selectionPath(item.path, context.rootPath)
      if (filePath) {
        add(activeDocuments.find((record) => canonicalizeLexicalPath(record.binding?.canonicalPath ?? "") === filePath))
      }
      continue
    }

    const folderPath = selectionPath(item.path, context.rootPath)
    if (!folderPath || !isWithinOrEqualPath(folderPath, context.rootPath)) continue
    for (const record of activeDocuments) {
      const documentPath = record.binding?.canonicalPath
      if (documentPath && isWithinOrEqualPath(documentPath, folderPath) && canonicalizeLexicalPath(documentPath) !== folderPath) {
        add(record)
      }
    }
  }

  return [...selected]
}

function documentForClassification(
  record: DocumentCatalogRecord,
  markdown: string | null,
): WorkspaceClassificationDocument {
  return {
    id: record.id,
    title: record.title,
    relativePath: record.binding?.relativePath ?? null,
    currentArtifactType: record.artifactType,
    currentStatus: record.status,
    visibility: record.visibility,
    version: record.version,
    modifiedAt: record.modifiedAt,
    excerpt: record.excerpt ?? null,
    references: record.referenceTargets ?? [],
    markdown,
  }
}

/**
 * Ask needs a discoverable catalog, but metadata excerpts are not document
 * evidence. Keeping only identity fields for unloaded records lets the model
 * recognize a natural-language document reference without inviting it to
 * answer from a stale/truncated excerpt.
 */
function documentForAsk(
  record: DocumentCatalogRecord,
  markdown: string | null,
): WorkspaceClassificationDocument {
  const document = documentForClassification(record, markdown)
  return markdown === null
    ? { ...document, excerpt: null, references: [] }
    : document
}

type PreparedDocumentEvidence = {
  selectedRecords: DocumentCatalogRecord[]
  recordsById: Map<string, DocumentCatalogRecord>
  currentRecordsById: Map<string, DocumentCatalogRecord>
  markdownById: Map<string, string>
  annotations: WorkspaceClassificationAnnotation[]
  promptRecords: DocumentCatalogRecord[]
  catalogTruncated: boolean
}

/**
 * Shared by suggestClassification and askAgent: resolve a selection down to
 * live catalog records, then resolve each one's evidence through the
 * Context Acquisition Plan / Evidence Bundle layer (ODE-501) — reusing a
 * cached artifact keyed by document id + version when one is valid, and
 * reading through the approved tools boundary only on a cache miss. The
 * selected markdown is admitted in full; provider-capacity staging decides
 * how a large set is delivered without turning it into a silent excerpt.
 */
async function prepareDocumentEvidence(
  context: WorkspaceAgentContext,
  selection: readonly WorkspaceAgentSelection[],
  tools: WorkspaceAgentToolsService,
  options: {
    noSelectionMessage: string
    contextPurpose: string
    /**
     * A conversational ask with nothing selected must not fall back to
     * reading anything (ODE-489's documented "Context Gap conocido": a
     * plain "Hola" was reading and sending a full document body). When
     * true, an empty selection resolves to a zero-document plan instead of
     * the NOT_FOUND error below. Classification still requires an explicit
     * selection — there's nothing to classify otherwise.
     */
    allowEmptySelection?: boolean
    /**
     * The Writing currently open in the editor may have unsaved edits the
     * catalog doesn't know about yet. Without this, a selected document
     * always answers from its last-persisted content — "summarize this"
     * silently ignores what the user just typed (ODE-489/490 follow-up).
     * Keyed by documentId; bypasses the artifact cache entirely for that
     * document, since the live text has no catalog version to key on and
     * caching it under the stale catalog version would itself go stale the
     * moment the user keeps typing without saving.
     */
    liveOverrides?: ReadonlyMap<string, string>
    /** Informational focused id; it does not authorize an implicit body read. */
    focusedDocumentId?: string | null
  },
  contextServices: { store: ContextArtifactStore; ledger: ContextLedger },
): Promise<ServiceResponse<PreparedDocumentEvidence>> {
  // ODE-504: workflow.md is no longer withheld from selections. Under the
  // hybrid model the ambient context carries only its instructions section;
  // when the model (or the user's attachment) explicitly materializes the
  // document, the full body flows through the same evidence bundle as any
  // other document, budget-capped and ledger-recorded.
  const selectedIds = resolveSelectionDocumentIds(context, selection)
  if (selectedIds.length === 0) {
    if (options.allowEmptySelection) {
      const recordsById = new Map(context.documents.map((record) => [record.id, record]))
      // An empty scope must not expose catalog metadata for the model to use
      // as a guessing surface. The user must select or confirm documents.
      const promptRecords: DocumentCatalogRecord[] = []
      return ok({
        selectedRecords: [],
        recordsById,
        currentRecordsById: new Map(recordsById),
        markdownById: new Map(),
        annotations: [],
        promptRecords,
        catalogTruncated: false,
      })
    }
    return error("NOT_FOUND", options.noSelectionMessage)
  }
  const recordsById = new Map(context.documents.map((record) => [record.id, record]))
  const selectedRecords = selectedIds
    .map((documentId) => recordsById.get(documentId))
    .filter((record): record is DocumentCatalogRecord => Boolean(record && !record.deletedAt))
  if (selectedRecords.length !== selectedIds.length) {
    return error("NOT_FOUND", "One or more selected artifacts are no longer available in the workspace catalog.")
  }

  const liveOverrides = options.liveOverrides ?? new Map<string, string>()
  const overriddenRecords = selectedRecords.filter((record) => liveOverrides.has(record.id))
  const catalogRecords = selectedRecords.filter((record) => !liveOverrides.has(record.id))

  // Ambient instructions, not the full workflow body (ODE-504 hybrid model):
  // the definitions stay behind the descriptor and cost the model nothing
  // unless it explicitly asks for the document back.
  const plan = buildContextAcquisitionPlan({
    intent: "understand",
    candidates: catalogRecords.map((record, index) => ({
      documentId: record.id,
      documentVersion: artifactVersionKey(record),
      purpose: options.contextPurpose,
      priority: index,
      required: true,
    })),
    budget: {
      maxInputTokens: Number.MAX_SAFE_INTEGER,
      maxDocuments: selectedIds.length,
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxRetrievalRounds: Number.MAX_SAFE_INTEGER,
    },
  })

  const bundle = catalogRecords.length > 0
    ? await resolveEvidenceBundle(plan, {
        store: contextServices.store,
        ledger: contextServices.ledger,
        readBody: async (documentId) => {
          const result = await tools.read({ documentId, approval: createInternalReadApproval(documentId) })
          if (result.error || !result.data) {
            return { ok: false, errorMessage: result.error?.message ?? `Document ${documentId} could not be read.` }
          }
          const document = result.data.document
          return {
            ok: true,
            markdown: document.markdown,
            documentVersion: artifactVersionKey(document.catalogRecord),
            raw: document.catalogRecord,
          }
        },
      })
    : { intent: plan.intent, entries: [], omitted: [], budgetExhausted: false }

  if (bundle.entries.length !== catalogRecords.length) {
    const stoppedOn = bundle.omitted.at(-1) ?? null
    if (stoppedOn?.reason === "budget_exhausted") {
      return error(
        "INVALID_INPUT",
        "The selected artifacts are too large to review together. Narrow the selection so the agent can use complete document evidence.",
      )
    }
    return error("NOT_FOUND", stoppedOn?.reason ?? "One or more selected artifacts could not be read.")
  }

  const markdownById = new Map<string, string>()
  // Seeded from `context.documents` — the catalog snapshot this very
  // request already loaded — so it starts out fresh for every selected
  // record, cached content or not.
  const currentRecordsById = new Map(recordsById)
  const annotations: WorkspaceClassificationAnnotation[] = []
  for (const entry of bundle.entries) {
    markdownById.set(entry.documentId, entry.content)
    // The cache keys on content hash only (ODE-501), so a cache hit's
    // `raw` can be an older catalog record whose status/version/etc.
    // changed since without touching the content — using it here would
    // silently serve that stale metadata over what `context.documents`
    // already gave us for this same request (ODE-501 follow-up). Only a
    // fresh read's `raw` — captured in the same request as `context` — is
    // trusted to overwrite the seeded value.
    const catalogRecord = !entry.cacheHit ? entry.raw as DocumentCatalogRecord | undefined : undefined
    if (catalogRecord) currentRecordsById.set(entry.documentId, catalogRecord)
    annotations.push(...annotationEvidence(entry.documentId, entry.content))
  }
  for (const record of overriddenRecords) {
    const markdown = liveOverrides.get(record.id) ?? ""
    markdownById.set(record.id, markdown)
    annotations.push(...annotationEvidence(record.id, markdown))
    contextServices.ledger.record({
      ts: Date.now(),
      documentId: record.id,
      documentVersion: "live",
      representation: "full",
      tokens: estimateTokenCount(markdown),
      cacheHit: false,
      reason: "live-override: unsaved editor content, bypasses the artifact cache",
    })
  }

  // Only explicitly selected records are sent to the model. A catalog slice
  // is not an authorization to infer document scope.
  const promptRecords = [...selectedRecords]

  return ok({
    selectedRecords,
    recordsById,
    currentRecordsById,
    markdownById,
    annotations,
    promptRecords,
    catalogTruncated: false,
  })
}

function requestedDocumentsFrom(
  requestedDocumentIds: readonly string[],
  recordsById: ReadonlyMap<string, DocumentCatalogRecord>,
  selectedRecordSet: ReadonlySet<string>,
  markdownById: ReadonlyMap<string, string>,
  availableRecordIds: ReadonlySet<string> = new Set(recordsById.keys()),
): { requestedDocumentIds: string[]; requestedDocuments: WorkspaceAgentClassificationRequestedDocument[] } {
  const filteredIds = [...new Set(requestedDocumentIds)].filter((documentId) => {
    const record = recordsById.get(documentId)
    return Boolean(availableRecordIds.has(documentId) && record && !record.deletedAt && !selectedRecordSet.has(documentId) && !markdownById.has(documentId))
  })
  const requestedDocuments = filteredIds.flatMap((documentId) => {
    const record = recordsById.get(documentId)
    if (!record) return []
    return [{
      documentId,
      title: record.title?.trim() || record.binding?.relativePath || documentId,
      path: record.binding?.relativePath ?? null,
    }]
  })
  return { requestedDocumentIds: filteredIds, requestedDocuments }
}

function activeVocabularyKey(
  vocabulary: ReturnType<typeof getVocabularyCatalogSnapshot>,
  kind: "type" | "status",
  key: string | null,
): string | null {
  if (!key) return null
  return vocabulary.some((item) => item.kind === kind && item.key === key && !item.hidden) ? key : null
}

function classificationSnapshotMatches(
  record: DocumentCatalogRecord,
  snapshot: ClassificationEvidenceSource,
): boolean {
  if (snapshot.contentHash !== null) return record.binding?.contentHash === snapshot.contentHash
  return record.version === snapshot.version && record.modifiedAt === snapshot.modifiedAt
}

function missingClassificationProposal(targetRecord: DocumentCatalogRecord): ClassificationProposal {
  const currentArtifactType = targetRecord.artifactType ?? null
  const currentStatus = targetRecord.status ?? null
  return {
    documentId: targetRecord.id,
    documentTitle: targetRecord.title?.trim() || targetRecord.binding?.relativePath || targetRecord.id,
    documentPath: targetRecord.binding?.relativePath ?? null,
    currentArtifactType,
    currentStatus,
    artifactType: currentArtifactType,
    status: currentStatus,
    decision: "needs-review",
    change: "No semantic decision was returned for this artifact.",
    benefit: "Keeps metadata unchanged instead of hiding an incomplete analysis.",
    uncertainty: "The AI response omitted this selected artifact; review it again before changing metadata.",
    sourceContentHash: targetRecord.binding?.contentHash ?? null,
    sourceVersion: targetRecord.version ?? null,
    sourceModifiedAt: targetRecord.modifiedAt ?? null,
    evidenceSources: [],
    evidence: [],
    reason: "No model proposal was returned for the selected artifact.",
  }
}

function normalizeClassificationProposal(
  modelProposal: WorkspaceClassificationResult["proposals"][number],
  targetRecord: DocumentCatalogRecord,
  recordsById: ReadonlyMap<string, DocumentCatalogRecord>,
  markdownById: ReadonlyMap<string, string>,
  vocabulary: ReturnType<typeof getVocabularyCatalogSnapshot>,
): ClassificationProposal {
  const proposedArtifactType = activeVocabularyKey(vocabulary, "type", modelProposal.proposedArtifactType)
  const proposedStatus = activeVocabularyKey(vocabulary, "status", modelProposal.proposedStatus)
  const invalidType = modelProposal.proposedArtifactType !== null && !proposedArtifactType
  const invalidStatus = modelProposal.proposedStatus !== null && !proposedStatus
  const validEvidence: EvidenceCitation[] = []

  for (const item of modelProposal.evidence) {
    const source = recordsById.get(item.documentId)
    const markdown = markdownById.get(item.documentId)
    if (!source || markdown === undefined) continue
    const line = lineForQuote(markdown, item.quote)
    if (line === null) continue
    validEvidence.push({
      kind: "document",
      sourceId: source.id,
      label: source.title?.trim() || source.binding?.relativePath || source.id,
      detail: `line ${line}: ${item.reason}`,
      quote: item.quote,
      line,
    })
  }

  const currentArtifactType = targetRecord.artifactType ?? null
  const currentStatus = targetRecord.status ?? null
  const metadataChanged = proposedArtifactType !== currentArtifactType || proposedStatus !== currentStatus
  const hasTargetEvidence = validEvidence.some((item) => item.sourceId === targetRecord.id)
  const warnings = [
    modelProposal.uncertainty,
    invalidType ? `The proposed type "${modelProposal.proposedArtifactType}" is not active in the current vocabulary.` : null,
    invalidStatus ? `The proposed status "${modelProposal.proposedStatus}" is not active in the current vocabulary.` : null,
    validEvidence.length === 0 ? "No exact evidence quote could be verified against the current document content." : null,
    validEvidence.length > 0 && !hasTargetEvidence ? "The proposal has no exact quote from the artifact being classified." : null,
  ].filter((value): value is string => Boolean(value?.trim()))

  let decision = modelProposal.decision
  if (invalidType || invalidStatus || validEvidence.length === 0 || !hasTargetEvidence) decision = "needs-review"
  if (decision === "keep" && metadataChanged) decision = "needs-review"
  if (decision === "change" && !metadataChanged) decision = "keep"

  return {
    documentId: targetRecord.id,
    documentTitle: targetRecord.title?.trim() || targetRecord.binding?.relativePath || targetRecord.id,
    documentPath: targetRecord.binding?.relativePath ?? null,
    currentArtifactType,
    currentStatus,
    artifactType: proposedArtifactType,
    status: proposedStatus,
    decision,
    change: modelProposal.change,
    benefit: modelProposal.benefit,
    uncertainty: warnings.length > 0 ? warnings.join(" ") : null,
    sourceContentHash: targetRecord.binding?.contentHash ?? null,
    sourceVersion: targetRecord.version ?? null,
    sourceModifiedAt: targetRecord.modifiedAt ?? null,
    evidenceSources: [...new Set(validEvidence.map((item) => item.sourceId))].flatMap((documentId) => {
      const source = recordsById.get(documentId)
      if (!source) return []
      return [{
        documentId: source.id,
        contentHash: source.binding?.contentHash ?? null,
        version: source.version ?? null,
        modifiedAt: source.modifiedAt ?? null,
      }]
    }),
    evidence: validEvidence,
    reason: modelProposal.rationale,
  }
}

export type WorkspaceAgentService = {
  getContext(): Promise<ServiceResponse<WorkspaceAgentContext>>
  /** Read-only observability over what this session actually incorporated (ODE-501 ledger). */
  contextLedger: ContextLedger
  proposeWorkflow(readApproval?: WorkspaceAgentApproval): Promise<ServiceResponse<WorkflowDraftProposal>>
  applyWorkflow(
    proposal: WorkflowDraftProposal,
    approval: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  findBrokenReferences(workflowReadApproval?: WorkspaceAgentApproval): Promise<ServiceResponse<BrokenReferenceProposal[]>>
  applyBrokenReference(
    proposal: BrokenReferenceProposal,
    replacementReference: string,
    approvals: BrokenReferenceFixApprovals,
  ): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  /** Deletes the broken mention from the source instead of repointing it (a link collapses to its plain-text label; a `#slug` mention is removed). */
  removeBrokenReference(
    proposal: BrokenReferenceProposal,
    approvals: BrokenReferenceFixApprovals,
  ): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  /** Creates a new, empty document at the exact path the broken reference points to, so the existing link resolves without editing the source. Path references only. */
  createDocumentForBrokenReference(
    proposal: BrokenReferenceProposal,
    approval: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  findContradictions(
    documentIds: string[],
    readApprovals: Readonly<Record<string, WorkspaceAgentApproval>>,
    workflowReadApproval?: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentContradictionsRun>>
  resolveContradiction(
    proposal: ContradictionProposal,
    resolution: ContradictionResolution,
    approvals?: { read: WorkspaceAgentApproval; edit: WorkspaceAgentApproval },
  ): Promise<ServiceResponse<ContradictionResolutionResult>>
  suggestClassification(
    input: WorkspaceAgentClassificationInput,
  ): Promise<ServiceResponse<WorkspaceAgentClassificationRun>>
  askAgent(
    input: WorkspaceAgentAskInput,
  ): Promise<ServiceResponse<WorkspaceAgentAskRun>>
  runSemanticReview(
    input: WorkspaceAgentSemanticReviewInput,
  ): Promise<ServiceResponse<WorkspaceAgentSemanticReviewRun>>
  reviewDocumentRelations(
    input: WorkspaceAgentDocumentRelationsInput,
  ): Promise<ServiceResponse<WorkspaceAgentDocumentRelationsRun>>
  reviewMerge(
    documentIds: readonly string[],
    readApprovals: Readonly<Record<string, WorkspaceAgentApproval>>,
    execution?: WorkspaceExecutionContext | null,
    signal?: AbortSignal,
  ): Promise<ServiceResponse<WorkspaceAgentMergeReviewRun>>
  createMergedDocument(
    input: WorkspaceAgentMergeCreateInput,
  ): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  /**
   * Presentation stage of the pipeline (ODE-491): phrases facts already
   * established by a predetermined action's deterministic result as one
   * chat note, in the conversation's language and tone, without adding or
   * dropping a finding. Always resolves to a usable note — falls back to a
   * plain join of the facts if the AI call fails — so the chat can never
   * go silent over a presentation failure.
   */
  presentNote(
    kind: WorkspaceToolPresentationRequest["kind"],
    facts: readonly string[],
    sessionContext?: readonly string[],
    execution?: WorkspaceExecutionContext | null,
  ): Promise<WorkspaceAgentPresentationRun>
  applyClassification(
    proposal: ClassificationProposal,
    approval: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  findArchiveCandidates(
    options?: { now?: number; staleAfterDays?: number; duplicateThreshold?: number },
    workflowReadApproval?: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<ArchiveCandidate[]>>
  applyArchiveCandidate(
    candidate: ArchiveCandidate,
    approval: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  tools: WorkspaceAgentToolsService
}

export type ContradictionResolutionResult = {
  proposal: ContradictionProposal
  resolution: ContradictionResolution
  resolvedDocumentId: string | null
  mutation: WorkspaceAgentMutationResult | null
}

function mergeSectionStatus(classification: WorkspaceMergeReviewResult["sections"][number]["classification"]): MergeSection["status"] {
  if (classification === "equivalent" || classification === "style_only") return "unified"
  if (classification === "complementary") return "complementary"
  if (classification === "contradictory") return "conflict"
  if (classification === "irrelevant") return "irrelevant"
  return "insufficient_evidence"
}

function defaultMergeDestinationName(sources: readonly WorkspaceMergeSource[]): string {
  const prefix = sources
    .slice(0, 2)
    .map((source) => source.title.replace(/\.md$/i, "").split(/[\s_-]+/u)[0]?.replace(/[^\p{L}\p{N}]/gu, "") ?? "")
    .filter(Boolean)
    .join("-")
    .toLocaleLowerCase()
  return normalizeMergeDestinationName(`${prefix || "documento"}-unificado.md`) ?? "documento-unificado.md"
}

function mapMergeReview(
  review: WorkspaceMergeReviewResult,
  request: { sources: readonly WorkspaceMergeSource[]; boundedSections: readonly MergeAlignedSection[] },
): MergeReviewToolResult {
  const alignedById = new Map(request.boundedSections.map((section) => [section.sectionId, section]))
  const sourceDocuments = request.sources.map((source) => ({
    documentId: source.documentId,
    title: source.title,
    documentVersion: source.documentVersion,
    contentHash: source.contentHash,
  }))
  const sections = review.sections.flatMap((result) => {
    const aligned = alignedById.get(result.sectionId)
    if (!aligned) return []
    const sources: MergeSectionSource[] = aligned.sources.map((source) => ({
      documentId: source.documentId,
      title: source.title,
      evidenceId: source.evidenceId,
      documentVersion: source.documentVersion,
      contentHash: source.contentHash,
      lineRange: lineRangeForMergeSource(source),
      quote: source.text,
    }))
    const status = mergeSectionStatus(result.classification)
    const evidenceLabel = result.evidenceIds.length > 0 ? `evidence ${result.evidenceIds.join(", ")}` : "sin evidencia"
    const sourceLabel = [...new Set(sources.map((source) => source.title))].join(", ")
    return [{
      id: result.sectionId,
      heading: result.heading,
      headingLevel: result.headingLevel,
      status,
      body: result.unifiedText ?? "",
      provenance: `Síntesis ${result.classification} · ${sourceLabel} · ${evidenceLabel}`,
      // A generated synthesis has no hidden winner. Conflicts are selected
      // explicitly in the review card; safe sections show all provenance.
      primarySourceDocumentId: null,
      suggestedSourceDocumentId: result.suggestedSourceDocumentId,
      suggestedSourceReason: result.suggestedSourceReason,
      rationale: result.rationale,
      confidence: result.confidence,
      evidenceIds: result.evidenceIds,
      sources,
      complementary: [],
    } satisfies MergeSection]
  })
  return {
    destinationName: defaultMergeDestinationName(request.sources),
    sourceDocuments,
    sections,
    status: review.status,
    coverage: review.coverage,
    rounds: review.rounds,
    evidence: review.evidence,
    usage: review.usage,
    executionReceipt: review.executionReceipt,
    error: review.error,
    sourceSnapshots: Object.fromEntries(request.sources.map((source) => [source.documentId, {
      documentVersion: source.documentVersion,
      contentHash: source.contentHash,
    }])),
  }
}

export function buildMergedDocumentMarkdown(
  sections: readonly MergeSection[],
  selections: ReadonlyMap<string, WorkspaceAgentMergeSectionSelection>,
): string {
  const blocks = sections.flatMap((section) => {
    if (section.status === "irrelevant") return []
    const selection = selections.get(section.id)
    const body = selection?.body.trim() ?? ""
    if (!body || section.status === "insufficient_evidence") return []
    return [`${"#".repeat(section.headingLevel)} ${section.heading.trim()}\n\n${body}`]
  })
  return blocks.join("\n\n")
}

export async function createWorkspaceAgentService(
  workspaceRootPath: string,
  tools: WorkspaceAgentToolsService,
): Promise<WorkspaceAgentService> {
  const getContext = async (): Promise<ServiceResponse<WorkspaceAgentContext>> => loadContext(workspaceRootPath)
  // Session-scoped context cache and ledger (ODE-501): one per service
  // instance, so artifacts are reused across turns of the same Workspace
  // Agent session without leaking across separate workspaces or requests.
  const contextArtifactStore = createContextArtifactStore()
  const contextLedger = createContextLedger()
  const contextServices = { store: contextArtifactStore, ledger: contextLedger }
  const readDocumentsInOrder = (
    documentIds: readonly string[],
    approvals: Readonly<Record<string, WorkspaceAgentApproval>>,
  ) => Promise.all(documentIds.map(async (documentId) => ({
    documentId,
    read: await tools.read({ documentId, approval: approvals[documentId]! }),
  })))

  /**
   * Shared read of the full workflow.md body, served through the session
   * artifact cache (ODE-501) under the canonical `full-markdown-v1` policy —
   * the same key the evidence bundle uses for materialization, so the second
   * bounded round never re-reads a file whose full body is already cached.
   * This module records nothing in the ledger: what a read means depends on
   * how the caller incorporates it (ambient instructions vs full evidence).
   */
  const readWorkflowMarkdown = async (
    context: WorkspaceAgentContext,
    readApproval?: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<{ markdown: string; version: string; cacheHit: boolean }>> => {
    const workflow = context.existingWorkflow
    if (!workflow) return error("NOT_FOUND", "No workflow.md exists in this workspace.")
    if (!readApproval) {
      return error("FORBIDDEN", "Reading an existing workflow.md requires a workflow-specific read approval.")
    }
    const documentVersion = artifactVersionKey(workflow)
    const cacheKey = { documentId: workflow.id, documentVersion, representation: "full" as const, extractionPolicy: DEFAULT_EXTRACTION_POLICY }
    const cached = contextServices.store.get(cacheKey)
    if (cached) {
      return ok({ markdown: cached.content, version: documentVersion, cacheHit: true })
    }
    const read = await tools.read({ documentId: workflow.id, approval: readApproval })
    if (read.error || !read.data) {
      return error(read.error?.code ?? "NOT_FOUND", read.error?.message ?? "workflow.md could not be loaded.")
    }
    const markdown = read.data.document.markdown
    contextServices.store.set({
      documentId: workflow.id,
      documentVersion,
      representation: "full",
      extractionPolicy: DEFAULT_EXTRACTION_POLICY,
      content: markdown,
      citations: [],
      tokenCount: estimateTokenCount(markdown),
      byteCount: markdown.length,
      createdAt: Date.now(),
      raw: { markdown },
    })
    return ok({ markdown, version: documentVersion, cacheHit: false })
  }

  /**
   * Full workflow.md body — for callers that must materialize the whole
   * document (drafting/updating it). Not for ambient chat context.
   */
  const withWorkflowMarkdown = async (
    context: ServiceResponse<WorkspaceAgentContext>,
    readApproval?: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentContext>> => {
    if (context.error || !context.data || !context.data.existingWorkflow) return context
    const read = await readWorkflowMarkdown(context.data, readApproval)
    if (read.error || !read.data) return read as ServiceResponse<WorkspaceAgentContext>
    contextServices.ledger.record({
      ts: Date.now(),
      documentId: context.data.existingWorkflow.id,
      documentVersion: read.data.version,
      representation: "full",
      tokens: estimateTokenCount(read.data.markdown),
      cacheHit: read.data.cacheHit,
      reason: "workflow.md materialized in full for drafting (proposeWorkflow, ODE-504)",
    })
    return ok<WorkspaceAgentContext>({ ...context.data, workflowMarkdown: read.data.markdown })
  }

  /**
   * Hybrid instructions load (ODE-504): the instructions section rides every
   * invocation as ambient context; the executable definitions stay behind
   * the descriptor and are only fetched on explicit request. The ledger
   * records what was incorporated — instruction tokens, never the full
   * document's — whether the body came fresh or from the artifact cache.
   */
  const withWorkflowInstructions = async (
    context: ServiceResponse<WorkspaceAgentContext>,
    readApproval?: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentContext>> => {
    if (context.error || !context.data || !context.data.existingWorkflow) return context
    const read = await readWorkflowMarkdown(context.data, readApproval)
    if (read.error || !read.data) return read as ServiceResponse<WorkspaceAgentContext>
    const split = splitWorkflowMarkdown(read.data.markdown)
    const instructions = split.instructions.length > 0 ? split.instructions : null
    if (instructions) {
      contextServices.ledger.record({
        ts: Date.now(),
        documentId: context.data.existingWorkflow.id,
        documentVersion: read.data.version,
        representation: "instructions",
        tokens: estimateTokenCount(instructions),
        cacheHit: read.data.cacheHit,
        reason: "ambient workflow instructions (hybrid split, ODE-504)",
      })
    }
    return ok<WorkspaceAgentContext>({
      ...context.data,
      workflowMarkdown: null,
      workflowInstructions: instructions,
      workflowDescriptor: {
        documentId: context.data.existingWorkflow.id,
        version: read.data.version,
        instructionsTruncated: split.instructionsTruncated,
        definitionsChars: split.definitions?.length ?? 0,
        scopeSummary: split.scopeSummary,
      },
    })
  }

  const getContextWithWorkflow = async (
    workflowReadApproval?: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentContext>> => withWorkflowMarkdown(await getContext(), workflowReadApproval)

  const getContextWithWorkflowInstructions = async (
    workflowReadApproval?: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentContext>> => withWorkflowInstructions(await getContext(), workflowReadApproval)

  const runSemanticReview = async (
    input: WorkspaceAgentSemanticReviewInput,
  ): Promise<ServiceResponse<WorkspaceAgentSemanticReviewRun>> => {
    const execution = input.execution ?? createWorkspaceExecutionContext(
      input.operation,
      "desktop",
      input.operation === "merge" ? "synthesis" : "semantic-review",
    )
    const knownDocuments = new Map(
      input.initialEvidence.map((item) => [item.documentId, {
        documentVersion: item.documentVersion,
        contentHash: item.contentHash,
      }] as const),
    )

    const readEvidence = async (
      evidenceInput: WorkspaceSemanticReadArguments,
      options?: { signal?: AbortSignal },
    ): Promise<ServiceResponse<WorkspaceAgentEvidenceReadResult>> => {
      if (options?.signal?.aborted) {
        return error("CANCELLED", "Semantic evidence reading was cancelled.")
      }
      const approval = createInternalReadApproval(evidenceInput.documentId)
      const desktopInput: WorkspaceAgentEvidenceReadInput = {
        ...evidenceInput,
        approval,
      }
      if (tools.readEvidence) return tools.readEvidence(desktopInput, options)

      // Compatibility path for older test/runtime adapters while the
      // versioned evidence method rolls out. It still goes through the
      // approval-gated read and rechecks the catalog snapshot before the
      // result is admitted to the model-facing loop.
      const read = await tools.read({ documentId: evidenceInput.documentId, approval })
      if (options?.signal?.aborted) {
        return error("CANCELLED", "Semantic evidence reading was cancelled.")
      }
      if (read.error || !read.data) {
        return error("NOT_FOUND", read.error?.message ?? "Document evidence could not be read.")
      }
      const record = read.data.document.catalogRecord
      if (!matchesDocumentSnapshot(record, {
        documentVersion: evidenceInput.expectedDocumentVersion,
        contentHash: evidenceInput.expectedContentHash,
      })) {
        return error("CONFLICT", "The document changed before semantic evidence could be admitted.")
      }
      const lines = read.data.document.markdown.split("\n")
      if (evidenceInput.lineStart > lines.length) {
        return error("NOT_FOUND", "The requested semantic evidence range is not present in the document.")
      }
      const selected = lines.slice(evidenceInput.lineStart - 1, Math.min(evidenceInput.lineEnd, lines.length)).join("\n")
      const text = selected.slice(0, evidenceInput.maxChars)
      const lineEnd = Math.min(lines.length, evidenceInput.lineStart + Math.max(1, text.split("\n").length) - 1)
      return ok({
        evidence: {
          evidenceId: `${evidenceInput.documentId}:${evidenceInput.expectedDocumentVersion}:${evidenceInput.lineStart}-${lineEnd}`,
          documentId: evidenceInput.documentId,
          documentVersion: evidenceInput.expectedDocumentVersion,
          contentHash: record.binding?.contentHash ?? null,
          lineStart: evidenceInput.lineStart,
          lineEnd,
          text,
        },
        receipt: read.data.receipt,
      })
    }

    const registry = createWorkspaceSemanticToolRegistry({
      knownDocuments,
      allowedToolNames: input.tools?.map((tool) => tool.name),
      readEvidence,
    })
    const activeAIService = getAIService()
    const semanticAIService: Pick<AIService, "runSemanticRound"> = input.operation === "relations"
      && typeof activeAIService.reviewWorkspaceDocumentRelations === "function"
      ? {
          runSemanticRound: (request, options) => activeAIService.reviewWorkspaceDocumentRelations({
            ...request,
            operation: "relations",
          }, options),
        }
      : input.operation === "merge"
        && typeof activeAIService.reviewWorkspaceMerge === "function"
        ? {
            runSemanticRound: (request, options) => activeAIService.reviewWorkspaceMerge({
              ...request,
              operation: "merge",
            }, options),
          }
        : activeAIService
    return runWorkspaceSemanticLoop({
      operation: input.operation,
      execution,
      initialInput: [...input.initialInput],
      initialEvidence: [...input.initialEvidence],
      tools: registry.descriptors,
      registry,
      aiService: semanticAIService,
      signal: input.signal,
      caps: input.caps,
    })
  }

  const runDocumentRelationReview = async (
    documentIds: readonly string[],
    readApprovals: Readonly<Record<string, WorkspaceAgentApproval>>,
    execution?: WorkspaceExecutionContext | null,
    signal?: AbortSignal,
  ): Promise<ServiceResponse<{
    sources: WorkspaceDocumentRelationSource[]
    review: WorkspaceDocumentRelationsResult
  }>> => {
    const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))]
    if (uniqueDocumentIds.length < 1) {
      return error("INVALID_INPUT", "Select at least one artifact for semantic relation review.")
    }
    for (const documentId of uniqueDocumentIds) {
      if (!readApprovals[documentId]) {
        return error("FORBIDDEN", `Reading document ${documentId} requires an explicit approval.`)
      }
    }

    const sources: WorkspaceDocumentRelationSource[] = []
    const reads = await readDocumentsInOrder(uniqueDocumentIds, readApprovals)
    for (const { documentId, read } of reads) {
      if (read.error || !read.data) {
        return error(
          read.error?.code ?? "NOT_FOUND",
          read.error?.message ?? `Document ${documentId} could not be read.`,
        )
      }
      const document = read.data.document
      if (document.catalogRecord.deletedAt) {
        return error("NOT_FOUND", `Document ${documentId} is no longer active in the workspace.`)
      }
      sources.push({
        documentId: document.documentId,
        title: document.title?.trim() || document.catalogRecord.title || document.documentId,
        documentVersion: artifactVersionKey(document.catalogRecord),
        contentHash: document.catalogRecord.binding?.contentHash ?? null,
        updatedAt: typeof document.catalogRecord.modifiedAt === "number"
          ? new Date(document.catalogRecord.modifiedAt).toISOString()
          : null,
        markdown: document.markdown,
      })
    }

    const request = buildWorkspaceDocumentRelationsRequest(sources)
    if (!request.contextComplete) {
      return error(
        "BUDGET_EXCEEDED",
        request.contextError ?? "The selected documents do not fit in the bounded relation context.",
      )
    }
    const reviewResponse = await runSemanticReview({
      operation: "relations",
      initialEvidence: request.initialEvidence,
      initialInput: request.initialInput,
      execution: execution ?? createWorkspaceExecutionContext("relations", "desktop", "semantic-review"),
      signal,
    })
    if (reviewResponse.error || !reviewResponse.data) {
      return error(
        reviewResponse.error?.code ?? "AI_REQUEST_FAILED",
        reviewResponse.error?.message ?? "Semantic relation review could not be completed.",
      )
    }
    return ok({
      sources,
      review: parseWorkspaceDocumentRelationsResult(reviewResponse.data, request),
    })
  }

  return {
    tools,
    getContext,
    contextLedger: contextLedger,
    runSemanticReview,
    async proposeWorkflow(readApproval) {
      const context = await withWorkflowMarkdown(await getContext(), readApproval)
      if (context.error || !context.data) return context as ServiceResponse<WorkflowDraftProposal>
      return ok(buildWorkflowDraft({
        rootPath: context.data.rootPath,
        documents: context.data.documents,
        collections: context.data.collections,
        existingWorkflow: context.data.existingWorkflow
          ? { documentId: context.data.existingWorkflow.id, markdown: context.data.workflowMarkdown ?? "" }
          : null,
      }))
    },
    async applyWorkflow(proposal, approval) {
      const target = proposal.existingDocumentId
        ? { documentId: proposal.existingDocumentId as string }
        : { canonicalPath: proposal.canonicalPath }
      return tools.write({ target, markdown: proposal.markdown, approval })
    },
    async findBrokenReferences(workflowReadApproval) {
      const context = await getContextWithWorkflow(workflowReadApproval)
      if (context.error || !context.data) return context as ServiceResponse<BrokenReferenceProposal[]>
      return ok(detectBrokenDocumentReferences(context.data.documents))
    },
    async applyBrokenReference(proposal, replacementReference, approvals) {
      if (!approvals) return error("FORBIDDEN", "Applying a broken reference requires read and edit approvals for the source document.")
      const read = await tools.read({ documentId: proposal.sourceDocumentId, approval: approvals.read })
      if (read.error || !read.data) {
        return error(
          read.error?.code ?? "NOT_FOUND",
          read.error?.message ?? `Document ${proposal.sourceDocumentId} could not be read.`,
        )
      }
      const markdown = replaceBrokenDocumentReference(read.data.document.markdown, proposal, replacementReference)
      if (markdown === null) {
        return error("CONFLICT", `The reference in ${proposal.sourceTitle} changed since this fix was proposed.`)
      }
      const mutation = await tools.edit({
        documentId: proposal.sourceDocumentId,
        markdown,
        approval: approvals.edit,
      })
      if (mutation.error || !mutation.data) return mutation
      return ok(mutation.data)
    },
    async removeBrokenReference(proposal, approvals) {
      if (!approvals) return error("FORBIDDEN", "Removing a broken reference requires read and edit approvals for the source document.")
      const read = await tools.read({ documentId: proposal.sourceDocumentId, approval: approvals.read })
      if (read.error || !read.data) {
        return error(
          read.error?.code ?? "NOT_FOUND",
          read.error?.message ?? `Document ${proposal.sourceDocumentId} could not be read.`,
        )
      }
      const markdown = removeBrokenDocumentReference(read.data.document.markdown, proposal)
      if (markdown === null) {
        return error("CONFLICT", `The reference in ${proposal.sourceTitle} changed since this fix was proposed.`)
      }
      const mutation = await tools.edit({
        documentId: proposal.sourceDocumentId,
        markdown,
        approval: approvals.edit,
      })
      if (mutation.error || !mutation.data) return mutation
      return ok(mutation.data)
    },
    async createDocumentForBrokenReference(proposal, approval) {
      if (proposal.referenceKind !== "path") {
        return error("INVALID_INPUT", "Only a path reference can be created as a new document; a slug has no filesystem path.")
      }
      const context = await getContext()
      if (context.error || !context.data) return context as ServiceResponse<WorkspaceAgentMutationResult>
      const source = context.data.documents.find((record) => record.id === proposal.sourceDocumentId && !record.deletedAt)
      if (!source) return error("NOT_FOUND", `Document ${proposal.sourceDocumentId} was not found in the workspace.`)
      const relativePath = resolveBrokenReferenceTargetPath(source, proposal)
      if (!relativePath) {
        return error("INVALID_INPUT", "This reference could not be resolved to a workspace path.")
      }
      const canonicalPath = `${normalizePath(workspaceRootPath)}/${relativePath}`
      const title = relativePath.split("/").pop()?.replace(/\.md$/i, "") || relativePath
      return tools.write({ target: { canonicalPath }, markdown: `# ${title}\n`, approval })
    },
    async findContradictions(documentIds, readApprovals, workflowReadApproval) {
      const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))]
      if (uniqueDocumentIds.length < 1) {
        return error("INVALID_INPUT", "Select at least one artifact to compare contradictions.")
      }

      const context = await getContextWithWorkflow(workflowReadApproval)
      if (context.error || !context.data) return context as ServiceResponse<WorkspaceAgentContradictionsRun>

      const relationReview = await runDocumentRelationReview(uniqueDocumentIds, readApprovals)
      if (relationReview.error || !relationReview.data) {
        return error(
          relationReview.error?.code ?? "AI_REQUEST_FAILED",
          relationReview.error?.message ?? "Semantic contradiction review could not be completed.",
        )
      }
      const mapped = mapSemanticRelationsToContradictions(relationReview.data.review, relationReview.data.sources)
      return ok({
        ...mapped,
        review: relationReview.data.review,
      })
    },
    async resolveContradiction(proposal, resolution, approvals) {
      if (resolution === "discard") {
        return ok({ proposal, resolution, resolvedDocumentId: null, mutation: null })
      }
      if (proposal.semanticVerdict !== "contradictory" || proposal.semanticConfidence !== "high") {
        return error("INVALID_INPUT", "Only high-confidence semantic contradictions can be resolved automatically.")
      }
      if (!approvals) {
        return error("FORBIDDEN", "Resolving a contradiction requires read and edit approvals for the target document.")
      }

      const selected = resolution === "left" ? proposal.left : proposal.right
      const target = resolution === "left" ? proposal.right : proposal.left
      const semanticSnapshots = proposal.semanticSourceSnapshots
      if (
        !semanticSnapshots
        || !semanticSnapshots[selected.documentId]
        || !semanticSnapshots[target.documentId]
      ) {
        return error("INVALID_INPUT", "The contradiction has no versioned semantic snapshots and must be reviewed again before resolution.")
      }
      const read = await tools.read({ documentId: target.documentId, approval: approvals.read })
      if (read.error || !read.data) return error("NOT_FOUND", read.error?.message ?? `Document ${target.documentId} could not be read.`)
      const targetSnapshot = semanticSnapshots[target.documentId]
      if (!matchesDocumentSnapshot(read.data.document.catalogRecord, targetSnapshot)) {
        return error("CONFLICT", `The evidence in ${target.title} changed since this contradiction was proposed.`)
      }

      const selectedRead = await tools.read({
        documentId: selected.documentId,
        approval: createInternalReadApproval(selected.documentId),
      })
      if (selectedRead.error || !selectedRead.data) {
        return error("CONFLICT", `The evidence in ${selected.title} is no longer available for this contradiction.`)
      }
      if (!matchesDocumentSnapshot(selectedRead.data.document.catalogRecord, semanticSnapshots[selected.documentId])) {
        return error("CONFLICT", `The evidence in ${selected.title} changed since this contradiction was proposed.`)
      }
      const markdown = replaceContradictionFragment(read.data.document.markdown, target.fragment, selected.fragment.text)
      if (markdown === null) {
        return error("CONFLICT", `The evidence in ${target.title} changed since this contradiction was proposed.`)
      }

      const mutation = await tools.edit({
        documentId: target.documentId,
        markdown,
        approval: approvals.edit,
      })
      if (mutation.error || !mutation.data) return mutation as ServiceResponse<ContradictionResolutionResult>
      return ok({
        proposal,
        resolution,
        resolvedDocumentId: target.documentId,
        mutation: mutation.data,
      })
    },
    async suggestClassification(input) {
      const execution = input.execution ?? createWorkspaceExecutionContext("classification", "desktop")
      const requestedText = input.request?.trim() || DEFAULT_CLASSIFICATION_REQUEST
      const context = await getContextWithWorkflowInstructions(input.workflowReadApproval)
      if (context.error || !context.data) return context as ServiceResponse<WorkspaceAgentClassificationRun>

      const prepared = await prepareDocumentEvidence(context.data, input.selection, tools, {
        noSelectionMessage: "Select at least one local artifact before asking for a semantic classification.",
        contextPurpose: "classification-evidence",
      }, contextServices)
      if (prepared.error || !prepared.data) return prepared as ServiceResponse<WorkspaceAgentClassificationRun>
      const { selectedRecords, recordsById, currentRecordsById, markdownById, annotations, promptRecords, catalogTruncated } = prepared.data

      const vocabulary = getVocabularyCatalogSnapshot()
        .filter((item) => !item.hidden)
        .map((item) => ({
          kind: item.kind,
          key: item.key,
          name: item.name,
          description: item.description,
          isRequired: item.isRequired,
        }))
      const aiRequest: WorkspaceClassificationRequest = {
        request: requestedText.slice(0, 2_000),
        targetDocumentIds: selectedRecords.map((record) => record.id),
        documents: promptRecords.map((record) => documentForClassification(
          currentRecordsById.get(record.id) ?? record,
          markdownById.get(record.id) ?? null,
        )),
        collections: context.data.collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          description: collection.description,
          writingsCount: collection.writingsCount,
        })),
        documentCollectionIds: context.data.documentCollectionIds,
        annotations,
        vocabulary,
        workflow: {
          instructions: context.data.workflowInstructions,
          descriptor: context.data.workflowDescriptor,
        },
        catalogTruncated,
        execution,
      }
      const aiResult = await getAIService().classifyWorkspace(aiRequest)
      if (aiResult.error || !aiResult.data) {
        return error(aiResult.error?.code ?? "AI_REQUEST_FAILED", aiResult.error?.message ?? "Workspace classification could not be completed.")
      }

      const seenProposalIds = new Set<string>()
      const modelProposalsById = new Map<string, WorkspaceClassificationResult["proposals"][number]>()
      for (const modelProposal of aiResult.data.proposals) {
        if (!seenProposalIds.has(modelProposal.documentId)) {
          seenProposalIds.add(modelProposal.documentId)
          modelProposalsById.set(modelProposal.documentId, modelProposal)
        }
      }
      const proposals = selectedRecords.map((record) => {
        const currentRecord = currentRecordsById.get(record.id) ?? record
        const modelProposal = modelProposalsById.get(record.id)
        return modelProposal
          ? normalizeClassificationProposal(
              modelProposal,
              currentRecord,
              currentRecordsById,
              markdownById,
              getVocabularyCatalogSnapshot(),
            )
          : missingClassificationProposal(currentRecord)
      })
      const selectedRecordSet = new Set(selectedRecords.map((record) => record.id))
      const { requestedDocumentIds, requestedDocuments } = requestedDocumentsFrom(
        aiResult.data.requestedDocumentIds,
        recordsById,
        selectedRecordSet,
        markdownById,
        new Set(promptRecords.map((record) => record.id)),
      )

      return ok({
        summary: aiResult.data.summary,
        proposals,
        requestedDocumentIds,
        requestedDocuments,
        targetDocumentIds: selectedRecords.map((record) => record.id),
        executionContext: execution,
        executionReceipt: aiResult.data.executionReceipt ?? null,
      })
    },
    async askAgent(input) {
      const execution = input.execution ?? createWorkspaceExecutionContext("ask", "desktop")
      const context = await getContextWithWorkflowInstructions(input.workflowReadApproval)
      if (context.error || !context.data) return context as ServiceResponse<WorkspaceAgentAskRun>
      const contextData = context.data

      const liveOverrides = input.liveOverride ? new Map([[input.liveOverride.documentId, input.liveOverride.markdown]]) : undefined
      const focusedDocumentId = input.focusedDocumentId ?? null

      /** One full round: prepare evidence for the explicit selection, then ask the model. */
      const runAskRound = async (
        selection: readonly WorkspaceAgentSelection[],
        roundExecution: WorkspaceExecutionContext,
      ): Promise<ServiceResponse<{ prepared: PreparedDocumentEvidence; aiResult: WorkspaceAskResult }>> => {
        const prepared = await prepareDocumentEvidence(contextData, selection, tools, {
          noSelectionMessage: "Select at least one local artifact before asking the Workspace agent.",
          contextPurpose: "ask-evidence",
          allowEmptySelection: true,
          liveOverrides,
          focusedDocumentId,
        }, contextServices)
        if (prepared.error || !prepared.data) return prepared as ServiceResponse<{ prepared: PreparedDocumentEvidence; aiResult: WorkspaceAskResult }>

        const documents = prepared.data.promptRecords.map((record) => documentForAsk(
          prepared.data!.currentRecordsById.get(record.id) ?? record,
          prepared.data!.markdownById.get(record.id) ?? null,
        ))
        // The schema requires focusedDocumentId to name one of `documents`
        // (lib/ai/workspace-ask.ts). It normally does — prepareDocumentEvidence
        // includes the focused record precisely so this holds — but a stale
        // catalog read right after a mutation (e.g. asking again immediately
        // after applying a classification) can momentarily miss it. Dropping
        // the hint here keeps the request self-consistent instead of having
        // the server reject the whole turn over a hint the model never asked
        // for yet; the chat must not go silent over a mismatch like this.
        const focusedDocumentIdForRequest = focusedDocumentId && documents.some((document) => document.id === focusedDocumentId)
          ? focusedDocumentId
          : null

        const scopeFingerprint = scopeFingerprintFor(workspaceRootPath, "ask", prepared.data.selectedRecords.map((record) => ({
          documentId: record.id,
          documentVersion: artifactVersionKey(prepared.data!.currentRecordsById.get(record.id) ?? record),
          contentHash: (prepared.data!.currentRecordsById.get(record.id) ?? record).binding?.contentHash ?? null,
        })))
        const aiRequest: WorkspaceAskRequest = {
          question: input.question.slice(0, 2_000),
          targetDocumentIds: prepared.data.selectedRecords.map((record) => record.id),
          documents,
          collections: contextData.collections.map((collection) => ({
            id: collection.id,
            name: collection.name,
            description: collection.description,
            writingsCount: collection.writingsCount,
          })),
          documentCollectionIds: contextData.documentCollectionIds,
          annotations: prepared.data.annotations,
          workflow: {
            instructions: contextData.workflowInstructions,
            descriptor: contextData.workflowDescriptor,
          },
          catalogTruncated: prepared.data.catalogTruncated,
          recentSessionActions: input.sessionContext ? [...input.sessionContext] : undefined,
          focusedDocumentId: focusedDocumentIdForRequest,
          previousResponseId: input.previousScopeFingerprint === scopeFingerprint
            ? (input.previousResponseId ?? null)
            : null,
          previousScopeFingerprint: input.previousScopeFingerprint ?? null,
          scopeFingerprint,
          execution: roundExecution,
        }
        const aiResult = await getAIService().askWorkspace(aiRequest)
        if (aiResult.error || !aiResult.data) {
          return error(aiResult.error?.code ?? "AI_REQUEST_FAILED", aiResult.error?.message ?? "The Workspace agent could not answer right now.")
        }
        return ok({ prepared: prepared.data, aiResult: aiResult.data })
      }

      const first = await runAskRound(input.selection, execution)
      if (first.error || !first.data) return first as ServiceResponse<WorkspaceAgentAskRun>

      const { prepared, aiResult } = first.data
      const executionReceipt = aiResult.executionReceipt ?? null

      const { selectedRecords, recordsById, currentRecordsById, markdownById, promptRecords } = prepared

      const validEvidence: WorkspaceAskEvidence[] = aiResult.evidence.filter((item) => markdownById.get(item.documentId)?.includes(item.quote))
      const evidence: EvidenceCitation[] = validEvidence.flatMap((item) => {
        const source = recordsById.get(item.documentId)
        const markdown = markdownById.get(item.documentId)
        if (!source || markdown === undefined) return []
        const line = lineForQuote(markdown, item.quote)
        if (line === null) return []
        return [{
          kind: "document",
          sourceId: source.id,
          label: source.title?.trim() || source.binding?.relativePath || source.id,
          detail: item.reason,
          quote: item.quote,
          line,
        }]
      })
      const selectedRecordSet = new Set(selectedRecords.map((record) => record.id))
      const { requestedDocumentIds, requestedDocuments } = requestedDocumentsFrom(
        aiResult.requestedDocumentIds,
        recordsById,
        selectedRecordSet,
        markdownById,
        new Set(promptRecords.map((record) => record.id)),
      )

      return ok({
        answer: aiResult.answer,
        evidence,
        requestedDocumentIds,
        requestedDocuments,
        targetDocumentIds: selectedRecords.map((record) => record.id),
        documents: promptRecords.map((record) => ({
          documentId: record.id,
          title: record.title?.trim() || record.binding?.relativePath || record.id,
          path: record.binding?.relativePath ?? null,
        })),
        suggestedAction: aiResult.suggestedAction ?? null,
        scopeStatus: aiResult.scopeStatus ?? (selectedRecords.length > 0 ? "ready" : "needs_scope"),
        responseId: aiResult.responseId ?? null,
        scopeFingerprint: scopeFingerprintFor(workspaceRootPath, "ask", selectedRecords.map((record) => ({
          documentId: record.id,
          documentVersion: artifactVersionKey(currentRecordsById.get(record.id) ?? record),
          contentHash: (currentRecordsById.get(record.id) ?? record).binding?.contentHash ?? null,
        }))),
        compactionCount: aiResult.compactionCount ?? 0,
        executionContext: execution,
        executionReceipt,
      })
    },
    async reviewDocumentRelations(input) {
      const relationReview = await runDocumentRelationReview(
        input.documentIds,
        input.readApprovals,
        input.execution,
        input.signal,
      )
      if (relationReview.error || !relationReview.data) {
        return error(
          relationReview.error?.code ?? "AI_REQUEST_FAILED",
          relationReview.error?.message ?? "Semantic relation review could not be completed.",
        )
      }
      return ok(relationReview.data.review)
    },
    async reviewMerge(documentIds, readApprovals, execution, signal) {
      const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))]
      if (uniqueDocumentIds.length < 2) {
        return error("INVALID_INPUT", "Select at least two artifacts to synthesize a merge.")
      }
      for (const documentId of uniqueDocumentIds) {
        if (!readApprovals[documentId]) {
          return error("FORBIDDEN", `Reading document ${documentId} requires an explicit approval.`)
        }
      }

      const context = await getContext()
      if (context.error || !context.data) return context as ServiceResponse<WorkspaceAgentMergeReviewRun>
      const activeIds = new Set(context.data.documents.filter((record) => !record.deletedAt).map((record) => record.id))
      if (uniqueDocumentIds.some((documentId) => !activeIds.has(documentId))) {
        return error("NOT_FOUND", "One or more selected artifacts are no longer available in the workspace catalog.")
      }

      const sources: WorkspaceMergeSource[] = []
      const reads = await readDocumentsInOrder(uniqueDocumentIds, readApprovals)
      for (const { documentId, read } of reads) {
        if (read.error || !read.data) {
          return error(
            read.error?.code ?? "NOT_FOUND",
            read.error?.message ?? `Document ${documentId} could not be read.`,
          )
        }
        const document = read.data.document
        sources.push({
          documentId: document.documentId,
          title: document.title?.trim() || document.catalogRecord.title || document.documentId,
          documentVersion: artifactVersionKey(document.catalogRecord),
          contentHash: document.catalogRecord.binding?.contentHash ?? null,
          markdown: document.markdown,
        })
      }

      const request = buildWorkspaceMergeRequest(sources)
      if (!request.contextComplete) {
        return error(
          "BUDGET_EXCEEDED",
          request.contextError ?? "The selected documents do not fit in the bounded Merge context.",
        )
      }
      const reviewResponse = await runSemanticReview({
        operation: "merge",
        initialEvidence: request.initialEvidence,
        initialInput: request.initialInput,
        execution: execution ?? createWorkspaceExecutionContext("merge", "desktop", "synthesis"),
        signal,
      })
      if (reviewResponse.error || !reviewResponse.data) {
        return error(
          reviewResponse.error?.code ?? "AI_REQUEST_FAILED",
          reviewResponse.error?.message ?? "Workspace merge synthesis could not be completed.",
        )
      }
      const review = parseWorkspaceMergeResult(reviewResponse.data, request)
      return ok(mapMergeReview(review, request))
    },
    async createMergedDocument(input) {
      if (input.draft.status !== "complete" || input.draft.coverage !== "complete" || input.draft.error) {
        return error("INVALID_INPUT", "The merge draft is not complete enough to create a document.")
      }
      const sourceIds = new Set(input.draft.sourceDocuments.map((source) => source.documentId))
      if (
        input.draft.sourceDocuments.length < 2
        || sourceIds.size !== input.draft.sourceDocuments.length
        || input.draft.sections.length === 0
      ) {
        return error("INVALID_INPUT", "The merge draft does not contain any creatable sections.")
      }
      const destinationName = normalizeMergeDestinationName(input.destinationName)
      const canonicalPath = destinationName ? mergeDestinationPath(workspaceRootPath, destinationName) : null
      if (!destinationName || !canonicalPath) {
        return error("INVALID_INPUT", "Choose a valid .md filename in the current workspace root.")
      }
      if (input.approval.action !== "write" || input.approval.resource !== canonicalPath || !input.approval.approved) {
        return error("FORBIDDEN", "Creating the merged document requires explicit write approval for the exact destination.")
      }

      const draftSectionsById = new Map(input.draft.sections.map((section) => [section.id, section]))
      if (draftSectionsById.size !== input.draft.sections.length) {
        return error("INVALID_INPUT", "The merge draft contains duplicate section identities.")
      }
      const sourceDocumentsById = new Map(input.draft.sourceDocuments.map((source) => [source.documentId, source]))
      for (const section of input.draft.sections) {
        const sourceEvidenceIds = new Set(section.sources.map((source) => source.evidenceId))
        if (section.sources.length === 0 || section.sources.some((source) => {
          const document = sourceDocumentsById.get(source.documentId)
          return !document
            || document.documentVersion !== source.documentVersion
            || document.contentHash !== source.contentHash
            || !input.draft.sourceSnapshots[source.documentId]
        }) || section.evidenceIds.some((evidenceId) => !sourceEvidenceIds.has(evidenceId))) {
          return error("INVALID_INPUT", `The provenance for “${section.heading}” is incomplete or outside the selected artifacts.`)
        }
      }
      const selectionsById = new Map<string, WorkspaceAgentMergeSectionSelection>()
      for (const selection of input.sections) {
        if (selectionsById.has(selection.id) || !draftSectionsById.has(selection.id)) {
          return error("INVALID_INPUT", "The merge review contains an unknown or duplicate section selection.")
        }
        if (typeof selection.body !== "string" || selection.body.length > 6_000) {
          return error("INVALID_INPUT", "A merged section exceeds the allowed document size.")
        }
        selectionsById.set(selection.id, selection)
      }
      if (selectionsById.size !== input.draft.sections.length) {
        return error("INVALID_INPUT", "Review every merge section before creating the document.")
      }

      for (const section of input.draft.sections) {
        const selection = selectionsById.get(section.id)!
        if (section.status === "insufficient_evidence") {
          return error("INVALID_INPUT", `The section “${section.heading}” needs more evidence before it can be created.`)
        }
        if (section.status === "irrelevant") {
          if (selection.body.trim() || selection.acceptedUnresolved) {
            return error("INVALID_INPUT", `The irrelevant section “${section.heading}” cannot be included in the merge.`)
          }
          continue
        }
        if (section.status === "conflict") {
          if (selection.acceptedUnresolved) {
            if (selection.primarySourceDocumentId !== null || selection.body !== buildAcceptedUnresolvedMergeBody(section)) {
              return error("INVALID_INPUT", `The unresolved conflict in “${section.heading}” must preserve its approved source claims.`)
            }
            continue
          }
          const chosen = section.sources.find((source) => source.documentId === selection.primarySourceDocumentId)
          if (!chosen || selection.body !== chosen.quote) {
            return error("INVALID_INPUT", `Choose one exact source version for “${section.heading}”, or explicitly accept it unresolved.`)
          }
          continue
        }
        if (
          !selection.body.trim()
          || selection.body.trim() !== section.body.trim()
          || selection.acceptedUnresolved
          || selection.primarySourceDocumentId !== null
        ) {
          return error("INVALID_INPUT", `The synthesized section “${section.heading}” was changed outside its approved review state.`)
        }
      }

      const sourceApprovals = Object.fromEntries(input.draft.sourceDocuments.map((source) => [
        source.documentId,
        createInternalReadApproval(source.documentId),
      ])) satisfies Record<string, WorkspaceAgentApproval>
      const reads = await readDocumentsInOrder(
        input.draft.sourceDocuments.map((source) => source.documentId),
        sourceApprovals,
      )
      for (const { documentId, read } of reads) {
        const source = input.draft.sourceDocuments.find((candidate) => candidate.documentId === documentId)!
        if (read.error || !read.data) {
          return error("CONFLICT", `The source ${source.title} is no longer available; review the merge again.`)
        }
        const expected = input.draft.sourceSnapshots[source.documentId]
        const current = read.data.document.catalogRecord
        if (!expected || !matchesDocumentSnapshot(current, expected)) {
          return error("CONFLICT", `The source ${source.title} changed since this merge was reviewed.`)
        }
      }

      const context = await getContext()
      if (context.error || !context.data) return context as ServiceResponse<WorkspaceAgentMutationResult>
      if (context.data.documents.some((record) => (
        !record.deletedAt
        && normalizePath(record.binding?.canonicalPath ?? "") === normalizePath(canonicalPath)
      ))) {
        return error("CONFLICT", "A document already exists at the requested merge destination.")
      }

      const markdown = buildMergedDocumentMarkdown(input.draft.sections, selectionsById)
      if (!markdown.trim()) return error("INVALID_INPUT", "The reviewed merge has no sections to write.")
      return tools.write({
        target: { canonicalPath },
        markdown,
        approval: input.approval,
        expectedAbsent: true,
      })
    },
    async presentNote(kind, facts, sessionContext, requestedExecution) {
      const cleanFacts = facts.map((fact) => fact.trim()).filter(Boolean)
      const execution = requestedExecution ?? createWorkspaceExecutionContext("presentation", "desktop", "presentation")
      if (cleanFacts.length === 0) return { note: "", executionContext: execution, executionReceipt: null }
      const fallback = cleanFacts.join(" ")
      const result = await getAIService().presentToolResult({
        kind,
        facts: cleanFacts,
        recentSessionActions: sessionContext ? [...sessionContext] : undefined,
        execution,
      })
      return {
        note: result.data?.note?.trim() || fallback,
        executionContext: execution,
        executionReceipt: result.data?.executionReceipt ?? null,
      }
    },
    async applyClassification(proposal, approval) {
      if (proposal.decision !== "change") {
        return error("INVALID_INPUT", "This classification does not recommend a metadata change.")
      }

      const context = await getContext()
      if (context.error || !context.data) return context as ServiceResponse<WorkspaceAgentMutationResult>
      const catalogTarget = context.data.documents.find((record) => record.id === proposal.documentId)
      if (!catalogTarget) return error("NOT_FOUND", `Document ${proposal.documentId} was not found in the workspace.`)
      const read = await tools.read({
        documentId: proposal.documentId,
        approval: createInternalReadApproval(proposal.documentId),
      })
      if (read.error || !read.data) {
        return error("NOT_FOUND", read.error?.message ?? `Document ${proposal.documentId} could not be read before applying the classification.`)
      }
      const current = read.data.document.catalogRecord
      if (current.id !== catalogTarget.id || current.deletedAt) {
        return error("CONFLICT", "The classification target is no longer active in the workspace.")
      }
      const vocabulary = getVocabularyCatalogSnapshot()
      const validArtifactType = activeVocabularyKey(vocabulary, "type", proposal.artifactType)
      const validStatus = activeVocabularyKey(vocabulary, "status", proposal.status)
      if (proposal.artifactType !== null && !validArtifactType) {
        return error("INVALID_INPUT", "The proposed type is not active in the current vocabulary.")
      }
      if (proposal.status !== null && !validStatus) {
        return error("INVALID_INPUT", "The proposed status is not active in the current vocabulary.")
      }
      if (
        current.artifactType !== proposal.currentArtifactType
        || current.status !== proposal.currentStatus
        || (proposal.sourceContentHash !== null && current.binding?.contentHash !== proposal.sourceContentHash)
        || (proposal.sourceContentHash === null && (
          current.version !== proposal.sourceVersion
          || current.modifiedAt !== proposal.sourceModifiedAt
        ))
      ) {
        return error("CONFLICT", "The classification evidence is stale. Review the artifact again before applying this change.")
      }

      const targetQuotes = proposal.evidence
        .filter((item) => item.sourceId === proposal.documentId && item.quote)
        .map((item) => item.quote!)
      if (targetQuotes.length === 0 || targetQuotes.some((quote) => !read.data.document.markdown.includes(quote))) {
        return error("CONFLICT", "The classification evidence is no longer present in the artifact. Review it again before applying this change.")
      }

      const refreshedContext = await getContext()
      if (refreshedContext.error || !refreshedContext.data) {
        return error("DB_ERROR", refreshedContext.error?.message ?? "Workspace context could not be refreshed before the classification edit.")
      }
      const refreshedTarget = refreshedContext.data.documents.find((record) => record.id === proposal.documentId)
      if (
        !refreshedTarget
        || refreshedTarget.deletedAt
        || refreshedTarget.artifactType !== current.artifactType
        || refreshedTarget.status !== current.status
        || !classificationSnapshotMatches(refreshedTarget, {
          documentId: proposal.documentId,
          contentHash: proposal.sourceContentHash,
          version: proposal.sourceVersion,
          modifiedAt: proposal.sourceModifiedAt,
        })
      ) {
        return error("CONFLICT", "The classification evidence is stale. Review the artifact again before applying this change.")
      }
      for (const source of proposal.evidenceSources ?? []) {
        const currentSource = refreshedContext.data.documents.find((record) => record.id === source.documentId)
        if (!currentSource || currentSource.deletedAt || !classificationSnapshotMatches(currentSource, source)) {
          return error("CONFLICT", "The classification evidence is stale. Review the artifact again before applying this change.")
        }
      }

      const metadata: WorkspaceAgentEditInput["metadata"] = {}
      if (validArtifactType !== null && validArtifactType !== current.artifactType) metadata.artifactType = validArtifactType
      if (validStatus !== null && validStatus !== current.status) metadata.status = validStatus
      if (Object.keys(metadata).length === 0) return error("INVALID_INPUT", "The classification proposal contains no vocabulary value to apply.")
      const mutation = await tools.edit({ documentId: proposal.documentId, metadata, approval })
      if (mutation.error || !mutation.data) return mutation
      const updated = mutation.data.document.catalogRecord
      if (
        (validArtifactType !== null && updated.artifactType !== validArtifactType)
        || (validStatus !== null && updated.status !== validStatus)
      ) {
        return error("CONFLICT", "The classification change could not be verified after the approved edit.")
      }
      return ok(mutation.data)
    },
    async findArchiveCandidates(options, workflowReadApproval) {
      const context = await getContextWithWorkflow(workflowReadApproval)
      if (context.error || !context.data) return context as ServiceResponse<ArchiveCandidate[]>
      const vocabulary = getVocabularyCatalogSnapshot()
      const classificationByDocument = new Map(
        context.data.documents.map((document) => [
          document.id,
          suggestArtifactClassification(document, context.data.documents, vocabulary),
        ] as const),
      )
      return ok(findArchiveCandidates(context.data.documents, vocabulary, { ...options, classificationByDocument }))
    },
    async applyArchiveCandidate(candidate, approval) {
      if (!candidate.suggestedStatus) {
        return error("INVALID_INPUT", "The active vocabulary has no visible 'archived' status, so this candidate cannot be applied.")
      }
      return tools.edit({
        documentId: candidate.documentId,
        metadata: { status: candidate.suggestedStatus },
        approval,
      })
    },
  }
}

export async function getWorkspaceAgentService(
  workspaceRootPath: string,
): Promise<ServiceResponse<WorkspaceAgentService>> {
  const toolsResult = await getWorkspaceAgentToolsService(workspaceRootPath)
  if (toolsResult.error || !toolsResult.data) return toolsResult as ServiceResponse<WorkspaceAgentService>
  return ok(await createWorkspaceAgentService(workspaceRootPath, toolsResult.data))
}

export type { WorkspaceAgentContext }
