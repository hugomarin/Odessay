import { describe, expect, it, vi } from "vitest"
import {
  appendWorkspaceResponseTrace,
  createWorkspaceExecutionContext,
  createWorkspaceExecutionReceipt,
} from "@/lib/ai/workspace-execution-receipt"
import {
  runWorkspaceSemanticLoop,
} from "@/lib/ai/workspace-semantic-loop"
import {
  createWorkspaceSemanticToolRegistry,
  getWorkspaceSemanticToolDescriptors,
  WORKSPACE_SEMANTIC_READ_TOOL_NAME,
} from "@/lib/ai/workspace-semantic-tool-registry"
import type {
  WorkspaceSemanticRoundResult,
} from "@/lib/services/contracts/ai-service"
import type {
  WorkspaceAgentEvidenceReadResult,
} from "@/lib/services/contracts/workspace-agent"

const documentId = "doc-1"
const documentVersion = "hash-v1"
const contentHash = "hash-v1"

function roundReceipt(responseId: string, status: string, output: unknown[] = [], execution = createWorkspaceExecutionContext("relations", "desktop", "semantic-review")) {
  return appendWorkspaceResponseTrace(
    createWorkspaceExecutionReceipt(execution),
    { id: responseId, status, model: "test-model", output, usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } },
    { httpStatus: 200, latencyMs: 2 },
  )
}

function semanticRound(overrides: Partial<WorkspaceSemanticRoundResult>): WorkspaceSemanticRoundResult {
  return {
    responseId: null,
    previousResponseId: null,
    status: "empty",
    outputText: null,
    toolCalls: [],
    incompleteReason: null,
    usage: null,
    executionReceipt: null,
    ...overrides,
  }
}

function makeRegistry(readEvidence = vi.fn(async (): Promise<ReturnType<typeof evidenceRead>> => evidenceRead())) {
  return createWorkspaceSemanticToolRegistry({
    knownDocuments: new Map([[documentId, { documentVersion, contentHash }]]),
    readEvidence,
  })
}

function evidenceRead(): { data: WorkspaceAgentEvidenceReadResult; error: null } {
  return {
    data: {
      evidence: {
        evidenceId: "evidence-1",
        documentId,
        documentVersion,
        contentHash,
        lineStart: 1,
        lineEnd: 2,
        text: "SQLite is the desktop catalog.\nThe document is authoritative.",
      },
      receipt: { action: "read", approvalId: "internal-read", executedAt: "2026-01-01T00:00:00.000Z" },
    },
    error: null,
  }
}

describe("Workspace semantic tool loop", () => {
  it("completes a bounded tool round and carries the same invocation and call id forward", async () => {
    const execution = createWorkspaceExecutionContext("relations", "desktop", "semantic-review")
    const descriptors = getWorkspaceSemanticToolDescriptors()
    const readEvidence = vi.fn(async () => evidenceRead())
    const registry = makeRegistry(readEvidence)
    const runSemanticRound = vi.fn()
      .mockResolvedValueOnce({
        data: semanticRound({
          responseId: "resp-1",
          status: "requires_tool",
          toolCalls: [{
            callId: "call-1",
            name: WORKSPACE_SEMANTIC_READ_TOOL_NAME,
            arguments: {
              documentId,
              expectedDocumentVersion: documentVersion,
              expectedContentHash: contentHash,
              lineStart: 1,
              lineEnd: 2,
              maxChars: 500,
            },
          }],
          executionReceipt: roundReceipt("resp-1", "completed", [{ type: "function_call", call_id: "call-1", name: WORKSPACE_SEMANTIC_READ_TOOL_NAME }], execution),
        }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: semanticRound({
          responseId: "resp-2",
          previousResponseId: "resp-1",
          status: "completed",
          outputText: JSON.stringify({ coverage: "complete", status: "complete", payload: JSON.stringify({ relation: "complementary" }) }),
          executionReceipt: roundReceipt("resp-2", "completed", [{ type: "message" }], execution),
        }),
        error: null,
      })

    const result = await runWorkspaceSemanticLoop({
      operation: "relations",
      execution,
      initialInput: [{ type: "message", role: "user", content: "Review these selected documents." }],
      initialEvidence: [{
        evidenceId: "initial-1",
        documentId,
        documentVersion,
        contentHash,
        lineStart: 1,
        lineEnd: 1,
        text: "Initial bounded evidence.",
      }],
      tools: descriptors,
      registry,
      aiService: { runSemanticRound },
    })

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      status: "complete",
      coverage: "complete",
      rounds: 2,
      toolCalls: [{ round: 1, callId: "call-1", name: WORKSPACE_SEMANTIC_READ_TOOL_NAME, outcome: "executed", evidenceId: "evidence-1" }],
      executionReceipt: expect.objectContaining({
        invocationId: execution.invocationId,
        responses: [
          expect.objectContaining({ responseId: "resp-1" }),
          expect.objectContaining({ responseId: "resp-2" }),
        ],
      }),
    })
    expect(readEvidence).toHaveBeenCalledTimes(1)
    expect(runSemanticRound).toHaveBeenCalledTimes(2)
    expect(runSemanticRound.mock.calls[0][0]).toMatchObject({
      execution,
      previousResponseId: null,
    })
    expect(runSemanticRound.mock.calls[1][0]).toMatchObject({
      execution,
      previousResponseId: "resp-1",
      input: [{ type: "function_call_output", callId: "call-1" }],
    })
    expect(runSemanticRound.mock.calls[1][0].input[0].output).toContain("evidence-1")
  })

  it("stops with insufficient evidence when a model call is stale", async () => {
    const readEvidence = vi.fn(async () => evidenceRead())
    const registry = makeRegistry(readEvidence)
    const execution = createWorkspaceExecutionContext("relations", "desktop", "semantic-review")
    const runSemanticRound = vi.fn().mockResolvedValue({
      data: semanticRound({
        responseId: "resp-stale",
        status: "requires_tool",
        toolCalls: [{
          callId: "call-stale",
          name: WORKSPACE_SEMANTIC_READ_TOOL_NAME,
          arguments: {
            documentId,
            expectedDocumentVersion: "hash-v2",
            expectedContentHash: "hash-v2",
            lineStart: 1,
            lineEnd: 1,
            maxChars: 100,
          },
        }],
        executionReceipt: roundReceipt("resp-stale", "completed", [], execution),
      }),
      error: null,
    })

    const result = await runWorkspaceSemanticLoop({
      operation: "relations",
      execution,
      initialInput: [{ type: "message", role: "user", content: "Review." }],
      initialEvidence: [{ evidenceId: "initial-1", documentId, documentVersion, contentHash, lineStart: 1, lineEnd: 1, text: "Evidence." }],
      registry,
      aiService: { runSemanticRound },
    })

    expect(result.data).toMatchObject({
      status: "insufficient_evidence",
      coverage: "partial",
      error: { code: "CONFLICT" },
      toolCalls: [{ outcome: "rejected", callId: "call-stale" }],
    })
    expect(readEvidence).not.toHaveBeenCalled()
  })

  it("does not execute more than four evidence references in one follow-up", async () => {
    const readEvidence = vi.fn(async () => evidenceRead())
    const registry = makeRegistry(readEvidence)
    const execution = createWorkspaceExecutionContext("relations", "desktop", "semantic-review")
    const toolCalls = Array.from({ length: 5 }, (_, index) => ({
      callId: `call-${index}`,
      name: WORKSPACE_SEMANTIC_READ_TOOL_NAME,
      arguments: {
        documentId,
        expectedDocumentVersion: documentVersion,
        expectedContentHash: contentHash,
        lineStart: 1,
        lineEnd: 1,
        maxChars: 100,
      },
    }))
    const runSemanticRound = vi.fn().mockResolvedValue({
      data: semanticRound({
        responseId: "resp-many",
        status: "requires_tool",
        toolCalls,
        executionReceipt: roundReceipt("resp-many", "completed", [], execution),
      }),
      error: null,
    })

    const result = await runWorkspaceSemanticLoop({
      operation: "relations",
      execution,
      initialInput: [{ type: "message", role: "user", content: "Review." }],
      initialEvidence: [{ evidenceId: "initial-1", documentId, documentVersion, contentHash, lineStart: 1, lineEnd: 1, text: "Evidence." }],
      registry,
      aiService: { runSemanticRound },
    })

    expect(result.data).toMatchObject({
      status: "budget_exceeded",
      error: { code: "BUDGET_EXCEEDED" },
      rounds: 1,
    })
    expect(readEvidence).not.toHaveBeenCalled()
    expect(runSemanticRound).toHaveBeenCalledTimes(1)
  })

  it("rejects path-shaped identities and unknown documents at the registry boundary", () => {
    const registry = makeRegistry()
    const pathIdentity = registry.validateCall({
      callId: "call-path",
      name: WORKSPACE_SEMANTIC_READ_TOOL_NAME,
      arguments: {
        documentId: "/workspace/Doc.md",
        expectedDocumentVersion: documentVersion,
        expectedContentHash: contentHash,
        lineStart: 1,
        lineEnd: 1,
        maxChars: 100,
      },
    })
    const unknownDocument = registry.validateCall({
      callId: "call-unknown",
      name: WORKSPACE_SEMANTIC_READ_TOOL_NAME,
      arguments: {
        documentId: "doc-unknown",
        expectedDocumentVersion: documentVersion,
        expectedContentHash: contentHash,
        lineStart: 1,
        lineEnd: 1,
        maxChars: 100,
      },
    })

    expect(pathIdentity.error?.code).toBe("INVALID_INPUT")
    expect(unknownDocument.error?.code).toBe("NOT_FOUND")
  })
})
