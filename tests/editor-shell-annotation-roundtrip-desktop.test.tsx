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
import { readFile } from "node:fs/promises"

import { scanControlledAnnotations } from "@/lib/editor/annotation-markdown"
import { OPAQUE_SOURCE_BLOCK_NODE, OPAQUE_SOURCE_INLINE_NODE } from "@/lib/editor/opaque-source-extensions"

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
  clickEditorTab,
  clickNewArtifact,
  clickSelectionPopupAction,
  fillTextField,
  flush,
  mountEditorShell,
  openNotesSidebar,
  pointerClick,
  readEditorAnnotations,
  resetEditorShellWorld,
  selectEditorText,
  typeInEditor,
  waitFor,
  waitForHydrationReady,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { act } = await import("react")
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)
const { failNextWriteFile, holdWriteFile, writeFileCalls } = await import(
  "./integration/documents/support/real-desktop-doubles"
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

function reopenedEditorState(writingId: string) {
  const sessionState = getEditorSessionState()
  const activeTab = sessionState.session.tabs.find(
    (tab) => tab.id === sessionState.session.active_tab_id,
  )
  const editorText = mounted?.editor().getText() ?? ""

  return {
    writingId,
    sessionLoaded: sessionState.loaded,
    activeTabId: sessionState.session.active_tab_id,
    activeWritingId: activeTab?.writing_id ?? null,
    hydrationPhase:
      document.querySelector<HTMLElement>('[data-page="editor"]')?.getAttribute("data-hydration-phase") ?? null,
    editorTextLength: editorText.length,
    editorTextPreview: editorText.slice(0, 160),
  }
}

async function switchMode(label: "Rich" | "Markdown") {
  const button = await waitFor(
    () =>
      Array.from(
        mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
      ).find((candidate) => (candidate.textContent ?? "").trim() === label),
    { label: `botón "${label}" de la status bar` },
  )
  await act(async () => button.click())
  await flush(2)
  await waitFor(
    () => (label === "Markdown" ? markdownSource() : !markdownSource() && mounted!.prosemirror()),
    { label: `editor en modo ${label}` },
  )
}

function markdownSource() {
  return mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
}

async function replaceMarkdownSource(value: string) {
  const textarea = markdownSource()
  if (!textarea) throw new Error("El editor no está en modo Markdown")
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush(1)
}

function opaqueSourceNodes() {
  type JsonNode = { type?: string; attrs?: Record<string, unknown>; content?: JsonNode[] }
  const found: Array<{ type: string; raw: unknown; reason: unknown }> = []
  const visit = (node: JsonNode) => {
    if (node.type === OPAQUE_SOURCE_INLINE_NODE || node.type === OPAQUE_SOURCE_BLOCK_NODE) {
      found.push({ type: node.type, raw: node.attrs?.raw, reason: node.attrs?.reason })
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(mounted!.editor().getJSON() as JsonNode)
  return found
}

describe("ODE-606 — ANN-02/ANN-03 en desktop: la anotación pasa por el .md", () => {
  it("la anotación del popup llega al .md y vuelve intacta al reabrir desde disco", async () => {
    mounted = await mountEditorShell()
    await clickNewArtifact(mounted.container)
    await typeInEditor(TEXT)
    await waitForMarkdownContaining(TEXT)
    const writingId = await waitForMaterializedWritingId()
    await waitFor(() => mounted!.editor().getText().includes(TEXT), {
      label: "editor desktop con el texto guardado e hidratado",
    })

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
    expect(annotation.id, "la identidad inline se acuña antes de guardar").toBeTruthy()
    expect(file.contents.slice(annotation.anchorStart, annotation.anchorEnd), "el rango anclado se conserva").toBe(
      TARGET,
    )

    // Reabrir: shell nueva con la sesión vacía; solo queda lo que hay en disco.
    await mounted.unmount()
    await writeEditorSession(createEmptyEditorSession())
    resetEditorShellWorld({ isDesktop: true })
    mounted = await mountEditorShell({ writingId })
    await waitFor(() => getEditorSessionState().loaded, { label: "sesión vacía cargada" })
    try {
      await waitFor(() => mounted!.editor().getText().includes("ODE606"), {
        label: "reapertura desde el .md",
        timeoutMs: 15_000,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `${message}; estado de reapertura: ${JSON.stringify(reopenedEditorState(writingId))}`,
      )
    }
    await flush(4)

    const reopened = readEditorAnnotations()
    expect(reopened.marks, "ANN-03: la marca vuelve sobre el mismo texto").toEqual([
      expect.objectContaining({ text: TARGET, type: "ai" }),
    ])
    expect(reopened.references, "ANN-03: con el mismo tipo y el mismo cuerpo").toEqual([
      expect.objectContaining({ type: "ai", text: NOTE }),
    ])
    expect(reopened.references[0].pos, "la referencia sigue pegada al texto anclado").toBe(reopened.marks[0].to)

    // Reabrir y guardar otra edición verifica la identidad inline después de
    // que el `.md` atravesó el parser desktop, no solo que el archivo viejo sigue igual.
    const reopenedEditor = mounted.editor()
    reopenedEditor.commands.setTextSelection(reopenedEditor.state.doc.content.size - 1)
    await typeInEditor(" after-reopen")
    const reopenedFile = await waitForMarkdownContaining("after-reopen")
    const reopenedSourceAnnotations = scanControlledAnnotations(reopenedFile.contents)
    expect(reopenedSourceAnnotations.diagnostics, "el `.md` sigue parseando después de reabrir").toEqual([])
    expect(reopenedSourceAnnotations.annotations.map(({ id }) => id)).toEqual([annotation.id])

    expect(await openNotesSidebar(), "ANN-03: el sidebar la lista").toEqual([
      { anchor: `“${TARGET}”`, body: NOTE, badge: "AI · 1" },
    ])
  }, TEST_TIMEOUT_MS)

  it("preserves invalid Annotation source bytes through Rich save and desktop reopen", async () => {
    const invalidAnnotation =
      '<Annotation id="desktop-opaque-531" type="personal" comment="Keep this source" extra="invalid">Anchor desktop</Annotation>'
    const source = `ODE531 source before\n\n${invalidAnnotation}\n\nODE531 source after`
    mounted = await mountEditorShell()
    await clickNewArtifact(mounted.container)
    await typeInEditor("ODE531 initial")
    const initialFile = await waitForMarkdownContaining("ODE531 initial")
    const writingId = await waitForMaterializedWritingId()

    await switchMode("Markdown")
    await replaceMarkdownSource(source)
    await switchMode("Rich")

    expect(opaqueSourceNodes(), "Rich conserva el tag inválido como source opaco").toEqual([
      expect.objectContaining({ type: OPAQUE_SOURCE_INLINE_NODE, raw: invalidAnnotation, reason: "invalid-attributes" }),
    ])

    const editor = mounted.editor()
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    await typeInEditor(" after-opaque")
    const savedFile = await waitForMarkdownContaining("after-opaque")
    expect(savedFile.path, "el Rich edit guarda sobre el mismo documento").toBe(initialFile.path)
    const invalidStart = savedFile.contents.indexOf(invalidAnnotation)
    expect(invalidStart, "el .md materializado conserva el tag inválido").toBeGreaterThanOrEqual(0)
    expect(savedFile.contents.slice(invalidStart, invalidStart + invalidAnnotation.length)).toBe(invalidAnnotation)

    await mounted.unmount()
    await writeEditorSession(createEmptyEditorSession())
    resetEditorShellWorld({ isDesktop: true })
    mounted = await mountEditorShell({ writingId })
    await waitFor(() => mounted!.editor().getText().includes("ODE531 source before"), {
      label: "source desktop reabierto desde el .md",
      timeoutMs: 15_000,
    })
    await flush(3)

    expect(opaqueSourceNodes(), "la reapertura reconstruye el mismo source opaco").toEqual([
      expect.objectContaining({ type: OPAQUE_SOURCE_INLINE_NODE, raw: invalidAnnotation, reason: "invalid-attributes" }),
    ])
    const reopenedFile = await waitForMarkdownContaining("after-opaque")
    expect(reopenedFile.contents, "el .md en disco mantiene exactamente los bytes guardados").toBe(savedFile.contents)
  }, TEST_TIMEOUT_MS)
  it.fails(
    "follow-up pendiente (ODE-687): el fallo de Annotation deja la pestaña en saving — owner: useEditorPersistence",
    async () => {
      const textA = "N687 failed-save document A with an A anchor"
      const textB = "N687 failed-save document B with a B anchor"
      const failedNoteA = "N687_A_FAILED_PRIVATE_NOTE"
      mounted = await mountEditorShell()

      await clickNewArtifact(mounted.container)
      await typeInEditor(textA)
      const fileA = await waitForMarkdownContaining(textA)
      const writingA = await waitForMaterializedWritingId()
      await clickNewArtifact(mounted.container)
      await typeInEditor(textB)
      const fileB = await waitForMarkdownContaining(textB)
      const writingB = await waitForMaterializedWritingId()
      expect(fileB.path).not.toBe(fileA.path)

      await clickEditorTab(writingA)
      await waitForHydrationReady("A listo para el fallo de Annotation")
      const tabA = getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingA)
      const tabB = getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingB)
      if (!tabA || !tabB) throw new Error("A y B deben estar montados en pestañas reales")

      await selectEditorText("A anchor")
      await clickSelectionPopupAction("Annotate passage")
      const fieldA = await waitFor(
        () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Annotation text"]'),
        { label: "AnnotationBubble real de A para el fallo" },
      )
      await fillTextField(fieldA, failedNoteA)
      const saveA = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Save",
      )
      if (!saveA) throw new Error('El bubble del intento fallido de A no tiene botón "Save"')

      const heldAWrite = holdWriteFile((path) => path === fileA.path)
      let releaseAWrite: (() => void) | null = heldAWrite.release
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})
      try {
        failNextWriteFile((path) => path === fileA.path, () => {
          throw new Error("N687 injected Annotation write failure")
        })
        await act(async () => saveA.click())
        await heldAWrite.started
        expect(
          writeFileCalls().filter((call) => call.path === fileA.path).at(-1)?.content,
          "control positivo: el write retenido contiene la Annotation que va a fallar",
        ).toContain(failedNoteA)

        await pointerClick(document.querySelector<HTMLElement>(`[data-editor-tab-id="${tabB.id}"]`)!)
        expect(
          getEditorSessionState().session.active_tab_id,
          "B espera mientras el write fallido de A sigue en vuelo",
        ).toBe(tabA.id)
        releaseAWrite()
        releaseAWrite = null

        await waitFor(
          () => errors.mock.calls.some(([message]) => message === "[editor:save] local save failed") || null,
          { label: "completion event confirma el fallo del write de Annotation", timeoutMs: 10_000 },
        )
        expect(await readFile(fileA.path, "utf8"), "el write fallido no llega al archivo de A").not.toContain(
          failedNoteA,
        )
        expect(await readFile(fileB.path, "utf8"), "el write fallido de A no contamina B").not.toContain(
          failedNoteA,
        )
        expect(getEditorSessionState().session.active_tab_id).toBe(tabA.id)

        // The failed completion is logged, but currently leaves A in `saving`.
        // Keep this expected failure until useEditorPersistence reports the
        // completion through the session owner; no production code is changed here.
        expect(
          getEditorSessionState().session.tabs.find((tab) => tab.id === tabA.id)?.save_state,
          "completion error must leave A in error instead of saving",
        ).toBe("error")
      } finally {
        releaseAWrite?.()
        errors.mockRestore()
      }
    },
    TEST_TIMEOUT_MS,
  )

})
