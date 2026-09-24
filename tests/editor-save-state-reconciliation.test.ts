import { describe, expect, it } from "vitest"
import {
  formatSaveStateDiagnostic,
  isDurableTerminalSyncStatus,
  mapCatalogRecordToSaveState,
  reconcileSaveStateFromDurable,
  saveStateToHasPendingSync,
} from "../components/editor/save-state"

describe("ODE-542 durable save-state reconciliation", () => {
  it("maps durable catalog snapshots to the same states as hydration", () => {
    // Existing document: pending online is still working.
    expect(mapCatalogRecordToSaveState({ syncStatus: "pending", cloudPresent: true }, true)).toBe("saving")
    // Terminal: synced with cloud confirms Saved.
    expect(mapCatalogRecordToSaveState({ syncStatus: "synced", cloudPresent: true }, true)).toBe("saved")
    // Local-only stays Saved locally even online.
    expect(mapCatalogRecordToSaveState({ syncStatus: "local-only", cloudPresent: false }, true)).toBe(
      "saved-local",
    )
    expect(mapCatalogRecordToSaveState({ syncStatus: "synced", cloudPresent: false }, true)).toBe("saved-local")
  })

  it("keeps the ODE-461 distinction: cloud failure is saving, never error", () => {
    expect(mapCatalogRecordToSaveState({ syncStatus: "failed", cloudPresent: true }, true)).toBe("saving")
    expect(mapCatalogRecordToSaveState({ syncStatus: "conflict", cloudPresent: true }, true)).toBe("saving")
  })

  it("shows Saved locally while offline without waiting for cloud", () => {
    expect(mapCatalogRecordToSaveState({ syncStatus: "pending", cloudPresent: true }, false)).toBe("saved-local")
    expect(mapCatalogRecordToSaveState({ syncStatus: "failed", cloudPresent: true }, false)).toBe("saved-local")
  })

  it("heals a lost synced event from the durable snapshot (existing doc)", () => {
    // UI stuck in Saving... although SQLite already says synced. No event is
    // delivered in this test — the durable re-read alone must converge.
    const next = reconcileSaveStateFromDurable({
      current: "saving",
      durable: { syncStatus: "synced", cloudPresent: true },
      isOnline: true,
    })
    expect(next).toBe("saved")
  })

  it("heals a draft whose synced landed before resubscription", () => {
    // null/draft id -> UUID transition: the effect had no listener yet when
    // the flush emitted synced(UUID). Post-materialization reconciliation
    // reads the definitivo UUID directly.
    const next = reconcileSaveStateFromDurable({
      current: "saving",
      durable: { syncStatus: "synced", cloudPresent: true },
      isOnline: true,
    })
    expect(next).toBe("saved")
  })

  it("heals a hydration snapshot taken before sync completed", () => {
    // Hydration projected pending -> saving, then the sync-event counter moved
    // mid-hydration. The follow-up durable read converges without a tab switch.
    const snapshotState = mapCatalogRecordToSaveState(
      { syncStatus: "pending", cloudPresent: true },
      true,
    )
    expect(snapshotState).toBe("saving")

    const healed = reconcileSaveStateFromDurable({
      current: snapshotState,
      durable: { syncStatus: "synced", cloudPresent: true },
      isOnline: true,
    })
    expect(healed).toBe("saved")
  })

  it("heals an empty debounce flush that emitted no status event", () => {
    // Previous pass already left the catalog synced; the trailing debounce
    // flush reports examined=0 and emits only a metric. The UI still heals.
    const next = reconcileSaveStateFromDurable({
      current: "saving",
      durable: { syncStatus: "synced", cloudPresent: true },
      isOnline: true,
    })
    expect(next).toBe("saved")
  })

  it("never downgrades or churns on non-terminal durables", () => {
    // New-draft Saved locally with durable pending stays put (no flip to
    // Saving...); existing Saving... with durable pending stays put.
    expect(
      reconcileSaveStateFromDurable({
        current: "saved-local",
        durable: { syncStatus: "pending", cloudPresent: true },
        isOnline: true,
      }),
    ).toBeNull()
    expect(
      reconcileSaveStateFromDurable({
        current: "saving",
        durable: { syncStatus: "pending", cloudPresent: true },
        isOnline: true,
      }),
    ).toBeNull()
    expect(
      reconcileSaveStateFromDurable({
        current: "saving",
        durable: { syncStatus: "failed", cloudPresent: true },
        isOnline: true,
      }),
    ).toBeNull()
  })

  it("preserves a local failure even when the catalog looks synced", () => {
    // Needs attention (error) is a durable local-write failure. A stale cloud
    // snapshot must never clear it.
    expect(
      reconcileSaveStateFromDurable({
        current: "error",
        durable: { syncStatus: "synced", cloudPresent: true },
        isOnline: true,
      }),
    ).toBeNull()
    expect(
      reconcileSaveStateFromDurable({
        current: "error",
        durable: { syncStatus: "local-only", cloudPresent: false },
        isOnline: true,
      }),
    ).toBeNull()
  })

  it("leaves an already-converged terminal state untouched (A -> B -> A)", () => {
    expect(
      reconcileSaveStateFromDurable({
        current: "saved",
        durable: { syncStatus: "synced", cloudPresent: true },
        isOnline: true,
      }),
    ).toBeNull()
    expect(
      reconcileSaveStateFromDurable({
        current: "saved-local",
        durable: { syncStatus: "local-only", cloudPresent: false },
        isOnline: true,
      }),
    ).toBeNull()
  })

  it("converges status bar and tab from the same snapshot", () => {
    const next = reconcileSaveStateFromDurable({
      current: "saving",
      durable: { syncStatus: "synced", cloudPresent: true },
      isOnline: true,
    })
    expect(next).toBe("saved")
    expect(saveStateToHasPendingSync(next!)).toBe(false)
    expect(saveStateToHasPendingSync("saving")).toBe(true)
    expect(saveStateToHasPendingSync("error")).toBe(true)
  })

  it("only treats synced/local-only as terminal", () => {
    expect(isDurableTerminalSyncStatus("synced")).toBe(true)
    expect(isDurableTerminalSyncStatus("local-only")).toBe(true)
    expect(isDurableTerminalSyncStatus("pending")).toBe(false)
    expect(isDurableTerminalSyncStatus("failed")).toBe(false)
    expect(isDurableTerminalSyncStatus("conflict")).toBe(false)
    expect(isDurableTerminalSyncStatus("deleted")).toBe(false)
  })

  it("emits structured diagnostics without document content", () => {
    const line = formatSaveStateDiagnostic({
      writingId: "uuid-123",
      durableSyncStatus: "synced",
      current: "saving",
      next: "saved",
      reason: "sync-synced",
    })
    expect(line).toContain("uuid-123")
    expect(line).toContain("durable=synced")
    expect(line).toContain("current=saving")
    expect(line).toContain("next=saved")
    expect(line).toContain("reason=sync-synced")
  })
})
