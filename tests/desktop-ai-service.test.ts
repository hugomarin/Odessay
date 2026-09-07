import { beforeEach, describe, expect, it, vi } from "vitest"
import { desktopAIService } from "@/lib/services/desktop-ai-service"

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({ auth: authMock }),
}))

const classificationInput = {
  request: "Review this artifact.",
  targetDocumentIds: ["doc-1"],
  documents: [{
    id: "doc-1",
    title: "Prompt",
    relativePath: "prompt.md",
    currentArtifactType: "general",
    currentStatus: "draft",
    visibility: "private",
    version: 1,
    modifiedAt: 1_800_000_000_000,
    excerpt: "Ask for context.",
    references: [],
    markdown: "Ask for context.",
  }],
  collections: [],
  documentCollectionIds: {},
  annotations: [],
  vocabulary: [{
    kind: "type" as const,
    key: "prompt",
    name: "Prompt",
    description: "A reusable instruction.",
    isRequired: false,
  }, {
    kind: "status" as const,
    key: "draft",
    name: "Draft",
    description: "Readable end to end.",
    isRequired: true,
  }],
  workflowMarkdown: null,
  catalogTruncated: false,
}

describe("desktopAIService workspace classification", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    authMock.getSession.mockReset()
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.odessay.test")
  })

  it("proxies the selected context with the desktop session and maps the result", async () => {
    authMock.getSession.mockResolvedValue({ data: { session: { access_token: "desktop-token" } }, error: null })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: {
        summary: "The artifact is a prompt.",
        proposals: [],
        requestedDocumentIds: [],
        model: "gpt-5.6-luna",
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
        latencyMs: 200,
      },
      error: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await desktopAIService.classifyWorkspace(classificationInput)
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    const [url, init] = fetchCalls[0] ?? []

    expect(url).toBe("https://app.odessay.test/api/ai/workspace-classification")
    expect(init?.headers).toMatchObject({ authorization: "Bearer desktop-token" })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      targetDocumentIds: ["doc-1"],
      documents: [expect.objectContaining({ markdown: "Ask for context." })],
    })
    expect(result).toMatchObject({
      data: {
        summary: "The artifact is a prompt.",
        usage: { model: "gpt-5.6-luna", totalTokens: 20, latencyMs: 200 },
      },
      error: null,
    })
  })

  it("fails closed when the desktop session has no access token", async () => {
    authMock.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await desktopAIService.classifyWorkspace(classificationInput)

    expect(result.error).toMatchObject({ code: "UNAUTHORIZED", retryable: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
