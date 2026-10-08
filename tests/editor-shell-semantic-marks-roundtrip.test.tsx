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

import { SelectionPopup } from "@/components/reading/margins/selection-popup"
import { type PendingAnnotationSnapshot, type PendingRichSelectionSnapshot } from "@/hooks/useEditorCommands"
import { useSelectionPopup } from "@/hooks/useSelectionPopup"
import { createEditorExtensions } from "@/lib/editor/extensions"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WRITING_A = "writing-a"
const WRITING_B = "writing-b"
const TEXT = "same control"
const popupPosition = { x: 120, y: 200, top: 180, bottom: 200 }

type HarnessProps = {
  activeWritingId: string
  editor: Editor
  pending: PendingRichSelectionSnapshot
  onDismiss: () => void
}

function PopupOwnerHarness({ activeWritingId, editor, pending, onDismiss }: HarnessProps) {
  const modeRef = useRef<"rich" | "markdown">("rich")
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
    setPendingRichSelection: () => {},
    suppressNextSelectionPopupRef,
    updateDerivedEditorState: () => {},
  })

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

let container: HTMLDivElement
let root: Root
let editors: Editor[] = []

async function renderHarness(props: HarnessProps) {
  await act(async () => {
    root.render(<PopupOwnerHarness {...props} />)
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
})

afterEach(async () => {
  await act(async () => root.unmount())
  for (const editor of editors) editor.destroy()
  container.remove()
})

describe("ODE-532 pending semantic mark ownership", () => {
  it.fails("discards an A action after B becomes active at the same range", async () => {
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
})
