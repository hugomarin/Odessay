import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type {
  WorkspaceAgentApproval,
  WorkspaceAgentDocument,
  WorkspaceAgentToolsService,
} from "@/lib/services/contracts/workspace-agent"
import { createWorkspaceAgentService } from "@/lib/services/workspace-agent-service"

const contextMocks = vi.hoisted(() => ({
  list: vi.fn(),
  loadCollections: vi.fn(),
}))

vi.mock("@/lib/services/document-catalog-factory", () => ({
  getDocumentCatalog: vi.fn(async () => ({ list: contextMocks.list })),
}))

vi.mock("@/lib/services/desktop/desktop-collection-service", () => ({
  loadDesktopCollections: contextMocks.loadCollections,
}))

function approval(action: WorkspaceAgentApproval["action"], resource: string, approvalId = `${action}:${resource}`): WorkspaceAgentApproval {
  return {
    action,
    approvalId,
    approved: true,
    approvedAt: "2026-01-01T00:00:00.000Z",
    resource,
  }
}

function document(id: string, markdown: string, modifiedAt = 1_700_000_000_000): WorkspaceAgentDocument {
  const catalogRecord = {
    id,
    title: id,
    modifiedAt,
    binding: { canonicalPath: `/workspace/${id}.md` },
  } as DocumentCatalogRecord
  return {
    documentId: id,
    canonicalPath: `/workspace/${id}.md`,
    title: id,
    markdown,
    catalogRecord,
  }
}

describe("WorkspaceAgentService contradiction workflow", () => {
  beforeEach(() => {
    contextMocks.list.mockReset()
    contextMocks.list.mockResolvedValue([])
    contextMocks.loadCollections.mockReset()
    contextMocks.loadCollections.mockResolvedValue({ collections: [], writingCollections: [] })
  })

  it("reads only selected documents and applies a cited resolution through edit", async () => {
    const documents = new Map([
      ["left", document("left", "Storage: SQLite.", 1_700_000_000_000)],
      ["right", document("right", "Storage: IndexedDB.", 1_700_000_100_000)],
    ])
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ documentId }) => ({
        data: {
          document: documents.get(documentId)!,
          receipt: { action: "read" as const, approvalId: `read:${documentId}`, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      edit: vi.fn(async ({ documentId, markdown, approval }) => ({
        data: {
          document: document(documentId, markdown ?? ""),
          receipt: { action: "edit" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      delete: vi.fn(),
    }
    const service = await createWorkspaceAgentService("/workspace", tools)

    const found = await service.findContradictions(["left", "right"], {
      left: approval("read", "left"),
      right: approval("read", "right"),
    })

    expect(found.error).toBeNull()
    expect(found.data).toHaveLength(1)
    expect(tools.read).toHaveBeenCalledTimes(2)

    const resolved = await service.resolveContradiction(found.data![0], "right", {
      read: approval("read", "left"),
      edit: approval("edit", "left"),
    })

    expect(resolved.error).toBeNull()
    expect(resolved.data?.resolvedDocumentId).toBe("left")
    expect(tools.edit).toHaveBeenCalledWith(expect.objectContaining({
      documentId: "left",
      markdown: "Storage: IndexedDB.",
    }))
  })

  it("refuses a comparison when a selected document has no approval", async () => {
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ documentId }) => ({
        data: {
          document: document(documentId, "Storage: SQLite."),
          receipt: { action: "read" as const, approvalId: `read:${documentId}`, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    const service = await createWorkspaceAgentService("/workspace", tools)
    const result = await service.findContradictions(["left", "right"], { left: approval("read", "left") })

    expect(result.error?.code).toBe("FORBIDDEN")
    expect(tools.read).not.toHaveBeenCalled()
  })

  it("uses a workflow approval instead of reusing the target approval during classification", async () => {
    const workflow = document("workflow", "# Existing workflow")
    const target = document("target", "Storage: SQLite.")
    contextMocks.list.mockResolvedValue([workflow.catalogRecord, target.catalogRecord])
    contextMocks.loadCollections.mockResolvedValue({ collections: [], writingCollections: [] })
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ documentId, approval }) => ({
        data: {
          document: workflow,
          receipt: { action: "read" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.suggestClassification("target", approval("read", "workflow"))

    expect(result.error).toBeNull()
    expect(tools.read).toHaveBeenCalledWith(expect.objectContaining({ documentId: "workflow", approval: approval("read", "workflow") }))
    expect(tools.read).not.toHaveBeenCalledWith(expect.objectContaining({ documentId: "target" }))
  })

  it("uses a workflow-specific read approval only when proposing an existing workflow", async () => {
    const workflow = document("workflow", "# Existing workflow")
    const target = document("target", "Storage: SQLite.")
    contextMocks.list.mockResolvedValue([workflow.catalogRecord, target.catalogRecord])
    contextMocks.loadCollections.mockResolvedValue({ collections: [], writingCollections: [] })
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ documentId, approval }) => ({
        data: {
          document: workflow,
          receipt: { action: "read" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.proposeWorkflow(approval("read", "workflow"))

    expect(result.error).toBeNull()
    expect(tools.read).toHaveBeenCalledWith(expect.objectContaining({ documentId: "workflow", approval: approval("read", "workflow") }))
  })

  it("requires the workflow-specific approval before proposing an existing workflow", async () => {
    const workflow = document("workflow", "# Existing workflow")
    const target = document("target", "Storage: SQLite.")
    contextMocks.list.mockResolvedValue([workflow.catalogRecord, target.catalogRecord])
    contextMocks.loadCollections.mockResolvedValue({ collections: [], writingCollections: [] })
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.proposeWorkflow()

    expect(result.error?.code).toBe("FORBIDDEN")
    expect(tools.read).not.toHaveBeenCalled()
  })

  it("reads, edits and records an approved broken-reference fix", async () => {
    const source = document("source", "See [missing](missing.md).")
    const proposal = {
      sourceDocumentId: "source",
      sourceTitle: "Source",
      reference: "missing.md",
      referenceKind: "path" as const,
      candidateDocumentId: "target",
      candidateTitle: "Target",
      suggestedReference: "target.md",
      evidence: [],
    }
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async () => ({
        data: {
          document: source,
          receipt: { action: "read" as const, approvalId: "read:source", executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      edit: vi.fn(async ({ markdown, approval }) => ({
        data: {
          document: document("source", markdown ?? ""),
          receipt: { action: "edit" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      delete: vi.fn(),
    }
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.applyBrokenReference(proposal, "target.md", {
      read: approval("read", "source"),
      edit: approval("edit", "source"),
    })

    expect(result.error).toBeNull()
    expect(tools.read).toHaveBeenCalledWith(expect.objectContaining({ documentId: "source", approval: approval("read", "source") }))
    expect(tools.edit).toHaveBeenCalledWith(expect.objectContaining({ documentId: "source", markdown: "See [missing](target.md).", approval: approval("edit", "source") }))
  })

  it("rebases the next queued contradiction after a length-changing resolution", async () => {
    const documents = new Map([
      ["left", document("left", "Storage: SQLite.\nThe editor uses local files.", 1_700_000_000_000)],
      ["right", document("right", "Storage: IndexedDB.\nThe editor does not use local files.", 1_700_000_100_000)],
    ])
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ documentId }) => ({
        data: {
          document: documents.get(documentId)!,
          receipt: { action: "read" as const, approvalId: `read:${documentId}`, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      edit: vi.fn(async ({ documentId, markdown, approval }) => {
        const next = document(documentId, markdown ?? "")
        documents.set(documentId, next)
        return {
          data: {
            document: next,
            receipt: { action: "edit" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
          },
          error: null,
        }
      }),
      write: vi.fn(),
      move: vi.fn(),
      delete: vi.fn(),
    }
    const service = await createWorkspaceAgentService("/workspace", tools)
    const found = await service.findContradictions(["left", "right"], {
      left: approval("read", "left"),
      right: approval("read", "right"),
    })

    expect(found.data).toHaveLength(2)
    const first = found.data!.find((proposal) => proposal.left.fragment.text.startsWith("Storage:"))!
    const second = found.data!.find((proposal) => proposal.left.fragment.text.startsWith("The editor"))!

    const firstResolution = await service.resolveContradiction(first, "right", {
      read: approval("read", "left", "read-left-first"),
      edit: approval("edit", "left", "edit-left-first"),
    })
    const secondResolution = await service.resolveContradiction(second, "right", {
      read: approval("read", "left", "read-left-second"),
      edit: approval("edit", "left", "edit-left-second"),
    })

    expect(firstResolution.error).toBeNull()
    expect(secondResolution.error).toBeNull()
    expect(documents.get("left")?.markdown).toBe("Storage: IndexedDB.\nThe editor does not use local files.")
    expect(tools.edit).toHaveBeenCalledTimes(2)
  })
})
