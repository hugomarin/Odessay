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

const { flush, mountEditorShell, pointerClick, resetEditorShellWorld, waitFor } = await import(
  "./support/editor-shell-harness"
)

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
    // hidratado (fijarla antes la pisaría el propio restore de A).
    await clickTab(WRITING_A)
    await waitFor(() => mounted!.editor().getText().includes("Documento A"), {
      label: "A activo con su contenido",
    })
    await flush(3)
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
