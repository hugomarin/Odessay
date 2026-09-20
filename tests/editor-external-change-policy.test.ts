import { describe, expect, it } from "vitest"
import { isExternalReconciliationReason, resolveExternalContentChange } from "@/lib/editor/external-change-policy"

describe("isExternalReconciliationReason", () => {
  it("treats only 'bulk' (the reconciler's own reason) as external evidence", () => {
    expect(isExternalReconciliationReason("bulk")).toBe(true)
  })

  it.each(["content", "upsert", "detach", "cloud-snapshot", "excerpt", "migration"] as const)(
    "does not treat '%s' (the app's own writes) as external evidence",
    (reason) => {
      expect(isExternalReconciliationReason(reason)).toBe(false)
    },
  )

  it("treats undefined (a direct, non-event-driven call) as non-external", () => {
    expect(isExternalReconciliationReason(undefined)).toBe(false)
  })
})

describe("resolveExternalContentChange (WATCH-07 policy)", () => {
  it("does nothing when the content hash has not changed", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: "blake3:aaa",
        currentContentHash: "blake3:aaa",
        hasPendingLocalEdit: false,
        reason: "bulk",
      }),
    ).toEqual({ action: "none" })
  })

  it("auto-reloads when the content changed externally and the editor is clean", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: "blake3:aaa",
        currentContentHash: "blake3:bbb",
        hasPendingLocalEdit: false,
        reason: "bulk",
      }),
    ).toEqual({ action: "auto-reload" })
  })

  it("raises a conflict when the content changed externally while a local edit is pending", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: "blake3:aaa",
        currentContentHash: "blake3:bbb",
        hasPendingLocalEdit: true,
        reason: "bulk",
      }),
    ).toEqual({ action: "conflict" })
  })

  it("does nothing when there is no baseline yet (still initializing)", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: null,
        currentContentHash: "blake3:bbb",
        hasPendingLocalEdit: false,
        reason: "bulk",
      }),
    ).toEqual({ action: "none" })
  })

  it("does nothing when the catalog has no content hash (unbound/no materialized file)", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: "blake3:aaa",
        currentContentHash: null,
        hasPendingLocalEdit: false,
        reason: "bulk",
      }),
    ).toEqual({ action: "none" })
  })

  // WATCH-07 regression: a normal local autosave commits with reason
  // "content" (body-only) or "upsert" (metadata) for the very same
  // document whose hash just changed — that must never be mistaken for an
  // external edit, even though the hash comparison alone would say "changed".
  it.each(["content", "upsert", "detach", "cloud-snapshot", "excerpt", "migration"] as const)(
    "never reacts to the app's own '%s' catalog change, even if the hash differs and a local edit is pending",
    (reason) => {
      expect(
        resolveExternalContentChange({
          baselineContentHash: "blake3:aaa",
          currentContentHash: "blake3:bbb",
          hasPendingLocalEdit: true,
          reason,
        }),
      ).toEqual({ action: "none" })
    },
  )

  it("never reacts to a direct call with no reason (the initial sync)", () => {
    expect(
      resolveExternalContentChange({
        baselineContentHash: "blake3:aaa",
        currentContentHash: "blake3:bbb",
        hasPendingLocalEdit: false,
      }),
    ).toEqual({ action: "none" })
  })
})
