import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"

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
        Response.json({ data: null, error: { code: "NOT_FOUND", message: "Asset not found" } }, { status: 404 }),
        request,
      )
    }

    const { data: writing, error: writingError } = await admin
      .from("writings")
      .select("author_id, visibility")
      .eq("id", asset.writing_id)
      .single()

    if (writingError || !writing) {
      return withCorsHeaders(
        Response.json({ data: null, error: { code: "NOT_FOUND", message: "Writing not found" } }, { status: 404 }),
        request,
      )
    }

    let canAccess = writing.visibility === "public" || writing.author_id === viewerId

    if (!canAccess && writing.visibility === "shared" && viewerId) {
      const { data: share } = await admin
        .from("writing_shares")
        .select("id")
        .eq("writing_id", asset.writing_id)
        .eq("shared_with_id", viewerId)
        .maybeSingle()
      canAccess = !!share
    }

    if (!canAccess) {
      return withCorsHeaders(
        Response.json({ data: null, error: { code: "FORBIDDEN", message: "Access denied" } }, { status: 403 }),
        request,
      )
    }

    const { data: signedUrl, error: signedError } = await admin.storage
      .from("writing-assets")
      .createSignedUrl(asset.storage_path, 60)

    if (signedError || !signedUrl) {
      console.error("[asset:resolve] signed url error", { assetId, error: signedError?.message })
      return withCorsHeaders(
        Response.json({ data: null, error: { code: "STORAGE_ERROR", message: "Failed to resolve asset" } }, { status: 500 }),
        request,
      )
    }

    // Not Response.redirect(): its headers are immutable, so the CORS headers
    // the desktop needs on the redirect itself could not be attached.
    return withCorsHeaders(
      new Response(null, { status: 302, headers: { Location: signedUrl.signedUrl } }),
      request,
    )
  } catch (error) {
    console.error("[asset:resolve] unexpected error", { error: error instanceof Error ? error.message : String(error) })
    return withCorsHeaders(
      Response.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Unexpected error" } }, { status: 500 }),
      request,
    )
  }
}
