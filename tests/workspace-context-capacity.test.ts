import { describe, expect, it } from "vitest"
import {
  availableWorkspaceInputTokens,
  estimateWorkspaceInputTokens,
  planWorkspaceSemanticBatches,
  planWorkspaceTextBatches,
  recommendedDocumentTokenBudget,
} from "@/lib/ai/workspace-context-capacity"

describe("Workspace provider context capacity", () => {
  it("does not guess a window or drop content when deployment capacity is unknown", () => {
    const input = [
      { type: "message" as const, role: "user" as const, content: "A".repeat(20_000) },
    ]
    const plan = planWorkspaceSemanticBatches(input, {
      contextWindowTokens: null,
      reservedOutputTokens: 1_000,
    })

    expect(availableWorkspaceInputTokens({ contextWindowTokens: null, reservedOutputTokens: 1_000 })).toBeNull()
    expect(plan.staged).toBe(false)
    expect(plan.batches).toEqual([input])
    expect(estimateWorkspaceInputTokens(plan.batches.flat())).toBeGreaterThan(0)
  })

  it("stages ordered semantic items without truncating any item", () => {
    const input = [
      { type: "message" as const, role: "user" as const, content: "one".repeat(40) },
      { type: "message" as const, role: "user" as const, content: "two".repeat(40) },
      { type: "message" as const, role: "user" as const, content: "three".repeat(40) },
    ]
    const plan = planWorkspaceSemanticBatches(input, {
      contextWindowTokens: 80,
      reservedOutputTokens: 20,
    })

    expect(plan.staged).toBe(true)
    expect(plan.batches.flat()).toEqual(input)
    expect(plan.batches.every((batch) => batch.length > 0)).toBe(true)
  })

  it("splits an oversized source message losslessly before staging", () => {
    const content = "source markdown ".repeat(200)
    const input = [{ type: "message" as const, role: "user" as const, content }]
    const plan = planWorkspaceSemanticBatches(input, {
      contextWindowTokens: 40,
      reservedOutputTokens: 10,
    })

    expect(plan.staged).toBe(true)
    expect(plan.batches.flat().map((item) => item.type === "message" ? item.content : item.output).join(""))
      .toBe(content)
    expect(plan.batches.flat().every((item) => item.type === "message" && estimateWorkspaceInputTokens([item]) <= 30)).toBe(true)
  })

  it("splits direct prompts losslessly and recommends a per-document budget", () => {
    const prompt = "document evidence ".repeat(100)
    const plan = planWorkspaceTextBatches(prompt, {
      contextWindowTokens: 120,
      reservedOutputTokens: 20,
      overheadTokens: 10,
    })

    expect(plan.staged).toBe(true)
    expect(plan.batches.join("")).toBe(prompt)
    expect(recommendedDocumentTokenBudget({
      contextWindowTokens: 1_000,
      reservedOutputTokens: 200,
      overheadTokens: 100,
    }, 7)).toBe(100)
  })
})
