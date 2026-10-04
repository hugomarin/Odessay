/**
 * @vitest-environment happy-dom
 *
 * ODE-562 — Caracterización de STATE-07: restaurar la selección al volver.
 *
 * Property: al volver a un documento, su propia selección se restaura — no
 * la del documento de al lado ni el inicio del texto.
 *
 * Por qué existe antes del corte: el código que restaura la selección vive
 * dentro del efecto de hidratación de `editor-shell.tsx`, que ODE-562 muda a
 * un hook. Hasta esta prueba, ningún test lo ejercitaba (STATE-07 = NONE): la
 * mudanza podía romperlo sin que nada se pusiera en rojo.
 *
 * Camino de producción:
 *   A y B abiertos por ruta → clic real (gesto de puntero) en la pestaña de A
 *   → selección en el editor real → clic real en B (el shell guarda el
 *   view_state de A al salir) → selección distinta en B → clic real en A.
 * No se siembra `view_state`: lo escribe el propio shell al cambiar de
 * pestaña. La selección se fija con el comando del editor real, que es el
 * mismo `editor.state.selection` que el shell lee para construir el
 * view_state (el gesto de arrastre del ratón no existe en happy-dom).
 *
 * Completion event: la selección se evalúa tras la hidratación de A y sus
 * frames diferidos (el restore corre dentro de un requestAnimationFrame), no
 * cuando se agendan.
 *
 * Mutation test (ODE-562): quitar `.setTextSelection(...)` del restore en la
 * hidratación la pone en rojo — la selección de A cae al inicio del texto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isMacPlatform } from "@/lib/keyboard-shortcuts"
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
  clickSelectionPopupAction,
  flush,
  holdAnimationFrames,
  mountEditorShell,
  pointerClick,
  readEditorAnnotations,
  readViewport,
  resetEditorShellWorld,
  scrollViewport,
  selectEditorText,
  selectionPopup,
  waitFor,
  waitForAsync,
  waitForHydrationReady,
} = await import("./support/editor-shell-harness")
const { act } = await import("react")

const WRITING_A = "31111111-1111-4111-8111-111111111111"
const WRITING_B = "32222222-2222-4222-8222-222222222222"

const TEXT_A = "Documento A con una frase bastante larga para seleccionar."
const TEXT_B = "Documento B con otro texto."

// Rango a mitad del texto de A: ni el inicio (lo que deja el `focus("start")`
// de la rama sin view_state) ni el final.
const SELECTION_A = { from: 13, to: 22 }
const SELECTION_B = { from: 3, to: 3 }

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

function tabFor(writingId: string) {
  return getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingId)
}

/** Cambia de pestaña con el gesto real y verifica que la activación ocurrió. */
async function clickTab(writingId: string) {
  const tab = tabFor(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  await pointerClick(node)
  const active = getEditorSessionState().session.active_tab_id
  if (active !== tab.id) {
    throw new Error(`El gesto sobre la pestaña de ${writingId} no la activó (activa: ${active})`)
  }
}

function currentSelection() {
  const { from, to } = mounted!.editor().state.selection
  return { from, to }
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeEach(async () => {
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(WRITING_A, TEXT_A, "Documento A"))
  await localDB.writings.save(makeLocalWriting(WRITING_B, TEXT_B, "Documento B"))
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

/* ------------------------------------------------------------------ *
 * Drivers compartidos de los bloques Markdown (ODE-606 y ODE-642)
 * ------------------------------------------------------------------ */

const STATE06_TEXT_A = "Documento A con una frase bastante larga para seleccionar."
const STATE06_TEXT_B = "Documento B con otro texto distinto."

async function openPair(writingA: string, writingB: string) {
  await localDB.writings.save(makeLocalWriting(writingA, STATE06_TEXT_A, "Documento A"))
  await localDB.writings.save(makeLocalWriting(writingB, STATE06_TEXT_B, "Documento B"))
  mounted = await mountEditorShell({ writingId: writingA })
  await waitFor(() => mounted!.editor().getText().includes("Documento A"), { label: "hidratación de A" })
  await mounted.render({ writingId: writingB })
  await waitFor(() => tabFor(writingB), { label: "pestaña de B" })
}

async function activate(writingId: string, marker: string) {
  await clickTab(writingId)
  await waitFor(() => mounted!.editor().getText().includes(marker), { label: `${marker} activo` })
  await flush(4)
}

const markdownSource = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')

const markdownSelection = () => {
  const textarea = markdownSource()!
  return { start: textarea.selectionStart, end: textarea.selectionEnd }
}

/** Selección en el textarea real; el shell la lee por su `onMouseUp`. */
async function selectInMarkdown(start: number, end: number) {
  const textarea = markdownSource()
  if (!textarea) throw new Error("No hay textarea de Markdown")
  await act(async () => {
    textarea.focus()
    textarea.setSelectionRange(start, end)
    textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  })
  await flush(1)
  expect(markdownSelection()).toEqual({ start, end })
}

/** El modo es por pestaña: se cambia con el botón real de la status bar. */
async function switchToMarkdown(marker: string) {
  const modeButton = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
  ].find((candidate) => candidate.textContent?.trim() === "Markdown")
  if (!modeButton) throw new Error("No está el botón de modo Markdown en la status bar")
  await act(async () => {
    modeButton.click()
  })
  await waitFor(() => markdownSource()?.value.includes(marker) ?? false, { label: `${marker} en Markdown` })
  await flush(2)
}

async function activateMarkdown(writingId: string, marker: string) {
  await clickTab(writingId)
  await waitFor(() => markdownSource()?.value.includes(marker) ?? false, { label: `${marker} en Markdown` })
  await flush(4)
}

const SELECTION_A_MD = { start: 16, end: 25 }
const SELECTION_B_MD = { start: 16, end: 26 }

describe("ODE-562 — STATE-07: la selección de un documento se restaura al volver a él", () => {
  it("devuelve a A su propia selección tras pasar por B", async () => {
    // A y B abiertos por el camino de ruta que usa el producto.
    mounted = await mountEditorShell({ writingId: WRITING_A })
    await waitFor(() => mounted!.editor().getText().includes("Documento A"), {
      label: "hidratación de A",
    })
    await mounted.render({ writingId: WRITING_B })
    await waitFor(() => tabFor(WRITING_B), { label: "pestaña de B" })

    // Vuelta a A por el gesto real, y selección sobre el documento ya
    // hidratado (fijarla antes la pisaría el propio restore de A, y desde
    // ODE-624 la salida durante "loading" tampoco guardaría la vista).
    await clickTab(WRITING_A)
    await waitFor(() => mounted!.editor().getText().includes("Documento A"), {
      label: "A activo con su contenido",
    })
    await waitForHydrationReady("fase de hidratación de A en ready")
    mounted.editor().commands.setTextSelection(SELECTION_A)
    expect(currentSelection()).toEqual(SELECTION_A)

    // Salir a B hace que el shell guarde el view_state de A. Precondición de
    // la propiedad: si no se guardara, no habría nada que restaurar.
    await clickTab(WRITING_B)
    const savedA = tabFor(WRITING_A)?.view_state
    expect(savedA?.selectionFrom, "el shell guarda la selección de A al salir").toBe(SELECTION_A.from)
    expect(savedA?.selectionTo).toBe(SELECTION_A.to)

    // En B la selección es otra: si el restore no ocurriera, lo que se ve al
    // volver no coincidiría por casualidad con la de A.
    await waitFor(() => mounted!.editor().getText().includes("Documento B"), {
      label: "B activo con su contenido",
    })
    await flush(3)
    mounted.editor().commands.setTextSelection(SELECTION_B)
    expect(currentSelection()).toEqual(SELECTION_B)

    // Vuelta a A. Completion event: la hidratación de A y sus frames
    // diferidos terminan; la selección se mide después, no al agendarse.
    await clickTab(WRITING_A)
    await waitFor(() => mounted!.editor().getText().includes("Documento A"), {
      label: "A rehidratado",
    })
    await flush(4)

    expect(currentSelection(), "A recupera su propia selección").toEqual(SELECTION_A)
  }, SHELL_TEST_TIMEOUT_MS)
})

/*
 * ODE-606 — STATE-06: la selección de un documento no se fuga a otro.
 *
 * Property: con dos pestañas, cada una conserva su selección; el popup de
 * selección de A no aparece en B; y una acción del popup hecha después de
 * cambiar se aplica al documento activo, no al anterior.
 *
 * Camino de producción: igual que STATE-07, pero la selección se hace por el
 * DOM (`selectEditorText`: `Range` + `selectionchange`, lo que lee
 * ProseMirror al arrastrar) y el popup se abre solo, por el `selectionUpdate`
 * del shell. Se cambia de pestaña por los dos gestos del producto: el
 * puntero (cuyo `pointerdown` también cierra el popup por "click fuera") y el
 * atajo de teclado `nextTab`, que NO pasa por ese cierre — es el camino en el
 * que un popup viejo podría sobrevivir al cambio.
 *
 * Failure modes cubiertos (brief de ODE-606):
 *   - el snapshot de la selección se toma del editor anterior tras cambiar
 *     de pestaña (`editorInstanceRef` es un espejo): la acción del popup
 *     marcaría el rango de A en B;
 *   - la restauración Markdown se fusiona con otra y se pierde (ODE-582): dos
 *     restauraciones seguidas, con los frames retenidos, y cada documento
 *     tiene que acabar con SU selección.
 *
 * Mutation tests (ODE-606, verificados en vivo):
 *   - guardar el view_state sin la identidad del documento
 *     (`persistCurrentWorkspaceViewState` con un `tabId` fijo en vez de
 *     `currentWritingIdRef.current`) pone en rojo STATE-07 y los casos Rich y
 *     Markdown de STATE-06: A deja de recuperar su propia selección;
 *   - que el `selectionUpdate` del shell no cierre el popup cuando la
 *     selección deja de ser un rango pone en rojo los dos casos Rich, por
 *     puntero y por teclado: el popup de A aparece en B.
 *
 * Bug encontrado (ODE-625, bug 2, arreglado): salir de un documento Markdown
 * con su restauración todavía encolada le guardaba la selección del documento
 * anterior. Su caso, antes `it.fails`, es un `it` al final del bloque.
 */

async function persistedHighlights(writingId: string) {
  const writing = await localDB.writings.get(writingId)
  return JSON.stringify(writing?.body_json ?? {}).includes('"highlight"')
}

describe("ODE-606 — STATE-06: la selección y el popup de un documento no se fugan a otro", () => {
  it("cada pestaña conserva su selección, el popup de A no aparece en B y la acción del popup cae en B", async () => {
    const writingA = "81111111-1111-4111-8111-111111111111"
    const writingB = "82222222-2222-4222-8222-222222222222"
    await openPair(writingA, writingB)

    await activate(writingA, "Documento A")
    const selectionA = await selectEditorText("una frase")
    expect(selectionPopup(), "control positivo: la selección de A abre el popup en A").not.toBeNull()

    await activate(writingB, "Documento B")
    expect(selectionPopup(), "el popup de A no aparece en B").toBeNull()
    expect(currentSelection(), "B no hereda la selección de A").not.toEqual(selectionA)

    const selectionB = await selectEditorText("otro texto")
    expect(selectionPopup(), "la selección de B abre su propio popup").not.toBeNull()
    await clickSelectionPopupAction("Mark passage")
    expect(readEditorAnnotations().marks, "la acción del popup marca el rango de B, en B").toEqual([
      { from: selectionB.from, to: selectionB.to, text: "otro texto", type: "highlight" },
    ])
    const selectionBAfterMark = currentSelection()

    // Ida y vuelta varias veces: cada documento vuelve con lo suyo.
    for (let round = 0; round < 2; round += 1) {
      await activate(writingA, "Documento A")
      expect(currentSelection(), `vuelta ${round + 1} a A: su propia selección`).toEqual(selectionA)
      expect(readEditorAnnotations().marks, `vuelta ${round + 1} a A: la marca de B no está en A`).toEqual([])

      await activate(writingB, "Documento B")
      expect(currentSelection(), `vuelta ${round + 1} a B: su propia selección`).toEqual(selectionBAfterMark)
      expect(readEditorAnnotations().marks, `vuelta ${round + 1} a B: conserva su marca`).toEqual([
        { from: selectionB.from, to: selectionB.to, text: "otro texto", type: "highlight" },
      ])
    }

    await waitForAsync(async () => persistedHighlights(writingB), { label: "la marca de B persistida en B" })
    expect(await persistedHighlights(writingA), "lo persistido de A no tiene la marca").toBe(false)
  }, SHELL_TEST_TIMEOUT_MS)

  it("cambiar por teclado con el popup de A abierto no lo lleva a B", async () => {
    const writingA = "83111111-1111-4111-8111-111111111111"
    const writingB = "84222222-2222-4222-8222-222222222222"
    await openPair(writingA, writingB)

    // B queda a la derecha de A: `nextTab` desde A lleva a B.
    await activate(writingA, "Documento A")
    await selectEditorText("bastante larga")
    expect(selectionPopup(), "control positivo: el popup de A está abierto").not.toBeNull()

    const mac = isMacPlatform()
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "]",
          code: "BracketRight",
          shiftKey: true,
          metaKey: mac,
          ctrlKey: !mac,
          bubbles: true,
        }),
      )
    })
    await flush(2)
    expect(getEditorSessionState().session.active_tab_id, "el atajo activó la pestaña de B").toBe(
      tabFor(writingB)?.id,
    )
    await waitFor(() => mounted!.editor().getText().includes("Documento B"), { label: "B activo" })
    await flush(4)

    expect(selectionPopup(), "el popup de A no sobrevive al cambio por teclado").toBeNull()
    expect(readEditorAnnotations().marks, "B sigue sin marcas").toEqual([])
    expect(await persistedHighlights(writingA), "A sigue sin marcas persistidas").toBe(false)
  }, SHELL_TEST_TIMEOUT_MS)

  /**
   * A y B en Markdown con su selección cada uno; control positivo: una vuelta
   * simple a A le devuelve la suya. Después, A → B → A con los frames
   * retenidos y un settle global al final.
   *
   * OJO: este caso NO prueba coalescencia — al drenar los frames al final, cada
   * restauración encuentra el RAF libre y la cola no fusiona nada (observado con
   * una sonda en el review de ODE-607). La fusión real, con el mismo RAF
   * retenido, la prueban los casos de ODE-642 al final del archivo.
   */
  async function markdownDoubleRestore(writingA: string, writingB: string) {
    await openPair(writingA, writingB)
    await activate(writingB, "Documento B")
    await switchToMarkdown("Documento B")
    await activate(writingA, "Documento A")
    await switchToMarkdown("Documento A")

    await selectInMarkdown(SELECTION_A_MD.start, SELECTION_A_MD.end)
    await activateMarkdown(writingB, "Documento B")
    await selectInMarkdown(SELECTION_B_MD.start, SELECTION_B_MD.end)

    await activateMarkdown(writingA, "Documento A")
    expect(markdownSelection(), "control positivo: una vuelta simple a A").toEqual(SELECTION_A_MD)

    const frames = holdAnimationFrames()
    try {
      await clickTab(writingB)
      await clickTab(writingA)
      await frames.settleUntil(
        () =>
          (markdownSource()?.value.includes("Documento A") ?? false) &&
          document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") === "ready",
        { label: "A hidratado tras la fusión" },
      )
      await frames.settle(6)
    } finally {
      frames.restore()
    }
    await flush(4)
  }

  it("Markdown: dos restauraciones seguidas dejan a A con su selección", async () => {
    await markdownDoubleRestore("85111111-1111-4111-8111-111111111111", "86222222-2222-4222-8222-222222222222")
    expect(markdownSelection(), "tras la fusión, A tiene su selección").toEqual(SELECTION_A_MD)
    expect(tabFor("85111111-1111-4111-8111-111111111111")?.id).toBe(getEditorSessionState().session.active_tab_id)
  }, SHELL_TEST_TIMEOUT_MS)

  // ODE-625 (bug 2, arreglado). Salir de B con su restauración todavía
  // encolada guardaba en el view_state de B la selección de A: el
  // `markdownSelectionRef` del shell no estaba atado a la identidad del
  // documento. Era `it.fails`; pasó a `it` sin tocar el cuerpo. Este caso
  // prueba el resultado de aislamiento (B conserva la suya); la cobertura de
  // las guardas que lo protegen, con mutaciones parciales, está en el bloque
  // ODE-642 de abajo (el review de ODE-607 mostró que revertirlas no lo ponía
  // rojo).
  it("ODE-625 — Markdown: salir de B antes de su restauración no le deja la selección de A", async () => {
    const writingA = "87111111-1111-4111-8111-111111111111"
    const writingB = "88222222-2222-4222-8222-222222222222"
    await markdownDoubleRestore(writingA, writingB)
    await activateMarkdown(writingB, "Documento B")
    expect(markdownSelection(), "B conserva su propia selección").toEqual(SELECTION_B_MD)
  }, SHELL_TEST_TIMEOUT_MS)
})

/* ------------------------------------------------------------------ *
 * ODE-642 — guardas y coalescencia de la cola de restauración
 * ------------------------------------------------------------------ */

const RAF_TEST_TIMEOUT_MS = 40_000
const ODE642_SELECTION_A = { start: 16, end: 25 } // "una frase" en STATE06_TEXT_A
const ODE642_SELECTION_B = { start: 16, end: 26 } // "otro texto" en STATE06_TEXT_B

const currentPhase = () =>
  document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") ?? null

/** El atajo real de negrita, como lo recibe `window` (mismo camino que ODE-582). */
async function pressBoldShortcut() {
  const mac = isMacPlatform()
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", metaKey: mac, ctrlKey: !mac, bubbles: true }),
    )
  })
}

/**
 * Abre A y B en Markdown y termina con A activo, listo y su selección
 * restaurada. Es el recorrido de `markdownDoubleRestore` (ODE-606), con los
 * scrolls de cada pestaña puestos antes de salir para que el `view_state`
 * guardado de ambos los conserve.
 */
async function openMarkdownPairWithSavedViews() {
  await localDB.writings.save(makeLocalWriting(WRITING_A, STATE06_TEXT_A, "Documento A"))
  await localDB.writings.save(makeLocalWriting(WRITING_B, STATE06_TEXT_B, "Documento B"))
  mounted = await mountEditorShell({ writingId: WRITING_A, withAppMain: true })
  await waitFor(() => mounted!.editor().getText().includes("Documento A"), { label: "hidratación de A" })
  await mounted.render({ writingId: WRITING_B })
  await waitFor(() => tabFor(WRITING_B), { label: "pestaña de B" })
  await activate(WRITING_B, "Documento B")
  await switchToMarkdown("Documento B")
  await activate(WRITING_A, "Documento A")
  await switchToMarkdown("Documento A")
  await selectInMarkdown(ODE642_SELECTION_A.start, ODE642_SELECTION_A.end)
  scrollViewport({ editorScrollTop: 120, shellScrollTop: 240 })
  await activateMarkdown(WRITING_B, "Documento B")
  await selectInMarkdown(ODE642_SELECTION_B.start, ODE642_SELECTION_B.end)
  scrollViewport({ editorScrollTop: 60, shellScrollTop: 80 })
  await activateMarkdown(WRITING_A, "Documento A")
  expect(markdownSelection(), "control positivo: A abre con su selección guardada").toEqual(ODE642_SELECTION_A)
}

/**
 * Drena los frames retenidos hasta la ventana de coalescencia: `marker` ya está
 * en el textarea, la fase sigue en "loading" y hay un frame de restauración
 * pendiente. Es la misma ventana que ODE-582 abre a mano, frame a frame.
 */
async function settleIntoRestoreWindow(frames: ReturnType<typeof holdAnimationFrames>, marker: string) {
  for (let step = 0; step < 40; step += 1) {
    await flush(2)
    const pending = frames.takePending()
    if (pending.length > 0) await frames.runCallbacks(pending)
    if (
      currentPhase() === "loading" &&
      (markdownSource()?.value.includes(marker) ?? false) &&
      frames.pending() > 0
    ) {
      return true
    }
  }
  return false
}

/*
 * Cada caso viene de la Matriz del Recon Pack (tanda 6). El hallazgo del review
 * de ODE-607 fue que `markdownDoubleRestore` decía probar la fusión pero
 * ejecutaba los RAF entre solicitud y solicitud: estas pruebas mantienen el
 * MISMO frame retenido y afirman ese hecho. La cola de RAF anidados y los
 * caminos de error de la restauración quedan como follow-up declarado (el
 * issue no añade una mutación propia para transiciones posteriores al RAF).
 */
describe("ODE-642 — la red de la cola de restauración: dueño, llamador y coalescencia", () => {
  it("Matriz 1: A→B antes del RAF — la restauración de A no toca el textarea ni el scroll de B", async () => {
    await openMarkdownPairWithSavedViews()

    const frames = holdAnimationFrames()
    try {
      await frames.flush()

      // Solicitud llana del dueño A (negrita), sin guard del llamador: retiene
      // su frame y con él el rango de A.
      await pressBoldShortcut()
      expect(frames.pending(), "la solicitud de A retuvo su frame").toBe(1)

      await clickTab(WRITING_B)
      await waitFor(() => markdownSource()?.value.includes("Documento B") ?? false, {
        label: "el texto de B en el textarea",
      })
      expect(tabFor(WRITING_B)?.id, "B está activo antes de que corra el RAF de A").toBe(
        getEditorSessionState().session.active_tab_id,
      )

      // Mientras el frame de A sigue retenido, el usuario coloca su selección
      // en B y lo desplaza: eso es lo que la restauración obsoleta no debe
      // pisar.
      await selectInMarkdown(0, 0)
      scrollViewport({ editorScrollTop: 5, shellScrollTop: 7 })

      const queued = frames.takePending()
      expect(queued.length, "el frame retenido de A está primero en la cola").toBeGreaterThan(0)
      await frames.runCallbacks([queued[0]])

      expect(markdownSelection(), "B conserva su selección: el rango de A no se aplica").toEqual({
        start: 0,
        end: 0,
      })
      expect(readViewport(), "B conserva su scroll: el de A no se aplica").toEqual({
        editorScrollTop: 5,
        shellScrollTop: 7,
      })

      // Control positivo de la ausencia: en este mismo estado, la restauración
      // propia de B sí llega al textarea cuando corre su frame.
      await frames.runCallbacks(queued.slice(1))
      await frames.settleUntil(
        () => currentPhase() === "ready" && (markdownSource()?.value.includes("Documento B") ?? false),
        { label: "B hidratado y con su selección" },
      )
      await frames.settle(6)
      expect(markdownSelection(), "B termina con la selección de su view_state").toEqual(ODE642_SELECTION_B)
    } finally {
      frames.restore()
    }
    await flush(4)
  }, RAF_TEST_TIMEOUT_MS)

  it("Matriz 2: guard del llamador falso con dueño estable — no toca el textarea ni la caché", async () => {
    await openMarkdownPairWithSavedViews()

    const frames = holdAnimationFrames()
    try {
      await frames.flush()

      // Re-activar la pestaña activa arranca otra hidratación de A: su
      // restauración queda pendiente con el frame retenido y su guard del
      // llamador (`generation.isCurrent`) vigente.
      await clickTab(WRITING_A)
      expect(
        await settleIntoRestoreWindow(frames, "Documento A"),
        "control positivo: la restauración de A quedó pendiente con el RAF retenido",
      ).toBe(true)

      // El llamador se invalida sin cambiar el dueño: la re-activación arranca
      // una generación nueva para el MISMO writingId.
      await clickTab(WRITING_A)
      expect(tabFor(WRITING_A)?.id, "el dueño sigue siendo A").toBe(getEditorSessionState().session.active_tab_id)
      expect(markdownSource()?.value.includes("Documento A"), "A sigue en el textarea").toBe(true)

      // Selección y scroll manuales después de la re-activación: la solicitud
      // vieja del llamador falso no debe pisarlos.
      await selectInMarkdown(1, 4)
      scrollViewport({ editorScrollTop: 5, shellScrollTop: 7 })

      const queued = frames.takePending()
      await frames.runCallbacks(queued)

      expect(markdownSelection(), "el guard del llamador falso no toca el textarea").toEqual({ start: 1, end: 4 })
      expect(readViewport(), "el guard del llamador falso no toca el scroll").toEqual({
        editorScrollTop: 5,
        shellScrollTop: 7,
      })

      // La caché se lee por un camino real: la negrita envuelve la selección
      // manual, no el rango obsoleto que llevaba la solicitud vieja.
      await pressBoldShortcut()
      await flush(2)
      expect(markdownSource()?.value, "la caché conserva la selección manual").toContain("D**ocu**mento A")
    } finally {
      frames.restore()
    }
    await flush(4)
  }, RAF_TEST_TIMEOUT_MS)

  it("Matriz 3: caché de A con B activo — la negrita de B usa su view_state, no el final", async () => {
    await openMarkdownPairWithSavedViews()

    const frames = holdAnimationFrames()
    try {
      await frames.flush()
      await clickTab(WRITING_B)

      // B activo, su texto ya en el textarea y su restauración todavía
      // pendiente: `markdownSelectionRef` sigue etiquetado con A, así que el
      // helper puro tiene que caer al `view_state` de la pestaña activa.
      expect(
        await settleIntoRestoreWindow(frames, "Documento B"),
        "control positivo: B tiene su restauración pendiente con el texto cargado",
      ).toBe(true)

      await pressBoldShortcut()
      await frames.settle(10)
      await flush(4)
      expect(markdownSource()?.value, "la negrita envuelve la selección guardada de B").toContain("**otro texto**")
    } finally {
      frames.restore()
    }
    await flush(4)
  }, RAF_TEST_TIMEOUT_MS)

  it("Matriz 4: dos restauraciones del mismo dueño con el RAF retenido — gana la última y el settle se conserva", async () => {
    await openMarkdownPairWithSavedViews()

    const frames = holdAnimationFrames()
    try {
      await frames.flush()

      // La hidratación de A encola su restauración (la primera solicitud) y su
      // frame queda retenido.
      await clickTab(WRITING_A)
      expect(
        await settleIntoRestoreWindow(frames, "Documento A"),
        "control positivo: hay una restauración de A pendiente con el RAF retenido",
      ).toBe(true)
      const before = frames.pending()
      expect(before, "la primera solicitud tiene un frame pendiente").toBe(1)

      // La segunda solicitud (negrita, mismo dueño) llega con el MISMO frame
      // retenido: la cola la fusiona en vez de agendar otro.
      await pressBoldShortcut()
      expect(frames.pending(), "la segunda solicitud se fusionó en el mismo frame").toBe(before)

      await frames.settle(10)
      await flush(4)

      expect(currentPhase(), "el onSettled de la hidratación se conserva al coalescer").toBe("ready")
      expect(markdownSource()?.value, "gana el contenido de la última solicitud (la negrita)").toContain("**una frase**")
      expect(markdownSelection(), "solo se aplica la selección de la última solicitud").toEqual({ start: 18, end: 27 })
    } finally {
      frames.restore()
    }
    await flush(4)
  }, RAF_TEST_TIMEOUT_MS)
})
