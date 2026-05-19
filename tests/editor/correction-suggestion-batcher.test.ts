import { describe, expect, it, vi } from "vitest"
import type { PublicationSuggestion } from "@/lib/local-db/schema"
import { createCorrectionSuggestionBatcher } from "@/lib/editor/correction-suggestion-batcher"

const createSuggestion = (id: string): PublicationSuggestion => ({
  id,
  kind: "spelling",
  title: "Fix spelling",
  reason: "",
  original_text: "prueva",
  replacement_text: "prueba",
  status: "pending",
})

describe("createCorrectionSuggestionBatcher", () => {
  it("coalesces a burst of suggestion updates into one commit", () => {
    vi.useFakeTimers()

    let state: PublicationSuggestion[] = []
    const commit = vi.fn((updater: (current: PublicationSuggestion[]) => PublicationSuggestion[]) => {
      state = updater(state)
    })

    const batcher = createCorrectionSuggestionBatcher(commit, 50)

    batcher.enqueue(() => [createSuggestion("suggestion-1")])
    batcher.enqueue((current) => [...current, createSuggestion("suggestion-2")])
    batcher.enqueue((current) => [...current, createSuggestion("suggestion-3")])

    expect(commit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(state.map((suggestion) => suggestion.id)).toEqual([
      "suggestion-1",
      "suggestion-2",
      "suggestion-3",
    ])

    vi.useRealTimers()
  })
})
