"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { JSONContent } from "@tiptap/core"
import { ReadingTopbar } from "./reading-topbar"
import { ReadingContent } from "./reading-content"
import { SelectionPopup } from "./margins/selection-popup"
import { AnnotationBubble } from "./margins/annotation-bubble"
import { HighlightLayer, type MarginHighlight } from "./margins/highlight-layer"
import { MarginsPanel } from "./margins/margins-panel"
import type { MarginData } from "./margins/margin-entry"

// ─── Types ───────────────────────────────────────────────────────────────────

type SelectionInfo = {
  anchorStart: number
  anchorEnd: number
  anchorText: string
  popupPosition: { x: number; y: number }
  selectionRect: DOMRect
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
  if (!container.contains(range.commonAncestorContainer)) return null

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

async function apiCreateMargin(payload: {
  writing_id: string
  anchor_start: number
  anchor_end: number
  anchor_text: string
  note?: string | null
}): Promise<MarginData> {
  const res = await fetch("/api/margins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const json: { data: MarginData | null; error: { message: string } | null } = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message ?? "Failed to create margin")
  if (!json.data) throw new Error("No data returned")
  return json.data
}

async function apiUpdateMarginNote(id: string, note: string | null): Promise<MarginData> {
  const res = await fetch(`/api/margins/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
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
}

export function ReadingInteractiveShell({
  writing,
  author,
  prevWritingId = null,
  nextWritingId = null,
  sequencePosition = null,
  sequenceTotal = null,
  canRespond,
  backUrl = "/shared",
  isAuthenticated,
  chromeMode = "default",
  publicHeader,
  respondHref,
}: ReadingInteractiveShellProps) {
  const [marginPanelOpen, setMarginPanelOpen] = useState(false)
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null)
  const [annotationMode, setAnnotationMode] = useState(false)
  const [margins, setMargins] = useState<MarginData[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)

  // ─── Fetch margins ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated) return
    apiFetchMargins(writing.id).then(setMargins).catch(console.error)
  }, [writing.id, isAuthenticated])

  const alreadyShared = margins.length > 0 && margins.every((m) => m.shared)

  // ─── Mutations ─────────────────────────────────────────────────────────────

  function handleCreate(payload: {
    writing_id: string
    anchor_start: number
    anchor_end: number
    anchor_text: string
    note?: string | null
  }) {
    apiCreateMargin(payload)
      .then((created) => {
        setMargins((prev) =>
          [...prev, created].sort((a, b) => a.anchor_start - b.anchor_start),
        )
      })
      .catch(console.error)
  }

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

  // ─── Selection handling ────────────────────────────────────────────────────

  const dismissSelection = useCallback(() => {
    setSelectionInfo(null)
    setAnnotationMode(false)
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return

    function handleMouseUp() {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setSelectionInfo(null)
        setAnnotationMode(false)
        return
      }

      const body = bodyRef.current
      if (!body) return

      const offsets = selectionToOffsets(body, selection)
      if (!offsets || !offsets.text) {
        setSelectionInfo(null)
        setAnnotationMode(false)
        return
      }

      const range = selection.getRangeAt(0)
      const rects = Array.from(range.getClientRects())
      if (!rects.length) return

      const firstRect = rects[0]
      if (!firstRect) return

      const popupPosition = {
        x: firstRect.left + firstRect.width / 2,
        y: firstRect.top - 8,
      }

      setAnnotationMode(false)
      setSelectionInfo({
        anchorStart: offsets.start,
        anchorEnd: offsets.end,
        anchorText: offsets.text,
        popupPosition,
        selectionRect: firstRect,
      })
    }

    document.addEventListener("mouseup", handleMouseUp)
    return () => document.removeEventListener("mouseup", handleMouseUp)
  }, [isAuthenticated])

  // Dismiss popup on Escape
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") dismissSelection()
    }
    document.addEventListener("keydown", handleKeydown)
    return () => document.removeEventListener("keydown", handleKeydown)
  }, [dismissSelection])

  // ─── Actions ───────────────────────────────────────────────────────────────

  function handleMark() {
    if (!selectionInfo) return
    handleCreate({
      writing_id: writing.id,
      anchor_start: selectionInfo.anchorStart,
      anchor_end: selectionInfo.anchorEnd,
      anchor_text: selectionInfo.anchorText,
      note: null,
    })
    window.getSelection()?.removeAllRanges()
    dismissSelection()
  }

  function handleAnnotateOpen() {
    setAnnotationMode(true)
  }

  function handleAnnotateConfirm(note: string) {
    if (!selectionInfo) return
    handleCreate({
      writing_id: writing.id,
      anchor_start: selectionInfo.anchorStart,
      anchor_end: selectionInfo.anchorEnd,
      anchor_text: selectionInfo.anchorText,
      note,
    })
    window.getSelection()?.removeAllRanges()
    dismissSelection()
    setMarginPanelOpen(true)
  }

  function handleHighlightClick(marginId: string) {
    setMarginPanelOpen(true)
    setTimeout(() => {
      const el = document.querySelector(`[data-margin-id="${marginId}"] textarea`)
      if (el instanceof HTMLElement) el.focus()
    }, 350)
  }

  // ─── Derived data ──────────────────────────────────────────────────────────

  const highlightMargins: MarginHighlight[] = margins.map((m) => ({
    id: m.id,
    anchor_start: m.anchor_start,
    anchor_end: m.anchor_end,
    note: m.note,
  }))

  const annotationBubblePosition =
    selectionInfo
      ? { x: selectionInfo.popupPosition.x, y: selectionInfo.selectionRect.bottom }
      : null

  return (
    <section
      id="reading-view"
      data-page="reading-view"
      className="flex min-h-[100dvh] flex-col overflow-hidden bg-bg"
    >
      <ReadingTopbar
        writingId={writing.id}
        backUrl={backUrl}
        prevWritingId={prevWritingId}
        nextWritingId={nextWritingId}
        sequencePosition={sequencePosition}
        sequenceTotal={sequenceTotal}
        canRespond={canRespond}
        marginPanelOpen={marginPanelOpen}
        onToggleMarginPanel={() => setMarginPanelOpen((v) => !v)}
        isAuthenticated={isAuthenticated}
        mode={chromeMode}
        publicHeader={publicHeader}
        respondHref={respondHref}
      />

      <div
        id="reading-body-shell"
        data-section="reading-body-shell"
        data-testid="reading-body-shell"
        className="ReadingBodyShell relative flex flex-1 overflow-hidden"
      >
        {/* Reading content + highlight overlay */}
        <div className="relative flex-1 overflow-hidden">
          <ReadingContent
            title={writing.title}
            bodyJson={writing.bodyJson}
            bodyText={writing.bodyText}
            author={author}
            updatedAt={writing.updatedAt}
            bodyRef={bodyRef}
          />

          {isAuthenticated && (
            <HighlightLayer
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
            writingId={writing.id}
            onUpdateNote={handleUpdateNote}
            onDelete={handleDelete}
            onShare={handleShare}
            alreadyShared={alreadyShared}
          />
        )}
      </div>

      {/* Selection popup */}
      {isAuthenticated && !annotationMode && (
        <SelectionPopup
          position={selectionInfo?.popupPosition ?? null}
          onMark={handleMark}
          onAnnotate={handleAnnotateOpen}
          onDismiss={dismissSelection}
        />
      )}

      {/* Annotation bubble */}
      {isAuthenticated && annotationMode && (
        <AnnotationBubble
          position={annotationBubblePosition}
          onConfirm={handleAnnotateConfirm}
          onCancel={dismissSelection}
        />
      )}
    </section>
  )
}
