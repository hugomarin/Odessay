import { describe, expect, it } from "vitest"
import { calculateTextMetrics } from "@/lib/editor/text-metrics"

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
    const text = "Hello world. This is Odessay!"

    expect(calculateTextMetrics(text)).toEqual({
      words: 5,
      characters: text.length,
      sentences: 2,
      readingTimeMinutes: 1,
      pages: 0,
    })
  })
})
