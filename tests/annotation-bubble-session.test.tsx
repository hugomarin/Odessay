/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-409 — an open AnnotationBubble is a *session*, not a geometry.
 * Scroll, resize and flip reposition it; none of them may clear the draft,
 * restart a recording, or discard the blob that Retry needs.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AnnotationBubble,
  nextAnnotationSessionId,
  type AnnotationBubblePosition,
} from "@/components/reading/margins/annotation-bubble"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const transcribe = vi.hoisted(() => ({ fn: vi.fn() }))
const recorder = vi.hoisted(() => ({
  resetCalls: 0,
  startCalls: 0,
  setState: null as ((state: string) => void) | null,
  setBlob: null as ((blob: Blob | null) => void) | null,
}))

vi.mock("@/lib/services/transcription/transcribe-voice-note", () => ({
  transcribeVoiceNote: (...args: unknown[]) => transcribe.fn(...args),
}))

vi.mock("@/hooks/useVoiceRecorder", async () => {
  const React = await import("react")
  return {
    useVoiceRecorder: () => {
      const [state, setState] = React.useState("idle")
      const [blob, setBlob] = React.useState<Blob | null>(null)

      recorder.setState = setState as (state: string) => void
      recorder.setBlob = setBlob

      // `reset` must be referentially stable — the session effect depends on it,
      // and an unstable identity would re-run the very reset this issue removes.
      const reset = React.useCallback(() => {
        recorder.resetCalls += 1
        setState("idle")
        setBlob(null)
      }, [])

      const start = React.useCallback(async () => {
        recorder.startCalls += 1
        setState("recording")
      }, [])

      return {
        state,
        start,
        stop: React.useCallback(() => setState("stopped"), []),
        pause: React.useCallback(() => setState("paused"), []),
        resume: React.useCallback(() => setState("recording"), []),
        reset,
        blob,
        waveformData: [],
        duration: 0,
        permissionDenied: false,
        isSupported: true,
        errorMessage: null,
      }
    },
  }
})

let container: HTMLDivElement
let root: Root

function position(overrides: Partial<AnnotationBubblePosition> = {}): AnnotationBubblePosition {
  return { x: 100, y: 200, top: 180, bottom: 200, ...overrides }
}

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node)
  })
}

function textarea() {
  const element = container.querySelector("textarea")
  if (!element) throw new Error("Annotation textarea is not rendered.")
  return element as HTMLTextAreaElement
}

async function type(value: string) {
  const element = textarea()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function buttonByText(label: string) {
  const match = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  )
  return match ?? null
}

async function click(element: Element | null) {
  if (!element) throw new Error("Button not found.")
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  transcribe.fn.mockReset()
  recorder.resetCalls = 0
  recorder.startCalls = 0
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

describe("AnnotationBubble session lifecycle", () => {
  it("keeps the draft when only the position changes", async () => {
    const sessionId = nextAnnotationSessionId()
    const props = { sessionId, type: "personal" as const, onConfirm: vi.fn(), onCancel: vi.fn() }

    await render(<AnnotationBubble position={position()} {...props} />)
    const note = "a".repeat(1_200) + "\nsecond line"
    await type(note)
    expect(textarea().value).toBe(note)

    // Simulate a scroll, then a flip: new geometry objects on every tick.
    await render(<AnnotationBubble position={position({ y: 140, top: 120, bottom: 140 })} {...props} />)
    await render(<AnnotationBubble position={position({ y: 40, top: 20, bottom: 40, x: 12 })} {...props} />)

    expect(textarea().value).toBe(note)
  })

  it("does not touch the recorder while repositioning", async () => {
    const sessionId = nextAnnotationSessionId()
    const props = { sessionId, type: "personal" as const, onConfirm: vi.fn(), onCancel: vi.fn() }

    await render(<AnnotationBubble position={position()} {...props} />)
    await act(async () => {
      recorder.setState?.("recording")
    })
    const resetsAfterOpen = recorder.resetCalls

    await render(<AnnotationBubble position={position({ y: 90, top: 70, bottom: 90 })} {...props} />)
    await render(<AnnotationBubble position={position({ y: 91, top: 71, bottom: 91 })} {...props} />)

    expect(recorder.resetCalls).toBe(resetsAfterOpen)
    expect(container.querySelector("[aria-label='Pause recording']")).not.toBeNull()
  })

  it("clears the draft exactly once when a new session opens", async () => {
    const first = nextAnnotationSessionId()
    const shared = { type: "personal" as const, onConfirm: vi.fn(), onCancel: vi.fn() }

    await render(<AnnotationBubble position={position()} sessionId={first} {...shared} />)
    await type("first draft")

    const second = nextAnnotationSessionId()
    await render(<AnnotationBubble position={position({ y: 300 })} sessionId={second} {...shared} />)
    expect(textarea().value).toBe("")

    await type("second draft")
    await render(<AnnotationBubble position={position({ y: 310 })} sessionId={second} {...shared} />)
    expect(textarea().value).toBe("second draft")
  })

  it("starts empty after the session is dismissed and reopened", async () => {
    const shared = { type: "personal" as const, onConfirm: vi.fn(), onCancel: vi.fn() }
    const first = nextAnnotationSessionId()

    await render(<AnnotationBubble position={position()} sessionId={first} {...shared} />)
    await type("abandoned draft")

    await render(<AnnotationBubble position={null} sessionId={null} {...shared} />)
    await render(
      <AnnotationBubble position={position()} sessionId={nextAnnotationSessionId()} {...shared} />,
    )

    expect(textarea().value).toBe("")
  })
})

describe("AnnotationBubble confirmation", () => {
  it("confirms exactly one annotation with the complete note, after repositioning", async () => {
    const onConfirm = vi.fn()
    const sessionId = nextAnnotationSessionId()
    const props = { sessionId, type: "personal" as const, onConfirm, onCancel: vi.fn() }

    await render(<AnnotationBubble position={position()} {...props} />)
    const note = "b".repeat(1_100)
    await type(note)
    await render(<AnnotationBubble position={position({ y: 55, top: 35, bottom: 55 })} {...props} />)

    await click(buttonByText("Save"))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(note)
  })

  it("produces no annotation when the session is cancelled", async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const props = { sessionId: nextAnnotationSessionId(), type: "personal" as const, onConfirm, onCancel }

    await render(<AnnotationBubble position={position()} {...props} />)
    await type("draft that is thrown away")
    await click(buttonByText("Cancel"))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe("AnnotationBubble transcription recovery", () => {
  it("shows an actionable error with Retry and reuses the same blob", async () => {
    const blob = new Blob(["audio"], { type: "audio/webm" })
    transcribe.fn
      .mockRejectedValueOnce(new Error("Could not reach the transcription service."))
      .mockResolvedValueOnce("recovered transcript")

    const sessionId = nextAnnotationSessionId()
    const shared = { sessionId, type: "ai" as const, onConfirm: vi.fn(), onCancel: vi.fn() }

    await render(<AnnotationBubble position={position()} {...shared} />)
    await act(async () => {
      recorder.setBlob?.(blob)
      recorder.setState?.("stopped")
    })

    expect(container.textContent).toContain("Could not reach the transcription service.")
    expect(buttonByText("Retry")).not.toBeNull()
    expect(buttonByText("Discard")).not.toBeNull()

    // Repositioning must not drop the blob that Retry depends on.
    await render(<AnnotationBubble position={position({ y: 60, top: 40, bottom: 60 })} {...shared} />)
    expect(buttonByText("Retry")).not.toBeNull()

    await click(buttonByText("Retry"))

    expect(transcribe.fn).toHaveBeenCalledTimes(2)
    expect(transcribe.fn.mock.calls[1][0]).toBe(blob)
    expect(textarea().value).toBe("recovered transcript")
  })

  it("does not retry on its own after a failure", async () => {
    transcribe.fn.mockRejectedValue(new Error("Transcription service is unreachable."))
    const shared = {
      sessionId: nextAnnotationSessionId(),
      type: "ai" as const,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    }

    await render(<AnnotationBubble position={position()} {...shared} />)
    await act(async () => {
      recorder.setBlob?.(new Blob(["audio"], { type: "audio/webm" }))
      recorder.setState?.("stopped")
    })

    await render(<AnnotationBubble position={position({ y: 70 })} {...shared} />)
    await render(<AnnotationBubble position={position({ y: 80 })} {...shared} />)

    expect(transcribe.fn).toHaveBeenCalledTimes(1)
  })

  it("discards a transcript that resolves after the session was cancelled", async () => {
    let resolveTranscript: ((value: string) => void) | null = null
    transcribe.fn.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveTranscript = resolve
        }),
    )

    const onConfirm = vi.fn()
    const first = nextAnnotationSessionId()

    await render(
      <AnnotationBubble
        position={position()}
        sessionId={first}
        type="ai"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    await act(async () => {
      recorder.setBlob?.(new Blob(["audio"], { type: "audio/webm" }))
      recorder.setState?.("stopped")
    })
    expect(transcribe.fn).toHaveBeenCalledTimes(1)

    // The reader cancels; the request is still in flight.
    await render(
      <AnnotationBubble
        position={null}
        sessionId={null}
        type="ai"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    await render(
      <AnnotationBubble
        position={position()}
        sessionId={nextAnnotationSessionId()}
        type="ai"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    await act(async () => {
      resolveTranscript?.("late transcript")
    })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(textarea().value).toBe("")
    const signal = transcribe.fn.mock.calls[0][1]?.signal as AbortSignal | undefined
    expect(signal?.aborted).toBe(true)
  })
})
