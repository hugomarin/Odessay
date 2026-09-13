import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/ai/title-suggestions/route"

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

const providerConfigMock = vi.hoisted(() => ({
  getAIProviderConfig: vi.fn(),
}))

const admissionMock = vi.hoisted(() => ({
  tryAcquireAiAdmission: vi.fn(),
  releaseAiAdmission: vi.fn(),
  logAiAdmissionEvent: vi.fn(),
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

vi.mock("@/lib/ai/admission", () => admissionMock)

const createRequest = (body: Record<string, unknown> = {}) =>
  new Request("https://app.odessay.com/api/ai/title-suggestions", {
    method: "POST",
    body: JSON.stringify({
      currentTitle: "Untitled artifact",
      bodyText: "This is a sufficiently long draft body to justify asking for a title suggestion from the model.",
      ...body,
    }),
  })

const successResponse = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: '{"title":"A Great Title"}' } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )

describe("POST /api/ai/title-suggestions", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    supabaseMock.getUser.mockReset()
    admissionMock.tryAcquireAiAdmission.mockReset()
    admissionMock.releaseAiAdmission.mockReset()
    admissionMock.tryAcquireAiAdmission.mockResolvedValue({ admitted: true, leaseId: "lease-1" })
    providerConfigMock.getAIProviderConfig.mockReset()
    providerConfigMock.getAIProviderConfig.mockReturnValue({
      baseUrl: "https://provider.test",
      apiKey: "test-key",
      model: "test-model",
      chatCompletionsUrl: "https://provider.test/chat/completions",
      maxTokens: 1000,
      topP: 0.95,
    })
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
  })

  it("returns 401 without calling admission or the provider when there is no session", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } })
    const providerFetch = vi.fn()
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest())

    expect(response.status).toBe(401)
    expect(admissionMock.tryAcquireAiAdmission).not.toHaveBeenCalled()
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it("suggests a title and releases the admission lease on success", async () => {
    const providerFetch = vi.fn(async () => successResponse())
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toMatchObject({ title: "A Great Title" })
    expect(admissionMock.tryAcquireAiAdmission).toHaveBeenCalledWith({
      accountId: "user-1",
      routeKey: "title-suggestions",
    })
    expect(admissionMock.releaseAiAdmission).toHaveBeenCalledWith("lease-1")
  })

  it("returns 429 with Retry-After and never calls the provider when admission is rejected", async () => {
    admissionMock.tryAcquireAiAdmission.mockResolvedValue({
      admitted: false,
      reason: "rate_limited",
      retryAfterSeconds: 15,
    })
    const providerFetch = vi.fn()
    vi.stubGlobal("fetch", providerFetch)

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("15")
    expect(payload.error.code).toBe("RATE_LIMITED")
    expect(providerFetch).not.toHaveBeenCalled()
    expect(admissionMock.releaseAiAdmission).not.toHaveBeenCalled()
  })

  it("releases the lease and returns 504 when the provider call times out", async () => {
    const abortError = new Error("The operation was aborted")
    abortError.name = "AbortError"
    vi.stubGlobal("fetch", vi.fn(async () => { throw abortError }))

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(504)
    expect(payload.error.code).toBe("AI_REQUEST_FAILED")
    expect(admissionMock.releaseAiAdmission).toHaveBeenCalledWith("lease-1")
  })

  it("releases the lease even when the provider returns an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })))

    const response = await POST(createRequest())
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload.error.code).toBe("AI_REQUEST_FAILED")
    expect(admissionMock.releaseAiAdmission).toHaveBeenCalledWith("lease-1")
  })
})
