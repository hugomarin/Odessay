/**
 * @vitest-environment happy-dom
 *
 * ODE-600 — STATE-05 a través de la shell (runtime **desktop**): el borrador
 * nuevo de "New Artifact" nunca hereda el scroll, el cursor ni la selección
 * de otra pestaña, tanto si abre un slot de borrador nuevo como si reutiliza
 * el slot de un borrador en blanco que ya existía.
 *
 * Archivo aparte del de web (`editor-shell-new-tab-clean-view-state.test.tsx`)
 * porque `getDocumentService()` memoiza el runtime en su primera resolución:
 * un mismo archivo no puede montar la shell en los dos modos.
 *
 * Camino de producción:
 *   "New Artifact" del estado vacío → escritura real → materialización real
 *   del `.md` en el workspace temporal (A) → scroll real en los contenedores
 *   que la shell lee y selección con el comando del editor real → "New
 *   Artifact" (la shell guarda el view_state de A al salir) → borrador B.
 * No se siembra `view_state`: lo escribe la propia shell.
 *
 * Completion event: el estado de B se mide después de que la shell aplique la
 * llegada a "sin documento" y sus frames diferidos (el foco va en un
 * `requestAnimationFrame`), no cuando se agendan.
 *
 * Control positivo: volver a A por su pestaña restaura el scroll y la
 * selección de A.
 *
 * Lo que la shell NO hace en desktop, y por qué el scroll se mide distinto
 * que en web: el único lector del `view_state` de una pestaña es la rama que
 * hidrata un documento con identidad (`useDocumentHydration`). La llegada a un
 * borrador (rama "sin documento") vacía el editor y pone el cursor al inicio,
 * pero no escribe el scroll ni lee el `view_state` del slot. En un navegador,
 * el scroll vuelve a 0 porque el contenido vacío ya no da para desplazarse
 * (recorte de layout); happy-dom no tiene layout y conserva el `scrollTop`
 * que tenía A. `modelLayoutClamp()` aplica ese recorte de forma declarada, y
 * lo que se prueba del scroll es que la shell no vuelve a escribir encima el
 * de A — en particular, la restauración diferida de A (caso 3).
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
  assertNoUnhandledErrors,
  clickNewArtifact,
  flush,
  holdAnimationFrames,
  mountEditorShell,
  pointerClick,
  readViewport,
  resetEditorShellWorld,
  scrollViewport,
  typeInEditor,
  waitFor,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEmptyEditorSession, EDITOR_DRAFT_TAB_ID } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000

const TEXT_A = "ODE600 documento A con una frase bastante larga para seleccionar y desplazar."
// Ni el inicio (lo que deja `focus("start")`) ni el final del texto de A.
const SELECTION_A = { from: 13, to: 22 }
const SCROLL_A = { editorScrollTop: 140, shellScrollTop: 60 }

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let frames: ReturnType<typeof holdAnimationFrames> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-new-tab-clean-view-")
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
  frames?.restore()
  frames = null
  await mounted?.unmount()
  mounted = null
})

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

function tabById(tabId: string) {
  return getEditorSessionState().session.tabs.find((tab) => tab.id === tabId)
}

async function clickTab(tabId: string) {
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tabId}"]`)
  if (!node) throw new Error(`La pestaña ${tabId} no está en el DOM`)
  await pointerClick(node)
  if (getEditorSessionState().session.active_tab_id !== tabId) {
    throw new Error(`El gesto sobre la pestaña ${tabId} no la activó`)
  }
}

function currentSelection() {
  const { from, to } = mounted!.editor().state.selection
  return { from, to }
}

/**
 * A: un documento real del workspace, creado como lo crea el usuario
 * ("New Artifact" + escribir), con scroll y selección reales no nulos.
 * Devuelve el id de la pestaña de A.
 */
async function prepareA() {
  mounted = await mountEditorShell({ withAppMain: true })
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  await clickNewArtifact(mounted.container)
  await typeInEditor(TEXT_A)
  const tabA = await waitFor(() => (activeTab()?.writing_id ? activeTab() : null), {
    label: "A se materializa",
    timeoutMs: 20_000,
  })
  await flush(3)
  mounted.editor().commands.setTextSelection(SELECTION_A)
  scrollViewport(SCROLL_A)
  expect(currentSelection()).toEqual(SELECTION_A)
  return tabA.id
}

function expectSavedA(tabAId: string) {
  const savedA = tabById(tabAId)?.view_state
  expect(savedA?.selectionFrom, "la shell guarda la selección de A al salir").toBe(SELECTION_A.from)
  expect(savedA?.selectionTo).toBe(SELECTION_A.to)
  expect(savedA?.scrollTop, "la shell guarda el scroll del editor de A").toBe(SCROLL_A.editorScrollTop)
  expect(savedA?.shellScrollTop, "la shell guarda el scroll de la shell de A").toBe(SCROLL_A.shellScrollTop)
}

/** El borrador B: sin identidad, vacío, activo. */
async function waitForDraftB() {
  const tab = await waitFor(
    () => {
      const current = activeTab()
      return current && current.id === EDITOR_DRAFT_TAB_ID && current.writing_id === null ? current : null
    },
    { label: "borrador B activo" },
  )
  await waitFor(() => mounted!.editor().isEmpty, { label: "B vacío" })
  await flush(4)
  return tab
}

/**
 * El recorte que hace el navegador al vaciar el editor (ver cabecera): un
 * borrador vacío cabe en su contenedor y el `scrollTop` cae a 0. Es layout,
 * un boundary del runtime que happy-dom no reproduce; no es estado de la app.
 */
async function modelLayoutClamp() {
  scrollViewport({ editorScrollTop: 0, shellScrollTop: 0 })
  await flush(4)
}

function expectCleanB(label: string) {
  const stored = tabById(EDITOR_DRAFT_TAB_ID)?.view_state
  expect(stored?.scrollTop ?? 0, `${label}: el slot de B no guarda scroll ajeno`).toBe(0)
  expect(stored?.shellScrollTop ?? 0, `${label}: el slot de B no guarda scroll de shell ajeno`).toBe(0)
  expect(readViewport(), `${label}: B empieza sin scroll`).toEqual({ editorScrollTop: 0, shellScrollTop: 0 })
  const selection = currentSelection()
  expect(selection.from, `${label}: B no hereda la selección de A`).toBe(selection.to)
  expect(selection.from, `${label}: el cursor de B está al inicio`).toBe(1)
}

async function expectARestoresOnReturn(tabAId: string) {
  await clickTab(tabAId)
  await waitFor(() => mounted!.editor().getText().includes("ODE600 documento A"), { label: "A rehidratado" })
  await flush(4)
  expect(currentSelection(), "A recupera su propia selección").toEqual(SELECTION_A)
  expect(readViewport(), "A recupera su propio scroll").toEqual(SCROLL_A)
}

describe("ODE-600 — STATE-05 (desktop): el borrador nuevo empieza limpio", () => {
  it(
    "un slot de borrador nuevo no hereda el scroll, el cursor ni la selección de A",
    async () => {
      const tabAId = await prepareA()
      expect(tabById(EDITOR_DRAFT_TAB_ID), "precondición: no hay slot de borrador que reutilizar").toBeUndefined()

      await clickNewArtifact(mounted!.container)
      expectSavedA(tabAId)
      await waitForDraftB()
      await modelLayoutClamp()
      expectCleanB("borrador nuevo")

      await expectARestoresOnReturn(tabAId)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "reutilizar el slot de un borrador en blanco no le trae el view_state que ese slot tenía",
    async () => {
      // Mutación: revertir ODE-551 en `openDraftTab` (conservar `view_state`
      // al cambiar `draft_writing_id`) → rojo.
      const tabAId = await prepareA()

      // Un borrador en blanco D queda abierto con su propio scroll, y el
      // usuario vuelve a A: la shell guarda el view_state de D en el slot.
      await clickNewArtifact(mounted!.container)
      await waitForDraftB()
      const draftD = tabById(EDITOR_DRAFT_TAB_ID)!.draft_writing_id
      scrollViewport({ editorScrollTop: 0, shellScrollTop: 90 })
      await clickTab(tabAId)
      await waitFor(() => mounted!.editor().getText().includes("ODE600 documento A"), { label: "A rehidratado" })
      await flush(4)
      expect(tabById(EDITOR_DRAFT_TAB_ID)?.view_state?.shellScrollTop, "precondición: el slot guarda el scroll de D").toBe(90)

      // "New Artifact" desde A reutiliza el slot de D con otra identidad.
      await clickNewArtifact(mounted!.container)
      const draftB = await waitForDraftB()
      expect(draftB.draft_writing_id, "el slot tiene una identidad nueva").not.toBe(draftD)
      await modelLayoutClamp()
      expectCleanB("slot reutilizado")

      await expectARestoresOnReturn(tabAId)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "la restauración diferida de A no cae sobre el borrador B si B se crea antes de soltar los frames",
    async () => {
      // Mutación: quitar la guarda de generación (`generation.run`) del
      // restore diferido de rich mode → rojo: los frames de A pisan a B.
      const tabAId = await prepareA()
      await clickNewArtifact(mounted!.container)
      await waitForDraftB()

      // Vuelta a A con los frames retenidos: su restauración queda agendada.
      frames = holdAnimationFrames()
      await clickTab(tabAId)
      await waitFor(() => mounted!.editor().getText().includes("ODE600 documento A"), {
        label: "A rehidratado (frames retenidos)",
      })
      await flush(2)
      expect(frames.pending(), "la restauración de A quedó agendada, sin ejecutar").toBeGreaterThan(0)
      const lateRestoreOfA = frames.takePending()

      await clickNewArtifact(mounted!.container)
      await frames.settleUntil(
        () => activeTab()?.id === EDITOR_DRAFT_TAB_ID && mounted!.editor().isEmpty,
        { label: "borrador B activo y vacío" },
      )
      await frames.settle()
      scrollViewport({ editorScrollTop: 0, shellScrollTop: 0 }) // recorte de layout, ver `modelLayoutClamp`

      // La restauración de A llega TARDE, sobre B ya activo.
      await frames.runCallbacks(lateRestoreOfA)
      await frames.settle()

      // Sin vuelta a A: salir de A antes de su restauración guarda en su
      // pestaña el view_state previo a restaurar (ODE-624, fuera de alcance; ver la
      // nota de la fila STATE-05); el control positivo es el caso 1.
      expectCleanB("borrador con frames de A retenidos")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})
