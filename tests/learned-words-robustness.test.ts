import { describe, expect, it, vi } from "vitest"

import {
  loadLearnedWordsPages,
  mergeLearnedWordEntries,
} from "@/lib/corrections/learned-words-loader"
import { buildLearnWordRollbackState } from "@/lib/corrections/learned-words-rollback"
import { createStableFingerprint } from "@/lib/corrections/engine/identity"
import { createLearnedWordSet } from "@/lib/corrections/learned-words"
import type { PublicationSuggestion } from "@/lib/local-db/schema"
import type {
  LearnedWordEntry,
  LearnedWordsPage,
} from "@/lib/services/contracts/ai-service"

const makeEntry = (word: string, id = word): LearnedWordEntry => ({
  id,
  word,
  language: "unknown",
  createdAt: "2026-07-07T00:00:00.000Z",
})

const makePage = (items: LearnedWordEntry[], nextCursor: string | null): LearnedWordsPage => ({
  items,
  nextCursor,
})

const makeSuggestion = (override: Partial<PublicationSuggestion> = {}): PublicationSuggestion => ({
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
  status: "rejected",
  ...override,
})

describe("learned words robustness", () => {
  it("rolls back a failed optimistic learn-word mutation", () => {
    const rollback = buildLearnWordRollbackState({
      learnedWords: [makeEntry("prueva", "pending:prueva")],
      optimisticEntryId: "pending:prueva",
      suggestions: [makeSuggestion()],
      targetIds: ["suggestion-1"],
      admissionContext: {
        learnedWords: createLearnedWordSet([]),
        rejectedFingerprints: new Set(),
        blockText: () => "Esta Prueva debe corregirse.",
      },
    })

    expect(rollback.learnedWords).toEqual([])
    expect(rollback.suggestions).toEqual([
      expect.objectContaining({
        id: "suggestion-1",
        status: "pending",
      }),
    ])
  })

  it("retries a failed dictionary load before marking the session loaded", async () => {
    const listLearnedWords = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: "UNAVAILABLE", message: "temporary failure" },
      })
      .mockResolvedValueOnce({
        data: makePage([makeEntry("odessay")], null),
        error: null,
      })

    const result = await loadLearnedWordsPages(
      { listLearnedWords },
      {
        retryDelayMs: 5000,
        timer: { setTimeout: (callback: () => void) => callback() as unknown as ReturnType<typeof setTimeout> },
      },
    )

    expect(result).toEqual({
      ok: true,
      items: [makeEntry("odessay")],
    })
    expect(listLearnedWords).toHaveBeenCalledTimes(2)
  })

  it("loads every cursor page into the admission dictionary", async () => {
    const entries = Array.from({ length: 150 }, (_, index) => makeEntry(`word-${index}`))
    const listLearnedWords = vi
      .fn()
      .mockResolvedValueOnce({
        data: makePage(entries.slice(0, 100), "cursor-100"),
        error: null,
      })
      .mockResolvedValueOnce({
        data: makePage(entries.slice(100), null),
        error: null,
      })

    const result = await loadLearnedWordsPages({ listLearnedWords })

    expect(result).toEqual({
      ok: true,
      items: entries,
    })
    expect(listLearnedWords).toHaveBeenNthCalledWith(1, { limit: 100, cursor: null })
    expect(listLearnedWords).toHaveBeenNthCalledWith(2, { limit: 100, cursor: "cursor-100" })
  })

  it("merges background pages without dropping optimistic learned words", () => {
    const merged = mergeLearnedWordEntries(
      [makeEntry("Odéssay", "pending:odessay")],
      [makeEntry("otra"), makeEntry("odessay", "remote:odessay")],
    )

    expect(merged).toEqual([
      makeEntry("odessay", "remote:odessay"),
      makeEntry("otra"),
    ])
  })
})
