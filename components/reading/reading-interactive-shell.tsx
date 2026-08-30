"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { JSONContent } from "@tiptap/core"
import type { ReactNode } from "react"
import { ReadingTopbar } from "./reading-topbar"
import { ReadingContent } from "./reading-content"
import { SelectionPopup, type SelectionPopupPosition } from "./margins/selection-popup"
import {
  AnnotationBubble,
  nextAnnotationSessionId,
  type AnnotationBubblePosition,
} from "./margins/annotation-bubble"
import { HighlightLayer, findTextPosition, type MarginHighlight } from "./margins/highlight-layer"
import { MarginsPanel } from "./margins/margins-panel"
import type { SelectionPreviewRect } from "./margins/selection-preview-layer"
import type { MarginData } from "./margins/margin-entry"
import { applyAnnotationToBody, getBodyMarkdown } from "@/lib/editor/annotation-document"
import { buildAiAnnotationCopy } from "@/lib/editor/footnote-extension"
import { buildSelectionGeometry } from "@/lib/reading/selection-geometry"
import { areFloatingOverlayAnchorsEqual } from "@/lib/reading/floating-overlay-position"

// ─── Types ───────────────────────────────────────────────────────────────────

type SelectionInfo = {
  anchorStart: number
  anchorEnd: number
  anchorText: string
  popupPosition: SelectionPopupPosition
  bubblePosition: AnnotationBubblePosition
  selectionRects: SelectionPreviewRect[]
}

function areSelectionPreviewRectsEqual(a: SelectionPreviewRect[], b: SelectionPreviewRect[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((rect, index) => {
    const other = b[index]
    return (
      rect.key === other.key &&
      rect.top === other.top &&
      rect.left === other.left &&
      rect.width === other.width &&
      rect.height === other.height
    )
  })
}

// ─── Offset helpers ───────────────────────────────────────────────────────────

function selectionToOffsets(
  container: Element,
  selection: Selection,
): { start: number; end: number; text: string } | null {
  if (selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const text = range.toString().trim()
  if (!text) return null
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null
  }

  const preRange = document.createRange()
  preRange.selectNodeContents(container)
  preRange.setEnd(range.startContainer, range.startOffset)
  const start = preRange.toString().length
  const end = start + range.toString().length

  return { start, end, text }
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetchMargins(writingId: string): Promise<MarginData[]> {
  const res = await fetch(`/api/margins?writing_id=${writingId}`)
  const json: { data: MarginData[] | null; error: { message: string } | null } = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message ?? "Failed to fetch margins")
  return json.data ?? []
}

async function apiAnnotateWriting(
  writingId: string,
  payload: {
    body_json: Record<string, unknown>
    body_text: string
    body_markdown: string
  },
): Promise<{
  margins: MarginData[]
  bodyMarkdown: string | null
  writing: { body_json: JSONContent | null; body_text: string; updated_at: string }
}> {
  const res = await fetch(`/api/writings/${writingId}/annotate`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const json: {
    data:
      | {
          writing: { body_json: JSONContent | null; body_text: string; updated_at: string }
          margins: MarginData[]
          body_markdown: string | null
        }
      | null
    error: { message: string } | null
  } = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message ?? "Failed to annotate artifact")
  if (!json.data) throw new Error("No data returned")
  return {
    margins: json.data.margins,
    bodyMarkdown: json.data.body_markdown,
    writing: json.data.writing,
  }
}

async function apiUpdateMarginNote(id: string, note: string | null): Promise<MarginData> {
  const res = await fetch(`/api/margins/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: note }),
  })
  const json: { data: MarginData | null; error: { message: string } | null } = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message ?? "Failed to update margin")
  if (!json.data) throw new Error("No data returned")
  return json.data
}

async function apiDeleteMargin(id: string): Promise<void> {
  const res = await fetch(`/api/margins/${id}`, { method: "DELETE" })
  if (!res.ok && res.status !== 204) {
    const json: { error?: { message?: string } } = await res.json().catch(() => ({}))
    throw new Error(json.error?.message ?? "Failed to delete margin")
  }
}

async function apiShareMargins(writingId: string): Promise<MarginData[]> {
  const res = await fetch("/api/margins", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ writing_id: writingId }),
  })
  const json: { data: MarginData[] | null; error: { message: string } | null } = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message ?? "Failed to share margins")
  return json.data ?? []
}

async function apiToggleMarginShare(id: string, shared: boolean): Promise<MarginData> {
  const res = await fetch(`/api/margins/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shared }),
  })
  const json: { data: MarginData | null; error: { message: string } | null } = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message ?? "Failed to toggle margin share")
  if (!json.data) throw new Error("No data returned")
  return json.data
}

// ─── Component ────────────────────────────────────────────────────────────────

export type ReadingInteractiveShellProps = {
  writing: {
    id: string
    title: string | null
    bodyJson: JSONContent | null
    bodyText: string
    updatedAt: string
  }
  author: { displayName: string; username: string } | null
  prevWritingId?: string | null
  nextWritingId?: string | null
  prevWritingHref?: string | null
  nextWritingHref?: string | null
  sequencePosition?: number | null
  sequenceTotal?: number | null
  canRespond: boolean
  backUrl?: string
  isAuthenticated: boolean
  chromeMode?: "default" | "public"
  publicHeader?: {
    logoHref: string
    accountHref: string
    accountLabel: string
  }
  respondHref?: string
  extraActionLabel?: string
  extraActionHref?: string | null
  extraActionNode?: ReactNode
}

export function ReadingInteractiveShell({
  writing,
  author,
  prevWritingId = null,
  nextWritingId = null,
  prevWritingHref = null,
  nextWritingHref = null,
  sequencePosition = null,
  sequenceTotal = null,
  canRespond,
  backUrl = "/shared",
  isAuthenticated,
  chromeMode = "default",
  publicHeader,
  respondHref,
  extraActionLabel,
  extraActionHref = null,
  extraActionNode,
}: ReadingInteractiveShellProps) {
  const [marginPanelOpen, setMarginPanelOpen] = useState(false)
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null)
  const [annotationType, setAnnotationType] = useState<"personal" | "ai" | "footnote" | null>(null)
  // Draft identity, minted when the reader opens a bubble and held until the
  // draft is confirmed or dismissed — geometry updates never touch it (ODE-409).
  const [annotationSessionId, setAnnotationSessionId] = useState<string | null>(null)
  const [margins, setMargins] = useState<MarginData[]>([])
  const [currentBodyJson, setCurrentBodyJson] = useState<JSONContent | null>(writing.bodyJson)
  const [currentBodyText, setCurrentBodyText] = useState<string>(writing.bodyText)
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState<string>(writing.updatedAt)
  const [bodyMarkdown, setBodyMarkdown] = useState<string>(() => getBodyMarkdown(writing.bodyJson) || writing.bodyText)
  const bodyRef = useRef<HTMLDivElement>(null)
  const selectionRangeRef = useRef<Range | null>(null)
  const scrollHighlightTimeoutRef = useRef<number | null>(null)

  // ─── Fetch margins ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated) return
    apiFetchMargins(writing.id).then(setMargins).catch(console.error)
  }, [writing.id, isAuthenticated])

  useEffect(() => {
    setCurrentBodyJson(writing.bodyJson)
    setCurrentBodyText(writing.bodyText)
    setCurrentUpdatedAt(writing.updatedAt)
    setBodyMarkdown(getBodyMarkdown(writing.bodyJson) || writing.bodyText)
  }, [writing.bodyJson, writing.bodyText, writing.updatedAt])

  const alreadyShared = margins.length > 0 && margins.every((m) => m.shared)

  // ─── Mutations ─────────────────────────────────────────────────────────────

  function handleUpdateNote(id: string, note: string | null) {
    apiUpdateMarginNote(id, note)
      .then((updated) => {
        setMargins((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      })
      .catch(console.error)
  }

  function handleDelete(id: string) {
    // Optimistic remove
    setMargins((prev) => prev.filter((m) => m.id !== id))
    apiDeleteMargin(id).catch((err) => {
      console.error("[margins:delete]", err)
      // Refetch on error to restore state
      apiFetchMargins(writing.id).then(setMargins).catch(console.error)
    })
  }

  function handleShare() {
    apiShareMargins(writing.id)
      .then((updated) => {
        setMargins((prev) =>
          prev.map((m) => {
            const found = updated.find((u) => u.id === m.id)
            return found ?? m
          }),
        )
      })
      .catch(console.error)
  }

  function handleToggleShare(id: string, shared: boolean) {
    apiToggleMarginShare(id, shared)
      .then((updated) => {
        setMargins((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      })
      .catch(console.error)
  }

  // ─── Selection handling ────────────────────────────────────────────────────

  const dismissSelection = useCallback(() => {
    selectionRangeRef.current = null
    setSelectionInfo(null)
    setAnnotationType(null)
    setAnnotationSessionId(null)
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return

    function handleMouseUp(event: MouseEvent) {
      const eventTarget = event.target
      if (eventTarget instanceof Element && eventTarget.closest(".SelectionPopup, .AnnotationBubble")) {
        return
      }

      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setSelectionInfo(null)
        setAnnotationType(null)
        return
      }

      const body = bodyRef.current
      if (!body) return

      const offsets = selectionToOffsets(body, selection)
      if (!offsets || !offsets.text) {
        setSelectionInfo(null)
        setAnnotationType(null)
        return
      }

      const range = selection.getRangeAt(0)
      const rects = Array.from(range.getClientRects())
      if (!rects.length) return

      const geometry = buildSelectionGeometry({
        rects,
        bodyRect: body.getBoundingClientRect(),
        anchorStart: offsets.start,
        anchorEnd: offsets.end,
      })
      if (!geometry) return
      selectionRangeRef.current = range.cloneRange()

      setAnnotationType(null)
      setSelectionInfo({
        anchorStart: offsets.start,
        anchorEnd: offsets.end,
        anchorText: offsets.text,
        popupPosition: geometry.popupPosition,
        bubblePosition: geometry.bubblePosition,
        selectionRects: geometry.previewRects,
      })
    }

    document.addEventListener("mouseup", handleMouseUp)
    return () => document.removeEventListener("mouseup", handleMouseUp)
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !selectionInfo) return

    const body = bodyRef.current
    if (!body) return
    const { anchorStart, anchorEnd } = selectionInfo

    const scrollContainer = body.closest("#reading-text")

    function syncSelectionGeometry() {
      const range = selectionRangeRef.current
      const bodyNode = bodyRef.current
      if (!range || !bodyNode) return
      if (!bodyNode.contains(range.startContainer) || !bodyNode.contains(range.endContainer)) {
        dismissSelection()
        return
      }

      const geometry = buildSelectionGeometry({
        rects: Array.from(range.getClientRects()),
        bodyRect: bodyNode.getBoundingClientRect(),
        anchorStart,
        anchorEnd,
      })

      if (!geometry) {
        dismissSelection()
        return
      }

      // ODE-409: keep the previous objects when the geometry did not move, so a
      // scroll that changes nothing cannot look like a new annotation session
      // to the bubble.
      setSelectionInfo((prev) => {
        if (!prev) return prev

        const popupPosition = areFloatingOverlayAnchorsEqual(prev.popupPosition, geometry.popupPosition)
          ? prev.popupPosition
          : geometry.popupPosition
        const bubblePosition = areFloatingOverlayAnchorsEqual(prev.bubblePosition, geometry.bubblePosition)
          ? prev.bubblePosition
          : geometry.bubblePosition
        const selectionRects = areSelectionPreviewRectsEqual(prev.selectionRects, geometry.previewRects)
          ? prev.selectionRects
          : geometry.previewRects

        if (
          popupPosition === prev.popupPosition &&
          bubblePosition === prev.bubblePosition &&
          selectionRects === prev.selectionRects
        ) {
          return prev
        }

        return { ...prev, popupPosition, bubblePosition, selectionRects }
      })
    }

    window.addEventListener("resize", syncSelectionGeometry)
    scrollContainer?.addEventListener("scroll", syncSelectionGeometry, { passive: true })

    return () => {
      window.removeEventListener("resize", syncSelectionGeometry)
      scrollContainer?.removeEventListener("scroll", syncSelectionGeometry)
    }
  }, [isAuthenticated, selectionInfo, dismissSelection])

  // Dismiss popup on Escape
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") dismissSelection()
    }
    document.addEventListener("keydown", handleKeydown)
    return () => document.removeEventListener("keydown", handleKeydown)
  }, [dismissSelection])

  // ─── Actions ───────────────────────────────────────────────────────────────

  function handleSelectType(type: "personal" | "ai" | "footnote") {
    setAnnotationType(type)
    setAnnotationSessionId(nextAnnotationSessionId())
  }

  function handleAnnotateConfirm(note: string, selectedType = annotationType) {
    if (!selectionInfo) return
    if (!selectedType) return

    const nextAnnotationText = selectedType === "personal" && note.trim().length === 0 ? "Marked for later" : note

    try {
      const updated = applyAnnotationToBody({
        bodyJson: currentBodyJson,
        bodyText: currentBodyText,
        anchorStart: selectionInfo.anchorStart,
        anchorEnd: selectionInfo.anchorEnd,
        type: selectedType,
        text: nextAnnotationText,
      })

      apiAnnotateWriting(writing.id, {
        body_json: updated.bodyJson as Record<string, unknown>,
        body_text: updated.bodyText,
        body_markdown: updated.bodyMarkdown,
      })
        .then((response) => {
          setMargins(response.margins)
          setCurrentBodyJson(response.writing.body_json)
          setCurrentBodyText(response.writing.body_text)
          setCurrentUpdatedAt(response.writing.updated_at)
          if (response.bodyMarkdown) {
            setBodyMarkdown(response.bodyMarkdown)
          }
        })
        .catch(console.error)

      window.getSelection()?.removeAllRanges()
      dismissSelection()
      setMarginPanelOpen(true)
    } catch (error) {
      console.error("[reading:annotate]", error)
    }
  }

  const handleHighlightClick = useCallback((marginId: string) => {
    setMarginPanelOpen(true)
    setTimeout(() => {
      const el = document.querySelector(`[data-margin-id="${marginId}"] textarea`)
      if (el instanceof HTMLElement) el.focus()
    }, 350)
  }, [])

  const handleScrollToText = useCallback((anchorStart: number) => {
    const root = bodyRef.current
    if (!root) return

    const position = findTextPosition(root, anchorStart)
    const targetNode = position?.node.parentElement
    if (!targetNode) return

    if (scrollHighlightTimeoutRef.current !== null) {
      window.clearTimeout(scrollHighlightTimeoutRef.current)
    }

    root.querySelectorAll(".hl.scroll-target").forEach((element) => {
      element.classList.remove("scroll-target")
    })

    const targetHighlight = targetNode.closest(".hl[data-id]")
    const targetElement = targetHighlight instanceof HTMLElement ? targetHighlight : targetNode

    if (!(targetElement instanceof HTMLElement)) return

    targetElement.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
    targetElement.classList.add("scroll-target")

    scrollHighlightTimeoutRef.current = window.setTimeout(() => {
      targetElement.classList.remove("scroll-target")
      scrollHighlightTimeoutRef.current = null
    }, 1800)
  }, [])

  // ─── Derived data ──────────────────────────────────────────────────────────

  const highlightMargins: MarginHighlight[] = margins.map((m) => ({
    id: m.id,
    anchor_start: m.anchor_start,
    anchor_end: m.anchor_end,
    note: m.text ?? m.note ?? null,
    type: m.type,
  }))

  const annotationBubblePosition = selectionInfo?.bubblePosition ?? null
  const handleCopyAiAnnotations = useCallback(async () => {
    const copy = buildAiAnnotationCopy(bodyMarkdown)
    try {
      await navigator.clipboard.writeText(copy.annotationsOnly)
    } catch {
      console.error("[reading:copy-ai-annotations] Clipboard write failed")
    }
  }, [bodyMarkdown])

  const handleCopyAiFullText = useCallback(async () => {
    const copy = buildAiAnnotationCopy(bodyMarkdown)
    try {
      await navigator.clipboard.writeText(copy.fullText)
    } catch {
      console.error("[reading:copy-ai-full-text] Clipboard write failed")
    }
  }, [bodyMarkdown])

  useEffect(() => {
    return () => {
      if (scrollHighlightTimeoutRef.current !== null) {
        window.clearTimeout(scrollHighlightTimeoutRef.current)
      }
    }
  }, [])

  return (
    <section
      id="reading-view"
      data-page="reading-view"
      className="flex h-[100dvh] flex-col overflow-hidden bg-bg"
    >
      <ReadingTopbar
        writingId={writing.id}
        backUrl={backUrl}
        prevWritingId={prevWritingId}
        nextWritingId={nextWritingId}
        prevWritingHref={prevWritingHref}
        nextWritingHref={nextWritingHref}
        sequencePosition={sequencePosition}
        sequenceTotal={sequenceTotal}
        canRespond={canRespond}
        marginPanelOpen={marginPanelOpen}
        onToggleMarginPanel={() => setMarginPanelOpen((v) => !v)}
        isAuthenticated={isAuthenticated}
        mode={chromeMode}
      publicHeader={publicHeader}
      respondHref={respondHref}
      extraActionLabel={extraActionLabel}
      extraActionHref={extraActionHref}
      extraActionNode={extraActionNode}
    />

      <div
        id="reading-body-shell"
        data-section="reading-body-shell"
        data-testid="reading-body-shell"
        className="ReadingBodyShell relative flex min-h-0 flex-1 overflow-hidden"
      >
        {/* Reading content + highlight overlay */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <ReadingContent
            title={writing.title}
            bodyJson={currentBodyJson}
            bodyText={currentBodyText}
            author={author}
            updatedAt={currentUpdatedAt}
            bodyRef={bodyRef}
            selectionPreviewRects={selectionInfo?.selectionRects ?? null}
          />

          {isAuthenticated && (
            <HighlightLayer
              key={writing.id}
              bodyRef={bodyRef}
              margins={highlightMargins}
              onHighlightClick={handleHighlightClick}
            />
          )}
        </div>

        {/* Margin panel */}
        {isAuthenticated && (
          <MarginsPanel
            open={marginPanelOpen}
            margins={margins}
            authorName={author?.displayName ?? null}
            onUpdateNote={handleUpdateNote}
            onDelete={handleDelete}
            onShare={handleShare}
            onToggleShare={handleToggleShare}
            onScrollToText={handleScrollToText}
            onCopyAiAnnotations={handleCopyAiAnnotations}
            onCopyAiFullText={handleCopyAiFullText}
            alreadyShared={alreadyShared}
            onClose={() => setMarginPanelOpen(false)}
          />
        )}
      </div>

      {/* Selection popup */}
      {isAuthenticated && !annotationType && (
        <SelectionPopup
          position={selectionInfo?.popupPosition ?? null}
          onSelectType={handleSelectType}
          onDismiss={dismissSelection}
        />
      )}

      {/* Annotation bubble */}
      {isAuthenticated && annotationType && (
        <AnnotationBubble
          position={annotationBubblePosition}
          sessionId={annotationSessionId}
          type={annotationType}
          onConfirm={handleAnnotateConfirm}
          onCancel={dismissSelection}
        />
      )}
    </section>
  )
}
