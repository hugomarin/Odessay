import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Resource: class {},
  Channel: class {},
}))

import { tauriWorkspaceSync, type DesktopWorkspaceSnapshot } from "@/lib/services/desktop/tauri-commands"

function snapshot(overrides: Partial<DesktopWorkspaceSnapshot> = {}): DesktopWorkspaceSnapshot {
  return {
    rootPath: "/root",
    bindingRootId: "root-1",
    name: "root",
    fileCount: 0,
    folderCount: 0,
    updatedAt: null,
    selectedPaths: [],
    files: [],
    unboundPaths: [],
    ...overrides,
  }
}

describe("tauriWorkspaceSync", () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves in a single workspace_sync call when nothing is newly discovered", async () => {
    // The steady-state case — no file lacks an id — must cost exactly one
    // recursive folder walk, not the two a `workspace_unbound_paths` pre-walk
    // used to force unconditionally on every call.
    mocks.invoke.mockResolvedValueOnce(snapshot({ fileCount: 3 }))

    const result = await tauriWorkspaceSync("/root")

    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith("workspace_sync", {
      rootPath: "/root",
      selectedPaths: undefined,
      documentIds: undefined,
    })
    expect(result.fileCount).toBe(3)
  })

  it("mints ids and retries only for paths workspace_sync reports as unbound", async () => {
    mocks.invoke
      .mockResolvedValueOnce(snapshot({ unboundPaths: ["new-note.md"] }))
      .mockResolvedValueOnce(snapshot({ fileCount: 1 }))

    const result = await tauriWorkspaceSync("/root")

    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    const secondCall = mocks.invoke.mock.calls[1]
    expect(secondCall[0]).toBe("workspace_sync")
    expect(secondCall[1].documentIds["new-note.md"]).toEqual(expect.any(String))
    expect(result.fileCount).toBe(1)
  })

  it("preserves caller-supplied ids and only mints for genuinely unbound paths", async () => {
    mocks.invoke
      .mockResolvedValueOnce(snapshot({ unboundPaths: ["new-note.md"] }))
      .mockResolvedValueOnce(snapshot())

    await tauriWorkspaceSync("/root", undefined, { "known.md": "existing-id" })

    const secondCall = mocks.invoke.mock.calls[1]
    expect(secondCall[1].documentIds["known.md"]).toBe("existing-id")
    expect(secondCall[1].documentIds["new-note.md"]).toEqual(expect.any(String))
  })
})
