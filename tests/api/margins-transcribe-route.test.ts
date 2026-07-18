import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/margins/transcribe/route"

const supabaseAuthMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: vi.fn(async () => {
    const result = await supabaseAuthMock.getUser()
    return { userId: result.data?.user?.id ?? null }
  }),
}))

const createRequest = (audio?: Blob) => {
  const formData = new FormData()
  if (audio) {
    formData.set("audio", audio, "note.webm")
  }

  return new Request("https://app.odessay.com/api/margins/transcribe", {
    method: "POST",
    body: formData,
  })
}

describe("POST /api/margins/transcribe", () => {
  beforeEach(() => {
    process.env.DEEPGRAM_API_KEY = "deepgram-test-key"
    supabaseAuthMock.getUser.mockReset()
    vi.restoreAllMocks()
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

      const [, init] = fetchMock.mock.calls[0] ?? []
      expect(init?.body).toBeInstanceOf(File)
      expect((init?.body as File).type).toBe(audioType)
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
})
