import { describe, expect, it } from "vitest"
import {
  applyPublicationSuggestionGroup,
  updateSuggestionStatuses,
} from "@/lib/editor/suggestion-engine"
import type { PublicationSuggestion } from "@/lib/local-db/schema"

/**
 * @contract ODE-436 — reactive fan-out
 * "Applying N suggestions must produce one update, not N."
 *
 * This guards the pure layer the editor calls: one pass over the source and one
 * new suggestion array, whatever N is. It does not measure React renders — the
 * shell consumes these results in a single state write, and the render cost is
 * covered by the interaction-latency trace in the PR.
 */

const suggestion = (id: string, original: string, replacement: string): PublicationSuggestion =>
  ({
    id,
    kind: "spelling",
    status: "pending",
    reason: "",
    original_text: original,
    replacement_text: replacement,
  }) as PublicationSuggestion

describe("applying suggestions in bulk", () => {
  const source = "uno dos tres cuatro cinco seis"
  const group = [
    suggestion("a", "uno", "1"),
    suggestion("b", "tres", "3"),
    suggestion("c", "cinco", "5"),
  ]

  it("rewrites the source once, with every match applied", () => {
    const result = applyPublicationSuggestionGroup(source, group)

    expect(result.markdown).toBe("1 dos 3 cuatro 5 seis")
    expect(result.appliedIds).toHaveLength(3)
  })

  it("returns a single new array when N statuses change", () => {
    const suggestions = [...group, suggestion("d", "seis", "6")]
    const ids = ["a", "b", "c"]

    const next = updateSuggestionStatuses(suggestions, ids, "accepted")

    expect(next).not.toBe(suggestions)
    expect(next.filter((item) => item.status === "accepted")).toHaveLength(3)
    // The untouched suggestion keeps its identity: no needless invalidation.
    expect(next[3]).toBe(suggestions[3])
  })

  it("scales the same way for a large group", () => {
    const words = Array.from({ length: 30 }, (_, index) => `w${index}`)
    const largeSource = words.join(" ")
    const largeGroup = words.map((word, index) => suggestion(`s${index}`, word, `x${index}`))

    const result = applyPublicationSuggestionGroup(largeSource, largeGroup)

    expect(result.appliedIds).toHaveLength(30)
    expect(result.markdown).toBe(words.map((_, index) => `x${index}`).join(" "))
  })
})
