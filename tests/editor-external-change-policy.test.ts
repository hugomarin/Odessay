import { describe, expect, it } from "vitest"
import { resolveExternalContentChange } from "@/lib/editor/external-change-policy"

describe("resolveExternalContentChange (WATCH-07 policy)", () => {
  it("does nothing when the content hash has not changed", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: "blake3:aaa",
        currentContentHash: "blake3:aaa",
        hasPendingLocalEdit: false,
      }),
    ).toEqual({ action: "none" })
  })

  it("auto-reloads when the content changed externally and the editor is clean", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: "blake3:aaa",
        currentContentHash: "blake3:bbb",
        hasPendingLocalEdit: false,
      }),
    ).toEqual({ action: "auto-reload" })
  })

  it("raises a conflict when the content changed externally while a local edit is pending", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: "blake3:aaa",
        currentContentHash: "blake3:bbb",
        hasPendingLocalEdit: true,
      }),
    ).toEqual({ action: "conflict" })
  })

  it("does nothing when there is no baseline yet (still initializing)", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: null,
        currentContentHash: "blake3:bbb",
        hasPendingLocalEdit: false,
      }),
    ).toEqual({ action: "none" })
  })

  it("does nothing when the catalog has no content hash (unbound/no materialized file)", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: "blake3:aaa",
        currentContentHash: null,
        hasPendingLocalEdit: false,
      }),
    ).toEqual({ action: "none" })
  })
})
