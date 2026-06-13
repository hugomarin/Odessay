import type {
  PreviewLinkState,
  RevokeWritingShareInput,
  ShareRecipient,
  SharedWritingListItem,
  SharingService,
  ShareWritingInput,
} from "@/lib/services/contracts/sharing-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { buildSharedWritingListItem, type RawAuthorProfile } from "@/lib/sharing/writing-shares"

type ApiEnvelope<T> = {
  data: T | null
  error: {
    code: string
    message: string
  } | null
}

export type RecipientPreview = {
  username: string
  displayName: string
}

export type BrowserSharingService = SharingService & {
  listRecipientPreviews(writingIds: string[]): Promise<ServiceResponse<Record<string, RecipientPreview[]>>>
}

type ShareRouteRow = {
  shared_with_id: string
  can_respond: boolean
  created_at: string
  profiles:
    | { username: string; display_name: string }
    | { username: string; display_name: string }[]
    | null
}

type SharedWritingRow = {
  id: string
  title: string | null
  slug: string | null
  body_text: string
  updated_at: string
  profiles: RawAuthorProfile | RawAuthorProfile[] | null
}

type WebSharingServiceContext = {
  userId: string | null
  requestUrl?: string
}

const MAX_BATCH_SHARE_IDS = 50
const TEST_LINK_EMAIL_PREFIX = "ux-eval+"
const TEST_LINK_EMAIL_DOMAIN = "odessay.local"

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(error: ServiceError): ServiceResponse<T> {
  return { data: null, error }
}

function makeError(code: ServiceError["code"], message: string, retryable = false): ServiceError {
  return { code, message, retryable }
}

async function parseResponse<T>(response: Response, fallbackCode: ServiceError["code"]): Promise<ServiceResponse<T>> {
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null

  if (!response.ok || !payload?.data) {
    return err({
      code: payload?.error?.code ?? fallbackCode,
      message: payload?.error?.message ?? "Unexpected sharing service response.",
      retryable: response.status >= 500,
    })
  }

  return ok(payload.data)
}

function normalizeProfile(
  rawProfile: ShareRouteRow["profiles"] | SharedWritingRow["profiles"],
): RawAuthorProfile {
  if (!rawProfile) {
    return null
  }

  return Array.isArray(rawProfile) ? rawProfile[0] ?? null : rawProfile
}

export function normalizeShareRecipient(row: ShareRouteRow): ShareRecipient | null {
  const profile = normalizeProfile(row.profiles)
  if (!profile) {
    return null
  }

  return {
    userId: row.shared_with_id,
    username: profile.username,
    displayName: profile.display_name,
    canRespond: row.can_respond,
    sharedAt: row.created_at,
  }
}

function buildAbsolutePreviewLink(requestUrl: string | undefined, token: string): string | null {
  if (!requestUrl) {
    return null
  }

  return new URL(`/preview/${token}`, requestUrl).toString()
}

function buildInactivePreviewLinkState(): PreviewLinkState {
  return {
    active: false,
    token: null,
    link: null,
    createdAt: null,
  }
}

function normalizeSharedWritingRows(rows: SharedWritingRow[]): SharedWritingListItem[] {
  return rows.map((writing) =>
    buildSharedWritingListItem(
      {
        id: writing.id,
        title: writing.title,
        slug: writing.slug,
        body_text: writing.body_text,
        updated_at: writing.updated_at,
      },
      normalizeProfile(writing.profiles),
    ),
  )
}

async function getAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin")
  return createAdminClient()
}

function createTestLinkToken() {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "")
}

function getTestLinkEmail(writingId: string) {
  return `${TEST_LINK_EMAIL_PREFIX}${writingId}@${TEST_LINK_EMAIL_DOMAIN}`
}

function pickLatestPendingTestLink(
  rows: Array<{ token: string; email: string; status: "pending" | "accepted" | "expired"; created_at: string }>,
  writingId: string,
) {
  const markerEmail = getTestLinkEmail(writingId)

  const [latest] = rows
    .filter((row) => row.status === "pending" && row.email === markerEmail)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))

  return latest ?? null
}

async function verifyWritingOwnership(writingId: string, userId: string) {
  const admin = await getAdminClient()
  const { data, error } = await admin
    .from("writings")
    .select("id, visibility")
    .eq("id", writingId)
    .eq("author_id", userId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; visibility: "private" | "shared" | "public" }>()

  if (error) {
    return err<{ id: string; visibility: "private" | "shared" | "public" }>(makeError("DB_ERROR", error.message, true))
  }

  if (!data) {
    return err<{ id: string; visibility: "private" | "shared" | "public" }>(
      makeError("FORBIDDEN", "Writing not found or access denied."),
    )
  }

  return ok(data)
}

async function listRecipientPreviewsForUser(
  userId: string,
  writingIds: string[],
): Promise<ServiceResponse<Record<string, RecipientPreview[]>>> {
  if (writingIds.length === 0) {
    return ok({})
  }

  if (writingIds.length > MAX_BATCH_SHARE_IDS) {
    return err(makeError("INVALID_INPUT", `Maximum ${MAX_BATCH_SHARE_IDS} IDs allowed. Got ${writingIds.length}.`))
  }

  const admin = await getAdminClient()
  const { data: ownedWritings, error: ownershipError } = await admin
    .from("writings")
    .select("id")
    .in("id", writingIds)
    .eq("author_id", userId)
    .is("deleted_at", null)

  if (ownershipError) {
    return err(makeError("DB_ERROR", ownershipError.message, true))
  }

  const result: Record<string, RecipientPreview[]> = Object.fromEntries(
    writingIds.map((id) => [id, [] as RecipientPreview[]]),
  )

  const ownedIds = (ownedWritings ?? []).map((writing) => writing.id)
  if (ownedIds.length === 0) {
    return ok(result)
  }

  const { data: shares, error: sharesError } = await admin
    .from("writing_shares")
    .select("writing_id, profiles!shared_with_id(username, display_name)")
    .in("writing_id", ownedIds)
    .order("created_at", { ascending: true })

  if (sharesError) {
    return err(makeError("DB_ERROR", sharesError.message, true))
  }

  for (const share of shares ?? []) {
    const profile = normalizeProfile(
      (share.profiles ?? null) as
        | { username: string; display_name: string }
        | { username: string; display_name: string }[]
        | null,
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
}

export async function createWebSharingService(
  context: WebSharingServiceContext,
): Promise<BrowserSharingService> {
  const unauthorized = <T>() => err<T>(makeError("UNAUTHORIZED", "No active session."))

  return {
    async listRecipients(writingId) {
      if (!context.userId) {
        return unauthorized()
      }

      const ownership = await verifyWritingOwnership(writingId, context.userId)
      if (ownership.error) {
        return ownership
      }

      const admin = await getAdminClient()
      const { data, error } = await admin
        .from("writing_shares")
        .select("shared_with_id, can_respond, created_at, profiles!shared_with_id(username, display_name)")
        .eq("writing_id", writingId)
        .order("created_at", { ascending: true })

      if (error) {
        return err(makeError("DB_ERROR", error.message, true))
      }

      return ok((data ?? []).map((row) => normalizeShareRecipient(row as ShareRouteRow)).filter(Boolean) as ShareRecipient[])
    },

    async shareWriting(input: ShareWritingInput) {
      if (!context.userId) {
        return unauthorized()
      }

      if (input.sharedWithUserId === context.userId) {
        return err(makeError("CANNOT_SHARE_WITH_SELF", "Cannot share a writing with yourself."))
      }

      const ownership = await verifyWritingOwnership(input.writingId, context.userId)
      if (ownership.error) {
        return ownership
      }

      const admin = await getAdminClient()

      if (ownership.data.visibility === "private") {
        const { error: visibilityError } = await admin
          .from("writings")
          .update({ visibility: "shared" })
          .eq("id", input.writingId)

        if (visibilityError) {
          return err(makeError("DB_ERROR", visibilityError.message, true))
        }
      }

      const { data, error } = await admin
        .from("writing_shares")
        .insert({
          writing_id: input.writingId,
          shared_with_id: input.sharedWithUserId,
          can_respond: true,
        })
        .select("shared_with_id, can_respond, created_at, profiles!shared_with_id(username, display_name)")
        .single()

      if (error) {
        if (error.code === "23505") {
          return err(makeError("ALREADY_SHARED", "Writing already shared with this user."))
        }

        return err(makeError("DB_ERROR", error.message, true))
      }

      const recipient = normalizeShareRecipient(data as ShareRouteRow)
      if (!recipient) {
        return err(makeError("DB_ERROR", "Shared recipient profile could not be resolved.", true))
      }

      return ok(recipient)
    },

    async revokeShare(input: RevokeWritingShareInput) {
      if (!context.userId) {
        return unauthorized()
      }

      const ownership = await verifyWritingOwnership(input.writingId, context.userId)
      if (ownership.error) {
        return ownership
      }

      const admin = await getAdminClient()
      const { error } = await admin
        .from("writing_shares")
        .delete()
        .eq("writing_id", input.writingId)
        .eq("shared_with_id", input.sharedWithUserId)

      if (error) {
        return err(makeError("DB_ERROR", error.message, true))
      }

      return ok({
        writingId: input.writingId,
        sharedWithUserId: input.sharedWithUserId,
      })
    },

    async getPreviewLink(writingId) {
      if (!context.userId) {
        return unauthorized()
      }

      const ownership = await verifyWritingOwnership(writingId, context.userId)
      if (ownership.error) {
        return ownership.error.code === "FORBIDDEN"
          ? err(makeError("NOT_FOUND", "Writing not found."))
          : ownership
      }

      const markerEmail = getTestLinkEmail(writingId)
      const admin = await getAdminClient()
      const { data, error } = await admin
        .from("invitations")
        .select("token, email, status, created_at")
        .eq("inviter_id", context.userId)
        .eq("writing_id", writingId)
        .eq("email", markerEmail)
        .order("created_at", { ascending: false })
        .limit(10)
        .returns<Array<{ token: string; email: string; status: "pending" | "accepted" | "expired"; created_at: string }>>()

      if (error) {
        return err(makeError("DB_ERROR", error.message, true))
      }

      const invitation = pickLatestPendingTestLink(data ?? [], writingId)
      if (!invitation) {
        return ok(buildInactivePreviewLinkState())
      }

      return ok({
        active: true,
        token: invitation.token,
        link: buildAbsolutePreviewLink(context.requestUrl, invitation.token),
        createdAt: invitation.created_at,
      })
    },

    async rotatePreviewLink(writingId) {
      if (!context.userId) {
        return unauthorized()
      }

      const ownership = await verifyWritingOwnership(writingId, context.userId)
      if (ownership.error) {
        return ownership.error.code === "FORBIDDEN"
          ? err(makeError("NOT_FOUND", "Writing not found."))
          : ownership
      }

      if (!context.requestUrl) {
        return err(makeError("UNAVAILABLE", "Cannot build preview link outside a request context.", true))
      }

      const admin = await getAdminClient()
      const token = createTestLinkToken()
      const { data, error } = await admin
        .rpc("rotate_test_preview_link", {
          p_inviter_id: context.userId,
          p_writing_id: writingId,
          p_token: token,
        })
        .returns<Array<{ token: string; created_at: string; replaced_previous: boolean }>>()

      if (error) {
        return err(makeError("DB_ERROR", error.message, true))
      }

      const [rotatedLink] = Array.isArray(data) ? data : []
      if (!rotatedLink) {
        return err(makeError("DB_ERROR", "Failed to generate an active preview link.", true))
      }

      return ok({
        active: true,
        token: rotatedLink.token,
        link: buildAbsolutePreviewLink(context.requestUrl, rotatedLink.token),
        createdAt: rotatedLink.created_at,
        replacedPrevious: rotatedLink.replaced_previous,
      })
    },

    async revokePreviewLink(writingId) {
      if (!context.userId) {
        return unauthorized()
      }

      const ownership = await verifyWritingOwnership(writingId, context.userId)
      if (ownership.error) {
        return ownership.error.code === "FORBIDDEN"
          ? err(makeError("NOT_FOUND", "Writing not found."))
          : ownership
      }

      const markerEmail = getTestLinkEmail(writingId)
      const admin = await getAdminClient()
      const { data, error } = await admin
        .from("invitations")
        .update({ status: "expired" })
        .eq("inviter_id", context.userId)
        .eq("writing_id", writingId)
        .eq("email", markerEmail)
        .eq("status", "pending")
        .select("id")

      if (error) {
        return err(makeError("DB_ERROR", error.message, true))
      }

      return ok({
        writingId,
        revoked: (data?.length ?? 0) > 0,
      })
    },

    async listIncomingShares() {
      if (!context.userId) {
        return unauthorized()
      }

      const admin = await getAdminClient()

      const { data: shareRows, error: shareError } = await admin
        .from("writing_shares")
        .select("writing_id")
        .eq("shared_with_id", context.userId)

      if (shareError) {
        return err(makeError("DB_ERROR", shareError.message, true))
      }

      const writingIds = (shareRows ?? []).map((row: { writing_id: string }) => row.writing_id)
      if (writingIds.length === 0) {
        return ok([])
      }

      const { data: writings, error: writingsError } = await admin
        .from("writings")
        .select("id, title, slug, body_text, updated_at, profiles!author_id(username, display_name)")
        .in("id", writingIds)
        .neq("author_id", context.userId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })

      if (writingsError) {
        return err(makeError("DB_ERROR", writingsError.message, true))
      }

      return ok(normalizeSharedWritingRows((writings ?? []) as SharedWritingRow[]))
    },

    async listRecipientPreviews(writingIds: string[]) {
      if (!context.userId) {
        return unauthorized()
      }

      return listRecipientPreviewsForUser(context.userId, writingIds)
    },
  }
}

export function createBrowserSharingService(fetchImpl: typeof fetch = fetch): BrowserSharingService {
  return {
    async listRecipients(writingId) {
      return parseResponse<ShareRecipient[]>(await fetchImpl(`/api/writings/${writingId}/shares`), "UNAVAILABLE")
    },

    async shareWriting(input) {
      return parseResponse<ShareRecipient>(
        await fetchImpl(`/api/writings/${input.writingId}/shares`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_with_id: input.sharedWithUserId }),
        }),
        "UNAVAILABLE",
      )
    },

    async revokeShare(input) {
      return parseResponse<{ writingId: string; sharedWithUserId: string }>(
        await fetchImpl(`/api/writings/${input.writingId}/shares`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_with_id: input.sharedWithUserId }),
        }),
        "UNAVAILABLE",
      )
    },

    async getPreviewLink(writingId) {
      return parseResponse<PreviewLinkState>(
        await fetchImpl(`/api/writings/${writingId}/share-test-link`, { method: "GET" }),
        "UNAVAILABLE",
      )
    },

    async rotatePreviewLink(writingId) {
      return parseResponse<PreviewLinkState>(
        await fetchImpl(`/api/writings/${writingId}/share-test-link`, { method: "POST" }),
        "UNAVAILABLE",
      )
    },

    async revokePreviewLink(writingId) {
      return parseResponse<{ writingId: string; revoked: boolean }>(
        await fetchImpl(`/api/writings/${writingId}/share-test-link`, { method: "DELETE" }),
        "UNAVAILABLE",
      )
    },

    async listIncomingShares() {
      return parseResponse<SharedWritingListItem[]>(
        await fetchImpl("/api/shared/writings", { cache: "no-store" }),
        "UNAVAILABLE",
      )
    },

    async listRecipientPreviews(writingIds: string[]) {
      if (writingIds.length === 0) {
        return ok({})
      }

      return parseResponse<Record<string, RecipientPreview[]>>(
        await fetchImpl(`/api/writings/shares?ids=${encodeURIComponent(writingIds.join(","))}`, {
          cache: "no-store",
        }),
        "UNAVAILABLE",
      )
    },
  }
}
