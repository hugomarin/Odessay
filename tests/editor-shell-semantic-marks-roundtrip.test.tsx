/**
 * @vitest-environment happy-dom
 *
 * ODE-532 — the real selection popup and owner hook must not apply a pending
 * range from writing A to the editor for writing B, even when the offsets and
 * selected text happen to match. The active-B control uses the same popup,
 * hook, TipTap commands, and editor instance before the stale A callback.
 */
import { act, useRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { Editor } from "@tiptap/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import "fake-indexeddb/auto"
import { SelectionPopup, type SemanticMarkApplyResult } from "@/components/reading/margins/selection-popup"
import { type PendingAnnotationSnapshot, type PendingRichSelectionSnapshot } from "@/hooks/useEditorCommands"
import { useSelectionPopup } from "@/hooks/useSelectionPopup"
import { createEditorExtensions } from "@/lib/editor/extensions"
import { type EntityTypeName } from "@/lib/editor/semantic-marks"
import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { serializeDocumentToMarkdown } from "@/lib/editor/document-serialization"

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

const shellHarness = await import("./support/editor-shell-harness")

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WRITING_A = "writing-a"
const WRITING_B = "writing-b"
const REAL_SHELL_WRITING_A = "75111111-1111-4111-8111-111111111111"
const REAL_SHELL_WRITING_B = "75222222-2222-4222-8222-222222222222"
const TEXT = "same control"
const ROUNDTRIP_WRITING_ID = "85111111-1111-4111-8111-111111111111"
const ROUNDTRIP_TEXT = "A company wrote a memorable letter."
const popupPosition = { x: 120, y: 200, top: 180, bottom: 200 }

type SemanticMarkResult =
  | { kind: "entity"; text: string; id: string; type: string }
  | { kind: "highlight"; text: string; color: string }

function semanticMarks(value: unknown) {
  const found: SemanticMarkResult[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const current = node as {
      text?: string
      marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
      content?: unknown[]
    }
    for (const mark of current.marks ?? []) {
      if (mark.type === "entity") {
        found.push({
          kind: "entity",
          text: current.text ?? "",
          id: String(mark.attrs?.entityId ?? ""),
          type: String(mark.attrs?.entityType ?? ""),
        })
      }
      if (mark.type === "semanticHighlight") {
        found.push({
          kind: "highlight",
          text: current.text ?? "",
          color: String(mark.attrs?.highlightColor ?? ""),
        })
      }
    }
    for (const child of current.content ?? []) visit(child)
  }
  visit(value)
  return found
}

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
    created_at: "2026-10-08T00:00:00.000Z",
    updated_at: "2026-10-08T00:00:00.000Z",
    local_updated_at: Date.now(),
  } as LocalWriting
}

type HarnessProps = {
  activeWritingId: string
  editor: Editor
  mode?: "rich" | "markdown"
  pending: PendingRichSelectionSnapshot
  onDismiss: () => void
  onEntityAction?: (apply: (type: EntityTypeName) => SemanticMarkApplyResult) => void
  onPendingSelectionClear?: () => void
}

function PopupOwnerHarness({
  activeWritingId,
  editor,
  mode = "rich",
  pending,
  onDismiss,
  onEntityAction,
  onPendingSelectionClear,
}: HarnessProps) {
  const modeRef = useRef<"rich" | "markdown">("rich")
  modeRef.current = mode
  const selectionRef = useRef<{ from: number; to: number; text: string } | null>(null)
  const suppressNextSelectionPopupRef = useRef(false)
  const [, setFootnoteModalOpen] = useState(false)
  const [, setPendingAnnotation] = useState<PendingAnnotationSnapshot | null>(null)
  const callbacks = useSelectionPopup({
    captureRichSelectionSnapshot: () => {
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to, " ").trim()
      return {
        from,
        to,
        text,
        writingId: activeWritingId,
        popupPosition,
        bubblePosition: popupPosition,
      } as PendingRichSelectionSnapshot
    },
    editor,
    getRichSelectionOverlayPositions: () => ({ popupPosition, bubblePosition: popupPosition }),
    modeRef,
    pendingAnnotation: null,
    pendingRichSelection: pending,
    persistEditorSnapshot: vi.fn().mockResolvedValue(true),
    selectionRef,
    setActivePanel: () => {},
    setFootnoteModalOpen,
    setPendingAnnotation,
    setPendingRichSelection: (next) => {
      if (next === null) onPendingSelectionClear?.()
    },
    suppressNextSelectionPopupRef,
    updateDerivedEditorState: () => {},
  })
  onEntityAction?.(callbacks.applySemanticEntityAtSelection)

  return (
    <SelectionPopup
      key={`${activeWritingId}:${pending.writingId}`}
      position={pending.popupPosition}
      onDismiss={onDismiss}
      onApplyEntity={callbacks.applySemanticEntityAtSelection}
      onApplyHighlight={callbacks.applySemanticHighlightAtSelection}
    />
  )
}

function snapshot(writingId: string, from: number, to: number, text: string) {
  return {
    from,
    to,
    text,
    writingId,
    popupPosition,
    bubblePosition: popupPosition,
  } as PendingRichSelectionSnapshot
}

function entityRanges(editor: Editor) {
  const ranges: Array<{ from: number; to: number; text: string; id: string; type: string }> = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find((candidate) => candidate.type.name === "entity")
    if (!mark) return
    ranges.push({
      from: pos,
      to: pos + node.nodeSize,
      text: node.text ?? "",
      id: String(mark.attrs.entityId),
      type: String(mark.attrs.entityType),
    })
  })
  return ranges
}

async function prepareRealShellStaleActionAtoB() {
  shellHarness.resetEditorShellWorld()
  shellHarness.world.network = async () => new Response("[]", { status: 200 })
  await localDB.writings.save(makeLocalWriting(REAL_SHELL_WRITING_A, "same document A", "Document A"))
  await localDB.writings.save(makeLocalWriting(REAL_SHELL_WRITING_B, "same document B", "Document B"))

  mountedShell = await shellHarness.mountEditorShell({ writingId: REAL_SHELL_WRITING_B })
  await shellHarness.waitFor(() => mountedShell!.editor().getText().includes("same document B"), {
    label: "documento B hidratado en EditorShell real",
    timeoutMs: 10_000,
  })
  await shellHarness.selectEditorText("same")
  await shellHarness.waitFor(() => popupButton("More mark options"), {
    label: "popup de B como control positivo real",
  })
  await applyPopupEntityByKeyboard("Company")

  const editorMarksBeforeStaleAction = semanticMarks(mountedShell.editor().getJSON()).filter(
    (mark) => mark.kind === "entity",
  )
  expect(editorMarksBeforeStaleAction).toEqual([
    expect.objectContaining({ kind: "entity", text: "same", type: "company" }),
  ])

  const persistedBeforeStaleAction = await shellHarness.waitForAsync(
    async () => {
      const writing = await localDB.writings.get(REAL_SHELL_WRITING_B)
      return semanticMarks(writing?.body_json).some(
        (mark) => mark.kind === "entity" && mark.text === "same" && mark.type === "company",
      )
        ? writing
        : null
    },
    { label: "control positivo de B guardado en body_json" },
  )
  expect(semanticMarks(persistedBeforeStaleAction.body_json)).toEqual(editorMarksBeforeStaleAction)

  await mountedShell.render({ writingId: REAL_SHELL_WRITING_A })
  await shellHarness.waitFor(() => mountedShell!.editor().getText().includes("same document A"), {
    label: "A vuelve a ser el documento activo",
    timeoutMs: 10_000,
  })
  await shellHarness.selectEditorText("same")
  await shellHarness.waitFor(() => popupButton("More mark options"), {
    label: "popup pendiente sobre A",
  })
  await pressPopupButton("More mark options", "Enter")
  await pressPopupButton("Entity", "Enter")
  const stalePersonButton = popupButton("Person")
  if (!stalePersonButton) throw new Error("Person action was not rendered for A.")
  const stalePersonAction = renderedClickHandler(stalePersonButton)

  await mountedShell.render({ writingId: REAL_SHELL_WRITING_B })
  await shellHarness.waitFor(() => mountedShell!.editor().getText().includes("same document B"), {
    label: "el shell vuelve a activar B",
    timeoutMs: 10_000,
  })
  await shellHarness.selectEditorText("same")
  await shellHarness.waitFor(() => popupButton("More mark options"), {
    label: "selección actual de B disponible para revalidar",
  })

  await act(async () => {
    stalePersonAction({ detail: 0, stopPropagation: vi.fn() })
  })
  await shellHarness.flush(3)

  return {
    editorMarksBeforeStaleAction,
    editorMarksAfterStaleAction: semanticMarks(mountedShell.editor().getJSON()).filter(
      (mark) => mark.kind === "entity",
    ),
    persistedBeforeStaleAction,
    persistedAfterStaleAction: await localDB.writings.get(REAL_SHELL_WRITING_B),
  }
}

let container: HTMLDivElement
let root: Root | null
let editors: Editor[] = []
let mountedShell: Awaited<ReturnType<typeof shellHarness.mountEditorShell>> | null = null

async function renderHarness(props: HarnessProps) {
  const currentRoot = root
  if (!currentRoot) throw new Error("Test root is not mounted.")
  await act(async () => {
    currentRoot.render(<PopupOwnerHarness {...props} />)
  })
}

function button(label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  ) ?? null
}

async function pointerDown(element: Element | null) {
  if (!element) throw new Error("Element not found.")
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
  })
}

async function pressPopupButton(label: string, key: "Enter" | " ") {
  const element = popupButton(label)
  if (!element) throw new Error(`Popup button not found: ${label}`)
  element.focus()
  await act(async () => {
    const keydown = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    element.dispatchEvent(keydown)
    if (!keydown.defaultPrevented) element.click()
    element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }))
  })
}

async function tabToNextPopupButton() {
  const current = document.activeElement
  const menu = current?.closest("[role='menu']")
  const buttons = Array.from(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])
  const index = buttons.indexOf(current as HTMLButtonElement)
  if (index < 0 || index + 1 >= buttons.length) throw new Error("Next popup button not found.")
  await act(async () => {
    current?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }))
    buttons[index + 1].focus()
    buttons[index + 1].dispatchEvent(new KeyboardEvent("keyup", { key: "Tab", bubbles: true }))
  })
}

function popupButton(label: string) {
  const popup = document.querySelector<HTMLElement>('[data-testid="selection-popup"]')
  return Array.from(popup?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  ) ?? null
}

function renderedClickHandler(element: HTMLButtonElement) {
  const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"))
  if (!propsKey) throw new Error("React click props not found on rendered popup button.")
  const props = (element as unknown as Record<string, unknown>)[propsKey] as {
    onClick?: (event: { detail: number; stopPropagation: () => void }) => void
  }
  if (!props.onClick) throw new Error("Rendered popup button has no click handler.")
  return props.onClick
}

async function applyPopupEntityByKeyboard(label: string) {
  await pressPopupButton("More mark options", "Enter")
  await pressPopupButton("Entity", "Enter")
  await pressPopupButton(label, "Enter")
}

async function applyPopupHighlightByKeyboard(label: string) {
  await pressPopupButton("More mark options", " ")
  await tabToNextPopupButton()
  await pressPopupButton("Highlight", " ")
  await tabToNextPopupButton()
  await tabToNextPopupButton()
  await pressPopupButton(label, " ")
}

async function applyEntityFromPopup() {
  await pointerDown(button("More mark options"))
  await pointerDown(button("Entity"))
  await pointerDown(button("Person"))
}

function createEditor() {
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: `<p>${TEXT}</p>`,
  })
  editors.push(editor)
  return editor
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  editors = []
  mountedShell = null
})

afterEach(async () => {
  await mountedShell?.unmount()
  mountedShell = null
  if (root) {
    await act(async () => root?.unmount())
    root = null
  }
  for (const editor of editors) editor.destroy()
  container.remove()
})

describe("ODE-532 pending semantic mark ownership", () => {
  it("uses the real shell writingId producer across A→B", async () => {
    const { editorMarksBeforeStaleAction, editorMarksAfterStaleAction } = await prepareRealShellStaleActionAtoB()

    expect(
      editorMarksAfterStaleAction,
      "la acción pendiente de A no cambia la Entity positiva de B",
    ).toEqual(editorMarksBeforeStaleAction)
  }, 60_000)

  it("keeps B's persisted semantic state unchanged after A's stale action", async () => {
    const { persistedBeforeStaleAction, persistedAfterStaleAction } = await prepareRealShellStaleActionAtoB()

    expect(
      persistedAfterStaleAction?.body_json,
      "la fila guardada de B no incluye la acción Person capturada en A",
    ).toEqual(persistedBeforeStaleAction.body_json)
  }, 60_000)

  it("discards an A action after B becomes active at the same range", async () => {
    const editorA = createEditor()
    editorA.commands.setTextSelection({ from: 1, to: 5 })
    const editorB = createEditor()
    editorB.commands.setTextSelection({ from: 6, to: 13 })
    const dismiss = vi.fn()

    // Positive control first: the real B selection applies through the popup.
    await renderHarness({
      activeWritingId: WRITING_B,
      editor: editorB,
      pending: snapshot(WRITING_B, 6, 13, "control"),
      onDismiss: dismiss,
    })
    await applyEntityFromPopup()
    expect(entityRanges(editorB), "control positivo: una selección de B sí aplica").toEqual([
      expect.objectContaining({ from: 6, to: 13, text: "control", type: "person" }),
    ])

    editorB.commands.setContent(`<p>${TEXT}</p>`)
    editorB.commands.setTextSelection({ from: 1, to: 5 })
    dismiss.mockClear()

    // A's pending snapshot has the same offsets/text, but B is now active.
    await renderHarness({
      activeWritingId: WRITING_B,
      editor: editorB,
      pending: snapshot(WRITING_A, 1, 5, "same"),
      onDismiss: dismiss,
    })
    await applyEntityFromPopup()

    expect(entityRanges(editorB), "la acción de A no muta el documento B").toEqual([])
    expect(container.querySelector("[role='status']")?.textContent).toMatch(/document|selection|range/i)
    expect(dismiss, "un error conserva el popup").not.toHaveBeenCalled()
  })

  it("rejects a changed range in the same document", async () => {
    const editor = createEditor()
    editor.commands.setTextSelection({ from: 6, to: 13 })
    const dismiss = vi.fn()
    await renderHarness({
      activeWritingId: WRITING_B,
      editor,
      pending: snapshot(WRITING_B, 1, 5, "same"),
      onDismiss: dismiss,
    })

    await applyEntityFromPopup()

    expect(entityRanges(editor), "el rango distinto no recibe la Entity").toEqual([])
    expect(container.querySelector("[role='status']")?.textContent).toMatch(/selection/i)
    expect(dismiss).not.toHaveBeenCalled()
  })

  it("clears a pending action in Source mode", async () => {
    const editor = createEditor()
    editor.commands.setTextSelection({ from: 1, to: 5 })
    const clearPending = vi.fn()
    const applyCallbacks: Array<(type: EntityTypeName) => SemanticMarkApplyResult> = []
    const props: HarnessProps = {
      activeWritingId: WRITING_B,
      editor,
      pending: snapshot(WRITING_B, 1, 5, "same"),
      onDismiss: vi.fn(),
      onEntityAction: (apply) => applyCallbacks.push(apply),
      onPendingSelectionClear: clearPending,
    }
    await renderHarness(props)
    await renderHarness({ ...props, mode: "markdown" })

    expect(applyCallbacks.at(-1)?.("person")).toBe("Semantic marks can only be applied in Rich mode.")
    expect(clearPending).toHaveBeenCalled()
    expect(entityRanges(editor)).toEqual([])
  })

  it("does not apply a captured action after the popup owner unmounts", async () => {
    const editor = createEditor()
    editor.commands.setTextSelection({ from: 1, to: 5 })
    const applyCallbacks: Array<(type: EntityTypeName) => SemanticMarkApplyResult> = []
    await renderHarness({
      activeWritingId: WRITING_B,
      editor,
      pending: snapshot(WRITING_B, 1, 5, "same"),
      onDismiss: vi.fn(),
      onEntityAction: (apply) => applyCallbacks.push(apply),
    })

    if (!root) throw new Error("Test root is not mounted.")
    await act(async () => root?.unmount())
    root = null

    expect(applyCallbacks.at(-1)?.("person")).toBe("This selection is no longer available.")
    expect(entityRanges(editor)).toEqual([])
  })

  it("saves Entity and Highlight in the real shell and restores them after reopening", async () => {
    shellHarness.resetEditorShellWorld()
    await localDB.writings.save(makeLocalWriting(ROUNDTRIP_WRITING_ID, ROUNDTRIP_TEXT, "Semantic marks"))

    mountedShell = await shellHarness.mountEditorShell({ writingId: ROUNDTRIP_WRITING_ID })
    await shellHarness.waitFor(() => mountedShell!.editor().getText().includes(ROUNDTRIP_TEXT), {
      label: "hidratación del documento con marcas semánticas",
    })
    await shellHarness.flush(3)

    await shellHarness.selectEditorText("company")
    await shellHarness.waitFor(() => document.querySelector('[data-testid="selection-popup"]'), {
      label: "popup sobre la selección de Entity",
    })
    await applyPopupEntityByKeyboard("Company")
    await shellHarness.waitFor(() => !document.querySelector('[data-testid="selection-popup"]'), {
      label: "popup cerrado tras aplicar Entity",
    })

    // A fresh caret/selection update consumes the one-shot focus suppression
    // before the next mark selection, as it does in the interactive editor.
    await shellHarness.selectEditorText("A")
    await shellHarness.selectEditorText("memorable")
    await shellHarness.waitFor(() => document.querySelector('[data-testid="selection-popup"]'), {
      label: "popup sobre la selección de Highlight",
    })
    await applyPopupHighlightByKeyboard("Highlight Indigo")
    await shellHarness.waitFor(() => !document.querySelector('[data-testid="selection-popup"]'), {
      label: "popup cerrado tras aplicar Highlight",
    })

    const persisted = await shellHarness.waitForAsync(
      async () => {
        const writing = await localDB.writings.get(ROUNDTRIP_WRITING_ID)
        const marks = semanticMarks(writing?.body_json)
        return marks.some((mark) => mark.kind === "entity") && marks.some((mark) => mark.kind === "highlight")
          ? writing
          : null
      },
      { label: "Entity y Highlight guardados en body_json" },
    )
    const persistedMarks = semanticMarks(persisted.body_json)
    expect(persistedMarks).toHaveLength(2)
    const entity = persistedMarks.find((mark) => mark.kind === "entity")
    expect(entity).toEqual({ kind: "entity", text: "company", id: expect.any(String), type: "company" })
    expect(persistedMarks).toContainEqual({ kind: "highlight", text: "memorable", color: "indigo" })

    const persistedMarkdown = serializeDocumentToMarkdown(persisted.body_json as never)
    expect(persistedMarkdown).toBe(
      `A <Entity id="${entity?.kind === "entity" ? entity.id : ""}" type="company">company</Entity> wrote a <Highlight color="indigo">memorable</Highlight> letter.`,
    )

    await mountedShell.render({ writingId: ROUNDTRIP_WRITING_ID, key: "reopen-semantic-marks" })
    await shellHarness.waitFor(() => mountedShell!.editor().getText().includes(ROUNDTRIP_TEXT), {
      label: "rehidratación del documento reabierto",
    })
    await shellHarness.flush(3)

    const reopened = semanticMarks(mountedShell.editor().getJSON())
    expect(reopened).toEqual(persistedMarks)
    expect(serializeDocumentToMarkdown(mountedShell.editor().getJSON() as never)).toBe(persistedMarkdown)
  }, 30_000)
})
