/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-540 — a retained Source survives route changes and the
 * app-lifetime desktop shell guards a window close away from `/write`.
 */
import type { ReactNode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const closeState = vi.hoisted(() => ({
  listeners: [] as Array<(event: { preventDefault: () => void }) => Promise<void> | void>,
  destroyCalls: 0,
}))
const mockRouter = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}))
vi.mock("@/components/navigation/sidebar", () => ({
  Sidebar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/hooks/useGlobalOpenFileMenu", () => ({ useGlobalOpenFileMenu: () => {} }))
vi.mock("@/hooks/useWorkspaceReconciler", () => ({ useWorkspaceReconciler: () => {} }))
vi.mock("@/hooks/useCatalogEditorSessionSync", () => ({ useCatalogEditorSessionSync: () => {} }))
vi.mock("@/lib/services/desktop/runtime-detection", () => ({ isDesktopRuntime: () => true }))
vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}))
vi.mock("@/lib/services/auth-service-factory", () => ({
  getAuthService: () => ({
    getSession: async () => ({
      data: {
        user: {
          id: "ode540-source-close-user",
          email: null,
          displayName: null,
          username: null,
        },
      },
      error: null,
    }),
  }),
}))
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    return {
      onCloseRequested: async (
        listener: (event: { preventDefault: () => void }) => Promise<void> | void,
      ) => {
        closeState.listeners.push(listener)
        return () => {
          closeState.listeners = closeState.listeners.filter((registered) => registered !== listener)
        }
      },
      destroy: async () => {
        closeState.destroyCalls += 1
      },
    }
  },
}))

const {
  DesktopAppShell,
  shouldHandleRetainedSourceWindowClose,
} = await import("@/components/navigation/desktop-app-shell")
const {
  getRetainedUnconvertedSource,
  retainUnconvertedSource,
  resetEditorSessionStoreForTests,
} = await import("@/lib/stores/editor-session-store")
const { hasActiveEditorCloseGuard, useTauriCloseGuard } = await import("@/hooks/useTauriCloseGuard")

let root: Root | null = null
let container: HTMLDivElement | null = null

function RegisteredEditorCloseGuard() {
  useTauriCloseGuard(async () => false)
  return null
}

async function mountDesktopAppShell() {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <DesktopAppShell>
        <div data-testid="route-content">Current route</div>
      </DesktopAppShell>,
    )
  })

  for (let attempt = 0; attempt < 20 && closeState.listeners.length === 0; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  if (closeState.listeners.length === 0) throw new Error("DesktopAppShell did not register the Tauri close listener")
}

async function requestWindowClose() {
  if (closeState.listeners.length === 0) throw new Error("No desktop close listener is registered")
  let prevented = false
  let settled: Promise<void> = Promise.resolve()
  await act(async () => {
    const event = {
      preventDefault: () => {
        prevented = true
      },
    }
    settled = Promise.all(
      closeState.listeners.map((listener) => Promise.resolve(listener(event))),
    ).then(() => undefined)
    await Promise.resolve()
  })
  return { prevented, settled }
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  closeState.listeners = []
  closeState.destroyCalls = 0
  resetEditorSessionStoreForTests()
  window.history.replaceState({}, "", "/desk")
})

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount())
    root = null
  }
  container?.remove()
  container = null
  closeState.listeners = []
  resetEditorSessionStoreForTests()
})

describe("ODE-540 — ventana desde rutas fuera de Write", () => {
  it("pide confirmación para Source retenido y descarta solo tras Close anyway", async () => {
    const writingId = "ode540-retained-source-close"
    retainUnconvertedSource(writingId, "exact unconverted Source")
    await mountDesktopAppShell()

    window.history.replaceState({}, "", "/desk")
    const close = await requestWindowClose()
    expect(close.prevented, "la guardia global intercepta el cierre con Source retenido").toBe(true)

    const warning = document.querySelector<HTMLElement>(
      '[role="alertdialog"][aria-label="Unsaved Source changes"]',
    )
    expect(warning?.textContent).toContain("You have unsaved changes in Source that couldn't be converted")
    const keepEditing = Array.from(warning?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (button) => button.textContent?.trim() === "Keep editing",
    )
    const closeAnyway = Array.from(warning?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (button) => button.textContent?.trim() === "Close anyway",
    )
    expect(keepEditing).toBeTruthy()
    expect(closeAnyway).toBeTruthy()
    expect(document.activeElement, "Keep editing sigue siendo la opción predeterminada").toBe(keepEditing)

    await act(async () => closeAnyway!.click())
    await close.settled

    expect(closeState.destroyCalls).toBe(1)
    expect(getRetainedUnconvertedSource(writingId), "la confirmación explícita limpia el Source retenido").toBeNull()
  })

  it("no intercepta el cierre si no hay Source retenido", async () => {
    await mountDesktopAppShell()

    const close = await requestWindowClose()

    expect(close.prevented, "el control positivo deja pasar el cierre nativo").toBe(false)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(closeState.destroyCalls).toBe(0)
  })

  it("deja el cierre de /write al guard de EditorShell", async () => {
    const writingId = "ode540-retained-source-write-route"
    retainUnconvertedSource(writingId, "exact unconverted Source")
    await mountDesktopAppShell()
    window.history.replaceState({}, "", "/write?id=ode540-retained-source-write-route")

    const close = await requestWindowClose()

    expect(close.prevented, "el guard persistente no duplica la confirmación de EditorShell").toBe(false)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(getRetainedUnconvertedSource(writingId)).toBe("exact unconverted Source")
  })

  it("cede al guard de EditorShell si sigue activo durante el cambio de ruta", async () => {
    const writingId = "ode540-retained-source-transition"
    retainUnconvertedSource(writingId, "exact unconverted Source")
    expect(shouldHandleRetainedSourceWindowClose("/desk")).toBe(true)
    expect(shouldHandleRetainedSourceWindowClose("/write")).toBe(false)

    const editorContainer = document.createElement("div")
    document.body.appendChild(editorContainer)
    const editorRoot = createRoot(editorContainer)
    await act(async () => editorRoot.render(<RegisteredEditorCloseGuard />))

    expect(hasActiveEditorCloseGuard()).toBe(true)
    expect(
      shouldHandleRetainedSourceWindowClose("/desk"),
      "el guard de app deja pasar el evento mientras el editor aún posee su guard",
    ).toBe(false)

    await act(async () => editorRoot.unmount())
    editorContainer.remove()
    expect(hasActiveEditorCloseGuard()).toBe(false)
    expect(shouldHandleRetainedSourceWindowClose("/desk")).toBe(true)
  })
})
