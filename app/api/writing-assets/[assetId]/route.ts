import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"

// ODE-523 requirement 4: an intermediary (browser cache, CDN, shared proxy)
// must never extend a previous authorization decision past this request —
// a denial issued after archival, and the signed-URL redirect itself
// (already short-lived, but doubly so here), both get an explicit
// private/no-store policy rather than relying on the platform's defaults.
function withNoStore(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

// The desktop app resolves image sources from `tauri://localhost`, so this
// route needs the same CORS treatment as every other route it proxies. Without
// it the preflight fails, the resolver falls back to this URL as a plain <img>
// src — which carries no credentials — and the image renders broken.
export function OPTIONS(request: Request) {
  return handleCorsPreflight(request) ?? new Response(null, { status: 204 })
}

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const { assetId } = await context.params
    const { userId: viewerId } = await getCurrentUserFromRequest(request)

    const admin = createAdminClient()

    const { data: asset, error: assetError } = await admin
      .from("writing_assets")
      .select("writing_id, storage_path, author_id")
      .eq("id", assetId)
      .single()

    if (assetError || !asset) {
      return withCorsHeaders(
        withNoStore(
          Response.json({ data: null, error: { code: "NOT_FOUND", message: "Asset not found" } }, { status: 404 }),
        ),
        request,
      )
    }

    const { data: writing, error: writingError } = await admin
      .from("writings")
      .select("author_id, visibility, deleted_at")
      .eq("id", asset.writing_id)
      .single()

    if (writingError || !writing) {
      return withCorsHeaders(
        withNoStore(
          Response.json({ data: null, error: { code: "NOT_FOUND", message: "Writing not found" } }, { status: 404 }),
        ),
        request,
      )
    }

    const isOwner = writing.author_id === viewerId
    // ODE-523: an archived writing's former visibility never authorizes a
    // third party — normal writing reads already exclude archived rows, and
    // this route must not become the one path that still mints signed URLs
    // for a "public" or "shared" writing after it was archived. Only the
    // owner retains access, matching the archive contract that already lets
    // an owner read/restore their own archived writings.
    let canAccess = isOwner
    if (!isOwner && !writing.deleted_at) {
      canAccess = writing.visibility === "public"

      if (!canAccess && writing.visibility === "shared" && viewerId) {
        const { data: share } = await admin
          .from("writing_shares")
          .select("id")
          .eq("writing_id", asset.writing_id)
          .eq("shared_with_id", viewerId)
          .maybeSingle()
        canAccess = !!share
      }
    }

    if (!canAccess) {
      // Requirement 4: a generic denial — an archived writing and a writing
      // that was never accessible to this caller look identical from here.
      return withCorsHeaders(
        withNoStore(
          Response.json({ data: null, error: { code: "FORBIDDEN", message: "Access denied" } }, { status: 403 }),
        ),
        request,
      )
    }

    const { data: signedUrl, error: signedError } = await admin.storage
      .from("writing-assets")
      .createSignedUrl(asset.storage_path, 60)

    if (signedError || !signedUrl) {
      console.error("[asset:resolve] signed url error", { assetId, error: signedError?.message })
      return withCorsHeaders(
        withNoStore(
          Response.json({ data: null, error: { code: "STORAGE_ERROR", message: "Failed to resolve asset" } }, { status: 500 }),
        ),
        request,
      )
    }

    // Not Response.redirect(): its headers are immutable, so the CORS headers
    // the desktop needs on the redirect itself could not be attached.
    return withCorsHeaders(
      withNoStore(new Response(null, { status: 302, headers: { Location: signedUrl.signedUrl } })),
      request,
    )
  } catch (error) {
    console.error("[asset:resolve] unexpected error", { error: error instanceof Error ? error.message : String(error) })
    return withCorsHeaders(
      withNoStore(
        Response.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Unexpected error" } }, { status: 500 }),
      ),
      request,
    )
  }
}
