import type { CollectionSummary } from "@/lib/collections/collections"
import { findInlineAnnotationMarkers } from "@/lib/editor/annotation-markdown"
import {
  MAX_WORKSPACE_CLASSIFICATION_BODY_CHARS,
  MAX_WORKSPACE_CLASSIFICATION_CATALOG_DOCUMENTS,
  MAX_WORKSPACE_CLASSIFICATION_TARGETS,
} from "@/lib/ai/workspace-classification"
import {
  MAX_WORKSPACE_ASK_BODY_CHARS,
  MAX_WORKSPACE_ASK_CATALOG_DOCUMENTS,
  MAX_WORKSPACE_ASK_TARGETS,
} from "@/lib/ai/workspace-ask"
import {
  buildWorkflowDraft,
  detectBrokenDocumentReferences,
  detectDocumentContradictions,
  findArchiveCandidates,
  replaceBrokenDocumentReference,
  replaceContradictionFragment,
  suggestArtifactClassification,
  type ArchiveCandidate,
  type BrokenReferenceProposal,
  type ClassificationProposal,
  type ClassificationEvidenceSource,
  type ContradictionProposal,
  type ContradictionResolution,
  type EvidenceCitation,
  type WorkspaceAgentContentSnapshot,
  type WorkflowDraftProposal,
} from "@/lib/agent/workspace-agent-analysis"
import type {
  WorkspaceAskEvidence,
  WorkspaceAskRequest,
  WorkspaceClassificationAnnotation,
  WorkspaceClassificationDocument,
  WorkspaceClassificationRequest,
  WorkspaceClassificationResult,
} from "@/lib/services/contracts/ai-service"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import type {
  WorkspaceAgentApproval,
  WorkspaceAgentDocument,
  WorkspaceAgentEditInput,
  WorkspaceAgentMutationResult,
  WorkspaceAgentToolsService,
} from "@/lib/services/contracts/workspace-agent"
import { getDocumentCatalog } from "@/lib/services/document-catalog-factory"
import { getAIService } from "@/lib/services/ai-service-factory"
import { loadDesktopCollections } from "@/lib/services/desktop/desktop-collection-service"
import { getWorkspaceAgentToolsService } from "@/lib/services/workspace-agent-tools-factory"
import { getVocabularyCatalogSnapshot } from "@/lib/vocabulary/catalog"

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function error<T>(code: ServiceError["code"], message: string): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable: false } }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
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

function contentSnapshot(document: WorkspaceAgentDocument): WorkspaceAgentContentSnapshot {
  return {
    documentId: document.documentId,
    title: document.title?.trim() || document.catalogRecord.title || document.documentId,
    markdown: document.markdown,
    updatedAt: new Date(document.catalogRecord.modifiedAt ?? Date.now()).toISOString(),
    canonicalPath: document.canonicalPath,
  }
}

type WorkspaceAgentContext = {
  rootPath: string
  documents: DocumentCatalogRecord[]
  collections: CollectionSummary[]
  documentCollectionIds: Record<string, string[]>
  existingWorkflow: DocumentCatalogRecord | null
  workflowMarkdown: string | null
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
}

export type WorkspaceAgentAskInput = {
  question: string
  selection: readonly WorkspaceAgentSelection[]
  workflowReadApproval?: WorkspaceAgentApproval
  /** Short summaries of what already happened earlier in this chat session, most recent last. */
  sessionContext?: readonly string[]
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
 * live catalog records, read each one's full content through the approved
 * tools boundary, and assemble the bounded catalog slice sent to the model.
 */
async function prepareDocumentEvidence(
  context: WorkspaceAgentContext,
  selection: readonly WorkspaceAgentSelection[],
  tools: WorkspaceAgentToolsService,
  options: { maxTargets: number; maxCatalogDocuments: number; maxBodyChars: number; noSelectionMessage: string },
): Promise<ServiceResponse<PreparedDocumentEvidence>> {
  const selectedIds = resolveSelectionDocumentIds(context, selection)
    .filter((documentId) => documentId !== context.existingWorkflow?.id)
  if (selectedIds.length === 0) {
    return error("NOT_FOUND", options.noSelectionMessage)
  }
  if (selectedIds.length > options.maxTargets) {
    return error(
      "INVALID_INPUT",
      `Select at most ${options.maxTargets} artifacts at a time so the agent can read each one completely.`,
    )
  }

  const recordsById = new Map(context.documents.map((record) => [record.id, record]))
  const selectedRecords = selectedIds
    .map((documentId) => recordsById.get(documentId))
    .filter((record): record is DocumentCatalogRecord => Boolean(record && !record.deletedAt))
  if (selectedRecords.length !== selectedIds.length) {
    return error("NOT_FOUND", "One or more selected artifacts are no longer available in the workspace catalog.")
  }

  const reads = await Promise.all(selectedRecords.map(async (record) => {
    const result = await tools.read({
      documentId: record.id,
      approval: createInternalReadApproval(record.id),
    })
    return { record, result }
  }))
  const markdownById = new Map<string, string>()
  const currentRecordsById = new Map(recordsById)
  const annotations: WorkspaceClassificationAnnotation[] = []
  for (const { record, result } of reads) {
    if (result.error || !result.data) {
      return error("NOT_FOUND", result.error?.message ?? `Document ${record.id} could not be read.`)
    }
    const document = result.data.document
    markdownById.set(record.id, document.markdown)
    currentRecordsById.set(record.id, document.catalogRecord)
    annotations.push(...annotationEvidence(record.id, document.markdown))
  }

  const contentChars = [...markdownById.values()].reduce((total, markdown) => total + markdown.length, 0)
    + (context.workflowMarkdown?.length ?? 0)
  if (contentChars > options.maxBodyChars) {
    return error(
      "INVALID_INPUT",
      "The selected artifacts are too large to review together. Narrow the selection so the agent can use complete document evidence.",
    )
  }

  const activeRecords = context.documents.filter((record) => !record.deletedAt)
  const selectedRecordSet = new Set(selectedRecords.map((record) => record.id))
  const remainingRecords = activeRecords
    .filter((record) => !selectedRecordSet.has(record.id))
    .sort((left, right) => {
      const leftLabel = left.title?.trim() || left.binding?.relativePath || left.id
      const rightLabel = right.title?.trim() || right.binding?.relativePath || right.id
      return leftLabel.localeCompare(rightLabel)
    })
  const promptRecords = [
    ...selectedRecords,
    ...remainingRecords.slice(0, Math.max(0, options.maxCatalogDocuments - selectedRecords.length)),
  ]

  return ok({
    selectedRecords,
    recordsById,
    currentRecordsById,
    markdownById,
    annotations,
    promptRecords,
    catalogTruncated: promptRecords.length < activeRecords.length,
  })
}

function requestedDocumentsFrom(
  requestedDocumentIds: readonly string[],
  recordsById: ReadonlyMap<string, DocumentCatalogRecord>,
  selectedRecordSet: ReadonlySet<string>,
  markdownById: ReadonlyMap<string, string>,
): { requestedDocumentIds: string[]; requestedDocuments: WorkspaceAgentClassificationRequestedDocument[] } {
  const filteredIds = [...new Set(requestedDocumentIds)].filter((documentId) => {
    const record = recordsById.get(documentId)
    return Boolean(record && !record.deletedAt && !selectedRecordSet.has(documentId) && !markdownById.has(documentId))
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
  findContradictions(
    documentIds: string[],
    readApprovals: Readonly<Record<string, WorkspaceAgentApproval>>,
    workflowReadApproval?: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<ContradictionProposal[]>>
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

export async function createWorkspaceAgentService(
  workspaceRootPath: string,
  tools: WorkspaceAgentToolsService,
): Promise<WorkspaceAgentService> {
  const getContext = async (): Promise<ServiceResponse<WorkspaceAgentContext>> => loadContext(workspaceRootPath)

  const withWorkflowMarkdown = async (
    context: ServiceResponse<WorkspaceAgentContext>,
    readApproval?: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentContext>> => {
    if (context.error || !context.data || !context.data.existingWorkflow) return context
    if (!readApproval) {
      return error("FORBIDDEN", "Reading an existing workflow.md requires a workflow-specific read approval.")
    }
    const read = await tools.read({ documentId: context.data.existingWorkflow.id, approval: readApproval })
    if (read.error || !read.data) {
      return error(read.error?.code ?? "NOT_FOUND", read.error?.message ?? "workflow.md could not be loaded.")
    }
    return ok<WorkspaceAgentContext>({ ...context.data, workflowMarkdown: read.data.document.markdown })
  }

  const getContextWithWorkflow = async (
    workflowReadApproval?: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentContext>> => withWorkflowMarkdown(await getContext(), workflowReadApproval)

  return {
    tools,
    getContext,
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
    async findContradictions(documentIds, readApprovals, workflowReadApproval) {
      const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))]
      if (uniqueDocumentIds.length < 2) {
        return error("INVALID_INPUT", "At least two documents are required to compare contradictions.")
      }

      for (const documentId of uniqueDocumentIds) {
        if (!readApprovals[documentId]) {
          return error("FORBIDDEN", `Reading document ${documentId} requires an explicit approval.`)
        }
      }

      const context = await getContextWithWorkflow(workflowReadApproval)
      if (context.error || !context.data) return context as ServiceResponse<ContradictionProposal[]>

      const documents: WorkspaceAgentContentSnapshot[] = []
      for (const documentId of uniqueDocumentIds) {
        const approval = readApprovals[documentId]!
        const read = await tools.read({ documentId, approval })
        if (read.error || !read.data) return error("NOT_FOUND", read.error?.message ?? `Document ${documentId} could not be read.`)
        documents.push(contentSnapshot(read.data.document))
      }

      return ok(detectDocumentContradictions(documents))
    },
    async resolveContradiction(proposal, resolution, approvals) {
      if (resolution === "discard") {
        return ok({ proposal, resolution, resolvedDocumentId: null, mutation: null })
      }
      if (!approvals) {
        return error("FORBIDDEN", "Resolving a contradiction requires read and edit approvals for the target document.")
      }

      const selected = resolution === "left" ? proposal.left : proposal.right
      const target = resolution === "left" ? proposal.right : proposal.left
      const read = await tools.read({ documentId: target.documentId, approval: approvals.read })
      if (read.error || !read.data) return error("NOT_FOUND", read.error?.message ?? `Document ${target.documentId} could not be read.`)
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
      const requestedText = input.request?.trim() || DEFAULT_CLASSIFICATION_REQUEST
      const context = await getContextWithWorkflow(input.workflowReadApproval)
      if (context.error || !context.data) return context as ServiceResponse<WorkspaceAgentClassificationRun>

      const prepared = await prepareDocumentEvidence(context.data, input.selection, tools, {
        maxTargets: MAX_WORKSPACE_CLASSIFICATION_TARGETS,
        maxCatalogDocuments: MAX_WORKSPACE_CLASSIFICATION_CATALOG_DOCUMENTS,
        maxBodyChars: MAX_WORKSPACE_CLASSIFICATION_BODY_CHARS,
        noSelectionMessage: "Select at least one local artifact before asking for a semantic classification.",
      })
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
        workflowMarkdown: context.data.workflowMarkdown,
        catalogTruncated,
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
      )

      return ok({
        summary: aiResult.data.summary,
        proposals,
        requestedDocumentIds,
        requestedDocuments,
        targetDocumentIds: selectedRecords.map((record) => record.id),
      })
    },
    async askAgent(input) {
      const context = await getContextWithWorkflow(input.workflowReadApproval)
      if (context.error || !context.data) return context as ServiceResponse<WorkspaceAgentAskRun>

      const prepared = await prepareDocumentEvidence(context.data, input.selection, tools, {
        maxTargets: MAX_WORKSPACE_ASK_TARGETS,
        maxCatalogDocuments: MAX_WORKSPACE_ASK_CATALOG_DOCUMENTS,
        maxBodyChars: MAX_WORKSPACE_ASK_BODY_CHARS,
        noSelectionMessage: "Select at least one local artifact before asking the Workspace agent.",
      })
      if (prepared.error || !prepared.data) return prepared as ServiceResponse<WorkspaceAgentAskRun>
      const { selectedRecords, recordsById, currentRecordsById, markdownById, annotations, promptRecords, catalogTruncated } = prepared.data

      const aiRequest: WorkspaceAskRequest = {
        question: input.question.slice(0, 2_000),
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
        workflowMarkdown: context.data.workflowMarkdown,
        catalogTruncated,
        recentSessionActions: input.sessionContext ? [...input.sessionContext] : undefined,
      }
      const aiResult = await getAIService().askWorkspace(aiRequest)
      if (aiResult.error || !aiResult.data) {
        return error(aiResult.error?.code ?? "AI_REQUEST_FAILED", aiResult.error?.message ?? "The Workspace agent could not answer right now.")
      }

      const validEvidence: WorkspaceAskEvidence[] = aiResult.data.evidence.filter((item) => markdownById.get(item.documentId)?.includes(item.quote))
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
        aiResult.data.requestedDocumentIds,
        recordsById,
        selectedRecordSet,
        markdownById,
      )

      return ok({
        answer: aiResult.data.answer,
        evidence,
        requestedDocumentIds,
        requestedDocuments,
        targetDocumentIds: selectedRecords.map((record) => record.id),
        documents: promptRecords.map((record) => ({
          documentId: record.id,
          title: record.title?.trim() || record.binding?.relativePath || record.id,
          path: record.binding?.relativePath ?? null,
        })),
      })
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
