import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/margins/transcribe/route"
import { resetAdmissionConfigCacheForTests } from "@/lib/ai/admission-config"

const supabaseAuthMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

const admissionMock = vi.hoisted(() => ({
  tryAcquireAiAdmission: vi.fn(),
  releaseAiAdmission: vi.fn(),
  logAiAdmissionEvent: vi.fn(),
}))

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: vi.fn(async () => {
    const result = await supabaseAuthMock.getUser()
    return { userId: result.data?.user?.id ?? null }
  }),
}))

vi.mock("@/lib/ai/admission", () => admissionMock)

const createRequest = (audio?: Blob, init: RequestInit = {}) => {
  const formData = new FormData()
  if (audio) {
    formData.set("audio", audio, "note.webm")
  }

  return new Request("https://app.odessay.com/api/margins/transcribe", {
    method: "POST",
    body: formData,
    ...init,
  })
}

describe("POST /api/margins/transcribe", () => {
  beforeEach(() => {
    process.env.DEEPGRAM_API_KEY = "deepgram-test-key"
    supabaseAuthMock.getUser.mockReset()
    admissionMock.tryAcquireAiAdmission.mockReset()
    admissionMock.releaseAiAdmission.mockReset()
    admissionMock.tryAcquireAiAdmission.mockResolvedValue({ admitted: true, leaseId: "lease-1" })
    vi.restoreAllMocks()
  })

  afterEach(() => {
    delete process.env.AI_TRANSCRIPTION_MAX_AUDIO_BYTES
    delete process.env.AI_TRANSCRIPTION_MAX_AUDIO_SECONDS
    resetAdmissionConfigCacheForTests()
  })

  it("returns 401 when there is no active session", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: null },
    })

    const response = await POST(createRequest())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "No active session.",
    })
    expect(admissionMock.tryAcquireAiAdmission).not.toHaveBeenCalled()
  })

  it("returns 400 when audio is missing from form data", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })

    const response = await POST(createRequest())
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toEqual({
      code: "INVALID_INPUT",
      message: "audio file is required.",
    })
    expect(admissionMock.releaseAiAdmission).toHaveBeenCalledWith("lease-1")
  })

  it.each(["audio/webm", "audio/mp4"])(
    "proxies a %s audio blob to Deepgram and returns the transcript",
    async (audioType) => {
      supabaseAuthMock.getUser.mockResolvedValue({
        data: { user: { id: "user-1" } },
      })

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            results: {
              channels: [
                {
                  alternatives: [{ transcript: "hola mundo" }],
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )

      const audio = new Blob(["voice-bytes"], { type: audioType })
      const response = await POST(createRequest(audio))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({
        data: { transcript: "hola mundo" },
        error: null,
      })
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.deepgram.com/v1/listen?model=nova-2&language=es",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Token deepgram-test-key",
            "Content-Type": audioType,
          },
        }),
      )

      const [, callInit] = fetchMock.mock.calls[0] ?? []
      expect(callInit?.body).toBeInstanceOf(Uint8Array)
      expect(new TextDecoder().decode(callInit?.body as Uint8Array)).toBe("voice-bytes")
      expect(admissionMock.releaseAiAdmission).toHaveBeenCalledWith("lease-1")
    },
  )

  it("returns 502 when Deepgram responds with an error", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream failed", {
        status: 400,
      }),
    )

    const response = await POST(createRequest(new Blob(["voice"], { type: "audio/ogg" })))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.error).toEqual({
      code: "TRANSCRIPTION_FAILED",
      message: "upstream failed",
    })
  })

  it("rejects an oversize upload declared via Content-Length before reading the body", async () => {
    process.env.AI_TRANSCRIPTION_MAX_AUDIO_BYTES = "1000"
    resetAdmissionConfigCacheForTests()
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    const fetchMock = vi.spyOn(globalThis, "fetch")

    const response = await POST(
      createRequest(new Blob(["voice"], { type: "audio/webm" }), {
        headers: { "content-length": "999999" },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(admissionMock.tryAcquireAiAdmission).not.toHaveBeenCalled()
  })

  it("rejects an oversize upload by parsed blob size when Content-Length was absent", async () => {
    process.env.AI_TRANSCRIPTION_MAX_AUDIO_BYTES = "1000"
    resetAdmissionConfigCacheForTests()
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    const fetchMock = vi.spyOn(globalThis, "fetch")

    const oversizeAudio = new Blob(["x".repeat(2000)], { type: "audio/webm" })
    const response = await POST(createRequest(oversizeAudio))
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a mislabeled or unsupported content type", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    const fetchMock = vi.spyOn(globalThis, "fetch")

    const response = await POST(createRequest(new Blob(["voice"], { type: "application/zip" })))
    const body = await response.json()

    expect(response.status).toBe(415)
    expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a recording that estimates over the duration cap", async () => {
    process.env.AI_TRANSCRIPTION_MAX_AUDIO_SECONDS = "1"
    resetAdmissionConfigCacheForTests()
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    const fetchMock = vi.spyOn(globalThis, "fetch")

    // ~30,000 bytes at webm's 24,000 bytes/sec estimate is ~1.25s, over the 1s cap.
    const longAudio = new Blob(["x".repeat(30_000)], { type: "audio/webm" })
    const response = await POST(createRequest(longAudio))
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns 429 with Retry-After and never calls the provider when admission is rejected", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    admissionMock.tryAcquireAiAdmission.mockResolvedValue({
      admitted: false,
      reason: "rate_limited",
      retryAfterSeconds: 30,
    })
    const fetchMock = vi.spyOn(globalThis, "fetch")

    const response = await POST(createRequest(new Blob(["voice"], { type: "audio/webm" })))
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("30")
    expect(body.error.code).toBe("RATE_LIMITED")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(admissionMock.releaseAiAdmission).not.toHaveBeenCalled()
  })
})
