import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const payloadSchema = z.object({
  collection_ids: z.array(z.string().uuid()),
  updated_at: z.string().datetime().optional(),
});

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status });

const logRouteError = (route: string, error: unknown) => {
  console.error(`[${route}]`, error);
};

async function getCurrentUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  const supabase = await createClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonError(400, "INVALID_WRITING_ID", "Invalid writing ID.");
  }

  const { id } = parsedParams.data;
  const { data, error } = await supabase
    .from("writing_collections")
    .select("collection_id, added_at, collections!inner(owner_id)")
    .eq("writing_id", id)
    .eq("collections.owner_id", userId);

  if (error) {
    logRouteError("api/writings/[id]/collections.GET", error);
    return jsonError(500, "DB_ERROR", "Failed to load writing collections.");
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
  const supabase = await createClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const parsed = payloadSchema.safeParse(await request.json());

  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.message);
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonError(400, "INVALID_WRITING_ID", "Invalid writing ID.");
  }

  const { id } = parsedParams.data;
  const collectionIds = Array.from(new Set(parsed.data.collection_ids));
  const updatedAt = parsed.data.updated_at ?? new Date().toISOString();
  const { error } = await supabase.rpc("replace_writing_collections", {
    p_writing_id: id,
    p_collection_ids: collectionIds,
    p_added_at: updatedAt,
  });

  if (error) {
    if (error.code === "PT404") {
      return jsonError(404, "NOT_FOUND", "Writing not found.");
    }

    if (error.code === "PT403") {
      return jsonError(
        403,
        "FORBIDDEN",
        "One or more collections do not belong to the active user.",
      );
    }

    logRouteError("api/writings/[id]/collections.PUT", error);
    return jsonError(500, "DB_ERROR", "Failed to update writing collections.");
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
