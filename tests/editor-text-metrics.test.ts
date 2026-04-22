import { describe, expect, it } from "vitest"
import { calculateSelectionMetrics } from "@/lib/editor/text-metrics"

describe("editor selection metrics", () => {
  it("matches document metric definitions for words", () => {
    const text = "The quick brown fox jumps. Over the lazy dog!"
    const docMetrics = calculateSelectionMetrics(text)

    expect(docMetrics.words).toBe(9)
    expect(docMetrics.characters).toBe(text.length)
  })

  it("is consistent with empty string handling between full and selection metrics", () => {
    const emptySelection = calculateSelectionMetrics("")
    expect(emptySelection.words).toBe(0)
    expect(emptySelection.characters).toBe(0)
  })

  it("preserves whitespace in character count", () => {
    const text = "  leading and trailing  "
    const metrics = calculateSelectionMetrics(text)
    expect(metrics.characters).toBe(text.length)
    expect(metrics.words).toBe(3)
  })
})
