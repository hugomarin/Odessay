import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth";
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors";
import { normalizeLearnedWord } from "@/lib/corrections/learned-words";

const listQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createBodySchema = z.object({
  word: z.string().trim().min(1),
  language: z.enum(["es", "en", "mixed", "unknown"]).optional().default("unknown"),
});

const deleteBodySchema = z.object({
  id: z.string().uuid(),
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

export async function GET(request: Request) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const { userId } = await getCurrentUserFromRequest(request);

  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), request);
  }

  const parsedQuery = listQuerySchema.safeParse({
    cursor: new URL(request.url).searchParams.get("cursor") ?? undefined,
    limit: new URL(request.url).searchParams.get("limit") ?? undefined,
  });

  if (!parsedQuery.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", parsedQuery.error.message), request);
  }

  const supabase = createAdminClient();
  let query = supabase
    .from("learned_words")
    .select("id, word, language, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(parsedQuery.data.limit + 1);

  if (parsedQuery.data.cursor) {
    query = query.lt("created_at", parsedQuery.data.cursor);
  }

  const { data, error } = await query;

  if (error) {
    return withCorsHeaders(jsonError(500, "DB_ERROR", error.message), request);
  }

  const rows = data ?? [];
  const hasMore = rows.length > parsedQuery.data.limit;
  const items = rows.slice(0, parsedQuery.data.limit).map((item) => ({
    id: item.id,
    word: item.word,
    language: item.language,
    createdAt: item.created_at,
  }));

  return withCorsHeaders(NextResponse.json(
    {
      data: {
        items,
        nextCursor: hasMore ? items.at(-1)?.createdAt ?? null : null,
      },
      error: null,
    },
    { status: 200 },
  ), request);
}

export async function POST(request: Request) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const { userId } = await getCurrentUserFromRequest(request);

  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), request);
  }

  const parsedBody = createBodySchema.safeParse(await request.json());

  if (!parsedBody.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", parsedBody.error.message), request);
  }

  const normalizedWord = normalizeLearnedWord(parsedBody.data.word);

  if (!normalizedWord) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "word must contain at least one visible token."), request);
  }

  const supabase = createAdminClient();
  const payload = {
    user_id: userId,
    word: normalizedWord,
    language: parsedBody.data.language,
  };

  const { data, error } = await supabase
    .from("learned_words")
    .upsert(payload, { onConflict: "user_id,language,word" })
    .select("id, word, language, created_at")
    .single();

  if (error) {
    return withCorsHeaders(jsonError(500, "DB_ERROR", error.message), request);
  }

  return withCorsHeaders(NextResponse.json(
    {
      data: {
        id: data.id,
        word: data.word,
        language: data.language,
        createdAt: data.created_at,
      },
      error: null,
    },
    { status: 200 },
  ), request);
}

export async function DELETE(request: Request) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const { userId } = await getCurrentUserFromRequest(request);

  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), request);
  }

  const parsedBody = deleteBodySchema.safeParse(await request.json());

  if (!parsedBody.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", parsedBody.error.message), request);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("learned_words")
    .delete()
    .eq("user_id", userId)
    .eq("id", parsedBody.data.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return withCorsHeaders(jsonError(500, "DB_ERROR", error.message), request);
  }

  if (!data) {
    return withCorsHeaders(jsonError(404, "NOT_FOUND", "Learned word not found."), request);
  }

  return withCorsHeaders(NextResponse.json(
    {
      data: {
        deletedId: data.id,
      },
      error: null,
    },
    { status: 200 },
  ), request);
}

export async function OPTIONS(request: Request) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;
  return withCorsHeaders(new Response(null, { status: 204 }), request);
}
