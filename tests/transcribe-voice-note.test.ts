import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  EMPTY_RECORDING_MESSAGE,
  TRANSCRIPTION_OFFLINE_MESSAGE,
  TRANSCRIPTION_SERVER_MESSAGE,
  TRANSCRIPTION_SESSION_MESSAGE,
  buildLocalRuntimeHostMessage,
  getVoiceNoteUploadMetadata,
  isLocalRuntimeHost,
  transcribeVoiceNote,
} from "@/lib/services/transcription/transcribe-voice-note"

const runtime = vi.hoisted(() => ({ isTauri: false, accessToken: "token-123" as string | null }))

vi.mock("@/lib/runtime/detect", () => ({
  isTauriRuntime: () => runtime.isTauri,
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: runtime.accessToken ? { access_token: runtime.accessToken } : null },
        error: null,
      }),
    },
  }),
}))

describe("transcribeVoiceNote", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    runtime.isTauri = false
    runtime.accessToken = "token-123"
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it.each([
    ["audio/webm;codecs=opus", "voice-note.webm"],
    ["audio/mp4", "voice-note.mp4"],
    ["audio/ogg", "voice-note.ogg"],
  ])("derives the upload filename from %s", (mimeType, expectedFilename) => {
    const metadata = getVoiceNoteUploadMetadata(new Blob(["voice"], { type: mimeType }))
    expect(metadata.filename).toBe(expectedFilename)
  })

  it("uploads an mp4 recording without relabeling its container", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ data: { transcript: "voice transcript" }, error: null }),
    )

    await expect(
      transcribeVoiceNote(new Blob(["voice"], { type: "audio/mp4" })),
    ).resolves.toBe("voice transcript")

    const [, init] = fetchMock.mock.calls[0] ?? []
    const upload = (init?.body as FormData).get("audio")
    expect(upload).toBeInstanceOf(File)
    expect((upload as File).name).toBe("voice-note.mp4")
    expect((upload as File).type).toBe("audio/mp4")
  })

  it("reports empty audio and empty transcripts with a specific message", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ data: { transcript: "" }, error: null }),
    )

    await expect(
      transcribeVoiceNote(new Blob(["voice"], { type: "audio/webm" })),
    ).rejects.toThrow(EMPTY_RECORDING_MESSAGE)
    await expect(
      transcribeVoiceNote(new Blob([], { type: "audio/webm" })),
    ).rejects.toThrow(EMPTY_RECORDING_MESSAGE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("aborts a transcription that exceeds its timeout", async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"))
        })
      }),
    )

    const pending = transcribeVoiceNote(
      new Blob(["voice"], { type: "audio/webm" }),
      { timeoutMs: 25 },
    )
    const expectation = expect(pending).rejects.toThrow("Transcription timed out. Try again.")

    await vi.advanceTimersByTimeAsync(25)
    await expectation
  })

  // ─── ODE-409: raw fetch failures become actionable, never "Load failed" ─────

  it.each([
    ["Load failed", "WKWebView"],
    ["Failed to fetch", "Chromium"],
    ["NetworkError when attempting to fetch resource.", "Gecko"],
  ])("normalizes the %s rejection (%s) into a recoverable message", async (rawMessage) => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(rawMessage))

    await expect(
      transcribeVoiceNote(new Blob(["voice"], { type: "audio/webm" })),
    ).rejects.toThrow(TRANSCRIPTION_OFFLINE_MESSAGE)
  })

  it("names the misconfigured host when a desktop build cannot reach its local runtime", async () => {
    runtime.isTauri = true
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"))

    await expect(
      transcribeVoiceNote(new Blob(["voice"], { type: "audio/webm" })),
    ).rejects.toThrow(buildLocalRuntimeHostMessage("http://localhost:3000"))
  })

  it("sends desktop transcription to the configured remote host with a bearer token", async () => {
    runtime.isTauri = true
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://odessay.vercel.app/")
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ data: { transcript: "remote transcript" }, error: null }),
    )

    await expect(
      transcribeVoiceNote(new Blob(["voice"], { type: "audio/webm" })),
    ).resolves.toBe("remote transcript")

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("https://odessay.vercel.app/api/margins/transcribe")
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer token-123")
  })

  it("keeps web transcription same-origin", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ data: { transcript: "web transcript" }, error: null }),
    )

    await transcribeVoiceNote(new Blob(["voice"], { type: "audio/webm" }))

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/margins/transcribe")
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined()
  })

  it.each([401, 403])("translates HTTP %i into a sign-in instruction", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ data: null, error: { message: "Unauthorized" } }, { status }),
    )

    await expect(
      transcribeVoiceNote(new Blob(["voice"], { type: "audio/webm" })),
    ).rejects.toThrow(TRANSCRIPTION_SESSION_MESSAGE)
  })

  it("falls back to a recoverable message when the proxy returns no explanation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>Bad Gateway</html>", { status: 502 }),
    )

    await expect(
      transcribeVoiceNote(new Blob(["voice"], { type: "audio/webm" })),
    ).rejects.toThrow(TRANSCRIPTION_SERVER_MESSAGE)
  })

  it("preserves a specific server-side explanation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ data: null, error: { message: "Audio file exceeds 25 MB." } }, { status: 413 }),
    )

    await expect(
      transcribeVoiceNote(new Blob(["voice"], { type: "audio/webm" })),
    ).rejects.toThrow("Audio file exceeds 25 MB.")
  })

  it("surfaces an expired desktop session before touching the network", async () => {
    runtime.isTauri = true
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://odessay.vercel.app")
    runtime.accessToken = null
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      transcribeVoiceNote(new Blob(["voice"], { type: "audio/webm" })),
    ).rejects.toThrow(TRANSCRIPTION_SESSION_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not retry on its own — one attempt per call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"))

    await expect(
      transcribeVoiceNote(new Blob(["voice"], { type: "audio/webm" })),
    ).rejects.toThrow(TRANSCRIPTION_OFFLINE_MESSAGE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("isLocalRuntimeHost", () => {
  it.each(["http://localhost:3000", "http://127.0.0.1:3000/", "https://localhost"])(
    "treats %s as local",
    (host) => {
      expect(isLocalRuntimeHost(host)).toBe(true)
    },
  )

  it.each(["https://odessay.vercel.app", "http://ipc.localhost", ""])(
    "treats %s as remote",
    (host) => {
      expect(isLocalRuntimeHost(host)).toBe(false)
    },
  )
})
