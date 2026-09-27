/**
 * @vitest-environment happy-dom
 *
 * ODE-606 — Acciones del popup de selección a través de la shell real:
 * "Footnote", "Highlight" y la conversión de un highlight suelto en anotación
 * (`convertStandaloneHighlight`).
 *
 * Property:
 *   - "Footnote" inserta la nota justo tras el texto seleccionado, y el memo
 *     `footnotes` (lo que el sidebar renderiza) y lo persistido la reflejan;
 *   - "Highlight" crea el highlight sobre exactamente el rango seleccionado;
 *   - convertir un highlight suelto en anotación lo reemplaza: queda UNA
 *     anotación sobre el mismo texto, no la anotación más el highlight viejo
 *     (el estado final coincide con el de ODE-552: una marca con tipo y su
 *     nodo de referencia).
 *
 * Camino de producción: selección real del DOM (`selectEditorText`) →
 * `SelectionPopup` → `pointerdown` real en la acción → en "Footnote", el
 * `InsertFootnoteModal` real con su formulario → `handleInsertFootnote`. La
 * conversión entra por el sidebar, que es el único sitio del producto donde
 * existe: badge del highlight → opción "AI" del desplegable →
 * `onConvertHighlight` → `convertStandaloneHighlight`.
 *
 * Estado de partida de la conversión: un documento guardado con un highlight
 * suelto (marca `highlight` sin `annotationType` y sin nodo de referencia), que
 * es lo que produce importar Markdown con `==texto==`. Es contenido durable de
 * entrada, no estado interno del shell: el sidebar lo descubre por sí mismo
 * (con `version: 2`, que esquivaba el bug 1 de ODE-625, ya arreglado).
 *
 * Completion events: el DOM del sidebar tras el commit, y `localDB` cuando ya
 * tiene el cuerpo nuevo.
 *
 * Mutation tests (ODE-606, verificados en vivo):
 *   - `handleInsertFootnote` inserta al final del documento en vez de en la
 *     selección: el caso de "Footnote" se pone en rojo;
 *   - `handleMarkSelection` pone la marca sin `addAnnotation("highlight")` (un
 *     highlight suelto en vez de uno con tipo): el caso de "Highlight" se pone
 *     en rojo;
 *   - el sidebar enruta la conversión de un highlight suelto por el camino de
 *     las anotaciones con tipo (el fork `isStandalone` de ODE-552 roto): el
 *     caso de conversión se pone en rojo.
 *   Probado y descartado: que `convertStandaloneHighlight` añada la anotación
 *   con el cursor colapsado al final del rango sigue en verde, porque
 *   `addAnnotation` ya estampa el tipo en el highlight contiguo
 *   (`stampHighlightBeforeRef`). No es un modo de fallo real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { extractStandaloneHighlights, extractWritingAnnotationNodes } from "@/lib/editor/footnote-extension"
import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"

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
  clickSelectionPopupAction,
  fillTextField,
  flush,
  mountEditorShell,
  openNotesSidebar,
  readEditorAnnotations,
  readNotesSidebar,
  resetEditorShellWorld,
  selectEditorText,
  selectionPopup,
  waitFor,
  waitForAsync,
} = await import("./support/editor-shell-harness")

const TEXT = "Documento con una frase bastante larga y un final distinto."
const TARGET = "bastante larga"
const NOTE = "Fuente: carta de 1893"

const SHELL_TEST_TIMEOUT_MS = 30_000

type Paragraph = { type: "paragraph"; content: Array<Record<string, unknown>> }

function makeLocalWriting(id: string, paragraph: Paragraph): LocalWriting {
  return {
    id,
    title: "Documento",
    body_json: { type: "doc", content: [paragraph] },
    body_text: TEXT,
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

const plainParagraph: Paragraph = { type: "paragraph", content: [{ type: "text", text: TEXT }] }

/** El mismo texto, con `TARGET` como highlight suelto (lo que deja `==texto==`). */
function paragraphWithStandaloneHighlight(): Paragraph {
  const start = TEXT.indexOf(TARGET)
  return {
    type: "paragraph",
    content: [
      { type: "text", text: TEXT.slice(0, start) },
      { type: "text", text: TARGET, marks: [{ type: "highlight" }] },
      { type: "text", text: TEXT.slice(start + TARGET.length) },
    ],
  }
}

async function readPersisted(writingId: string) {
  const writing = await localDB.writings.get(writingId)
  const body = writing?.body_json as never
  return { annotations: extractWritingAnnotationNodes(body), standalone: extractStandaloneHighlights(body) }
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

async function openDocument(writingId: string, paragraph: Paragraph, version = 1) {
  await localDB.writings.save({ ...makeLocalWriting(writingId, paragraph), version })
  mounted = await mountEditorShell({ writingId })
  await waitFor(() => mounted!.editor().getText().includes("Documento con"), { label: "hidratación" })
  await flush(3)
}

beforeEach(() => {
  resetEditorShellWorld()
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

describe("ODE-606 — acciones del popup de selección", () => {
  it('"Footnote" inserta la nota tras el texto seleccionado y el sidebar y la persistencia la reflejan', async () => {
    const writingId = "71111111-1111-4111-8111-111111111111"
    await openDocument(writingId, plainParagraph)

    const target = await selectEditorText(TARGET)
    await clickSelectionPopupAction("Add footnote")
    expect(selectionPopup(), "elegir la acción cierra el popup").toBeNull()

    const field = await waitFor(
      () => document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Add note text"]'),
      { label: "modal de footnote abierto" },
    )
    await fillTextField(field, NOTE)
    const submit = Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')).find(
      (button) => button.textContent?.trim() === "Insert footnote",
    )
    if (!submit) throw new Error('El modal no tiene botón "Insert footnote"')
    submit.click()
    await flush(3)
    await waitFor(() => !document.querySelector('textarea[placeholder="Add note text"]'), {
      label: "modal cerrado tras insertar",
    })

    // Documento: la referencia va justo tras el texto seleccionado, que queda
    // marcado como footnote.
    const { marks, references } = readEditorAnnotations()
    expect(marks).toEqual([{ from: target.from, to: target.to, text: TARGET, type: "footnote" }])
    expect(references).toEqual([{ pos: target.to, type: "footnote", text: NOTE }])

    // Sidebar: insertar la nota abre el panel (`setActivePanel("notes")`) y el
    // memo `footnotes` la lista — sin tocar el botón del panel.
    const entries = await waitFor(() => readNotesSidebar(), { label: "el panel de notas se abre solo" })
    expect(entries).toEqual([{ anchor: `“${TARGET}”`, body: NOTE, badge: "Footnote · 1" }])

    const persisted = await waitForAsync(
      async () => {
        const state = await readPersisted(writingId)
        return state.annotations.length > 0 ? state : null
      },
      { label: "footnote persistida" },
    )
    expect(persisted.annotations).toEqual([
      expect.objectContaining({ type: "footnote", index: 1, text: NOTE, anchor_text: TARGET }),
    ])
    assertNoUnhandledErrors()
  }, SHELL_TEST_TIMEOUT_MS)

  it('"Highlight" marca exactamente el rango seleccionado', async () => {
    const writingId = "72111111-1111-4111-8111-111111111111"
    await openDocument(writingId, plainParagraph)

    const target = await selectEditorText(TARGET)
    await clickSelectionPopupAction("Mark passage")
    expect(selectionPopup(), "marcar cierra el popup").toBeNull()

    const { marks, references } = readEditorAnnotations()
    expect(marks).toEqual([{ from: target.from, to: target.to, text: TARGET, type: "highlight" }])
    expect(references).toEqual([{ pos: target.to, type: "highlight", text: "" }])

    expect(await openNotesSidebar()).toEqual([{ anchor: `“${TARGET}”`, body: "", badge: "Highlight · 1" }])

    const persisted = await waitForAsync(
      async () => {
        const state = await readPersisted(writingId)
        return state.annotations.length > 0 ? state : null
      },
      { label: "highlight persistido" },
    )
    expect(persisted.annotations).toEqual([
      expect.objectContaining({ type: "highlight", index: 1, anchor_text: TARGET }),
    ])
    assertNoUnhandledErrors()
  }, SHELL_TEST_TIMEOUT_MS)

  it("convertir un highlight suelto en anotación lo reemplaza sin duplicarlo", async () => {
    const writingId = "73111111-1111-4111-8111-111111111111"
    // `version: 2` y no 1: esquivaba el bug 1 de ODE-625 (el sidebar no
    // listaba lo que ya traía el documento con la misma `version`), ya
    // arreglado y cubierto en `editor-shell-annotation-roundtrip.test.tsx`.
    // Aquí se aísla la conversión, no ese bug.
    await openDocument(writingId, paragraphWithStandaloneHighlight(), 2)

    // Control positivo: el highlight suelto existe y el sidebar lo lista como tal.
    const before = readEditorAnnotations()
    expect(before.marks).toEqual([expect.objectContaining({ text: TARGET, type: null })])
    expect(before.references).toEqual([])
    const standaloneRange = { from: before.marks[0].from, to: before.marks[0].to }
    expect(await openNotesSidebar()).toEqual([{ anchor: `“${TARGET}”`, body: "", badge: "Highlight · 1" }])

    // Badge → desplegable → "AI": el camino real del sidebar.
    const panel = document.querySelector<HTMLElement>('[data-testid="editor-panel-notes"]')!
    const badge = panel.querySelector<HTMLButtonElement>("article button")!
    badge.click()
    await flush(1)
    const toAi = await waitFor(
      () =>
        Array.from(panel.querySelectorAll<HTMLButtonElement>("article button")).find(
          (button) => button !== badge && button.textContent?.trim() === "AI",
        ),
      { label: 'opción "AI" del desplegable' },
    )
    toAi.click()
    await flush(3)

    // Documento: UNA marca con tipo sobre el mismo rango y su referencia; ni
    // rastro del highlight suelto.
    const after = readEditorAnnotations()
    expect(after.marks).toEqual([{ ...standaloneRange, text: TARGET, type: "ai" }])
    expect(after.references).toEqual([{ pos: standaloneRange.to, type: "ai", text: TARGET }])

    // Sidebar: una sola entrada, ya como AI (sin la del highlight viejo).
    expect(readNotesSidebar()).toEqual([{ anchor: `“${TARGET}”`, body: TARGET, badge: "AI · 1" }])

    const persisted = await waitForAsync(
      async () => {
        const state = await readPersisted(writingId)
        return state.annotations.length > 0 ? state : null
      },
      { label: "conversión persistida" },
    )
    expect(persisted.annotations).toEqual([
      expect.objectContaining({ type: "ai", index: 1, text: TARGET, anchor_text: TARGET }),
    ])
    expect(persisted.standalone, "no queda highlight suelto en lo persistido").toEqual([])
    assertNoUnhandledErrors()
  }, SHELL_TEST_TIMEOUT_MS)
})
