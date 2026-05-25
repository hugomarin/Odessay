"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Mic, Trash2, X } from "lucide-react"
import { buildAiAnnotationCopy } from "@/lib/editor/footnote-extension"
import type { AnnotationType } from "@/lib/editor/footnote-node"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"

type PanelEntryType = AnnotationType | "highlight"

const TYPE_COLOR: Record<PanelEntryType, string> = {
  footnote: "#999990",
  personal: "#999990",
  ai: "#5B5BD6",
  highlight: "#E8A020",
}

const TYPE_LABEL: Record<PanelEntryType, string> = {
  footnote: "Footnote",
  personal: "Highlight",
  ai: "AI",
  highlight: "Highlight",
}

const ANNOTATION_TYPE_OPTIONS: { type: AnnotationType; label: string; color: string }[] = [
  { type: "ai", label: "AI", color: "#5B5BD6" },
  { type: "highlight", label: "Highlight", color: "#E8A020" },
  { type: "personal", label: "Personal", color: "#999990" },
  { type: "footnote", label: "Footnote", color: "#999990" },
]

type PanelEntry = {
  id?: string
  type: PanelEntryType
  index: number
  text: string
  anchor_text?: string
  anchor_start?: number
  anchor_end?: number
}

type NotesPanelProps = {
  annotations: PanelEntry[]
  currentMarkdown: string
  onUpdateAnnotation: (type: AnnotationType, index: number, text: string) => void
  onUpdateAnnotationType?: (type: AnnotationType, index: number, newType: AnnotationType) => void
  onDeleteAnnotation: (type: AnnotationType, index: number) => void
  onDeleteHighlight: (anchorText: string, anchorStart?: number, anchorEnd?: number) => void
  onUpdateHighlight?: (anchorText: string, text: string, anchorStart?: number, anchorEnd?: number) => void
  onConvertHighlightToAi?: (anchorText: string, text: string, anchorStart?: number, anchorEnd?: number) => void
  onNavigate: (type: AnnotationType, index: number, pos?: number) => void
  onClose: () => void
}

function AutoTextarea({
  value,
  onChange,
  onBlur,
  onClick,
  placeholder,
  className,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onBlur: () => void
  onClick: (e: React.MouseEvent<HTMLTextAreaElement>) => void
  placeholder: string
  className: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      onChange={onChange}
      onBlur={onBlur}
      onClick={onClick}
      placeholder={placeholder}
      className={className}
      style={{ overflow: "hidden" }}
    />
  )
}

function isStandaloneHighlight(entry: PanelEntry): boolean {
  return entry.type === "highlight" && (entry.id?.startsWith("highlight:") ?? false)
}

function VoiceRecorderInline({
  onTranscript,
  onCancel,
}: {
  onTranscript: (text: string) => void
  onCancel: () => void
}) {
  const { state, start, stop, reset, blob, waveformData, duration, permissionDenied, isSupported } =
    useVoiceRecorder()
  const [isSubmittingVoice, setIsSubmittingVoice] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const prevBlobRef = useRef<Blob | null>(null)

  useEffect(() => {
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (blob && blob !== prevBlobRef.current && !isSubmittingVoice) {
      prevBlobRef.current = blob
      setIsSubmittingVoice(true)
      setVoiceError(null)

      const formData = new FormData()
      formData.set("audio", blob, "voice-note.webm")

      fetch("/api/margins/transcribe", { method: "POST", body: formData })
        .then((res) => res.json())
        .then((payload: { data: { transcript?: string } | null; error: { message?: string } | null }) => {
          if (payload.error) throw new Error(payload.error.message ?? "Transcription failed.")
          const transcript = payload.data?.transcript?.trim() ?? ""
          if (!transcript) throw new Error("No transcript was returned for this recording.")
          onTranscript(transcript)
        })
        .catch((err: unknown) => {
          setVoiceError(err instanceof Error ? err.message : "Transcription failed.")
        })
        .finally(() => {
          setIsSubmittingVoice(false)
        })
    }
  }, [blob, isSubmittingVoice, onTranscript])

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <span>Microphone not supported</span>
        <button onClick={onCancel} className="text-ink-4 hover:text-ink">Cancel</button>
      </div>
    )
  }

  if (permissionDenied) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <span>Microphone permission denied</span>
        <button onClick={onCancel} className="text-ink-4 hover:text-ink">Cancel</button>
      </div>
    )
  }

  if (state === "idle" || state === "requesting") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-4">
        <Mic className="h-3 w-3 animate-pulse" strokeWidth={1.5} />
        <span>{state === "requesting" ? "Solicitando micrófono…" : "Iniciando…"}</span>
        <button onClick={onCancel} className="ml-auto text-ink-4 hover:text-ink">Cancelar</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="flex h-6 flex-1 items-end gap-px">
          {waveformData.map((v, i) => (
            <div
              key={i}
              className="w-1 rounded-full bg-destructive"
              style={{ height: `${Math.max(2, v * 24)}px`, opacity: 0.6 + v * 0.4 }}
            />
          ))}
        </div>
        <span className="font-mono text-[11px] text-ink-3 tabular-nums">
          {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={stop}
          className="rounded-[6px] bg-destructive px-2 py-1 font-sans text-[11px] text-white transition-colors hover:bg-destructive/90"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={() => {
            reset()
            onCancel()
          }}
          className="rounded-[6px] bg-muted px-2 py-1 font-sans text-[11px] text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink"
        >
          Cancel
        </button>
      </div>
      {voiceError && <p className="text-[11px] text-destructive">{voiceError}</p>}
      {isSubmittingVoice && <p className="text-[11px] text-ink-4">Transcribing…</p>}
    </div>
  )
}

export function NotesPanel({
  annotations,
  currentMarkdown,
  onUpdateAnnotation,
  onUpdateAnnotationType,
  onDeleteAnnotation,
  onDeleteHighlight,
  onUpdateHighlight,
  onConvertHighlightToAi,
  onNavigate,
  onClose,
}: NotesPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [activeFilter, setActiveFilter] = useState<PanelEntryType | "all">("all")
  const [recordingKey, setRecordingKey] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [typeDropdownKey, setTypeDropdownKey] = useState<string | null>(null)

  useEffect(() => {
    if (!typeDropdownKey) return
    const close = () => setTypeDropdownKey(null)
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [typeDropdownKey])

  useEffect(() => {
    setDrafts(
      annotations.reduce<Record<string, string>>((acc, a) => {
        acc[`${a.type}:${a.index}`] = a.text
        return acc
      }, {}),
    )
  }, [annotations])

  const presentTypes = useMemo(() => new Set(annotations.map((a) => a.type)), [annotations])
  const ordered = useMemo(() => {
    const base = annotations.slice().sort((a, b) => a.type.localeCompare(b.type) || a.index - b.index)
    return activeFilter === "all" ? base : base.filter((a) => a.type === activeFilter)
  }, [annotations, activeFilter])
  const orderedWithDisplay = useMemo(() => {
    const counters = new Map<string, number>()
    return ordered.map((annotation) => {
      const n = (counters.get(annotation.type) ?? 0) + 1
      counters.set(annotation.type, n)
      return { ...annotation, displayIndex: n }
    })
  }, [ordered])
  const aiAnnotations = useMemo(() => annotations.filter((a) => a.type === "ai"), [annotations])

  const filterTabs: { id: PanelEntryType | "all"; label: string }[] = [
    { id: "all", label: "All" },
    ...(presentTypes.has("ai") ? [{ id: "ai" as const, label: "AI" }] : []),
    ...(presentTypes.has("personal") ? [{ id: "personal" as const, label: "Personal" }] : []),
    ...(presentTypes.has("footnote") ? [{ id: "footnote" as const, label: "Footnote" }] : []),
    ...(presentTypes.has("highlight") ? [{ id: "highlight" as const, label: "Highlight" }] : []),
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
              {orderedWithDisplay.map((annotation) => {
                const key = `${annotation.type}:${annotation.index}`
                const color = TYPE_COLOR[annotation.type]
                const label = TYPE_LABEL[annotation.type]
                const { displayIndex } = annotation
                const draft = drafts[key] ?? ""
                const isStandalone = isStandaloneHighlight(annotation)
                const isHighlight = annotation.type === "highlight"
                const isRecording = recordingKey === key

                const handleBlur = () => {
                  const next = drafts[key] ?? ""
                  if (next === annotation.text) return
                  if (isStandalone && onUpdateHighlight) {
                    onUpdateHighlight(annotation.anchor_text ?? "", next, annotation.anchor_start, annotation.anchor_end)
                  } else if (isHighlight) {
                    onUpdateAnnotation("highlight", annotation.index, next)
                  } else {
                    onUpdateAnnotation(annotation.type as AnnotationType, annotation.index, next)
                  }
                }

                const handleTranscript = (transcript: string) => {
                  setDrafts((prev) => ({ ...prev, [key]: transcript }))
                  setRecordingKey(null)
                  if (isStandalone && onUpdateHighlight) {
                    onUpdateHighlight(annotation.anchor_text ?? "", transcript, annotation.anchor_start, annotation.anchor_end)
                  } else if (isHighlight) {
                    onUpdateAnnotation("highlight", annotation.index, transcript)
                  } else {
                    onUpdateAnnotation(annotation.type as AnnotationType, annotation.index, transcript)
                  }
                }

                const handleConvertToAi = () => {
                  if (isStandalone && onConvertHighlightToAi) {
                    onConvertHighlightToAi(annotation.anchor_text ?? "", draft, annotation.anchor_start, annotation.anchor_end)
                  } else if (isHighlight && onUpdateAnnotationType) {
                    onUpdateAnnotationType("highlight", annotation.index, "ai")
                  }
                }

                const isExpanded = expandedKeys.has(key)
                const THREE_LINES_PX = 54 // 13px × 1.375 leading × 3
                const needsToggle = draft.length > 100 || draft.split("\n").length > 3

                return (
                  <article
                    key={key}
                    className="group rounded-[8px] border-[0.5px] border-border bg-bg px-3 py-2.5 transition-colors hover:bg-muted"
                  >
                    {annotation.anchor_text && (
                      <p className="mb-1.5 font-lora italic text-[11px] text-ink-4 leading-relaxed line-clamp-2">
                        &ldquo;{annotation.anchor_text}&rdquo;
                      </p>
                    )}

                    {isRecording ? (
                      <VoiceRecorderInline
                        onTranscript={handleTranscript}
                        onCancel={() => setRecordingKey(null)}
                      />
                    ) : (
                      <div>
                        <div
                          style={!isExpanded && needsToggle ? { maxHeight: THREE_LINES_PX, overflow: "hidden" } : undefined}
                        >
                          <AutoTextarea
                            value={draft}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (!isExpanded && needsToggle) {
                                setExpandedKeys((prev) => new Set(prev).add(key))
                              }
                            }}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                            onBlur={handleBlur}
                            placeholder={
                              annotation.type === "ai"
                                ? "AI instruction…"
                                : annotation.type === "highlight"
                                  ? "Add a note…"
                                  : "Note text…"
                            }
                            className="w-full resize-none bg-transparent font-sans text-[13px] text-ink-2 placeholder:text-ink-4 outline-none leading-snug"
                          />
                        </div>
                        {needsToggle && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedKeys((prev) => {
                                const next = new Set(prev)
                                isExpanded ? next.delete(key) : next.add(key)
                                return next
                              })
                            }
                            className="mt-0.5 font-sans text-[11px] text-ink-4 hover:text-ink transition-colors"
                          >
                            {isExpanded ? "ver menos" : "ver más"}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-1.5">
                      {/* Type badge — dropdown to change type */}
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setTypeDropdownKey(typeDropdownKey === key ? null : key)}
                          className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-[0.07em] transition-opacity hover:opacity-70"
                          style={{ color, backgroundColor: `${color}14` }}
                        >
                          {label} · {displayIndex}
                          <ChevronDown className="h-2.5 w-2.5" strokeWidth={2} />
                        </button>
                        {typeDropdownKey === key && (
                          <div className="absolute bottom-full left-0 mb-1 z-50 min-w-[110px] rounded-[6px] border-[0.5px] border-border bg-bg shadow-md overflow-hidden">
                            {ANNOTATION_TYPE_OPTIONS.filter((opt) => opt.type !== annotation.type).map((opt) => (
                              <button
                                key={opt.type}
                                type="button"
                                onClick={() => {
                                  if (isStandalone && onConvertHighlightToAi && opt.type === "ai") {
                                    onConvertHighlightToAi(annotation.anchor_text ?? "", draft, annotation.anchor_start, annotation.anchor_end)
                                  } else if (onUpdateAnnotationType) {
                                    onUpdateAnnotationType(annotation.type as AnnotationType, annotation.index, opt.type)
                                  }
                                  setTypeDropdownKey(null)
                                }}
                                className="flex w-full items-center px-2.5 py-1.5 text-left hover:bg-muted"
                              >
                                <span
                                  className="font-sans text-[10px] font-medium uppercase tracking-[0.07em]"
                                  style={{ color: opt.color }}
                                >
                                  {opt.label}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {/* Navigate to annotation in document */}
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate(
                              annotation.type as AnnotationType,
                              annotation.index,
                              isStandalone ? annotation.anchor_start : undefined,
                            )
                          }
                          className="flex h-5 w-5 items-center justify-center rounded-[5px] text-ink-4 opacity-0 transition-opacity hover:bg-muted hover:text-ink group-hover:opacity-100"
                          aria-label="Go to annotation in document"
                          title="Ir al texto"
                        >
                          <span className="text-[11px] leading-none">↗</span>
                        </button>
                        {!isRecording && (
                          <button
                            type="button"
                            onClick={() => setRecordingKey(key)}
                            className="flex h-5 w-5 items-center justify-center rounded-[5px] text-ink-4 opacity-0 transition-opacity hover:bg-muted hover:text-ink group-hover:opacity-100"
                            aria-label="Record audio note"
                            title="Record audio note"
                          >
                            <Mic className="h-[11px] w-[11px]" strokeWidth={1.5} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            isHighlight
                              ? onDeleteHighlight(annotation.anchor_text ?? "", annotation.anchor_start, annotation.anchor_end)
                              : onDeleteAnnotation(annotation.type as AnnotationType, annotation.index)
                          }
                          className="flex h-5 w-5 items-center justify-center rounded-[5px] text-ink-4 opacity-0 transition-opacity hover:bg-muted hover:text-ink group-hover:opacity-100"
                          aria-label={`Delete ${label}`}
                        >
                          <Trash2 className="h-[11px] w-[11px]" strokeWidth={1.5} />
                        </button>
                      </div>
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
