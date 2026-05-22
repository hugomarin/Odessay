"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, Trash2, X } from "lucide-react"
import type { MarkdownAnnotation } from "@/lib/editor/footnote-extension"
import { buildAiAnnotationCopy } from "@/lib/editor/footnote-extension"
import type { AnnotationType } from "@/lib/editor/footnote-node"

const TYPE_COLOR: Record<AnnotationType, string> = {
  footnote: "#999990",
  personal: "#999990",
  ai: "#5B5BD6",
  collaborative: "#C07B2A",
}

const TYPE_LABEL: Record<AnnotationType, string> = {
  footnote: "Footnote",
  personal: "Personal",
  ai: "AI",
  collaborative: "Collaborative",
}

type NotesPanelProps = {
  annotations: MarkdownAnnotation[]
  currentMarkdown: string
  onAddFootnote: (text: string) => void
  onUpdateAnnotation: (type: AnnotationType, index: number, text: string) => void
  onDeleteAnnotation: (type: AnnotationType, index: number) => void
  onClose: () => void
}

export function NotesPanel({
  annotations,
  currentMarkdown,
  onAddFootnote,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onClose,
}: NotesPanelProps) {
  const [nextNote, setNextNote] = useState("")
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    setDrafts(
      annotations.reduce<Record<string, string>>((acc, a) => {
        acc[`${a.type}:${a.index}`] = a.text
        return acc
      }, {}),
    )
  }, [annotations])

  const disabledAdd = nextNote.trim().length === 0
  const ordered = useMemo(
    () => annotations.slice().sort((a, b) => a.type.localeCompare(b.type) || a.index - b.index),
    [annotations],
  )
  const aiAnnotations = useMemo(() => annotations.filter((a) => a.type === "ai"), [annotations])

  async function copyAnnotations() {
    const copy = buildAiAnnotationCopy(currentMarkdown)
    await navigator.clipboard.writeText(copy.annotationsOnly).catch(() => null)
  }

  async function copyFullText() {
    const copy = buildAiAnnotationCopy(currentMarkdown)
    await navigator.clipboard.writeText(copy.fullText).catch(() => null)
  }

  return (
    <aside
      id="editor-panel-notes"
      data-section="editor-panel-notes"
      data-testid="editor-panel-notes"
      className="EditorPanelNotes fixed right-0 top-[56px] bottom-8 z-40 w-[312px] min-w-[312px] max-w-[312px] overflow-y-auto border-l-[0.5px] border-border bg-sb"
    >
      <div className="flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Notes</p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
          aria-label="Close notes panel"
        >
          <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex h-[calc(100%-46px)] flex-col">
        {/* Add footnote */}
        <div className="space-y-3 border-b-[0.5px] border-border p-4">
          <p className="text-[12px] text-ink-3">Add a footnote from this panel.</p>
          <textarea
            value={nextNote}
            onChange={(e) => setNextNote(e.target.value)}
            placeholder="Write the note text..."
            className="min-h-20 w-full resize-y rounded-md border-[0.5px] border-border bg-bg px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-ink"
          />
          <button
            type="button"
            onClick={() => {
              if (disabledAdd) return
              onAddFootnote(nextNote)
              setNextNote("")
            }}
            disabled={disabledAdd}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border-[0.5px] border-border bg-bg px-3 text-[12px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-[13px] w-[13px]" strokeWidth={1.5} />
            Add note
          </button>
        </div>

        {/* Annotation list */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {ordered.length === 0 ? (
            <p className="text-[12px] text-ink-4">No notes yet.</p>
          ) : (
            ordered.map((annotation) => {
              const key = `${annotation.type}:${annotation.index}`
              const color = TYPE_COLOR[annotation.type]
              const label = TYPE_LABEL[annotation.type]
              return (
                <article
                  key={key}
                  className="space-y-2 rounded-md border-[0.5px] border-border bg-bg p-3"
                  style={{ borderLeftColor: color, borderLeftWidth: 2 }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-[4px] px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-[0.07em]"
                        style={{ color, backgroundColor: `${color}14` }}
                      >
                        {label}
                      </span>
                      <span className="font-lora text-[13px] text-ink-3">[{annotation.index}]</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteAnnotation(annotation.type, annotation.index)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
                      aria-label={`Delete ${label} ${annotation.index}`}
                    >
                      <Trash2 className="h-[12px] w-[12px]" strokeWidth={1.5} />
                    </button>
                  </div>
                  <textarea
                    value={drafts[key] ?? ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    onBlur={() => {
                      const next = drafts[key] ?? ""
                      if (next !== annotation.text) {
                        onUpdateAnnotation(annotation.type, annotation.index, next)
                      }
                    }}
                    placeholder={
                      annotation.type === "ai"
                        ? "AI instruction…"
                        : annotation.type === "collaborative"
                          ? "Collaborative note…"
                          : "Note text…"
                    }
                    className="min-h-16 w-full resize-y rounded-md border-[0.5px] border-border bg-sb px-2.5 py-2 text-[13px] text-ink outline-none focus:border-ink"
                  />
                </article>
              )
            })
          )}
        </div>

        {/* Copiar para AI */}
        {aiAnnotations.length > 0 && (
          <div className="shrink-0 border-t-[0.5px] border-border p-4">
            <div className="rounded-[10px] border-[0.5px] border-border bg-bg p-3">
              <p className="font-sans text-[11px] uppercase tracking-[0.07em] text-ink-4">
                Copiar para AI
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={copyAnnotations}
                  className="rounded-[8px] bg-muted px-3 py-1.5 font-sans text-[12px] text-ink-2"
                >
                  Anotaciones
                </button>
                <button
                  onClick={copyFullText}
                  className="rounded-[8px] bg-ink px-3 py-1.5 font-sans text-[12px] text-bg"
                >
                  Texto completo
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
