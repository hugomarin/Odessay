import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const writingPayloadSchema = z.object({
  title: z.string().nullable().optional(),
  body_json: z.record(z.string(), z.unknown()),
  body_text: z.string(),
  slug: z.string().nullable().optional(),
  status: z.enum(["draft", "finished"]),
  visibility: z.enum(["private", "shared", "public"]),
  parent_id: z.string().uuid().nullable().optional(),
  correspondence_id: z.string().uuid().nullable().optional(),
  version: z.number().int().min(1),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable().optional(),
});

const deletePayloadSchema = z.object({
  version: z.number().int().min(1),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime(),
});

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json(
    {
      data: null,
      error: {
        code,
        message,
      },
    },
    { status },
  );

async function getCurrentUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, userId: user?.id ?? null };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, userId } = await getCurrentUserId();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const payload = await request.json();
  const parsed = writingPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.message);
  }

  const { id } = await context.params;
  const { data: currentWriting, error: currentWritingError } = await supabase
    .from("writings")
    .select("id, version")
    .eq("id", id)
    .eq("author_id", userId)
    .maybeSingle();

  if (currentWritingError) {
    return jsonError(500, "DB_ERROR", currentWritingError.message);
  }

  if (currentWriting && currentWriting.version > parsed.data.version) {
    return NextResponse.json({ data: currentWriting, error: null }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("writings")
    .upsert(
      {
        id,
        author_id: userId,
        ...parsed.data,
      },
      { onConflict: "id" },
    )
    .select()
    .single();

  if (error) {
    return jsonError(500, "DB_ERROR", error.message);
  }

  return NextResponse.json({ data, error: null }, { status: 200 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, userId } = await getCurrentUserId();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const payload = await request.json();
  const parsed = deletePayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.message);
  }

  const { id } = await context.params;
  const { data: currentWriting, error: currentWritingError } = await supabase
    .from("writings")
    .select("id, version")
    .eq("id", id)
    .eq("author_id", userId)
    .single();

  if (currentWritingError) {
    return jsonError(500, "DB_ERROR", currentWritingError.message);
  }

  if (currentWriting.version > parsed.data.version) {
    return NextResponse.json({ data: currentWriting, error: null }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("writings")
    .update({
      deleted_at: parsed.data.deleted_at,
      updated_at: parsed.data.updated_at,
      version: parsed.data.version,
    })
    .eq("id", id)
    .eq("author_id", userId)
    .select()
    .single();

  if (error) {
    return jsonError(500, "DB_ERROR", error.message);
  }

  return NextResponse.json({ data, error: null }, { status: 200 });
}
