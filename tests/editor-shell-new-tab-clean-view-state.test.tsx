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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
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
  flush,
  holdAnimationFrames,
  mountEditorShell,
  pointerClick,
  readViewport,
  resetEditorShellWorld,
  scrollViewport,
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
  mounted.editor().commands.setTextSelection(SELECTION_A)
  scrollViewport(SCROLL_A)
  expect(currentSelection()).toEqual(SELECTION_A)
  expect(readViewport()).toEqual(SCROLL_A)
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
