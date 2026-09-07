import { describe, expect, it } from "vitest"
import {
  MAX_WORKSPACE_ASK_ADDITIONAL_REQUESTS,
  MAX_WORKSPACE_ASK_ANSWER_CHARS,
  MAX_WORKSPACE_ASK_EVIDENCE_ITEMS,
  MAX_WORKSPACE_ASK_QUOTE_CHARS,
  sanitizeWorkspaceAskPayload,
  workspaceAskResponseSchema,
} from "@/lib/ai/workspace-ask"

describe("sanitizeWorkspaceAskPayload", () => {
  it("clamps an answer longer than the cap instead of dropping the whole response", () => {
    const payload = {
      answer: "a".repeat(MAX_WORKSPACE_ASK_ANSWER_CHARS + 500),
      evidence: [],
      requestedDocumentIds: [],
    }
    const sanitized = sanitizeWorkspaceAskPayload(payload)
    const validated = workspaceAskResponseSchema.safeParse(sanitized)
    expect(validated.success).toBe(true)
    expect((sanitized as { answer: string }).answer).toHaveLength(MAX_WORKSPACE_ASK_ANSWER_CHARS)
  })

  it("drops evidence past the cap instead of rejecting the answer", () => {
    const evidence = Array.from({ length: MAX_WORKSPACE_ASK_EVIDENCE_ITEMS + 3 }, (_, index) => ({
      documentId: `doc-${index}`,
      quote: `quote ${index}`,
      reason: `reason ${index}`,
    }))
    const payload = { answer: "Here is the answer.", evidence, requestedDocumentIds: [] }
    const sanitized = sanitizeWorkspaceAskPayload(payload)
    const validated = workspaceAskResponseSchema.safeParse(sanitized)
    expect(validated.success).toBe(true)
    expect(validated.success && validated.data.evidence).toHaveLength(MAX_WORKSPACE_ASK_EVIDENCE_ITEMS)
  })

  it("drops an evidence item with an empty field instead of rejecting the answer", () => {
    const payload = {
      answer: "Here is the answer.",
      evidence: [
        { documentId: "doc-1", quote: "", reason: "no quote available" },
        { documentId: "doc-2", quote: "a real quote", reason: "a real reason" },
      ],
      requestedDocumentIds: [],
    }
    const sanitized = sanitizeWorkspaceAskPayload(payload)
    const validated = workspaceAskResponseSchema.safeParse(sanitized)
    expect(validated.success).toBe(true)
    expect(validated.success && validated.data.evidence).toEqual([
      { documentId: "doc-2", quote: "a real quote", reason: "a real reason" },
    ])
  })

  it("truncates an over-long quote instead of rejecting the answer", () => {
    const payload = {
      answer: "Here is the answer.",
      evidence: [{ documentId: "doc-1", quote: "q".repeat(MAX_WORKSPACE_ASK_QUOTE_CHARS + 100), reason: "reason" }],
      requestedDocumentIds: [],
    }
    const sanitized = sanitizeWorkspaceAskPayload(payload)
    const validated = workspaceAskResponseSchema.safeParse(sanitized)
    expect(validated.success).toBe(true)
  })

  it("dedupes and clamps requestedDocumentIds past the cap", () => {
    const ids = Array.from({ length: MAX_WORKSPACE_ASK_ADDITIONAL_REQUESTS + 4 }, (_, index) => `doc-${index % 3}`)
    const payload = { answer: "Here is the answer.", evidence: [], requestedDocumentIds: ids }
    const sanitized = sanitizeWorkspaceAskPayload(payload)
    const validated = workspaceAskResponseSchema.safeParse(sanitized)
    expect(validated.success).toBe(true)
    expect(validated.success && validated.data.requestedDocumentIds.length).toBeLessThanOrEqual(MAX_WORKSPACE_ASK_ADDITIONAL_REQUESTS)
  })

  it("still rejects a payload with no usable answer", () => {
    const payload = { answer: "", evidence: [], requestedDocumentIds: [] }
    const sanitized = sanitizeWorkspaceAskPayload(payload)
    const validated = workspaceAskResponseSchema.safeParse(sanitized)
    expect(validated.success).toBe(false)
  })

  it("passes through non-object input unchanged", () => {
    expect(sanitizeWorkspaceAskPayload(null)).toBeNull()
    expect(sanitizeWorkspaceAskPayload("not an object")).toBe("not an object")
  })
})
