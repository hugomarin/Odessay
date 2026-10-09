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

import {
  projectAnnotationsToCleanMarkdown,
  scanControlledAnnotations,
} from "@/lib/editor/annotation-markdown"
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
vi.mock("@/lib/editor/persistence-coordinator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editor/persistence-coordinator")>()
  const { recordPersistenceCoordinator } = await import("./support/persistence-coordinator-capture")
  return {
    ...actual,
    createPersistenceCoordinator: (...args: Parameters<typeof actual.createPersistenceCoordinator>) => {
      const coordinator = actual.createPersistenceCoordinator(...args)
      recordPersistenceCoordinator(coordinator)
      return coordinator
    },
  }
})
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
  capturePersistenceCoordinators,
  clickNewArtifact,
  clickEditorTab,
  clickSelectionPopupAction,
  fillTextField,
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
let coordinatorCapture: ReturnType<typeof capturePersistenceCoordinators> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-annotation-roundtrip-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  coordinatorCapture = capturePersistenceCoordinators()
})

afterEach(async () => {
  coordinatorCapture?.stop()
  coordinatorCapture = null
  await mounted?.unmount()
  mounted = null
})

async function settlePersistence(label: string) {
  if (!coordinatorCapture) throw new Error("PersistenceCoordinator capture no está activo")
  if (!(await coordinatorCapture.settle())) throw new Error(`settle no confirmó la escritura durable: ${label}`)
}

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
  await waitFor(
    () => (label === "Markdown" ? markdownSource() : !markdownSource() && mounted!.prosemirror()),
    { label: `editor en modo ${label}`, timeoutMs: 20_000 },
  )
}

function markdownSource() {
  return mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
}

async function pressEditorHistoryShortcut(key: "z", shift = false) {
  const mac = /Mac/i.test(navigator.platform || navigator.userAgent)
  await act(async () => {
    mounted!.editor().view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        shiftKey: shift,
        metaKey: mac,
        ctrlKey: !mac,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
}

async function replaceMarkdownSource(value: string) {
  const textarea = await waitFor(() => markdownSource(), {
    label: "textarea Markdown antes de reemplazar el Source",
    timeoutMs: 20_000,
  })
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await waitFor(() => {
    const updated = markdownSource()
    return updated?.value === value ? updated : null
  }, {
    label: "textarea Markdown adopta el Source editado",
    timeoutMs: 20_000,
  })
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
    await settlePersistence("documento base antes de seleccionar la Annotation")

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
    await waitFor(() => (readEditorAnnotations().marks.length === 1 ? true : null), {
      label: "Save aplica la marca Annotation en la shell real",
      timeoutMs: 20_000,
    })

    expect(readEditorAnnotations().marks, "ANN-02: la marca cubre el rango seleccionado").toEqual([
      { from: target.from, to: target.to, text: TARGET, type: "ai" },
    ])

    // Completion event: el .md en disco tiene el texto anclado y el marcador.
    const file = await waitForMarkdownContaining(NOTE)
    await settlePersistence("Annotation durable antes de salir del documento")
    const durableContents = await readFile(file.path, "utf8")
    const annotations = scanControlledAnnotations(durableContents)
    expect(annotations.diagnostics, "el .md no tiene diagnósticos de anotación").toEqual([])
    expect(annotations.annotations, "el .md lleva una anotación canónica con tipo, nota y ancla").toEqual([
      expect.objectContaining({ type: "ai", index: 1, comment: NOTE, anchorText: TARGET }),
    ])
    const [annotation] = annotations.annotations
    expect(annotation.id, "la identidad inline se acuña antes de guardar").toBeTruthy()
    expect(durableContents.slice(annotation.anchorStart, annotation.anchorEnd), "el rango anclado se conserva").toBe(
      TARGET,
    )

    // Reabrir: shell nueva con la sesión vacía; solo queda lo que hay en disco.
    await mounted.unmount()
    await writeEditorSession(createEmptyEditorSession())
    resetEditorShellWorld({ isDesktop: true })
    mounted = await mountEditorShell({ writingId })
    await waitFor(() => getEditorSessionState().loaded, { label: "sesión vacía cargada" })
    await waitForHydrationReady("anotación lista tras reabrir desde el `.md`")
    try {
      await waitFor(() => mounted!.editor().getText().includes("ODE606"), {
        label: "reapertura desde el .md",
        timeoutMs: 20_000,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `${message}; estado de reapertura: ${JSON.stringify(reopenedEditorState(writingId))}`,
      )
    }
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
    await settlePersistence("edición posterior a reopen")
    const reopenedDurableContents = await readFile(reopenedFile.path, "utf8")
    const reopenedSourceAnnotations = scanControlledAnnotations(reopenedDurableContents)
    expect(reopenedSourceAnnotations.diagnostics, "el `.md` sigue parseando después de reabrir").toEqual([])
    expect(reopenedSourceAnnotations.annotations.map(({ id }) => id)).toEqual([annotation.id])

    expect(await openNotesSidebar(), "ANN-03: el sidebar la lista").toEqual([
      { anchor: `“${TARGET}”`, body: NOTE, badge: "AI · 1" },
    ])
  }, TEST_TIMEOUT_MS)

  it("round-trips private Annotations inside Card and Tip through Source, Rich, and desktop reopen", async () => {
    const cardId = "n687-card-annotation-id"
    const tipId = "n687-tip-annotation-id"
    const cardComment = "N687_CARD_PRIVATE_SENTINEL"
    const tipComment = "N687_TIP_PRIVATE_SENTINEL"
    const cardAnchor = "N687CardAnchor"
    const tipAnchor = "N687TipAnchor"
    const source = [
      `<Card title="N687 Card">\nCard body <Annotation id="${cardId}" type="personal" comment="${cardComment}">${cardAnchor}</Annotation>.\n</Card>`,
      `<Tip title="N687 Tip">\nTip body <Annotation id="${tipId}" type="ai" comment="${tipComment}">${tipAnchor}</Annotation>.\n</Tip>`,
    ].join("\n\n")
    const expected = [
      expect.objectContaining({ id: cardId, type: "personal", comment: cardComment, anchorText: cardAnchor }),
      expect.objectContaining({ id: tipId, type: "ai", comment: tipComment, anchorText: tipAnchor }),
    ]

    mounted = await mountEditorShell()
    await clickNewArtifact(mounted.container)
    await typeInEditor("N687 nested annotation seed")
    const initialFile = await waitForMarkdownContaining("N687 nested annotation seed")
    const writingId = await waitForMaterializedWritingId()
    await settlePersistence("documento base de Card/Tip")

    await switchMode("Markdown")
    await replaceMarkdownSource(source)
    const sourceField = await waitFor(() => markdownSource(), {
      label: "Source Card/Tip disponible tras editar Markdown",
      timeoutMs: 20_000,
    })
    expect(sourceField.value, "control positivo: el Source contiene los sentinels privados").toContain(cardComment)
    expect(sourceField.value).toContain(tipComment)
    await switchMode("Rich")

    const savedFile = await waitForMarkdownContaining(cardComment)
    await settlePersistence("Annotation Card/Tip durable antes de verificar proyecciones")
    expect(savedFile.path, "el recorrido conserva el mismo documento desktop").toBe(initialFile.path)
    expect(savedFile.contents).toContain(tipComment)
    expect(savedFile.contents).toContain(`<Card title="N687 Card">`)
    expect(savedFile.contents).toContain(`<Tip title="N687 Tip">`)
    const savedScan = scanControlledAnnotations(savedFile.contents)
    expect(savedScan.diagnostics, "Card y Tip no producen diagnósticos de Annotation").toEqual([])
    expect(savedScan.annotations).toEqual(expected)

    await switchMode("Markdown")
    const richProjectionField = await waitFor(() => markdownSource(), {
      label: "Source reconstruido desde Rich antes de proyectar",
      timeoutMs: 20_000,
    })
    const richProjection = richProjectionField.value
    const richScan = scanControlledAnnotations(richProjection)
    expect(richScan.diagnostics).toEqual([])
    expect(richScan.annotations).toEqual(expected)
    const cleanProjection = projectAnnotationsToCleanMarkdown(richProjection)
    expect(cleanProjection.ok, "la proyección limpia acepta ambas anotaciones válidas").toBe(true)
    expect(cleanProjection.markdown).toContain(cardAnchor)
    expect(cleanProjection.markdown).toContain(tipAnchor)
    for (const privateValue of [cardId, tipId, cardComment, tipComment]) {
      expect(cleanProjection.markdown, `la proyección limpia excluye ${privateValue}`).not.toContain(privateValue)
    }
    await switchMode("Rich")

    // Reopen from the authoritative `.md`, then derive Source from the hydrated
    // Rich editor to prove the identity/comment survived parsing, not just disk.
    await mounted.unmount()
    mounted = null
    await writeEditorSession(createEmptyEditorSession())
    resetEditorShellWorld({ isDesktop: true })
    mounted = await mountEditorShell({ writingId })
    await waitFor(() => getEditorSessionState().loaded || null, { label: "sesión vacía lista para reopen" })
    await waitForHydrationReady("documento Card/Tip reabierto e hidratado")
    await waitFor(
      () =>
        mounted!.editor().getText().includes(cardAnchor) && mounted!.editor().getText().includes(tipAnchor),
      { label: "las dos anclas están en la shell reabierta", timeoutMs: 10_000 },
    )
    await switchMode("Markdown")
    const reopenedSourceField = await waitFor(() => markdownSource(), {
      label: "Source Card/Tip derivado de la shell reabierta",
      timeoutMs: 20_000,
    })
    const reopenedSource = reopenedSourceField.value
    const reopenedScan = scanControlledAnnotations(reopenedSource)
    expect(reopenedScan.diagnostics).toEqual([])
    expect(reopenedScan.annotations, "ID, comentario y ancla sobreviven al reopen en Card y Tip").toEqual(
      expected,
    )
    const reopenedClean = projectAnnotationsToCleanMarkdown(reopenedSource)
    expect(reopenedClean.ok).toBe(true)
    for (const privateValue of [cardId, tipId, cardComment, tipComment]) {
      expect(reopenedClean.markdown, `la proyección limpia reabierta excluye ${privateValue}`).not.toContain(
        privateValue,
      )
    }
  }, TEST_TIMEOUT_MS)

  it("preserves a nested collaborative Annotation when an invalid Card/Tip Annotation blocks pruning", async () => {
    const writingIdSeed = "N687 nested invalid annotation seed"
    const collaborativeId = "n687-card-tip-collaborative-id"
    const collaborativeComment = "N687_CARD_TIP_COLLABORATIVE_SENTINEL"
    const collaborativeAnchor = "N687CollaborativeAnchor"
    const invalidId = "n687-card-tip-invalid-id"
    const invalidAnnotation =
      `<Annotation id="${invalidId}" type="personal" comment="N687_INVALID_TIP_SENTINEL" extra="invalid">N687InvalidAnchor</Annotation>`
    const collaborativeAnnotation =
      `<Annotation id="${collaborativeId}" type="personal" comment="${collaborativeComment}">${collaborativeAnchor}</Annotation>`
    const source = [
      `<Card title="N687 collaborative control">\n${collaborativeAnnotation}\n</Card>`,
      `<Tip title="N687 invalid Annotation">\nTip before ${invalidAnnotation} after.\n</Tip>`,
    ].join("\n\n")
    const collaborativeControl = expect.objectContaining({
      id: collaborativeId,
      type: "personal",
      comment: collaborativeComment,
      anchorText: collaborativeAnchor,
    })

    mounted = await mountEditorShell()
    await clickNewArtifact(mounted.container)
    await typeInEditor(writingIdSeed)
    const initialFile = await waitForMarkdownContaining(writingIdSeed)
    const writingId = await waitForMaterializedWritingId()
    await settlePersistence("documento base del control invalid-no-prune")

    await switchMode("Markdown")
    await replaceMarkdownSource(source)
    const sourceField = await waitFor(() => markdownSource(), {
      label: "Source anidado listo con sentinel colaborativo e invalid Annotation",
      timeoutMs: 20_000,
    })
    expect(sourceField.value, "control positivo: el sentinel colaborativo está presente antes de proyectar").toContain(
      collaborativeComment,
    )
    expect(scanControlledAnnotations(sourceField.value).annotations).toContainEqual(collaborativeControl)
    await switchMode("Rich")

    expect(opaqueSourceNodes(), "Tip conserva la Annotation inválida como source opaco").toContainEqual(
      expect.objectContaining({
        type: OPAQUE_SOURCE_INLINE_NODE,
        raw: invalidAnnotation,
        reason: "invalid-attributes",
      }),
    )
    const savedFile = await waitForMarkdownContaining(invalidAnnotation)
    await settlePersistence("Source inválido Card/Tip durable en el `.md`")
    expect(savedFile.path, "la escritura usa el `.md` original").toBe(initialFile.path)
    const invalidStart = savedFile.contents.indexOf(invalidAnnotation)
    expect(invalidStart, "el `.md` durable conserva la Annotation inválida").toBeGreaterThanOrEqual(0)
    expect(savedFile.contents.slice(invalidStart, invalidStart + invalidAnnotation.length)).toBe(invalidAnnotation)

    const savedScan = scanControlledAnnotations(savedFile.contents)
    expect(savedScan.annotations, "el `.md` conserva la Annotation colaborativa válida").toContainEqual(
      collaborativeControl,
    )
    expect(savedScan.diagnostics.length, "la Annotation inválida sigue bloqueando la proyección").toBeGreaterThan(0)
    const blockedProjection = projectAnnotationsToCleanMarkdown(savedFile.contents)
    expect(blockedProjection.ok).toBe(false)
    expect(blockedProjection.markdown, "un parse inválido no poda el sentinel colaborativo ni los bytes raw").toBe(
      savedFile.contents,
    )

    await mounted.unmount()
    mounted = null
    await writeEditorSession(createEmptyEditorSession())
    resetEditorShellWorld({ isDesktop: true })
    mounted = await mountEditorShell({ writingId })
    await waitForHydrationReady("Card/Tip inválido reabierto e hidratado")
    await waitFor(
      () =>
        mounted!.editor().getText().includes(collaborativeAnchor) &&
        mounted!.editor().getText().includes("N687InvalidAnchor"),
      { label: "Card y Tip conservaron sus anclas tras la reapertura", timeoutMs: 20_000 },
    )
    await switchMode("Markdown")
    const reopenedSource = await waitFor(() => markdownSource(), {
      label: "Source del `.md` reabierto disponible",
      timeoutMs: 20_000,
    })
    expect(reopenedSource.value).toContain(invalidAnnotation)
    expect(reopenedSource.value).toContain(collaborativeComment)
    const reopenedScan = scanControlledAnnotations(reopenedSource.value)
    expect(reopenedScan.annotations).toContainEqual(collaborativeControl)
    expect(reopenedScan.diagnostics.length).toBeGreaterThan(0)
    const reopenedProjection = projectAnnotationsToCleanMarkdown(reopenedSource.value)
    expect(reopenedProjection.ok).toBe(false)
    expect(reopenedProjection.markdown).toBe(reopenedSource.value)
  }, TEST_TIMEOUT_MS)

  it("undoes and redoes an Annotation in the real desktop shell", async () => {
    const text = "N687 reversible annotation anchor"
    const target = "reversible annotation"
    const comment = "N687_UNDO_PRIVATE_NOTE"
    mounted = await mountEditorShell()
    await clickNewArtifact(mounted.container)
    await typeInEditor(text)
    const initialFile = await waitForMarkdownContaining(text)
    const writingId = await waitForMaterializedWritingId()
    await settlePersistence("documento base antes del historial Annotation")
    await waitForHydrationReady("anotación lista para probar el historial")

    await selectEditorText(target)
    await clickSelectionPopupAction("Annotate passage")
    const field = await waitFor(
      () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Annotation text"]'),
      { label: "AnnotationBubble para la prueba de undo/redo" },
    )
    await fillTextField(field, comment)
    const save = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Save",
    )
    if (!save) throw new Error('El bubble no tiene botón "Save"')
    save.click()

    const firstSave = await waitForMarkdownContaining(comment)
    await settlePersistence("Annotation durable antes de undo")
    const firstContents = await readFile(firstSave.path, "utf8")
    const firstAnnotation = scanControlledAnnotations(firstContents).annotations[0]
    expect(firstAnnotation, "control positivo: la Annotation quedó guardada").toMatchObject({
      comment,
      anchorText: target,
    })
    expect(firstAnnotation.id).toBeTruthy()

    const writesBeforeUndo = writeFileCalls().filter((call) => call.path === firstSave.path).length
    await pressEditorHistoryShortcut("z")
    await waitFor(() => (readEditorAnnotations().marks.length === 0 ? true : null), {
      label: "undo real quita la marca Annotation del editor",
    })
    await waitFor(
      () =>
        writeFileCalls()
          .filter((call) => call.path === firstSave.path)
          .slice(writesBeforeUndo)
          .some((call) => typeof call.content === "string" && !call.content.includes(comment)) || null,
      { label: "el snapshot de undo llega al writer de `.md`", timeoutMs: 20_000 },
    )
    await settlePersistence("undo Annotation")
    const undoneFile = await readFile(firstSave.path, "utf8")
    expect(scanControlledAnnotations(undoneFile).annotations, "undo real queda durable en el `.md`").toEqual([])
    expect(undoneFile).toContain(target)
    expect(undoneFile).not.toContain(comment)

    const writesBeforeRedo = writeFileCalls().filter((call) => call.path === firstSave.path).length
    await pressEditorHistoryShortcut("z", true)
    await waitFor(() => (readEditorAnnotations().marks.length === 1 ? true : null), {
      label: "redo real restaura la marca Annotation del editor",
    })
    await waitFor(
      () =>
        writeFileCalls()
          .filter((call) => call.path === firstSave.path)
          .slice(writesBeforeRedo)
          .some(
            (call) =>
              typeof call.content === "string" &&
              call.content.includes(firstAnnotation.id) &&
              call.content.includes(comment),
          ) || null,
      { label: "el snapshot de redo llega al writer de `.md`", timeoutMs: 20_000 },
    )
    await settlePersistence("redo Annotation")
    const redoneFile = await readFile(firstSave.path, "utf8")
    expect(
      scanControlledAnnotations(redoneFile).annotations.some((annotation) => annotation.id === firstAnnotation.id),
      "redo real restaura ID y comentario en el `.md`",
    ).toBe(true)
    const redoneAnnotation = scanControlledAnnotations(redoneFile).annotations[0]
    expect(redoneAnnotation).toMatchObject({
      id: firstAnnotation.id,
      comment,
      anchorText: target,
    })
    expect(readEditorAnnotations().marks).toEqual([
      expect.objectContaining({ text: target, type: "ai" }),
    ])
    expect(writingId, "el historial se guarda bajo el UUID original").toBeTruthy()
    expect(initialFile.path).toBe(firstSave.path)
  }, TEST_TIMEOUT_MS)

  it("keeps an Annotation save on A while the real shell waits to activate B", async () => {
    const textA = "N687 document A with an A anchor"
    const textB = "N687 document B with a B anchor"
    const noteA = "N687_A_PRIVATE_NOTE"
    const noteB = "N687_B_PRIVATE_NOTE"
    mounted = await mountEditorShell()

    await clickNewArtifact(mounted.container)
    await typeInEditor(textA)
    const fileA = await waitForMarkdownContaining(textA)
    const writingA = await waitForMaterializedWritingId()
    await settlePersistence("documento A antes de abrir B")

    await clickNewArtifact(mounted.container)
    await typeInEditor(textB)
    const fileB = await waitForMarkdownContaining(textB)
    const writingB = await waitForMaterializedWritingId()
    await settlePersistence("documento B antes de cambiar a A")
    expect(fileB.path).not.toBe(fileA.path)

    await clickEditorTab(writingA)
    await waitForHydrationReady("A listo para guardar su Annotation")
    const tabA = getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingA)
    const tabB = getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingB)
    if (!tabA || !tabB) throw new Error("A y B deben estar montados en pestañas reales")

    await selectEditorText("A anchor")
    await clickSelectionPopupAction("Annotate passage")
    const fieldA = await waitFor(
      () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Annotation text"]'),
      { label: "AnnotationBubble real de A" },
    )
    await fillTextField(fieldA, noteA)
    const saveA = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Save",
    )
    if (!saveA) throw new Error('El bubble de A no tiene botón "Save"')

    const heldAWrite = holdWriteFile((path) => path === fileA.path)
    let releaseAWrite: (() => void) | null = heldAWrite.release
    try {
      await act(async () => saveA.click())
      await heldAWrite.started
      const heldCall = writeFileCalls().filter((call) => call.path === fileA.path).at(-1)
      expect(heldCall?.content, "control positivo: el write retenido pertenece a A y contiene su nota").toContain(
        noteA,
      )

      const tabNode = document.querySelector<HTMLElement>('[data-editor-tab-id="' + tabB.id + '"]')
      if (!tabNode) throw new Error("La pestaña real de B no está en el DOM")
      await pointerClick(tabNode)
      expect(
        getEditorSessionState().session.active_tab_id,
        "la salida de A espera a que su archivo confirme la escritura retenida",
      ).toBe(tabA.id)
      expect(
        await readFile(fileB.path, "utf8"),
        "el archivo de B permanece intacto durante el write de A",
      ).not.toContain(noteA)

      releaseAWrite()
      releaseAWrite = null
      await settlePersistence("Annotation A antes de activar B")
      const savedA = await readFile(fileA.path, "utf8")
      expect(
        scanControlledAnnotations(savedA).annotations.some((annotation) => annotation.comment === noteA),
        "la Annotation A queda durable en el `.md` de A",
      ).toBe(true)
      await waitFor(() => getEditorSessionState().session.active_tab_id === tabB.id || null, {
        label: "B se activa tras la escritura durable de A",
        timeoutMs: 20_000,
      })
      await waitForHydrationReady("B listo tras el save durable de A")
      expect(scanControlledAnnotations(savedA).annotations[0]).toMatchObject({
        comment: noteA,
        anchorText: "A anchor",
      })

      await selectEditorText("B anchor")
      await clickSelectionPopupAction("Annotate passage")
      const fieldB = await waitFor(
        () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Annotation text"]'),
        { label: "AnnotationBubble real de B como control positivo" },
      )
      await fillTextField(fieldB, noteB)
      const saveB = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Save",
      )
      if (!saveB) throw new Error('El bubble de B no tiene botón "Save"')
      await act(async () => saveB.click())
      await settlePersistence("Annotation B control positivo")
      const savedB = await readFile(fileB.path, "utf8")
      expect(
        scanControlledAnnotations(savedB).annotations.some((annotation) => annotation.comment === noteB),
        "la Annotation positiva de B queda durable en el `.md` de B",
      ).toBe(true)
      expect(scanControlledAnnotations(savedB).annotations[0]).toMatchObject({
        comment: noteB,
        anchorText: "B anchor",
      })
      expect(savedB).not.toContain(noteA)
      expect(
        scanControlledAnnotations(await readFile(fileA.path, "utf8")).annotations.map((entry) => entry.comment),
      ).toEqual([noteA])
    } finally {
      releaseAWrite?.()
    }
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
    await settlePersistence("Annotation inválida y edición adyacente durable")
    expect(savedFile.path, "el Rich edit guarda sobre el mismo documento").toBe(initialFile.path)
    const invalidStart = savedFile.contents.indexOf(invalidAnnotation)
    expect(invalidStart, "el .md materializado conserva el tag inválido").toBeGreaterThanOrEqual(0)
    expect(savedFile.contents.slice(invalidStart, invalidStart + invalidAnnotation.length)).toBe(invalidAnnotation)

    await mounted.unmount()
    await writeEditorSession(createEmptyEditorSession())
    resetEditorShellWorld({ isDesktop: true })
    mounted = await mountEditorShell({ writingId })
    await waitForHydrationReady("source inválido reabierto e hidratado")
    await waitFor(() => mounted!.editor().getText().includes("ODE531 source before"), {
      label: "source desktop reabierto desde el .md",
      timeoutMs: 20_000,
    })

    expect(opaqueSourceNodes(), "la reapertura reconstruye el mismo source opaco").toEqual([
      expect.objectContaining({ type: OPAQUE_SOURCE_INLINE_NODE, raw: invalidAnnotation, reason: "invalid-attributes" }),
    ])
    const reopenedFile = await waitForMarkdownContaining("after-opaque")
    expect(reopenedFile.contents, "el .md en disco mantiene exactamente los bytes guardados").toBe(savedFile.contents)
  }, TEST_TIMEOUT_MS)
})
