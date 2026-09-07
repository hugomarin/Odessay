import { describe, expect, it } from "vitest"
import {
  MAX_WORKSPACE_ASK_ADDITIONAL_REQUESTS,
  MAX_WORKSPACE_ASK_ANSWER_CHARS,
  MAX_WORKSPACE_ASK_EVIDENCE_ITEMS,
  MAX_WORKSPACE_ASK_QUOTE_CHARS,
  WORKSPACE_ASK_SUGGESTED_ACTIONS,
  sanitizeWorkspaceAskPayload,
  workspaceAskRequestSchema,
  workspaceAskResponseSchema,
} from "@/lib/ai/workspace-ask"

describe("workspaceAskRequestSchema (ODE-489's documented Context Gap — a conversational question grounds in zero documents)", () => {
  it("accepts an empty targetDocumentIds/documents pair instead of requiring at least one", () => {
    const result = workspaceAskRequestSchema.safeParse({
      question: "Hola",
      targetDocumentIds: [],
      documents: [],
      collections: [],
      documentCollectionIds: {},
      annotations: [],
      workflowMarkdown: null,
      catalogTruncated: false,
    })
    expect(result.success).toBe(true)
  })
})

describe("workspaceAskResponseSchema.suggestedAction (ODE-489/491 follow-up — free text can now dispatch to a predetermined action)", () => {
  const base = { answer: "ok", evidence: [], requestedDocumentIds: [] }

  it("accepts null (the default — a plain conversational answer)", () => {
    const result = workspaceAskResponseSchema.safeParse({ ...base, suggestedAction: null })
    expect(result.success).toBe(true)
  })

  it.each(WORKSPACE_ASK_SUGGESTED_ACTIONS)("accepts %s as a valid suggested action", (action) => {
    const result = workspaceAskResponseSchema.safeParse({ ...base, suggestedAction: action })
    expect(result.success).toBe(true)
  })

  it("rejects an unrecognized action name", () => {
    const result = workspaceAskResponseSchema.safeParse({ ...base, suggestedAction: "merge" })
    expect(result.success).toBe(false)
  })
})

describe("sanitizeWorkspaceAskPayload — suggestedAction", () => {
  it("passes through a recognized action", () => {
    const sanitized = sanitizeWorkspaceAskPayload({
      answer: "ok",
      evidence: [],
      requestedDocumentIds: [],
      suggestedAction: "classification",
    }) as Record<string, unknown>
    expect(sanitized.suggestedAction).toBe("classification")
  })

  it("downgrades a hallucinated or unrecognized action to null instead of failing the whole response", () => {
    const sanitized = sanitizeWorkspaceAskPayload({
      answer: "ok",
      evidence: [],
      requestedDocumentIds: [],
      suggestedAction: "delete-everything",
    }) as Record<string, unknown>
    expect(sanitized.suggestedAction).toBeNull()
  })

  it("defaults a missing suggestedAction to null", () => {
    const sanitized = sanitizeWorkspaceAskPayload({
      answer: "ok",
      evidence: [],
      requestedDocumentIds: [],
    }) as Record<string, unknown>
    expect(sanitized.suggestedAction).toBeNull()
  })
})

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
