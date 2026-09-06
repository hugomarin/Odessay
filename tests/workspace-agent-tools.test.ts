/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentCatalog, DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { DocumentService, WritingRecord } from "@/lib/services/contracts/document-service"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"
import { DesktopWorkspaceAgentToolsService } from "@/lib/services/desktop/workspace-agent-tools"
import type { RelocateDesktopWritingResult } from "@/lib/services/document-service-factory"

const id = "doc-1"
const root = "/workspace"

const makeRecord = (path = "/workspace/Doc.md"): DocumentCatalogRecord => ({
  id,
  localPresent: true,
  cloudPresent: false,
  cloudAccountId: null,
  syncStatus: "local-only",
  title: "Doc",
  slug: null,
  status: "draft",
  artifactType: "general",
  visibility: "private",
  version: 1,
  deletedAt: null,
  createdAt: 1,
  modifiedAt: 2,
  binding: {
    documentId: id,
    bindingRootId: "root",
    relativePath: path.slice(root.length + 1),
    canonicalPath: path,
    inode: 1,
    contentHash: "hash:before",
    size: 10,
    lastSeenAt: 2,
  },
})

const writing: WritingRecord = {
  id,
  authorId: null,
  title: "Doc",
  content: { markdown: "# Doc\n\nBefore.", richText: null, plainText: "Doc\n\nBefore.", canonicalSource: "markdown" },
  slug: null,
  status: "draft",
  artifactType: "general",
  visibility: "private",
  parentId: null,
  correspondenceId: null,
  version: 1,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

const approval = (action: "read" | "write" | "move" | "edit" | "delete", resource = id, approvalId = `${action}-1`) => ({
  action, approvalId, approved: true, approvedAt: "2026-01-01T00:00:00.000Z", resource,
})

describe("DesktopWorkspaceAgentToolsService", () => {
  let record: DocumentCatalogRecord
  let catalog: {
    getById: ReturnType<typeof vi.fn>
    resolvePath: ReturnType<typeof vi.fn>
  }
  let documentService: {
    openWriting: ReturnType<typeof vi.fn>
    saveWriting: ReturnType<typeof vi.fn>
    updateWritingMetadata: ReturnType<typeof vi.fn>
    deleteWriting: ReturnType<typeof vi.fn>
  }
  let importDocument: ReturnType<typeof vi.fn>
  let relocateDocument: ReturnType<typeof vi.fn>
  let service: DesktopWorkspaceAgentToolsService

  beforeEach(() => {
    record = makeRecord()
    catalog = {
      getById: vi.fn().mockResolvedValue(record),
      resolvePath: vi.fn().mockResolvedValue({ kind: "resolved", record }),
    }
    documentService = {
      openWriting: vi.fn().mockResolvedValue({ data: writing, error: null }),
      saveWriting: vi.fn().mockImplementation(async ({ writing: next }: { writing: WritingRecord }) => ({ data: { ...next, version: next.version + 1 }, error: null })),
      updateWritingMetadata: vi.fn().mockImplementation(async (input) => ({ data: { ...writing, ...input, id }, error: null })),
      deleteWriting: vi.fn().mockResolvedValue({ data: { ...writing, deletedAt: "2026-01-02T00:00:00.000Z" }, error: null }),
    }
    importDocument = vi.fn().mockResolvedValue({ data: { ...writing, id }, error: null })
    relocateDocument = vi.fn().mockImplementation(async () => {
      record = makeRecord("/workspace/archive/Doc.md")
      catalog.getById.mockResolvedValue(record)
      return { status: "relocated", path: "/workspace/archive/Doc.md" }
    })
    service = new DesktopWorkspaceAgentToolsService(root, {
      catalog: catalog as unknown as DocumentCatalog,
      documentService: documentService as unknown as DocumentService,
      importDocument: importDocument as unknown as (path: string, content: string) => Promise<ServiceResponse<WritingRecord>>,
      relocateDocument: relocateDocument as unknown as (id: string, requestedPath: string, content?: string) => Promise<RelocateDesktopWritingResult>,
      validatePath: async (rootPath, candidatePath) => ({ canonicalRoot: rootPath, canonicalPath: candidatePath }),
      now: () => new Date("2026-01-02T00:00:00.000Z"),
    })
  })

  it("rejects write before any disk/catalog adapter call and consumes no state", async () => {
    const result = await service.write({
      target: { documentId: id },
      markdown: "# Changed",
      approval: { ...approval("write"), approved: false },
    })

    expect(result.error?.code).toBe("FORBIDDEN")
    expect(documentService.openWriting).not.toHaveBeenCalled()
    expect(documentService.saveWriting).not.toHaveBeenCalled()
    expect(importDocument).not.toHaveBeenCalled()
  })

  it("reads only after a matching one-action approval", async () => {
    const result = await service.read({ documentId: id, approval: approval("read") })

    expect(result.error).toBeNull()
    expect(result.data?.document.markdown).toBe("# Doc\n\nBefore.")
    expect(result.data?.receipt).toMatchObject({ action: "read", approvalId: "read-1" })
    expect(documentService.openWriting).toHaveBeenCalledWith(id)
  })

  it("writes an existing document through the canonical save path", async () => {
    const result = await service.write({
      target: { documentId: id },
      markdown: "# Changed\n",
      approval: approval("write"),
    })

    expect(result.error).toBeNull()
    expect(documentService.saveWriting).toHaveBeenCalledTimes(1)
    expect(result.data?.document.documentId).toBe(id)
  })

  it("edits metadata through DocumentService while keeping the document UUID", async () => {
    const result = await service.edit({
      documentId: id,
      metadata: { status: "in_review", artifactType: "agent" },
      approval: approval("edit"),
    })

    expect(result.error).toBeNull()
    expect(documentService.updateWritingMetadata).toHaveBeenCalledWith(expect.objectContaining({ writingId: id, status: "in_review", artifactType: "agent" }))
    expect(result.data?.document.documentId).toBe(id)
  })

  it("moves through the existing relocate primitive and preserves UUID", async () => {
    const result = await service.move({
      documentId: id,
      destinationPath: "/workspace/archive/Doc.md",
      approval: approval("move"),
    })

    expect(result.error).toBeNull()
    expect(relocateDocument).toHaveBeenCalledWith(id, "/workspace/archive/Doc.md")
    expect(result.data?.document.documentId).toBe(id)
    expect(result.data?.document.canonicalPath).toBe("/workspace/archive/Doc.md")
  })

  it("rejects non-markdown move destinations before the relocate adapter", async () => {
    const destinationPath = "/workspace/archive/notes.txt"
    const result = await service.move({
      documentId: id,
      destinationPath,
      approval: approval("move", id, "move-non-markdown"),
    })

    expect(result.error?.code).toBe("FORBIDDEN")
    expect(relocateDocument).not.toHaveBeenCalled()
  })

  it("deletes through DocumentService only after approval", async () => {
    const result = await service.delete({ documentId: id, approval: approval("delete") })

    expect(result.error).toBeNull()
    expect(documentService.deleteWriting).toHaveBeenCalledWith(expect.objectContaining({ writingId: id, version: 1 }))
    expect(result.data?.document.documentId).toBe(id)
  })

  it("allows a new workflow path only inside the configured workspace root", async () => {
    catalog.resolvePath.mockResolvedValue({ kind: "unbound", path: "/workspace/workflow.md" })
    catalog.getById.mockResolvedValue(makeRecord("/workspace/workflow.md"))
    const result = await service.write({
      target: { canonicalPath: "/workspace/workflow.md" },
      markdown: "# Workspace workflow\n",
      approval: approval("write", "/workspace/workflow.md", "write-workflow"),
    })

    expect(result.error).toBeNull()
    expect(importDocument).toHaveBeenCalledWith("/workspace/workflow.md", "# Workspace workflow\n")
    expect(result.data?.document.documentId).toBe(id)
  })

  it("canonicalizes traversal before consuming approval or reaching a desktop adapter", async () => {
    const target = "/workspace/../outside.md"
    const result = await service.write({
      target: { canonicalPath: target },
      markdown: "# Outside",
      approval: approval("write", target, "write-outside"),
    })

    expect(result.error?.code).toBe("FORBIDDEN")
    expect(catalog.resolvePath).not.toHaveBeenCalled()
    expect(importDocument).not.toHaveBeenCalled()
    expect(documentService.openWriting).not.toHaveBeenCalled()
  })

  it("never exposes the internal .odessay ledger through agent writes", async () => {
    const target = "/workspace/.odessay/index.json"
    const result = await service.write({
      target: { canonicalPath: target },
      markdown: "{}",
      approval: approval("write", target, "write-internal"),
    })

    expect(result.error?.code).toBe("FORBIDDEN")
    expect(catalog.resolvePath).not.toHaveBeenCalled()
    expect(importDocument).not.toHaveBeenCalled()
  })

  it("rejects non-markdown agent write targets before any adapter call", async () => {
    const target = "/workspace/.env"
    const result = await service.write({
      target: { canonicalPath: target },
      markdown: "SECRET=do-not-write",
      approval: approval("write", target, "write-env"),
    })

    expect(result.error?.code).toBe("FORBIDDEN")
    expect(catalog.resolvePath).not.toHaveBeenCalled()
    expect(importDocument).not.toHaveBeenCalled()
  })

  it("rejects an existing non-markdown binding before an overwrite", async () => {
    catalog.getById.mockResolvedValue(makeRecord("/workspace/.env"))

    const result = await service.write({
      target: { documentId: id },
      markdown: "SECRET=do-not-write",
      approval: approval("write"),
    })

    expect(result.error?.code).toBe("FORBIDDEN")
    expect(documentService.openWriting).not.toHaveBeenCalled()
    expect(documentService.saveWriting).not.toHaveBeenCalled()
  })

  it("rejects the legacy internal workspace spelling before any adapter call", async () => {
    const legacyDirectory = [".ody", "ssey"].join("")
    const target = `/workspace/${legacyDirectory}/index.md`
    const result = await service.write({
      target: { canonicalPath: target },
      markdown: "# internal",
      approval: approval("write", target, "write-legacy-internal"),
    })

    expect(result.error?.code).toBe("FORBIDDEN")
    expect(catalog.resolvePath).not.toHaveBeenCalled()
    expect(importDocument).not.toHaveBeenCalled()
  })

  it("honors the native path validator for symlink escapes", async () => {
    const validatePath = vi.fn(async () => {
      throw new Error("candidate resolves outside the agent workspace root")
    })
    const guardedService = new DesktopWorkspaceAgentToolsService(root, {
      catalog: catalog as unknown as DocumentCatalog,
      documentService: documentService as unknown as DocumentService,
      importDocument: importDocument as unknown as (path: string, content: string) => Promise<ServiceResponse<WritingRecord>>,
      relocateDocument: relocateDocument as unknown as (id: string, requestedPath: string, content?: string) => Promise<RelocateDesktopWritingResult>,
      validatePath,
    })

    const result = await guardedService.read({ documentId: id, approval: approval("read") })

    expect(result.error?.code).toBe("FORBIDDEN")
    expect(validatePath).toHaveBeenCalledWith(root, "/workspace/Doc.md", true)
    expect(documentService.openWriting).not.toHaveBeenCalled()
  })
})
