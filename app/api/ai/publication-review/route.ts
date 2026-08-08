export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CORRECTION_ENGINE_REVISION,
  CORRECTION_PACKAGE_MAX_BLOCKS,
  CORRECTION_PACKAGE_MAX_CHARS,
  CORRECTION_PACKAGE_MAX_INPUT_TOKENS,
  CORRECTION_PACKAGE_OUTPUT_TOKENS,
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
  })).min(1).optional(),
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
    return;
  }

  const blocks = value.correctionBlocks ?? (value.correctionBlock ? [value.correctionBlock] : []);
  const charsPerToken = 3.8;
  const promptOverheadChars = 1_600;
  const blockOverheadChars = 32;

  if (blocks.length > CORRECTION_PACKAGE_MAX_BLOCKS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Package exceeds maximum block count (${CORRECTION_PACKAGE_MAX_BLOCKS}).`,
      path: ["correctionBlocks"],
    });
  }

  const bodyChars = blocks.reduce(
    (sum, block) => sum + block.text.length + block.id.length + blockOverheadChars,
    0,
  );

  if (bodyChars > CORRECTION_PACKAGE_MAX_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Package exceeds maximum character count (${CORRECTION_PACKAGE_MAX_CHARS}).`,
      path: ["correctionBlocks"],
    });
  }

  const estimatedInputTokens = Math.ceil((promptOverheadChars + bodyChars) / charsPerToken);

  if (estimatedInputTokens > CORRECTION_PACKAGE_MAX_INPUT_TOKENS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Package exceeds estimated input token budget (${CORRECTION_PACKAGE_MAX_INPUT_TOKENS}).`,
      path: ["correctionBlocks"],
    });
  }
});

type CorrectionsUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
};

type CorrectionRouteErrorDetails = {
  providerStatus?: number;
  providerBodyClass?: string;
  phase?: "provider" | "parse" | "config" | "request";
};

class CorrectionRouteError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  details: CorrectionRouteErrorDetails;

  constructor({
    status,
    code,
    message,
    retryable,
    details = {},
  }: {
    status: number;
    code: string;
    message: string;
    retryable: boolean;
    details?: CorrectionRouteErrorDetails;
  }) {
    super(message);
    this.name = "CorrectionRouteError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

const PROVIDER_REQUEST_TIMEOUT_MS = 45_000;

const classifyProviderBody = (body: string) => {
  const normalized = body.toLowerCase();

  if (!body.trim()) return "empty";
  if (normalized.includes("rate") || normalized.includes("quota")) return "rate_limit";
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "timeout";
  if (normalized.includes("schema") || normalized.includes("response_format")) return "structured_output_contract";
  if (normalized.includes("context") || normalized.includes("token")) return "token_budget_or_context";
  if (normalized.includes("invalid") || normalized.includes("bad request")) return "provider_contract";
  return "provider_error";
};

const jsonError = (
  status: number,
  code: string,
  message: string,
  options: { retryable?: boolean; details?: CorrectionRouteErrorDetails } = {},
) =>
  NextResponse.json(
    {
      data: null,
      error: {
        code,
        message,
        retryable: options.retryable ?? (status >= 500 || status === 429),
        ...(options.details ? { details: options.details } : {}),
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

const getCorrectionsMaxTokens = () => CORRECTION_PACKAGE_OUTPUT_TOKENS;

async function callCorrectionsModel({
  config,
  promptText,
  strictJson,
  structuredOutput = true,
}: {
  config: ReturnType<typeof getAIProviderConfig>;
  promptText: string;
  strictJson: boolean;
  structuredOutput?: boolean;
}): Promise<{ text: string; usage: CorrectionsUsage }> {
  const requestBody = {
    model: config.model,
    max_tokens: getCorrectionsMaxTokens(),
    temperature: strictJson ? 0 : 0.1,
    top_p: config.topP,
    reasoning_effort: "none",
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

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), PROVIDER_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(config.chatCompletionsUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${config.apiKey}`,
        "user-agent": "ArtifactStudio/1.0",
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    throw new CorrectionRouteError({
      status: isAbort ? 504 : 503,
      code: isAbort ? "TIMEOUT" : "UNAVAILABLE",
      message: isAbort
        ? "AI provider timed out while reviewing corrections."
        : "AI provider is unavailable for correction review.",
      retryable: true,
      details: { phase: "provider" },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorPayload = await response.text();
    const providerBodyClass = classifyProviderBody(errorPayload);
    console.info(
      `[corrections] provider error status=${response.status} bodyClass=${providerBodyClass}`,
    );

    if (response.status === 429) {
      throw new CorrectionRouteError({
        status: 429,
        code: "RATE_LIMITED",
        message: "AI provider rate limited correction review.",
        retryable: true,
        details: { phase: "provider", providerStatus: response.status, providerBodyClass },
      });
    }

    if (structuredOutput && (response.status === 400 || response.status === 422 || response.status >= 500)) {
      console.info(
        `[corrections] structured output provider failure status=${response.status}; retrying without response_format`,
      );
      return callCorrectionsModel({ config, promptText, strictJson: true, structuredOutput: false });
    }

    if (response.status === 400 || response.status === 422) {
      throw new CorrectionRouteError({
        status: 422,
        code: "AI_PROVIDER_CONTRACT_ERROR",
        message: "AI provider rejected the correction review contract.",
        retryable: false,
        details: { phase: "provider", providerStatus: response.status, providerBodyClass },
      });
    }

    if (response.status >= 500) {
      throw new CorrectionRouteError({
        status: 503,
        code: "UNAVAILABLE",
        message: "AI provider is unavailable for correction review.",
        retryable: true,
        details: { phase: "provider", providerStatus: response.status, providerBodyClass },
      });
    }

    throw new CorrectionRouteError({
      status: 502,
      code: "AI_PROVIDER_ERROR",
      message: "AI provider failed correction review.",
      retryable: response.status >= 500,
      details: { phase: "provider", providerStatus: response.status, providerBodyClass },
    });
  }

  let payload: {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };

  try {
    payload = await response.json();
  } catch {
    throw new CorrectionRouteError({
      status: 502,
      code: "AI_RESPONSE_PARSE_FAILED",
      message: "AI provider returned an invalid JSON response.",
      retryable: true,
      details: { phase: "parse", providerStatus: response.status },
    });
  }

  const text = payload.choices?.[0]?.message?.content ?? "";
  if (!text) {
    if (structuredOutput) {
      console.info("[corrections] model returned empty content with structured output; retrying without response_format");
      return callCorrectionsModel({ config, promptText, strictJson: true, structuredOutput: false });
    }
    throw new CorrectionRouteError({
      status: 502,
      code: "AI_RESPONSE_PARSE_FAILED",
      message: "AI provider returned an empty correction response.",
      retryable: true,
      details: { phase: "parse", providerStatus: response.status },
    });
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
      throw new CorrectionRouteError({
        status: 502,
        code: "AI_RESPONSE_PARSE_FAILED",
        message: "AI did not return valid correction JSON after retry.",
        retryable: true,
        details: { phase: "parse" },
      });
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
    engineRevision: CORRECTION_ENGINE_REVISION,
    contractVersion: "mechanical-corrections-v2" as const,
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
    return withCorsHeaders(jsonError(500, "MISSING_CONFIG", message, {
      retryable: false,
      details: { phase: "config" },
    }), request);
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Request body must be valid JSON.", {
      retryable: false,
      details: { phase: "request" },
    }), request);
  }

  const parsedRequest = requestSchema.safeParse(rawBody);

  if (!parsedRequest.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", parsedRequest.error.message, {
      retryable: false,
      details: { phase: "request" },
    }), request);
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
    const routeError = error instanceof CorrectionRouteError
      ? error
      : new CorrectionRouteError({
          status: 502,
          code: "AI_REVIEW_FAILED",
          message: error instanceof Error ? error.message : "Publication review request failed.",
          retryable: true,
          details: { phase: "provider" },
        });

    console.info(
      `[corrections] error totalRouteMs=${tEnd - tStart} code=${routeError.code} retryable=${routeError.retryable} message=${routeError.message}`,
    );

    return withCorsHeaders(
      jsonError(routeError.status, routeError.code, routeError.message, {
        retryable: routeError.retryable,
        details: routeError.details,
      }),
      request,
    );
  }
}

export async function OPTIONS(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight
  return withCorsHeaders(new Response(null, { status: 204 }), request)
}
