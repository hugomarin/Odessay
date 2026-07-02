import { titleToFilename, resolveUniqueFilename, UNTITLED_DOCUMENT_NAME } from "@/lib/desktop/document-naming"
import { createDesktopDraft } from "@/lib/services/document-service-factory"
import { tauriListRecentFiles } from "@/lib/services/desktop/tauri-commands"
import type { SharedWritingListItem } from "@/lib/services/contracts/sharing-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { getWorkspaceAssignmentService } from "@/lib/services/workspace-service"
import { createDesktopClient } from "@/lib/supabase/desktop-client"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"

type DesktopSharedWritingRow = {
  id: string
  title: string | null
  body_json: Record<string, unknown> | null
  body_text: string
  updated_at: string
}

export type DesktopSharedReadingPayload = {
  writing: {
    id: string
    title: string | null
    bodyJson: Record<string, unknown> | null
    bodyText: string
    updatedAt: string
  }
  author: {
    username: string
    displayName: string
  } | null
  prevWritingId: string | null
  nextWritingId: string | null
  prevWritingHref: string | null
  nextWritingHref: string | null
  sequencePosition: number | null
  sequenceTotal: number | null
}

export type DesktopSharedCopyInput = {
  identifier: string
  workspaceSlug: string
  destinationFolder: string
}

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(code: ServiceError["code"], message: string, retryable = false): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable } }
}

function joinDesktopPath(basePath: string, relativePath: string) {
  const normalizedBase = basePath.replace(/[\\/]+$/, "")
  const normalizedRelative = relativePath.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")
  return normalizedRelative ? `${normalizedBase}/${normalizedRelative}` : normalizedBase
}

async function getDesktopSessionUserId() {
  const supabase = createDesktopClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

async function listIncomingSharedItems(): Promise<ServiceResponse<SharedWritingListItem[]>> {
  const supabase = createDesktopClient()
  const { data, error } = await supabase.rpc("list_incoming_shared_writings")

  if (error) {
    return err("DB_ERROR", error.message, true)
  }

  const rows = (data ?? []) as Array<{
    id: string
    title: string | null
    slug: string | null
    body_text: string
    updated_at: string
    author_username: string | null
    author_display_name: string | null
  }>

  return ok(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.body_text.trim().slice(0, 120),
      updatedAt: row.updated_at,
      author: row.author_username
        ? {
            username: row.author_username,
            displayName: row.author_display_name ?? row.author_username,
          }
        : null,
    })),
  )
}

async function loadSharedWritingById(writingId: string): Promise<ServiceResponse<DesktopSharedWritingRow>> {
  const supabase = createDesktopClient()
  const { data, error } = await supabase
    .from("writings")
    .select("id, title, body_json, body_text, updated_at")
    .eq("id", writingId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) {
    return err("DB_ERROR", error.message, true)
  }

  if (!data) {
    return err("NOT_FOUND", "Shared writing not found.")
  }

  return ok(data as DesktopSharedWritingRow)
}

export async function loadDesktopSharedReading(
  identifier: string,
): Promise<ServiceResponse<DesktopSharedReadingPayload>> {
  const userId = await getDesktopSessionUserId()
  if (!userId) {
    return err("UNAUTHORIZED", "Sign in to open shared writings.")
  }

  const sharedItemsResult = await listIncomingSharedItems()
  if (sharedItemsResult.error || !sharedItemsResult.data) {
    return sharedItemsResult as ServiceResponse<DesktopSharedReadingPayload>
  }

  const sharedItems = sharedItemsResult.data
  const targetIndex = sharedItems.findIndex((item) => item.id === identifier || item.slug === identifier)

  if (targetIndex === -1) {
    return err("NOT_FOUND", "Shared writing not found.")
  }

  const target = sharedItems[targetIndex]
  const writingResult = await loadSharedWritingById(target.id)
  if (writingResult.error || !writingResult.data) {
    return writingResult as ServiceResponse<DesktopSharedReadingPayload>
  }

  const previousWriting = sharedItems[targetIndex - 1] ?? null
  const nextWriting = sharedItems[targetIndex + 1] ?? null

  return ok({
    writing: {
      id: writingResult.data.id,
      title: writingResult.data.title,
      bodyJson: writingResult.data.body_json,
      bodyText: writingResult.data.body_text,
      updatedAt: writingResult.data.updated_at,
    },
    author: target.author,
    prevWritingId: previousWriting?.id ?? null,
    nextWritingId: nextWriting?.id ?? null,
    prevWritingHref: previousWriting ? buildWritingRouteHref("/shared", previousWriting) : null,
    nextWritingHref: nextWriting ? buildWritingRouteHref("/shared", nextWriting) : null,
    sequencePosition: targetIndex + 1,
    sequenceTotal: sharedItems.length,
  })
}

export async function copyDesktopSharedWritingToWorkspace(
  input: DesktopSharedCopyInput,
): Promise<ServiceResponse<{ writingId: string }>> {
  const userId = await getDesktopSessionUserId()
  if (!userId) {
    return err("UNAUTHORIZED", "Sign in to save a shared writing to your files.")
  }

  const sharedReadingResult = await loadDesktopSharedReading(input.identifier)
  if (sharedReadingResult.error || !sharedReadingResult.data) {
    return sharedReadingResult as ServiceResponse<{ writingId: string }>
  }

  const workspaceService = getWorkspaceAssignmentService()
  const workspace = await workspaceService.getWorkspaceDetail(input.workspaceSlug)

  if (!workspace || workspace.status !== "ready") {
    return err("NOT_FOUND", "Choose an available workspace before saving.")
  }

  const targetDir = joinDesktopPath(workspace.rootPath, input.destinationFolder)
  const siblings = await tauriListRecentFiles(targetDir, 10_000).catch(() => [])
  const siblingNames = siblings.map((entry) => entry.path.split("/").pop() ?? `${entry.name}.md`)
  const title = sharedReadingResult.data.writing.title?.trim() || UNTITLED_DOCUMENT_NAME
  const filename = resolveUniqueFilename(titleToFilename(title), siblingNames)
  const preferredPath = `${targetDir}/${filename}`

  const draftResult = await createDesktopDraft({
    authorId: userId,
    title,
    preferredPath,
    initialBodyJson: (sharedReadingResult.data.writing.bodyJson as Record<string, unknown> | null) ?? null,
    initialBodyText: sharedReadingResult.data.writing.bodyText,
  })

  if (draftResult.error || !draftResult.data) {
    return draftResult as ServiceResponse<{ writingId: string }>
  }

  await workspaceService.assign(draftResult.data.id, workspace.slug)

  return ok({ writingId: draftResult.data.id })
}
