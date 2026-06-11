import { describe, expect, it } from "vitest"
import { calculateTextMetrics, calculateSelectionMetrics } from "@/lib/editor/text-metrics"

describe("text metrics", () => {
  it("returns zeros for empty text", () => {
    expect(calculateTextMetrics("   ")).toEqual({
      words: 0,
      characters: 0,
      sentences: 0,
      readingTimeMinutes: 0,
      pages: 0,
    })
  })

  it("calculates words, characters, sentences, reading time and pages", () => {
    const text = "Hello world. This is Artifact Studio!"

    expect(calculateTextMetrics(text)).toEqual({
      words: 5,
      characters: text.length,
      sentences: 2,
      readingTimeMinutes: 1,
      pages: 0,
    })
  })
})

describe("calculateSelectionMetrics", () => {
  it("returns zeros for empty selection", () => {
    expect(calculateSelectionMetrics("")).toEqual({ words: 0, characters: 0 })
    expect(calculateSelectionMetrics("   ")).toEqual({ words: 0, characters: 0 })
  })

  it("calculates words and characters for a selection", () => {
    const text = "Hello world"
    expect(calculateSelectionMetrics(text)).toEqual({
      words: 2,
      characters: text.length,
    })
  })

  it("counts characters including spaces and punctuation", () => {
    const text = "Hello, world!"
    expect(calculateSelectionMetrics(text)).toEqual({
      words: 2,
      characters: text.length,
    })
  })

  it("handles multi-word selections with irregular spacing", () => {
    const text = "One  two   three"
    expect(calculateSelectionMetrics(text)).toEqual({
      words: 3,
      characters: text.length,
    })
  })
})
