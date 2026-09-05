import { describe, expect, it, vi } from "vitest"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type {
  WorkspaceAgentApproval,
  WorkspaceAgentDocument,
  WorkspaceAgentToolsService,
} from "@/lib/services/contracts/workspace-agent"
import { createWorkspaceAgentService } from "@/lib/services/workspace-agent-service"

function approval(action: WorkspaceAgentApproval["action"], resource: string): WorkspaceAgentApproval {
  return {
    action,
    approvalId: `${action}:${resource}`,
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
})
