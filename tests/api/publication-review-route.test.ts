import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/ai/publication-review/route"

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: vi.fn(async () => {
    const result = await supabaseMock.getUser()
    return { userId: result.data?.user?.id ?? null }
  }),
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
      expect(body.max_tokens).toBe(768)
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
                  '{"summary":"One correction.","language":"es","corrections":[{"blockId":"correction-block:pub-test:1","type":"spelling","severity":"medium","confidence":"high","originalText":"prueva","replacementText":"prueba","reason":"Typo."}],"uncertain":[]}',
              },
            },
          ],
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
  })

  it("uses the explicit 768 token budget for block-level correction calls", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.max_tokens).toBe(768)
      expect(body.messages[1].content).toContain("[correction-block:blk-test:12]")
      expect(body.messages[1].content).not.toContain("[block-1]")

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"summary":"One correction.","language":"es","corrections":[{"blockId":"correction-block:blk-test:12","type":"spelling","severity":"medium","confidence":"high","originalText":"prueva","replacementText":"prueba"}],"uncertain":[]}',
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

})
