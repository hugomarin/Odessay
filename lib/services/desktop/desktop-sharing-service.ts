import { createDesktopClient } from "@/lib/supabase/desktop-client"
import type {
  PreviewLinkState,
  ShareRecipient,
  SharedWritingListItem,
  SharingService,
} from "@/lib/services/contracts/sharing-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"

// Desktop sharing service.
//
// In the Tauri static export the Next.js API routes do not run — `/api/*`
// requests fall back to the SPA index.html (HTTP 200 with HTML), which the
// fetch-based browser service cannot parse ("Unexpected sharing service
// response."). This implementation talks to Supabase directly using the
// authenticated desktop client for read paths, and bridges share mutations
// through the authenticated web routes via absolute NEXT_PUBLIC_APP_URL fetches
// + Bearer token.
//
// RLS makes the read paths safe without the service-role key:
//   - writing_shares_select_related: a user can read shares where
//     shared_with_id = auth.uid().
//   - writings_select_accessible (can_read_writing): a user can read writings
//     shared with them.
//   - profiles_select_public: profiles are world-readable.

const MAX_BATCH_SHARE_IDS = 50

type DesktopSupabaseClient = ReturnType<typeof createDesktopClient>
type RawAuthorProfile = { username: string; display_name: string } | null
type RecipientPreview = {
  username: string
  displayName: string
}

type UserSearchResult = {
  id: string
  username: string
  display_name: string
}

type DesktopSharingService = SharingService & {
  listRecipientPreviews(writingIds: string[]): Promise<ServiceResponse<Record<string, RecipientPreview[]>>>
  searchUsers(query: string): Promise<ServiceResponse<UserSearchResult[]>>
}

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(error: ServiceError): ServiceResponse<T> {
  return { data: null, error }
}

function makeError(code: ServiceError["code"], message: string, retryable = false): ServiceError {
  return { code, message, retryable }
}

function unavailable<T>(message = "Sharing actions are only available on the web app."): ServiceResponse<T> {
  return err(makeError("UNAVAILABLE", message, false))
}

function getWebRuntimeBaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_APP_URL
  return url ? url.replace(/\/$/, "") : null
}

async function getBearerToken(supabase: DesktopSupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession()

    if (error || !data.session) {
      return null
    }

    return data.session.access_token
  } catch {
    return null
  }
}

type RouteInit = RequestInit & { expectedStatus?: number | number[] }

async function callWebRoute<T>(
  supabase: DesktopSupabaseClient,
  routePath: string,
  init: RouteInit,
  fallbackMessage: string,
): Promise<ServiceResponse<T>> {
  const baseUrl = getWebRuntimeBaseUrl()
  if (!baseUrl) {
    return unavailable("This action is unavailable because NEXT_PUBLIC_APP_URL is not configured.")
  }

  const token = await getBearerToken(supabase)
  if (!token) {
    return err(makeError("UNAUTHORIZED", "No active session.", false))
  }

  const expectedStatuses = Array.isArray(init.expectedStatus)
    ? init.expectedStatus
    : [init.expectedStatus ?? 200]

  try {
    const response = await fetch(`${baseUrl}${routePath}`, {
      ...init,
      headers: {
        "authorization": `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    })

    if (expectedStatuses.includes(response.status) && response.status === 204) {
      return ok(undefined as T)
    }

    let envelope: { data: T | null; error: { code: string; message: string } | null } | null = null

    try {
      envelope = (await response.json()) as { data: T | null; error: { code: string; message: string } | null }
    } catch {
      envelope = null
    }

    if (!response.ok || !envelope?.data || envelope.error) {
      return err({
        code: (envelope?.error?.code as ServiceError["code"] | undefined) ?? "UNAVAILABLE",
        message: envelope?.error?.message ?? fallbackMessage,
        retryable: response.status >= 500,
      })
    }

    return ok(envelope.data)
  } catch {
    return unavailable(fallbackMessage)
  }
}

async function callPreviewLinkRoute<T>(
  supabase: DesktopSupabaseClient,
  writingId: string,
  init: RequestInit,
  fallbackMessage: string,
): Promise<ServiceResponse<T>> {
  return callWebRoute<T>(supabase, `/api/writings/${writingId}/share-test-link`, init, fallbackMessage)
}

function normalizeProfile(
  rawProfile: RawAuthorProfile | RawAuthorProfile[] | null,
): RawAuthorProfile {
  if (!rawProfile) {
    return null
  }

  return Array.isArray(rawProfile) ? rawProfile[0] ?? null : rawProfile
}

function buildExcerpt(bodyText: string, maxLen = 120): string {
  const text = bodyText.trim()
  if (text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(" ")
  return lastSpace > 0 ? `${cut.slice(0, lastSpace)}…` : `${cut}…`
}

function buildSharedWritingListItem(
  writing: { id: string; title: string | null; slug: string | null; body_text: string; updated_at: string },
  author: RawAuthorProfile,
): SharedWritingListItem {
  return {
    id: writing.id,
    title: writing.title,
    slug: writing.slug,
    excerpt: buildExcerpt(writing.body_text),
    updatedAt: writing.updated_at,
    author: author
      ? { username: author.username, displayName: author.display_name }
      : null,
  }
}

type IncomingSharedWritingRow = {
  id: string
  title: string | null
  slug: string | null
  body_text: string
  updated_at: string
  author_username: string | null
  author_display_name: string | null
}

async function getUserId(supabase: DesktopSupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

export function createDesktopSharingService(): DesktopSharingService {
  const supabase = createDesktopClient()

  return {
    async listRecipients(writingId) {
      return callWebRoute<ShareRecipient[]>(
        supabase,
        `/api/writings/${writingId}/shares`,
        { method: "GET", cache: "no-store" },
        "Could not load recipients right now.",
      )
    },

    async shareWriting(input) {
      return callWebRoute<ShareRecipient>(
        supabase,
        `/api/writings/${input.writingId}/shares`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_with_id: input.sharedWithUserId }),
          expectedStatus: 201,
        },
        "Could not share this writing right now.",
      )
    },

    async revokeShare(input) {
      const result = await callWebRoute<void>(
        supabase,
        `/api/writings/${input.writingId}/shares`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_with_id: input.sharedWithUserId }),
          expectedStatus: [200, 204],
        },
        "Could not revoke access right now.",
      )

      if (result.error) {
        return result as ServiceResponse<{ writingId: string; sharedWithUserId: string }>
      }

      return ok({ writingId: input.writingId, sharedWithUserId: input.sharedWithUserId })
    },

    async getPreviewLink(writingId) {
      return callPreviewLinkRoute<PreviewLinkState>(
        supabase,
        writingId,
        { method: "GET", cache: "no-store" },
        "Could not load the preview link right now.",
      )
    },

    async rotatePreviewLink(writingId) {
      return callPreviewLinkRoute<PreviewLinkState>(
        supabase,
        writingId,
        { method: "POST" },
        "Could not generate the preview link right now.",
      )
    },

    async revokePreviewLink(writingId) {
      return callPreviewLinkRoute<{ writingId: string; revoked: boolean }>(
        supabase,
        writingId,
        { method: "DELETE" },
        "Could not revoke the preview link right now.",
      )
    },

    async listIncomingShares() {
      // SECURITY DEFINER RPC: returns only writings shared with the calling
      // user, joined to the author's public profile fields. The profiles table
      // itself is locked to self-reads under RLS (see migration 20260317221000),
      // so a plain embed would render every author as "Unknown author".
      const { data, error } = await supabase.rpc("list_incoming_shared_writings")

      if (error) {
        return err(makeError("DB_ERROR", error.message, true))
      }

      const rows = (data ?? []) as IncomingSharedWritingRow[]
      const items: SharedWritingListItem[] = rows.map((row) =>
        buildSharedWritingListItem(
          {
            id: row.id,
            title: row.title,
            slug: row.slug,
            body_text: row.body_text,
            updated_at: row.updated_at,
          },
          row.author_username
            ? { username: row.author_username, display_name: row.author_display_name ?? row.author_username }
            : null,
        ),
      )

      return ok(items)
    },

    async listRecipientPreviews(writingIds: string[]) {
      if (writingIds.length === 0) {
        return ok({})
      }

      if (writingIds.length > MAX_BATCH_SHARE_IDS) {
        return err(
          makeError("INVALID_INPUT", `Maximum ${MAX_BATCH_SHARE_IDS} IDs allowed. Got ${writingIds.length}.`),
        )
      }

      const userId = await getUserId(supabase)
      if (!userId) {
        return err(makeError("UNAUTHORIZED", "No active session.", false))
      }

      const result: Record<string, RecipientPreview[]> = Object.fromEntries(
        writingIds.map((id) => [id, [] as RecipientPreview[]]),
      )

      const { data: shares, error: sharesError } = await supabase
        .from("writing_shares")
        .select("writing_id, profiles!shared_with_id(username, display_name)")
        .in("writing_id", writingIds)
        .order("created_at", { ascending: true })

      if (sharesError) {
        return err(makeError("DB_ERROR", sharesError.message, true))
      }

      for (const share of shares ?? []) {
        const profile = normalizeProfile(
          (share.profiles ?? null) as RawAuthorProfile | RawAuthorProfile[] | null,
        )

        if (!profile) {
          continue
        }

        const writingId = share.writing_id as string
        result[writingId] ??= []
        result[writingId].push({
          username: profile.username,
          displayName: profile.display_name,
        })
      }

      return ok(result)
    },

    async searchUsers(query) {
      return callWebRoute<UserSearchResult[]>(
        supabase,
        `/api/users/search?q=${encodeURIComponent(query)}`,
        { method: "GET", cache: "no-store" },
        "Could not search users right now.",
      )
    },
  }
}
