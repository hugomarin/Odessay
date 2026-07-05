import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"

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
      return Response.json(
        { data: null, error: { code: "NOT_FOUND", message: "Asset not found" } },
        { status: 404 }
      )
    }

    const { data: writing, error: writingError } = await admin
      .from("writings")
      .select("author_id, visibility")
      .eq("id", asset.writing_id)
      .single()

    if (writingError || !writing) {
      return Response.json(
        { data: null, error: { code: "NOT_FOUND", message: "Writing not found" } },
        { status: 404 }
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
      return Response.json(
        { data: null, error: { code: "FORBIDDEN", message: "Access denied" } },
        { status: 403 }
      )
    }

    const { data: signedUrl, error: signedError } = await admin.storage
      .from("writing-assets")
      .createSignedUrl(asset.storage_path, 60)

    if (signedError || !signedUrl) {
      console.error("[asset:resolve] signed url error", { assetId, error: signedError?.message })
      return Response.json(
        { data: null, error: { code: "STORAGE_ERROR", message: "Failed to resolve asset" } },
        { status: 500 }
      )
    }

    return Response.redirect(signedUrl.signedUrl, 302)
  } catch (error) {
    console.error("[asset:resolve] unexpected error", { error: error instanceof Error ? error.message : String(error) })
    return Response.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Unexpected error" } },
      { status: 500 }
    )
  }
}
