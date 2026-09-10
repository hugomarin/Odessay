import { describe, expect, it, vi } from "vitest"

const forwardedBody = vi.hoisted(() => ({ value: "" }))
const semanticRoundPost = vi.hoisted(() => vi.fn(async (request: Request) => {
  forwardedBody.value = await request.text()
  return new Response(forwardedBody.value, { status: 200 })
}))
const semanticRoundOptions = vi.hoisted(() => vi.fn(async () => new Response(null, { status: 204 })))

vi.mock("@/app/api/ai/workspace-semantic-round/route", () => ({
  OPTIONS: semanticRoundOptions,
  POST: semanticRoundPost,
}))

import { OPTIONS, POST } from "@/app/api/ai/workspace-merge/route"

describe("/api/ai/workspace-merge", () => {
  it("delegates to the shared semantic round with a forced merge operation", async () => {
    const request = new Request("https://app.odessay.test/api/ai/workspace-merge", {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ operation: "relations", input: [{ type: "message", role: "user", content: "Synthesize claims." }], tools: [] }),
    })

    await POST(request)

    expect(semanticRoundPost).toHaveBeenCalledTimes(1)
    const forwarded = semanticRoundPost.mock.calls[0]?.[0] as Request
    expect(forwarded.headers.get("authorization")).toBe("Bearer token")
    expect(JSON.parse(forwardedBody.value)).toMatchObject({ operation: "merge" })
  })

  it("preserves the shared CORS preflight path", async () => {
    const request = new Request("https://app.odessay.test/api/ai/workspace-merge", { method: "OPTIONS" })
    await OPTIONS(request)
    expect(semanticRoundOptions).toHaveBeenCalledWith(request)
  })
})
