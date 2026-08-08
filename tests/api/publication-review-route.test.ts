import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/ai/publication-review/route"

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

const providerConfigMock = vi.hoisted(() => ({
  getAIProviderConfig: vi.fn(),
}))

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: vi.fn(async () => {
    const result = await supabaseMock.getUser()
    return { userId: result.data?.user?.id ?? null }
  }),
}))

vi.mock("@/lib/ai/provider-config", () => ({
  getAIProviderConfig: providerConfigMock.getAIProviderConfig,
}))

const createRequest = (body: Record<string, unknown>) =>
  new Request("https://app.odessay.com/api/ai/publication-review", {
    method: "POST",
    body: JSON.stringify({
      title: "Test",
      markdown: "Esta es una prueva.",
      bodyText: "Esta es una prueva.",
      sourceHash: "pub-test",
      correctionBlock: {
        id: "correction-block:pub-test:1",
        text: "Esta es una prueva.",
        hash: "pub-test",
      },
      ...body,
    }),
  })

describe("POST /api/ai/publication-review", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    supabaseMock.getUser.mockReset()
    providerConfigMock.getAIProviderConfig.mockReset()
    providerConfigMock.getAIProviderConfig.mockReturnValue({
      baseUrl: "https://provider.test",
      apiKey: "test-key",
      model: "test-model",
      chatCompletionsUrl: "https://provider.test/chat/completions",
      maxTokens: 1000,
      topP: 0.95,
    })
    supabaseMock.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    })
  })

  it("treats the legacy stream flag as a JSON request and asks the provider for structured output", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.stream).toBeUndefined()
      expect(body.max_tokens).toBe(512)
      expect(body.response_format).toMatchObject({
        type: "json_schema",
        json_schema: {
          name: "MechanicalCorrectionsResponse",
          schema: {
            required: ["language", "corrections"],
          },
        },
      })
      expect(body.messages[0].content).toContain("The first character of your response must be {")

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"summary":"One correction.","language":"es","corrections":[{"blockId":"block-0","type":"spelling","severity":"medium","confidence":"high","originalText":"prueva","replacementText":"prueba","reason":"Typo."}],"uncertain":[]}',
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({ stream: true }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(payload.data.suggestions[0]).toMatchObject({
      block_id: "correction-block:pub-test:1",
      replacement_text: "prueba",
    })
    expect(payload.data).toMatchObject({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    })
  })

  it("uses the package token budget and restores the original block id", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.max_tokens).toBe(512)
      expect(body.messages[1].content).toContain("[block-0]")
      expect(body.messages[1].content).not.toContain("[correction-block:blk-test:12]")

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"summary":"One correction.","language":"es","corrections":[{"blockId":"block-0","type":"spelling","severity":"medium","confidence":"high","originalText":"prueva","replacementText":"prueba"}],"uncertain":[]}',
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({
      markdown: "Esta es una prueva con suficientes palabras para analizar.",
      bodyText: "Esta es una prueva con suficientes palabras para analizar.",
      sourceHash: "blk-test",
      correctionBlock: {
        id: "correction-block:blk-test:12",
        text: "Esta es una prueva con suficientes palabras para analizar.",
        hash: "blk-test",
      },
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.suggestions[0]).toMatchObject({
      block_id: "correction-block:blk-test:12",
      replacement_text: "prueba",
    })
  })

  it("accepts batched correction blocks and restores every original block id", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.max_tokens).toBe(512)
      expect(body.messages[1].content).toContain("[block-0]")
      expect(body.messages[1].content).toContain("[block-1]")

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"summary":"Two corrections.","language":"es","corrections":[{"blockId":"block-0","type":"spelling","originalText":"prueva","replacementText":"prueba"},{"blockId":"block-1","type":"accent","originalText":"asi","replacementText":"así"}],"uncertain":[]}',
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({
      markdown: "Esta es una prueva.\n\nSolo asi.",
      bodyText: "Esta es una prueva.\n\nSolo asi.",
      sourceHash: "batch-test",
      correctionBlock: undefined,
      correctionBlocks: [
        {
          id: "correction-block:blk-test:1",
          text: "Esta es una prueva.",
          hash: "blk-test-1",
        },
        {
          id: "correction-block:blk-test:2",
          text: "Solo asi.",
          hash: "blk-test-2",
        },
      ],
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.corrections).toEqual([
      expect.objectContaining({ blockId: "correction-block:blk-test:1", replacementText: "prueba" }),
      expect.objectContaining({ blockId: "correction-block:blk-test:2", replacementText: "así" }),
    ])
  })

  it("injects learned words into the prompt and filters them defensively from the response", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.messages[1].content).toContain("odessay")

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"summary":"One correction.","language":"es","corrections":[{"blockId":"correction-block:pub-test:1","type":"spelling","originalText":"Odessay","replacementText":"Odyssey"}],"uncertain":[]}',
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({
      markdown: "Odessay es una herramienta.",
      bodyText: "Odessay es una herramienta.",
      correctionBlock: {
        id: "correction-block:pub-test:1",
        text: "Odessay es una herramienta.",
        hash: "pub-test",
      },
      learnedWords: {
        entries: [{ word: "odessay", language: "unknown" }],
      },
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.corrections).toEqual([])
    expect(payload.data.suggestions).toEqual([])
  })

  it("returns a non-retryable missing config error without calling the provider", async () => {
    providerConfigMock.getAIProviderConfig.mockImplementation(() => {
      throw new Error("Missing FIREWORKS_MODEL environment variable.")
    })
    const providerFetch = vi.fn()
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({}))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(providerFetch).not.toHaveBeenCalled()
    expect(payload).toMatchObject({
      data: null,
      error: {
        code: "MISSING_CONFIG",
        retryable: false,
        details: { phase: "config" },
      },
    })
  })

  it("classifies provider rate limits as retryable 429 errors", async () => {
    const providerFetch = vi.fn(async () =>
      new Response("quota exceeded", { status: 429 }),
    )
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({}))
    const payload = await response.json()

    expect(response.status).toBe(429)
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(payload).toMatchObject({
      data: null,
      error: {
        code: "RATE_LIMITED",
        retryable: true,
        details: {
          phase: "provider",
          providerStatus: 429,
          providerBodyClass: "rate_limit",
        },
      },
    })
    expect(payload.error.message).not.toContain("quota exceeded")
  })

  it("classifies provider 5xx as retryable unavailable errors without leaking the body", async () => {
    const providerFetch = vi.fn(async () =>
      new Response("provider secret stack trace", { status: 502 }),
    )
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({}))
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload).toMatchObject({
      data: null,
      error: {
        code: "UNAVAILABLE",
        retryable: true,
        details: {
          phase: "provider",
          providerStatus: 502,
        },
      },
    })
    expect(payload.error.message).not.toContain("secret")
  })

  it("falls back without response_format when structured output returns provider 5xx", async () => {
    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("provider internal response_format failure", { status: 500 }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body))
        expect(body.response_format).toBeUndefined()
        expect(body.messages[0].content).toContain("The first character of your response must be {")

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"summary":"One correction.","language":"es","corrections":[{"blockId":"correction-block:pub-test:1","type":"spelling","originalText":"prueva","replacementText":"prueba"}],"uncertain":[]}',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      })
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({}))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(payload.error).toBeNull()
    expect(payload.data.corrections).toEqual([
      expect.objectContaining({ blockId: "correction-block:pub-test:1", replacementText: "prueba" }),
    ])
  })

  it("classifies provider aborts as retryable timeout errors", async () => {
    const abortError = new Error("The operation was aborted")
    abortError.name = "AbortError"
    const providerFetch = vi.fn(async () => {
      throw abortError
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({}))
    const payload = await response.json()

    expect(response.status).toBe(504)
    expect(payload).toMatchObject({
      data: null,
      error: {
        code: "TIMEOUT",
        retryable: true,
        details: {
          phase: "provider",
        },
      },
    })
  })

  it("falls back when structured output is rejected, then classifies repeated 4xx contract errors", async () => {
    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("response_format schema invalid", { status: 400 }))
      .mockResolvedValueOnce(new Response("request contract invalid", { status: 422 }))
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({}))
    const payload = await response.json()

    expect(response.status).toBe(422)
    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(payload).toMatchObject({
      data: null,
      error: {
        code: "AI_PROVIDER_CONTRACT_ERROR",
        retryable: false,
        details: {
          phase: "provider",
          providerStatus: 422,
          providerBodyClass: "provider_contract",
        },
      },
    })
  })

  it("classifies invalid provider JSON responses as retryable parse failures", async () => {
    const providerFetch = vi.fn(async () =>
      new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    )
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest({}))
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload).toMatchObject({
      data: null,
      error: {
        code: "AI_RESPONSE_PARSE_FAILED",
        retryable: true,
        details: {
          phase: "parse",
          providerStatus: 200,
        },
      },
    })
  })

})
