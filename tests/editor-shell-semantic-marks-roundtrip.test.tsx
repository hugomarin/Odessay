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
import { writeEditorSession } from "@/lib/editor/session-persistence"
import { createEmptyEditorSession } from "@/lib/local-db/editor-sessions"
import { localDB } from "@/lib/local-db"
import { webDocumentService } from "@/lib/services/web-document-service"
import { getEditorSessionState } from "@/lib/stores/editor-session-store"
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

async function waitForPersistedSemanticMarks(
  writingId: string,
  label: string,
  matches: (marks: SemanticMarkResult[]) => boolean,
) {
  return shellHarness.waitForAsync(
    async () => {
      const writing = await localDB.writings.get(writingId)
      return writing && matches(semanticMarks(writing.body_json)) ? writing : null
    },
    { label, timeoutMs: 20_000 },
  )
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

async function applyPopupEntityByPointer(label: string) {
  await pointerDown(await shellHarness.waitFor(() => popupButton("More mark options"), {
    label: "opción More del popup Entity por puntero",
    timeoutMs: 20_000,
  }))
  await pointerDown(await shellHarness.waitFor(() => popupButton("Entity"), {
    label: "opción Entity del popup por puntero",
    timeoutMs: 20_000,
  }))
  await pointerDown(await shellHarness.waitFor(() => popupButton(label), {
    label: `tipo Entity ${label} del popup por puntero`,
    timeoutMs: 20_000,
  }))
}

async function applyPopupHighlightByPointer(label: string) {
  await pointerDown(await shellHarness.waitFor(() => popupButton("More mark options"), {
    label: "opción More del popup Highlight por puntero",
    timeoutMs: 20_000,
  }))
  await pointerDown(await shellHarness.waitFor(() => popupButton("Highlight"), {
    label: "opción Highlight del popup por puntero",
    timeoutMs: 20_000,
  }))
  await pointerDown(await shellHarness.waitFor(() => popupButton(label), {
    label: `color Highlight ${label} del popup por puntero`,
    timeoutMs: 20_000,
  }))
}

async function pressEditorHistoryShortcut(key: "z", shift = false) {
  const mac = /Mac/i.test(navigator.platform || navigator.userAgent)
  await act(async () => {
    mountedShell!.editor().view.dom.dispatchEvent(
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
    await shellHarness.waitForHydrationReady("round-trip inicial después de hidratar")

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
    // The real selection popup suppresses its first focus-driven update after
    // a mark action; reproduce the fresh caret movement used by the existing
    // Entity/Highlight round-trip before opening the next popup.
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
      { label: "Entity y Highlight guardados en body_json", timeoutMs: 20_000 },
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

    // Gate the real local read to keep the route in its loading phase until
    // this test releases it. That makes the completion-event wait observable:
    // a fixed number of flushes cannot accidentally pass on a fast local run.
    let releaseReopenRead!: () => void
    const reopenReadGate = new Promise<void>((resolve) => {
      releaseReopenRead = resolve
    })
    let reopenReadStarted = false
    let gateNextReopenRead = true
    const originalOpenWriting = webDocumentService.openWriting.bind(webDocumentService)
    const gatedOpenWriting = vi.spyOn(webDocumentService, "openWriting").mockImplementation(async (id) => {
      if (id === ROUNDTRIP_WRITING_ID && gateNextReopenRead) {
        gateNextReopenRead = false
        reopenReadStarted = true
        await reopenReadGate
      }
      return originalOpenWriting(id)
    })
    try {
      await mountedShell.render({ writingId: ROUNDTRIP_WRITING_ID, key: "reopen-semantic-marks" })
      await shellHarness.waitFor(() => reopenReadStarted || null, {
        label: "lectura local real detenida durante la reapertura",
      })
      expect(
        document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase"),
        "la lectura retenida mantiene el nuevo documento en loading",
      ).toBe("loading")
      releaseReopenRead()
    } finally {
      gatedOpenWriting.mockRestore()
      releaseReopenRead()
    }
    // Completion event: the real hydration owner publishes `ready` after it
    // has applied the persisted document. The held read guarantees the shell
    // is still loading when this wait begins, so deleting the event wait cannot
    // accidentally pass just because IndexedDB was fast.
    await shellHarness.waitForHydrationReady("rehidratación ready de las marcas semánticas")
    expect(
      document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase"),
      "la reapertura terminó su evento de hidratación antes de leer las marcas",
    ).toBe("ready")
    expect(mountedShell.editor().getText()).toBe(ROUNDTRIP_TEXT)

    const reopened = semanticMarks(mountedShell.editor().getJSON())
    expect(reopened).toEqual(persistedMarks)
    expect(serializeDocumentToMarkdown(mountedShell.editor().getJSON() as never)).toBe(persistedMarkdown)
  }, 30_000)

  it("applies Entity and Highlight by pointer, undoes/redoes them, and restores after reopening", async () => {
    const writingId = "85666666-6666-4666-8666-666666666666"
    shellHarness.resetEditorShellWorld()
    await localDB.writings.save(makeLocalWriting(writingId, ROUNDTRIP_TEXT, "Pointer semantic marks"))
    await writeEditorSession(createEmptyEditorSession())

    mountedShell = await shellHarness.mountEditorShell({ writingId })
    await shellHarness.waitFor(() => getEditorSessionState().loaded || null, {
      label: "sesión cargada antes de los controles por puntero",
      timeoutMs: 20_000,
    })
    await shellHarness.waitFor(() => mountedShell!.editor().getText().includes(ROUNDTRIP_TEXT) || null, {
      label: "documento listo para los controles por puntero",
      timeoutMs: 20_000,
    })
    await shellHarness.waitForHydrationReady("controles por puntero después de hidratar")

    await shellHarness.selectEditorText("company")
    await shellHarness.waitFor(() => popupButton("More mark options"), {
      label: "popup Entity real antes del control por puntero",
      timeoutMs: 20_000,
    })
    await applyPopupEntityByPointer("Company")
    await shellHarness.waitFor(() => !document.querySelector('[data-testid="selection-popup"]') || null, {
      label: "popup Entity cerrado tras el puntero",
      timeoutMs: 20_000,
    })
    const entity = semanticMarks(mountedShell.editor().getJSON()).find((mark) => mark.kind === "entity")
    expect(entity).toEqual({ kind: "entity", text: "company", id: expect.any(String), type: "company" })
    if (entity?.kind !== "entity") throw new Error("El control positivo por puntero no creó Entity")
    await waitForPersistedSemanticMarks(writingId, "Entity aplicada por puntero llega al body_json durable", (marks) =>
      marks.some((mark) => mark.kind === "entity"),
    )

    // Consume the popup's one-shot focus suppression with the same fresh
    // selection movement used by the keyboard round-trip control.
    await shellHarness.selectEditorText("A")
    await shellHarness.selectEditorText("A")
    await shellHarness.selectEditorText("memorable")
    await shellHarness.waitFor(() => popupButton("More mark options"), {
      label: "popup Highlight real antes del control por puntero",
      timeoutMs: 20_000,
    })
    await applyPopupHighlightByPointer("Highlight Indigo")
    await shellHarness.waitFor(() => !document.querySelector('[data-testid="selection-popup"]') || null, {
      label: "popup Highlight cerrado tras el puntero",
      timeoutMs: 20_000,
    })
    const highlight = semanticMarks(mountedShell.editor().getJSON()).find((mark) => mark.kind === "highlight")
    expect(highlight).toEqual({ kind: "highlight", text: "memorable", color: "indigo" })
    expect(mountedShell.editor().getText(), "aplicar marks por puntero conserva el texto").toBe(ROUNDTRIP_TEXT)

    const bothPersisted = await waitForPersistedSemanticMarks(
      writingId,
      "Entity y Highlight por puntero llegan al body_json durable",
      (marks) => marks.some((mark) => mark.kind === "entity") && marks.some((mark) => mark.kind === "highlight"),
    )
    const bothMarks = semanticMarks(bothPersisted.body_json)
    expect(bothMarks).toContainEqual(entity)
    expect(bothMarks).toContainEqual(highlight)
    const persistedMarkdown = serializeDocumentToMarkdown(bothPersisted.body_json as never)

    await pressEditorHistoryShortcut("z")
    await shellHarness.waitFor(
      () => semanticMarks(mountedShell!.editor().getJSON()).every((mark) => mark.kind !== "highlight") || null,
      { label: "undo por teclado retira Highlight aplicado por puntero", timeoutMs: 20_000 },
    )
    expect(mountedShell.editor().getText(), "undo de Highlight conserva el texto").toBe(ROUNDTRIP_TEXT)
    const entityAfterHighlightUndo = await waitForPersistedSemanticMarks(
      writingId,
      "undo de Highlight deja Entity en el body_json durable",
      (marks) => marks.length === 1 && marks[0]?.kind === "entity",
    )
    expect(semanticMarks(entityAfterHighlightUndo.body_json)).toEqual([entity])

    await pressEditorHistoryShortcut("z")
    await shellHarness.waitFor(
      () => semanticMarks(mountedShell!.editor().getJSON()).length === 0 || null,
      { label: "undo por teclado retira Entity aplicada por puntero", timeoutMs: 20_000 },
    )
    expect(mountedShell.editor().getText(), "undo de Entity conserva el texto").toBe(ROUNDTRIP_TEXT)
    const marksAfterUndo = await waitForPersistedSemanticMarks(
      writingId,
      "undo de Entity queda durable sin marks",
      (marks) => marks.length === 0,
    )
    expect(semanticMarks(marksAfterUndo.body_json)).toEqual([])

    await pressEditorHistoryShortcut("z", true)
    await shellHarness.waitFor(
      () => semanticMarks(mountedShell!.editor().getJSON()).some((mark) => mark.kind === "entity") || null,
      { label: "redo por teclado restaura Entity aplicada por puntero", timeoutMs: 20_000 },
    )
    expect(mountedShell.editor().getText(), "redo de Entity conserva el texto").toBe(ROUNDTRIP_TEXT)
    const entityAfterRedo = await waitForPersistedSemanticMarks(
      writingId,
      "redo de Entity llega al body_json durable",
      (marks) => marks.length === 1 && marks[0]?.kind === "entity",
    )
    expect(semanticMarks(entityAfterRedo.body_json)).toEqual([entity])

    await pressEditorHistoryShortcut("z", true)
    await shellHarness.waitFor(
      () => semanticMarks(mountedShell!.editor().getJSON()).some((mark) => mark.kind === "highlight") || null,
      { label: "redo por teclado restaura Highlight aplicado por puntero", timeoutMs: 20_000 },
    )
    expect(mountedShell.editor().getText(), "redo de Highlight conserva el texto").toBe(ROUNDTRIP_TEXT)
    const bothAfterRedo = await waitForPersistedSemanticMarks(
      writingId,
      "redo de Highlight restaura ambas marcas en body_json",
      (marks) => marks.some((mark) => mark.kind === "entity") && marks.some((mark) => mark.kind === "highlight"),
    )
    expect(semanticMarks(bothAfterRedo.body_json)).toEqual(bothMarks)

    await mountedShell.render({ writingId, key: "reopen-pointer-semantic-marks" })
    await shellHarness.waitForHydrationReady("reapertura de marcas aplicadas por puntero")
    expect(mountedShell.editor().getText(), "reopen conserva el texto sin cambios").toBe(ROUNDTRIP_TEXT)
    expect(semanticMarks(mountedShell.editor().getJSON())).toEqual(bothMarks)
    expect(serializeDocumentToMarkdown(mountedShell.editor().getJSON() as never)).toBe(persistedMarkdown)
  }, 30_000)

  it("preserves a copied Entity identity when pasting within the same real shell document", async () => {
    const writingId = "85333333-3333-4333-8333-333333333333"
    const bodyText = "A company wrote this letter."
    shellHarness.resetEditorShellWorld()
    await localDB.writings.save(makeLocalWriting(writingId, bodyText, "Same-document Entity paste"))
    await writeEditorSession(createEmptyEditorSession())

    mountedShell = await shellHarness.mountEditorShell({ writingId })
    await shellHarness.waitFor(() => getEditorSessionState().loaded || null, {
      label: "sesión cargada antes de pegar una Entity",
    })
    await shellHarness.waitFor(() => shellHarness.world.editor?.getText().includes(bodyText) || null, {
      label: "documento para pegar una Entity en la misma shell",
    })
    await shellHarness.waitForHydrationReady("documento listo antes de seleccionar la Entity")

    await shellHarness.selectEditorText("company")
    await shellHarness.waitFor(() => popupButton("More mark options"), {
      label: "popup real para la Entity original",
    })
    await applyPopupEntityByKeyboard("Company")

    const original = semanticMarks(mountedShell.editor().getJSON()).find((mark) => mark.kind === "entity")
    expect(original, "control positivo: la Entity original se aplicó por el popup real").toMatchObject({
      kind: "entity",
      text: "company",
      type: "company",
    })
    if (original?.kind !== "entity") throw new Error("No se aplicó la Entity de control")

    await shellHarness.waitForAsync(
      async () => {
        const writing = await localDB.writings.get(writingId)
        return semanticMarks(writing?.body_json).some(
          (mark) => mark.kind === "entity" && mark.id === original.id,
        )
          ? writing
          : null
      },
      { label: "Entity de control persistida antes de copiar" },
    )

    await shellHarness.selectEditorText("company")
    const copiedHtml = new Map<string, string>()
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true })
    Object.defineProperty(copyEvent, "clipboardData", {
      value: { setData: (format: string, value: string) => copiedHtml.set(format, value) },
    })
    await act(async () => mountedShell!.editor().view.dom.dispatchEvent(copyEvent))
    const html = copiedHtml.get("text/html") ?? ""
    expect(html, "el copy real incluye la identidad de origen").toContain(
      `data-entity-id="${original.id}"`,
    )

    const editor = mountedShell.editor()
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (format: string) =>
          format === "text/html" ? html : format === "text/plain" ? "company" : "",
      },
    })
    await act(async () => editor.view.dom.dispatchEvent(pasteEvent))

    await shellHarness.waitFor(
      () =>
        semanticMarks(editor.getJSON()).filter((mark) => mark.kind === "entity").length === 2 || null,
      { label: "paste real agrega la segunda mención Entity", timeoutMs: 10_000 },
    )
    const pastedEntities = semanticMarks(editor.getJSON()).filter((mark) => mark.kind === "entity")
    expect(pastedEntities.map((mark) => mark.kind === "entity" && mark.id)).toEqual([
      original.id,
      original.id,
    ])
    expect(pastedEntities.map((mark) => mark.text)).toEqual(["company", "company"])

    const persisted = await shellHarness.waitForAsync(
      async () => {
        const writing = await localDB.writings.get(writingId)
        const entities = semanticMarks(writing?.body_json).filter((mark) => mark.kind === "entity")
        return entities.length === 2 ? writing : null
      },
      { label: "las dos menciones con la misma identidad llegan a body_json" },
    )
    expect(
      semanticMarks(persisted.body_json).filter((mark) => mark.kind === "entity").map((mark) => mark.kind === "entity" && mark.id),
    ).toEqual([original.id, original.id])
  }, 30_000)

  it("undoes and redoes an Entity through the real shell", async () => {
    const writingId = "85444444-4444-4444-8444-444444444444"
    shellHarness.resetEditorShellWorld()
    await localDB.writings.save(makeLocalWriting(writingId, ROUNDTRIP_TEXT, "Semantic Entity history"))
    await writeEditorSession(createEmptyEditorSession())

    mountedShell = await shellHarness.mountEditorShell({ writingId })
    await shellHarness.waitFor(() => getEditorSessionState().loaded || null, {
      label: "sesión cargada antes del historial Entity",
    })
    await shellHarness.waitFor(() => shellHarness.world.editor?.getText().includes(ROUNDTRIP_TEXT) || null, {
      label: "documento listo para historial semántico",
    })
    await shellHarness.waitForHydrationReady("historial semántico después de hidratar")

    await shellHarness.selectEditorText("company")
    await shellHarness.waitFor(() => popupButton("More mark options"), {
      label: "popup Entity antes de undo",
    })
    await applyPopupEntityByKeyboard("Company")
    await shellHarness.waitFor(
      () => (!document.querySelector('[data-testid="selection-popup"]') ? true : null),
      { label: "popup Entity cerrado después de aplicar la marca" },
    )
    const entity = semanticMarks(mountedShell.editor().getJSON()).find((mark) => mark.kind === "entity")
    expect(entity?.kind).toBe("entity")
    if (entity?.kind !== "entity") throw new Error("La Entity de control no apareció")

    await shellHarness.waitForAsync(
      async () => {
        const writing = await localDB.writings.get(writingId)
        return semanticMarks(writing?.body_json).some((mark) => mark.kind === "entity") ? writing : null
      },
      { label: "Entity durable antes del undo", timeoutMs: 20_000 },
    )
    await pressEditorHistoryShortcut("z")
    await shellHarness.waitFor(
      () => semanticMarks(mountedShell!.editor().getJSON()).every((mark) => mark.kind !== "entity") || null,
      { label: "undo real retira la Entity del editor", timeoutMs: 20_000 },
    )
    expect(mountedShell.editor().getText(), "undo de Entity conserva el texto").toBe(ROUNDTRIP_TEXT)
    await shellHarness.waitForAsync(
      async () => {
        const writing = await localDB.writings.get(writingId)
        return semanticMarks(writing?.body_json).every((mark) => mark.kind !== "entity") ? writing : null
      },
      { label: "undo real se confirma en body_json", timeoutMs: 20_000 },
    )
    await pressEditorHistoryShortcut("z", true)
    await shellHarness.waitFor(
      () => semanticMarks(mountedShell!.editor().getJSON()).some((mark) => mark.kind === "entity") || null,
      { label: "redo real restaura la Entity del editor", timeoutMs: 20_000 },
    )
    expect(mountedShell.editor().getText(), "redo de Entity conserva el texto").toBe(ROUNDTRIP_TEXT)
    expect(semanticMarks(mountedShell.editor().getJSON())).toContainEqual(entity)
    const persistedEntity = await shellHarness.waitForAsync(
      async () => {
        const writing = await localDB.writings.get(writingId)
        return semanticMarks(writing?.body_json).some((mark) => mark.kind === "entity") ? writing : null
      },
      { label: "redo de Entity llega al estado durable", timeoutMs: 20_000 },
    )
    expect(semanticMarks(persistedEntity.body_json)).toContainEqual(entity)
  }, 30_000)

  it("undoes and redoes a Highlight through the real shell", async () => {
    const writingId = "85555555-5555-4555-8555-555555555555"
    shellHarness.resetEditorShellWorld()
    await localDB.writings.save(makeLocalWriting(writingId, ROUNDTRIP_TEXT, "Semantic Highlight history"))
    await writeEditorSession(createEmptyEditorSession())

    mountedShell = await shellHarness.mountEditorShell({ writingId })
    await shellHarness.waitFor(() => getEditorSessionState().loaded || null, {
      label: "sesión cargada antes del historial Highlight",
    })
    await shellHarness.waitFor(() => shellHarness.world.editor?.getText().includes(ROUNDTRIP_TEXT) || null, {
      label: "documento listo para el historial de Highlight",
    })
    await shellHarness.waitForHydrationReady("Highlight después de hidratar")

    await shellHarness.selectEditorText("A")
    await shellHarness.selectEditorText("memorable")
    await shellHarness.waitFor(() => popupButton("More mark options"), {
      label: "popup Highlight antes de undo",
    })
    await applyPopupHighlightByKeyboard("Highlight Indigo")
    await shellHarness.waitFor(
      () => (!document.querySelector('[data-testid="selection-popup"]') ? true : null),
      { label: "popup Highlight cerrado después de aplicar la marca" },
    )
    const highlight = semanticMarks(mountedShell.editor().getJSON()).find((mark) => mark.kind === "highlight")
    expect(highlight).toEqual({ kind: "highlight", text: "memorable", color: "indigo" })

    await shellHarness.waitForAsync(
      async () => {
        const writing = await localDB.writings.get(writingId)
        return semanticMarks(writing?.body_json).some((mark) => mark.kind === "highlight") ? writing : null
      },
      { label: "Highlight durable antes del undo", timeoutMs: 20_000 },
    )
    await pressEditorHistoryShortcut("z")
    await shellHarness.waitFor(
      () => semanticMarks(mountedShell!.editor().getJSON()).every((mark) => mark.kind !== "highlight") || null,
      { label: "undo real retira el Highlight del editor", timeoutMs: 20_000 },
    )
    expect(mountedShell.editor().getText(), "undo de Highlight conserva el texto").toBe(ROUNDTRIP_TEXT)
    await shellHarness.waitForAsync(
      async () => {
        const writing = await localDB.writings.get(writingId)
        return semanticMarks(writing?.body_json).every((mark) => mark.kind !== "highlight") ? writing : null
      },
      { label: "undo real del Highlight se confirma en body_json", timeoutMs: 20_000 },
    )
    await pressEditorHistoryShortcut("z", true)
    await shellHarness.waitFor(
      () => semanticMarks(mountedShell!.editor().getJSON()).some((mark) => mark.kind === "highlight") || null,
      { label: "redo real restaura el Highlight del editor", timeoutMs: 20_000 },
    )
    expect(mountedShell.editor().getText(), "redo de Highlight conserva el texto").toBe(ROUNDTRIP_TEXT)
    expect(semanticMarks(mountedShell.editor().getJSON())).toContainEqual(highlight)

    const persistedHighlight = await shellHarness.waitForAsync(
      async () => {
        const writing = await localDB.writings.get(writingId)
        return semanticMarks(writing?.body_json).some((mark) => mark.kind === "highlight") ? writing : null
      },
      { label: "redo de Highlight llega al estado durable", timeoutMs: 20_000 },
    )
    expect(semanticMarks(persistedHighlight.body_json)).toContainEqual(highlight)
  }, 30_000)
})
