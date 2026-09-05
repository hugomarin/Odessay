import type { CollectionSummary } from "@/lib/collections/collections"
import {
  buildWorkflowDraft,
  detectBrokenDocumentReferences,
  findArchiveCandidates,
  suggestArtifactClassification,
  type ArchiveCandidate,
  type BrokenReferenceProposal,
  type ClassificationProposal,
  type WorkflowDraftProposal,
} from "@/lib/agent/workspace-agent-analysis"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import type {
  WorkspaceAgentApproval,
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
