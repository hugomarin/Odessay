import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/ai/publication-review/route"

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: supabaseMock,
  })),
}))

vi.mock("@/lib/ai/provider-config", () => ({
  getAIProviderConfig: () => ({
    baseUrl: "https://provider.test",
    apiKey: "test-key",
    model: "test-model",
    chatCompletionsUrl: "https://provider.test/chat/completions",
    maxTokens: 1000,
    topP: 0.95,
  }),
}))

const createRequest = (body: Record<string, unknown>) =>
  new Request("https://app.odessay.com/api/ai/publication-review", {
    method: "POST",
    body: JSON.stringify({
      title: "Test",
      markdown: "Esta es una prueva.",
      bodyText: "Esta es una prueva.",
      sourceHash: "pub-test",
      ...body,
    }),
  })

const streamFromLines = (lines: string[]) => {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`))
      }

      controller.close()
    },
  })
}

describe("POST /api/ai/publication-review", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    supabaseMock.getUser.mockReset()
    supabaseMock.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    })
  })

  it("opens NDJSON streaming immediately and asks the provider for strict JSON mode", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.stream).toBe(true)
      expect(body.response_format).toEqual({ type: "json_object" })
      expect(body.messages[0].content).toContain("The first character of your response must be {")

      return new Response(
        streamFromLines([
          'data: {"choices":[{"delta":{"content":"{\\"summary\\":\\"One correction.\\",\\"language\\":\\"es\\",\\"corrections\\":[{\\"blockId\\":\\"block-1\\",\\"type\\":\\"spelling\\",\\"severity\\":\\"medium\\",\\"confidence\\":\\"high\\",\\"originalText\\":\\"prueva\\",\\"replacementText\\":\\"prueba\\",\\"reason\\":\\"Typo.\\"}],\\"uncertain\\":[]}"}}]}',
          "data: [DONE]",
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({ stream: true }))
    const text = await response.text()
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))

    expect(response.status).toBe(200)
    expect(events[0]).toEqual({
      type: "status",
      sourceHash: "pub-test",
      status: "started",
    })
    expect(events.some((event) => event.type === "suggestion" && event.suggestion.replacement_text === "prueba")).toBe(
      true,
    )
    expect(events.at(-1)?.type).toBe("done")
  })

  it("returns a stream error event instead of an opaque failed HTTP stream when provider JSON is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          streamFromLines([
            'data: {"choices":[{"delta":{"content":"Let me analyze this text first."}}]}',
            "data: [DONE]",
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      ),
    )

    const response = await POST(createRequest({ stream: true }))
    const text = await response.text()
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))

    expect(response.status).toBe(200)
    expect(events.at(-1)).toMatchObject({
      type: "error",
      sourceHash: "pub-test",
      code: "AI_REVIEW_FAILED",
      message: "AI did not return valid correction JSON after retry.",
    })
  })

  it("falls back to strict non-stream JSON when streamed content is prose", async () => {
    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          streamFromLines([
            'data: {"choices":[{"delta":{"content":"Let me analyze this text first."}}]}',
            "data: [DONE]",
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"summary":"One correction.","language":"es","corrections":[{"blockId":"block-1","type":"spelling","severity":"medium","confidence":"high","originalText":"prueva","replacementText":"prueba","reason":"Typo."}],"uncertain":[]}',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({ stream: true }))
    const text = await response.text()
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))

    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(events.some((event) => event.type === "suggestion" && event.suggestion.replacement_text === "prueba")).toBe(
      true,
    )
    expect(events.at(-1)?.type).toBe("done")
  })

  it("falls back to strict non-stream JSON when the provider stream has no content chunks", async () => {
    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(streamFromLines(["data: [DONE]"]), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"summary":"One correction.","language":"es","corrections":[{"blockId":"block-1","type":"spelling","severity":"medium","confidence":"high","originalText":"prueva","replacementText":"prueba","reason":"Typo."}],"uncertain":[]}',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({ stream: true }))
    const text = await response.text()
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))

    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(events.some((event) => event.type === "suggestion" && event.suggestion.replacement_text === "prueba")).toBe(
      true,
    )
    expect(events.at(-1)?.type).toBe("done")
  })
})
