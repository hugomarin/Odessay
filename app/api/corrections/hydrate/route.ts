import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth";
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors";

const querySchema = z.object({
  writingId: z.string().uuid(),
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
  const { data: writing, error: findError } = await supabase
    .from("writings")
    .select("id, author_id")
    .eq("id", writingId)
    .maybeSingle();

  if (findError) {
    return { ok: false as const, response: jsonError(500, "DB_ERROR", findError.message) };
  }

  if (!writing) {
    return {
      ok: false as const,
      response: jsonError(404, "NOT_FOUND", "Writing not found."),
    };
  }

  if (writing.author_id !== userId) {
    return {
      ok: false as const,
      response: jsonError(403, "FORBIDDEN", "Writing access denied."),
    };
  }

  return { ok: true as const };
}

export async function GET(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const { userId } = await getCurrentUserFromRequest(request);

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  const parsedQuery = querySchema.safeParse({
    writingId: new URL(request.url).searchParams.get("writingId"),
  });

  if (!parsedQuery.success) {
    return jsonError(400, "INVALID_INPUT", parsedQuery.error.message);
  }

  const supabase = createAdminClient();
  const ownership = await ensureOwnedWriting(supabase, userId, parsedQuery.data.writingId);

  if (!ownership.ok) {
    return ownership.response;
  }

  const { data, error } = await supabase
    .from("correction_blocks")
    .select(
      "id, writing_id, block_id, block_hash, suggestions, model, created_at, latency_ms, prompt_tokens, completion_tokens",
    )
    .eq("writing_id", parsedQuery.data.writingId)
    .order("created_at", { ascending: true });

  if (error) {
    return jsonError(500, "DB_ERROR", error.message);
  }

  return withCorsHeaders(NextResponse.json({ data: data ?? [], error: null }, { status: 200 }), request);
}

export async function OPTIONS(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight
  return withCorsHeaders(new Response(null, { status: 204 }), request)
}
