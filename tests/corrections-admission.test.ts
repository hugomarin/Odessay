import { describe, expect, it } from "vitest"

import { admitSuggestions, type AdmissionContext } from "@/lib/corrections/engine/admission"
import { createStableFingerprint } from "@/lib/corrections/engine/identity"
import { createLearnedWordSet } from "@/lib/corrections/learned-words"
import type { PublicationSuggestion } from "@/lib/local-db/schema"

const makeSuggestion = (
  override: Partial<PublicationSuggestion> = {},
): PublicationSuggestion => ({
  id: "suggestion-1",
  kind: "spelling",
  mechanical_type: "spelling",
  title: "Spelling",
  reason: "Typo",
  original_text: "Prueva",
  replacement_text: "Prueba",
  block_id: "block-1",
  source_hash: "hash-1",
  correction_fingerprint: createStableFingerprint({
    type: "spelling",
    originalText: "Prueva",
    replacementText: "Prueba",
  }),
  status: "pending",
  ...override,
})

const makeContext = (override: Partial<AdmissionContext> = {}): AdmissionContext => ({
  learnedWords: createLearnedWordSet([]),
  rejectedFingerprints: new Set(),
  blockText: () => "Esta Prueva debe corregirse.",
  ...override,
})

describe("corrections admission", () => {
  it("filters learned words before a cached suggestion becomes visible", () => {
    const admitted = admitSuggestions([makeSuggestion()], makeContext({
      learnedWords: createLearnedWordSet(["pruéva"]),
    }))

    expect(admitted).toEqual([])
  })

  it("re-admits visible suggestions when learned words arrive later", () => {
    const visible = admitSuggestions([makeSuggestion()], makeContext())

    expect(visible).toHaveLength(1)

    const readmitted = admitSuggestions(visible, makeContext({
      learnedWords: createLearnedWordSet(["prueva"]),
    }))

    expect(readmitted).toEqual([])
  })

  it("filters rejected correction fingerprints", () => {
    const fingerprint = createStableFingerprint({
      type: "spelling",
      originalText: "Prueva",
      replacementText: "Prueba",
    })

    const admitted = admitSuggestions([makeSuggestion()], makeContext({
      rejectedFingerprints: new Set([fingerprint]),
    }))

    expect(admitted).toEqual([])
  })

  it("validates token boundaries against the live block text", () => {
    const admitted = admitSuggestions([
      makeSuggestion({
        original_text: "como",
        replacement_text: "cómo",
        correction_fingerprint: createStableFingerprint({
          type: "spelling",
          originalText: "como",
          replacementText: "cómo",
        }),
      }),
    ], makeContext({
      blockText: () => "La comodidad importa.",
    }))

    expect(admitted).toEqual([])
  })

  it("deduplicates equivalent suggestions after filters run", () => {
    const first = makeSuggestion()
    const duplicate = makeSuggestion({ id: "suggestion-2" })

    expect(admitSuggestions([first, duplicate], makeContext())).toEqual([first])
  })

  it("drops malformed cached items without throwing", () => {
    const malformed = makeSuggestion({ id: "", original_text: "" })

    expect(() => admitSuggestions([malformed], makeContext())).not.toThrow()
    expect(admitSuggestions([malformed], makeContext())).toEqual([])
  })
})
