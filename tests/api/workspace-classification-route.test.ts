import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/ai/workspace-classification/route"

const authMock = vi.hoisted(() => ({
  getCurrentUserFromRequest: vi.fn(),
}))

const providerMock = vi.hoisted(() => ({
  getAIProviderConfig: vi.fn(),
}))

vi.mock("@/lib/supabase/request-auth", () => authMock)
vi.mock("@/lib/ai/provider-config", () => providerMock)

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
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 220, completion_tokens: 160, total_tokens: 380 },
      })
    : content,
  { status, headers: { "content-type": "application/json" } },
)

describe("POST /api/ai/workspace-classification", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    authMock.getCurrentUserFromRequest.mockReset()
    providerMock.getAIProviderConfig.mockReset()
    authMock.getCurrentUserFromRequest.mockResolvedValue({ userId: "user-1" })
    providerMock.getAIProviderConfig.mockReturnValue({
      baseUrl: "https://provider.test",
      apiKey: "test-key",
      model: "test-model",
      chatCompletionsUrl: "https://provider.test/chat/completions",
      maxTokens: 4_096,
      topP: 0.95,
    })
  })

  it("sends bounded document context and returns an evidence-backed semantic proposal", async () => {
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.max_tokens).toBe(8_192)
      expect(body.reasoning_effort).toBe("none")
      expect(body.response_format).toMatchObject({
        type: "json_schema",
        json_schema: {
          name: "WorkspaceClassificationResponse",
          schema: { required: ["summary", "proposals", "requestedDocumentIds"] },
        },
      })
      expect(body.messages[0].content).toContain("Similarity")
      expect(body.messages[1].content).toContain("We use SQLite for the desktop catalog.")
      expect(body.messages[1].content).toContain("A draft can be read end to end.")

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
      model: "test-model",
      promptTokens: 220,
      completionTokens: 160,
      totalTokens: 380,
      proposals: [expect.objectContaining({ documentId: "doc-1", decision: "keep" })],
    })
  })

  it("retries without response_format when the provider rejects structured output", async () => {
    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(providerResponse("schema invalid", 400))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body))
        expect(body.response_format).toBeUndefined()
        return providerResponse(JSON.stringify({
          summary: "No change is justified.",
          proposals: [],
          requestedDocumentIds: ["doc-2"],
        }))
      })
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(payload.data.requestedDocumentIds).toEqual(["doc-2"])
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
    providerMock.getAIProviderConfig.mockImplementationOnce(() => {
      throw new Error("Missing FIREWORKS_API_KEY")
    })
    const providerFetch = vi.fn()
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).toMatchObject({
      code: "MISSING_CONFIG",
      message: "Missing FIREWORKS_API_KEY",
      retryable: false,
    })
    expect(providerFetch).not.toHaveBeenCalled()
  })
})
