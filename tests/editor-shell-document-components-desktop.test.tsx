/**
 * @vitest-environment happy-dom
 *
 * Fase 12 — R01/R12 (docs/design/document-components/release-test-plan.md):
 * un documento con componentes atraviesa Source → Rich → edición → `.md` en
 * disco → reapertura desde disco sin perder kind, atributos, cuerpo ni el
 * source que Rich no sabe editar; y alternar de modo sin editar no escribe.
 *
 * Por qué en la shell y en desktop: en desktop la autoridad es el `.md`
 * materializado (ADR de identidad), así que cada componente cruza el
 * serializador canónico y el parser al guardar y al reabrir. Los tests del
 * adapter (`document-components-rich-preservation.test.ts`) prueban el seam
 * aislado; este prueba que la shell lo usa en su camino real de hidratación,
 * guardado y reapertura.
 *
 * Camino de producción: "New Artifact" real; textarea real "Markdown source"
 * y botones reales "Rich"/"Markdown" de la status bar; escritura real en
 * TipTap; guardado real a un directorio temporal (`DesktopDocumentService` +
 * `FilesystemDocumentService`); reapertura con shell nueva, sesión vacía y el
 * UUID del documento.
 *
 * Completion events: los bytes del `.md` en disco tras vencer los debounces;
 * el editor reabierto cuando ya muestra el texto; el recuento de escrituras
 * al archivo tras dejar vencer la ventana completa de guardado.
 *
 * Mutation tests (verificados en vivo al crear este archivo):
 *   - `materializeOpaqueSourceForRichParser` devolviendo el markdown sin
 *     tocar → rojo: el `.md` pierde `<ProtectedText>`, `<Entity>` inválido y
 *     `<FuturePanel>` tras la edición en Rich.
 *   - el serializador de Card sin atributos → rojo: el `.md` pierde
 *     `title/icon/href` y la reapertura no restaura los atributos.
 */
import { readFileSync } from "node:fs"
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

const { act } = await import("react")
const {
  advance,
  capturePersistenceCoordinators,
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  readEditorAnnotations,
  selectEditorText,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const {
  createDesktopWorkspace,
  destroyDesktopWorkspace,
  desktopWorkspaceRoot,
  readWorkspaceMarkdown,
  resetDesktopWorkspace,
} =
  await import("./support/editor-shell-desktop-doubles")
const {
  catalogMutationsDouble,
  holdWriteFile,
  writeFileCalls,
} = await import("./integration/documents/support/real-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

const TEST_TIMEOUT_MS = 90_000
const SAVE_WINDOW_MS = DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000
const DB_PATH_SUFFIX = "config/desktop-index.sqlite3"

const MASTER_SOURCE = readFileSync("tests/fixtures/document-components/valid/master.md", "utf8")
const MASTER_SEED = "DOC_COMPONENT_MASTER_SEED"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let coordinatorCapture: ReturnType<typeof capturePersistenceCoordinators> | null = null
let releasePendingWrite: (() => void) | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-document-components-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  releasePendingWrite?.()
  releasePendingWrite = null
  coordinatorCapture?.stop()
  coordinatorCapture = null
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

function activeWritingId() {
  const { session } = getEditorSessionState()
  const writingId = session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id
  return writingId && writingId !== EDITOR_DRAFT_TAB_ID ? writingId : null
}

async function switchMode(label: "Rich" | "Markdown") {
  const button = await waitFor(
    () =>
      Array.from(
        mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
      ).find((candidate) => (candidate.textContent ?? "").trim() === label),
    { label: `botón "${label}" de la status bar` },
  )
  await act(async () => {
    button.click()
  })
  await flush(2)
  await waitFor(() => (label === "Markdown" ? markdownSource() : !markdownSource() && mounted!.prosemirror()), {
    label: `el editor en modo ${label}`,
  })
}

function markdownSource() {
  return mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
}

/** Reemplaza el contenido del textarea real de Markdown, como lo recibe el `onChange` de React. */
async function replaceMarkdownSource(value: string) {
  const textarea = markdownSource()
  if (!textarea) throw new Error("El editor no está en modo Markdown")
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush(1)
}

async function contentsOf(path: string) {
  const files = await readWorkspaceMarkdown()
  return files.find((file) => file.path === path)?.contents ?? ""
}

type JsonNode = { type?: string; attrs?: Record<string, unknown>; content?: JsonNode[] }

function richNodesOfType(type: string) {
  const found: Array<{ attrs: Record<string, unknown> }> = []
  const visit = (node: JsonNode) => {
    if (node.type === type) found.push({ attrs: node.attrs ?? {} })
    for (const child of node.content ?? []) visit(child)
  }
  visit(mounted!.editor().getJSON() as JsonNode)
  return found
}

/**
 * Deja el cursor justo después de `needle`, una posición de texto que el
 * usuario alcanza con un click. (Un documento que termina en un bloque
 * preservado no tiene posición de texto al final: `focus("end")` lo
 * seleccionaría y escribir lo reemplazaría, como con un `---` final.)
 */
async function placeCaretAfter(needle: string) {
  const target = await selectEditorText(needle)
  await act(async () => {
    mounted!.editor().commands.focus()
    mounted!.editor().commands.setTextSelection(target.to)
  })
  await flush(1)
}

/** Documento real con identidad, el maestro escrito en Source y vuelto a Rich. */
async function createMasterDocument() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  await clickNewArtifact(mounted.container)
  await typeInEditor(MASTER_SEED)
  await advance(SAVE_WINDOW_MS)
  const file = await waitForMarkdownContaining(MASTER_SEED)
  const writingId = await waitFor(activeWritingId, { label: "pestaña activa con identidad", timeoutMs: 15_000 })

  await switchMode("Markdown")
  await replaceMarkdownSource(MASTER_SOURCE)
  await switchMode("Rich")
  await advance(SAVE_WINDOW_MS)
  const canonicalized = await waitForMarkdownContaining(MASTER_SEED)
  expect(canonicalized.path).toBe(file.path)
  return { file, writingId, canonicalized: canonicalized.contents }
}

describe("Fase 12 — R01/R12: componentes por Source, Rich, disco y reapertura (desktop)", () => {
  it(
    "Card y Tip conservan atributos/cuerpo y una edición Rich no altera el source ya canonicalizado",
    async () => {
      const { file, canonicalized } = await createMasterDocument()

      // Source → Rich → disco cruza el parser y serializador reales con el
      // corpus compartido. El primer guardado es su única canonicalización.
      expect(await contentsOf(file.path)).toBe(canonicalized)

      // Estado intermedio en Rich: los kinds habilitados son nodos y el resto
      // del source sigue recuperable sin ejecutar ni normalizarlo.
      expect(richNodesOfType("card")).toHaveLength(1)
      expect(richNodesOfType("card").map((node) => node.attrs)).toEqual([
        expect.objectContaining({
          title: "Card maestro",
          icon: "star",
          href: "https://example.com/master?a=1&b=2",
        }),
      ])
      expect(richNodesOfType("tip").map((node) => node.attrs)).toEqual([
        expect.objectContaining({ title: "Tip maestro" }),
      ])
      expect(richNodesOfType("info").map((node) => node.attrs)).toEqual([
        expect.objectContaining({ title: "Info maestra" }),
      ])
      expect(mounted!.editor().getText()).toContain("CARD_BODY_MASTER")
      expect(mounted!.editor().getText()).toContain("TIP_BODY_MASTER")
      expect(mounted!.editor().getText()).toContain("INFO_BODY_MASTER")
      const opaqueRaw = [...richNodesOfType("opaqueSource"), ...richNodesOfType("opaqueSourceBlock")].map(
        (node) => String(node.attrs.raw ?? ""),
      )
      expect(opaqueRaw.some((raw) => raw.includes("OPAQUE_PROTECTED_MASTER"))).toBe(true)
      expect(opaqueRaw.some((raw) => raw.includes("OPAQUE_FUTURE_MASTER"))).toBe(true)
      expect(opaqueRaw.some((raw) => raw.includes("OPAQUE_INVALID_ATTRS_MASTER"))).toBe(true)
      expect(opaqueRaw.some((raw) => raw.includes("<Widget mode=\"future\" />"))).toBe(true)

      // Edición adyacente en Rich: obliga a serializar todo el documento desde body_json.
      await placeCaretAfter(MASTER_SEED)
      await typeInEditor(" R01_EDIT")
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("R01_EDIT")

      const saved = await contentsOf(file.path)
      expect(saved).toBe(canonicalized.replace(MASTER_SEED, `${MASTER_SEED} R01_EDIT`))
      expect(await readWorkspaceMarkdown(), "sin crear otro archivo").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "reabrir desde disco restaura los componentes, y alternar de modo sin editar no escribe",
    async () => {
      const { file, writingId, canonicalized } = await createMasterDocument()
      const savedBefore = await contentsOf(file.path)
      expect(savedBefore, "control: el maestro ya está en disco").toBe(canonicalized)

      // Reabrir: shell nueva con la sesión vacía; solo queda lo que hay en disco.
      await mounted!.unmount()
      await writeEditorSession(createEmptyEditorSession())
      resetEditorShellWorld({ isDesktop: true })
      mounted = await mountEditorShell({ writingId })
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión vacía cargada" })
      await waitFor(() => mounted!.editor().getText().includes("CARD_BODY_MASTER"), {
        label: "reapertura desde el .md",
        timeoutMs: 15_000,
      })
      await advance(SAVE_WINDOW_MS)

      expect(richNodesOfType("card").map((node) => node.attrs)).toEqual([
        expect.objectContaining({
          title: "Card maestro",
          icon: "star",
          href: "https://example.com/master?a=1&b=2",
        }),
      ])
      expect(mounted!.editor().getText()).toContain("INFO_BODY_MASTER")

      // R01: Rich → Markdown → Rich sin editar no reescribe contenido ni versión.
      const sessionBefore = getEditorSessionState().session
      const activeTabBefore = sessionBefore.tabs.find((tab) => tab.id === sessionBefore.active_tab_id)
      expect(activeTabBefore?.writing_id).toBe(writingId)
      const editorBefore = mounted!.editor()
      const documentBefore = editorBefore.state.doc
      const selectionBefore = {
        from: editorBefore.state.selection.from,
        to: editorBefore.state.selection.to,
      }
      const writesBefore = writeFileCalls().filter((call) => call.path === file.path).length
      const catalog = await getDocumentCatalog()
      const versionBefore = (await catalog.getById(writingId))?.version
      const mutationsBefore = catalogMutationsDouble(
        `${desktopWorkspaceRoot()}/${DB_PATH_SUFFIX}`,
      )
        .filter((mutation) => mutation.documentId === writingId)
        .map((mutation) => mutation.id)
        .sort()
      await switchMode("Markdown")
      expect(markdownSource()?.value, "Source muestra los bytes del disco").toBe(savedBefore.replace(/(?:\r?\n)+$/, ""))
      await switchMode("Rich")
      await advance(SAVE_WINDOW_MS)
      const versionAfter = (await catalog.getById(writingId))?.version
      expect(
        writeFileCalls().filter((call) => call.path === file.path).length,
        "un toggle limpio no escribe el archivo",
      ).toBe(writesBefore)
      expect(await contentsOf(file.path)).toBe(savedBefore)
      expect(versionAfter, "un toggle limpio no cambia la versión durable").toBe(versionBefore)
      const sessionAfter = getEditorSessionState().session
      const activeTabAfter = sessionAfter.tabs.find((tab) => tab.id === sessionAfter.active_tab_id)
      expect(sessionAfter.active_tab_id, "el toggle conserva la pestaña activa").toBe(sessionBefore.active_tab_id)
      expect(activeTabAfter?.writing_id, "el toggle conserva la identidad documental").toBe(writingId)
      expect(mounted!.editor().state.doc, "el toggle conserva el mismo documento Rich").toBe(documentBefore)
      expect(mounted!.editor().state.selection).toMatchObject(selectionBefore)
      expect(
        catalogMutationsDouble(`${desktopWorkspaceRoot()}/${DB_PATH_SUFFIX}`)
          .filter((mutation) => mutation.documentId === writingId)
          .map((mutation) => mutation.id)
          .sort(),
        "un toggle limpio no agrega una mutación de sync",
      ).toEqual(mutationsBefore)

      // Control positivo del recuento: una edición real sí escribe.
      await placeCaretAfter(MASTER_SEED)
      await typeInEditor(" R02_CONTROL")
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("R02_CONTROL")
      expect(writeFileCalls().filter((call) => call.path === file.path).length).toBeGreaterThan(writesBefore)
      const after = await contentsOf(file.path)
      expect(after).toBe(canonicalized.replace(MASTER_SEED, `${MASTER_SEED} R02_CONTROL`))
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "Source editado antes del debounce gana sobre un write retenido y ninguna escritura posterior queda obsoleta",
    async () => {
      coordinatorCapture = capturePersistenceCoordinators()
      const { file } = await createMasterDocument()
      const baseline = writeFileCalls().filter((call) => call.path === file.path).length
      const writesSinceBaseline = () =>
        writeFileCalls().filter((call) => call.path === file.path).slice(baseline)
      const held = holdWriteFile((path) => path === file.path)
      releasePendingWrite = held.release

      await placeCaretAfter(MASTER_SEED)
      await typeInEditor(" PRE_HOLD_COMPONENT_WRITE")
      await advance(SAVE_WINDOW_MS)
      await held.started
      expect(writesSinceBaseline(), "control positivo: un write real queda retenido").toHaveLength(1)
      expect(writesSinceBaseline()[0]?.content).toContain("PRE_HOLD_COMPONENT_WRITE")

      // El Source cambia title/body/attrs y vuelve a Rich antes de los 800 ms
      // del debounce de Markdown, mientras el write anterior sigue en vuelo.
      await switchMode("Markdown")
      const sourceEdited = MASTER_SOURCE
        .replace(MASTER_SEED, `${MASTER_SEED} PRE_HOLD_COMPONENT_WRITE`)
        .replace('title="Card maestro"', 'title="Card editado en Source"')
        .replace('icon="star"', 'icon="heart"')
        .replace("CARD_BODY_MASTER", "CARD_SOURCE_EDIT")
      await replaceMarkdownSource(sourceEdited)
      await switchMode("Rich")
      expect(richNodesOfType("card").map((node) => node.attrs)).toEqual([
        expect.objectContaining({ title: "Card editado en Source", icon: "heart" }),
      ])
      expect(mounted!.editor().getText()).toContain("CARD_SOURCE_EDIT")

      // Positivo: la Rich edit posterior también es parte del documento final.
      await placeCaretAfter("CARD_SOURCE_EDIT")
      await typeInEditor(" RICH_FINAL_COMPONENT_EDIT")
      await advance(SAVE_WINDOW_MS)
      held.release()
      releasePendingWrite = null
      expect(await coordinatorCapture.settle(), "el settle termina todo el trabajo de este documento").toBe(true)

      const writes = writesSinceBaseline()
      expect(writes.length, "el snapshot actualizado se escribe después del retenido").toBeGreaterThanOrEqual(2)
      for (const write of writes.slice(1)) {
        expect(write.content).toContain("Card editado en Source")
        expect(write.content).toContain('icon="heart"')
        expect(write.content).toContain("CARD_SOURCE_EDIT")
        expect(write.content).toContain("RICH_FINAL_COMPONENT_EDIT")
      }
      const final = await contentsOf(file.path)
      expect(final).toContain("Card editado en Source")
      expect(final).toContain("CARD_SOURCE_EDIT")
      expect(final).toContain("RICH_FINAL_COMPONENT_EDIT")
      expect(final).not.toContain('title="Card maestro"')

      const finalWriteCount = writesSinceBaseline().length
      await advance(SAVE_WINDOW_MS)
      expect(await coordinatorCapture.settle()).toBe(true)
      expect(writesSinceBaseline(), "no callback antiguo reescribe tras completar el settle").toHaveLength(
        finalWriteCount,
      )
      expect(await contentsOf(file.path)).toBe(final)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "future/invalid source queda opaco, no poda anotaciones ni impide editar el texto válido adyacente",
    async () => {
      const { file, writingId } = await createMasterDocument()
      const annotationsBefore = readEditorAnnotations()
      const opaqueBefore = [
        ...richNodesOfType("opaqueSource"),
        ...richNodesOfType("opaqueSourceBlock"),
      ].map((node) => String(node.attrs.raw ?? ""))
      expect(annotationsBefore.marks, "control positivo: el maestro contiene anotaciones a ambos lados de source opaco").toEqual([
        expect.objectContaining({ text: "frase anotada á", type: "personal" }),
        expect.objectContaining({ text: "ANNOTATION_AFTER_INVALID_MASTER", type: "personal" }),
      ])
      expect(annotationsBefore.references).toEqual([
        expect.objectContaining({ type: "personal", text: "Revisar ✓" }),
        expect.objectContaining({ type: "personal", text: "after opaque" }),
      ])
      expect(opaqueBefore.some((raw) => raw.includes("OPAQUE_INVALID_ATTRS_MASTER"))).toBe(true)
      expect(opaqueBefore.some((raw) => raw.includes("<Widget mode=\"future\" />"))).toBe(true)

      // Source contiene futuro, attrs inválidos, JSX y un tag sin cierre.
      // Cambiar el texto válido anterior no debe disparar el prune de marks.
      await switchMode("Markdown")
      const sourceEdited = MASTER_SOURCE.replace(
        "TAIL_MASTER remains editable",
        "TAIL_R5_SOURCE_EDIT remains editable",
      )
      await replaceMarkdownSource(sourceEdited)
      await switchMode("Rich")
      const annotationsAfter = readEditorAnnotations()
      expect(annotationsAfter.marks.map(({ text, type }) => ({ text, type }))).toEqual(
        annotationsBefore.marks.map(({ text, type }) => ({ text, type })),
      )
      expect(annotationsAfter.references.map(({ text, type }) => ({ text, type }))).toEqual(
        annotationsBefore.references.map(({ text, type }) => ({ text, type })),
      )
      expect(mounted!.editor().getText()).toContain("TAIL_R5_SOURCE_EDIT")

      // Control positivo de edición Rich: el contenido adyacente sí se guarda.
      await placeCaretAfter("TAIL_R5_SOURCE_EDIT")
      await typeInEditor(" TAIL_R5_RICH_EDIT")
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("TAIL_R5_RICH_EDIT")
      const saved = await contentsOf(file.path)
      const savedWithCanonicalLineEndings = saved.replace(/\r\n?/g, "\n")
      for (const raw of opaqueBefore) {
        expect(savedWithCanonicalLineEndings, "ningún source opaco cambia al guardar un vecino válido").toContain(
          raw.replace(/\r\n?/g, "\n"),
        )
      }
      const savedAnnotations = readEditorAnnotations()
      expect(savedAnnotations.marks.map(({ text, type }) => ({ text, type }))).toEqual(
        annotationsBefore.marks.map(({ text, type }) => ({ text, type })),
      )
      expect(savedAnnotations.references.map(({ text, type }) => ({ text, type }))).toEqual(
        annotationsBefore.references.map(({ text, type }) => ({ text, type })),
      )
      expect(activeWritingId(), "no se crea un draft de fallback").toBe(writingId)
      expect(await readWorkspaceMarkdown(), "la identidad mantiene un solo archivo").toHaveLength(1)
      expect((await getDocumentCatalog()).getById(writingId)).resolves.toMatchObject({ id: writingId })
    },
    TEST_TIMEOUT_MS,
  )
})
