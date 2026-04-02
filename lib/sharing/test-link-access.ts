import { createHash } from "node:crypto"
import type { JSONContent } from "@tiptap/core"
import { z } from "zod"
import { isTestLinkEmail } from "@/lib/sharing/test-link"
import { renderWritingBodyHtml } from "@/lib/reading/render-body-html"

type InvitationRow = {
  id: string
  inviter_id: string
  writing_id: string | null
  email: string
  status: "pending" | "accepted" | "expired"
}

type WritingRow = {
  id: string
  author_id: string
  title: string | null
  body_json: Record<string, unknown>
  body_text: string | null
  status: "draft" | "finished"
  visibility: "private" | "shared" | "public"
  created_at: string
  updated_at: string
}

const testLinkTokenSchema = z
  .string()
  .trim()
  .min(16)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/)

export const normalizeTestLinkToken = (rawToken: string) => {
  const parsed = testLinkTokenSchema.safeParse(rawToken)
  return parsed.success ? parsed.data : null
}

export type TestLinkInvitationState = "ok" | "not-found" | "revoked"

export const getTestLinkInvitationState = (
  invitation: Pick<InvitationRow, "email" | "status" | "writing_id"> | null,
): TestLinkInvitationState => {
  if (!invitation) {
    return "not-found"
  }

  if (!isTestLinkEmail(invitation.email)) {
    return "not-found"
  }

  if (invitation.status !== "pending" || !invitation.writing_id) {
    return "revoked"
  }

  return "ok"
}

export type PreviewWriting = {
  id: string
  title: string
  bodyHtml: string
  status: "draft" | "finished"
  visibility: "private" | "shared" | "public"
  createdAt: string
  updatedAt: string
  author: {
    id: string
    displayName: string | null
    username: string | null
  }
}

export type TestLinkAccessResult =
  | { state: "ok"; writing: PreviewWriting }
  | { state: "not-found" }
  | { state: "revoked" }
  | { state: "unavailable" }

const TEST_LINK_FIXTURE_ENABLED = process.env.ODE_TEST_LINK_FIXTURES === "1"

const PREVIEW_FIXTURE_BODY_JSON: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Preview fixture heading" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Preview fixture " },
        { type: "text", text: "content", marks: [{ type: "bold" }] },
        { type: "text", text: " with a table and a list." },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "First bullet" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Second bullet" }] }],
        },
      ],
    },
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
}

const TEST_LINK_FIXTURE_RESPONSES: Record<string, TestLinkAccessResult> = {
  fixturepreviewoktoken0001: {
    state: "ok",
    writing: {
      id: "fixture-writing-id",
      title: "Fixture Preview",
      bodyHtml: renderWritingBodyHtml(PREVIEW_FIXTURE_BODY_JSON, "Preview fixture content").bodyHtml,
      status: "draft",
      visibility: "private",
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
      author: {
        id: "fixture-author-id",
        displayName: "Fixture Author",
        username: "fixture-author",
      },
    },
  },
  fixturepreviewnotfound0001: { state: "not-found" },
  fixturepreviewrevokedtoken001: { state: "revoked" },
  fixturepreviewunavailable001: { state: "unavailable" },
}

const getPreviewFixtureResponse = (token: string): TestLinkAccessResult | null => {
  if (!TEST_LINK_FIXTURE_ENABLED) {
    return null
  }

  return TEST_LINK_FIXTURE_RESPONSES[token] ?? { state: "not-found" }
}

const hashForLog = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12)
const sanitizeIdForLog = (value: string) => (value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`)

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const renderPlainTextPreviewHtml = (bodyText: string | null) => {
  const normalized = (bodyText ?? "").replaceAll("\r\n", "\n").trim()

  if (!normalized) {
    return "<p></p>"
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br />")}</p>`)

  return paragraphs.length > 0 ? paragraphs.join("") : "<p></p>"
}

type PreviewHtmlRenderResult = {
  bodyHtml: string
  mode: "rich" | "plain-text"
}

type PreviewHtmlRenderOptions = {
  renderRichHtml?: (bodyJson: JSONContent) => string
  onRichRenderError?: (errorMessage: string) => void
}

export const renderPreviewBodyHtml = (
  writing: Pick<WritingRow, "body_json" | "body_text">,
  options: PreviewHtmlRenderOptions = {},
): PreviewHtmlRenderResult => {
  const rendered = renderWritingBodyHtml(writing.body_json, writing.body_text, {
    renderRichHtml: options.renderRichHtml,
    onRichRenderError: options.onRichRenderError,
  })

  return rendered.mode === "rich"
    ? rendered
    : {
        bodyHtml: renderPlainTextPreviewHtml(writing.body_text),
        mode: "plain-text",
      }
}

export const getPreviewWritingFromTestLink = async (rawToken: string): Promise<TestLinkAccessResult> => {
  const token = normalizeTestLinkToken(rawToken)

  if (!token) {
    return { state: "not-found" }
  }

  const fixtureResult = getPreviewFixtureResponse(token)
  if (fixtureResult) {
    return fixtureResult
  }

  const { createAdminClient } = await import("@/lib/supabase/admin")
  const supabase = createAdminClient()

  const { data: invitation, error: invitationError } = await supabase
    .from("invitations")
    .select("id, inviter_id, writing_id, email, status")
    .eq("token", token)
    .maybeSingle<InvitationRow>()

  if (invitationError) {
    console.error("[sharing:test-link-access:invitation]", {
      tokenFingerprint: hashForLog(token),
      error: invitationError.message,
    })
    return { state: "unavailable" }
  }

  const invitationState = getTestLinkInvitationState(invitation)

  if (invitationState !== "ok" || !invitation || !invitation.writing_id) {
    return { state: invitationState === "not-found" ? "not-found" : "revoked" }
  }

  const activeInvitation = invitation as InvitationRow & { writing_id: string }

  const { data: writing, error: writingError } = await supabase
    .from("writings")
    .select("id, author_id, title, body_json, body_text, status, visibility, created_at, updated_at")
    .eq("id", activeInvitation.writing_id)
    .is("deleted_at", null)
    .maybeSingle<WritingRow>()

  if (writingError) {
    console.error("[sharing:test-link-access:writing]", {
      tokenFingerprint: hashForLog(token),
      writingRef: sanitizeIdForLog(activeInvitation.writing_id),
      error: writingError.message,
    })
    return { state: "unavailable" }
  }

  if (!writing) {
    return { state: "revoked" }
  }

  const { data: authorProfile, error: authorProfileError } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", writing.author_id)
    .maybeSingle<{ display_name: string | null; username: string | null }>()

  if (authorProfileError) {
    console.error("[sharing:test-link-access:profile]", {
      writingRef: sanitizeIdForLog(writing.id),
      authorRef: sanitizeIdForLog(writing.author_id),
      error: authorProfileError.message,
    })
    return { state: "unavailable" }
  }

  const renderedBody = renderPreviewBodyHtml(writing, {
    onRichRenderError: (errorMessage) => {
      console.warn("[sharing:test-link-access:render-fallback]", {
        tokenFingerprint: hashForLog(token),
        writingRef: sanitizeIdForLog(writing.id),
        fallback: "plain-text",
        reason: errorMessage,
      })
    },
  })

  return {
    state: "ok",
    writing: {
      id: writing.id,
      title: writing.title?.trim() || "Untitled writing",
      bodyHtml: renderedBody.bodyHtml,
      status: writing.status,
      visibility: writing.visibility,
      createdAt: writing.created_at,
      updatedAt: writing.updated_at,
      author: {
        id: writing.author_id,
        displayName: authorProfile?.display_name ?? null,
        username: authorProfile?.username ?? null,
      },
    },
  }
}
