/**
 * @contract ODE-512 — Semantic relation policy and provenance coverage
 * @doc workflow/context/features/agents/odessay-agent-conversation-compaction.md
 * @service AIService.reviewWorkspaceDocumentRelations
 */
import { describe, expect, it } from "vitest"

import {
  buildWorkspaceDocumentRelationsRequest,
  isResolvableSemanticContradiction,
  parseWorkspaceDocumentRelationsResult,
} from "@/lib/ai/workspace-document-relations"
import type { WorkspaceSemanticLoopResult } from "@/lib/ai/workspace-semantic-loop"
import { WORKSPACE_SEMANTIC_RELATION_FIXTURES } from "./workspace-agent-semantic-fixtures"

describe("Workspace Agent semantic policy fixtures (ODE-512)", () => {
  for (const fixture of WORKSPACE_SEMANTIC_RELATION_FIXTURES) {
    it(fixture.id, () => {
      const request = buildWorkspaceDocumentRelationsRequest([
        {
          documentId: `${fixture.id}:left`,
          title: `${fixture.id} left`,
          documentVersion: "left:v1",
          contentHash: `hash:${fixture.id}:left`,
          updatedAt: fixture.left.updatedAt,
          markdown: fixture.left.markdown,
        },
        {
          documentId: `${fixture.id}:right`,
          title: `${fixture.id} right`,
          documentVersion: "right:v1",
          contentHash: `hash:${fixture.id}:right`,
          updatedAt: fixture.right.updatedAt,
          markdown: fixture.right.markdown,
        },
      ])
      const leftEvidence = request.initialEvidence.find((item) =>
        item.documentId.endsWith(":left") && item.text.includes(fixture.left.evidenceNeedle),
      )
      const rightEvidence = request.initialEvidence.find((item) =>
        item.documentId.endsWith(":right") && item.text.includes(fixture.right.evidenceNeedle),
      )
      expect(leftEvidence, "left fixture evidence").toBeDefined()
      expect(rightEvidence, "right fixture evidence").toBeDefined()

      const loop: WorkspaceSemanticLoopResult = {
        operation: "relations",
        status: "complete",
        coverage: "complete",
        rounds: 1,
        toolCalls: [],
        evidence: request.initialEvidence,
        finalText: JSON.stringify({
          coverage: "complete",
          status: "complete",
          payload: JSON.stringify({
            relations: [{
              candidateId: null,
              leftDocumentId: `${fixture.id}:left`,
              rightDocumentId: `${fixture.id}:right`,
              verdict: fixture.expectedVerdict,
              confidence: "high",
              rationale: fixture.rationale,
              evidenceIds: [leftEvidence!.evidenceId, rightEvidence!.evidenceId],
              suggestedDocumentId: null,
              suggestedReason: null,
            }],
          }),
        }),
        error: null,
        executionReceipt: null,
      }
      const parsed = parseWorkspaceDocumentRelationsResult(loop, request)

      expect(parsed).toMatchObject({ status: "complete", coverage: "complete", invalidItemCount: 0 })
      expect(parsed.relations).toHaveLength(1)
      expect(parsed.relations[0]).toMatchObject({
        verdict: fixture.expectedVerdict,
        suggestedDocumentId: null,
        suggestedReason: null,
      })
      const citedDocumentIds = parsed.relations[0]!.evidenceIds.map((evidenceId) =>
        request.initialEvidence.find((item) => item.evidenceId === evidenceId)?.documentId,
      )
      expect(new Set(citedDocumentIds)).toEqual(new Set([
        `${fixture.id}:left`,
        `${fixture.id}:right`,
      ]))
      expect(isResolvableSemanticContradiction(parsed.relations[0]!)).toBe(fixture.expectedActionable)
    })
  }
})
