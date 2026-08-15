/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopStartupRedirect } from "@/components/navigation/desktop-startup-redirect"

const isTauriRuntimeMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())

// Stable identity on purpose: Next's useRouter is referentially stable, and a
// fresh object per render would re-fire the startup effect forever.
const routerStub = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => routerStub
}))

vi.mock("@/lib/runtime/detect", () => ({
  isTauriRuntime: isTauriRuntimeMock
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({ auth: { getSession: getSessionMock } })
}))

let container: HTMLDivElement
let root: Root | null = null

async function mount() {
  root = createRoot(container)
  await act(async () => {
    root?.render(<DesktopStartupRedirect />)
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  routerStub.replace.mockReset()
  isTauriRuntimeMock.mockReset()
  getSessionMock.mockReset()
  isTauriRuntimeMock.mockReturnValue(true)
  window.history.replaceState(null, "", "/")
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container.remove()
})

describe("desktop startup", () => {
  it("renders nothing on web", async () => {
    isTauriRuntimeMock.mockReturnValue(false)
    await mount()

    expect(container.innerHTML).toBe("")
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it("shows the splash while the session is resolving and sends a signed-in user to the desk", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: {} } }, error: null })
    await mount()

    expect(routerStub.replace).toHaveBeenCalledWith("/desk")
    // The splash stays up through the navigation so the homepage never flashes.
    expect(container.querySelector('[data-testid="app-splash"]')).not.toBeNull()
  })

  it("sends a signed-out user to login", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })
    await mount()

    expect(routerStub.replace).toHaveBeenCalledWith("/login")
  })

  /**
   * ODE-416: a failed session read was being treated as "no session", which is
   * what produced the navigation loop. It must surface, not redirect.
   */
  it("does not treat a failed getSession as signed out", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: new Error("offline") })
    await mount()

    expect(routerStub.replace).not.toHaveBeenCalled()

    const splash = container.querySelector('[data-testid="app-splash"]')
    expect(splash).not.toBeNull()
    expect(splash?.textContent).toContain("Your local artifacts are untouched.")
  })

  it("does not treat a rejected getSession as signed out either", async () => {
    getSessionMock.mockRejectedValue(new Error("boom"))
    await mount()

    expect(routerStub.replace).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="app-splash"]')?.textContent).toContain(
      "Your local artifacts are untouched."
    )
  })

  it("offers a retry that runs the lookup again instead of a dead progress bar", async () => {
    getSessionMock.mockRejectedValueOnce(new Error("boom"))
    await mount()

    expect(getSessionMock).toHaveBeenCalledTimes(1)

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again"
    )
    expect(retry).toBeTruthy()

    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(getSessionMock).toHaveBeenCalledTimes(2)
    expect(routerStub.replace).toHaveBeenCalledWith("/login")
  })

  /**
   * /login mounts this component too. Redirecting to the route already on
   * screen must clear the splash rather than leave it covering the form.
   */
  it("clears the splash when the target route is already current", async () => {
    window.history.replaceState(null, "", "/login")
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })
    await mount()

    expect(routerStub.replace).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="app-splash"]')).toBeNull()
  })

  it("never imposes a minimum duration of its own", async () => {
    const timeoutSpy = vi.spyOn(window, "setTimeout")
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })
    await mount()

    // No timer stands between the resolved session and the redirect.
    expect(routerStub.replace).toHaveBeenCalledWith("/login")
    timeoutSpy.mockRestore()
  })
})
