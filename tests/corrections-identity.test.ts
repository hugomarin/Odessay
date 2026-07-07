import { afterEach, describe, expect, it, vi } from "vitest"

import { createCorrectionFingerprint, filterCorrectionsByMemory } from "@/lib/ai/correction-memory"
import type { CanonicalCorrection } from "@/lib/ai/corrections"
import {
  createStableFingerprint,
  stableFingerprintFromStoredFingerprint,
} from "@/lib/corrections/engine/identity"
import {
  CORRECTION_MEMORY_STORAGE_KEY,
  readCorrectionMemory,
  rememberCorrectionDecision,
} from "@/lib/editor/correction-memory-client"

const makeCorrection = (blockId: string): CanonicalCorrection => ({
  blockId,
  type: "spelling",
  severity: "medium",
  confidence: "high",
  originalText: "Prueva",
  replacementText: "prueba",
})

describe("correction identity", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("creates stable fingerprints without block hash or position", () => {
    const first = createCorrectionFingerprint(makeCorrection("correction-block:0:hash-a:10"))
    const second = createCorrectionFingerprint(makeCorrection("correction-block:0:hash-b:42"))

    expect(first).toBe("spelling|prueva|prueba")
    expect(second).toBe(first)
    expect(first).not.toContain("hash-a")
    expect(first).not.toContain("42")
  })

  it("filters a rejected correction after the block id changes", () => {
    const beforeEdit = makeCorrection("correction-block:0:hash-a:10")
    const afterEdit = makeCorrection("correction-block:0:hash-b:42")

    const filtered = filterCorrectionsByMemory([afterEdit], {
      entries: [
        {
          fingerprint: createStableFingerprint(beforeEdit),
          decision: "rejected",
          decidedAt: "2026-07-07T00:00:00.000Z",
        },
      ],
    })

    expect(filtered).toEqual([])
  })

  it("honors legacy localStorage fingerprints by their stable tail", () => {
    const afterEdit = makeCorrection("correction-block:0:hash-b:42")
    const legacyFingerprint = "correction-block:0:hash-a:10|spelling|Prueva|prueba"

    const filtered = filterCorrectionsByMemory([afterEdit], {
      entries: [
        {
          fingerprint: legacyFingerprint,
          decision: "rejected",
          decidedAt: "2026-07-07T00:00:00.000Z",
        },
      ],
    })

    expect(stableFingerprintFromStoredFingerprint(legacyFingerprint)).toBe("spelling|prueva|prueba")
    expect(filtered).toEqual([])
  })

  it("ignores malformed legacy memory entries", () => {
    const correction = makeCorrection("correction-block:0:hash-b:42")

    const filtered = filterCorrectionsByMemory([correction], {
      entries: [
        {
          fingerprint: "malformed",
          decision: "rejected",
          decidedAt: "2026-07-07T00:00:00.000Z",
        },
      ],
    })

    expect(filtered).toEqual([correction])
  })

  it("keeps existing localStorage decisions compatible while storing the stable identity", () => {
    const store = new Map<string, string>()
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    })
    store.set(
      CORRECTION_MEMORY_STORAGE_KEY,
      JSON.stringify([
        {
          fingerprint: "correction-block:0:hash-a:10|spelling|Prueva|prueba",
          decision: "rejected",
          decidedAt: "2026-07-07T00:00:00.000Z",
        },
      ]),
    )

    rememberCorrectionDecision("spelling|prueva|prueba", "rejected")

    expect(readCorrectionMemory()).toMatchObject([
      {
        fingerprint: "spelling|prueva|prueba",
        decision: "rejected",
      },
    ])
  })
})
