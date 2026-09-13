import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getPreviewWritingFromTestLink,
  getTestLinkInvitationState,
  normalizeTestLinkToken,
  renderPreviewBodyHtml,
} from "@/lib/sharing/test-link-access"
import { getTestLinkEmail } from "@/lib/sharing/test-link"

type TableResponse = { data: unknown; error: { message: string } | null }

const tableResponses = vi.hoisted(() => new Map<string, TableResponse>())

function makeChain(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: async () => tableResponses.get(table) ?? { data: null, error: null },
  }
  return chain
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeChain(table),
  }),
}))

describe("test link access guards", () => {
  afterEach(() => {
    delete process.env.ODE_TEST_LINK_FIXTURES
  })

  it("normalizes valid tokens and rejects malformed tokens", () => {
    expect(normalizeTestLinkToken("  validToken_123-456  ")).toBe("validToken_123-456")
    expect(normalizeTestLinkToken("bad token with spaces")).toBeNull()
    expect(normalizeTestLinkToken("short")).toBeNull()
  })

  it("classifies invitation state for preview access", () => {
    const markerEmail = getTestLinkEmail("writing-42")

    expect(getTestLinkInvitationState(null)).toBe("not-found")
    expect(
      getTestLinkInvitationState({
        email: "invite@example.com",
        status: "pending",
        writing_id: "writing-42",
      }),
    ).toBe("not-found")

    expect(
      getTestLinkInvitationState({
        email: markerEmail,
        status: "expired",
        writing_id: "writing-42",
      }),
    ).toBe("revoked")

    expect(
      getTestLinkInvitationState({
        email: markerEmail,
        status: "pending",
        writing_id: null,
      }),
    ).toBe("revoked")

    expect(
      getTestLinkInvitationState({
        email: markerEmail,
        status: "pending",
        writing_id: "writing-42",
      }),
    ).toBe("ok")
  })

  it("renders rich html when renderer succeeds", () => {
    const rendered = renderPreviewBodyHtml(
      {
        body_json: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Rich body" }] }],
        },
        body_text: "Rich body",
      },
      {
        renderRichHtml: () => "<p>Rich body</p>",
      },
    )

    expect(rendered.mode).toBe("rich")
    expect(rendered.bodyHtml).toBe("<p>Rich body</p>")
  })

  it("renders table html in rich preview bodies", () => {
    const rendered = renderPreviewBodyHtml({
      body_json: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
                  },
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }],
                  },
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      body_text: "A B 1 2",
    })

    expect(rendered.mode).toBe("rich")
    expect(rendered.bodyHtml).toContain("odessay-table-wrap")
    expect(rendered.bodyHtml).toContain("prose-odessay-table-wrap")
    expect(rendered.bodyHtml).toContain("<table")
    expect(rendered.bodyHtml).toContain("<th")
    expect(rendered.bodyHtml).toContain("<td")
  })

  it("falls back to escaped plain text html when rich rendering fails", () => {
    const errors: string[] = []

    const rendered = renderPreviewBodyHtml(
      {
        body_json: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "unsafe <script>" }] }],
        },
        body_text: "unsafe <script>\nnext line",
      },
      {
        renderRichHtml: () => {
          throw new Error("window is not defined")
        },
        onRichRenderError: (message) => errors.push(message),
      },
    )

    expect(rendered.mode).toBe("plain-text")
    expect(rendered.bodyHtml).toContain("&lt;script&gt;")
    expect(rendered.bodyHtml).toContain("next line")
    expect(errors).toEqual(["window is not defined"])
  })
})

describe("getPreviewWritingFromTestLink (ODE-520)", () => {
  const token = "ownershipCheckToken0001"
  const markerEmail = getTestLinkEmail("writing-owned-by-a")

  beforeEach(() => {
    tableResponses.clear()
  })

  it("denies a forged historical row whose inviter does not own the writing, as not-found", async () => {
    tableResponses.set("invitations", {
      data: {
        id: "invitation-1",
        inviter_id: "attacker-b",
        writing_id: "writing-owned-by-a",
        email: markerEmail,
        status: "pending",
      },
      error: null,
    })
    tableResponses.set("writings", {
      data: {
        id: "writing-owned-by-a",
        author_id: "owner-a",
        title: "A's writing",
        body_json: {},
        body_text: "",
        status: "draft",
        visibility: "private",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    })

    const result = await getPreviewWritingFromTestLink(token)

    expect(result.state).toBe("not-found")
  })

  it("resolves the writing when the inviter genuinely owns it", async () => {
    tableResponses.set("invitations", {
      data: {
        id: "invitation-2",
        inviter_id: "owner-a",
        writing_id: "writing-owned-by-a",
        email: markerEmail,
        status: "pending",
      },
      error: null,
    })
    tableResponses.set("writings", {
      data: {
        id: "writing-owned-by-a",
        author_id: "owner-a",
        title: "A's writing",
        body_json: {},
        body_text: "",
        status: "draft",
        visibility: "private",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    })
    tableResponses.set("profiles", {
      data: { display_name: "Owner A", username: "ownera" },
      error: null,
    })

    const result = await getPreviewWritingFromTestLink(token)

    expect(result.state).toBe("ok")
    if (result.state === "ok") {
      expect(result.writing.id).toBe("writing-owned-by-a")
      expect(result.writing.author.id).toBe("owner-a")
    }
  })
})
