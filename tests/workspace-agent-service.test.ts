import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type {
  WorkspaceAgentApproval,
  WorkspaceAgentDocument,
  WorkspaceAgentToolsService,
} from "@/lib/services/contracts/workspace-agent"
import { suggestArtifactClassification } from "@/lib/agent/workspace-agent-analysis"
import { getVocabularyCatalogSnapshot } from "@/lib/vocabulary/catalog"
import { createWorkspaceAgentService } from "@/lib/services/workspace-agent-service"

const contextMocks = vi.hoisted(() => ({
  list: vi.fn(),
  loadCollections: vi.fn(),
}))

const aiMocks = vi.hoisted(() => ({
  classifyWorkspace: vi.fn(),
  askWorkspace: vi.fn(),
}))

vi.mock("@/lib/services/document-catalog-factory", () => ({
  getDocumentCatalog: vi.fn(async () => ({ list: contextMocks.list })),
}))

vi.mock("@/lib/services/desktop/desktop-collection-service", () => ({
  loadDesktopCollections: contextMocks.loadCollections,
}))

vi.mock("@/lib/services/ai-service-factory", () => ({
  getAIService: () => aiMocks,
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

function document(id: string, markdown: string, modifiedAt = 1_700_000_000_000, relativePath = `${id}.md`): WorkspaceAgentDocument {
  const catalogRecord = {
    id,
    artifactType: "general",
    status: "draft",
    visibility: "private",
    version: 1,
    title: id,
    modifiedAt,
    binding: { canonicalPath: `/workspace/${relativePath}`, relativePath },
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
    aiMocks.classifyWorkspace.mockReset()
    aiMocks.classifyWorkspace.mockResolvedValue({
      data: { summary: "No change.", proposals: [], requestedDocumentIds: [], usage: null },
      error: null,
    })
    aiMocks.askWorkspace.mockReset()
    aiMocks.askWorkspace.mockResolvedValue({
      data: { answer: "No answer configured.", evidence: [], requestedDocumentIds: [], usage: null },
      error: null,
    })
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

  it("sends full target content and a separate workflow context through the semantic AI adapter", async () => {
    const workflow = document("workflow", "# Existing workflow")
    const target = document("target", "Storage: SQLite.")
    contextMocks.list.mockResolvedValue([workflow.catalogRecord, target.catalogRecord])
    contextMocks.loadCollections.mockResolvedValue({ collections: [], writingCollections: [] })
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ documentId, approval }) => ({
        data: {
          document: documentId === "workflow" ? workflow : target,
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

    aiMocks.classifyWorkspace.mockResolvedValueOnce({
      data: {
        summary: "The artifact is a general draft.",
        proposals: [{
          documentId: "target",
          decision: "keep",
          proposedArtifactType: "general",
          proposedStatus: "draft",
          change: "Keep the current type and status.",
          rationale: "The document states a concrete storage decision and is readable end to end.",
          benefit: "Avoids changing metadata without a user-visible improvement.",
          uncertainty: null,
          evidence: [{ documentId: "target", quote: "Storage: SQLite.", reason: "This is the document's concrete subject." }],
        }],
        requestedDocumentIds: [],
        usage: null,
      },
      error: null,
    })

    const result = await service.suggestClassification({
      request: "Review this document and keep metadata when no improvement is justified.",
      selection: [{ kind: "file", documentId: "target" }],
      workflowReadApproval: approval("read", "workflow"),
    })

    expect(result.error).toBeNull()
    expect(tools.read).toHaveBeenCalledWith(expect.objectContaining({ documentId: "workflow", approval: approval("read", "workflow") }))
    expect(tools.read).toHaveBeenCalledWith(expect.objectContaining({ documentId: "target", approval: expect.objectContaining({ action: "read", resource: "target" }) }))
    expect(aiMocks.classifyWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      request: "Review this document and keep metadata when no improvement is justified.",
      targetDocumentIds: ["target"],
      workflowMarkdown: "# Existing workflow",
      documents: expect.arrayContaining([
        expect.objectContaining({ id: "target", markdown: "Storage: SQLite.", currentStatus: "draft" }),
      ]),
      vocabulary: expect.arrayContaining([
        expect.objectContaining({ kind: "type", key: "general", description: expect.any(String) }),
        expect.objectContaining({ kind: "status", key: "draft", description: expect.any(String) }),
      ]),
    }))
    expect(result.data?.proposals[0]).toMatchObject({
      documentId: "target",
      documentTitle: "target",
      decision: "keep",
      evidence: [expect.objectContaining({ quote: "Storage: SQLite.", line: 1 })],
    })
  })

  it("askAgent answers a free-form question grounded in the selected document, without requiring metadata classification", async () => {
    const target = document("target", "Storage: SQLite.")
    contextMocks.list.mockResolvedValue([target.catalogRecord])
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ documentId, approval }) => ({
        data: {
          document: target,
          receipt: { action: "read" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    aiMocks.askWorkspace.mockResolvedValueOnce({
      data: {
        answer: "This document decides to use SQLite for storage.",
        evidence: [{ documentId: "target", quote: "Storage: SQLite.", reason: "States the storage decision." }],
        requestedDocumentIds: [],
        usage: null,
      },
      error: null,
    })
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.askAgent({
      question: "What storage does this artifact use?",
      selection: [{ kind: "file", documentId: "target" }],
    })

    expect(result.error).toBeNull()
    expect(aiMocks.askWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      question: "What storage does this artifact use?",
      targetDocumentIds: ["target"],
    }))
    expect(result.data).toMatchObject({
      answer: "This document decides to use SQLite for storage.",
      evidence: [expect.objectContaining({ quote: "Storage: SQLite.", line: 1 })],
    })
    expect(result.data?.documents).toEqual([{ documentId: "target", title: "target", path: "target.md" }])
  })

  it("askAgent forwards the session's recent actions as memory for the model, so later answers stay consistent with earlier ones", async () => {
    const target = document("target", "Storage: SQLite.")
    contextMocks.list.mockResolvedValue([target.catalogRecord])
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ approval }) => ({
        data: {
          document: target,
          receipt: { action: "read" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    aiMocks.askWorkspace.mockResolvedValueOnce({
      data: {
        answer: "As before, this document uses SQLite.",
        evidence: [],
        requestedDocumentIds: [],
        usage: null,
      },
      error: null,
    })
    const service = await createWorkspaceAgentService("/workspace", tools)

    await service.askAgent({
      question: "And in Spanish, what storage does it use?",
      selection: [{ kind: "file", documentId: "target" }],
      sessionContext: ["Q: What storage does this artifact use?\nA: This document decides to use SQLite for storage."],
    })

    expect(aiMocks.askWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      recentSessionActions: ["Q: What storage does this artifact use?\nA: This document decides to use SQLite for storage."],
    }))
  })

  it("askAgent drops evidence whose quote no longer appears in the current document content", async () => {
    const target = document("target", "Storage: SQLite.")
    contextMocks.list.mockResolvedValue([target.catalogRecord])
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ documentId, approval }) => ({
        data: {
          document: target,
          receipt: { action: "read" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    aiMocks.askWorkspace.mockResolvedValueOnce({
      data: {
        answer: "This document mentions PostgreSQL.",
        evidence: [{ documentId: "target", quote: "Storage: PostgreSQL.", reason: "Hallucinated quote not present in the source." }],
        requestedDocumentIds: [],
        usage: null,
      },
      error: null,
    })
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.askAgent({
      question: "What storage does this artifact use?",
      selection: [{ kind: "file", documentId: "target" }],
    })

    expect(result.error).toBeNull()
    expect(result.data?.evidence).toEqual([])
  })

  it("askAgent rejects an empty selection instead of silently answering with no context", async () => {
    contextMocks.list.mockResolvedValue([])
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.askAgent({ question: "What is this workspace about?", selection: [] })

    expect(result.error?.code).toBe("NOT_FOUND")
    expect(aiMocks.askWorkspace).not.toHaveBeenCalled()
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

  it("expands a selected folder through the catalog and reads each selected artifact completely", async () => {
    const first = document("first", "# First\n\nA reusable prompt.", 1_700_000_000_000, "notes/first.md")
    const second = document("second", "# Second\n\nA reusable template.", 1_700_000_100_000, "notes/second.md")
    contextMocks.list.mockResolvedValue([first.catalogRecord, second.catalogRecord])
    const documents = new Map([["first", first], ["second", second]])
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ documentId, approval }) => ({
        data: {
          document: documents.get(documentId)!,
          receipt: { action: "read" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    aiMocks.classifyWorkspace.mockResolvedValueOnce({
      data: {
        summary: "Both selected artifacts were reviewed from their full content.",
        proposals: [
          {
            documentId: "first",
            decision: "change",
            proposedArtifactType: "prompt",
            proposedStatus: "draft",
            change: "Classify as Prompt / Draft.",
            rationale: "The heading and body describe a reusable request.",
            benefit: "Makes the artifact easier to find as a reusable prompt.",
            uncertainty: null,
            evidence: [{ documentId: "first", quote: "A reusable prompt.", reason: "States the artifact's purpose." }],
          },
          {
            documentId: "second",
            decision: "change",
            proposedArtifactType: "template",
            proposedStatus: "draft",
            change: "Classify as Template / Draft.",
            rationale: "The body identifies a reusable starting shape.",
            benefit: "Makes the artifact easier to reuse consistently.",
            uncertainty: null,
            evidence: [{ documentId: "second", quote: "A reusable template.", reason: "States the artifact's purpose." }],
          },
        ],
        requestedDocumentIds: [],
        usage: null,
      },
      error: null,
    })
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.suggestClassification({
      request: "Review the notes folder.",
      selection: [{ kind: "folder", path: "/workspace/notes" }],
    })

    expect(result.error).toBeNull()
    expect(tools.read).toHaveBeenCalledTimes(2)
    expect(aiMocks.classifyWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      targetDocumentIds: ["first", "second"],
      documents: expect.arrayContaining([
        expect.objectContaining({ id: "first", markdown: "# First\n\nA reusable prompt." }),
        expect.objectContaining({ id: "second", markdown: "# Second\n\nA reusable template." }),
      ]),
    }))
    expect(result.data?.proposals.map((proposal) => proposal.artifactType)).toEqual(["prompt", "template"])
  })

  it("keeps the model decision authoritative instead of copying a similar catalog peer", async () => {
    const target = document("target", "# Reusable prompt\n\nAsk the user for the missing context.")
    const peer = document("peer", "# Reusable prompt\n\nAsk the user for the missing context.")
    target.catalogRecord.title = "Reusable prompt"
    target.catalogRecord.excerpt = "Ask the user for the missing context."
    peer.catalogRecord.title = "Reusable prompt"
    peer.catalogRecord.excerpt = "Ask the user for the missing context."
    peer.catalogRecord.artifactType = "template"
    peer.catalogRecord.status = "done"
    contextMocks.list.mockResolvedValue([target.catalogRecord, peer.catalogRecord])
    const heuristic = suggestArtifactClassification(
      target.catalogRecord,
      [target.catalogRecord, peer.catalogRecord],
      getVocabularyCatalogSnapshot(),
    )
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ approval }) => ({
        data: {
          document: target,
          receipt: { action: "read" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    aiMocks.classifyWorkspace.mockResolvedValueOnce({
      data: {
        summary: "The body is a reusable prompt, not a template.",
        proposals: [{
          documentId: "target",
          decision: "change",
          proposedArtifactType: "prompt",
          proposedStatus: "draft",
          change: "Change the type to Prompt.",
          rationale: "The document directly asks an agent to ask the user for context.",
          benefit: "Makes the artifact discoverable as a reusable prompt.",
          uncertainty: null,
          evidence: [{ documentId: "target", quote: "Ask the user for the missing context.", reason: "The instruction defines the reusable prompt behavior." }],
        }],
        requestedDocumentIds: [],
        usage: null,
      },
      error: null,
    })
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.suggestClassification({
      request: "Classify this artifact by its purpose, not by a similar peer.",
      selection: [{ kind: "file", documentId: "target" }],
    })

    expect(heuristic.artifactType).toBe("template")
    expect(result.data?.proposals[0]).toMatchObject({ artifactType: "prompt", status: "draft", decision: "change" })
  })

  it("creates a review-only proposal when the model omits a selected artifact", async () => {
    const first = document("first", "# First\n\nA complete note.")
    const second = document("second", "# Second\n\nAnother complete note.")
    contextMocks.list.mockResolvedValue([first.catalogRecord, second.catalogRecord])
    const documents = new Map([["first", first], ["second", second]])
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ documentId, approval }) => ({
        data: {
          document: documents.get(documentId)!,
          receipt: { action: "read" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    aiMocks.classifyWorkspace.mockResolvedValueOnce({
      data: {
        summary: "Only one selected artifact was classified.",
        proposals: [{
          documentId: "first",
          decision: "keep",
          proposedArtifactType: "general",
          proposedStatus: "draft",
          change: "Keep the current values.",
          rationale: "The note is complete and its metadata remains accurate.",
          benefit: "Avoids unnecessary metadata churn.",
          uncertainty: null,
          evidence: [{ documentId: "first", quote: "A complete note.", reason: "The body supports the current classification." }],
        }],
        requestedDocumentIds: [],
        usage: null,
      },
      error: null,
    })
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.suggestClassification({
      request: "Review both artifacts.",
      selection: [{ kind: "file", documentId: "first" }, { kind: "file", documentId: "second" }],
    })

    expect(result.data?.proposals).toHaveLength(2)
    expect(result.data?.proposals[1]).toMatchObject({
      documentId: "second",
      decision: "needs-review",
      change: "No semantic decision was returned for this artifact.",
    })
    expect(tools.edit).not.toHaveBeenCalled()
  })

  it("downgrades unverifiable evidence and inactive vocabulary to review-only output", async () => {
    const target = document("target", "The body contains the evidence.")
    contextMocks.list.mockResolvedValue([target.catalogRecord])
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ approval }) => ({
        data: {
          document: target,
          receipt: { action: "read" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    }
    aiMocks.classifyWorkspace.mockResolvedValueOnce({
      data: {
        summary: "The model returned an unsupported type and a non-existent quote.",
        proposals: [{
          documentId: "target",
          decision: "change",
          proposedArtifactType: "not-active",
          proposedStatus: "draft",
          change: "Change the type.",
          rationale: "The evidence suggests a different purpose.",
          benefit: "Would improve discovery if verified.",
          uncertainty: null,
          evidence: [{ documentId: "target", quote: "This sentence is not present.", reason: "Unverified claim." }],
        }],
        requestedDocumentIds: ["unknown", "target"],
        usage: null,
      },
      error: null,
    })
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.suggestClassification({
      request: "Classify this artifact.",
      selection: [{ kind: "file", documentId: "target" }],
    })

    expect(result.error).toBeNull()
    expect(result.data?.proposals[0]).toMatchObject({ decision: "needs-review", artifactType: null, status: "draft" })
    expect(result.data?.proposals[0]?.uncertainty).toEqual(expect.stringContaining("not active"))
    expect(result.data?.proposals[0]?.evidence).toEqual([])
    expect(result.data?.requestedDocumentIds).toEqual([])
  })

  it("rejects a metadata approval when the classification evidence is stale", async () => {
    const target = document("target", "A skill.")
    target.catalogRecord = {
      ...target.catalogRecord,
      binding: {
        ...target.catalogRecord.binding!,
        contentHash: "current-hash",
      },
    }
    contextMocks.list.mockResolvedValue([target.catalogRecord])
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ approval }) => ({
        data: {
          document: target,
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

    const result = await service.applyClassification({
      documentId: "target",
      documentTitle: "target",
      documentPath: "target.md",
      currentArtifactType: "general",
      currentStatus: "draft",
      artifactType: "skill",
      status: "draft",
      decision: "change",
      change: "Change type to Skill.",
      benefit: "Improves discovery.",
      uncertainty: null,
      sourceContentHash: "old-hash",
      sourceVersion: 1,
      sourceModifiedAt: 1_700_000_000_000,
      evidenceSources: [{
        documentId: "target",
        contentHash: "old-hash",
        version: 1,
        modifiedAt: 1_700_000_000_000,
      }],
      evidence: [],
      reason: "The body describes a reusable procedure.",
    }, approval("edit", "target"))

    expect(result.error?.code).toBe("CONFLICT")
    expect(tools.edit).not.toHaveBeenCalled()
  })

  it("revalidates the target quote and active vocabulary before applying approved metadata", async () => {
    const target = document("target", "# Prompt\n\nAsk for context.")
    contextMocks.list.mockResolvedValue([target.catalogRecord])
    const updated = document("target", target.markdown)
    updated.catalogRecord.artifactType = "prompt"
    const tools: WorkspaceAgentToolsService = {
      read: vi.fn(async ({ approval }) => ({
        data: {
          document: target,
          receipt: { action: "read" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      write: vi.fn(),
      move: vi.fn(),
      edit: vi.fn(async ({ approval, metadata }) => ({
        data: {
          document: { ...updated, catalogRecord: { ...updated.catalogRecord, artifactType: metadata?.artifactType ?? updated.catalogRecord.artifactType } },
          receipt: { action: "edit" as const, approvalId: approval.approvalId, executedAt: "2026-01-01T00:00:00.000Z" },
        },
        error: null,
      })),
      delete: vi.fn(),
    }
    const service = await createWorkspaceAgentService("/workspace", tools)

    const result = await service.applyClassification({
      documentId: "target",
      documentTitle: "target",
      documentPath: "target.md",
      currentArtifactType: "general",
      currentStatus: "draft",
      artifactType: "prompt",
      status: "draft",
      decision: "change",
      change: "Change type to Prompt.",
      benefit: "Makes the reusable instruction easier to find.",
      uncertainty: null,
      sourceContentHash: null,
      sourceVersion: 1,
      sourceModifiedAt: 1_700_000_000_000,
      evidenceSources: [{
        documentId: "target",
        contentHash: null,
        version: 1,
        modifiedAt: 1_700_000_000_000,
      }],
      evidence: [{
        kind: "document",
        sourceId: "target",
        label: "target",
        detail: "line 3: The instruction defines the purpose.",
        quote: "Ask for context.",
        line: 3,
      }],
      reason: "The body is written as a reusable instruction.",
    }, approval("edit", "target"))

    expect(result.error).toBeNull()
    expect(result.data?.document.catalogRecord.artifactType).toBe("prompt")
    expect(tools.edit).toHaveBeenCalledWith(expect.objectContaining({
      documentId: "target",
      metadata: { artifactType: "prompt" },
    }))
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
