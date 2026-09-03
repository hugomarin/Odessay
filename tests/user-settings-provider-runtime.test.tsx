/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const { isTauriRuntimeMock, getUserSettingsMock, updateUserSettingsMock, appConfigDirMock } = vi.hoisted(() => ({
  isTauriRuntimeMock: vi.fn(),
  getUserSettingsMock: vi.fn(),
  updateUserSettingsMock: vi.fn(),
  appConfigDirMock: vi.fn(async () => "/tmp/odessay-config"),
}))
const fetchMock = vi.fn()

vi.mock("@/lib/runtime/detect", () => ({
  isTauriRuntime: isTauriRuntimeMock,
  isWebRuntime: () => !isTauriRuntimeMock(),
}))

vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: appConfigDirMock,
}))

vi.mock("@/lib/services/desktop/desktop-settings-service", () => ({
  DesktopSettingsService: class {
    getUserSettings = getUserSettingsMock
    updateUserSettings = updateUserSettingsMock
  },
}))

let container: HTMLDivElement
let root: Root
let originalFetch: typeof globalThis.fetch

const renderProvider = async () => {
  const { UserSettingsProvider } = await import(
    "@/components/settings/user-settings-provider"
  )
  await act(async () => {
    root.render(<UserSettingsProvider>{null}</UserSettingsProvider>)
  })
  // The Tauri branch resolves settings through two chained dynamic imports
  // (`@tauri-apps/api/path`, the desktop adapter) before calling
  // getUserSettings(), which outlasts a single act() microtask flush.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  isTauriRuntimeMock.mockReset()
  fetchMock.mockReset()
  getUserSettingsMock.mockReset()
  updateUserSettingsMock.mockReset()
  getUserSettingsMock.mockResolvedValue({
    data: { disabledStatuses: [], vocabulary: [] },
    error: null,
  })
  originalFetch = globalThis.fetch
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  globalThis.fetch = originalFetch
  vi.resetModules()
})

describe("UserSettingsProvider runtime split", () => {
  it("reads from DesktopSettingsService, not fetch, on Tauri runtime (ODE-473)", async () => {
    isTauriRuntimeMock.mockReturnValue(true)

    await renderProvider()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(getUserSettingsMock).toHaveBeenCalledTimes(1)
  })

  it("fetches /api/user/settings on web runtime", async () => {
    isTauriRuntimeMock.mockReturnValue(false)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { disabledStatuses: [], vocabulary: [] }, error: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await renderProvider()

    expect(fetchMock).toHaveBeenCalledWith("/api/user/settings", { method: "GET" })
    expect(getUserSettingsMock).not.toHaveBeenCalled()
  })
})
