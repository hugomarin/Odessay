import { describe, expect, it } from "vitest"

import {
  buildWorkspaceDocumentRelationsRequest,
  isResolvableSemanticContradiction,
  parseWorkspaceDocumentRelationsResult,
  type WorkspaceDocumentRelationSource,
} from "@/lib/ai/workspace-document-relations"
import { createWorkspaceExecutionContext } from "@/lib/ai/workspace-execution-receipt"
import { workspaceSemanticRoundRequestSchema } from "@/lib/ai/workspace-semantic-round"
import { getWorkspaceSemanticToolDescriptors } from "@/lib/ai/workspace-semantic-tool-registry"
import type { WorkspaceSemanticLoopResult } from "@/lib/ai/workspace-semantic-loop"

function source(documentId: string, markdown: string, documentVersion = "v1@1700000000000", contentHash: string | null = null): WorkspaceDocumentRelationSource {
  return {
    documentId,
    title: documentId,
    documentVersion,
    contentHash,
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

  it("sends complete content for every selected document in ordered chunks", () => {
    const longBody = "# Scope\n\n" + "The complete relation claim. ".repeat(700)
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", longBody),
      source("right", "# Notes\n\nThe second complete relation source."),
    ])
    const prompt = request.initialInput
      .filter((item): item is Extract<typeof item, { type: "message" }> => item.type === "message")
      .map((item) => item.content)
      .join("\n")

    expect(request.contextComplete).toBe(true)
    expect((prompt.match(/The complete relation claim\./g) ?? []).length).toBeGreaterThanOrEqual(700)
    expect(prompt).toContain("The second complete relation source.")
    expect(request.initialInput.length).toBeGreaterThan(3)
  })

  it("detects two incompatible claims inside one selected document", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("single", "# Storage\n\nStorage: SQLite.\n\n# Migration\n\nStorage: IndexedDB."),
    ])
    const candidate = request.candidates.find((item) => item.leftDocumentId === "single" && item.rightDocumentId === "single")
    expect(candidate).toBeDefined()
    expect(candidate?.leftEvidenceId).not.toBe(candidate?.rightEvidenceId)

    const parsed = parseWorkspaceDocumentRelationsResult(loopResult({
      relations: [{
        candidateId: candidate!.candidateId,
        leftDocumentId: "single",
        rightDocumentId: "single",
        verdict: "contradictory",
        confidence: "high",
        rationale: "The selected document states two incompatible storage authorities.",
        evidenceIds: [candidate!.leftEvidenceId, candidate!.rightEvidenceId],
        suggestedDocumentId: null,
        suggestedReason: null,
      }],
    }, { evidence: request.initialEvidence }), request)

    expect(parsed.status).toBe("complete")
    expect(parsed.relations).toHaveLength(1)
    expect(parsed.relations[0]).toMatchObject({
      leftDocumentId: "single",
      rightDocumentId: "single",
      evidenceIds: [candidate!.leftEvidenceId, candidate!.rightEvidenceId],
    })
    expect(isResolvableSemanticContradiction(parsed.relations[0]!)).toBe(true)
  })

  it("keeps oversized selected relation sources complete for provider staging", () => {
    const oversized = "# Scope\n\n" + "A complete relation paragraph. ".repeat(3_000)
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", oversized),
      source("right", oversized),
    ])

    expect(request.contextComplete).toBe(true)
    expect(request.contextError).toBeNull()
    expect(request.initialInput.map((item) => item.type === "message" ? item.content : "").join("\n"))
      .toContain("A complete relation paragraph.")
  })

  it("retains a worst-case relation bundle and leaves capacity decisions to the provider", () => {
    const statement = (index: number) => `Claim ${index}: ${"bounded semantic workspace evidence ".repeat(22).trim()}.`
    const markdown = Array.from({ length: 12 }, (_, index) => statement(index + 1)).join("\n")
    const sources = Array.from({ length: 4 }, (_, index) => source(
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      markdown,
      `version-${"v".repeat(240)}`,
      `blake3:${"a".repeat(64)}`,
    ))
    const request = buildWorkspaceDocumentRelationsRequest(sources)
    const messageItems = request.initialInput.filter((item): item is Extract<typeof item, { type: "message" }> => item.type === "message")

    expect(messageItems.length).toBeGreaterThan(1)
    expect(request.contextComplete).toBe(true)
    expect(request.contextError).toBeNull()
    expect(messageItems.reduce((total, item) => total + item.content.length, 0)).toBeGreaterThan(65_536)
    expect(workspaceSemanticRoundRequestSchema.safeParse({
      operation: "relations",
      input: request.initialInput,
      tools: getWorkspaceSemanticToolDescriptors(),
      execution: createWorkspaceExecutionContext("relations", "desktop", "semantic-review"),
    }).success).toBe(true)
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

  it("uses the semantic envelope coverage when the operation payload omits the repeated field", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", "Storage: SQLite."),
      source("right", "Storage: IndexedDB."),
    ])
    const result = parseWorkspaceDocumentRelationsResult(loopResult({
      relations: request.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        leftDocumentId: candidate.leftDocumentId,
        rightDocumentId: candidate.rightDocumentId,
        verdict: "unrelated",
        confidence: "high",
        rationale: "The provider returned a valid operation payload.",
        evidenceIds: [candidate.leftEvidenceId, candidate.rightEvidenceId],
        suggestedDocumentId: null,
        suggestedReason: null,
      })),
    }, { evidence: request.initialEvidence }), request)

    expect(result.status).toBe("complete")
    expect(result.coverage).toBe("complete")
    expect(result.invalidItemCount).toBe(0)
  })

  it("does not require every recall hint to be repeated in a complete review", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", "Storage: SQLite.\nCaching: filesystem."),
      source("right", "Storage: IndexedDB.\nCaching: memory."),
    ])
    const candidate = request.candidates[0]!
    const result = parseWorkspaceDocumentRelationsResult(loopResult({
      relations: [{
        candidateId: candidate.candidateId,
        leftDocumentId: candidate.leftDocumentId,
        rightDocumentId: candidate.rightDocumentId,
        verdict: "complementary",
        confidence: "high",
        rationale: "The complete selected documents contain complementary storage claims.",
        evidenceIds: [candidate.leftEvidenceId, candidate.rightEvidenceId],
        suggestedDocumentId: null,
        suggestedReason: null,
      }],
    }, { evidence: request.initialEvidence }), request)

    expect(result.status).toBe("complete")
    expect(result.coverage).toBe("complete")
    expect(result.invalidItemCount).toBe(0)
    expect(result.relations).toHaveLength(1)
  })

  it("normalizes the semicolon-delimited evidence format returned by Responses", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", "Storage: SQLite."),
      source("right", "Storage: IndexedDB."),
    ])
    const result = parseWorkspaceDocumentRelationsResult(loopResult({
      relations: request.candidates.map((candidate, index) => ({
        candidateId: candidate.candidateId,
        leftDocumentId: candidate.leftDocumentId,
        rightDocumentId: candidate.rightDocumentId,
        verdict: "unrelated",
        confidence: "high",
        rationale: "The provider returned valid evidence provenance.",
        evidenceIds: index === 0
          ? `${candidate.leftEvidenceId};${candidate.rightEvidenceId}`
          : [candidate.leftEvidenceId, candidate.rightEvidenceId],
        suggestedDocumentId: null,
        suggestedReason: null,
      })),
    }, { evidence: request.initialEvidence }), request)

    expect(result.status).toBe("complete")
    expect(result.coverage).toBe("complete")
    expect(result.invalidItemCount).toBe(0)
    expect(result.relations[0]?.evidenceIds).toHaveLength(2)
  })

  it("does not force semantic provenance to reuse the deterministic candidate excerpts", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", "Storage: SQLite.\nCaching: filesystem.\nOwner: platform."),
      source("right", "Storage: IndexedDB.\nCaching: memory.\nOwner: editor."),
    ])
    const candidate = request.candidates[0]!
    const alternateLeft = request.initialEvidence.find(
      (item) => item.documentId === candidate.leftDocumentId && item.evidenceId !== candidate.leftEvidenceId,
    )!
    const alternateRight = request.initialEvidence.find(
      (item) => item.documentId === candidate.rightDocumentId && item.evidenceId !== candidate.rightEvidenceId,
    )!
    const result = parseWorkspaceDocumentRelationsResult(loopResult({
      coverage: "partial",
      relations: [{
        candidateId: candidate.candidateId,
        leftDocumentId: candidate.leftDocumentId,
        rightDocumentId: candidate.rightDocumentId,
        verdict: "contradictory",
        confidence: "high",
        rationale: "The selected excerpts provide valid evidence for the two claims.",
        evidenceIds: [alternateLeft.evidenceId, alternateRight.evidenceId],
        suggestedDocumentId: null,
        suggestedReason: null,
      }],
    }, { evidence: request.initialEvidence }), request)

    expect(result.relations).toHaveLength(1)
    expect(result.relations[0]?.evidenceIds).toEqual([alternateLeft.evidenceId, alternateRight.evidenceId])
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

  it("discards an explicit suggestion that is not one of the relation's two claims", () => {
    const request = buildWorkspaceDocumentRelationsRequest([
      source("left", "Storage: SQLite."),
      source("right", "Storage: IndexedDB."),
      source("other", "The editor uses local files."),
    ])
    const leftEvidence = request.initialEvidence.find((item) => item.documentId === "left")!
    const rightEvidence = request.initialEvidence.find((item) => item.documentId === "right")!
    const parsed = parseWorkspaceDocumentRelationsResult(loopResult({
      coverage: "partial",
      relations: [{
        candidateId: null,
        leftDocumentId: "left",
        rightDocumentId: "right",
        verdict: "contradictory",
        confidence: "high",
        rationale: "The claims conflict, but the suggested third document is not a source for this pair.",
        evidenceIds: [leftEvidence.evidenceId, rightEvidence.evidenceId],
        suggestedDocumentId: "other",
        suggestedReason: "It is newer.",
      }],
    }, { evidence: request.initialEvidence }), request)

    expect(parsed.relations[0]?.suggestedDocumentId).toBeNull()
    expect(parsed.relations[0]?.suggestedReason).toBeNull()
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
