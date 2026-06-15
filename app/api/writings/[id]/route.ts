import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth";
import { syncMarginsFromBodyJson } from "@/lib/margins/margins";
import { ARTIFACT_TYPE_VALUES } from "@/lib/writings/artifact-type";
import { normalizeWritingStatus, WRITING_STATUS_VALUES } from "@/lib/writings/status";

const writingPayloadSchema = z.object({
  title: z.string().nullable().optional(),
  body_json: z.record(z.string(), z.unknown()),
  body_text: z.string(),
  slug: z.string().nullable().optional(),
  status: z.enum([...WRITING_STATUS_VALUES, "finished"]).default("draft"),
  artifact_type: z.enum(ARTIFACT_TYPE_VALUES).default("general"),
  visibility: z.enum(["private", "shared", "public"]).default("private"),
  parent_id: z.string().uuid().nullable().optional(),
  correspondence_id: z.string().uuid().nullable().optional(),
  version: z.number().int().min(1),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable().optional(),
  content_updated_at: z.string().datetime().nullable().optional(),
  metadata_updated_at: z.string().datetime().nullable().optional(),
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

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await getCurrentUserFromRequest(request);
  const supabase = createAdminClient();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const { id } = await context.params;
  const { data, error } = await supabase
    .from("writings")
    .select(
      "id, author_id, title, body_json, body_text, slug, status, artifact_type, visibility, parent_id, correspondence_id, version, sync_status, deleted_at, created_at, updated_at, content_updated_at, metadata_updated_at",
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
  const { userId } = await getCurrentUserFromRequest(request);
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
  let visibility = parsed.data.visibility ?? "private";

  // Guardrail: if the writing already has recipients, keep at least "shared" visibility.
  if (visibility === "private") {
    const { count, error: sharesError } = await supabase
      .from("writing_shares")
      .select("id", { head: true, count: "exact" })
      .eq("writing_id", id);

    if (sharesError) {
      return jsonError(500, "DB_ERROR", sharesError.message);
    }

    if ((count ?? 0) > 0) {
      visibility = "shared";
    }
  }

  const writingRecord = {
    id,
    author_id: userId,
    ...parsed.data,
    status: normalizeWritingStatus(parsed.data.status),
    visibility,
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
    if (parsed.data.body_json != null) {
      await syncMarginsFromBodyJson(supabase, {
        bodyJson: parsed.data.body_json,
        writingId: id,
        readerId: userId,
      }).catch((error: { message?: string }) => {
        console.error("[writings:patch:sync-margins]", {
          writingId: id,
          userId,
          error: error.message ?? "Unknown error",
        })
      })
    }
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

      if (parsed.data.body_json != null) {
        await syncMarginsFromBodyJson(supabase, {
          bodyJson: parsed.data.body_json,
          writingId: id,
          readerId: userId,
        }).catch((error: { message?: string }) => {
          console.error("[writings:patch:sync-margins]", {
            writingId: id,
            userId,
            error: error.message ?? "Unknown error",
          })
        })
      }

      return NextResponse.json({ data: retriedWriting, error: null }, { status: 200 });
    }

    return jsonError(500, "DB_ERROR", insertError.message);
  }

  if (parsed.data.body_json != null) {
    await syncMarginsFromBodyJson(supabase, {
      bodyJson: parsed.data.body_json,
      writingId: id,
      readerId: userId,
    }).catch((error: { message?: string }) => {
      console.error("[writings:patch:sync-margins]", {
        writingId: id,
        userId,
        error: error.message ?? "Unknown error",
      })
    })
  }

  return NextResponse.json({ data: insertedWriting, error: null }, { status: 200 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await getCurrentUserFromRequest(request);
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

  const { error: sharesError } = await supabase
    .from("writing_shares")
    .delete()
    .eq("writing_id", id);

  if (sharesError) {
    console.error("[writings:delete:cascade]", { writingId: id, userId, operation: "delete_shares", error: sharesError.message });
  }

  const { error: invitationsError } = await supabase
    .from("invitations")
    .update({ status: "expired" })
    .eq("writing_id", id)
    .eq("marker", "ux-eval")
    .eq("status", "pending");

  if (invitationsError) {
    console.error("[writings:delete:cascade]", { writingId: id, userId, operation: "expire_invitations", error: invitationsError.message });
  }

  return NextResponse.json({ data, error: null }, { status: 200 });
}
