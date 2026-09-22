import { beforeEach, describe, expect, it, vi } from "vitest"
import { createWorkspaceExecutionContext, countWorkspaceCompactionItems } from "@/lib/ai/workspace-execution-receipt"
import { callWorkspaceOpenAIResponseStaged } from "@/lib/ai/workspace-openai-response"

const config = {
  provider: "openai" as const,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "test-key",
  model: "gpt-5.6-luna",
  responsesUrl: "https://api.openai.com/v1/responses",
  maxOutputTokens: 512,
  reasoningEffort: "none" as const,
  contextWindowTokens: 180,
  contextCapacitySource: "deployment_override" as const,
  contextCapacityStatus: "known" as const,
  historyReserveTokens: 0,
  reasoningReserveTokens: 0,
  safetyMarginTokens: 0,
  compactionThresholdTokens: 120,
}

const responseFor = (id: string, previousResponseId: string | null, outputText?: string) => new Response(JSON.stringify({
  id,
  object: "response",
  model: config.model,
  status: "completed",
  previous_response_id: previousResponseId,
  output: outputText
    ? [{ type: "message", content: [{ type: "output_text", text: outputText }] }]
    : [{ type: "message", content: [{ type: "output_text", text: "received staged evidence" }] }],
  usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
}), { status: 200, headers: { "content-type": "application/json" } })

describe("Workspace OpenAI staged Responses adapter", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("chains staged input, resends the system prompt, disables hidden truncation and keeps compaction config", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { previous_response_id?: string; input: Array<{ content?: string }>; text?: unknown; truncation?: string; context_management?: unknown }
      const callNumber = providerFetch.mock.calls.length
      return responseFor(`resp-stage-${callNumber}`, body.previous_response_id ?? null, callNumber >= 2 ? JSON.stringify({ ok: true }) : undefined)
    })
    vi.stubGlobal("fetch", providerFetch)

    const systemPrompt = "You are the Workspace agent."
    const userPrompt = "Selected document evidence: " + "full canonical markdown. ".repeat(200)
    const response = await callWorkspaceOpenAIResponseStaged({
      config,
      execution: createWorkspaceExecutionContext("ask", "cloud"),
      systemPrompt,
      userPrompt,
      maxOutputTokens: config.maxOutputTokens,
      timeoutMs: 5_000,
      textFormat: { type: "json_schema", name: "Answer", schema: {} },
      contextManagement: [{ type: "compaction", compact_threshold: config.compactionThresholdTokens }],
      capacity: { contextWindowTokens: config.contextWindowTokens, reservedOutputTokens: 40 },
      messages: {
        unavailable: "unavailable",
        timeout: "timeout",
        rateLimited: "rate limited",
        contractRejected: "contract rejected",
        authRejected: "auth rejected",
        providerFailed: "provider failed",
        parseFailed: "parse failed",
      },
    })

    expect(response.staged).toBe(true)
    expect(providerFetch.mock.calls.length).toBeGreaterThan(1)
    const bodies = providerFetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as {
      previous_response_id?: string
      input: Array<{ role?: string; content?: string }>
      text?: unknown
      truncation: string
      context_management: unknown
    })
    expect(bodies[0].previous_response_id).toBeUndefined()
    expect(bodies[1].previous_response_id).toBe("resp-stage-1")
    expect(bodies.every((body) => body.truncation === "disabled")).toBe(true)
    expect(bodies.every((body) => JSON.stringify(body.context_management).includes("compaction"))).toBe(true)
    expect(bodies.every((body) => body.input[0]?.role === "system" && body.input[0]?.content === systemPrompt)).toBe(true)
    expect(bodies.slice(0, -1).every((body) => body.text === undefined)).toBe(true)
    expect(bodies.at(-1)?.text).toBeDefined()
    const recoveredContent = bodies.map((body) => body.input[1]?.content ?? "").map((content) => {
      const match = content.match(/^Staged context part \d+\/\d+\. Preserve this content as evidence in the current scope\.\n\n([\s\S]+)\n\n(?:Do not finalize yet\. Wait for the next staged context part\.|All staged context is now available\. Return the final structured answer\.)$/)
      return match?.[1] ?? ""
    }).join("")
    expect(recoveredContent).toBe(userPrompt)
    expect(response.payload.id).toBe(`resp-stage-${bodies.length}`)
    expect(response.receipt.responses.map((trace) => trace.responseId)).toEqual(
      bodies.map((_body, index) => `resp-stage-${index + 1}`),
    )
    expect(countWorkspaceCompactionItems(response.receipt)).toBe(0)
  })

  it("returns budget_exceeded before provider I/O when staged continuity has no compaction policy", async () => {
    const providerFetch = vi.fn()
    vi.stubGlobal("fetch", providerFetch)

    await expect(callWorkspaceOpenAIResponseStaged({
      config,
      execution: createWorkspaceExecutionContext("ask", "cloud"),
      systemPrompt: "You are the Workspace agent.",
      userPrompt: "Selected evidence: " + "full markdown. ".repeat(200),
      maxOutputTokens: config.maxOutputTokens,
      timeoutMs: 5_000,
      textFormat: { type: "json_schema", name: "Answer", schema: {} },
      capacity: { contextWindowTokens: config.contextWindowTokens, reservedOutputTokens: 40 },
      messages: {
        unavailable: "unavailable",
        timeout: "timeout",
        rateLimited: "rate limited",
        contractRejected: "contract rejected",
        authRejected: "auth rejected",
        providerFailed: "provider failed",
        parseFailed: "parse failed",
      },
    })).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" })
    expect(providerFetch).not.toHaveBeenCalled()
  })
})
