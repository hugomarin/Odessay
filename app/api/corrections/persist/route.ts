import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth";
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors";
import { findLogicalStaleCorrectionBlocks } from "@/lib/corrections/block-invalidation";

const publicationSuggestionSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(["spelling", "grammar", "punctuation", "rewriting"]),
  title: z.string().trim().min(1),
  reason: z.string().catch(""),
  original_text: z.string().trim().min(1),
  replacement_text: z.string().trim().min(1),
  context_before: z.string().nullable().optional(),
  context_after: z.string().nullable().optional(),
  occurrence: z.number().int().min(0).nullable().optional(),
  block_id: z.string().nullable().optional(),
  source_hash: z.string().nullable().optional(),
  correction_fingerprint: z.string().nullable().optional(),
  status: z.enum(["pending", "pending-stale", "accepted", "rejected", "conflict"]),
});

const persistedCorrectionBlockSchema = z.object({
  id: z.string().trim().min(1),
  writing_id: z.string().uuid(),
  block_id: z.string().trim().min(1),
  block_hash: z.string().trim().min(1),
  suggestions: z.array(publicationSuggestionSchema),
  model: z.string().trim().min(1),
  created_at: z.string().datetime(),
  latency_ms: z.number().int().nullable(),
  prompt_tokens: z.number().int().nullable(),
  completion_tokens: z.number().int().nullable(),
});

const requestSchema = z
  .object({
    writingId: z.string().uuid().optional(),
    block: persistedCorrectionBlockSchema.optional(),
    deletedBlockIds: z.array(z.string().trim().min(1)).default([]),
  })
  .refine((value) => value.block || value.deletedBlockIds.length > 0, {
    message: "A block or deletedBlockIds is required.",
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

async function ensureOwnedWriting(supabase: ReturnType<typeof createAdminClient>, userId: string, writingId: string) {
  const { data, error } = await supabase
    .from("writings")
    .select("id")
    .eq("id", writingId)
    .eq("author_id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, response: jsonError(500, "DB_ERROR", error.message) };
  }

  if (!data) {
    return {
      ok: false as const,
      response: jsonError(403, "FORBIDDEN", "Writing not found or access denied."),
    };
  }

  return { ok: true as const };
}

async function resolveStalePersistedBlockIds(
  supabase: ReturnType<typeof createAdminClient>,
  writingId: string,
  block: z.infer<typeof persistedCorrectionBlockSchema>,
) {
  const { data, error } = await supabase
    .from("correction_blocks")
    .select("id, block_id, block_hash")
    .eq("writing_id", writingId)

  if (error) {
    return { data: null, error }
  }

  const staleBlocks = findLogicalStaleCorrectionBlocks(
    (data ?? []).map((candidate) => ({
      id: candidate.id,
      blockId: candidate.block_id,
      blockHash: candidate.block_hash,
    })),
    {
      id: block.block_id,
      hash: block.block_hash,
    },
  )

  return {
    data: staleBlocks.map((candidate) => candidate.id),
    error: null,
  }
}

export async function POST(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const { userId } = await getCurrentUserFromRequest(request);

  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), request);
  }

  const rawBody = await request.json();
  const parsedBody = requestSchema.safeParse(rawBody);

  if (!parsedBody.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", parsedBody.error.message), request);
  }

  const effectiveWritingId = parsedBody.data.block?.writing_id ?? parsedBody.data.writingId;

  if (!effectiveWritingId) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "writingId is required."), request);
  }

  if (parsedBody.data.block && parsedBody.data.block.writing_id !== effectiveWritingId) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "block.writing_id must match writingId."), request);
  }

  const supabase = createAdminClient();
  const ownership = await ensureOwnedWriting(supabase, userId, effectiveWritingId);

  if (!ownership.ok) {
    return withCorsHeaders(ownership.response, request);
  }

  const staleBlockIds =
    parsedBody.data.block
      ? await resolveStalePersistedBlockIds(supabase, effectiveWritingId, parsedBody.data.block)
      : { data: [] as string[], error: null }

  if (staleBlockIds.error) {
    return withCorsHeaders(jsonError(500, "DB_ERROR", staleBlockIds.error.message), request);
  }

  const deletedBlockIds = [...new Set([...parsedBody.data.deletedBlockIds, ...(staleBlockIds.data ?? [])])]

  if (deletedBlockIds.length > 0) {
    const { error } = await supabase
      .from("correction_blocks")
      .delete()
      .eq("writing_id", effectiveWritingId)
      .in("id", deletedBlockIds);

    if (error) {
      return withCorsHeaders(jsonError(500, "DB_ERROR", error.message), request);
    }
  }

  if (!parsedBody.data.block) {
    return withCorsHeaders(NextResponse.json(
      {
        data: {
          persistedId: null,
          deletedIds: deletedBlockIds,
          syncedAt: new Date().toISOString(),
        },
        error: null,
      },
      { status: 200 },
    ), request);
  }

  const { data, error } = await supabase
    .from("correction_blocks")
    .upsert(parsedBody.data.block, { onConflict: "id" })
    .select("id")
    .single();

  if (error) {
    return withCorsHeaders(jsonError(500, "DB_ERROR", error.message), request);
  }

  return withCorsHeaders(NextResponse.json(
    {
      data: {
        persistedId: data.id,
        deletedIds: deletedBlockIds,
        syncedAt: new Date().toISOString(),
      },
      error: null,
    },
    { status: 200 },
  ), request);
}

export async function OPTIONS(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight
  return withCorsHeaders(new Response(null, { status: 204 }), request)
}
