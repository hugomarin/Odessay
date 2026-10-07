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
 * Owner del scroll del borrador (compartido web/desktop): la llegada a un
 * borrador — rama "sin documento" de `useDocumentHydration` — vacía el editor,
 * pone el cursor al inicio y, desde ODE-626, resetea a 0 el scroll de los dos
 * contenedores que la shell lee (`[data-testid="editor-writing-area"]` y el
 * `<main>` del layout). Esa rama no lee el `view_state` del slot del borrador:
 * el único lector de `view_state` sigue siendo la rama que hidrata un
 * documento con identidad.
 *
 * El scroll se prueba sin modelar layout: happy-dom conserva el `scrollTop`
 * que tenía A, así que B en 0 solo puede venir de ese reset. Mutación: quitar
 * el reset de la rama "sin documento" → los tres casos en rojo (B muestra el
 * scroll 140 de A).
 */
import { act } from "react"
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
  dispatchPointerClick,
  flush,
  holdAnimationFrames,
  mountEditorShell,
  pointerClick,
  readViewport,
  resetEditorShellWorld,
  scrollViewport,
  typeInEditor,
  waitFor,
  waitForHydrationReady,
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
  // Materializar activa el documento ("materialize"), así que su hidratación
  // vuelve a correr; la fase en "ready" es la señal de que A ya está asentado.
  await waitForHydrationReady()
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

/**
 * ODE-624 — Salir de A antes de que corra su restauración diferida no pisa su
 * view_state guardado (runtime desktop).
 *
 * Mismo hallazgo y misma secuencia que el describe de web
 * (`editor-shell-new-tab-clean-view-state.test.tsx`), sobre un documento real
 * del workspace. El caso de carrera de arriba sale de A sin volver; aquí se
 * vuelve y se mide la vista propia de A.
 *
 * Mutación: quitar la guarda de `persistCurrentWorkspaceViewState` → los tres
 * casos de salida durante la restauración en rojo; el control positivo, que
 * sale con la fase "ready", sigue verde.
 */
describe("ODE-624 — la salida durante la restauración diferida no pisa la vista de A (desktop)", () => {
  function closeButtonFor(tabId: string) {
    const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tabId}"]`)
    const close = node?.querySelector<HTMLElement>('[aria-label^="Close "]')
    if (!close) throw new Error(`La pestaña ${tabId} no tiene botón de cerrar en el DOM`)
    return close
  }

  /**
   * Deja a A con su restauración agendada, sin ejecutar: A materializado una
   * vez, un borrador abierto (para tener adónde salir), vuelta a A con los
   * frames retenidos.
   */
  async function holdRestoreOfA() {
    const tabAId = await prepareA()
    await clickNewArtifact(mounted!.container)
    expectSavedA(tabAId)
    await waitForDraftB()
    const draftTabId = tabById(EDITOR_DRAFT_TAB_ID)!.id

    frames = holdAnimationFrames()
    await clickTab(tabAId)
    await waitFor(() => mounted!.editor().getText().includes("ODE600 documento A"), {
      label: "A rehidratado (frames retenidos)",
    })
    await flush(2)
    expect(frames.pending(), "la restauración de A quedó agendada, sin ejecutar").toBeGreaterThan(0)

    return { tabAId, draftTabId }
  }

  it(
    "A conserva su vista si se crea una pestaña nueva antes de soltar sus frames",
    async () => {
      // Mutación: quitar la guarda de hidratación de
      // `persistCurrentWorkspaceViewState` → rojo en la vuelta a A.
      const { tabAId } = await holdRestoreOfA()

      await clickNewArtifact(mounted!.container)
      await frames!.settleUntil(
        () => activeTab()?.id === EDITOR_DRAFT_TAB_ID && mounted!.editor().isEmpty,
        { label: "borrador B activo y vacío" },
      )
      await frames!.settle()

      frames!.restore()
      frames = null
      await expectARestoresOnReturn(tabAId)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "A conserva su vista si se cambia de pestaña antes de soltar sus frames",
    async () => {
      // Mutación: quitar la guarda de hidratación de
      // `persistCurrentWorkspaceViewState` → rojo en la vuelta a A.
      const { tabAId, draftTabId } = await holdRestoreOfA()

      // Salir por el gesto real de la pestaña del borrador.
      await clickTab(draftTabId)
      await frames!.settleUntil(
        () => activeTab()?.id === EDITOR_DRAFT_TAB_ID && mounted!.editor().isEmpty,
        { label: "borrador B activo y vacío" },
      )
      await frames!.settle()

      frames!.restore()
      frames = null
      await expectARestoresOnReturn(tabAId)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "cerrar la pestaña de A con su restauración pendiente no guarda la vista previa a restaurar",
    async () => {
      // Mutación: quitar la guarda de hidratación de
      // `persistCurrentWorkspaceViewState` → rojo: la pestaña que espera al
      // write guarda el cursor previo a restaurar.
      const { tabAId } = await holdRestoreOfA()

      // Una edición en vuelo hace que el cierre espere al write (comportamiento
      // de producción, ODE-574): la pestaña sigue abierta y su view_state es
      // observable mientras el cierre está diferido. Al asentar el write, el
      // cierre continúa y la pestaña se retira.
      await typeInEditor(" x")
      await act(async () => {
        dispatchPointerClick(closeButtonFor(tabAId))
        const pendingClose = tabById(tabAId)
        expect(pendingClose, "el cierre espera al write pendiente: la pestaña sigue abierta").toBeTruthy()
        expect(pendingClose?.save_state, "y la pestaña dice que está guardando").toBe("saving")
        expect(
          pendingClose?.view_state?.selectionFrom,
          "el cierre no guarda el cursor previo a restaurar",
        ).toBe(SELECTION_A.from)
        expect(pendingClose?.view_state?.selectionTo).toBe(SELECTION_A.to)
      })

      await waitFor(() => !tabById(tabAId), { label: "la pestaña de A se cierra al asentar el write" })
      frames!.restore()
      frames = null
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "control positivo: una salida con la restauración ya asentada sí guarda la vista nueva",
    async () => {
      const tabAId = await prepareA()

      // Vista nueva, distinta de la que ya estaba guardada, con la fase ya
      // "ready": la salida debe guardarla (la guarda no puede congelar el
      // view_state).
      const newSelection = { from: 3, to: 9 }
      const newScroll = { editorScrollTop: 40, shellScrollTop: 20 }
      mounted!.editor().commands.setTextSelection(newSelection)
      scrollViewport(newScroll)

      await clickNewArtifact(mounted!.container)
      const saved = tabById(tabAId)?.view_state
      expect(saved?.selectionFrom, "la salida guarda la selección nueva").toBe(newSelection.from)
      expect(saved?.selectionTo).toBe(newSelection.to)
      expect(saved?.scrollTop, "y el scroll nuevo").toBe(newScroll.editorScrollTop)
      expect(saved?.shellScrollTop).toBe(newScroll.shellScrollTop)

      await waitForDraftB()
      await clickTab(tabAId)
      await waitFor(() => mounted!.editor().getText().includes("ODE600 documento A"), { label: "A rehidratado" })
      await flush(4)
      expect(currentSelection(), "A restaura la vista nueva").toEqual(newSelection)
      expect(readViewport()).toEqual(newScroll)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})
