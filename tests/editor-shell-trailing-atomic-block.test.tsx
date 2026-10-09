/**
 * @vitest-environment happy-dom
 *
 * Trailing atomic blocks stay intact when the user moves the caret after them
 * and types. The shell, TipTap state, save coordinator and desktop Markdown
 * file path are real; only Tauri/OS/cloud boundaries use the existing desktop
 * doubles from editor-shell-document-components-desktop.test.tsx.
 *
 * The arrow keys are dispatched to the mounted ProseMirror contenteditable.
 * Text insertion reuses the canonical `typeInEditor` harness driver, which
 * applies the editor transaction and runs the shell's normal save pipeline.
 * Completion is the `.md` bytes after the desktop debounce has settled.
 */
import { readFileSync } from "node:fs"
import type { EditorState } from "@tiptap/pm/state"
import { NodeSelection } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
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
const {
  createDesktopWorkspace,
  destroyDesktopWorkspace,
  readWorkspaceMarkdown,
  resetDesktopWorkspace,
} = await import("./support/editor-shell-desktop-doubles")
const {
  failNextWriteFile,
  resetWriteFileFailureState,
  writeFileCalls,
} = await import("./integration/documents/support/real-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

const TEST_TIMEOUT_MS = 90_000
const SAVE_WINDOW_MS = DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000
const DRAFT_SEED = "TRAILING_ATOM_DRAFT_SEED"
const PREFIX = "TRAILING_ATOM_PREFIX"
const MASTER_SOURCE = readFileSync("tests/fixtures/document-components/valid/master.md", "utf8")
const FIXTURE_OPAQUE_INLINE = MASTER_SOURCE.match(/<FuturePanel\b[^>]*>[^<]*<\/FuturePanel>/)?.[0]
if (!FIXTURE_OPAQUE_INLINE) throw new Error("La fixture master dejó de contener FuturePanel")

// Reuse the FuturePanel source from the component fixture, with line breaks so
// Rich classifies it as the opaque block node covered by this issue.
const OPAQUE_BLOCK = FIXTURE_OPAQUE_INLINE.replace(
  ">OPAQUE_FUTURE_MASTER 東京</FuturePanel>",
  ">\nOPAQUE_FUTURE_MASTER 東京\n</FuturePanel>",
)

type AtomicCase = {
  name: string
  source: string
  nodeType: "opaqueSourceBlock" | "horizontalRule" | "image"
  marker: string
}

const ATOMIC_CASES: AtomicCase[] = [
  {
    name: "opaque source block",
    source: OPAQUE_BLOCK,
    nodeType: "opaqueSourceBlock",
    marker: "TYPED_AFTER_OPAQUE_BLOCK",
  },
  {
    name: "horizontal rule",
    source: "---",
    nodeType: "horizontalRule",
    marker: "TYPED_AFTER_HORIZONTAL_RULE",
  },
  {
    name: "block image",
    source: "![TRAILING_IMAGE_ALT](https://example.com/trailing-atomic.png)",
    nodeType: "image",
    marker: "TYPED_AFTER_BLOCK_IMAGE",
  },
]

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

type SelectionEditor = { state: EditorState; view: EditorView }

beforeAll(() => {
  createDesktopWorkspace("odessay-trailing-atomic-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetWriteFileFailureState()
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
  return session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id ?? null
}

function activeSaveState() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)?.save_state ?? null
}

function selectionEditor(): SelectionEditor {
  return mounted!.editor() as unknown as SelectionEditor
}

function jsonNodes() {
  return (mounted!.editor().getJSON().content ?? []) as Array<{
    type?: string
    attrs?: Record<string, unknown>
    content?: unknown[]
  }>
}

function lastNode() {
  return jsonNodes().at(-1)
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

/** Edits the real Source textarea through its normal React input event. */
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

/** Sends a keyboard event to the mounted ProseMirror contenteditable. */
async function pressEditorKey(key: string) {
  const root = mounted!.prosemirror()
  if (!root) throw new Error("El contenido de ProseMirror no está montado")
  await act(async () => {
    mounted!.editor().commands.focus()
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
    )
    root.dispatchEvent(new KeyboardEvent("keyup", { key, code: key, bubbles: true }))
  })
  await flush(1)
}

/**
 * Seeds the actual atom selection, then uses ArrowRight to enter the trailing
 * gap. happy-dom does not implement the browser's native text-to-atom motion.
 */
async function moveCaretAfterFinalAtom() {
  const editor = selectionEditor()
  const doc = editor.state.doc
  const atomPosition = doc.content.size - doc.lastChild!.nodeSize
  await act(async () => {
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(doc, atomPosition)))
  })
  await flush(1)

  // Without GapCursor this key leaves a NodeSelection, so typing replaces
  // the atom. With GapCursor it moves the caret to the gap after the atom.
  await pressEditorKey("ArrowRight")
}

async function createAtomicDocument(atom: AtomicCase) {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  await clickNewArtifact(mounted.container)
  await typeInEditor(DRAFT_SEED)
  await advance(SAVE_WINDOW_MS)
  const firstFile = await waitForMarkdownContaining(DRAFT_SEED)
  const writingId = await waitFor(activeWritingId, {
    label: "pestaña activa con identidad",
    timeoutMs: 15_000,
  })

  await switchMode("Markdown")
  await replaceMarkdownSource(`${PREFIX}\n\n${atom.source}`)
  await switchMode("Rich")
  await advance(SAVE_WINDOW_MS)
  const file = await waitForMarkdownContaining(PREFIX)
  expect(file.path, "Source y Rich conservan la identidad del archivo").toBe(firstFile.path)
  expect(file.contents, "Source → Rich no serializa un párrafo final vacío").toBe(`${PREFIX}\n\n${atom.source}`)
  expect(lastNode()?.type, "el átomo termina el documento en Rich").toBe(atom.nodeType)
  return { file, writingId }
}

function expectAtomicNode(atom: AtomicCase) {
  const node = jsonNodes().find((candidate) => candidate.type === atom.nodeType)
  expect(node, `el nodo ${atom.nodeType} sigue en el EditorState`).toBeDefined()
  if (atom.nodeType === "opaqueSourceBlock") {
    expect(node?.attrs?.raw, "el source opaco conserva todos sus bytes").toBe(atom.source)
  }
  if (atom.nodeType === "image") {
    expect(node?.attrs?.src, "la referencia Markdown de imagen se conserva").toBe(
      "https://example.com/trailing-atomic.png",
    )
  }
}

describe("escribir después del último bloque atómico en la shell real", () => {
  for (const atom of ATOMIC_CASES) {
    it.fails(
      `teclea después de ${atom.name} y guarda sin reemplazarlo`,
      async () => {
        const { file } = await createAtomicDocument(atom)

        await moveCaretAfterFinalAtom()
        await typeInEditor(atom.marker)
        await advance(SAVE_WINDOW_MS)
        const saved = await waitForMarkdownContaining(atom.marker)

        expect(saved.path, "el texto se guarda en el mismo archivo").toBe(file.path)
        expectAtomicNode(atom)
        expect(lastNode()?.type, "el texto nuevo crea un textblock después del átomo").toBe("paragraph")
        expect(saved.contents, "el `.md` conserva el source literal del átomo").toContain(atom.source)
        expect(saved.contents, "el texto queda después del átomo sin un párrafo final vacío").toBe(
          `${PREFIX}\n\n${atom.source}\n\n${atom.marker}`,
        )
      },
      TEST_TIMEOUT_MS,
    )
  }

  it(
    "Backspace borra en un paso el átomo que ya está seleccionado explícitamente",
    async () => {
      const atom = ATOMIC_CASES[0]
      const { file } = await createAtomicDocument(atom)
      const editor = selectionEditor()
      const doc = editor.state.doc
      const atomPosition = doc.content.size - doc.lastChild!.nodeSize
      await act(async () => {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(doc, atomPosition)))
      })
      expect(editor.state.selection).toBeInstanceOf(NodeSelection)

      await pressEditorKey("Backspace")
      expect(lastNode()?.type, "el prefix permanece después de borrar el bloque").toBe("paragraph")
      await advance(SAVE_WINDOW_MS)
      const saved = await waitForMarkdownContaining(PREFIX)
      expect(saved.path).toBe(file.path)
      expect(saved.contents).not.toContain(atom.source)
      expect(activeWritingId()).toBeTruthy()
    },
    TEST_TIMEOUT_MS,
  )

  for (const atom of ATOMIC_CASES) {
    it(
      `un toggle Rich/Source limpio conserva ${atom.name} y el positivo escribe bajo la misma identidad`,
      async () => {
        const { file, writingId } = await createAtomicDocument(atom)
        const bytesBefore = await contentsOf(file.path)
        const lastNodeBefore = JSON.stringify(lastNode())
        const writesBefore = writeFileCalls().filter((write) => write.path === file.path).length

        await switchMode("Markdown")
        await switchMode("Rich")
        await advance(SAVE_WINDOW_MS)

        expect(await contentsOf(file.path), "el toggle no-op conserva cada byte").toBe(bytesBefore)
        expect(lastNode(), "el último nodo no cambia al alternar de modo").toEqual(JSON.parse(lastNodeBefore))
        expect(writeFileCalls().filter((write) => write.path === file.path)).toHaveLength(writesBefore)

        // Positive control: a valid Rich edit on the same real document reaches disk.
        const selectedPrefix = await selectEditorText(PREFIX)
        await act(async () => {
          mounted!.editor().commands.focus()
          mounted!.editor().commands.setTextSelection(selectedPrefix.to)
        })
        await typeInEditor(" CLEAN_TOGGLE_POSITIVE_CONTROL")
        await advance(SAVE_WINDOW_MS)
        const saved = await waitForMarkdownContaining("CLEAN_TOGGLE_POSITIVE_CONTROL")
        expect(saved.path).toBe(file.path)
        expect(saved.contents).toContain(atom.source)
        expect(activeWritingId()).toBe(writingId)
        expect(writeFileCalls().filter((write) => write.path === file.path).length).toBeGreaterThan(writesBefore)
      },
      TEST_TIMEOUT_MS,
    )
  }

  it.fails(
    "un fallo de disco conserva el texto en el editor y reintenta en el mismo archivo",
    async () => {
      const atom = ATOMIC_CASES[0]
      const { file, writingId } = await createAtomicDocument(atom)
      const bytesBefore = await contentsOf(file.path)
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})

      failNextWriteFile(
        (path) => path === file.path,
        () => {
          throw new Error("disk full")
        },
      )
      await moveCaretAfterFinalAtom()
      await typeInEditor("PENDING_ATOMIC_GAP_EDIT")
      await advance(SAVE_WINDOW_MS)
      await waitFor(() => activeSaveState() === "error", {
        label: "la pestaña muestra el error de escritura",
        timeoutMs: 15_000,
      })

      expect(errors.mock.calls.some(([message]) => message === "[editor:save] local save failed")).toBe(true)
      expect(await contentsOf(file.path), "la copia durable no afirma el guardado fallido").toBe(bytesBefore)
      expect(mounted!.editor().getText()).toContain("PENDING_ATOMIC_GAP_EDIT")
      expect(activeWritingId()).toBe(writingId)
      expect(await readWorkspaceMarkdown()).toHaveLength(1)

      await typeInEditor(" RETRIED_ATOMIC_GAP_EDIT")
      await advance(SAVE_WINDOW_MS)
      const saved = await waitForMarkdownContaining("RETRIED_ATOMIC_GAP_EDIT")
      expect(saved.path, "el retry vuelve al mismo archivo").toBe(file.path)
      expect(saved.contents).toContain("PENDING_ATOMIC_GAP_EDIT")
      expect(saved.contents).toContain(atom.source)
      expect(activeWritingId()).toBe(writingId)
      await waitFor(() => activeSaveState() === "saving", {
        label: "el retry ya es local y queda pendiente la nube",
        timeoutMs: 15_000,
      })
    },
    TEST_TIMEOUT_MS,
  )
})
