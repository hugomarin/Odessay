import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  EMPTY_RECORDING_MESSAGE,
  getVoiceNoteUploadMetadata,
  transcribeVoiceNote,
} from "@/lib/services/transcription/transcribe-voice-note"

vi.mock("@/lib/runtime/detect", () => ({
  isTauriRuntime: () => false,
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: vi.fn(),
}))

describe("transcribeVoiceNote", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
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
})
