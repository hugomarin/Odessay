import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { z } from "zod"

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
])

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

const uploadSchema = z.object({
  file: z.instanceof(File).refine(
    (file) => ALLOWED_MIME_TYPES.has(file.type),
    { message: "Invalid file type. Allowed: png, jpg, jpeg, webp, gif." }
  ).refine(
    (file) => file.size > 0 && file.size <= MAX_FILE_SIZE,
    { message: "File must be between 1 byte and 5MB." }
  ),
  alt: z.string().max(500).optional(),
})

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: writingId } = await context.params
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json(
        { data: null, error: { code: "UNAUTHORIZED", message: "No session" } },
        { status: 401 }
      )
    }

    const { data: existingWriting } = await supabase
      .from("writings")
      .select("author_id")
      .eq("id", writingId)
      .single()

    const admin = createAdminClient()

    if (!existingWriting) {
      // Writing may only exist in localDB (local-first). Create a minimal remote
      // record so the asset FK succeeds. The sync worker will eventually reconcile
      // the full document state.
      const { error: createError } = await admin
        .from("writings")
        .insert({
          id: writingId,
          author_id: user.id,
          title: null,
          body_json: { type: "doc", content: [{ type: "paragraph" }] },
          body_text: "",
          status: "draft",
          visibility: "private",
          version: 1,
        })
        .select()
        .single()

      if (createError) {
        console.error("[upload:image] failed to create writing", { userId: user.id, writingId, error: createError.message })
        return Response.json(
          { data: null, error: { code: "DB_ERROR", message: "Failed to prepare writing record" } },
          { status: 500 }
        )
      }
    } else if (existingWriting.author_id !== user.id) {
      return Response.json(
        { data: null, error: { code: "FORBIDDEN", message: "Not the author" } },
        { status: 403 }
      )
    }

    const formData = await req.formData()
    const file = formData.get("file")
    const alt = formData.get("alt")

    const parsed = uploadSchema.safeParse({
      file,
      alt: alt ? String(alt) : undefined,
    })

    if (!parsed.success) {
      return Response.json(
        { data: null, error: { code: "INVALID_INPUT", message: parsed.error.message } },
        { status: 400 }
      )
    }

    const { file: imageFile } = parsed.data
    const ext = imageFile.name.split(".").pop()?.toLowerCase() || "bin"
    const assetId = crypto.randomUUID()
    const storagePath = `${user.id}/${writingId}/${assetId}.${ext}`

    const { error: uploadError } = await admin.storage
      .from("writing-assets")
      .upload(storagePath, imageFile, {
        contentType: imageFile.type,
        upsert: false,
      })

    if (uploadError) {
      console.error("[upload:image] storage error", { userId: user.id, writingId, error: uploadError.message })
      return Response.json(
        { data: null, error: { code: "STORAGE_ERROR", message: "Failed to upload file" } },
        { status: 500 }
      )
    }

    const { data: asset, error: assetError } = await admin
      .from("writing_assets")
      .insert({
        id: assetId,
        writing_id: writingId,
        author_id: user.id,
        storage_path: storagePath,
        mime_type: imageFile.type,
        size_bytes: imageFile.size,
      })
      .select()
      .single()

    if (assetError || !asset) {
      // Best-effort cleanup
      await admin.storage.from("writing-assets").remove([storagePath])
      console.error("[upload:image] db error", { userId: user.id, writingId, error: assetError?.message })
      return Response.json(
        { data: null, error: { code: "DB_ERROR", message: "Failed to record asset metadata" } },
        { status: 500 }
      )
    }

    return Response.json(
      {
        data: {
          assetId: asset.id,
          url: `/api/writing-assets/${asset.id}`,
          alt: parsed.data.alt ?? null,
        },
        error: null,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("[upload:image] unexpected error", { error: error instanceof Error ? error.message : String(error) })
    return Response.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Unexpected error" } },
      { status: 500 }
    )
  }
}
