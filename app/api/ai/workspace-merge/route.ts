// class: detail (named merge-synthesis adapter over the shared semantic round)
export const runtime = "nodejs"
export const maxDuration = 60

import { OPTIONS as semanticRoundOptions, POST as semanticRoundPost } from "@/app/api/ai/workspace-semantic-round/route"

/**
 * Keeps merge discoverable as a named AIService capability while delegating
 * auth, provider transport, receipts and output normalization to the shared
 * semantic-round route.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const input = typeof body === "object" && body !== null && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), operation: "merge" }
    : { operation: "merge" }
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
