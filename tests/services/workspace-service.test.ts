/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getDesktopSettingsMock: vi.fn(),
  updateDesktopSettingsMock: vi.fn(),
  tauriWorkspaceSyncMock: vi.fn(),
  openDialogMock: vi.fn(),
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.openDialogMock,
}))

vi.mock("@/lib/services/desktop/desktop-settings-service", () => ({
  DesktopSettingsService: class {
    async getDesktopSettings() {
      return mocks.getDesktopSettingsMock()
    }
    async updateDesktopSettings(patch: unknown) {
      return mocks.updateDesktopSettingsMock(patch)
    }
  },
}))

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriWorkspaceSync: mocks.tauriWorkspaceSyncMock,
  tauriWorkspaceCreate: vi.fn(),
  tauriCreateFile: vi.fn(),
  tauriOpenFile: vi.fn(),
}))

vi.mock("@/lib/services/desktop/tauri-fs-watch", () => ({
  isOdysseyInternalPath: vi.fn(() => false),
  watchFsPaths: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock("@/lib/local-db", () => ({
  localDB: {
    writings: {
      getByCanonicalPath: vi.fn(),
      get: vi.fn(),
    },
  },
}))

vi.mock("@/lib/services/document-service-factory", () => ({
  getDocumentService: vi.fn(),
  markDesktopWritingDeletedByCanonicalPath: vi.fn(),
  relocateDesktopWritingByCanonicalPath: vi.fn(),
}))

describe("DesktopWorkspaceService", () => {
  let storedWorkspaces: unknown[] = []

  beforeEach(() => {
    vi.resetModules()
    mocks.getDesktopSettingsMock.mockReset()
    mocks.updateDesktopSettingsMock.mockReset()
    mocks.tauriWorkspaceSyncMock.mockReset()
    mocks.openDialogMock.mockReset()

    storedWorkspaces = []
    mocks.getDesktopSettingsMock.mockImplementation(async () => ({
      data: { workspaces: storedWorkspaces },
      error: null,
    }))
    mocks.updateDesktopSettingsMock.mockImplementation(async (patch: { workspaces?: unknown[] }) => {
      if (patch.workspaces) {
        storedWorkspaces = patch.workspaces
      }
      return { data: { workspaces: storedWorkspaces }, error: null }
    })
    mocks.tauriWorkspaceSyncMock.mockImplementation(async (rootPath: string) => ({
      rootPath,
      name: rootPath.split("/").pop() ?? "workspace",
      fileCount: 0,
      folderCount: 0,
      updatedAt: null,
      files: [],
    }))
  })

  async function getService() {
    const { DesktopWorkspaceService } = await import("@/lib/services/desktop/workspace-service")
    const { DesktopSettingsService } = await import("@/lib/services/desktop/desktop-settings-service")
    return new DesktopWorkspaceService(new DesktopSettingsService("/tmp/config"))
  }

  it("guarantees exactly one entry when two concurrent calls add the same rootPath", async () => {
    const service = await getService()

    mocks.openDialogMock.mockResolvedValue("/tmp/workspace")

    const [first, second] = await Promise.all([
      service.addExistingWorkspace(),
      service.addExistingWorkspace(),
    ])

    // Exactly one record should exist in the store
    expect(storedWorkspaces).toHaveLength(1)
    expect(storedWorkspaces[0]).toMatchObject({
      rootPath: "/tmp/workspace",
      source: "existing-folder",
    })

    // Both calls should return the same record (by value, since timestamps differ if they were different objects)
    expect(first).toEqual(second)
    expect(first?.rootPath).toBe("/tmp/workspace")
  })

  it("allows sequential calls for different rootPaths", async () => {
    const service = await getService()

    mocks.openDialogMock
      .mockResolvedValueOnce("/tmp/workspace-a")
      .mockResolvedValueOnce("/tmp/workspace-b")

    const first = await service.addExistingWorkspace()
    const second = await service.addExistingWorkspace()

    expect(storedWorkspaces).toHaveLength(2)
    expect(first).not.toEqual(second)
    expect(first?.rootPath).toBe("/tmp/workspace-a")
    expect(second?.rootPath).toBe("/tmp/workspace-b")
  })
})
