import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const collectionPayloadSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(280).nullable().optional(),
  visibility: z.enum(["private", "public"]).default("private"),
  updated_at: z.string().datetime().optional(),
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

export async function GET() {
  const userId = await getCurrentUserId();
  const supabase = await createClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const [{ data: collections, error: collectionsError }, { data: writingCollections, error: assignmentsError }] =
    await Promise.all([
      supabase
        .from("collections")
        .select("id, owner_id, name, description, visibility, created_at, updated_at")
        .eq("owner_id", userId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("writing_collections")
        .select("collection_id, writing_id, added_at, collections!inner(owner_id)")
        .eq("collections.owner_id", userId),
    ]);

  if (collectionsError || assignmentsError) {
    logRouteError("api/collections.GET", collectionsError ?? assignmentsError);
    return jsonError(
      500,
      "DB_ERROR",
      "Failed to load collections.",
    );
  }

  return NextResponse.json(
    {
      data: {
        collections: collections ?? [],
        writingCollections: (writingCollections ?? []).map((row) => ({
          collection_id: row.collection_id,
          writing_id: row.writing_id,
          added_at: row.added_at,
        })),
      },
      error: null,
    },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  const supabase = await createClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const parsed = collectionPayloadSchema.safeParse(await request.json());

  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.message);
  }

  const payload = parsed.data;
  const record = {
    id: payload.id,
    owner_id: userId,
    name: payload.name,
    description: payload.description ?? null,
    visibility: payload.visibility,
    updated_at: payload.updated_at ?? new Date().toISOString(),
  };

  const { data, error } = await supabase.from("collections").insert(record).select().single();

  if (error) {
    logRouteError("api/collections.POST", error);
    return jsonError(500, "DB_ERROR", "Failed to create collection.");
  }

  return NextResponse.json({ data, error: null }, { status: 201 });
}
