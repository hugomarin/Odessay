import { describe, expect, it } from "vitest"
import { mapLocalSyncStatusToSaveState, mapSyncLifecycleToSaveState } from "../components/editor/save-state"

describe("editor save state transitions", () => {
  it("maps sync lifecycle events to editor save states", () => {
    expect(mapSyncLifecycleToSaveState("pending")).toBe("saving")
    expect(mapSyncLifecycleToSaveState("syncing")).toBe("saving")
    expect(mapSyncLifecycleToSaveState("retrying")).toBe("saving")
    expect(mapSyncLifecycleToSaveState("offline")).toBe("saved-local")
    expect(mapSyncLifecycleToSaveState("synced")).toBe("saved")
  })

  it("maps local writing sync status considering connectivity", () => {
    expect(mapLocalSyncStatusToSaveState("synced", "server-confirmed", true)).toBe("saved")
    expect(mapLocalSyncStatusToSaveState("synced", "local-only", true)).toBe("saved-local")
    expect(mapLocalSyncStatusToSaveState("pending", "local-only", true)).toBe("saving")
    expect(mapLocalSyncStatusToSaveState("failed", "server-confirmed", true)).toBe("saving")
    expect(mapLocalSyncStatusToSaveState("deleted", "server-confirmed", true)).toBe("saving")
    expect(mapLocalSyncStatusToSaveState("pending", "local-only", false)).toBe("saved-local")
  })
})
