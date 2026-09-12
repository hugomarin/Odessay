/** @vitest-environment happy-dom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeAnalyser {
  fftSize = 2048
  smoothingTimeConstant = 0

  disconnect() {}

  getByteTimeDomainData(samples: Uint8Array) {
    samples.fill(128)
  }
}

class FakeAudioContext {
  createAnalyser() {
    return new FakeAnalyser()
  }

  createMediaStreamSource() {
    return { connect() {} }
  }

  close() {
    return Promise.resolve()
  }
}

class FakeMediaRecorder {
  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus"
  }

  state: RecordingState = "inactive"
  readonly mimeType = "audio/webm;codecs=opus"
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: ((event: Event & { error?: DOMException }) => void) | null = null
  onpause: ((event: Event) => void) | null = null
  onresume: ((event: Event) => void) | null = null
  onstop: ((event: Event) => void) | null = null

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}

  start() {
    this.state = "recording"
  }

  stop() {
    this.state = "inactive"
    this.onstop?.(new Event("stop"))
  }
}

function RecorderHarness() {
  const { start, state, permissionDenied } = useVoiceRecorder()

  return (
    <button
      type="button"
      data-testid="start-recording"
      data-state={state}
      data-permission-denied={String(permissionDenied)}
      onClick={() => void start()}
    >
      Start recording
    </button>
  )
}

let container: HTMLDivElement
let root: Root
let getUserMedia: ReturnType<typeof vi.fn>
let permissionQuery: ReturnType<typeof vi.fn>
let originalMediaDevices: MediaDevices | undefined
let originalPermissions: Permissions | undefined
let originalMediaRecorder: typeof MediaRecorder | undefined
let originalAudioContext: typeof AudioContext | undefined

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  originalMediaDevices = navigator.mediaDevices
  originalPermissions = navigator.permissions
  originalMediaRecorder = globalThis.MediaRecorder
  originalAudioContext = window.AudioContext

  getUserMedia = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: vi.fn() }],
  })
  permissionQuery = vi.fn().mockResolvedValue({ state: "denied", onchange: null })

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  })
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: permissionQuery },
  })
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  })
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: FakeAudioContext,
  })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: originalMediaDevices,
  })
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: originalPermissions,
  })
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: originalMediaRecorder,
  })
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: originalAudioContext,
  })
})

describe("useVoiceRecorder in a Tauri WebView", () => {
  it("uses getUserMedia as the permission authority instead of WebKit Permissions API", async () => {
    await act(async () => {
      root.render(<RecorderHarness />)
    })

    const button = container.querySelector('[data-testid="start-recording"]')
    if (!button) throw new Error("Recorder button is not rendered.")

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(permissionQuery).not.toHaveBeenCalled()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(button.getAttribute("data-state")).toBe("recording")
    expect(button.getAttribute("data-permission-denied")).toBe("false")
  })
})
