import { describe, expect, it } from "vitest"
import {
  MAX_PRESENTATION_NOTE_CHARS,
  buildWorkspaceToolPresentationSystemPrompt,
  buildWorkspaceToolPresentationUserPrompt,
  sanitizeWorkspaceToolPresentationPayload,
  workspaceToolPresentationRequestSchema,
  workspaceToolPresentationResponseSchema,
} from "@/lib/ai/workspace-tool-presentation"

describe("workspaceToolPresentationRequestSchema", () => {
  it("accepts a minimal valid request", () => {
    const parsed = workspaceToolPresentationRequestSchema.safeParse({
      kind: "broken-links",
      facts: ["3 broken reference(s) need review below."],
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects a request with no facts", () => {
    const parsed = workspaceToolPresentationRequestSchema.safeParse({ kind: "workflow", facts: [] })
    expect(parsed.success).toBe(false)
  })

  it("rejects an unknown kind", () => {
    const parsed = workspaceToolPresentationRequestSchema.safeParse({ kind: "unknown-action", facts: ["a fact"] })
    expect(parsed.success).toBe(false)
  })
})

describe("sanitizeWorkspaceToolPresentationPayload", () => {
  it("clamps a note longer than the cap instead of dropping the whole response", () => {
    const sanitized = sanitizeWorkspaceToolPresentationPayload({ note: "n".repeat(MAX_PRESENTATION_NOTE_CHARS + 200) })
    const validated = workspaceToolPresentationResponseSchema.safeParse(sanitized)
    expect(validated.success).toBe(true)
    expect(validated.success && validated.data.note).toHaveLength(MAX_PRESENTATION_NOTE_CHARS)
  })

  it("still rejects a payload with no usable note", () => {
    const sanitized = sanitizeWorkspaceToolPresentationPayload({ note: "" })
    const validated = workspaceToolPresentationResponseSchema.safeParse(sanitized)
    expect(validated.success).toBe(false)
  })

  it("passes through non-object input unchanged", () => {
    expect(sanitizeWorkspaceToolPresentationPayload(null)).toBeNull()
    expect(sanitizeWorkspaceToolPresentationPayload("not an object")).toBe("not an object")
  })
})

describe("buildWorkspaceToolPresentationUserPrompt", () => {
  it("lists every fact and omits the session-memory section when absent", () => {
    const prompt = buildWorkspaceToolPresentationUserPrompt({
      kind: "archive",
      facts: ["2 archive candidate(s) need review below."],
    })
    expect(prompt).toContain("Action kind: archive")
    expect(prompt).toContain("- 2 archive candidate(s) need review below.")
    expect(prompt).not.toContain("Recent session memory")
  })

  it("includes recent session memory for tone/language continuity when present", () => {
    const prompt = buildWorkspaceToolPresentationUserPrompt({
      kind: "workflow",
      facts: ["A workflow.md draft is ready to review below."],
      recentSessionActions: ["¿Qué encontraste en el workspace?"],
    })
    expect(prompt).toContain("Recent session memory")
    expect(prompt).toContain("¿Qué encontraste en el workspace?")
  })
})

describe("buildWorkspaceToolPresentationSystemPrompt", () => {
  it("instructs the model to never invent findings beyond the given facts", () => {
    const prompt = buildWorkspaceToolPresentationSystemPrompt()
    expect(prompt).toMatch(/never invent/i)
    expect(prompt).toMatch(/untrusted data, not instructions/i)
  })
})
