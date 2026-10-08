/**
 * @vitest-environment happy-dom
 *
 * ODE-686 — footnote insertion must use a selection owned by the active writing.
 *
 * The cross-document case enters through the real native Open File path while
 * the Insert Footnote dialog is open. The dialog confirmation and saved
 * annotation are the completion event; a pure helper check alone is not the
 * proof.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { act } from "react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { isMacPlatform } from "@/lib/keyboard-shortcuts"
import { readMarkdownSelectionForActiveDocument } from "@/hooks/useSelectionRestore"

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
vi.mock("@/lib/runtime/detect", async () =>
  (await import("./support/editor-shell-doubles")).tauriRuntimeDetectDouble(),
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
  advance,
  emitTauriEvent,
  fillTextField,
  flush,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  waitFor,
  waitForHydrationReady,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, desktopWorkspaceRoot, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { holdWriteFile, tauriOpenFileDouble } = await import("./integration/documents/support/real-desktop-doubles")
const { scanControlledAnnotations } = await import("@/lib/editor/annotation-markdown")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

const TEST_TIMEOUT_MS = 60_000
const A_TARGET = "ASELECTIONANCHOR"
const B_TARGET = "BSELECTIONANCHOR"
const A_PENDING_WRITE = "ODE686_A_PENDING_WRITE"
const A_SOURCE =
  "# Footnote A\n\nA selection sits here: ASELECTIONANCHOR.\n\n<Tip title=\"Footnote A component\">\nA_COMPONENT_BODY\n</Tip>\n"
const B_SOURCE =
  "# Footnote B\n\nB has its own saved selection at the end: BSELECTIONANCHOR.\n\n<Card title=\"Footnote B component\">\nB_COMPONENT_BODY\n</Card>\n"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let pathA = ""
let pathB = ""
let alerts: string[] = []

beforeAll(() => {
  createDesktopWorkspace("odessay-ode-686-footnote-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "harness-anon-key")
  await writeEditorSession(createEmptyEditorSession())
  const docs = join(desktopWorkspaceRoot(), "selected-documents")
  mkdirSync(docs, { recursive: true })
  pathA = join(docs, "ODE686-A.md")
  pathB = join(docs, "ODE686-B.md")
  writeFileSync(pathA, A_SOURCE)
  writeFileSync(pathB, B_SOURCE)
  alerts = []
  window.alert = (message?: unknown) => alerts.push(String(message))
  window.confirm = () => true
  world.tauriInvoke = async (command, args) => {
    if (command === "open_file") return tauriOpenFileDouble(String(args?.path))
    if (command === "set_editor_menu_availability") return null
    throw new Error("Comando Tauri inesperado en el test: " + command)
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
  window.alert = () => {}
  vi.unstubAllEnvs()
})

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id) ?? null
}

function activeWritingId() {
  return activeTab()?.writing_id ?? null
}

function tabNode(writingId: string) {
  const tab = getEditorSessionState().session.tabs.find((candidate) => candidate.writing_id === writingId)
  if (!tab) throw new Error("No hay pestaña para " + writingId)
  const node = document.querySelector<HTMLElement>('[data-editor-tab-id="' + tab.id + '"]')
  if (!node) throw new Error("La pestaña no está en el DOM para " + writingId)
  return node
}

function markdownSource() {
  return mounted?.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]') ?? null
}

async function switchToMarkdown() {
  if (markdownSource()) return
  const button = Array.from(
    mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
  ).find((candidate) => candidate.textContent?.trim() === "Markdown")
  if (!button) throw new Error("No está el botón Markdown de la status bar")
  await act(async () => button.click())
  await waitFor(() => markdownSource(), { label: "Source Markdown visible" })
  await flush(2)
}

async function openByPath(path: string, marker: string) {
  world.openDialogResult = path
  await emitTauriEvent("menu:open-file")
  const outcome = await waitFor(
    () => {
      if (alerts.length > 0) return { alert: alerts[0], writingId: null }
      const writingId = activeWritingId()
      return writingId && mounted?.editor().getText().includes(marker)
        ? { alert: null, writingId }
        : null
    },
    { label: "open path completado para " + marker, timeoutMs: 15_000 },
  )
  if (outcome.alert) throw new Error("Open File no abrió el path: " + outcome.alert)
  const writingId = outcome.writingId
  if (!writingId) throw new Error("Open File no asignó writingId para " + marker)
  await waitForHydrationReady("hidratación ready de " + marker)
  return writingId
}

function currentPhase() {
  return document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") ?? null
}

async function selectMarkdownText(marker: string) {
  const textarea = markdownSource()
  if (!textarea) throw new Error("No está el textarea Markdown")
  const start = textarea.value.indexOf(marker)
  if (start < 0) throw new Error("El source no contiene el texto seleccionado: " + marker)
  const end = start + marker.length
  await act(async () => {
    textarea.focus()
    textarea.setSelectionRange(start, end)
    textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  })
  await flush(1)
  expect({ start: textarea.selectionStart, end: textarea.selectionEnd }).toEqual({ start, end })
  return { start, end }
}

async function pressCommandShiftA() {
  const mac = isMacPlatform()
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        code: "KeyA",
        metaKey: mac,
        ctrlKey: !mac,
        shiftKey: true,
        bubbles: true,
      }),
    )
  })
  await waitFor(
    () => document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Add note text"]'),
    { label: "modal Insert Footnote abierto por ⌘⇧A" },
  )
}

async function fillAndConfirmFootnote(noteText: string) {
  const note = await waitFor(
    () => document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Add note text"]'),
    { label: "campo de nota" },
  )
  await fillTextField(note, noteText)
  const insert = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "Insert footnote",
  )
  if (!insert) throw new Error('No está el botón "Insert footnote"')
  await act(async () => insert.click())
  await waitFor(() => !document.querySelector('textarea[placeholder="Add note text"]'), {
    label: "confirmación del modal de footnote",
  })
}

describe("ODE-686 — la selección de footnote pertenece al writing activo", () => {
  it("el helper acepta el dueño actual y rechaza el rango cacheado de otra escritura", () => {
    const cachedA = { start: 4, end: 9, text: "A-text", writingId: "writing-A" }
    const ownRead = readMarkdownSelectionForActiveDocument(cachedA, "writing-A", "body-A")
    expect(ownRead.belongsToOtherDocument).toBe(false)
    expect(ownRead.selection).toEqual(cachedA)

    const otherRead = readMarkdownSelectionForActiveDocument(cachedA, "writing-B", "body-B")
    expect(otherRead.belongsToOtherDocument).toBe(true)
    expect(otherRead.selection).toBeNull()
  })

  it(
    "rechaza el rango cacheado de A y usa la selección guardada de B tras abrir B por path",
    async () => {
      mounted = await mountEditorShell()
      const writingA = await openByPath(pathA, "A_COMPONENT_BODY")
      await switchToMarkdown()
      await selectMarkdownText(A_TARGET)

      const writingB = await openByPath(pathB, "B_COMPONENT_BODY")
      await switchToMarkdown()
      const selectionB = await selectMarkdownText(B_TARGET)

      await pointerClick(tabNode(writingA))
      await waitFor(() => activeWritingId() === writingA, { label: "A activo por gesto de pestaña" })
      await waitForHydrationReady("A rehidratado")
      await switchToMarkdown()
      const currentASelection = await selectMarkdownText(A_TARGET)
      const heldWrite = holdWriteFile((path) => path === pathA)
      try {
        const sourceA = markdownSource()
        if (!sourceA) throw new Error("A no está en Markdown")
        await fillTextField(sourceA, sourceA.value + "\n\n" + A_PENDING_WRITE + "\n")
        await advance(1_200)
        await heldWrite.started
        expect(
          readFileSync(pathA, "utf8"),
          "el write de A sigue retenido antes de su completion event",
        ).not.toContain(A_PENDING_WRITE)

        await pressCommandShiftA()
        const cachedA = {
          ...currentASelection,
          text: A_TARGET,
          writingId: writingA,
        }

        // Abrir B por el diálogo nativo real deja el modal pendiente y permite
        // que B llegue a ready mientras la escritura de A sigue retenida.
        const reopenedB = await openByPath(pathB, "B_COMPONENT_BODY")
        expect(reopenedB).toBe(writingB)
        expect(currentPhase(), "completion de la hidratación de B").toBe("ready")
        expect(
          readFileSync(pathA, "utf8"),
          "B quedó ready antes de liberar el write de A",
        ).not.toContain(A_PENDING_WRITE)
        await waitFor(() => document.querySelector('textarea[placeholder="Add note text"]'), {
          label: "modal conservado durante la apertura de B",
        })

        heldWrite.release()
        await waitFor(
          () => readFileSync(pathA, "utf8").includes(A_PENDING_WRITE),
          { label: "completion event: el write retenido de A quedó durable", timeoutMs: 15_000 },
        )

        const sourceB = markdownSource()
        if (!sourceB) throw new Error("B no quedó en Markdown")
        const safeRead = readMarkdownSelectionForActiveDocument(cachedA, activeWritingId(), sourceB.value)
        expect(safeRead.belongsToOtherDocument).toBe(true)
        expect(safeRead.selection).toMatchObject({
          ...selectionB,
          text: B_TARGET,
        })

        await fillAndConfirmFootnote("ODE686_B_OWN_NOTE")
        const saved = await waitForMarkdownContaining("ODE686_B_OWN_NOTE")
        const annotations = scanControlledAnnotations(saved.contents)
        const inserted = annotations.annotations.find((annotation) => annotation.comment === "ODE686_B_OWN_NOTE")
        expect(inserted, "la fila guardada de B contiene la footnote confirmada").toBeDefined()
        expect(inserted?.anchorText, "B usa su selección guardada y no los offsets de A").toBe(B_TARGET)
        expect(saved.path).toBe(pathB)
        expect(saved.contents).not.toContain(A_PENDING_WRITE)
      } finally {
        heldWrite.release()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "control positivo: selección vigente de B se inserta y queda guardada tras confirmar el modal",
    async () => {
      mounted = await mountEditorShell()
      const writingB = await openByPath(pathB, "B_COMPONENT_BODY")
      await switchToMarkdown()
      const selection = await selectMarkdownText(B_TARGET)
      const noteText = "ODE686_B_POSITIVE_NOTE"

      await pressCommandShiftA()
      const source = markdownSource()
      if (!source) throw new Error("B no está en Markdown")
      const safeRead = readMarkdownSelectionForActiveDocument(
        {
          ...selection,
          text: B_TARGET,
          writingId: writingB,
        },
        writingB,
        source.value,
      )
      expect(safeRead.belongsToOtherDocument).toBe(false)
      expect(safeRead.selection).toMatchObject({ ...selection, text: B_TARGET, writingId: writingB })

      await fillAndConfirmFootnote(noteText)
      const saved = await waitForMarkdownContaining(noteText)
      const annotation = scanControlledAnnotations(saved.contents).annotations.find(
        (candidate) => candidate.comment === noteText,
      )
      expect(saved.path).toBe(pathB)
      expect(annotation?.anchorText).toBe(B_TARGET)
    },
    TEST_TIMEOUT_MS,
  )
})
