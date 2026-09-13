import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/ai/workspace-semantic-round/route"
import { getWorkspaceSemanticToolDescriptors, WORKSPACE_SEMANTIC_READ_TOOL_NAME } from "@/lib/ai/workspace-semantic-tool-registry"

const authMock = vi.hoisted(() => ({ getCurrentUserFromRequest: vi.fn() }))
const providerMock = vi.hoisted(() => ({ getOpenAIWorkspaceProviderConfig: vi.fn() }))

vi.mock("@/lib/supabase/request-auth", () => authMock)
vi.mock("@/lib/ai/openai-workspace-provider-config", () => providerMock)

const execution = {
  invocationId: "semantic-invocation-1",
  action: "relations",
  stage: "semantic-review",
  runtime: "web",
  contextVersion: "workspace-agent-v1",
} as const

const requestBody = {
  operation: "relations",
  input: [{ type: "message", role: "user", content: "Review the selected evidence." }],
  tools: getWorkspaceSemanticToolDescriptors(),
  execution,
}

describe("POST /api/ai/workspace-semantic-round", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    authMock.getCurrentUserFromRequest.mockReset()
    providerMock.getOpenAIWorkspaceProviderConfig.mockReset()
    authMock.getCurrentUserFromRequest.mockResolvedValue({ userId: "user-1" })
    providerMock.getOpenAIWorkspaceProviderConfig.mockReturnValue({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-5.6-luna",
      responsesUrl: "https://api.openai.com/v1/responses",
      maxOutputTokens: 8_192,
      reasoningEffort: "none",
    })
  })

  it("maps a Responses function call into the neutral semantic-round contract", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.store).toBe(true)
      expect(body.tool_choice).toBe("auto")
      expect(body.previous_response_id).toBeUndefined()
      expect(body.input[0]).toMatchObject({ role: "system" })
      expect(body.input[1]).toEqual({ role: "user", content: "Review the selected evidence." })
      expect(body.tools).toEqual([expect.objectContaining({
        type: "function",
        name: WORKSPACE_SEMANTIC_READ_TOOL_NAME,
        strict: true,
      })])
      expect(body.text.format).toMatchObject({
        type: "json_schema",
        name: "WorkspaceSemanticFinalEnvelope",
        schema: { required: ["coverage", "status", "payload"] },
      })
      return new Response(JSON.stringify({
        id: "resp-semantic-1",
        status: "completed",
        model: "gpt-5.6-luna",
        output: [{
          id: "fc-1",
          type: "function_call",
          status: "completed",
          call_id: "call-1",
          name: WORKSPACE_SEMANTIC_READ_TOOL_NAME,
          arguments: JSON.stringify({
            documentId: "doc-1",
            expectedDocumentVersion: "hash-v1",
            expectedContentHash: "hash-v1",
            lineStart: 1,
            lineEnd: 2,
            maxChars: 500,
          }),
        }],
        usage: { input_tokens: 22, output_tokens: 11, total_tokens: 33 },
      }), { status: 200, headers: { "content-type": "application/json" } })
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(new Request("https://app.odessay.com/api/ai/workspace-semantic-round", {
      method: "POST",
      body: JSON.stringify(requestBody),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.error).toBeNull()
    expect(payload.data).toMatchObject({
      responseId: "resp-semantic-1",
      status: "requires_tool",
      toolCalls: [{
        callId: "call-1",
        name: WORKSPACE_SEMANTIC_READ_TOOL_NAME,
        arguments: { documentId: "doc-1", expectedDocumentVersion: "hash-v1" },
      }],
      executionReceipt: expect.objectContaining({
        invocationId: "semantic-invocation-1",
        productStatus: "not-evaluated",
        supportId: "resp-semantic-1",
      }),
    })
  })

  it("rejects a non-canonical tool descriptor before calling OpenAI", async () => {
    const providerFetch = vi.fn()
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(new Request("https://app.odessay.com/api/ai/workspace-semantic-round", {
      method: "POST",
      body: JSON.stringify({
        ...requestBody,
        tools: [{ ...requestBody.tools[0], description: "read anything by path" }],
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error.code).toBe("INVALID_INPUT")
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it("does not call the provider without a session", async () => {
    authMock.getCurrentUserFromRequest.mockResolvedValueOnce({ userId: null })
    const providerFetch = vi.fn()
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(new Request("https://app.odessay.com/api/ai/workspace-semantic-round", {
      method: "POST",
      body: JSON.stringify(requestBody),
    }))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.error.code).toBe("UNAUTHORIZED")
    expect(providerFetch).not.toHaveBeenCalled()
  })
})
