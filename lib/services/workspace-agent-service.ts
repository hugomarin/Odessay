import type { CollectionSummary } from "@/lib/collections/collections"
import {
  buildWorkflowDraft,
  detectBrokenDocumentReferences,
  detectDocumentContradictions,
  findArchiveCandidates,
  replaceContradictionFragment,
  suggestArtifactClassification,
  type ArchiveCandidate,
  type BrokenReferenceProposal,
  type ClassificationProposal,
  type ContradictionProposal,
  type ContradictionResolution,
  type WorkspaceAgentContentSnapshot,
  type WorkflowDraftProposal,
} from "@/lib/agent/workspace-agent-analysis"
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

function isInsideRoot(path: string | null | undefined, rootPath: string): boolean {
  if (!path) return false
  return normalizePath(path).startsWith(`${normalizePath(rootPath)}/`)
}

function workflowPath(rootPath: string): string {
  return `${normalizePath(rootPath)}/workflow.md`
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
  existingWorkflow: DocumentCatalogRecord | null
  workflowMarkdown: string | null
}

async function loadContext(rootPath: string): Promise<ServiceResponse<WorkspaceAgentContext>> {
  try {
    const [catalog, collectionState] = await Promise.all([
      getDocumentCatalog(),
      loadDesktopCollections(),
    ])
    const documents = (await catalog.list({ includeDeleted: false }))
      .filter((record) => isInsideRoot(record.binding?.canonicalPath, rootPath))
    const counts = new Map<string, number>()
    for (const assignment of collectionState.writingCollections) {
      if (documents.some((record) => record.id === assignment.writing_id)) {
        counts.set(assignment.collection_id, (counts.get(assignment.collection_id) ?? 0) + 1)
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
      existingWorkflow: documents.find((record) => normalizePath(record.binding?.canonicalPath ?? "") === workflowPath(rootPath)) ?? null,
      workflowMarkdown: null,
    })
  } catch (cause) {
    return error("DB_ERROR", cause instanceof Error ? cause.message : "Workspace context could not be loaded.")
  }
}

export type WorkspaceAgentService = {
  getContext(readApproval?: WorkspaceAgentApproval): Promise<ServiceResponse<WorkspaceAgentContext>>
  proposeWorkflow(readApproval?: WorkspaceAgentApproval): Promise<ServiceResponse<WorkflowDraftProposal>>
  applyWorkflow(
    proposal: WorkflowDraftProposal,
    approval: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  findBrokenReferences(readApproval?: WorkspaceAgentApproval): Promise<ServiceResponse<BrokenReferenceProposal[]>>
  findContradictions(
    documentIds: string[],
    readApprovals: Readonly<Record<string, WorkspaceAgentApproval>>,
  ): Promise<ServiceResponse<ContradictionProposal[]>>
  resolveContradiction(
    proposal: ContradictionProposal,
    resolution: ContradictionResolution,
    approvals?: { read: WorkspaceAgentApproval; edit: WorkspaceAgentApproval },
  ): Promise<ServiceResponse<ContradictionResolutionResult>>
  suggestClassification(documentId: string, readApproval?: WorkspaceAgentApproval): Promise<ServiceResponse<ClassificationProposal>>
  applyClassification(
    proposal: ClassificationProposal,
    approval: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentMutationResult>>
  findArchiveCandidates(options?: { now?: number; staleAfterDays?: number; duplicateThreshold?: number }, readApproval?: WorkspaceAgentApproval): Promise<ServiceResponse<ArchiveCandidate[]>>
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
  const getContext = async (readApproval?: WorkspaceAgentApproval): Promise<ServiceResponse<WorkspaceAgentContext>> => {
    const context = await loadContext(workspaceRootPath)
    if (context.error || !context.data || !context.data.existingWorkflow || !readApproval) return context
    const read = await tools.read({ documentId: context.data.existingWorkflow.id, approval: readApproval })
    if (read.error || !read.data) return error("NOT_FOUND", read.error?.message ?? "workflow.md could not be loaded.")
    return ok<WorkspaceAgentContext>({ ...context.data, workflowMarkdown: read.data.document.markdown })
  }

  return {
    tools,
    getContext,
    async proposeWorkflow(readApproval) {
      const context = await getContext(readApproval)
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
    async findBrokenReferences(readApproval) {
      const context = await getContext(readApproval)
      if (context.error || !context.data) return context as ServiceResponse<BrokenReferenceProposal[]>
      return ok(detectBrokenDocumentReferences(context.data.documents))
    },
    async findContradictions(documentIds, readApprovals) {
      const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))]
      if (uniqueDocumentIds.length < 2) {
        return error("INVALID_INPUT", "At least two documents are required to compare contradictions.")
      }

      for (const documentId of uniqueDocumentIds) {
        if (!readApprovals[documentId]) {
          return error("FORBIDDEN", `Reading document ${documentId} requires an explicit approval.`)
        }
      }

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
    async suggestClassification(documentId, readApproval) {
      const context = await getContext(readApproval)
      if (context.error || !context.data) return context as ServiceResponse<ClassificationProposal>
      const document = context.data.documents.find((record) => record.id === documentId)
      if (!document) return error("NOT_FOUND", `Document ${documentId} was not found in the workspace.`)
      return ok(suggestArtifactClassification(document, context.data.documents, getVocabularyCatalogSnapshot()))
    },
    async applyClassification(proposal, approval) {
      const metadata: WorkspaceAgentEditInput["metadata"] = {}
      if (proposal.artifactType !== null) metadata.artifactType = proposal.artifactType
      if (proposal.status !== null) metadata.status = proposal.status
      if (Object.keys(metadata).length === 0) return error("INVALID_INPUT", "The classification proposal contains no vocabulary value to apply.")
      return tools.edit({ documentId: proposal.documentId, metadata, approval })
    },
    async findArchiveCandidates(options, readApproval) {
      const context = await getContext(readApproval)
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
