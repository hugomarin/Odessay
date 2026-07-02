import { afterEach, describe, expect, it } from "vitest"
import { getTestLinkInvitationState, normalizeTestLinkToken, renderPreviewBodyHtml } from "@/lib/sharing/test-link-access"
import { getTestLinkEmail } from "@/lib/sharing/test-link"

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
