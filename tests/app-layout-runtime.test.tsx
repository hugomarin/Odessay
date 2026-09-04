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
const VOCABULARY_BRIDGE_MARKER = function VocabularyCatalogBridge() {
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

vi.mock("@/components/vocabulary/vocabulary-provider", () => ({
  VocabularyCatalogBridge: VOCABULARY_BRIDGE_MARKER,
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

/** `UserSettingsProvider` now also mounts `VocabularyCatalogBridge` as a sibling (ODE-474), so its children are an array, not a single element. */
const findChildOfType = (children: ReactElement | ReactElement[], type: unknown): ReactElement => {
  const list = Array.isArray(children) ? children : [children]
  const found = list.find((child) => child?.type === type)
  if (!found) throw new Error("Expected child not found among UserSettingsProvider's children")
  return found
}

const getSidebarElement = (root: ReactElement): ReactElement => {
  expect(root.type).toBe(USER_SETTINGS_MARKER)
  const children = (root.props as { children: ReactElement | ReactElement[] }).children
  expect(findChildOfType(children, VOCABULARY_BRIDGE_MARKER)).toBeTruthy()
  return findChildOfType(children, SIDEBAR_MARKER)
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
      const children = (element.props as { children: ReactElement | ReactElement[] }).children
      expect(findChildOfType(children, VOCABULARY_BRIDGE_MARKER)).toBeTruthy()
      const shell = findChildOfType(children, DESKTOP_APP_SHELL_MARKER)

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
      const children = (element.props as { children: ReactElement | ReactElement[] }).children
      expect(findChildOfType(children, VOCABULARY_BRIDGE_MARKER)).toBeTruthy()
      const shell = findChildOfType(children, DESKTOP_APP_SHELL_MARKER)

      expect(cookiesMock).not.toHaveBeenCalled()
      expect(createSupabaseServerMock).not.toHaveBeenCalled()
      expect(supabaseGetUserMock).not.toHaveBeenCalled()
      expect(redirectMock).not.toHaveBeenCalled()
    })
  })
})
