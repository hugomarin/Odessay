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

const INTERNAL_WORKSPACE_DIR_NAMES = new Set([".odessay", [".ody", "ssey"].join("")])

type DesktopWorkspaceAgentDependencies = {
  catalog: DocumentCatalog
  documentService: DocumentService
  importDocument: typeof importDesktopWritingFile
  relocateDocument: typeof relocateDesktopWriting
  validatePath: WorkspaceAgentPathValidator
  now?: () => Date
}

export type WorkspaceAgentPathValidation = {
  canonicalRoot: string
  canonicalPath: string
}

export type WorkspaceAgentPathValidator = (
  rootPath: string,
  candidatePath: string,
  allowMissing: boolean,
) => Promise<WorkspaceAgentPathValidation>

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function error<T>(code: ServiceError["code"], message: string, details?: Record<string, unknown>): ServiceResponse<T> {
  return {
    data: null,
    error: { code, message, retryable: false, details },
  }
}

function canonicalizeLexicalPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/")
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

function isAgentMarkdownPath(path: string): boolean {
  return path.toLocaleLowerCase().endsWith(".md")
}

function isInsideCanonicalRoot(path: string, rootPath: string): boolean {
  if (path === rootPath) return false
  if (rootPath === "/") return path.startsWith("/")
  return path.startsWith(`${rootPath}/`)
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
  private readonly validatePath: WorkspaceAgentPathValidator

  constructor(
    private readonly workspaceRootPath: string,
    private readonly dependencies: DesktopWorkspaceAgentDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date())
    this.validatePath = dependencies.validatePath
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

  private async validateWorkspacePath(
    candidatePath: string,
    allowMissing: boolean,
  ): Promise<ServiceResponse<WorkspaceAgentPathValidation>> {
    try {
      const validation = await this.validatePath(this.workspaceRootPath, candidatePath, allowMissing)
      const canonicalRoot = canonicalizeLexicalPath(validation.canonicalRoot)
      const canonicalPath = canonicalizeLexicalPath(validation.canonicalPath)
      if (
        hasInternalWorkspaceComponent(canonicalRoot)
        || hasInternalWorkspaceComponent(canonicalPath)
        || !isInsideCanonicalRoot(canonicalPath, canonicalRoot)
      ) {
        return error("FORBIDDEN", "The path is outside the agent workspace root or resolves through internal workspace state.", {
          candidatePath,
        })
      }
      if (!isAgentMarkdownPath(canonicalPath)) {
        return error("FORBIDDEN", "Workspace agent filesystem actions are limited to .md documents.", {
          candidatePath,
        })
      }
      return ok({ canonicalRoot, canonicalPath })
    } catch (cause) {
      return error(
        "FORBIDDEN",
        cause instanceof Error
          ? cause.message
          : "The path is outside the agent workspace root or could not be canonicalized.",
        { candidatePath },
      )
    }
  }

  private async getRecord(documentId: string): Promise<ServiceResponse<DocumentCatalogRecord>> {
    const record = await this.dependencies.catalog.getById(documentId)
    if (!record) return error("NOT_FOUND", `Document ${documentId} was not found in the catalog.`)
    if (!record.binding?.canonicalPath) return error("NOT_FOUND", `Document ${documentId} has no local binding.`)
    const pathValidation = await this.validateWorkspacePath(record.binding.canonicalPath, true)
    if (pathValidation.error || !pathValidation.data) return pathValidation as ServiceResponse<DocumentCatalogRecord>
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
    const recordResult = await this.getRecord(documentId)
    if (recordResult.error || !recordResult.data) return recordResult as ServiceResponse<WorkspaceAgentReadResult>
    const approvalValidation = this.takeApproval("read", approval, documentId)
    if (approvalValidation) return { data: null, error: approvalValidation }
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
    if (typeof input.markdown !== "string") return error("INVALID_INPUT", "markdown is required for a write action.")

    if ("documentId" in input.target) {
      const recordResult = await this.getRecord(input.target.documentId)
      if (recordResult.error || !recordResult.data) return recordResult as ServiceResponse<WorkspaceAgentMutationResult>
      const approvalValidation = this.takeApproval("write", input.approval, input.target.documentId)
      if (approvalValidation) return { data: null, error: approvalValidation }
      return this.writeExistingAfterApproval(input.target.documentId, input.markdown, input.approval, true)
    }

    const pathValidation = await this.validateWorkspacePath(input.target.canonicalPath, true)
    if (pathValidation.error || !pathValidation.data) return pathValidation as ServiceResponse<WorkspaceAgentMutationResult>
    const approvalValidation = this.takeApproval("write", input.approval, input.target.canonicalPath)
    if (approvalValidation) return { data: null, error: approvalValidation }
    const safePath = pathValidation.data.canonicalPath
    const resolved = await this.dependencies.catalog.resolvePath(safePath)
    if (resolved.kind === "resolved") {
      return this.writeExistingAfterApproval(resolved.record.id, input.markdown, input.approval, true)
    }
    const imported = await this.dependencies.importDocument(safePath, input.markdown)
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
    const recordResult = await this.getRecord(input.documentId)
    if (recordResult.error || !recordResult.data) return recordResult as ServiceResponse<WorkspaceAgentMutationResult>
    const approvalValidation = this.takeApproval("edit", input.approval, input.documentId)
    if (approvalValidation) return { data: null, error: approvalValidation }
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
    const destinationValidation = await this.validateWorkspacePath(input.destinationPath, true)
    if (destinationValidation.error || !destinationValidation.data) return destinationValidation as ServiceResponse<WorkspaceAgentMutationResult>
    const recordResult = await this.getRecord(input.documentId)
    if (recordResult.error || !recordResult.data) return recordResult as ServiceResponse<WorkspaceAgentMutationResult>
    const approvalValidation = this.takeApproval("move", input.approval, input.documentId)
    if (approvalValidation) return { data: null, error: approvalValidation }
    const moved = await this.dependencies.relocateDocument(input.documentId, destinationValidation.data.canonicalPath)
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
    const recordResult = await this.getRecord(input.documentId)
    if (recordResult.error || !recordResult.data) return recordResult as ServiceResponse<WorkspaceAgentMutationResult>
    const approvalValidation = this.takeApproval("delete", input.approval, input.documentId)
    if (approvalValidation) return { data: null, error: approvalValidation }
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
