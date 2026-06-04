/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const setLocalDBScopeMock = vi.fn()
const startMock = vi.fn(() => Promise.resolve())
const stopMock = vi.fn(() => Promise.resolve())
const scheduleFlushMock = vi.fn(() => Promise.resolve())
const hydrateWritingsMock = vi.fn(() => Promise.resolve({ data: null }))
const hydrateCollectionsMock = vi.fn(() => Promise.resolve({ data: null }))
const supabaseGetUserMock = vi.fn()
const onAuthStateChangeMock = vi.fn()
const desktopOnAuthStateChangeMock = vi.fn()
const isTauriRuntimeMock = vi.fn()

vi.mock("@/lib/local-db", () => ({
  setLocalDBScope: setLocalDBScopeMock,
}))

vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({
    start: startMock,
    stop: stopMock,
    scheduleFlush: scheduleFlushMock,
    hydrateWritings: hydrateWritingsMock,
    hydrateCollections: hydrateCollectionsMock,
  }),
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: supabaseGetUserMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
  }),
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: {
      onAuthStateChange: desktopOnAuthStateChangeMock,
    },
  }),
}))

vi.mock("@/lib/runtime/detect", () => ({
  isTauriRuntime: isTauriRuntimeMock,
  isWebRuntime: () => !isTauriRuntimeMock(),
}))

let container: HTMLDivElement
let root: Root

const renderBootstrap = async () => {
  const { SyncBootstrap } = await import("@/components/sync/sync-bootstrap")
  await act(async () => {
    root.render(<SyncBootstrap />)
  })
}

beforeEach(() => {
  setLocalDBScopeMock.mockReset()
  startMock.mockClear()
  stopMock.mockClear()
  scheduleFlushMock.mockClear()
  hydrateWritingsMock.mockClear()
  hydrateCollectionsMock.mockClear()
  supabaseGetUserMock.mockReset()
  onAuthStateChangeMock.mockReset()
  desktopOnAuthStateChangeMock.mockReset()
  isTauriRuntimeMock.mockReset()
  onAuthStateChangeMock.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  })
  desktopOnAuthStateChangeMock.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.resetModules()
})

describe("SyncBootstrap runtime split", () => {
  it("on desktop, seeds scope and skips web auth bootstrap", async () => {
    isTauriRuntimeMock.mockReturnValue(true)

    await renderBootstrap()

    expect(supabaseGetUserMock).not.toHaveBeenCalled()
    expect(onAuthStateChangeMock).not.toHaveBeenCalled()
    expect(desktopOnAuthStateChangeMock).toHaveBeenCalled()
    expect(hydrateWritingsMock).not.toHaveBeenCalled()
    expect(hydrateCollectionsMock).not.toHaveBeenCalled()
    expect(setLocalDBScopeMock).toHaveBeenCalledWith(undefined)
    expect(startMock).toHaveBeenCalled()
    expect(scheduleFlushMock).toHaveBeenCalled()
  })

  it("on web without session, calls supabase.auth.getUser but skips remote hydrate", async () => {
    isTauriRuntimeMock.mockReturnValue(false)
    supabaseGetUserMock.mockResolvedValue({ data: { user: null } })

    await renderBootstrap()

    expect(supabaseGetUserMock).toHaveBeenCalled()
    expect(hydrateWritingsMock).not.toHaveBeenCalled()
    expect(hydrateCollectionsMock).not.toHaveBeenCalled()
    expect(setLocalDBScopeMock).toHaveBeenCalledWith(undefined)
    expect(startMock).toHaveBeenCalled()
    expect(onAuthStateChangeMock).toHaveBeenCalled()
  })

  it("on web with session, hydrates from remote and sets scope to user id", async () => {
    isTauriRuntimeMock.mockReturnValue(false)
    supabaseGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } })

    await renderBootstrap()

    expect(supabaseGetUserMock).toHaveBeenCalled()
    expect(setLocalDBScopeMock).toHaveBeenCalledWith("user-1")
    expect(hydrateWritingsMock).toHaveBeenCalled()
    expect(hydrateCollectionsMock).toHaveBeenCalled()
    expect(startMock).toHaveBeenCalled()
    expect(onAuthStateChangeMock).toHaveBeenCalled()
  })

  it("desktop auth listener does not block USER_UPDATED on remote hydrate", async () => {
    isTauriRuntimeMock.mockReturnValue(true)

    await renderBootstrap()

    const callback = desktopOnAuthStateChangeMock.mock.calls[0]?.[0]
    expect(typeof callback).toBe("function")

    hydrateWritingsMock.mockImplementation(
      () => new Promise(() => {}),
    )
    hydrateCollectionsMock.mockResolvedValue({ data: null })

    const returnValue = callback?.("USER_UPDATED", { user: { id: "user-1" } })

    expect(returnValue).toBeUndefined()
    expect(setLocalDBScopeMock).toHaveBeenCalledWith("user-1")
    expect(hydrateWritingsMock).toHaveBeenCalled()
    expect(scheduleFlushMock).toHaveBeenCalled()
  })
})
