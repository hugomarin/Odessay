"use client"

import { useEffect, useMemo, useState } from "react"
import { Trash2, X } from "lucide-react"
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
  collaborative: "Collab",
}

type NotesPanelProps = {
  annotations: MarkdownAnnotation[]
  currentMarkdown: string
  onUpdateAnnotation: (type: AnnotationType, index: number, text: string) => void
  onDeleteAnnotation: (type: AnnotationType, index: number) => void
  onNavigate: (type: AnnotationType, index: number) => void
  onClose: () => void
}

export function NotesPanel({
  annotations,
  currentMarkdown,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onNavigate,
  onClose,
}: NotesPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [activeFilter, setActiveFilter] = useState<AnnotationType | "all">("all")

  useEffect(() => {
    setDrafts(
      annotations.reduce<Record<string, string>>((acc, a) => {
        acc[`${a.type}:${a.index}`] = a.text
        return acc
      }, {}),
    )
  }, [annotations])

  const presentTypes = useMemo(
    () => new Set(annotations.map((a) => a.type)),
    [annotations],
  )
  const ordered = useMemo(() => {
    const base = annotations.slice().sort((a, b) => a.type.localeCompare(b.type) || a.index - b.index)
    return activeFilter === "all" ? base : base.filter((a) => a.type === activeFilter)
  }, [annotations, activeFilter])
  const aiAnnotations = useMemo(() => annotations.filter((a) => a.type === "ai"), [annotations])

  const filterTabs: { id: AnnotationType | "all"; label: string }[] = [
    { id: "all", label: "All" },
    ...(presentTypes.has("ai") ? [{ id: "ai" as const, label: "AI" }] : []),
    ...(presentTypes.has("personal") ? [{ id: "personal" as const, label: "Personal" }] : []),
    ...(presentTypes.has("collaborative") ? [{ id: "collaborative" as const, label: "Collab" }] : []),
    ...(presentTypes.has("footnote") ? [{ id: "footnote" as const, label: "Footnote" }] : []),
  ]

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
        {/* Filter tabs */}
        {filterTabs.length > 2 && (
          <div className="flex flex-wrap gap-1 border-b-[0.5px] border-border px-3 py-2">
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                className={`rounded-[6px] px-2.5 py-1 font-sans text-[11px] transition-colors ${
                  activeFilter === tab.id
                    ? "bg-ink text-bg"
                    : "bg-muted text-ink-3 hover:bg-muted-hover"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Annotation list */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {ordered.length === 0 ? (
            <div className="px-1 py-6 flex flex-col gap-1">
              <p className="text-[12px] text-ink-3">No hay notas.</p>
              <p className="text-[11px] text-ink-4">Selecciona texto en el documento para agregar una.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {ordered.map((annotation) => {
                const key = `${annotation.type}:${annotation.index}`
                const color = TYPE_COLOR[annotation.type]
                const label = TYPE_LABEL[annotation.type]
                const draft = drafts[key] ?? ""
                const lineCount = Math.max(1, draft.split("\n").length)
                return (
                  <article
                    key={key}
                    className="group rounded-[8px] border-[0.5px] border-border bg-bg px-3 py-2.5 transition-colors hover:bg-muted"
                  >
                    <textarea
                      value={draft}
                      rows={lineCount}
                      onClick={(e) => e.stopPropagation()}
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
                      className="w-full resize-none bg-transparent font-sans text-[13px] text-ink-2 placeholder:text-ink-4 outline-none leading-snug"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <button
                        type="button"
                        onClick={() => onNavigate(annotation.type, annotation.index)}
                        className="rounded-[4px] px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-[0.07em] transition-opacity hover:opacity-70"
                        style={{ color, backgroundColor: `${color}14` }}
                        aria-label={`Go to ${label} ${annotation.index} in document`}
                      >
                        {label} · {annotation.index}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteAnnotation(annotation.type, annotation.index)}
                        className="flex h-5 w-5 items-center justify-center rounded-[5px] text-ink-4 opacity-0 transition-opacity hover:bg-muted hover:text-ink group-hover:opacity-100"
                        aria-label={`Delete ${label} ${annotation.index}`}
                      >
                        <Trash2 className="h-[11px] w-[11px]" strokeWidth={1.5} />
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>

        {/* Copiar para AI */}
        {aiAnnotations.length > 0 && (
          <div className="shrink-0 border-t-[0.5px] border-border px-4 py-3">
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
        )}
      </div>
    </aside>
  )
}
