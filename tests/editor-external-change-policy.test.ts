import { describe, expect, it } from "vitest"
import {
  computeHasPendingLocalEdit,
  isExternalReconciliationReason,
  resolveExternalContentChange,
} from "@/lib/editor/external-change-policy"

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

  /**
   * WATCH-07 regression: the desktop persistence debounce (150ms rich mode,
   * MARKDOWN_SAVE_DEBOUNCE_MS markdown mode) means there is a real window
   * after a keystroke where the editor already holds an unconfirmed edit but
   * persistenceCoordinator.hasPending() still correctly reports "nothing
   * pending", because persist() hasn't been called yet at all. The
   * coordinator-owned signal covers the separate post-handoff window.
   * computeHasPendingLocalEdit combines those two lifecycles — proven here,
   * and then through resolveExternalContentChange's own branching below.
   */
  describe("document clean at H1, user types, debounce has NOT fired yet, external H2 arrives (WATCH-07 regression)", () => {
    it("computeHasPendingLocalEdit is true from the pre-handoff edit signal alone", () => {
      expect(
        computeHasPendingLocalEdit({
          hasUnconfirmedLocalEdit: true,
          hasUnconfirmedPersistedContent: false,
        }),
      ).toBe(true)
    })

    it("computeHasPendingLocalEdit is true from the coordinator signal after persist() hands off the edit", () => {
      expect(
        computeHasPendingLocalEdit({
          hasUnconfirmedLocalEdit: false,
          hasUnconfirmedPersistedContent: true,
        }),
      ).toBe(true)
    })

    it("resolveExternalContentChange raises a conflict (never auto-reload) for exactly that combined signal", () => {
      const hasPendingLocalEdit = computeHasPendingLocalEdit({
        hasUnconfirmedLocalEdit: true,
        hasUnconfirmedPersistedContent: false,
      })

      expect(
        resolveExternalContentChange({
          baselineContentHash: "blake3:h1",
          currentContentHash: "blake3:h2",
          hasPendingLocalEdit,
          reason: "bulk",
        }),
      ).toEqual({ action: "conflict" })
    })
  })

  it("computeHasPendingLocalEdit is false only when neither lifecycle reports an unsaved edit", () => {
    expect(
      computeHasPendingLocalEdit({ hasUnconfirmedLocalEdit: false, hasUnconfirmedPersistedContent: false }),
    ).toBe(false)
    expect(
      computeHasPendingLocalEdit({ hasUnconfirmedLocalEdit: false, hasUnconfirmedPersistedContent: true }),
    ).toBe(true)
    expect(
      computeHasPendingLocalEdit({ hasUnconfirmedLocalEdit: true, hasUnconfirmedPersistedContent: true }),
    ).toBe(true)
  })
})
