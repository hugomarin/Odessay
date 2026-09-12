// class: detail (named relation-review adapter over the shared semantic round)
export const runtime = "nodejs"
export const maxDuration = 60

import { OPTIONS as semanticRoundOptions, POST as semanticRoundPost } from "@/app/api/ai/workspace-semantic-round/route"

/**
 * Keeps relation review discoverable as its own AIService capability while
 * delegating auth, provider transport, receipts and output normalization to
 * the single shared semantic-round route. There is intentionally no second
 * provider-specific orchestration path here.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const input = typeof body === "object" && body !== null && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), operation: "relations" }
    : { operation: "relations" }
  const forwarded = new Request(request.url, {
    method: "POST",
    headers: new Headers(request.headers),
    body: JSON.stringify(input),
  })
  return semanticRoundPost(forwarded)
}

export async function OPTIONS(request: Request) {
  return semanticRoundOptions(request)
}
