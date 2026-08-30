"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, LoaderCircle, Mic, Pause, Play, Square, Trash2 } from "lucide-react"
import { buildAiAnnotationCopy } from "@/lib/editor/footnote-extension"
import type { AnnotationType } from "@/lib/editor/footnote-node"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { transcribeVoiceNote } from "@/lib/services/transcription/transcribe-voice-note"
import { ANNOTATION_TYPE_COLOR } from "@/lib/editor/annotation-palette"

type PanelEntryType = AnnotationType | "highlight"

const TYPE_COLOR: Record<PanelEntryType, string> = {
  ...ANNOTATION_TYPE_COLOR,
}

const TYPE_LABEL: Record<PanelEntryType, string> = {
  footnote: "Footnote",
  personal: "Personal",
  ai: "AI",
  highlight: "Highlight",
}

const ANNOTATION_TYPE_OPTIONS: { type: AnnotationType; label: string; color: string }[] = [
  { type: "ai", label: "AI", color: ANNOTATION_TYPE_COLOR.ai },
  { type: "highlight", label: "Highlight", color: ANNOTATION_TYPE_COLOR.highlight },
  { type: "personal", label: "Personal", color: ANNOTATION_TYPE_COLOR.personal },
  { type: "footnote", label: "Footnote", color: ANNOTATION_TYPE_COLOR.footnote },
]

export type AnnotationPanelEntry = {
  id?: string
  standalone?: boolean
  type: PanelEntryType
  index: number
  text: string
  anchor_text?: string
  anchor_start?: number
  anchor_end?: number
  source_start?: number
  source_end?: number
}

type NotesPanelProps = {
  annotations: AnnotationPanelEntry[]
  currentMarkdown: string
  onUpdateAnnotation: (annotation: AnnotationPanelEntry, text: string) => boolean
  onUpdateAnnotationType?: (annotation: AnnotationPanelEntry, newType: AnnotationType) => boolean
  onDeleteAnnotation: (annotation: AnnotationPanelEntry) => boolean
  onDeleteHighlight: (anchorText: string, anchorStart?: number, anchorEnd?: number, id?: string) => boolean
  onUpdateHighlight?: (anchorText: string, text: string, anchorStart?: number, anchorEnd?: number, id?: string) => boolean
  onConvertHighlight?: (anchorText: string, type: AnnotationType, text: string, anchorStart?: number, anchorEnd?: number, id?: string) => boolean
  onNavigate: (annotation: AnnotationPanelEntry) => boolean
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

function isStandaloneHighlight(entry: AnnotationPanelEntry): boolean {
  return entry.type === "highlight" && entry.standalone === true
}

const panelEntryKey = (entry: AnnotationPanelEntry) =>
  entry.id ? `annotation:${entry.id}` : `${entry.type}:${entry.index}`

function VoiceRecorderInline({
  onTranscript,
  onCancel,
}: {
  onTranscript: (text: string) => void
  onCancel: () => void
}) {
  const {
    state,
    start,
    stop,
    pause,
    resume,
    reset,
    blob,
    waveformData,
    duration,
    permissionDenied,
    isSupported,
    errorMessage,
  } =
    useVoiceRecorder()
  const [voicePhase, setVoicePhase] = useState<"capturing" | "transcribing" | "error">("capturing")
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const submittedBlobRef = useRef<Blob | null>(null)
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  const discard = useCallback(() => {
    requestRef.current?.controller.abort()
    requestRef.current = null
    reset()
    onCancel()
  }, [onCancel, reset])

  const submitRecording = useCallback((recordedBlob: Blob) => {
    requestRef.current?.controller.abort()

    const request = {
      id: (requestRef.current?.id ?? 0) + 1,
      controller: new AbortController(),
    }
    requestRef.current = request
    submittedBlobRef.current = recordedBlob
    setVoicePhase("transcribing")
    setVoiceError(null)

    void transcribeVoiceNote(recordedBlob, { signal: request.controller.signal })
      .then((transcript) => {
        if (requestRef.current?.id === request.id) {
          onTranscriptRef.current(transcript)
        }
      })
      .catch((error: unknown) => {
        if (request.controller.signal.aborted || requestRef.current?.id !== request.id) return
        setVoiceError(error instanceof Error ? error.message : "Transcription failed. Try again.")
        setVoicePhase("error")
      })
  }, [])

  useEffect(() => {
    void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (errorMessage) {
      setVoiceError(errorMessage)
      setVoicePhase("error")
    }
  }, [errorMessage])

  useEffect(() => {
    if (state !== "stopped") return

    if (blob && blob !== submittedBlobRef.current) {
      submitRecording(blob)
    } else if (!blob) {
      setVoiceError("The recording could not be finalized. Try again.")
      setVoicePhase("error")
    }
  }, [blob, state, submitRecording])

  useEffect(() => {
    if (voicePhase !== "transcribing" || state === "stopped") return

    const timeoutId = window.setTimeout(() => {
      if (!blob) {
        setVoiceError("The recording could not be finalized. Try again.")
        setVoicePhase("error")
      }
    }, 2_000)

    return () => window.clearTimeout(timeoutId)
  }, [blob, state, voicePhase])

  useEffect(() => () => requestRef.current?.controller.abort(), [])

  const retry = () => {
    if (blob) {
      submitRecording(blob)
      return
    }

    reset()
    submittedBlobRef.current = null
    setVoiceError(null)
    setVoicePhase("capturing")
    void start()
  }

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <span>Microphone not supported</span>
        <button type="button" onClick={discard} className="ml-auto text-ink-4 hover:text-ink">Discard</button>
      </div>
    )
  }

  if (permissionDenied) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <span>Microphone permission denied</span>
        <button type="button" onClick={discard} className="ml-auto text-ink-4 hover:text-ink">Discard</button>
      </div>
    )
  }

  if (voicePhase === "error") {
    return (
      <div className="flex min-w-0 flex-col gap-2" data-testid="voice-recorder-error">
        <p className="break-words font-sans text-[11px] leading-relaxed text-destructive">
          {voiceError ?? "Recording failed. Try again."}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={retry}
            className="rounded-[6px] bg-ink px-2 py-1 font-sans text-[11px] text-bg transition-opacity hover:opacity-90"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={discard}
            className="rounded-[6px] bg-muted px-2 py-1 font-sans text-[11px] text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink"
          >
            Discard
          </button>
        </div>
      </div>
    )
  }

  if (voicePhase === "transcribing") {
    return (
      <div
        className="flex min-w-0 items-center gap-2 font-sans text-[11px] text-ink-3"
        data-testid="voice-recorder-transcribing"
      >
        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.5} />
        <span className="min-w-0 flex-1">Transcribing recording…</span>
        <button type="button" onClick={discard} className="shrink-0 text-ink-4 hover:text-ink">
          Discard
        </button>
      </div>
    )
  }

  if (state === "idle" || state === "requesting") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-4">
        <Mic className="h-3 w-3 animate-pulse" strokeWidth={1.5} />
        <span>{state === "requesting" ? "Requesting microphone…" : "Starting…"}</span>
        <button type="button" onClick={discard} className="ml-auto text-ink-4 hover:text-ink">Discard</button>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="voice-recorder-recording">
      <div className="flex min-w-0 items-end gap-2 overflow-hidden">
        <div className="flex h-6 min-w-0 flex-1 items-end gap-px overflow-hidden">
          {waveformData.map((v, i) => (
            <div
              key={i}
              className="w-[2px] shrink-0 rounded-full bg-destructive"
              style={{ height: `${Math.max(2, v * 24)}px`, opacity: 0.6 + v * 0.4 }}
            />
          ))}
        </div>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">
          {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={state === "paused" ? resume : pause}
          className="inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-[6px] bg-muted px-2 font-sans text-[11px] text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink"
        >
          {state === "paused" ? (
            <><Play className="h-3 w-3 shrink-0" strokeWidth={1.5} /> Resume</>
          ) : (
            <><Pause className="h-3 w-3 shrink-0" strokeWidth={1.5} /> Pause</>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setVoicePhase("transcribing")
            stop()
          }}
          className="inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-[6px] bg-destructive px-2 font-sans text-[11px] text-white transition-colors hover:bg-destructive/90"
        >
          <Square className="h-2.5 w-2.5 shrink-0 fill-current" strokeWidth={1.5} /> Stop
        </button>
        <button
          type="button"
          onClick={discard}
          className="inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded-[6px] bg-muted px-2 font-sans text-[11px] text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink"
        >
          Discard
        </button>
      </div>
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
  onConvertHighlight,
  onNavigate,
}: NotesPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [activeFilter, setActiveFilter] = useState<PanelEntryType | "all">("all")
  const [recordingKey, setRecordingKey] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [typeDropdownKey, setTypeDropdownKey] = useState<string | null>(null)
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null)

  useEffect(() => {
    if (!typeDropdownKey) return
    const close = () => setTypeDropdownKey(null)
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [typeDropdownKey])

  useEffect(() => {
    setDrafts(
      annotations.reduce<Record<string, string>>((acc, a) => {
        acc[panelEntryKey(a)] = a.text
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
      className="EditorPanelNotes od-scroll h-full w-full overflow-y-auto overflow-x-hidden bg-transparent"
    >
      {/* No header of its own: the tab strip above carries the name and the
          close button for all four surfaces (owner review). */}
      <div className="flex h-full flex-col">
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
              <p className="text-[12px] text-ink-3">No notes yet.</p>
              <p className="text-[11px] text-ink-4">Select text in the artifact to add one.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {orderedWithDisplay.map((annotation) => {
                const key = panelEntryKey(annotation)
                const color = TYPE_COLOR[annotation.type]
                const label = TYPE_LABEL[annotation.type]
                const { displayIndex } = annotation
                const draft = drafts[key] ?? ""
                const isStandalone = isStandaloneHighlight(annotation)
                const isRecording = recordingKey === key

                const handleBlur = () => {
                  const next = drafts[key] ?? ""
                  if (next === annotation.text) return
                  let didUpdate = false
                  if (isStandalone && onUpdateHighlight) {
                    didUpdate = onUpdateHighlight(
                      annotation.anchor_text ?? "",
                      next,
                      annotation.anchor_start,
                      annotation.anchor_end,
                      annotation.id,
                    )
                  } else {
                    didUpdate = onUpdateAnnotation(annotation, next)
                  }
                  setActionErrorKey(didUpdate ? null : key)
                }

                const handleTranscript = (transcript: string) => {
                  setDrafts((prev) => ({ ...prev, [key]: transcript }))
                  setRecordingKey(null)
                  if (isStandalone && onUpdateHighlight) {
                    const didUpdate = onUpdateHighlight(
                      annotation.anchor_text ?? "",
                      transcript,
                      annotation.anchor_start,
                      annotation.anchor_end,
                      annotation.id,
                    )
                    setActionErrorKey(didUpdate ? null : key)
                  } else {
                    const didUpdate = onUpdateAnnotation(annotation, transcript)
                    setActionErrorKey(didUpdate ? null : key)
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
                                if (isExpanded) {
                                  next.delete(key)
                                } else {
                                  next.add(key)
                                }
                                return next
                              })
                            }
                            className="mt-0.5 font-sans text-[11px] text-ink-4 hover:text-ink transition-colors"
                          >
                            {isExpanded ? "Show less" : "Show more"}
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
                                  if (isStandalone && onConvertHighlight) {
                                    const didUpdate = onConvertHighlight(
                                      annotation.anchor_text ?? "",
                                      opt.type,
                                      draft,
                                      annotation.anchor_start,
                                      annotation.anchor_end,
                                      annotation.id,
                                    )
                                    setActionErrorKey(didUpdate ? null : key)
                                  } else if (onUpdateAnnotationType) {
                                    const didUpdate = onUpdateAnnotationType(annotation, opt.type)
                                    setActionErrorKey(didUpdate ? null : key)
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
                          onClick={() => {
                            const didNavigate = onNavigate(annotation)
                            setActionErrorKey(didNavigate ? null : key)
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded-[5px] text-ink-4 opacity-0 transition-opacity hover:bg-muted hover:text-ink group-hover:opacity-100"
                          aria-label="Go to annotation in artifact"
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
                          onClick={() => {
                            if (isStandalone) {
                              const didDelete = onDeleteHighlight(
                                annotation.anchor_text ?? "",
                                annotation.anchor_start,
                                annotation.anchor_end,
                                annotation.id,
                              )
                              setActionErrorKey(didDelete ? null : key)
                              return
                            }

                            const didDelete = onDeleteAnnotation(annotation)
                            setActionErrorKey(didDelete ? null : key)
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded-[5px] text-ink-4 opacity-0 transition-opacity hover:bg-muted hover:text-ink group-hover:opacity-100"
                          aria-label={`Delete ${label}`}
                        >
                          <Trash2 className="h-[11px] w-[11px]" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                    {actionErrorKey === key ? (
                      <p role="status" className="mt-1.5 font-sans text-[11px] text-destructive">
                        The annotated text could not be found.
                      </p>
                    ) : null}
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
