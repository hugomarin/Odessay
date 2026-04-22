import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const collectionPayloadSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(280).nullable().optional(),
  visibility: z.enum(["private", "public"]).default("private"),
  updated_at: z.string().datetime(),
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
    return jsonError(400, "INVALID_COLLECTION_ID", "Invalid collection ID.");
  }

  const { id } = parsedParams.data;
  const { data, error } = await supabase
    .from("collections")
    .select("id, owner_id, name, description, visibility, created_at, updated_at")
    .eq("id", id)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    logRouteError("api/collections/[id].GET", error);
    return jsonError(500, "DB_ERROR", "Failed to load collection.");
  }

  if (!data) {
    return jsonError(404, "NOT_FOUND", "Collection not found.");
  }

  return NextResponse.json({ data, error: null }, { status: 200 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  const supabase = await createClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const parsed = collectionPayloadSchema.safeParse(await request.json());

  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.message);
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonError(400, "INVALID_COLLECTION_ID", "Invalid collection ID.");
  }

  const { id } = parsedParams.data;
  const record = {
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    visibility: parsed.data.visibility,
    updated_at: parsed.data.updated_at,
  };

  const insertRecord = {
    id,
    owner_id: userId,
    ...record,
  };

  const { data: upserted, error: upsertError } = await supabase
    .from("collections")
    .upsert(insertRecord, {
      onConflict: "id",
    })
    .select()
    .single();

  if (upsertError) {
    logRouteError("api/collections/[id].PATCH.upsert", upsertError);
    return jsonError(500, "DB_ERROR", "Failed to upsert collection.");
  }

  return NextResponse.json({ data: upserted, error: null }, { status: 200 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  const supabase = await createClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonError(400, "INVALID_COLLECTION_ID", "Invalid collection ID.");
  }

  const { id } = parsedParams.data;
  const { error } = await supabase
    .from("collections")
    .delete()
    .eq("id", id)
    .eq("owner_id", userId);

  if (error) {
    logRouteError("api/collections/[id].DELETE", error);
    return jsonError(500, "DB_ERROR", "Failed to delete collection.");
  }

  return NextResponse.json({ data: { id }, error: null }, { status: 200 });
}
