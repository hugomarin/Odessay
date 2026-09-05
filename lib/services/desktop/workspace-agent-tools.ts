import { parseDocumentFileToSnapshot, serializeDocumentToMarkdown } from "@/lib/editor/document-serialization"
import type {
  DocumentService,
  WritingRecord,
} from "@/lib/services/contracts/document-service"
import type { DocumentCatalog, DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import type {
  WorkspaceAgentApproval,
  WorkspaceAgentDeleteInput,
  WorkspaceAgentDocument,
  WorkspaceAgentEditInput,
  WorkspaceAgentExecutionReceipt,
  WorkspaceAgentMoveInput,
  WorkspaceAgentMutationResult,
  WorkspaceAgentReadInput,
  WorkspaceAgentReadResult,
  WorkspaceAgentToolsService,
  WorkspaceAgentWriteInput,
} from "@/lib/services/contracts/workspace-agent"
import { importDesktopWritingFile, relocateDesktopWriting } from "@/lib/services/document-service-factory"

type DesktopWorkspaceAgentDependencies = {
  catalog: DocumentCatalog
  documentService: DocumentService
  importDocument: typeof importDesktopWritingFile
  relocateDocument: typeof relocateDesktopWriting
  now?: () => Date
}

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function error<T>(code: ServiceError["code"], message: string, details?: Record<string, unknown>): ServiceResponse<T> {
  return {
    data: null,
    error: { code, message, retryable: false, details },
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
}

function isInsideRoot(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedRoot = normalizePath(rootPath)
  return normalizedPath.startsWith(`${normalizedRoot}/`)
}

function approvalError(
  action: WorkspaceAgentApproval["action"],
  approval: WorkspaceAgentApproval | undefined,
  resource: string,
): ServiceError | null {
  if (!approval || approval.action !== action || !approval.approved) {
    return {
      code: "FORBIDDEN",
      message: `Explicit approval is required for this ${action} action.`,
      retryable: false,
      details: { action, resource },
    }
  }
  if (!approval.approvalId.trim()) {
    return { code: "INVALID_INPUT", message: "approvalId is required for every agent action.", retryable: false }
  }
  if (approval.resource !== resource) {
    return {
      code: "FORBIDDEN",
      message: "The approval does not authorize the requested resource.",
      retryable: false,
      details: { action, approvedResource: approval.resource, requestedResource: resource },
    }
  }
  if (Number.isNaN(Date.parse(approval.approvedAt))) {
    return { code: "INVALID_INPUT", message: "approvedAt must be a valid timestamp.", retryable: false }
  }
  return null
}

function markdownFromWriting(writing: WritingRecord): string {
  if (writing.content.markdown !== null) return writing.content.markdown
  try {
    return serializeDocumentToMarkdown(writing.content.richText as Record<string, unknown> | null | undefined)
  } catch {
    return ""
  }
}

function recordWithMarkdown(writing: WritingRecord, markdown: string, updatedAt: string): WritingRecord | ServiceError {
  let parsed: ReturnType<typeof parseDocumentFileToSnapshot>
  try {
    parsed = parseDocumentFileToSnapshot(markdown)
  } catch (cause) {
    return {
      code: "INVALID_INPUT",
      message: cause instanceof Error ? cause.message : "Document markdown could not be parsed.",
      retryable: false,
    }
  }
  return {
    ...writing,
    content: {
      markdown: null,
      richText: parsed.snapshot.bodyJson as Record<string, unknown>,
      plainText: parsed.snapshot.bodyText,
      canonicalSource: "rich-text",
    },
    updatedAt,
  }
}

export class DesktopWorkspaceAgentToolsService implements WorkspaceAgentToolsService {
  private readonly consumedApprovalIds = new Set<string>()
  private readonly now: () => Date

  constructor(
    private readonly workspaceRootPath: string,
    private readonly dependencies: DesktopWorkspaceAgentDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date())
  }

  private takeApproval(
    action: WorkspaceAgentApproval["action"],
    approval: WorkspaceAgentApproval | undefined,
    resource: string,
  ): ServiceError | null {
    const validation = approvalError(action, approval, resource)
    if (validation) return validation
    if (this.consumedApprovalIds.has(approval!.approvalId)) {
      return {
        code: "CONFLICT",
        message: "This approval has already been consumed; approve the action again.",
        retryable: false,
        details: { approvalId: approval!.approvalId },
      }
    }
    this.consumedApprovalIds.add(approval!.approvalId)
    return null
  }

  private receipt(action: WorkspaceAgentApproval["action"], approval: WorkspaceAgentApproval): WorkspaceAgentExecutionReceipt {
    return { action, approvalId: approval.approvalId, executedAt: this.now().toISOString() }
  }

  private async getRecord(documentId: string): Promise<ServiceResponse<DocumentCatalogRecord>> {
    const record = await this.dependencies.catalog.getById(documentId)
    if (!record) return error("NOT_FOUND", `Document ${documentId} was not found in the catalog.`)
    if (!record.binding?.canonicalPath) return error("NOT_FOUND", `Document ${documentId} has no local binding.`)
    if (!isInsideRoot(record.binding.canonicalPath, this.workspaceRootPath)) {
      return error("FORBIDDEN", "The document is outside the agent workspace root.")
    }
    return ok(record)
  }

  private toAgentDocument(record: DocumentCatalogRecord, markdown: string): WorkspaceAgentDocument {
    return {
      documentId: record.id,
      canonicalPath: record.binding?.canonicalPath ?? "",
      title: record.title,
      markdown,
      catalogRecord: record,
    }
  }

  private async readAuthorized(
    documentId: string,
    approval: WorkspaceAgentApproval,
  ): Promise<ServiceResponse<WorkspaceAgentReadResult>> {
    const approvalValidation = this.takeApproval("read", approval, documentId)
    if (approvalValidation) return { data: null, error: approvalValidation }
    const recordResult = await this.getRecord(documentId)
    if (recordResult.error || !recordResult.data) return recordResult as ServiceResponse<WorkspaceAgentReadResult>
    const opened = await this.dependencies.documentService.openWriting(documentId)
    if (opened.error || !opened.data) return error("NOT_FOUND", opened.error?.message ?? "Document could not be opened.")
    return ok({
      document: this.toAgentDocument(recordResult.data, markdownFromWriting(opened.data)),
      receipt: this.receipt("read", approval),
    })
  }

  async read(input: WorkspaceAgentReadInput): Promise<ServiceResponse<WorkspaceAgentReadResult>> {
    return this.readAuthorized(input.documentId, input.approval)
  }

  async write(input: WorkspaceAgentWriteInput): Promise<ServiceResponse<WorkspaceAgentMutationResult>> {
    const targetResource = "documentId" in input.target ? input.target.documentId : input.target.canonicalPath
    const approvalValidation = this.takeApproval("write", input.approval, targetResource)
    if (approvalValidation) return { data: null, error: approvalValidation }
    if (typeof input.markdown !== "string") return error("INVALID_INPUT", "markdown is required for a write action.")

    if ("documentId" in input.target) {
      return this.writeExistingAfterApproval(input.target.documentId, input.markdown, input.approval, true)
    }

    if (!isInsideRoot(input.target.canonicalPath, this.workspaceRootPath)) {
      return error("FORBIDDEN", "The write target is outside the agent workspace root.")
    }
    const resolved = await this.dependencies.catalog.resolvePath(input.target.canonicalPath)
    if (resolved.kind === "resolved") {
      return this.writeExistingAfterApproval(resolved.record.id, input.markdown, input.approval, true)
    }
    const imported = await this.dependencies.importDocument(input.target.canonicalPath, input.markdown)
    if (imported.error || !imported.data) return error("STORAGE_ERROR", imported.error?.message ?? "Document could not be written.")
    const record = await this.dependencies.catalog.getById(imported.data.id)
    if (!record?.binding?.canonicalPath) return error("DB_ERROR", "The written document was not projected into the catalog.")
    return ok({
      document: this.toAgentDocument(record, input.markdown),
      receipt: this.receipt("write", input.approval),
    })
  }

  private async writeExistingAfterApproval(
    documentId: string,
    markdown: string,
    approval: WorkspaceAgentApproval,
    approvalAlreadyTaken = false,
  ): Promise<ServiceResponse<WorkspaceAgentMutationResult>> {
    if (!approvalAlreadyTaken) {
      const approvalValidation = this.takeApproval("write", approval, documentId)
      if (approvalValidation) return { data: null, error: approvalValidation }
    }
    const recordResult = await this.getRecord(documentId)
    if (recordResult.error || !recordResult.data) return recordResult as ServiceResponse<WorkspaceAgentMutationResult>
    const opened = await this.dependencies.documentService.openWriting(documentId)
    if (opened.error || !opened.data) return error("NOT_FOUND", opened.error?.message ?? "Document could not be opened.")
    const next = recordWithMarkdown(opened.data, markdown, this.now().toISOString())
    if ("code" in next) return { data: null, error: next }
    const saved = await this.dependencies.documentService.saveWriting({ writing: next })
    if (saved.error || !saved.data) return error("STORAGE_ERROR", saved.error?.message ?? "Document could not be saved.")
    const after = (await this.dependencies.catalog.getById(documentId)) ?? recordResult.data
    return ok({
      document: this.toAgentDocument(after, markdownFromWriting(saved.data)),
      receipt: this.receipt("write", approval),
    })
  }

  async edit(input: WorkspaceAgentEditInput): Promise<ServiceResponse<WorkspaceAgentMutationResult>> {
    if (input.markdown === undefined && !input.metadata) return error("INVALID_INPUT", "edit requires markdown or metadata.")
    const approvalValidation = this.takeApproval("edit", input.approval, input.documentId)
    if (approvalValidation) return { data: null, error: approvalValidation }
    const recordResult = await this.getRecord(input.documentId)
    if (recordResult.error || !recordResult.data) return recordResult as ServiceResponse<WorkspaceAgentMutationResult>
    const opened = await this.dependencies.documentService.openWriting(input.documentId)
    if (opened.error || !opened.data) return error("NOT_FOUND", opened.error?.message ?? "Document could not be opened.")

    let current = opened.data
    if (input.markdown !== undefined) {
      const next = recordWithMarkdown(current, input.markdown, this.now().toISOString())
      if ("code" in next) return { data: null, error: next }
      const saved = await this.dependencies.documentService.saveWriting({ writing: next })
      if (saved.error || !saved.data) return error("STORAGE_ERROR", saved.error?.message ?? "Document could not be edited.")
      current = saved.data
    }
    if (input.metadata) {
      const updated = await this.dependencies.documentService.updateWritingMetadata({
        writingId: input.documentId,
        status: input.metadata.status,
        artifactType: input.metadata.artifactType,
        version: current.version + 1,
        updatedAt: this.now().toISOString(),
      })
      if (updated.error || !updated.data) return error("STORAGE_ERROR", updated.error?.message ?? "Document metadata could not be edited.")
      current = updated.data
    }
    const after = (await this.dependencies.catalog.getById(input.documentId)) ?? recordResult.data
    return ok({
      document: this.toAgentDocument(after, markdownFromWriting(current)),
      receipt: this.receipt("edit", input.approval),
    })
  }

  async move(input: WorkspaceAgentMoveInput): Promise<ServiceResponse<WorkspaceAgentMutationResult>> {
    const approvalValidation = this.takeApproval("move", input.approval, input.documentId)
    if (approvalValidation) return { data: null, error: approvalValidation }
    if (!isInsideRoot(input.destinationPath, this.workspaceRootPath)) {
      return error("FORBIDDEN", "The move destination is outside the agent workspace root.")
    }
    const recordResult = await this.getRecord(input.documentId)
    if (recordResult.error || !recordResult.data) return recordResult as ServiceResponse<WorkspaceAgentMutationResult>
    const moved = await this.dependencies.relocateDocument(input.documentId, input.destinationPath)
    if (moved.status !== "relocated") {
      return error("STORAGE_ERROR", "message" in moved ? moved.message : "Document could not be moved.")
    }
    const after = await this.dependencies.catalog.getById(input.documentId)
    if (!after?.binding?.canonicalPath) return error("DB_ERROR", "The moved document was not projected into the catalog.")
    const opened = await this.dependencies.documentService.openWriting(input.documentId)
    if (opened.error || !opened.data) return error("NOT_FOUND", opened.error?.message ?? "Moved document could not be opened.")
    return ok({
      document: this.toAgentDocument(after, markdownFromWriting(opened.data)),
      receipt: this.receipt("move", input.approval),
    })
  }

  async delete(input: WorkspaceAgentDeleteInput): Promise<ServiceResponse<WorkspaceAgentMutationResult>> {
    const approvalValidation = this.takeApproval("delete", input.approval, input.documentId)
    if (approvalValidation) return { data: null, error: approvalValidation }
    const recordResult = await this.getRecord(input.documentId)
    if (recordResult.error || !recordResult.data) return recordResult as ServiceResponse<WorkspaceAgentMutationResult>
    const opened = await this.dependencies.documentService.openWriting(input.documentId)
    if (opened.error || !opened.data) return error("NOT_FOUND", opened.error?.message ?? "Document could not be opened.")
    const deletedAt = this.now().toISOString()
    const deleted = await this.dependencies.documentService.deleteWriting({
      writingId: input.documentId,
      version: recordResult.data.version ?? opened.data.version,
      updatedAt: deletedAt,
      deletedAt,
    })
    if (deleted.error || !deleted.data) return error("STORAGE_ERROR", deleted.error?.message ?? "Document could not be deleted.")
    const after = (await this.dependencies.catalog.getById(input.documentId)) ?? {
      ...recordResult.data,
      localPresent: false,
      deletedAt,
      binding: null,
    }
    return ok({
      document: {
        ...this.toAgentDocument(after, markdownFromWriting(opened.data)),
        canonicalPath: recordResult.data.binding?.canonicalPath ?? "",
      },
      receipt: this.receipt("delete", input.approval),
    })
  }
}

export function createDesktopWorkspaceAgentToolsService(
  workspaceRootPath: string,
  dependencies: DesktopWorkspaceAgentDependencies,
): DesktopWorkspaceAgentToolsService {
  return new DesktopWorkspaceAgentToolsService(workspaceRootPath, dependencies)
}

export type { DesktopWorkspaceAgentDependencies }
