/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactElement } from "react"

const cookiesMock = vi.fn()
const redirectMock = vi.fn(() => {
  throw new Error("NEXT_REDIRECT")
})
const supabaseGetUserMock = vi.fn()
const supabaseProfileMaybeSingleMock = vi.fn()
const createSupabaseServerMock = vi.fn()

const SIDEBAR_MARKER = function Sidebar() {
  return null
}
const USER_SETTINGS_MARKER = function UserSettingsProvider() {
  return null
}
const DESKTOP_APP_SHELL_MARKER = function DesktopAppShell() {
  return null
}

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: createSupabaseServerMock,
}))

vi.mock("@/components/navigation/sidebar", () => ({
  Sidebar: SIDEBAR_MARKER,
}))

vi.mock("@/components/navigation/desktop-app-shell", () => ({
  DesktopAppShell: DESKTOP_APP_SHELL_MARKER,
}))

vi.mock("@/components/settings/user-settings-provider", () => ({
  UserSettingsProvider: USER_SETTINGS_MARKER,
}))

const buildSupabaseClient = (user: { id: string; email: string } | null) => {
  supabaseGetUserMock.mockResolvedValue({ data: { user } })
  supabaseProfileMaybeSingleMock.mockResolvedValue({
    data: user ? { display_name: "Hugo", username: "hugo" } : null,
  })
  return {
    auth: { getUser: supabaseGetUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: supabaseProfileMaybeSingleMock,
        }),
      }),
    }),
  }
}

const loadLayout = async () => {
  vi.resetModules()
  const mod = await import("@/app/(app)/layout")
  return mod.default
}

const getSidebarElement = (root: ReactElement): ReactElement => {
  expect(root.type).toBe(USER_SETTINGS_MARKER)
  const sidebar = (root.props as { children: ReactElement }).children
  expect(sidebar.type).toBe(SIDEBAR_MARKER)
  return sidebar
}

describe("app/(app)/layout runtime split", () => {
  beforeEach(() => {
    cookiesMock.mockReset()
    redirectMock.mockClear()
    supabaseGetUserMock.mockReset()
    supabaseProfileMaybeSingleMock.mockReset()
    createSupabaseServerMock.mockReset()
    cookiesMock.mockResolvedValue({ get: () => undefined })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe("web build (TAURI_BUILD unset)", () => {
    beforeEach(() => {
      vi.stubEnv("TAURI_BUILD", "")
    })

    it("redirects unauthenticated users to /login", async () => {
      createSupabaseServerMock.mockResolvedValue(buildSupabaseClient(null))
      const AppLayout = await loadLayout()

      await expect(AppLayout({ children: "child" })).rejects.toThrow("NEXT_REDIRECT")
      expect(redirectMock).toHaveBeenCalledWith("/login")
      expect(supabaseGetUserMock).toHaveBeenCalled()
    })

    it("renders Sidebar with profile data when authenticated", async () => {
      createSupabaseServerMock.mockResolvedValue(
        buildSupabaseClient({ id: "user-1", email: "h@example.com" }),
      )
      const AppLayout = await loadLayout()

      const element = (await AppLayout({ children: "child" })) as ReactElement
      const sidebar = getSidebarElement(element)
      const props = sidebar.props as {
        user: { email: string | null; displayName: string | null; username: string | null }
      }
      expect(props.user).toEqual({
        email: "h@example.com",
        displayName: "Hugo",
        username: "hugo",
      })
      expect(redirectMock).not.toHaveBeenCalled()
    })
  })

  describe("tauri build (TAURI_BUILD=true)", () => {
    beforeEach(() => {
      vi.stubEnv("TAURI_BUILD", "true")
    })

    it("renders DesktopAppShell and never touches cookies or supabase server", async () => {
      const AppLayout = await loadLayout()

      const element = (await AppLayout({ children: "child" })) as ReactElement
      expect(element.type).toBe(USER_SETTINGS_MARKER)
      const shell = (element.props as { children: ReactElement }).children
      expect(shell.type).toBe(DESKTOP_APP_SHELL_MARKER)

      expect(cookiesMock).not.toHaveBeenCalled()
      expect(createSupabaseServerMock).not.toHaveBeenCalled()
      expect(supabaseGetUserMock).not.toHaveBeenCalled()
      expect(redirectMock).not.toHaveBeenCalled()
    })
  })

  describe("tauri dev (TAURI_ENV=true)", () => {
    beforeEach(() => {
      vi.stubEnv("TAURI_BUILD", "")
      vi.stubEnv("TAURI_ENV", "true")
    })

    it("renders DesktopAppShell and never touches cookies or supabase server", async () => {
      const AppLayout = await loadLayout()

      const element = (await AppLayout({ children: "child" })) as ReactElement
      expect(element.type).toBe(USER_SETTINGS_MARKER)
      const shell = (element.props as { children: ReactElement }).children
      expect(shell.type).toBe(DESKTOP_APP_SHELL_MARKER)

      expect(cookiesMock).not.toHaveBeenCalled()
      expect(createSupabaseServerMock).not.toHaveBeenCalled()
      expect(supabaseGetUserMock).not.toHaveBeenCalled()
      expect(redirectMock).not.toHaveBeenCalled()
    })
  })
})
