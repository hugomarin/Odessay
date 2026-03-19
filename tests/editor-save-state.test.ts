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
    expect(mapLocalSyncStatusToSaveState("synced", true)).toBe("saved")
    expect(mapLocalSyncStatusToSaveState("pending", true)).toBe("saving")
    expect(mapLocalSyncStatusToSaveState("failed", true)).toBe("saving")
    expect(mapLocalSyncStatusToSaveState("deleted", true)).toBe("saving")
    expect(mapLocalSyncStatusToSaveState("pending", false)).toBe("saved-local")
  })
})
