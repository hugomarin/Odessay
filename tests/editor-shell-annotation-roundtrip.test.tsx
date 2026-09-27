/**
 * @vitest-environment happy-dom
 *
 * ODE-606 — ANN-02 (añadir una anotación) y ANN-03 (la anotación persiste),
 * a través de la shell real.
 *
 * Property ANN-02: una selección viva, el popup, el tipo y la confirmación
 * producen UNA anotación que cubre exactamente el rango seleccionado, y el
 * editor, el sidebar y lo persistido representan la misma anotación.
 * Property ANN-03: esa anotación vuelve intacta (mismo texto anclado, mismo
 * tipo, mismo cuerpo) al volver a la pestaña y al reabrir por ruta.
 *
 * Camino de producción:
 *   documento abierto por ruta → selección REAL del DOM (`selectionchange`,
 *   lo que escucha ProseMirror al arrastrar) → el `selectionUpdate` del
 *   shell abre `SelectionPopup` → `pointerdown` real en "AI" →
 *   `AnnotationBubble` → escribir la nota → "Save" → `handleConfirmAnnotation`
 *   → `addAnnotation` real → `persistEditorSnapshot` → `lib/local-db` sobre
 *   `fake-indexeddb` → botón real "Notes panel" → `NotesPanel` renderizado.
 *
 * Nada se siembra más allá del documento de partida: la anotación la crea la
 * UI. Todo lo que lee el test es estado durable (`localDB.writings`, leído con
 * el modelo real `extractWritingAnnotationNodes`) o visible (DOM del editor y
 * del sidebar).
 *
 * Completion events: ANN-02 lee lo persistido cuando `localDB` ya tiene la
 * anotación (no cuando se llama a `persist`); ANN-03 compara tras la
 * rehidratación del documento reabierto.
 *
 * Markdown: el popup de selección NO existe en modo Markdown —
 * `captureRichSelectionSnapshot` devuelve `null` fuera de `rich` y el popup
 * solo se alimenta de ese snapshot—, así que ANN-02 por popup es solo Rich.
 *
 * Límite honesto de ANN-03: el sidebar se comprueba tras reabrir, pero esa
 * comprobación pasa en parte porque guardar sube `version` y eso fuerza el
 * recálculo del memo `footnotes`. Con la misma `version` el sidebar se queda
 * con la lista del documento anterior: bug 1 de ODE-625, fijado como
 * `it.fails` al final de este archivo.
 *
 * Mutation tests (ODE-606, verificados en vivo):
 *   - el popup conserva el snapshot de la PRIMERA selección en vez de
 *     reemplazarlo (`setPendingRichSelection((current) => current ?? snapshot)`):
 *     la anotación cae sobre "una frase" y ANN-02 se pone en rojo;
 *   - `persistEditorSnapshot` persiste el cuerpo sin la marca `highlight`:
 *     ANN-02 (lo persistido) y ANN-03 (la reapertura por ruta) se ponen en rojo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { extractWritingAnnotationNodes } from "@/lib/editor/footnote-extension"
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
  clickEditorTab,
  clickSelectionPopupAction,
  closeEditorTab,
  fillTextField,
  flush,
  mountEditorShell,
  openNotesSidebar,
  readEditorAnnotations,
  resetEditorShellWorld,
  selectEditorText,
  selectionPopup,
  waitFor,
  waitForAsync,
} = await import("./support/editor-shell-harness")

const TEXT_A = "Documento A con una frase bastante larga para seleccionar."
const TEXT_B = "Documento B con otro texto."
const DISTRACTOR = "una frase"
const TARGET = "bastante larga"
const NOTE = "Revisar el tono de este pasaje"

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

async function persistedAnnotations(writingId: string) {
  const writing = await localDB.writings.get(writingId)
  return extractWritingAnnotationNodes(writing?.body_json as never)
}

/**
 * ANN-02 de punta a punta por la UI. Selecciona primero un distractor para
 * que el popup ya tenga un snapshot viejo cuando llega la selección buena:
 * así una anotación que usara el rango viejo se nota.
 */
async function annotateTargetWithAi() {
  await selectEditorText(DISTRACTOR)
  expect(selectionPopup(), "el popup aparece con la primera selección").not.toBeNull()

  const target = await selectEditorText(TARGET)
  expect(selectionPopup(), "el popup sigue abierto con la selección nueva").not.toBeNull()

  await clickSelectionPopupAction("Annotate passage")
  const note = await waitFor(
    () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Annotation text"]'),
    { label: "AnnotationBubble abierto" },
  )
  expect(selectionPopup(), "elegir el tipo cierra el popup").toBeNull()

  await fillTextField(note, NOTE)
  const save = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "Save",
  )
  if (!save) throw new Error('El bubble no tiene botón "Save"')
  save.click()
  await flush(3)
  await waitFor(() => !document.querySelector('textarea[aria-label="Annotation text"]'), {
    label: "bubble cerrado tras confirmar",
  })
  return target
}

async function hydrate(text: string) {
  await waitFor(() => mounted!.editor().getText().includes(text.slice(0, 11)), {
    label: `hidratación de "${text.slice(0, 11)}"`,
  })
  await flush(3)
}

/** Lo que tiene que ser verdad de A, se mire donde se mire. */
async function expectAnnotationIntact(writingId: string, label: string) {
  const { marks, references } = readEditorAnnotations()
  expect(marks, `${label}: una sola marca, sobre el texto anotado`).toEqual([
    expect.objectContaining({ text: TARGET, type: "ai" }),
  ])
  expect(references, `${label}: un solo nodo de referencia, con su cuerpo`).toEqual([
    expect.objectContaining({ type: "ai", text: NOTE }),
  ])
  expect(references[0].pos, `${label}: la referencia va justo tras el texto anotado`).toBe(marks[0].to)

  const entries = await openNotesSidebar()
  expect(entries, `${label}: el sidebar muestra la misma anotación`).toEqual([
    { anchor: `“${TARGET}”`, body: NOTE, badge: "AI · 1" },
  ])

  expect(await persistedAnnotations(writingId), `${label}: lo persistido`).toEqual([
    expect.objectContaining({ type: "ai", text: NOTE, anchor_text: TARGET }),
  ])
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeEach(() => {
  resetEditorShellWorld()
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

describe("ODE-606 — ANN-02: una selección viva llega a una anotación en editor, sidebar y persistencia", () => {
  it("anota exactamente el rango seleccionado y las tres proyecciones coinciden (Rich)", async () => {
    const writingA = "61111111-1111-4111-8111-111111111111"
    await localDB.writings.save(makeLocalWriting(writingA, TEXT_A, "Documento A"))

    mounted = await mountEditorShell({ writingId: writingA })
    await hydrate(TEXT_A)

    const target = await annotateTargetWithAi()

    // Editor: la marca cubre EXACTAMENTE el rango de la selección viva, y no
    // el del snapshot anterior.
    const { marks, references } = readEditorAnnotations()
    expect(marks).toEqual([{ from: target.from, to: target.to, text: TARGET, type: "ai" }])
    expect(references).toEqual([{ pos: target.to, type: "ai", text: NOTE }])

    // Sidebar: la misma anotación, por el botón real del status bar.
    expect(await openNotesSidebar()).toEqual([{ anchor: `“${TARGET}”`, body: NOTE, badge: "AI · 1" }])

    // Persistencia: completion event = localDB ya la tiene, no "persist() llamado".
    const persisted = await waitForAsync(
      async () => {
        const annotations = await persistedAnnotations(writingA)
        return annotations.length > 0 ? annotations : null
      },
      { label: "anotación persistida en localDB" },
    )
    expect(persisted).toEqual([
      expect.objectContaining({ type: "ai", index: 1, text: NOTE, anchor_text: TARGET }),
    ])
    assertNoUnhandledErrors()
  }, SHELL_TEST_TIMEOUT_MS)
})

describe("ODE-606 — ANN-03: una anotación existente vuelve intacta", () => {
  async function annotateAndPersist(writingId: string) {
    await localDB.writings.save(makeLocalWriting(writingId, TEXT_A, "Documento A"))
    mounted = await mountEditorShell({ writingId })
    await hydrate(TEXT_A)
    await annotateTargetWithAi()
    await waitForAsync(
      async () => ((await persistedAnnotations(writingId)).length > 0 ? true : null),
      { label: "anotación persistida antes de salir" },
    )
  }

  it("al salir a otra pestaña y volver por la pestaña", async () => {
    const writingA = "62111111-1111-4111-8111-111111111111"
    const writingB = "62222222-2222-4222-8222-222222222222"
    await localDB.writings.save(makeLocalWriting(writingB, TEXT_B, "Documento B"))
    await annotateAndPersist(writingA)

    await mounted!.render({ writingId: writingB })
    await waitFor(
      () => getEditorSessionState().session.tabs.some((tab) => tab.writing_id === writingB),
      { label: "pestaña de B" },
    )
    await clickEditorTab(writingB)
    await hydrate(TEXT_B)
    expect(readEditorAnnotations().marks, "B no hereda la anotación de A").toEqual([])

    await clickEditorTab(writingA)
    await hydrate(TEXT_A)
    await expectAnnotationIntact(writingA, "vuelta por pestaña")
    assertNoUnhandledErrors()
  }, SHELL_TEST_TIMEOUT_MS)

  it("al cerrar la pestaña y reabrir por ruta, y tras recargar la shell", async () => {
    const writingA = "63111111-1111-4111-8111-111111111111"
    const writingB = "63222222-2222-4222-8222-222222222222"
    await localDB.writings.save(makeLocalWriting(writingB, TEXT_B, "Documento B"))
    await annotateAndPersist(writingA)

    // Cerrar A con su botón real (B queda abierto para que haya adónde ir).
    await mounted!.render({ writingId: writingB })
    await waitFor(
      () => getEditorSessionState().session.tabs.some((tab) => tab.writing_id === writingB),
      { label: "pestaña de B" },
    )
    await closeEditorTab(writingA)
    await hydrate(TEXT_B)

    // Reabrir A por ruta, en la misma sesión.
    await mounted!.render({ writingId: writingA })
    await hydrate(TEXT_A)
    await expectAnnotationIntact(writingA, "reapertura por ruta")

    // Recargar: shell nueva y sesión vacía; lo único que queda es lo durable.
    await mounted!.unmount()
    resetEditorShellWorld()
    mounted = await mountEditorShell({ writingId: writingA })
    await hydrate(TEXT_A)
    await expectAnnotationIntact(writingA, "tras recargar")
    assertNoUnhandledErrors()
  }, SHELL_TEST_TIMEOUT_MS)
})

// BUG CONOCIDO — ODE-625 (bug 1). El memo `footnotes` del shell, que es lo que
// renderiza el sidebar, solo se recalcula cuando cambia `version` (o una
// revisión local): hidratar otro documento con la misma `version` deja la
// lista del contenido anterior. Los casos de ANN-03 de arriba pasan porque
// guardar sube `version` (1 → 3) y eso fuerza el recálculo; estos dos lo
// aíslan. `it.fails` pasa mientras el bug exista y se pone en rojo cuando se
// arregle: entonces hay que pasarlos a `it`.
describe("BUG ODE-625 — el sidebar de notas refleja el documento activo", () => {
  function writingWithAiAnnotation(id: string, version: number): LocalWriting {
    const start = TEXT_A.indexOf(TARGET)
    return {
      ...makeLocalWriting(id, TEXT_A, "Documento A"),
      version,
      body_json: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: TEXT_A.slice(0, start) },
              { type: "text", text: TARGET, marks: [{ type: "highlight", attrs: { annotationType: "ai" } }] },
              { type: "annotationReference", attrs: { id: `${id}-ann`, type: "ai", index: 1, text: NOTE } },
              { type: "text", text: TEXT_A.slice(start + TARGET.length) },
            ],
          },
        ],
      },
    }
  }

  it.fails("abrir un documento que ya tiene una anotación la lista en el sidebar", async () => {
    const writingA = "64111111-1111-4111-8111-111111111111"
    await localDB.writings.save(writingWithAiAnnotation(writingA, 1))
    mounted = await mountEditorShell({ writingId: writingA })
    await hydrate(TEXT_A)

    // Control positivo: el documento real SÍ tiene la anotación.
    expect(readEditorAnnotations().references).toEqual([expect.objectContaining({ type: "ai", text: NOTE })])
    expect(await openNotesSidebar()).toEqual([{ anchor: `“${TARGET}”`, body: NOTE, badge: "AI · 1" }])
  }, SHELL_TEST_TIMEOUT_MS)

  it.fails("el sidebar de B no lista las anotaciones de A", async () => {
    const writingA = "65111111-1111-4111-8111-111111111111"
    const writingB = "65222222-2222-4222-8222-222222222222"
    await localDB.writings.save(writingWithAiAnnotation(writingA, 3))
    await localDB.writings.save({ ...makeLocalWriting(writingB, TEXT_B, "Documento B"), version: 3 })

    mounted = await mountEditorShell({ writingId: writingA })
    await hydrate(TEXT_A)
    // Control positivo: en A el sidebar lista su anotación.
    expect(await openNotesSidebar()).toEqual([{ anchor: `“${TARGET}”`, body: NOTE, badge: "AI · 1" }])

    await mounted.render({ writingId: writingB })
    await waitFor(
      () => getEditorSessionState().session.tabs.some((tab) => tab.writing_id === writingB),
      { label: "pestaña de B" },
    )
    await clickEditorTab(writingB)
    await hydrate(TEXT_B)
    expect(readEditorAnnotations().references, "B no tiene anotaciones en el documento").toEqual([])
    expect(await openNotesSidebar(), "ni en el sidebar").toEqual([])
  }, SHELL_TEST_TIMEOUT_MS)
})
