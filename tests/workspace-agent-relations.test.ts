import { describe, expect, it } from "vitest"

import {
  buildWorkspaceDocumentRelationsRequest,
  isResolvableSemanticContradiction,
  parseWorkspaceDocumentRelationsResult,
  type WorkspaceDocumentRelationSource,
} from "@/lib/ai/workspace-document-relations"
import { createWorkspaceExecutionContext } from "@/lib/ai/workspace-execution-receipt"
import type { WorkspaceSemanticLoopResult } from "@/lib/ai/workspace-semantic-loop"

function source(documentId: string, markdown: string): WorkspaceDocumentRelationSource {
  return {
    documentId,
    title: documentId,
    documentVersion: "v1@1700000000000",
    contentHash: null,
    markdown,
  }
}

function loopResult(
  output: unknown,
  overrides: Partial<WorkspaceSemanticLoopResult> = {},
): WorkspaceSemanticLoopResult {
  return {
    operation: "relations",
    status: "complete",
    coverage: "complete",
    rounds: 1,
    toolCalls: [],
    evidence: [],
    finalText: JSON.stringify({
      coverage: "complete",
      status: "complete",
      payload: JSON.stringify(output),
    }),
    error: null,
    executionReceipt: null,
    ...overrides,
  }
}

describe("Workspace semantic document relations", () => {
  it("builds bounded evidence and coverage samples without sending paths", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", "Storage: SQLite.\nThe moon is visible tonight."),
      source("right", "Storage: IndexedDB.\nTables remain hidden indoors."),
    ])

    expect(request.initialEvidence).toHaveLength(4)
    expect(request.candidates.length).toBeGreaterThan(0)
    expect(request.candidates.some((candidate) => candidate.deterministicSignal === "coverage-sample")).toBe(true)
    const prompt = request.initialInput[0]
    expect(prompt?.type).toBe("message")
    if (!prompt || prompt.type !== "message") throw new Error("Expected a semantic relation prompt.")
    expect(prompt.content).not.toContain("/workspace")
    expect(prompt.content).toContain("deterministic candidates are recall hints only")
    expect(Math.max(...request.initialEvidence.map((item) => item.text.length))).toBeLessThanOrEqual(720)
  })

  it("keeps valid relation items while downgrading invalid provenance to partial coverage", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", "Storage: SQLite."),
      source("right", "Storage: IndexedDB."),
    ])
    const leftEvidence = request.initialEvidence.find((item) => item.documentId === "left")!
    const rightEvidence = request.initialEvidence.find((item) => item.documentId === "right")!
    const result = parseWorkspaceDocumentRelationsResult(loopResult({
      coverage: "complete",
      relations: [
        {
          candidateId: request.candidates[0]?.candidateId ?? null,
          leftDocumentId: "left",
          rightDocumentId: "right",
          verdict: "contradictory",
          confidence: "high",
          rationale: "The storage authorities are incompatible.",
          evidenceIds: [leftEvidence.evidenceId, rightEvidence.evidenceId],
          suggestedDocumentId: null,
          suggestedReason: null,
        },
        {
          candidateId: null,
          leftDocumentId: "left",
          rightDocumentId: "right",
          verdict: "contradictory",
          confidence: "high",
          rationale: "This item cites evidence outside the admitted bundle.",
          evidenceIds: [leftEvidence.evidenceId, "invented-evidence"],
          suggestedDocumentId: null,
          suggestedReason: null,
        },
      ],
    }, { evidence: request.initialEvidence }), request)

    expect(result.status).toBe("insufficient_evidence")
    expect(result.coverage).toBe("partial")
    expect(result.invalidItemCount).toBe(1)
    expect(result.relations).toHaveLength(1)
    expect(isResolvableSemanticContradiction(result.relations[0]!)).toBe(true)
  })

  it("never derives a source suggestion from recency and requires high confidence for resolution", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", "Storage: SQLite."),
      source("right", "Storage: IndexedDB."),
    ])
    const evidenceIds = request.initialEvidence.map((item) => item.evidenceId)
    const parsed = parseWorkspaceDocumentRelationsResult(loopResult({
      coverage: "complete",
      relations: [{
        candidateId: null,
        leftDocumentId: "left",
        rightDocumentId: "right",
        verdict: "contradictory",
        confidence: "medium",
        rationale: "The snippets may conflict, but context is incomplete.",
        evidenceIds,
        suggestedDocumentId: null,
        suggestedReason: null,
      }],
    }, { evidence: request.initialEvidence }), request)

    expect(parsed.relations[0]?.suggestedDocumentId).toBeNull()
    expect(isResolvableSemanticContradiction(parsed.relations[0]!)).toBe(false)
  })

  it("rejects a known candidate when its document or evidence pair is mismatched", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", "Storage: SQLite."),
      source("right", "Storage: IndexedDB."),
    ])
    const leftEvidence = request.initialEvidence.find((item) => item.documentId === "left")!
    const rightEvidence = request.initialEvidence.find((item) => item.documentId === "right")!
    const result = parseWorkspaceDocumentRelationsResult(loopResult({
      coverage: "partial",
      relations: [{
        candidateId: request.candidates[0]?.candidateId ?? null,
        leftDocumentId: "right",
        rightDocumentId: "left",
        verdict: "contradictory",
        confidence: "high",
        rationale: "The candidate was deliberately assigned to the reverse pair.",
        evidenceIds: [leftEvidence.evidenceId, rightEvidence.evidenceId],
        suggestedDocumentId: null,
        suggestedReason: "Discarded with the null suggestion.",
      }],
    }, { evidence: request.initialEvidence }), request)

    expect(result.relations).toEqual([])
    expect(result.invalidItemCount).toBe(1)
    expect(result.coverage).toBe("partial")
  })

  it("preserves explicit provider and loop failures without matcher fallback", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", "Storage: SQLite."),
      source("right", "Storage: IndexedDB."),
    ])
    const execution = createWorkspaceExecutionContext("relations", "desktop", "semantic-review")
    const result = parseWorkspaceDocumentRelationsResult(loopResult(null, {
      status: "provider_error",
      coverage: "unknown",
      finalText: null,
      evidence: request.initialEvidence,
      error: { code: "AI_REQUEST_FAILED", message: "Provider unavailable.", retryable: true },
      executionReceipt: null,
    }), request)

    expect(result.status).toBe("provider_error")
    expect(result.coverage).toBe("unknown")
    expect(result.relations).toEqual([])
    expect(result.error?.code).toBe("AI_REQUEST_FAILED")
    expect(execution.action).toBe("relations")
  })
})
