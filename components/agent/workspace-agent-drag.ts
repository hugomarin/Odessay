"use client"

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

/**
 * Cross-component drag-and-drop for the Workspace agent's composer.
 *
 * Native HTML5 drag-and-drop (`draggable`, `dragstart`/`dragover`/`drop`,
 * `dataTransfer`) does not fire reliably inside Tauri's WKWebView — the same
 * root cause already worked around for editor tab reordering (see
 * `components/editor/editor-tabs.tsx`, ODE-365). This reimplements drag with
 * the Pointer Events API instead: a manually-positioned ghost chip, a
 * `document.elementFromPoint` hit-test against elements tagged with
 * `data-workspace-agent-dropzone`, and custom DOM events so the drag source
 * (tree/list rows) and the drop target (the agent composer) don't need to
 * share a React tree or context.
 *
 * The tab fix also had to solve a second problem: pointer capture during a
 * drag can suppress (or, worse, leave dangling) the browser's native `click`
 * that would otherwise follow pointerup, so a plain drag on a clickable row
 * would also "click" it. Rather than re-plumb every drag source's own click
 * handling, this module centralizes that fix once — a capture-phase
 * `click` listener swallows exactly the one click that would follow an
 * actual drag (never a plain click, since the flag is only set once the
 * pointer moves past the drag threshold).
 */

export type WorkspaceAgentDragPayload = {
  kind: "file" | "folder"
  id?: string
  path: string
  label: string
}

const DRAG_THRESHOLD_PX = 5
const DROPZONE_ATTR = "data-workspace-agent-dropzone"
const DRAGGING_HTML_CLASS = "od-workspace-agent-dragging"
const DRAGOVER_EVENT = "workspace-agent-dragover"
const DRAGLEAVE_EVENT = "workspace-agent-dragleave"
const DROP_EVENT = "workspace-agent-drop"

let suppressNextClick = false
let clickGuardInstalled = false

function ensureClickGuard() {
  if (clickGuardInstalled || typeof document === "undefined") return
  clickGuardInstalled = true
  document.addEventListener("click", (event) => {
    if (!suppressNextClick) return
    suppressNextClick = false
    event.preventDefault()
    event.stopPropagation()
  }, true)
}

type DragState = {
  startX: number
  startY: number
  payload: WorkspaceAgentDragPayload
  dragging: boolean
  ghost: HTMLElement | null
  currentZone: Element | null
}

let active: DragState | null = null

function createGhost(payload: WorkspaceAgentDragPayload): HTMLElement {
  const ghost = document.createElement("div")
  ghost.setAttribute("data-workspace-agent-drag-ghost", "true")
  ghost.className =
    "pointer-events-none fixed z-[200] flex h-[26px] items-center gap-1.5 rounded-[7px] border-[0.5px] border-border bg-sb pl-2 pr-2.5 text-[12px] font-medium text-ink shadow-[0_10px_30px_rgba(35,24,15,0.18)]"
  const label = document.createElement("span")
  label.className = "max-w-[200px] truncate"
  label.textContent = payload.label
  ghost.appendChild(label)
  document.body.appendChild(ghost)
  return ghost
}

function positionGhost(ghost: HTMLElement, x: number, y: number) {
  ghost.style.left = `${x + 14}px`
  ghost.style.top = `${y + 16}px`
}

function cleanup() {
  window.removeEventListener("pointermove", handleMove)
  window.removeEventListener("pointerup", handleUp)
  window.removeEventListener("pointercancel", handleUp)
  if (active?.currentZone) active.currentZone.dispatchEvent(new CustomEvent(DRAGLEAVE_EVENT))
  active?.ghost?.remove()
  document.documentElement.classList.remove(DRAGGING_HTML_CLASS)
  active = null
}

function handleMove(event: PointerEvent) {
  if (!active) return
  const dx = event.clientX - active.startX
  const dy = event.clientY - active.startY

  if (!active.dragging) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    active.dragging = true
    suppressNextClick = true
    window.getSelection?.()?.removeAllRanges()
    document.documentElement.classList.add(DRAGGING_HTML_CLASS)
    active.ghost = createGhost(active.payload)
  }

  if (active.ghost) positionGhost(active.ghost, event.clientX, event.clientY)

  const under = document.elementFromPoint(event.clientX, event.clientY)
  const zone = under instanceof Element ? under.closest(`[${DROPZONE_ATTR}]`) : null
  if (zone !== active.currentZone) {
    active.currentZone?.dispatchEvent(new CustomEvent(DRAGLEAVE_EVENT))
    zone?.dispatchEvent(new CustomEvent(DRAGOVER_EVENT))
    active.currentZone = zone
  }
}

function handleUp() {
  if (!active) return
  const wasDragging = active.dragging
  const zone = active.currentZone
  const payload = active.payload
  cleanup()
  if (wasDragging && zone) {
    zone.dispatchEvent(new CustomEvent(DROP_EVENT, { detail: payload }))
  }
  if (suppressNextClick) {
    // Safety net: a click normally follows pointerup in the same task, but if
    // the drop landed somewhere that never emits one, don't leave the guard
    // armed to swallow an unrelated click later.
    window.setTimeout(() => { suppressNextClick = false }, 400)
  }
}

/** Attach to a draggable source's `onPointerDown` — replaces `draggable`/`onDragStart`. */
export function startWorkspaceAgentDrag(event: ReactPointerEvent, payload: WorkspaceAgentDragPayload) {
  if (event.button !== 0) return
  // Mouse's default pointerdown action includes starting a text/DOM selection
  // drag — without preventing it, every row and label under the cursor path
  // gets selected as the gesture moves (only clearing it once, at the
  // threshold crossing, isn't enough — the browser keeps re-extending it on
  // every subsequent mousemove). This does NOT suppress the eventual click
  // for mouse input; that's handled separately by the click guard below.
  event.preventDefault()
  ensureClickGuard()
  if (active) cleanup()
  active = { startX: event.clientX, startY: event.clientY, payload, dragging: false, ghost: null, currentZone: null }
  window.addEventListener("pointermove", handleMove)
  window.addEventListener("pointerup", handleUp)
  window.addEventListener("pointercancel", handleUp)
}

/**
 * Marks an element as a drop target and reports hover/drop state — replaces
 * `onDragOver`/`onDragLeave`/`onDrop`. Uses a callback ref (not `useEffect`)
 * so it re-attaches correctly if the underlying DOM node is ever swapped
 * (e.g. the agent panel remounting when it switches between sidebar and
 * floating anchoring), which a `useRef` + effect pair would miss since
 * neither triggers a re-run on its own.
 */
export function useWorkspaceAgentDropZone(onDrop: (payload: WorkspaceAgentDragPayload) => void) {
  const [isOver, setIsOver] = useState(false)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop
  const detachRef = useRef<(() => void) | null>(null)

  const ref = useCallback((node: HTMLDivElement | null) => {
    detachRef.current?.()
    detachRef.current = null
    if (!node) return

    node.setAttribute(DROPZONE_ATTR, "true")
    const onOver = () => setIsOver(true)
    const onLeave = () => setIsOver(false)
    const onDropEvent = (event: Event) => {
      setIsOver(false)
      const detail = (event as CustomEvent<WorkspaceAgentDragPayload>).detail
      if (detail) onDropRef.current(detail)
    }
    node.addEventListener(DRAGOVER_EVENT, onOver)
    node.addEventListener(DRAGLEAVE_EVENT, onLeave)
    node.addEventListener(DROP_EVENT, onDropEvent)
    detachRef.current = () => {
      node.removeAttribute(DROPZONE_ATTR)
      node.removeEventListener(DRAGOVER_EVENT, onOver)
      node.removeEventListener(DRAGLEAVE_EVENT, onLeave)
      node.removeEventListener(DROP_EVENT, onDropEvent)
    }
  }, [])

  return { ref, isOver }
}
