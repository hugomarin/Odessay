"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mic } from "lucide-react"
import { VoiceRecorderControls } from "./voice-recorder-controls"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { transcribeVoiceNote } from "@/lib/services/transcription/transcribe-voice-note"
import { getEditorShortcutAction } from "@/lib/editor/shortcuts"
import type { FloatingOverlayAnchor } from "@/lib/reading/floating-overlay-position"
import { useFloatingOverlayPosition } from "./use-floating-overlay-position"

export type AnnotationBubblePosition = FloatingOverlayAnchor & { y: number }

type AnnotationBubbleProps = {
  position: AnnotationBubblePosition | null
  /**
   * Identity of the editing session (ODE-409).
   *
   * The draft belongs to a *session*, not to a geometry. Owners mint a new id
   * when the user opens the bubble over a different selection, and reuse it for
   * the whole life of that draft — scroll, resize and flip all reposition the
   * overlay without touching the id, so the text and the recording survive.
   * Omitting it keeps a single session for as long as the bubble stays open.
   */
  sessionId?: string | null
  type?: "personal" | "ai" | "footnote"
  onConfirm: (note: string) => void | Promise<void>
  onCancel: () => void
}

const AI_QUICK_CHIPS = ["eliminar", "modificar", "expandir", "valida esto", "simplifica", "mantén tono"]

const IMPLICIT_SESSION_KEY = "annotation-bubble:open"

let annotationSessionCounter = 0

/**
 * Mint an identity for a newly opened annotation draft (ODE-409). Owners call
 * this once, when the user asks for a bubble — never while repositioning one.
 */
export function nextAnnotationSessionId(): string {
  annotationSessionCounter += 1
  return `annotation-session-${annotationSessionCounter}`
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

export function AnnotationBubble({
  position,
  sessionId,
  type = "personal",
  onConfirm,
  onCancel,
}: AnnotationBubbleProps) {
  const [note, setNote] = useState("")
  const [isSubmittingVoice, setIsSubmittingVoice] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
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
  } = useVoiceRecorder()
  const supportsVoice = type === "personal" || type === "ai"
  const isVoiceMode = supportsVoice && state !== "idle"
  const floatingPosition = useFloatingOverlayPosition({
    anchor: position,
    overlayRef: containerRef,
    preferredPlacement: "below",
  })

  // ─── Session lifecycle (ODE-409) ───────────────────────────────────────────
  // `position` changes on every scroll, resize and flip. Keying the draft reset
  // on it made "reposition" indistinguishable from "open a new annotation",
  // which is what erased text and restarted recordings. The draft is keyed on
  // session identity instead; geometry is free to change as often as it needs.
  const sessionKey = position ? (sessionId ?? IMPLICIT_SESSION_KEY) : null
  const initializedSessionRef = useRef<string | null>(null)
  const sessionTokenRef = useRef(0)
  const transcriptionAbortRef = useRef<AbortController | null>(null)
  const autoTranscribedBlobRef = useRef<Blob | null>(null)

  useEffect(() => {
    if (sessionKey === initializedSessionRef.current) return
    initializedSessionRef.current = sessionKey

    // Invalidate anything still in flight for the session we are leaving so a
    // late transcript can never land on a different (or closed) draft.
    sessionTokenRef.current += 1
    transcriptionAbortRef.current?.abort()
    transcriptionAbortRef.current = null
    autoTranscribedBlobRef.current = null

    setNote("")
    setVoiceError(null)
    setIsSubmittingVoice(false)
    reset()

    if (sessionKey !== null) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [sessionKey, reset])

  useEffect(() => {
    if (errorMessage) {
      setVoiceError(errorMessage)
    }
  }, [errorMessage])

  const runTranscription = useCallback(
    async (audio: Blob, mode: "apply-to-note" | "confirm") => {
      const token = sessionTokenRef.current
      transcriptionAbortRef.current?.abort()
      const controller = new AbortController()
      transcriptionAbortRef.current = controller

      setVoiceError(null)
      setIsSubmittingVoice(true)

      try {
        const transcript = await transcribeVoiceNote(audio, { signal: controller.signal })
        if (sessionTokenRef.current !== token) return

        if (mode === "confirm") {
          await onConfirm(transcript)
          reset()
          return
        }

        setNote(transcript)
        reset()
        requestAnimationFrame(() => textareaRef.current?.focus())
      } catch (error) {
        // A stale session or an explicit cancel must not surface an error on a
        // draft the user already moved on from.
        if (sessionTokenRef.current !== token || isAbortError(error)) return
        // The recording is deliberately left intact so Retry reuses this blob.
        setVoiceError(error instanceof Error ? error.message : "Transcription failed.")
      } finally {
        if (sessionTokenRef.current === token) {
          setIsSubmittingVoice(false)
        }
        if (transcriptionAbortRef.current === controller) {
          transcriptionAbortRef.current = null
        }
      }
    },
    [onConfirm, reset],
  )

  // For AI type: auto-transcribe when recording stops and load text into the
  // textarea. Each blob is attempted exactly once — a failure waits for Retry
  // instead of looping.
  useEffect(() => {
    if (type !== "ai" || state !== "stopped" || !blob) return
    if (autoTranscribedBlobRef.current === blob) return

    autoTranscribedBlobRef.current = blob
    void runTranscription(blob, "apply-to-note")
  }, [type, state, blob, runTranscription])

  // Dismiss on Escape, confirm on Enter (without shift)
  useEffect(() => {
    if (!position) return

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel()
      }
    }

    document.addEventListener("keydown", handleKeydown)
    return () => document.removeEventListener("keydown", handleKeydown)
  }, [position, onCancel])

  // Toggle voice recording with the global voice-note shortcut (⌘⌥R / Ctrl+Alt+R)
  // when the bubble is open. Capture phase runs before the editor-shell handler.
  useEffect(() => {
    if (!position || !supportsVoice) return

    function handleKeydown(event: KeyboardEvent) {
      const action = getEditorShortcutAction(event)
      if (action !== "voiceNote") return

      event.preventDefault()
      event.stopPropagation()

      if (state === "idle" || state === "stopped") {
        setVoiceError(null)
        void start()
      } else if (state === "recording" || state === "paused") {
        stop()
      }
    }

    window.addEventListener("keydown", handleKeydown, true)
    return () => window.removeEventListener("keydown", handleKeydown, true)
  }, [position, supportsVoice, state, start, stop])

  if (!position) return null

  async function handleConfirm() {
    const trimmed = note.trim()
    if (type !== "personal" && !trimmed) return
    await onConfirm(type === "personal" ? trimmed : trimmed)
  }

  function handleVoiceSubmit() {
    if (!blob) return
    void runTranscription(blob, "confirm")
  }

  // Retry reuses the exact blob that failed — nothing is re-recorded (ODE-409).
  function handleRetryTranscription() {
    if (!blob) return
    void runTranscription(blob, type === "ai" ? "apply-to-note" : "confirm")
  }

  const isMicDisabled = !isSupported || permissionDenied
  const micTooltipMessage = !isSupported
    ? "Voice recording is not supported in this browser."
    : "Microphone permission denied. Enable it in your browser settings."

  const micButton = (
    <button
      type="button"
      onClick={() => {
        setVoiceError(null)
        void start()
      }}
      disabled={isMicDisabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-border text-ink transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      aria-label="Record a voice note"
    >
      <Mic className="h-4 w-4" strokeWidth={1.5} />
    </button>
  )

  const canSubmitText = type === "personal" || note.trim().length > 0

  function handleDiscardVoice() {
    sessionTokenRef.current += 1
    transcriptionAbortRef.current?.abort()
    transcriptionAbortRef.current = null
    autoTranscribedBlobRef.current = null
    setVoiceError(null)
    setIsSubmittingVoice(false)
    reset()
  }

  return (
    <div
      ref={containerRef}
      id="annotation-bubble"
      data-section="annotation-bubble"
      data-testid="annotation-bubble"
      data-placement={floatingPosition?.placement ?? "below"}
      className="AnnotationBubble rounded-[12px] border-[0.5px] border-border bg-sb shadow-float-lg"
      style={{
        position: "fixed",
        left: floatingPosition?.left ?? position.x,
        top: floatingPosition?.top ?? position.y,
        visibility: floatingPosition ? "visible" : "hidden",
        width: "min(260px, calc(100vw - 16px))",
        maxHeight: floatingPosition?.maxHeight,
        overflowY: "auto",
        overscrollBehavior: "contain",
        zIndex: 50,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {isVoiceMode ? (
        <VoiceRecorderControls
          state={state}
          waveformData={waveformData}
          duration={duration}
          isSubmitting={isSubmittingVoice}
          errorMessage={voiceError}
          hideSubmit={type === "ai"}
          onPause={pause}
          onResume={resume}
          onStop={stop}
          onSubmit={handleVoiceSubmit}
          onRetry={blob ? handleRetryTranscription : undefined}
          onDiscard={handleDiscardVoice}
        />
      ) : (
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void handleConfirm()
            }
          }}
          placeholder={type === "footnote" ? "Write your footnote…" : type === "ai" ? "Write your AI instruction…" : "Write your highlight note…"}
          rows={3}
          className="w-full resize-none rounded-[6px] bg-transparent font-sans text-[13px] text-ink-2 placeholder:text-ink-4 focus:outline-none"
          style={{ border: "none" }}
          aria-label="Annotation text"
        />
      )}
      {type === "ai" ? (
        <div className="flex flex-wrap gap-1">
          {AI_QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => setNote((current) => (current ? `${current} ${chip}` : chip))}
              className="rounded-[6px] border-[0.5px] border-border bg-bg px-2 py-1 font-sans text-[11px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
              type="button"
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-[7px] px-3 py-1 font-sans text-[12px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
        >
          Cancel
        </button>
        {supportsVoice && !isVoiceMode ? (
          isMicDisabled ? (
            <TooltipProvider delayDuration={120}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">{micButton}</span>
                </TooltipTrigger>
                <TooltipContent side="top" align="center">
                  {micTooltipMessage}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            micButton
          )
        ) : null}
        <button
          onClick={() => {
            void handleConfirm()
          }}
          disabled={!canSubmitText || isVoiceMode}
          className="rounded-[7px] bg-ink px-3 py-1 font-sans text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {type === "footnote" ? "Add footnote" : "Save"}
        </button>
      </div>
    </div>
  )
}
