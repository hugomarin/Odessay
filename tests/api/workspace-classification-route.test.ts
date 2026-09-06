import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/ai/workspace-classification/route"

const authMock = vi.hoisted(() => ({
  getCurrentUserFromRequest: vi.fn(),
}))

const providerMock = vi.hoisted(() => ({
  getOpenAIWorkspaceProviderConfig: vi.fn(),
}))

vi.mock("@/lib/supabase/request-auth", () => authMock)
vi.mock("@/lib/ai/openai-workspace-provider-config", () => providerMock)

const requestBody = {
  request: "Review the selected artifact and propose type/status only when there is a concrete improvement.",
  targetDocumentIds: ["doc-1"],
  documents: [
    {
      id: "doc-1",
      title: "SQLite decision",
      relativePath: "decisions/sqlite.md",
      currentArtifactType: "general",
      currentStatus: "draft",
      visibility: "private",
      version: 3,
      modifiedAt: 1_800_000_000_000,
      excerpt: "Storage decision.",
      references: [{ value: "workflow.md", kind: "path" }],
      markdown: "# Storage decision\n\nWe use SQLite for the desktop catalog.",
    },
    {
      id: "doc-2",
      title: "Old notes",
      relativePath: "notes/old.md",
      currentArtifactType: "general",
      currentStatus: "exploring",
      visibility: "private",
      version: 1,
      modifiedAt: 1_700_000_000_000,
      excerpt: "Historical notes.",
      references: [],
      markdown: null,
    },
  ],
  collections: [{ id: "collection-1", name: "Decisions", description: "Accepted decisions", writingsCount: 1 }],
  documentCollectionIds: { "doc-1": ["collection-1"] },
  annotations: [],
  vocabulary: [
    { kind: "type", key: "general", name: "General", description: "The default shape.", isRequired: false },
    { kind: "status", key: "draft", name: "Draft", description: "Readable end to end.", isRequired: true },
  ],
  workflowMarkdown: "# Workflow\n\nA draft can be read end to end.",
  catalogTruncated: false,
}

const createRequest = (body: Record<string, unknown> = {}) => new Request(
  "https://app.odessay.com/api/ai/workspace-classification",
  {
    method: "POST",
    body: JSON.stringify({ ...requestBody, ...body }),
  },
)

const providerResponse = (content: string, status = 200) => new Response(
  status === 200
    ? JSON.stringify({
        id: "resp_test",
        object: "response",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: content }],
        }],
        usage: { input_tokens: 220, output_tokens: 160, total_tokens: 380 },
      })
    : content,
  { status, headers: { "content-type": "application/json" } },
)

describe("POST /api/ai/workspace-classification", () => {
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

  it("sends bounded document context and returns an evidence-backed semantic proposal", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(_url).toBe("https://api.openai.com/v1/responses")
      expect(body.max_output_tokens).toBe(8_192)
      expect(body.reasoning).toEqual({ effort: "none" })
      expect(body.store).toBe(false)
      expect(body.text.format).toMatchObject({
        type: "json_schema",
        name: "WorkspaceClassificationResponse",
        schema: { required: ["summary", "proposals", "requestedDocumentIds"] },
        strict: true,
      })
      expect(body.input[0].content).toContain("Similarity")
      expect(body.input[1].content).toContain("We use SQLite for the desktop catalog.")
      expect(body.input[1].content).toContain("A draft can be read end to end.")

      return providerResponse(JSON.stringify({
        summary: "The current classification fits the document's purpose and progress.",
        proposals: [{
          documentId: "doc-1",
          decision: "keep",
          proposedArtifactType: "general",
          proposedStatus: "draft",
          change: "Keep General / Draft.",
          rationale: "The heading and decision statement describe a readable product decision.",
          benefit: "Avoids metadata churn while keeping the catalog truthful.",
          uncertainty: null,
          evidence: [{
            documentId: "doc-1",
            quote: "We use SQLite for the desktop catalog.",
            reason: "The body states the artifact's concrete purpose.",
          }],
        }],
        requestedDocumentIds: [],
      }))
    })
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(payload.error).toBeNull()
    expect(payload.data).toMatchObject({
      summary: "The current classification fits the document's purpose and progress.",
      model: "gpt-5.6-luna",
      promptTokens: 220,
      completionTokens: 160,
      totalTokens: 380,
      proposals: [expect.objectContaining({ documentId: "doc-1", decision: "keep" })],
    })
  })

  it("returns an OpenAI contract error without falling back to Fireworks", async () => {
    const providerFetch = vi.fn(async () => providerResponse("schema invalid", 400))
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(422)
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(payload.error).toMatchObject({
      code: "AI_PROVIDER_CONTRACT_ERROR",
      retryable: false,
    })
  })

  it("does not call the provider without a session", async () => {
    authMock.getCurrentUserFromRequest.mockResolvedValueOnce({ userId: null })
    const providerFetch = vi.fn()
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(providerFetch).not.toHaveBeenCalled()
    expect(payload.error.code).toBe("UNAUTHORIZED")
  })

  it("does not expose provider error bodies", async () => {
    const providerFetch = vi.fn(async () => providerResponse("provider secret stack trace", 502))
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.error.message).not.toContain("secret")
    expect(payload.error.details.providerStatus).toBe(502)
  })

  it("returns a non-retryable configuration error without calling the provider", async () => {
    providerMock.getOpenAIWorkspaceProviderConfig.mockImplementationOnce(() => {
      throw new Error("Missing OPENAI_API_KEY environment variable.")
    })
    const providerFetch = vi.fn()
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).toMatchObject({
      code: "MISSING_CONFIG",
      message: "Missing OPENAI_API_KEY environment variable.",
      retryable: false,
    })
    expect(providerFetch).not.toHaveBeenCalled()
  })
})
