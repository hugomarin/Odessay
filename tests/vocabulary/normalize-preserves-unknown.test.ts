import { describe, expect, it } from "vitest"
import { normalizeWritingStatus } from "@/lib/writings/status"
import { normalizeArtifactType } from "@/lib/writings/artifact-type"

/**
 * ODE-474 requirement 5: the coercion that used to force any unrecognized
 * status/type to "draft"/"general" was silent data loss for a custom
 * vocabulary value. This proves a custom value survives a full
 * read -> save -> read cycle unchanged.
 */
describe("normalizeWritingStatus preserves unknown values", () => {
  it("returns a custom status unchanged, not coerced to draft", () => {
    expect(normalizeWritingStatus("backlog")).toBe("backlog")
  })

  it("survives a full read -> save -> read cycle", () => {
    const saved = normalizeWritingStatus("backlog")
    const reloaded = normalizeWritingStatus(saved)
    expect(reloaded).toBe("backlog")
  })

  it("still maps the legacy 'finished' alias to 'done'", () => {
    expect(normalizeWritingStatus("finished")).toBe("done")
  })

  it("still defaults a genuinely absent value to draft — that is filling in absence, not coercing a known value", () => {
    expect(normalizeWritingStatus(null)).toBe("draft")
    expect(normalizeWritingStatus(undefined)).toBe("draft")
    expect(normalizeWritingStatus("")).toBe("draft")
  })
})

describe("normalizeArtifactType preserves unknown values", () => {
  it("returns a custom type unchanged, not coerced to general", () => {
    expect(normalizeArtifactType("research")).toBe("research")
  })

  it("survives a full read -> save -> read cycle", () => {
    const saved = normalizeArtifactType("research")
    const reloaded = normalizeArtifactType(saved)
    expect(reloaded).toBe("research")
  })

  it("still defaults a genuinely absent value to general", () => {
    expect(normalizeArtifactType(null)).toBe("general")
    expect(normalizeArtifactType(undefined)).toBe("general")
    expect(normalizeArtifactType("")).toBe("general")
  })
})
