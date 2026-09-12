import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST as askPOST } from "@/app/api/ai/workspace-ask/route"
import { POST as presentationPOST } from "@/app/api/ai/workspace-tool-presentation/route"

const authMock = vi.hoisted(() => ({ getCurrentUserFromRequest: vi.fn() }))
const providerMock = vi.hoisted(() => ({ getOpenAIWorkspaceProviderConfig: vi.fn() }))

vi.mock("@/lib/supabase/request-auth", () => authMock)
vi.mock("@/lib/ai/openai-workspace-provider-config", () => providerMock)

const askBody = {
  question: "What is this artifact about?",
  targetDocumentIds: [],
  documents: [],
  collections: [],
  documentCollectionIds: {},
  annotations: [],
  workflow: null,
  catalogTruncated: false,
  scopeFingerprint: "scope:test",
}

const presentationBody = {
  kind: "archive",
  facts: ["No stale artifacts were found."],
}

const providerResponse = (json: unknown, status = 200) => new Response(
  status === 200 ? JSON.stringify(json) : "provider secret body",
  { status, headers: { "content-type": "application/json" } },
)

describe("Workspace agent Responses observability", () => {
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

  it.each([
    ["ask", askPOST, askBody, "WorkspaceAskResponse", "answer"],
    ["presentation", presentationPOST, presentationBody, "WorkspaceToolPresentationResponse", "note"],
  ] as const)("stores and correlates the %s Responses call without retaining item bodies", async (_name, post, body, formatName, field) => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body))
      expect(requestBody.store).toBe(true)
      expect(requestBody.metadata).toMatchObject({
        action: _name,
        stage: _name === "presentation" ? "presentation" : "analysis",
        runtime: "cloud",
        context_version: "workspace-agent-v1",
      })
      expect(requestBody.text.format.name).toBe(formatName)
      return providerResponse({
        id: `resp-${_name}`,
        object: "response",
        model: "gpt-5.6-luna",
        status: "completed",
        output: [
          {
            id: "fc_1",
            type: "function_call",
            status: "completed",
            call_id: "call_1",
            name: "read_document",
            arguments: '{"secret":"must not reach receipt"}',
          },
          {
            id: "msg_1",
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(
              field === "answer"
                ? { answer: "It is a storage decision.", evidence: [], requestedDocumentIds: [], suggestedAction: null }
                : { note: "No stale artifacts were found." },
            ) }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
      })
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await post(new Request("https://app.odessay.com/api/ai/workspace-agent", {
      method: "POST",
      body: JSON.stringify(body),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.executionReceipt).toMatchObject({
      supportId: `resp-${_name}`,
      providerStatus: "completed",
      productStatus: "validated",
      responses: [{ responseId: `resp-${_name}`, outputItems: expect.arrayContaining([
        expect.objectContaining({ type: "function_call", callId: "call_1", name: "read_document", hasArguments: true }),
      ]) }],
    })
    expect(JSON.stringify(payload.data.executionReceipt)).not.toContain("must not reach receipt")
  })

  it("returns the in-memory invocation id when OpenAI fails before providing a response id", async () => {
    const providerFetch = vi.fn(async () => providerResponse(null, 502))
    vi.stubGlobal("fetch", providerFetch)

    const response = await askPOST(new Request("https://app.odessay.com/api/ai/workspace-ask", {
      method: "POST",
      body: JSON.stringify({ ...askBody, execution: {
        invocationId: "support-invocation-1",
        action: "ask",
        stage: "analysis",
        runtime: "web",
        contextVersion: "workspace-agent-v1",
      } }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.error.details.receipt).toMatchObject({
      invocationId: "support-invocation-1",
      supportId: "support-invocation-1",
      productStatus: "provider-error",
      responses: [{ responseId: null, httpStatus: 502, errorCode: "AI_PROVIDER_ERROR" }],
    })
    expect(payload.error.message).not.toContain("provider secret")
  })

  it("pins server-owned execution stage and runtime metadata", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body))
      expect(requestBody.metadata).toMatchObject({
        action: "ask",
        stage: "analysis",
        runtime: "cloud",
      })
      return providerResponse({
        id: "resp-pinned-execution",
        object: "response",
        model: "gpt-5.6-luna",
        status: "completed",
        output: [{
          id: "msg-1",
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({
            answer: "The artifact is a storage decision.",
            evidence: [],
            requestedDocumentIds: [],
            suggestedAction: null,
          }) }],
        }],
        usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
      })
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await askPOST(new Request("https://app.odessay.com/api/ai/workspace-ask", {
      method: "POST",
      body: JSON.stringify({
        ...askBody,
        execution: {
          invocationId: "client-invocation",
          action: "ask",
          stage: "synthesis",
          runtime: "desktop",
          contextVersion: "workspace-agent-v1",
        },
      }),
    }))

    expect(response.status).toBe(200)
  })

  it("continues Ask only when the previous response and explicit scope fingerprint match", async () => {
    let callCount = 0
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      callCount += 1
      const requestBody = JSON.parse(String(init?.body))
      if (callCount === 1) expect(requestBody.previous_response_id).toBeUndefined()
      if (callCount === 2) expect(requestBody.previous_response_id).toBe("resp-ask-1")
      expect(requestBody.input[0]).toMatchObject({ role: "system" })
      return providerResponse({
        id: `resp-ask-${callCount}`,
        object: "response",
        model: "gpt-5.6-luna",
        status: "completed",
        output: [{
          id: `msg-${callCount}`,
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({
            answer: callCount === 1 ? "The selected scope is ready." : "The prior scope remains in context.",
            evidence: [],
            requestedDocumentIds: [],
            suggestedAction: null,
            scopeStatus: "ready",
          }) }],
        }],
        usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
      })
    })
    vi.stubGlobal("fetch", providerFetch)

    const first = await askPOST(new Request("https://app.odessay.com/api/ai/workspace-ask", {
      method: "POST",
      body: JSON.stringify(askBody),
    }))
    const firstPayload = await first.json()
    const second = await askPOST(new Request("https://app.odessay.com/api/ai/workspace-ask", {
      method: "POST",
      body: JSON.stringify({
        ...askBody,
        previousResponseId: firstPayload.data.responseId,
        previousScopeFingerprint: firstPayload.data.scopeFingerprint,
      }),
    }))
    const secondPayload = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(secondPayload.data.responseId).toBe("resp-ask-2")
    expect(secondPayload.data.scopeFingerprint).toBe("scope:test")
    expect(providerFetch).toHaveBeenCalledTimes(2)
  })

  it("drops a stale Ask response id when the explicit scope fingerprint changed", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body))
      expect(requestBody.previous_response_id).toBeUndefined()
      return providerResponse({
        id: "resp-fresh-scope",
        object: "response",
        model: "gpt-5.6-luna",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
          answer: "Fresh scope.", evidence: [], requestedDocumentIds: [], suggestedAction: null, scopeStatus: "ready",
        }) }] }],
        usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
      })
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await askPOST(new Request("https://app.odessay.com/api/ai/workspace-ask", {
      method: "POST",
      body: JSON.stringify({
        ...askBody,
        scopeFingerprint: "scope:new",
        previousResponseId: "resp-old-scope",
        previousScopeFingerprint: "scope:old",
      }),
    }))

    expect(response.status).toBe(200)
    expect(providerFetch).toHaveBeenCalledTimes(1)
  })

  it("does not promote model-guessed documents or evidence when the request has no scope", async () => {
    const providerFetch = vi.fn(async () => providerResponse({
      id: "resp-no-scope",
      object: "response",
      model: "gpt-5.6-luna",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
        answer: "I need the publication document to answer that.",
        evidence: [{ documentId: "guessed-doc", quote: "invented quote", reason: "not authorized" }],
        requestedDocumentIds: ["guessed-doc"],
        suggestedAction: null,
        scopeStatus: "ready",
      }) }] }],
      usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
    }))
    vi.stubGlobal("fetch", providerFetch)

    const response = await askPOST(new Request("https://app.odessay.com/api/ai/workspace-ask", {
      method: "POST",
      body: JSON.stringify(askBody),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.evidence).toEqual([])
    expect(payload.data.requestedDocumentIds).toEqual([])
    expect(payload.data.scopeStatus).toBe("needs_scope")
  })
})
