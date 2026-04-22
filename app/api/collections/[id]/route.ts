import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const collectionPayloadSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(280).nullable().optional(),
  visibility: z.enum(["private", "public"]).default("private"),
  updated_at: z.string().datetime(),
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
    .from("collections")
    .select("id, owner_id, name, description, visibility, created_at, updated_at")
    .eq("id", id)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    return jsonError(500, "DB_ERROR", error.message);
  }

  if (!data) {
    return jsonError(404, "NOT_FOUND", "Collection not found.");
  }

  return NextResponse.json({ data, error: null }, { status: 200 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  const supabase = createAdminClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const parsed = collectionPayloadSchema.safeParse(await request.json());

  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.message);
  }

  const { id } = await context.params;
  const record = {
    id,
    owner_id: userId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    visibility: parsed.data.visibility,
    updated_at: parsed.data.updated_at,
  };

  const { data: updated, error: updateError } = await supabase
    .from("collections")
    .update(record)
    .eq("id", id)
    .eq("owner_id", userId)
    .select()
    .maybeSingle();

  if (updateError) {
    return jsonError(500, "DB_ERROR", updateError.message);
  }

  if (updated) {
    return NextResponse.json({ data: updated, error: null }, { status: 200 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("collections")
    .insert(record)
    .select()
    .single();

  if (insertError) {
    return jsonError(500, "DB_ERROR", insertError.message);
  }

  return NextResponse.json({ data: inserted, error: null }, { status: 200 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  const supabase = createAdminClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const { id } = await context.params;
  const { error } = await supabase
    .from("collections")
    .delete()
    .eq("id", id)
    .eq("owner_id", userId);

  if (error) {
    return jsonError(500, "DB_ERROR", error.message);
  }

  return NextResponse.json({ data: { id }, error: null }, { status: 200 });
}
