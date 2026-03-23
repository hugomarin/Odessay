import { generateHTML } from "@tiptap/core"
import Blockquote from "@tiptap/extension-blockquote"
import Bold from "@tiptap/extension-bold"
import BulletList from "@tiptap/extension-bullet-list"
import Code from "@tiptap/extension-code"
import CodeBlock from "@tiptap/extension-code-block"
import Document from "@tiptap/extension-document"
import Heading from "@tiptap/extension-heading"
import Highlight from "@tiptap/extension-highlight"
import Italic from "@tiptap/extension-italic"
import Link from "@tiptap/extension-link"
import ListItem from "@tiptap/extension-list-item"
import OrderedList from "@tiptap/extension-ordered-list"
import Paragraph from "@tiptap/extension-paragraph"
import Strike from "@tiptap/extension-strike"
import Text from "@tiptap/extension-text"
import type { JSONContent } from "@tiptap/core"
import { z } from "zod"
import { FootnoteExtension } from "@/lib/editor/footnote-extension"
import { isTestLinkEmail } from "@/lib/sharing/test-link"

const PREVIEW_EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  Strike,
  Highlight,
  Link.configure({ openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] }),
  Blockquote,
  BulletList,
  OrderedList,
  ListItem,
  Code,
  CodeBlock,
  FootnoteExtension,
]

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
  body_text: string
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

export const getPreviewWritingFromTestLink = async (rawToken: string): Promise<TestLinkAccessResult> => {
  const token = normalizeTestLinkToken(rawToken)

  if (!token) {
    return { state: "not-found" }
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
      token,
      error: invitationError.message,
    })
    return { state: "unavailable" }
  }

  const invitationState = getTestLinkInvitationState(invitation)

  if (invitationState !== "ok" || !invitation || !invitation.writing_id) {
    return { state: invitationState === "not-found" ? "not-found" : "revoked" }
  }

  const activeInvitation = invitation

  const { data: writing, error: writingError } = await supabase
    .from("writings")
    .select("id, author_id, title, body_json, body_text, status, visibility, created_at, updated_at")
    .eq("id", activeInvitation.writing_id)
    .is("deleted_at", null)
    .maybeSingle<WritingRow>()

  if (writingError) {
    console.error("[sharing:test-link-access:writing]", {
      writingId: activeInvitation.writing_id,
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
      authorId: writing.author_id,
      error: authorProfileError.message,
    })
    return { state: "unavailable" }
  }

  let bodyHtml: string
  try {
    bodyHtml = generateHTML(writing.body_json as JSONContent, PREVIEW_EXTENSIONS)
  } catch (err) {
    console.error("[sharing:test-link-access:generateHTML]", {
      writingId: writing.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return { state: "unavailable" }
  }

  return {
    state: "ok",
    writing: {
      id: writing.id,
      title: writing.title?.trim() || "Untitled writing",
      bodyHtml,
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
