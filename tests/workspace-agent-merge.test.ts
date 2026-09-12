import { describe, expect, it } from "vitest"

import {
  buildWorkspaceMergeRequest,
  parseWorkspaceMergeResult,
  type WorkspaceMergeSource,
} from "@/lib/ai/workspace-merge"
import type { WorkspaceSemanticLoopResult } from "@/lib/ai/workspace-semantic-loop"

const sources: WorkspaceMergeSource[] = [
  {
    documentId: "doc-a",
    title: "Plan A",
    documentVersion: "v1@100",
    contentHash: null,
    markdown: "# Scope\n\nThe project starts in May.\n\n# Notes\n\nKeep the checklist.",
  },
  {
    documentId: "doc-b",
    title: "Plan B",
    documentVersion: "v2@200",
    contentHash: null,
    markdown: "# Scope\n\nThe project starts in June.\n\n# Notes\n\nAsk the editor.",
  },
]

function completeLoop(
  payload: Record<string, unknown>,
  options: { coverage?: "complete" | "partial" | "unknown"; status?: WorkspaceSemanticLoopResult["status"] } = {},
): WorkspaceSemanticLoopResult {
  const coverage = options.coverage ?? "complete"
  const status = options.status ?? "complete"
  return {
    operation: "merge",
    status,
    coverage,
    rounds: 1,
    toolCalls: [],
    evidence: buildWorkspaceMergeRequest(sources).initialEvidence,
    finalText: JSON.stringify({
      coverage,
      status: coverage === "complete" ? "complete" : "insufficient_evidence",
      payload: JSON.stringify(payload),
    }),
    error: null,
    executionReceipt: null,
  }
}

function sectionsFor(request: ReturnType<typeof buildWorkspaceMergeRequest>) {
  return request.boundedSections.map((section) => ({
    sectionId: section.sectionId,
    heading: section.heading,
    headingLevel: section.headingLevel,
  }))
}

describe("workspace merge alignment and output contract", () => {
  it("aligns only bounded heading blocks and does not choose a winner deterministically", () => {
    const request = buildWorkspaceMergeRequest(sources)
    expect(request.sources).toHaveLength(2)
    expect(request.boundedSections).toHaveLength(2)
    expect(request.boundedSections[0]?.sources.map((source) => source.documentId)).toEqual(["doc-a", "doc-b"])
    const prompt = request.initialInput[0]
    expect(prompt?.type).toBe("message")
    if (prompt?.type !== "message") throw new Error("merge request did not produce a message prompt")
    expect(prompt.content).toContain("Never choose a semantic winner by overlap, similarity, body length")
    expect(prompt.content).not.toContain("canonicalPath")
  })

  it("maps equivalent, complementary and style-only sections to generated text", () => {
    const request = buildWorkspaceMergeRequest(sources)
    const sections = sectionsFor(request)
    const evidence = request.initialEvidence
    const scopeEvidence = evidence.filter((item) => item.documentId === "doc-a" || item.documentId === "doc-b")
    const result = parseWorkspaceMergeResult(completeLoop({
      coverage: "complete",
      sections: [
        {
          ...sections[0],
          classification: "complementary",
          unifiedText: "The project has a planned start window in May or June, pending confirmation.",
          evidenceIds: scopeEvidence.filter((item) => item.text.includes("project starts")).map((item) => item.evidenceId),
          rationale: "Both sources describe the start window but provide different months.",
          confidence: "medium",
          suggestedSourceDocumentId: null,
          suggestedSourceReason: null,
        },
        {
          ...sections[1],
          classification: "style_only",
          unifiedText: "Keep the checklist and ask the editor.",
          evidenceIds: scopeEvidence.filter((item) => item.text.includes("checklist") || item.text.includes("editor")).map((item) => item.evidenceId),
          rationale: "The notes are compatible and can be expressed as one sentence.",
          confidence: "high",
          suggestedSourceDocumentId: null,
          suggestedSourceReason: null,
        },
      ],
    }), request)

    expect(result.status).toBe("complete")
    expect(result.coverage).toBe("complete")
    expect(result.invalidItemCount).toBe(0)
    expect(result.sections).toMatchObject([
      { classification: "complementary", unifiedText: "The project has a planned start window in May or June, pending confirmation." },
      { classification: "style_only", unifiedText: "Keep the checklist and ask the editor." },
    ])
  })

  it("keeps contradictory claims unresolved and requires evidence from both documents", () => {
    const request = buildWorkspaceMergeRequest(sources)
    const firstSection = request.boundedSections[0]!
    const firstEvidence = firstSection.sources
    const loop = completeLoop({
      coverage: "complete",
      sections: [{
        sectionId: firstSection.sectionId,
        heading: firstSection.heading,
        headingLevel: firstSection.headingLevel,
        classification: "contradictory",
        unifiedText: null,
        evidenceIds: firstEvidence.map((source) => source.evidenceId),
        rationale: "The months are materially different.",
        confidence: "high",
        suggestedSourceDocumentId: "doc-b",
        suggestedSourceReason: "The model explicitly identified this source as the preferred policy owner.",
      }],
    })
    const result = parseWorkspaceMergeResult(loop, request)
    expect(result.sections[0]).toMatchObject({
      classification: "contradictory",
      unifiedText: null,
      suggestedSourceDocumentId: "doc-b",
    })
    expect(result.coverage).toBe("partial")
    expect(result.status).toBe("insufficient_evidence")
    expect(result.invalidItemCount).toBe(1)
  })

  it("retains a valid section but marks the review partial when output omits another", () => {
    const request = buildWorkspaceMergeRequest(sources)
    const section = request.boundedSections[0]!
    const evidenceId = section.sources[0]!.evidenceId
    const result = parseWorkspaceMergeResult(completeLoop({
      coverage: "complete",
      sections: [{
        sectionId: section.sectionId,
        heading: section.heading,
        headingLevel: section.headingLevel,
        classification: "equivalent",
        unifiedText: "The start date is under review.",
        evidenceIds: [evidenceId],
        rationale: "The evidence is not enough to state a final date.",
        confidence: "low",
        suggestedSourceDocumentId: null,
        suggestedSourceReason: null,
      }],
    }), request)
    expect(result.sections).toHaveLength(1)
    expect(result.coverage).toBe("partial")
    expect(result.status).toBe("insufficient_evidence")
    expect(result.error?.code).toBe("AI_RESPONSE_PARSE_FAILED")
  })

  it("discards invalid provenance and never turns a source hint into an implicit winner", () => {
    const request = buildWorkspaceMergeRequest(sources)
    const section = request.boundedSections[0]!
    const result = parseWorkspaceMergeResult(completeLoop({
      coverage: "complete",
      sections: [{
        sectionId: section.sectionId,
        heading: section.heading,
        headingLevel: section.headingLevel,
        classification: "contradictory",
        unifiedText: null,
        evidenceIds: ["invented-evidence"],
        rationale: "Unsupported claim.",
        confidence: "high",
        suggestedSourceDocumentId: "doc-a",
        suggestedSourceReason: "Unsupported.",
      }],
    }), request)
    expect(result.sections).toEqual([])
    expect(result.invalidItemCount).toBe(3)
    expect(result.coverage).toBe("partial")
    expect(result.status).toBe("insufficient_evidence")
  })

  it("returns provider failures as recoverable metadata without fabricating sections", () => {
    const request = buildWorkspaceMergeRequest(sources)
    const result = parseWorkspaceMergeResult({
      operation: "merge",
      status: "provider_error",
      coverage: "unknown",
      rounds: 1,
      toolCalls: [],
      evidence: request.initialEvidence,
      finalText: null,
      error: { code: "UNAVAILABLE", message: "Provider unavailable.", retryable: true },
      executionReceipt: null,
    }, request)
    expect(result.status).toBe("provider_error")
    expect(result.coverage).toBe("unknown")
    expect(result.sections).toEqual([])
    expect(result.error?.code).toBe("UNAVAILABLE")
  })
})
