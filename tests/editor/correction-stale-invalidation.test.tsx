/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from "vitest"
import {
  getVisibleCorrectionSuggestions,
  invalidateBlockSuggestions,
  isSuggestionAcceptDisabled,
  replaceBlockSuggestions,
} from "@/lib/editor/suggestion-engine"
import type { PublicationSuggestion } from "@/lib/local-db/schema"

const createSuggestion = (overrides: Partial<PublicationSuggestion> = {}): PublicationSuggestion => ({
  id: "suggestion-1",
  kind: "spelling",
  title: "Spelling",
  reason: "Typo",
  original_text: "prueva",
  replacement_text: "prueba",
  context_before: null,
  context_after: null,
  occurrence: 0,
  block_id: "block-1",
  source_hash: "hash-1",
  correction_fingerprint: "block-1|spelling|prueva|prueba",
  status: "pending",
  ...overrides,
})

describe("stale correction invalidation", () => {
  it("keeps matching block suggestions as pending-stale and disables accept actions", () => {
    const kept = createSuggestion()
    const invalidation = invalidateBlockSuggestions([kept], {
      id: "block-1",
      text: "Esta prueva sigue en el bloque editado con más contexto alrededor.",
    })

    expect(invalidation.keptIds).toEqual([kept.id])
    expect(invalidation.droppedIds).toEqual([])
    expect(invalidation.suggestions[0]?.status).toBe("pending-stale")
    expect(isSuggestionAcceptDisabled(invalidation.suggestions[0]!)).toBe(true)
  })

  it("drops suggestions whose original text no longer exists in the edited block", () => {
    const dropped = createSuggestion()
    const invalidation = invalidateBlockSuggestions([dropped], {
      id: "block-1",
      text: "Esta correccion ya no contiene el texto original.",
    })

    expect(invalidation.keptIds).toEqual([])
    expect(invalidation.droppedIds).toEqual([dropped.id])
    expect(invalidation.suggestions).toEqual([])
  })

  it("drops punctuation suggestions when the edited block already contains the replacement", () => {
    const redundant = createSuggestion({
      id: "punctuation-1",
      kind: "punctuation",
      original_text: "Con Opus está más difícil",
      replacement_text: "Con Opus está más difícil.",
    })

    const invalidation = invalidateBlockSuggestions([redundant], {
      id: "block-1",
      text: "Con Opus está más difícil. Pero ahí seguramente aparece la oportunidad.",
    })

    expect(invalidation.keptIds).toEqual([])
    expect(invalidation.droppedIds).toEqual([redundant.id])
    expect(invalidation.suggestions).toEqual([])
  })

  it("replaces stale suggestions when a new model response arrives", () => {
    const stale = createSuggestion({ id: "stale-1", status: "pending-stale" })
    const otherBlock = createSuggestion({ id: "other-block", block_id: "block-2" })
    const fresh = createSuggestion({
      id: "fresh-1",
      original_text: "otrra",
      replacement_text: "otra",
      source_hash: "hash-2",
    })

    const replacement = replaceBlockSuggestions([stale, otherBlock], "block-1", [fresh])

    expect(replacement.replacedIds).toEqual([stale.id])
    expect(replacement.suggestions).toEqual([otherBlock, fresh])
    expect(replacement.suggestions.find((suggestion) => suggestion.id === fresh.id)?.status).toBe("pending")
  })

  it("keeps stale suggestions visible in panel order but marks them as non-actionable", () => {
    const stale = createSuggestion({ id: "stale-1", status: "pending-stale" })
    const pending = createSuggestion({
      id: "pending-1",
      original_text: "otrra",
      replacement_text: "otra",
      occurrence: 1,
      status: "pending",
    })

    const visibleSuggestions = getVisibleCorrectionSuggestions(
      [pending, stale],
      "Esta prueva sigue en el bloque editado. Luego aparece otrra. Finalmente otra otrra.",
    )

    const actionableSuggestions = visibleSuggestions.filter((suggestion) => !isSuggestionAcceptDisabled(suggestion))

    expect(visibleSuggestions.map((suggestion) => suggestion.id)).toEqual(["stale-1", "pending-1"])
    expect(actionableSuggestions.map((suggestion) => suggestion.id)).toEqual(["pending-1"])
    expect(isSuggestionAcceptDisabled(stale)).toBe(true)
  })

  it("keeps grammar and punctuation suggestions visible in document order", () => {
    const punctuation = createSuggestion({
      id: "punctuation-1",
      kind: "punctuation",
      original_text: "hola mundo",
      replacement_text: "hola, mundo",
      occurrence: 0,
    })
    const grammar = createSuggestion({
      id: "grammar-1",
      kind: "grammar",
      original_text: "fuimos",
      replacement_text: "íbamos",
      occurrence: 0,
    })

    const visibleSuggestions = getVisibleCorrectionSuggestions(
      [grammar, punctuation],
      "Primero hola mundo. Después fuimos al mercado.",
    )

    expect(visibleSuggestions.map((suggestion) => suggestion.id)).toEqual(["punctuation-1", "grammar-1"])
  })
})
