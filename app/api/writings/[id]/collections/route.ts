import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const payloadSchema = z.object({
  collection_ids: z.array(z.string().uuid()),
  updated_at: z.string().datetime().optional(),
});

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status });

async function getCurrentUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  const supabase = createAdminClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const { id } = await context.params;
  const { data, error } = await supabase
    .from("writing_collections")
    .select("collection_id, added_at, collections!inner(owner_id)")
    .eq("writing_id", id)
    .eq("collections.owner_id", userId);

  if (error) {
    return jsonError(500, "DB_ERROR", error.message);
  }

  return NextResponse.json(
    {
      data: (data ?? []).map((row) => ({
        collection_id: row.collection_id,
        added_at: row.added_at,
      })),
      error: null,
    },
    { status: 200 },
  );
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  const supabase = createAdminClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const parsed = payloadSchema.safeParse(await request.json());

  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.message);
  }

  const { id } = await context.params;
  const collectionIds = Array.from(new Set(parsed.data.collection_ids));
  const { data: writing, error: writingError } = await supabase
    .from("writings")
    .select("id")
    .eq("id", id)
    .eq("author_id", userId)
    .maybeSingle();

  if (writingError) {
    return jsonError(500, "DB_ERROR", writingError.message);
  }

  if (!writing) {
    return jsonError(404, "NOT_FOUND", "Writing not found.");
  }

  if (collectionIds.length > 0) {
    const { data: ownedCollections, error: collectionsError } = await supabase
      .from("collections")
      .select("id")
      .eq("owner_id", userId)
      .in("id", collectionIds);

    if (collectionsError) {
      return jsonError(500, "DB_ERROR", collectionsError.message);
    }

    if ((ownedCollections ?? []).length !== collectionIds.length) {
      return jsonError(403, "FORBIDDEN", "One or more collections do not belong to the active user.");
    }
  }

  const { error: deleteError } = await supabase
    .from("writing_collections")
    .delete()
    .eq("writing_id", id);

  if (deleteError) {
    return jsonError(500, "DB_ERROR", deleteError.message);
  }

  if (collectionIds.length > 0) {
    const rows = collectionIds.map((collectionId) => ({
      writing_id: id,
      collection_id: collectionId,
      added_at: parsed.data.updated_at ?? new Date().toISOString(),
    }));
    const { error: insertError } = await supabase
      .from("writing_collections")
      .insert(rows);

    if (insertError) {
      return jsonError(500, "DB_ERROR", insertError.message);
    }
  }

  return NextResponse.json(
    {
      data: {
        writing_id: id,
        collection_ids: collectionIds,
      },
      error: null,
    },
    { status: 200 },
  );
}
