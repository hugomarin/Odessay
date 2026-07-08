export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BLOCK_CORRECTIONS_MAX_TOKENS,
  CORRECTION_BLOCK_BATCH_SIZE,
} from "@/lib/ai/corrections-config";
import {
  buildMechanicalCorrectionsPrompt,
  normalizeCanonicalCorrections,
  type CanonicalCorrectionsResponse,
  type CorrectionBlock,
} from "@/lib/ai/corrections";
import { filterCorrectionsByMemory } from "@/lib/ai/correction-memory";
import { adaptCorrectionsContract } from "@/lib/ai/corrections-contract-adapter";
import { detectCorrectionLanguage } from "@/lib/ai/language-detection";
import { getAIProviderConfig } from "@/lib/ai/provider-config";
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth";
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors";
import { createLearnedWordSet } from "@/lib/corrections/learned-words";

const memoryEntrySchema = z.object({
  fingerprint: z.string().trim().min(1),
  decision: z.enum(["accepted", "rejected"]),
  decidedAt: z.string().trim().min(1),
});

const requestSchema = z.object({
  writingId: z.string().trim().min(1).optional(),
  title: z.string().trim().max(160).default("Untitled writing"),
  markdown: z.string().trim().min(1),
  bodyText: z.string().default(""),
  sourceHash: z.string().trim().min(1),
  stream: z.boolean().optional().default(false),
  correctionBlock: z.object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    hash: z.string().trim().min(1),
  }).optional(),
  correctionBlocks: z.array(z.object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    hash: z.string().trim().min(1),
  })).min(1).max(CORRECTION_BLOCK_BATCH_SIZE).optional(),
  correctionMemory: z.object({
    entries: z.array(memoryEntrySchema).default([]),
  }).optional(),
  learnedWords: z.object({
    entries: z.array(
      z.object({
        word: z.string().trim().min(1),
        language: z.enum(["es", "en", "mixed", "unknown"]).optional().nullable(),
      }),
    ).default([]),
  }).optional(),
}).superRefine((value, ctx) => {
  if (!value.correctionBlock && !value.correctionBlocks) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either correctionBlock or correctionBlocks is required.",
      path: ["correctionBlocks"],
    });
  }
});

type CorrectionsUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
};

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

const extractJsonPayload = (value: string) => {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return value;
  }

  return value.slice(firstBrace, lastBrace + 1);
};

const parseModelJson = (text: string) => {
  const jsonText = extractJsonPayload(text);
  return JSON.parse(jsonText);
};

const buildStrictJsonSystemPrompt = () =>
  [
    "You are a JSON API for Artifact Studio mechanical corrections.",
    "Your response must match the MechanicalCorrectionsResponse JSON schema.",
    "Return exactly one valid JSON object and nothing else.",
    "The first character of your response must be { and the last character must be }.",
    "Do not include markdown fences, explanations, analysis, commentary, or prefaces.",
    "Never start with phrases like 'Let me analyze'.",
    "If there are no corrections, return an empty corrections array.",
  ].join(" ");

const mechanicalCorrectionsResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "MechanicalCorrectionsResponse",
    schema: {
      type: "object",
      properties: {
        language: { type: "string" },
        corrections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              blockId: { type: "string" },
              type: { type: "string" },
              originalText: { type: "string" },
              replacementText: { type: "string" },
            },
            required: ["blockId", "type", "originalText", "replacementText"],
          },
        },
      },
      required: ["language", "corrections"],
    },
  },
} as const;

const getCorrectionsMaxTokens = (blockCount: number) => BLOCK_CORRECTIONS_MAX_TOKENS * Math.max(1, blockCount);

async function callCorrectionsModel({
  config,
  promptText,
  blockCount,
  strictJson,
  structuredOutput = true,
  _retries = 0,
}: {
  config: ReturnType<typeof getAIProviderConfig>;
  promptText: string;
  blockCount: number;
  strictJson: boolean;
  structuredOutput?: boolean;
  _retries?: number;
}): Promise<{ text: string; usage: CorrectionsUsage }> {
  const requestBody = {
    model: config.model,
    max_tokens: getCorrectionsMaxTokens(blockCount),
    temperature: strictJson ? 0 : 0.1,
    top_p: config.topP,
    ...(structuredOutput ? { response_format: mechanicalCorrectionsResponseFormat } : {}),
    messages: [
      {
        role: "system",
        content: strictJson
          ? buildStrictJsonSystemPrompt()
          : `${buildStrictJsonSystemPrompt()} Return conservative mechanical corrections only.`,
      },
      {
        role: "user",
        content: promptText,
      },
    ],
  };

  const response = await fetch(config.chatCompletionsUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.apiKey}`,
      "user-agent": "ArtifactStudio/1.0",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    console.info(`[corrections] error body=${errorPayload.slice(0, 500)}`);

    if (response.status === 429 && _retries < 3) {
      const retryAfterMs = Number(response.headers.get("retry-after") ?? 0) * 1000 || 3000 * (_retries + 1);
      console.info(`[corrections] rate limited; retrying after ${retryAfterMs}ms (attempt ${_retries + 1})`);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      return callCorrectionsModel({ config, promptText, blockCount, strictJson, structuredOutput, _retries: _retries + 1 });
    }

    if (structuredOutput && (response.status === 400 || response.status === 422)) {
      console.info("[corrections] structured output rejected; retrying without response_format");
      return callCorrectionsModel({ config, promptText, blockCount, strictJson: true, structuredOutput: false });
    }

    throw new Error(`AI request failed (${response.status}): ${errorPayload}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };

  const text = payload.choices?.[0]?.message?.content ?? "";
  if (!text) {
    if (structuredOutput) {
      console.info("[corrections] model returned empty content with structured output; retrying without response_format");
      return callCorrectionsModel({ config, promptText, blockCount, strictJson: true, structuredOutput: false });
    }
    throw new Error("AI returned an empty response.");
  }

  return {
    text,
    usage: {
      promptTokens: payload.usage?.prompt_tokens ?? null,
      completionTokens: payload.usage?.completion_tokens ?? null,
    },
  };
}

const applyMemory = (
  canonical: CanonicalCorrectionsResponse,
  correctionMemory: z.infer<typeof requestSchema>["correctionMemory"],
): CanonicalCorrectionsResponse => ({
  ...canonical,
  corrections: filterCorrectionsByMemory(canonical.corrections, correctionMemory),
});

const getLearnedWordsFromRequest = (requestBody: z.infer<typeof requestSchema>) =>
  [...createLearnedWordSet((requestBody.learnedWords?.entries ?? []).map((entry) => entry.word))];

const getCorrectionBlocksFromRequest = (requestBody: z.infer<typeof requestSchema>): CorrectionBlock[] =>
  requestBody.correctionBlocks ?? (requestBody.correctionBlock ? [requestBody.correctionBlock] : []);

const normalizeCorrectionModelText = ({
  text,
  blocks,
  fallbackLanguage,
  learnedWords,
  correctionMemory,
}: {
  text: string;
  blocks: CorrectionBlock[];
  fallbackLanguage: ReturnType<typeof detectCorrectionLanguage>;
  learnedWords: string[];
  correctionMemory: z.infer<typeof requestSchema>["correctionMemory"];
}) => {
  const parsedJson = parseModelJson(text);
  const canonical = normalizeCanonicalCorrections(parsedJson, blocks, fallbackLanguage, learnedWords);

  return applyMemory(canonical, correctionMemory);
};

async function requestCorrections(requestBody: z.infer<typeof requestSchema>) {
  const t0 = Date.now();
  const config = getAIProviderConfig();
  const blocks = getCorrectionBlocksFromRequest(requestBody);
  const sourceText = blocks.map((block) => block.text).join("\n\n");
  const fallbackLanguage = detectCorrectionLanguage(sourceText);
  const learnedWords = getLearnedWordsFromRequest(requestBody);
  const promptText = buildMechanicalCorrectionsPrompt(blocks, learnedWords);

  console.info(
    `[corrections] start provider=${config.baseUrl} model=${config.model} blocks=${blocks.length} promptChars=${promptText.length}`,
  );

  const firstResponse = await callCorrectionsModel({
    config,
    promptText,
    blockCount: blocks.length,
    strictJson: false,
  });
  const t1 = Date.now();
  console.info(`[corrections] first response latencyMs=${t1 - t0}`);

  try {
    const canonical = normalizeCorrectionModelText({
      text: firstResponse.text,
      blocks,
      fallbackLanguage,
      learnedWords,
      correctionMemory: requestBody.correctionMemory,
    });
    const t2 = Date.now();
    console.info(`[corrections] first parse ok totalLatencyMs=${t2 - t0}`);
    return {
      model: config.model,
      blocks,
      canonical,
      usage: firstResponse.usage,
    };
  } catch {
    const firstJsonText = extractJsonPayload(firstResponse.text);
    console.info(`[corrections] first parse failed. textLength=${firstJsonText.length}`);
    console.info("[corrections] retrying with strict JSON mode");

    const retryResponse = await callCorrectionsModel({
      config,
      promptText,
      blockCount: blocks.length,
      strictJson: true,
    });
    const retryJsonText = extractJsonPayload(retryResponse.text);

    try {
      const canonical = normalizeCorrectionModelText({
        text: retryResponse.text,
        blocks,
        fallbackLanguage,
        learnedWords,
        correctionMemory: requestBody.correctionMemory,
      });
      const t2 = Date.now();
      console.info(`[corrections] retry parse ok totalLatencyMs=${t2 - t0}`);
      return {
        model: config.model,
        blocks,
        canonical,
        usage: retryResponse.usage,
      };
    } catch (retryErr) {
      console.info(`[corrections] retry parse failed. textLength=${retryJsonText.length}`);
      console.info(
        `[corrections] retry parse error=${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
      );
      throw new Error("AI did not return valid correction JSON after retry.");
    }
  }
}

const createJsonResponsePayload = ({
  requestBody,
  model,
  canonical,
  usage,
}: {
  requestBody: z.infer<typeof requestSchema>;
  model: string;
  canonical: CanonicalCorrectionsResponse;
  usage?: CorrectionsUsage;
}) => {
  const adapted = adaptCorrectionsContract(canonical);

  return {
    sourceHash: requestBody.sourceHash,
    sourceMarkdown: requestBody.markdown,
    model,
    contractVersion: "mechanical-corrections-v1" as const,
    canonicalReview: adapted.canonical,
    language: adapted.canonical.language,
    corrections: adapted.canonical.corrections,
    uncertain: adapted.canonical.uncertain,
    suggestions: adapted.legacy.suggestions,
    checklist: adapted.legacy.checklist,
    summary: adapted.legacy.summary,
    fallbackUsed: false,
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
  };
};

const logRequestMetrics = ({
  batchId,
  blockCount,
  model,
  latencyMs,
  usage,
}: {
  batchId: string;
  blockCount: number;
  model: string;
  latencyMs: number;
  usage?: CorrectionsUsage;
}) => {
  console.info({
    batchId,
    blockCount,
    model,
    latencyMs,
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
  });
};

export async function POST(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const tStart = Date.now();
  console.info("[corrections] POST start");

  const { userId } = await getCurrentUserFromRequest(request);
  const tAuth = Date.now();
  console.info(`[corrections] auth done authMs=${tAuth - tStart}`);

  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), request);
  }

  try {
    getAIProviderConfig();
  } catch (configErr) {
    const message = configErr instanceof Error ? configErr.message : "AI provider not configured.";
    return withCorsHeaders(jsonError(500, "MISSING_CONFIG", message), request);
  }

  const rawBody = await request.json();
  const parsedRequest = requestSchema.safeParse(rawBody);

  if (!parsedRequest.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", parsedRequest.error.message), request);
  }

  try {
    const result = await requestCorrections(parsedRequest.data);
    const tEnd = Date.now();
    logRequestMetrics({
      batchId: getCorrectionBlocksFromRequest(parsedRequest.data).map((block) => block.id).join(","),
      blockCount: result.blocks.length,
      model: result.model,
      latencyMs: tEnd - tStart,
      usage: result.usage,
    });
    console.info(`[corrections] success totalRouteMs=${tEnd - tStart}`);

    return withCorsHeaders(NextResponse.json(
      {
        data: createJsonResponsePayload({
          requestBody: parsedRequest.data,
          model: result.model,
          canonical: result.canonical,
          usage: result.usage,
        }),
        error: null,
      },
      { status: 200 },
    ), request);
  } catch (error) {
    const tEnd = Date.now();
    const message = error instanceof Error ? error.message : "Publication review request failed.";
    console.info(`[corrections] error totalRouteMs=${tEnd - tStart} message=${message}`);

    return withCorsHeaders(jsonError(502, "AI_REVIEW_FAILED", message), request);
  }
}

export async function OPTIONS(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight
  return withCorsHeaders(new Response(null, { status: 204 }), request)
}
