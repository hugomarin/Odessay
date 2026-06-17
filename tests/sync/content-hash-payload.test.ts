import { describe, expect, it } from "vitest"
import type { LocalWriting } from "@/lib/local-db/schema"
import { toRemotePayload } from "@/lib/sync/queue"

const createWriting = (): LocalWriting => ({
  id: "writing-1",
  title: "Hash parity",
  body_json: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Body" }],
      },
    ],
  },
  body_text: "Body",
  status: "draft",
  visibility: "private",
  version: 1,
  sync_status: "pending",
  lifecycle: "local-only",
  created_at: "2026-06-17T00:00:00.000Z",
  updated_at: "2026-06-17T00:00:00.000Z",
  local_updated_at: 1,
})

describe("sync payload content_hash", () => {
  it("writes a BLAKE3 content_hash into cloud writing payloads", async () => {
    const payload = await toRemotePayload(createWriting())

    expect(payload.content_hash).toMatch(/^blake3:[0-9a-f]{64}$/)
  })

  it("preserves an existing local content_hash instead of rehashing", async () => {
    const payload = await toRemotePayload({
      ...createWriting(),
      content_hash: "blake3:4796db1ca6452aa029b47b20463f02abb6d625bd164f5734d8c527fe330f7904",
    })

    expect(payload.content_hash).toBe(
      "blake3:4796db1ca6452aa029b47b20463f02abb6d625bd164f5734d8c527fe330f7904",
    )
  })
})
