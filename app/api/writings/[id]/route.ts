import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const writingPayloadSchema = z.object({
  title: z.string().nullable().optional(),
  body_json: z.record(z.string(), z.unknown()),
  body_text: z.string(),
  slug: z.string().nullable().optional(),
  status: z.enum(["draft", "finished"]).default("draft"),
  visibility: z.enum(["private", "shared", "public"]).default("private"),
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

  return { userId: user?.id ?? null };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await getCurrentUserId();
  const supabase = createAdminClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const { id } = await context.params;
  const { data, error } = await supabase
    .from("writings")
    .select(
      "id, author_id, title, body_json, body_text, slug, status, visibility, parent_id, correspondence_id, version, sync_status, deleted_at, created_at, updated_at",
    )
    .eq("id", id)
    .eq("author_id", userId)
    .maybeSingle();

  if (error) {
    return jsonError(500, "DB_ERROR", error.message);
  }

  if (!data) {
    return jsonError(404, "NOT_FOUND", "Writing not found.");
  }

  return NextResponse.json({ data, error: null }, { status: 200 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await getCurrentUserId();
  const supabase = createAdminClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const payload = await request.json();
  const parsed = writingPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.message);
  }

  const { id } = await context.params;
  const writingRecord = {
    id,
    author_id: userId,
    ...parsed.data,
    status: parsed.data.status ?? "draft",
    visibility: parsed.data.visibility ?? "private",
  };

  // Try update first to keep ownership checks strict and avoid duplicate-key races on insert.
  const { data: updatedWriting, error: updateError } = await supabase
    .from("writings")
    .update(writingRecord)
    .eq("id", id)
    .eq("author_id", userId)
    .select()
    .maybeSingle();

  if (updateError) {
    return jsonError(500, "DB_ERROR", updateError.message);
  }

  if (updatedWriting) {
    return NextResponse.json({ data: updatedWriting, error: null }, { status: 200 });
  }

  const { data: insertedWriting, error: insertError } = await supabase
    .from("writings")
    .insert(writingRecord)
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      // Concurrent insert happened between update and insert. Resolve by re-reading as owner.
      const { data: retriedWriting, error: retriedError } = await supabase
        .from("writings")
        .update(writingRecord)
        .eq("id", id)
        .eq("author_id", userId)
        .select()
        .maybeSingle();

      if (retriedError) {
        return jsonError(500, "DB_ERROR", retriedError.message);
      }

      if (!retriedWriting) {
        return jsonError(409, "WRITE_CONFLICT", "Writing ID conflict for current user.");
      }

      return NextResponse.json({ data: retriedWriting, error: null }, { status: 200 });
    }

    return jsonError(500, "DB_ERROR", insertError.message);
  }

  return NextResponse.json({ data: insertedWriting, error: null }, { status: 200 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await getCurrentUserId();
  const supabase = createAdminClient();

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
    .select("id")
    .eq("id", id)
    .eq("author_id", userId)
    .maybeSingle();

  if (currentWritingError) {
    return jsonError(500, "DB_ERROR", currentWritingError.message);
  }

  if (!currentWriting) {
    return jsonError(404, "NOT_FOUND", "Writing not found.");
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
