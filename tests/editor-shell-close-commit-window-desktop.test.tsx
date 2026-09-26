/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-405 (cerrar la última pestaña) y ODE-561 — Un documento que el
 * autor cierra no vuelve solo, aunque lo cierre dentro de una ventana de
 * commit, y cerrarlo no consume el borrador que quedaba abierto.
 *
 * Reescrita sobre el harness en ODE-574, desde
 * `tests/editor-empty-draft-persistence.test.tsx`. La prueba antigua cerraba
 * llamando a mano al `onCloseTab` de un topbar falso, desde un layout effect
 * del propio topbar falso. Aquí el cierre es el gesto real sobre el botón de
 * cerrar de la pestaña (`dispatchPointerClick`), disparado desde
 * `world.onShellCommit`: un layout effect de la shell real, que corre tras
 * cada commit suyo y antes de sus efectos pasivos. El documento se crea
 * escribiendo en TipTap real y se materializa en el workspace temporal.
 *
 * Por qué se barren ventanas: el efecto de la shell que publica el estado del
 * documento en su pestaña es pasivo. Un commit con A todavía activo lo deja
 * pendiente; si el autor cierra A en esa ventana, el cierre muta el store
 * directamente y la publicación llega después, con A en su closure. Qué
 * commit carga el efecto rezagado es un detalle de implementación, así que se
 * barren varias. Una ventana que ya no existe falla por timeout en vez de
 * pasar en vacío.
 *
 * Mutation test (ODE-574): quitar el guard de `removedWritingIds` en
 * `publishTabState` (`lib/stores/editor-session-store.ts`) pone en rojo
 * ventanas de ambos escenarios.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("./support/editor-shell-doubles")).nextNavigationDouble(),
)
vi.mock("@tauri-apps/api/event", async () =>
  (await import("./support/editor-shell-doubles")).tauriEventDouble(),
)
vi.mock("@tauri-apps/plugin-dialog", async () =>
  (await import("./support/editor-shell-doubles")).tauriDialogDouble(),
)
vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("./support/editor-shell-doubles")).runtimeDetectionDouble(),
)
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("./support/editor-shell-doubles")).aiServiceDouble(),
)
vi.mock("@tauri-apps/api/path", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/services/desktop/tauri-commands", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriCommandsDouble(),
)
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble(),
)

const {
  advance,
  clickNewArtifact,
  dispatchPointerClick,
  flush,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000
const COMMIT_WINDOWS = [1, 2, 3, 4, 5]
/**
 * Al materializarse la última pestaña, la shell real hace 4 commits con el
 * documento en las pestañas (el topbar falso de la prueba antigua hacía 5).
 */
const LAST_TAB_COMMIT_WINDOWS = [1, 2, 3, 4]

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-close-commit-window-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  // La sesión persistida vive en fake-indexeddb, que el harness no limpia.
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  world.onShellCommit = null
  await mounted?.unmount()
  mounted = null
})

/** Monta la shell y espera a que cargue la sesión (ver ODE-577). */
async function mountLoaded() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  return mounted
}

function tabs() {
  return getEditorSessionState().session.tabs
}

function materializedTab() {
  return tabs().find((tab) => tab.writing_id && tab.writing_id !== EDITOR_DRAFT_TAB_ID) ?? null
}

function closeButtonFor(tabId: string) {
  const button = document
    .querySelector<HTMLElement>(`[data-editor-tab-id="${tabId}"]`)
    ?.querySelector<HTMLElement>('button[aria-label^="Close"]')
  if (!button) throw new Error(`La pestaña ${tabId} no tiene botón de cerrar en el DOM`)
  return button
}

/** Deja que corra todo el trabajo diferido (efectos pasivos, frames, timers cortos). */
async function settleDeferredWork() {
  await advance(500)
}

/**
 * Sonda: cuenta los commits de la shell en los que el documento materializado
 * está en las pestañas y, en el número `targetCommit`, pulsa su botón de
 * cerrar de forma síncrona, dentro de la ventana.
 */
function closeAtCommit(targetCommit: number, pickWritingId: () => string | null) {
  const probe = { armed: false, commits: 0, closed: false, writingId: null as string | null, closedInWindow: false }
  world.onShellCommit = () => {
    if (!probe.armed || probe.closed) return
    const writingId = pickWritingId()
    if (!writingId) return
    const tab = tabs().find((candidate) => candidate.writing_id === writingId)
    if (!tab) return
    probe.commits += 1
    if (probe.commits !== targetCommit) return
    probe.closed = true
    probe.writingId = writingId
    dispatchPointerClick(closeButtonFor(tab.id))
    // Control positivo: el cierre corrió de forma síncrona, dentro de la ventana.
    probe.closedInWindow = !tabs().some((candidate) => candidate.writing_id === writingId)
  }
  return probe
}

describe("ODE-405 — cerrar la última pestaña", () => {
  it(
    "cerrar la última pestaña materializada no crea otra y sigue cerrada",
    async () => {
      // Mutación: en `editor-shell.tsx`, quitar el `return` de la rama
      // `remain-empty` del restore → rojo (al cerrar se abre un borrador de
      // reemplazo).
      await mountLoaded()
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE405-ULTIMA")
      await advance(DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000)
      await waitForMarkdownContaining("ODE405-ULTIMA")
      const tab = await waitFor(() => materializedTab(), { label: "pestaña materializada", timeoutMs: 15_000 })
      expect(tabs(), "control positivo: la pestaña está antes de cerrar").toHaveLength(1)

      await pointerClick(closeButtonFor(tab.id))
      expect(tabs(), "el cierre la quita").toHaveLength(0)

      // Y sigue cerrada cuando todo el trabajo diferido tuvo su turno. Es una
      // espera fija y no un waitFor: la resurrección llega tarde.
      await settleDeferredWork()
      expect(tabs()).toHaveLength(0)
      expect(getEditorSessionState().session.active_tab_id).toBeNull()
      expect(await readWorkspaceMarkdown(), "ningún documento de reemplazo").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-561 — cerrar dentro de una ventana de commit no resucita la pestaña", () => {
  it.each(LAST_TAB_COMMIT_WINDOWS)(
    "última pestaña: cerrada en la ventana %i, sigue cerrada",
    async (targetCommit) => {
      await mountLoaded()
      await clickNewArtifact(mounted!.container)

      const probe = closeAtCommit(targetCommit, () => materializedTab()?.writing_id ?? null)
      probe.armed = true
      await typeInEditor("ODE561-ULTIMA")
      await advance(DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000)
      await waitFor(() => probe.closed, { label: `ventana ${targetCommit}`, timeoutMs: 15_000 })
      expect(probe.closedInWindow, "el cierre corrió dentro de la ventana").toBe(true)
      await settleDeferredWork()

      expect(tabs(), "no vuelve").toHaveLength(0)
      expect(getEditorSessionState().session.active_tab_id).toBeNull()
    },
    TEST_TIMEOUT_MS,
  )

  it.each(COMMIT_WINDOWS)(
    "con un borrador abierto: cerrar A en la ventana %i no trae A de vuelta ni consume el borrador",
    async (targetCommit) => {
      await mountLoaded()
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE561-DOCUMENTO-A")
      await advance(DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000)
      await waitForMarkdownContaining("ODE561-DOCUMENTO-A")
      const a = await waitFor(() => materializedTab(), { label: "A materializado", timeoutMs: 15_000 })
      const writingA = a.writing_id!
      await settleDeferredWork()

      await clickNewArtifact(mounted!.container)
      await waitFor(() => getEditorSessionState().session.active_tab_id === EDITOR_DRAFT_TAB_ID, {
        label: "borrador activo",
      })

      const probe = closeAtCommit(targetCommit, () => writingA)
      probe.armed = true
      const aNode = document.querySelector<HTMLElement>(`[data-editor-tab-id="${a.id}"]`)
      expect(aNode, "la pestaña de A en el DOM").toBeTruthy()
      await pointerClick(aNode!)
      await waitFor(() => probe.closed, { label: `ventana ${targetCommit}`, timeoutMs: 5_000 })
      expect(probe.closedInWindow, "el cierre corrió dentro de la ventana").toBe(true)
      await settleDeferredWork()

      const session = getEditorSessionState().session
      expect(session.tabs.map((tab) => tab.writing_id), "A no vuelve").not.toContain(writingA)
      expect(session.tabs.map((tab) => tab.id), "queda solo el borrador").toEqual([EDITOR_DRAFT_TAB_ID])
      expect(session.active_tab_id, "y es la pestaña activa").toBe(EDITOR_DRAFT_TAB_ID)
    },
    TEST_TIMEOUT_MS,
  )
})
