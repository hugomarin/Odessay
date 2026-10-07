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
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  selectEditorText,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { writeFileCalls } = await import("./integration/documents/support/real-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

const TEST_TIMEOUT_MS = 90_000
const SAVE_WINDOW_MS = DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000

const CARD =
  '<Card title="Card Title R01" icon="star" href="https://example.com/r01">\nCard body R01 with **bold**.\n</Card>'
const TIP = '<Tip title="Tip R01">\nTip body R01.\n</Tip>'
const PROTECTED = '<ProtectedText id="lock-r01" reason="SECRET_R01">locked R01</ProtectedText>'
const INVALID_ENTITY = '<Entity type="person">no id R01</Entity>'
const FUTURE = '<FuturePanel mode="r01">\nFuture body R01.\n</FuturePanel>'
const MASTER = [
  "R01 base line",
  CARD,
  TIP,
  `Inline ${PROTECTED} and ${INVALID_ENTITY}.`,
  FUTURE,
].join("\n\n")

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

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
  await typeInEditor("R01 base line")
  await advance(SAVE_WINDOW_MS)
  const file = await waitForMarkdownContaining("R01 base line")
  const writingId = await waitFor(activeWritingId, { label: "pestaña activa con identidad", timeoutMs: 15_000 })

  await switchMode("Markdown")
  await replaceMarkdownSource(MASTER)
  await switchMode("Rich")
  return { file, writingId }
}

describe("Fase 12 — R01/R12: componentes por Source, Rich, disco y reapertura (desktop)", () => {
  it(
    "Card y Tip conservan atributos y cuerpo, y el source no editable en Rich llega intacto al .md",
    async () => {
      const { file } = await createMasterDocument()

      // Estado intermedio en Rich: cada kind con adapter es su nodo, el resto source preservado.
      expect(richNodesOfType("card").map((node) => node.attrs)).toEqual([
        expect.objectContaining({ title: "Card Title R01", icon: "star", href: "https://example.com/r01" }),
      ])
      expect(richNodesOfType("tip").map((node) => node.attrs)).toEqual([
        expect.objectContaining({ title: "Tip R01" }),
      ])
      expect(richNodesOfType("opaqueSource").map((node) => node.attrs.raw)).toEqual([PROTECTED, INVALID_ENTITY])
      expect(richNodesOfType("opaqueSourceBlock").map((node) => node.attrs.raw)).toEqual([FUTURE])

      // Edición adyacente en Rich: obliga a serializar todo el documento desde body_json.
      await placeCaretAfter("R01 base line")
      await typeInEditor(" R01-EDIT")
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("R01-EDIT")

      const saved = await contentsOf(file.path)
      for (const segment of [CARD, TIP, PROTECTED, INVALID_ENTITY, FUTURE]) {
        expect(saved, `el .md conserva exacto: ${segment.slice(0, 40)}`).toContain(segment)
      }
      expect(await readWorkspaceMarkdown(), "sin crear otro archivo").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "reabrir desde disco restaura los componentes, y alternar de modo sin editar no escribe",
    async () => {
      const { file, writingId } = await createMasterDocument()
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("FuturePanel")
      const savedBefore = await contentsOf(file.path)
      for (const segment of [CARD, TIP, PROTECTED, INVALID_ENTITY, FUTURE]) {
        expect(savedBefore, "control: el maestro ya está en disco").toContain(segment)
      }

      // Reabrir: shell nueva con la sesión vacía; solo queda lo que hay en disco.
      await mounted!.unmount()
      await writeEditorSession(createEmptyEditorSession())
      resetEditorShellWorld({ isDesktop: true })
      mounted = await mountEditorShell({ writingId })
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión vacía cargada" })
      await waitFor(() => mounted!.editor().getText().includes("Card body R01"), {
        label: "reapertura desde el .md",
        timeoutMs: 15_000,
      })
      await advance(SAVE_WINDOW_MS)

      expect(richNodesOfType("card").map((node) => node.attrs)).toEqual([
        expect.objectContaining({ title: "Card Title R01", icon: "star", href: "https://example.com/r01" }),
      ])
      expect(richNodesOfType("opaqueSource").map((node) => node.attrs.raw)).toEqual([PROTECTED, INVALID_ENTITY])
      expect(richNodesOfType("opaqueSourceBlock").map((node) => node.attrs.raw)).toEqual([FUTURE])

      // R02 (contenido): Rich → Markdown → Rich sin editar no reescribe el documento.
      const writesBefore = writeFileCalls().filter((call) => call.path === file.path).length
      await switchMode("Markdown")
      expect(markdownSource()?.value, "Source muestra los bytes del disco").toBe(savedBefore.replace(/\n+$/, ""))
      await switchMode("Rich")
      await advance(SAVE_WINDOW_MS)
      expect(
        writeFileCalls().filter((call) => call.path === file.path).length,
        "un toggle limpio no escribe el archivo",
      ).toBe(writesBefore)
      expect(await contentsOf(file.path)).toBe(savedBefore)

      // Control positivo del recuento: una edición real sí escribe.
      await placeCaretAfter("R01 base line")
      await typeInEditor(" R02-CONTROL")
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("R02-CONTROL")
      expect(writeFileCalls().filter((call) => call.path === file.path).length).toBeGreaterThan(writesBefore)
      const after = await contentsOf(file.path)
      for (const segment of [CARD, TIP, PROTECTED, INVALID_ENTITY, FUTURE]) {
        expect(after, "la edición posterior conserva cada componente").toContain(segment)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
