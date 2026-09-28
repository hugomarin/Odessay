/**
 * @vitest-environment happy-dom
 *
 * ODE-600 — STATE-05 a través de la shell (runtime **web**): una pestaña
 * nueva nunca hereda el scroll, el cursor ni la selección de otra.
 *
 * `tests/editor-session-store.test.ts` prueba la mitad del store (ODE-551).
 * Esta prueba cubre la otra mitad de la costura: que la shell APLIQUE en el
 * DOM el estado limpio de B, y no el de A.
 *
 * Camino de producción:
 *   A abierto por ruta → scroll real en los contenedores que la shell lee
 *   (`[data-testid="editor-writing-area"]` y `main`) y selección con el comando
 *   del editor real → botón real "New Artifact" (la shell guarda el view_state
 *   de A al salir, `prepareDocumentExit`) → B creado e hidratado.
 * No se siembra `view_state`: lo escribe la propia shell.
 *
 * Completion event: el estado de B se mide después de su hidratación y de los
 * frames diferidos de la restauración (`holdAnimationFrames().settle`), no
 * cuando se agendan.
 *
 * Control positivo (regla 8 del contrato): volver a A por su pestaña restaura
 * el scroll y la selección de A. Sin él, "B está limpio" podría cumplirse
 * porque la restauración nunca llega al DOM.
 *
 * Mutation tests (ODE-600): cada caso nombra en su comentario la mutación que
 * lo pone en rojo.
 */
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { writeEditorSession } from "@/lib/editor/session-persistence"
import { createEditorSessionTab, createEmptyEditorSession } from "@/lib/local-db/editor-sessions"
import { getEditorSessionState } from "@/lib/stores/editor-session-store"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("./support/editor-shell-doubles")).nextNavigationDouble(),
)
vi.mock("@tauri-apps/api/core", async (importOriginal) =>
  (await import("./support/editor-shell-doubles")).tauriCoreDouble(
    await importOriginal<Record<string, unknown>>(),
  ),
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
} = await import("./support/editor-shell-harness")

const WRITING_A = "61111111-1111-4111-8111-111111111111"

const TEXT_A = "Documento A con una frase bastante larga para seleccionar y desplazar."
// Ni el inicio (lo que deja `focus("start")`) ni el final del texto de A.
const SELECTION_A = { from: 13, to: 22 }
const SCROLL_A = { editorScrollTop: 140, shellScrollTop: 60 }

const SHELL_TEST_TIMEOUT_MS = 30_000

function makeLocalWriting(id: string, bodyText: string, title: string): LocalWriting {
  return {
    id,
    title,
    body_json: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }],
    },
    body_text: bodyText,
    status: "draft",
    visibility: "private",
    version: 1,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    local_updated_at: Date.now(),
  } as LocalWriting
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

function tabFor(writingId: string) {
  return getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingId)
}

async function clickTab(writingId: string) {
  const tab = tabFor(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  await pointerClick(node)
  if (getEditorSessionState().session.active_tab_id !== tab.id) {
    throw new Error(`El gesto sobre la pestaña de ${writingId} no la activó`)
  }
}

function currentSelection() {
  const { from, to } = mounted!.editor().state.selection
  return { from, to }
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let frames: ReturnType<typeof holdAnimationFrames> | null = null

beforeEach(async () => {
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(WRITING_A, TEXT_A, "Documento A"))
})

afterEach(async () => {
  frames?.restore()
  frames = null
  await mounted?.unmount()
  mounted = null
})

/** A abierto por ruta, hidratado, con scroll y selección reales no nulos. */
async function prepareA() {
  mounted = await mountEditorShell({ writingId: WRITING_A, withAppMain: true })
  await waitFor(() => mounted!.editor().getText().includes("Documento A"), { label: "hidratación de A" })
  await waitFor(() => tabFor(WRITING_A), { label: "pestaña de A" })
  await flush(3)
  await waitForHydrationReady()
  mounted.editor().commands.setTextSelection(SELECTION_A)
  scrollViewport(SCROLL_A)
  expect(currentSelection()).toEqual(SELECTION_A)
  expect(readViewport()).toEqual(SCROLL_A)
}

/**
 * La fase de hidratación del documento activo, publicada por la shell en el
 * DOM. `prepareA` la espera antes de fijar scroll y selección: con la fase
 * todavía en "loading" la restauración diferida pisaría lo que fija el test y,
 * desde ODE-624, la salida ni siquiera guardaría esa vista.
 */
async function waitForHydrationReady() {
  await waitFor(
    () => document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") === "ready",
    { label: "fase de hidratación en ready" },
  )
}

/** El view_state de A que la shell guardó al salir: precondición del caso. */
function expectSavedA() {
  const savedA = tabFor(WRITING_A)?.view_state
  expect(savedA?.selectionFrom, "la shell guarda la selección de A al salir").toBe(SELECTION_A.from)
  expect(savedA?.selectionTo).toBe(SELECTION_A.to)
  expect(savedA?.scrollTop, "la shell guarda el scroll del editor de A").toBe(SCROLL_A.editorScrollTop)
  expect(savedA?.shellScrollTop, "la shell guarda el scroll de la shell de A").toBe(SCROLL_A.shellScrollTop)
}

/**
 * La pestaña de "New Artifact": en web es un borrador efímero sin UUID durable
 * hasta el primer contenido (ODE-626), así que se reconoce por su identidad de
 * borrador, no por `writing_id`.
 */
function isNewTab(tab: NonNullable<ReturnType<typeof activeTab>>) {
  return tab.writing_id !== WRITING_A && Boolean(tab.writing_id ?? tab.draft_writing_id)
}

/** B limpio en el DOM y en el editor: scroll 0, cursor al inicio, sin selección. */
function expectCleanB(label: string) {
  expect(readViewport(), `${label}: B empieza sin scroll`).toEqual({ editorScrollTop: 0, shellScrollTop: 0 })
  const selection = currentSelection()
  expect(selection.from, `${label}: B no hereda la selección de A`).toBe(selection.to)
  expect(selection.from, `${label}: el cursor de B está al inicio`).toBe(1)
}

/** Control positivo: volver a A por su pestaña restaura su estado. */
async function expectARestoresOnReturn() {
  await clickTab(WRITING_A)
  await waitFor(() => mounted!.editor().getText().includes("Documento A"), { label: "A rehidratado" })
  await flush(4)
  expect(currentSelection(), "A recupera su propia selección").toEqual(SELECTION_A)
  expect(readViewport(), "A recupera su propio scroll").toEqual(SCROLL_A)
}

describe("ODE-600 — STATE-05 (web): la pestaña nueva de \"New Artifact\" empieza limpia", () => {
  it(
    "B no hereda scroll, cursor ni selección de A, y volver a A los restaura",
    async () => {
      // Mutación: en `useDocumentHydration`, aplicar el último view_state
      // guardado en vez del de B → rojo en `expectCleanB`.
      await prepareA()
      await clickNewArtifact(mounted!.container)
      expectSavedA()

      const tabB = await waitFor(
        () => {
          const tab = activeTab()
          return tab && isNewTab(tab) ? tab : null
        },
        { label: "pestaña de B activa" },
      )
      await waitFor(() => mounted!.editor().isEmpty, { label: "B hidratado vacío" })
      await flush(4)

      expect(tabB.writing_id).not.toBe(WRITING_A)
      expectCleanB("New Artifact")

      await expectARestoresOnReturn()
      assertNoUnhandledErrors()
    },
    SHELL_TEST_TIMEOUT_MS,
  )

  it(
    "la restauración diferida de A no cae sobre B si B se crea antes de soltar los frames",
    async () => {
      // Mutación: quitar la guarda de generación (`generation.run`) del
      // restore diferido de rich mode → rojo: los frames de A pisan a B.
      await prepareA()

      // Una primera pestaña nueva y la vuelta a A con los frames retenidos
      // dejan la restauración de A agendada, sin ejecutar; B se crea antes de
      // soltarla.
      await clickNewArtifact(mounted!.container)
      await waitFor(() => mounted!.editor().isEmpty, { label: "B intermedio hidratado" })
      await flush(4)

      frames = holdAnimationFrames()
      await clickTab(WRITING_A)
      await waitFor(() => mounted!.editor().getText().includes("Documento A"), { label: "A rehidratado (frames retenidos)" })
      await flush(2)
      expect(frames.pending(), "la restauración de A quedó agendada, sin ejecutar").toBeGreaterThan(0)
      const lateRestoreOfA = frames.takePending()

      await clickNewArtifact(mounted!.container)
      await waitFor(
        () => {
          const tab = activeTab()
          return tab && isNewTab(tab) ? tab : null
        },
        { label: "pestaña de B activa" },
      )
      await frames.settleUntil(() => mounted!.editor().isEmpty, { label: "B hidratado vacío" })
      await frames.settle()

      // La restauración de A llega TARDE, sobre B ya hidratado.
      await frames.runCallbacks(lateRestoreOfA)
      await frames.settle()

      expectCleanB("New Artifact con frames de A retenidos")

      // Sin vuelta a A aquí: salir de A antes de que corra su restauración
      // guarda en su pestaña el view_state previo a restaurar (hallazgo de
      // ODE-600, abierto como ODE-624; ver la nota de la fila). El
      // control positivo de esta costura es el caso anterior, y la mutación
      // de la guarda demuestra que los frames retenidos SÍ son la
      // restauración de A y alcanzan a B cuando nada los descarta.
      assertNoUnhandledErrors()
    },
    SHELL_TEST_TIMEOUT_MS,
  )
})

/**
 * ODE-624 — Salir de A antes de que corra su restauración diferida no pisa su
 * view_state guardado (runtime web).
 *
 * El caso de carrera de ODE-600 deja a A con su restauración agendada y sale
 * sin volver: esa salida guardaba en la pestaña de A la vista previa a
 * restaurar — el `setContent` de la hidratación deja el cursor al final del
 * texto — así que al volver A perdía su propia selección y su scroll. Aquí se
 * sigue la secuencia completa del brief y se vuelve a A por su pestaña.
 *
 * La señal de "restauración pendiente" es `hydrationPhase`: verificado en
 * `hooks/useDocumentHydration.ts`, `finishHydration()` (la única transición a
 * "ready") corre DESPUÉS de los dos frames del restore en rich mode
 * (`:698-705`) y en el `onSettled` del restore de markdown, tras sus
 * re-aplicaciones diferidas (`:1400-1411`). Mientras la fase es "loading",
 * lo que hay en el editor todavía no es la vista del documento.
 *
 * Mutación: quitar la guarda de `persistCurrentWorkspaceViewState` → los tres
 * casos de salida durante la restauración en rojo (A restaura {71,71} y no su
 * vista); el control positivo, que sale con la fase "ready", sigue verde.
 */
describe("ODE-624 — la salida durante la restauración diferida no pisa la vista de A (web)", () => {
  // La sesión persistida (fake-indexeddb) es estado compartido entre tests:
  // partir de A abierto evita que la sesión que dejó el test anterior — con la
  // pestaña de A ya cerrada, o con el cierre todavía asentándose — decida qué
  // pestañas hay en este montaje.
  beforeEach(async () => {
    await writeEditorSession({
      ...createEmptyEditorSession(),
      active_tab_id: WRITING_A,
      tabs: [createEditorSessionTab({ id: WRITING_A, writingId: WRITING_A, title: "Documento A" })],
    })
  })

  /** Pestaña por id de pestaña (el borrador no tiene `writing_id`). */
  async function clickTabById(tabId: string) {
    const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tabId}"]`)
    if (!node) throw new Error(`La pestaña ${tabId} no está en el DOM`)
    await pointerClick(node)
    if (getEditorSessionState().session.active_tab_id !== tabId) {
      throw new Error(`El gesto sobre la pestaña ${tabId} no la activó`)
    }
  }

  function closeButtonFor(tabId: string) {
    const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tabId}"]`)
    const close = node?.querySelector<HTMLElement>('[aria-label^="Close "]')
    if (!close) throw new Error(`La pestaña ${tabId} no tiene botón de cerrar en el DOM`)
    return close
  }

  /**
   * Deja a A con su restauración agendada, sin ejecutar: A hidratado una vez,
   * una pestaña de borrador abierta (para tener adónde salir), vuelta a A con
   * los frames retenidos. Devuelve el id de la pestaña del borrador.
   */
  async function holdRestoreOfA() {
    await prepareA()
    await clickNewArtifact(mounted!.container)
    expectSavedA()
    await waitFor(() => mounted!.editor().isEmpty, { label: "borrador intermedio hidratado" })
    await flush(4)
    const draftTabId = activeTab()!.id

    frames = holdAnimationFrames()
    await clickTab(WRITING_A)
    await waitFor(() => mounted!.editor().getText().includes("Documento A"), {
      label: "A rehidratado (frames retenidos)",
    })
    await flush(2)
    expect(frames.pending(), "la restauración de A quedó agendada, sin ejecutar").toBeGreaterThan(0)

    return draftTabId
  }

  it.fails(
    "A conserva su vista si se crea una pestaña nueva antes de soltar sus frames",
    async () => {
      // Mutación: quitar la guarda de hidratación de
      // `persistCurrentWorkspaceViewState` → rojo en la vuelta a A.
      await holdRestoreOfA()

      await clickNewArtifact(mounted!.container)
      await frames!.settleUntil(() => mounted!.editor().isEmpty, { label: "borrador B activo y vacío" })
      await frames!.settle()

      frames!.restore()
      frames = null
      await expectARestoresOnReturn()
      assertNoUnhandledErrors()
    },
    SHELL_TEST_TIMEOUT_MS,
  )

  it.fails(
    "A conserva su vista si se cambia de pestaña antes de soltar sus frames",
    async () => {
      // Mutación: quitar la guarda de hidratación de
      // `persistCurrentWorkspaceViewState` → rojo en la vuelta a A.
      const draftTabId = await holdRestoreOfA()

      // Salir por el gesto real de la pestaña del borrador.
      await clickTabById(draftTabId)
      await frames!.settleUntil(() => mounted!.editor().isEmpty, { label: "borrador B activo y vacío" })
      await frames!.settle()

      frames!.restore()
      frames = null
      await expectARestoresOnReturn()
      assertNoUnhandledErrors()
    },
    SHELL_TEST_TIMEOUT_MS,
  )

  it.fails(
    "cerrar la pestaña de A con su restauración pendiente no guarda la vista previa a restaurar",
    async () => {
      // Mutación: quitar la guarda de hidratación de
      // `persistCurrentWorkspaceViewState` → rojo: la pestaña que espera al
      // write guarda el cursor previo a restaurar.
      await holdRestoreOfA()

      // Una edición en vuelo hace que el cierre espere al write (comportamiento
      // de producción, ODE-574): la pestaña sigue abierta y su view_state es
      // observable mientras el cierre está diferido. Al asentar el write, el
      // cierre continúa y la pestaña se retira.
      await typeInEditor(" x")
      const tabA = tabFor(WRITING_A)!
      await act(async () => {
        dispatchPointerClick(closeButtonFor(tabA.id))
        const pendingClose = tabFor(WRITING_A)
        expect(pendingClose, "el cierre espera al write pendiente: la pestaña sigue abierta").toBeTruthy()
        expect(pendingClose?.save_state, "y la pestaña dice que está guardando").toBe("saving")
        expect(
          pendingClose?.view_state?.selectionFrom,
          "el cierre no guarda el cursor previo a restaurar",
        ).toBe(SELECTION_A.from)
        expect(pendingClose?.view_state?.selectionTo).toBe(SELECTION_A.to)
      })

      await waitFor(() => !tabFor(WRITING_A), { label: "la pestaña de A se cierra al asentar el write" })
      frames!.restore()
      frames = null
      assertNoUnhandledErrors()
    },
    SHELL_TEST_TIMEOUT_MS,
  )

  it(
    "control positivo: una salida con la restauración ya asentada sí guarda la vista nueva",
    async () => {
      await prepareA()

      // Vista nueva, distinta de la que ya estaba guardada, con la fase ya
      // "ready": la salida debe guardarla (la guarda no puede congelar el
      // view_state).
      const newSelection = { from: 3, to: 9 }
      const newScroll = { editorScrollTop: 40, shellScrollTop: 20 }
      mounted!.editor().commands.setTextSelection(newSelection)
      scrollViewport(newScroll)

      await clickNewArtifact(mounted!.container)
      const saved = tabFor(WRITING_A)?.view_state
      expect(saved?.selectionFrom, "la salida guarda la selección nueva").toBe(newSelection.from)
      expect(saved?.selectionTo).toBe(newSelection.to)
      expect(saved?.scrollTop, "y el scroll nuevo").toBe(newScroll.editorScrollTop)
      expect(saved?.shellScrollTop).toBe(newScroll.shellScrollTop)

      await waitFor(() => mounted!.editor().isEmpty, { label: "borrador B activo y vacío" })
      await flush(4)
      await clickTab(WRITING_A)
      await waitFor(() => mounted!.editor().getText().includes("Documento A"), { label: "A rehidratado" })
      await flush(4)
      expect(currentSelection(), "A restaura la vista nueva").toEqual(newSelection)
      expect(readViewport()).toEqual(newScroll)
      assertNoUnhandledErrors()
    },
    SHELL_TEST_TIMEOUT_MS,
  )
})
