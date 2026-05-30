/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const isTauriRuntimeMock = vi.fn()
const fetchMock = vi.fn()

vi.mock("@/lib/runtime/detect", () => ({
  isTauriRuntime: isTauriRuntimeMock,
  isWebRuntime: () => !isTauriRuntimeMock(),
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
}

beforeEach(() => {
  isTauriRuntimeMock.mockReset()
  fetchMock.mockReset()
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
  it("does not fetch /api/user/settings on Tauri runtime", async () => {
    isTauriRuntimeMock.mockReturnValue(true)

    await renderProvider()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fetches /api/user/settings on web runtime", async () => {
    isTauriRuntimeMock.mockReturnValue(false)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { disabledStatuses: [] }, error: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await renderProvider()

    expect(fetchMock).toHaveBeenCalledWith("/api/user/settings", { method: "GET" })
  })
})
