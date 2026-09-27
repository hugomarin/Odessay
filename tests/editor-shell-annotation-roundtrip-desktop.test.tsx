/**
 * @vitest-environment happy-dom
 *
 * ODE-606 — ANN-02/ANN-03 en desktop: la anotación creada desde el popup
 * llega al `.md` en disco y vuelve intacta al reabrir desde él.
 *
 * Por qué existe además del caso web: en web lo durable es el `body_json` de
 * `localDB`, que guarda marcas y nodos tal cual. En desktop la autoridad es el
 * `.md` materializado (ADR de identidad), así que la anotación tiene que
 * atravesar el serializador canónico de Markdown
 * (`<Annotation ...>texto</Annotation>`) y volver por el parser. Es otro seam, y es el que usa el
 * usuario de desktop.
 *
 * Camino de producción: "New Artifact" real y escritura real en el editor
 * real; selección real del DOM (`selectEditorText`) → `SelectionPopup` → "AI"
 * → `AnnotationBubble` → "Save"; el guardado real escribe el `.md` en un
 * directorio temporal (`DesktopDocumentService` + `FilesystemDocumentService`
 * reales, ver `tests/support/editor-shell-desktop-doubles.ts`). Reapertura:
 * shell nueva con la sesión vacía, abierta por ruta con el UUID del documento.
 *
 * Completion events: el `.md` en disco contiene el marcador (leído con el
 * parser real `scanControlledAnnotations`), no "se llamó a guardar"; y la
 * comparación tras reabrir se hace cuando el editor ya muestra el texto.
 *
 * Mutation test (ODE-606): si `persistEditorSnapshot` omite la marca o pierde
 * la anotación estructurada, el `.md` deja de contener el `<Annotation>` y la
 * reapertura ya no restaura su ancla ni su comentario.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { scanControlledAnnotations } from "@/lib/editor/annotation-markdown"

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
  clickNewArtifact,
  clickSelectionPopupAction,
  fillTextField,
  flush,
  mountEditorShell,
  openNotesSidebar,
  readEditorAnnotations,
  resetEditorShellWorld,
  selectEditorText,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { createEmptyEditorSession, EDITOR_DRAFT_TAB_ID } = await import("@/lib/local-db/editor-sessions")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

const TEST_TIMEOUT_MS = 60_000

const TEXT = "ODE606 una frase bastante larga para anotar en desktop"
const TARGET = "bastante larga"
const NOTE = "Revisar este pasaje en disco"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-annotation-roundtrip-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

async function waitForMaterializedWritingId() {
  return waitFor(
    () => {
      const { session } = getEditorSessionState()
      const writingId = session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id
      return writingId && writingId !== EDITOR_DRAFT_TAB_ID ? writingId : null
    },
    { label: "identidad materializada del documento activo", timeoutMs: 15_000 },
  )
}

describe("ODE-606 — ANN-02/ANN-03 en desktop: la anotación pasa por el .md", () => {
  it("la anotación del popup llega al .md y vuelve intacta al reabrir desde disco", async () => {
    mounted = await mountEditorShell()
    await clickNewArtifact(mounted.container)
    await typeInEditor(TEXT)
    await waitForMarkdownContaining(TEXT)
    const writingId = await waitForMaterializedWritingId()

    const target = await selectEditorText(TARGET)
    await clickSelectionPopupAction("Annotate passage")
    const field = await waitFor(
      () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Annotation text"]'),
      { label: "AnnotationBubble abierto" },
    )
    await fillTextField(field, NOTE)
    const save = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Save",
    )
    if (!save) throw new Error('El bubble no tiene botón "Save"')
    save.click()
    await flush(3)

    expect(readEditorAnnotations().marks, "ANN-02: la marca cubre el rango seleccionado").toEqual([
      { from: target.from, to: target.to, text: TARGET, type: "ai" },
    ])

    // Completion event: el .md en disco tiene el texto anclado y el marcador.
    const file = await waitForMarkdownContaining(NOTE)
    const annotations = scanControlledAnnotations(file.contents)
    expect(annotations.diagnostics, "el .md no tiene diagnósticos de anotación").toEqual([])
    expect(annotations.annotations, "el .md lleva una anotación canónica con tipo, nota y ancla").toEqual([
      expect.objectContaining({ type: "ai", index: 1, comment: NOTE, anchorText: TARGET }),
    ])
    const [annotation] = annotations.annotations
    expect(file.contents.slice(annotation.anchorStart, annotation.anchorEnd), "el rango anclado se conserva").toBe(
      TARGET,
    )

    // Reabrir: shell nueva con la sesión vacía; solo queda lo que hay en disco.
    await mounted.unmount()
    await writeEditorSession(createEmptyEditorSession())
    resetEditorShellWorld({ isDesktop: true })
    mounted = await mountEditorShell({ writingId })
    await waitFor(() => getEditorSessionState().loaded, { label: "sesión vacía cargada" })
    await waitFor(() => mounted!.editor().getText().includes("ODE606"), {
      label: "reapertura desde el .md",
      timeoutMs: 15_000,
    })
    await flush(4)

    const reopened = readEditorAnnotations()
    expect(reopened.marks, "ANN-03: la marca vuelve sobre el mismo texto").toEqual([
      expect.objectContaining({ text: TARGET, type: "ai" }),
    ])
    expect(reopened.references, "ANN-03: con el mismo tipo y el mismo cuerpo").toEqual([
      expect.objectContaining({ type: "ai", text: NOTE }),
    ])
    expect(reopened.references[0].pos, "la referencia sigue pegada al texto anclado").toBe(reopened.marks[0].to)
    expect(await openNotesSidebar(), "ANN-03: el sidebar la lista").toEqual([
      { anchor: `“${TARGET}”`, body: NOTE, badge: "AI · 1" },
    ])
  }, TEST_TIMEOUT_MS)
})
