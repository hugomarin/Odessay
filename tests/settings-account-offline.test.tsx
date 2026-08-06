/** @vitest-environment happy-dom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopAccountPage } from "@/components/settings/desktop-account-page"
import type { AuthSession } from "@/lib/services/contracts/auth-service"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ─── Mocks ────────────────────────────────────────────────────────────────────

const routerHolder = vi.hoisted(() => ({
  router: { replace: vi.fn() },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => routerHolder.router,
}))

const getSessionMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/auth-service-factory", () => ({
  getAuthService: () => ({ getSession: getSessionMock }),
}))

vi.mock("@/components/settings/account-form", () => ({
  AccountForm: ({ initialAccount }: { initialAccount: { email: string } }) => (
    <div data-testid="account-form">{initialAccount.email}</div>
  ),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const accountUser = {
  id: "user-1",
  email: "writer@example.com",
  pendingEmail: null,
  emailConfirmedAt: "2026-05-01T00:00:00.000Z",
  displayName: "Writer",
  username: "writer",
}

function sessionResult(session: AuthSession): ServiceResponse<AuthSession> {
  return { data: session, error: null }
}

function transportFailure(): ServiceResponse<AuthSession> {
  return {
    data: null,
    error: { code: "UNAVAILABLE", message: "Load failed", retryable: true },
  }
}

// ─── Harness ──────────────────────────────────────────────────────────────────

let container: HTMLDivElement
let root: Root

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderPage() {
  await act(async () => {
    root.render(<DesktopAccountPage />)
  })
  await settle()
}

// ─── Account page session effect (ODE-416) ────────────────────────────────────

describe("DesktopAccountPage session effect", () => {
  beforeEach(() => {
    routerHolder.router = { replace: vi.fn() }
    getSessionMock.mockReset()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("a failed getSession produces no navigation and a retryable error state", async () => {
    getSessionMock.mockResolvedValue(transportFailure())

    await renderPage()

    expect(routerHolder.router.replace).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.textContent).toContain("Check your connection")
  })

  it("retry recovers and renders the account form once getSession succeeds", async () => {
    getSessionMock
      .mockResolvedValueOnce(transportFailure())
      .mockResolvedValue(sessionResult({ status: "authenticated", user: accountUser }))

    await renderPage()
    expect(container.querySelector('[data-testid="account-form"]')).toBeNull()

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    )
    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await settle()

    expect(routerHolder.router.replace).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="account-form"]')?.textContent).toBe(
      "writer@example.com",
    )
  })

  it("a genuine anonymous session triggers at most one navigation, even if the effect re-runs", async () => {
    getSessionMock.mockResolvedValue(sessionResult({ status: "anonymous", user: null }))

    await renderPage()
    expect(routerHolder.router.replace).toHaveBeenCalledTimes(1)
    expect(routerHolder.router.replace).toHaveBeenCalledWith("/login?next=/settings/account")

    // Simulate the historical loop: router.replace changed the router identity
    // and the effect re-ran. The guard must keep navigation bounded to one.
    const firstRouter = routerHolder.router
    routerHolder.router = { replace: vi.fn() }
    await renderPage()
    await settle()

    expect(firstRouter.replace).toHaveBeenCalledTimes(1)
    expect(routerHolder.router.replace).not.toHaveBeenCalled()
  })

  it("an unverified offline session renders local account data without navigating", async () => {
    getSessionMock.mockResolvedValue(sessionResult({ status: "unverified", user: accountUser }))

    await renderPage()

    expect(routerHolder.router.replace).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="account-form"]')?.textContent).toBe(
      "writer@example.com",
    )
    expect(container.textContent).toContain("offline")
  })
})
