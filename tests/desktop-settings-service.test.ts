import { beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"

const mockSettingsStore = new Map<string, unknown>()

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriSettingsRead: vi.fn(async (_configDir: string, key: string) => {
    return mockSettingsStore.get(key) ?? null
  }),
  tauriSettingsWrite: vi.fn(async (_configDir: string, key: string, value: unknown) => {
    mockSettingsStore.set(key, value)
  }),
  tauriSettingsDelete: vi.fn(async (_configDir: string, key: string) => {
    mockSettingsStore.delete(key)
  }),
  tauriSettingsListKeys: vi.fn(async (_configDir: string) => {
    return Array.from(mockSettingsStore.keys())
  }),
}))

describe("DesktopSettingsService", () => {
  let service: DesktopSettingsService

  beforeEach(() => {
    mockSettingsStore.clear()
    service = new DesktopSettingsService("/tmp/odessay-config")
    vi.clearAllMocks()
  })

  it("getUserSettings returns default settings when store is empty", async () => {
    const result = await service.getUserSettings()
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ disabledStatuses: [] })
  })

  it("updateUserSettings persists disabledStatuses", async () => {
    const update = await service.updateUserSettings({ disabledStatuses: ["archived"] })
    expect(update.error).toBeNull()
    expect(update.data).toEqual({ disabledStatuses: ["archived"] })

    const read = await service.getUserSettings()
    expect(read.data).toEqual({ disabledStatuses: ["archived"] })
  })

  it("getDesktopSettings returns full settings object", async () => {
    await service.updateDesktopSettings({ writingsDir: "/home/user/docs", editorFontSize: 16 })

    const result = await service.getDesktopSettings()
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      writingsDir: "/home/user/docs",
      editorFontSize: 16,
      disabledStatuses: [],
    })
  })

  it("updateDesktopSettings merges partial updates", async () => {
    await service.updateDesktopSettings({ writingsDir: "/home/user/docs" })
    await service.updateDesktopSettings({ editorFontSize: 18 })

    const result = await service.getDesktopSettings()
    expect(result.data).toMatchObject({
      writingsDir: "/home/user/docs",
      editorFontSize: 18,
    })
  })

  it("clearAllSettings removes all settings", async () => {
    await service.updateDesktopSettings({ writingsDir: "/home/user/docs" })
    const clear = await service.clearAllSettings()
    expect(clear.error).toBeNull()

    const result = await service.getDesktopSettings()
    expect(result.data).toEqual({ disabledStatuses: [] })
  })
})
