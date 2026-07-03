export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { z } from "zod";
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
  }),
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
});

const BLOCK_CORRECTIONS_MAX_TOKENS = 768;

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

const getCorrectionsMaxTokens = () => BLOCK_CORRECTIONS_MAX_TOKENS;

async function callCorrectionsModel({
  config,
  promptText,
  strictJson,
  structuredOutput = true,
  _retries = 0,
}: {
  config: ReturnType<typeof getAIProviderConfig>;
  promptText: string;
  strictJson: boolean;
  structuredOutput?: boolean;
  _retries?: number;
}): Promise<{ text: string; usage: CorrectionsUsage }> {
  const requestBody = {
    model: config.model,
    max_tokens: getCorrectionsMaxTokens(),
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
      return callCorrectionsModel({ config, promptText, strictJson, structuredOutput, _retries: _retries + 1 });
    }

    if (structuredOutput && (response.status === 400 || response.status === 422)) {
      console.info("[corrections] structured output rejected; retrying without response_format");
      return callCorrectionsModel({ config, promptText, strictJson: true, structuredOutput: false });
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
      return callCorrectionsModel({ config, promptText, strictJson: true, structuredOutput: false });
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

async function callCorrectionsModelStreaming({
  config,
  promptText,
  onText,
}: {
  config: ReturnType<typeof getAIProviderConfig>;
  promptText: string;
  onText: (text: string) => void;
}) {
  const requestBody = {
    model: config.model,
    max_tokens: getCorrectionsMaxTokens(),
    temperature: 0,
    top_p: config.topP,
    stream: true,
    response_format: mechanicalCorrectionsResponseFormat,
    messages: [
      {
        role: "system",
        content: buildStrictJsonSystemPrompt(),
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
    console.info(`[corrections] stream error body=${errorPayload.slice(0, 500)}`);

    if (response.status === 400 || response.status === 422) {
      console.info("[corrections] streaming structured output rejected; falling back to non-stream strict JSON");
      const fallbackResponse = await callCorrectionsModel({
        config,
        promptText,
        strictJson: true,
        structuredOutput: false,
      });
      onText(fallbackResponse.text);
      return fallbackResponse.text;
    }

    throw new Error(`AI request failed (${response.status}): ${errorPayload}`);
  }

  if (!response.body) {
    throw new Error("AI streaming response did not include a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const consumeLine = (line: string) => {
    const trimmed = line.trim();

    if (!trimmed || !trimmed.startsWith("data:")) {
      return;
    }

    const data = trimmed.slice(5).trim();

    if (!data || data === "[DONE]") {
      return;
    }

    try {
      const event = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: string };
          message?: { content?: string };
          text?: string;
        }>;
      };
      const content =
        event.choices?.[0]?.delta?.content ??
        event.choices?.[0]?.message?.content ??
        event.choices?.[0]?.text ??
        "";

      if (content) {
        fullText += content;
        onText(fullText);
      }
    } catch {
      // Ignore malformed provider stream lines; final JSON validation below is authoritative.
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      consumeLine(line);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    consumeLine(buffer);
  }

  if (!fullText.trim()) {
    console.info("[corrections] provider stream ended without content; falling back to non-stream strict JSON");
    const fallbackResponse = await callCorrectionsModel({
      config,
      promptText,
      strictJson: true,
      structuredOutput: true,
    });
    onText(fallbackResponse.text);
    return fallbackResponse.text;
  }

  return fullText;
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

async function requestCorrections(requestBody: z.infer<typeof requestSchema>) {
  const t0 = Date.now();
  const config = getAIProviderConfig();
  const sourceText = requestBody.correctionBlock.text;
  const blocks = [
    {
      id: requestBody.correctionBlock.id,
      text: requestBody.correctionBlock.text,
      hash: requestBody.correctionBlock.hash,
    },
  ] satisfies CorrectionBlock[];
  const fallbackLanguage = detectCorrectionLanguage(sourceText);
  const learnedWords = getLearnedWordsFromRequest(requestBody);
  const promptText = buildMechanicalCorrectionsPrompt(blocks, learnedWords);

  console.info(
    `[corrections] start provider=${config.baseUrl} model=${config.model} blocks=${blocks.length} promptChars=${promptText.length}`,
  );

  const firstResponse = await callCorrectionsModel({ config, promptText, strictJson: false });
  const t1 = Date.now();
  console.info(`[corrections] first response latencyMs=${t1 - t0}`);

  try {
    const parsedJson = parseModelJson(firstResponse.text);
    const canonical = normalizeCanonicalCorrections(parsedJson, blocks, fallbackLanguage, learnedWords);
    const t2 = Date.now();
    console.info(`[corrections] first parse ok totalLatencyMs=${t2 - t0}`);
    return {
      model: config.model,
      blocks,
      canonical: applyMemory(canonical, requestBody.correctionMemory),
      usage: firstResponse.usage,
    };
  } catch {
    const firstJsonText = extractJsonPayload(firstResponse.text);
    console.info(`[corrections] first parse failed. textLength=${firstJsonText.length}`);
    console.info("[corrections] retrying with strict JSON mode");

    const retryResponse = await callCorrectionsModel({ config, promptText, strictJson: true });
    const retryJsonText = extractJsonPayload(retryResponse.text);

    try {
      const parsedJson = parseModelJson(retryResponse.text);
      const canonical = normalizeCanonicalCorrections(parsedJson, blocks, fallbackLanguage, learnedWords);
      const t2 = Date.now();
      console.info(`[corrections] retry parse ok totalLatencyMs=${t2 - t0}`);
      return {
        model: config.model,
        blocks,
        canonical: applyMemory(canonical, requestBody.correctionMemory),
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

const encodeNdjson = (value: unknown) => `${JSON.stringify(value)}\n`;

const createSuggestionEvents = ({
  requestBody,
  blocks,
  canonical,
}: {
  requestBody: z.infer<typeof requestSchema>;
  blocks: CorrectionBlock[];
  canonical: CanonicalCorrectionsResponse;
}) => {
  const adapted = adaptCorrectionsContract(canonical);
  const blockHashById = new Map(blocks.map((block) => [block.id, block.hash]));

  return adapted.legacy.suggestions.map((suggestion, index) => ({
    type: "suggestion" as const,
    sourceHash: requestBody.sourceHash,
    blockId: suggestion.block_id,
    blockHash: suggestion.block_id ? blockHashById.get(suggestion.block_id) ?? null : null,
    suggestion,
    index,
  }));
};

const createUncertainEvents = ({
  requestBody,
  canonical,
}: {
  requestBody: z.infer<typeof requestSchema>;
  canonical: CanonicalCorrectionsResponse;
}) => {
  const adapted = adaptCorrectionsContract(canonical);

  return adapted.legacy.checklist.map((item, index) => ({
    type: "uncertain" as const,
    sourceHash: requestBody.sourceHash,
    item,
    index,
  }));
};

const suggestionEventKey = (event: ReturnType<typeof createSuggestionEvents>[number]) =>
  [
    event.blockId ?? "",
    event.suggestion.kind,
    event.suggestion.original_text,
    event.suggestion.replacement_text,
    event.suggestion.reason,
  ].join("|");

const uncertainEventKey = (event: ReturnType<typeof createUncertainEvents>[number]) =>
  [event.item.target_text ?? "", event.item.detail].join("|");

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

const streamCorrectionsFromModel = ({
  requestBody,
}: {
  requestBody: z.infer<typeof requestSchema>;
}) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (value: unknown) => {
        controller.enqueue(encoder.encode(encodeNdjson(value)));
      };

      try {
        const t0 = Date.now();
        const config = getAIProviderConfig();
        const sourceText = requestBody.correctionBlock.text;
        const blocks = [
          {
            id: requestBody.correctionBlock.id,
            text: requestBody.correctionBlock.text,
            hash: requestBody.correctionBlock.hash,
          },
        ] satisfies CorrectionBlock[];
        const batchId = requestBody.correctionBlock.id;
        const fallbackLanguage = detectCorrectionLanguage(sourceText);
        const learnedWords = getLearnedWordsFromRequest(requestBody);
        const promptText = buildMechanicalCorrectionsPrompt(blocks, learnedWords);
        const emittedCorrections = new Set<string>();
        const emittedUncertain = new Set<string>();

        enqueue({
          type: "status",
          sourceHash: requestBody.sourceHash,
          status: "started",
        });

        const emitPartial = (text: string) => {
          try {
            const parsedJson = parseModelJson(text);
            const canonical = applyMemory(
              normalizeCanonicalCorrections(parsedJson, blocks, fallbackLanguage, learnedWords),
              requestBody.correctionMemory,
            );

            for (const correction of canonical.corrections) {
              const singleCanonical = {
                ...canonical,
                corrections: [correction],
                uncertain: [],
              } satisfies CanonicalCorrectionsResponse;
              const [event] = createSuggestionEvents({ requestBody, blocks, canonical: singleCanonical });

              if (event) {
                const key = suggestionEventKey(event);

                if (emittedCorrections.has(key)) {
                  continue;
                }

                emittedCorrections.add(key);
                enqueue(event);
              }
            }

            for (const uncertain of canonical.uncertain) {
              const singleCanonical = {
                ...canonical,
                corrections: [],
                uncertain: [uncertain],
              } satisfies CanonicalCorrectionsResponse;
              const [event] = createUncertainEvents({ requestBody, canonical: singleCanonical });

              if (event) {
                const key = uncertainEventKey(event);

                if (emittedUncertain.has(key)) {
                  continue;
                }

                emittedUncertain.add(key);
                enqueue(event);
              }
            }
          } catch {
            // Partial JSON is expected to be invalid until enough chunks have arrived.
          }
        };

        console.info(
          `[corrections] stream start provider=${config.baseUrl} model=${config.model} blocks=${blocks.length} promptChars=${promptText.length}`,
        );

        const streamedText = await callCorrectionsModelStreaming({ config, promptText, onText: emitPartial });
        let parsedJson: unknown;

        try {
          parsedJson = parseModelJson(streamedText);
        } catch (streamParseErr) {
          console.info(
            `[corrections] streamed JSON parse failed; falling back to non-stream strict JSON. error=${
              streamParseErr instanceof Error ? streamParseErr.message : String(streamParseErr)
            }`,
          );
          try {
            const fallbackResponse = await callCorrectionsModel({
              config,
              promptText,
              strictJson: true,
              structuredOutput: true,
            });
            emitPartial(fallbackResponse.text);
            parsedJson = parseModelJson(fallbackResponse.text);
          } catch (fallbackParseErr) {
            console.info(
              `[corrections] fallback JSON parse failed. error=${
                fallbackParseErr instanceof Error ? fallbackParseErr.message : String(fallbackParseErr)
              }`,
            );
            throw new Error("AI did not return valid correction JSON after retry.");
          }
        }

        const canonical = applyMemory(
          normalizeCanonicalCorrections(parsedJson, blocks, fallbackLanguage, learnedWords),
          requestBody.correctionMemory,
        );
        const payload = createJsonResponsePayload({
          requestBody,
          model: config.model,
          canonical,
        });

        enqueue({
          type: "meta",
          sourceHash: requestBody.sourceHash,
          sourceMarkdown: requestBody.markdown,
          model: config.model,
          language: payload.language,
          summary: payload.summary,
        });

        for (const event of createSuggestionEvents({ requestBody, blocks, canonical })) {
          const key = suggestionEventKey(event);

          if (!emittedCorrections.has(key)) {
            emittedCorrections.add(key);
            enqueue(event);
          }
        }

        for (const event of createUncertainEvents({ requestBody, canonical })) {
          const key = uncertainEventKey(event);

          if (!emittedUncertain.has(key)) {
            emittedUncertain.add(key);
            enqueue(event);
          }
        }

        enqueue({
          type: "done",
          data: payload,
        });
        logRequestMetrics({
          batchId,
          blockCount: blocks.length,
          model: config.model,
          latencyMs: Date.now() - t0,
        });
        console.info(`[corrections] stream success totalLatencyMs=${Date.now() - t0}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Publication review request failed.";
        console.info(`[corrections] stream error message=${message}`);
        enqueue({
          type: "error",
          sourceHash: requestBody.sourceHash,
          code: "AI_REVIEW_FAILED",
          message,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
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
    if (parsedRequest.data.stream) {
      return withCorsHeaders(streamCorrectionsFromModel({
        requestBody: parsedRequest.data,
      }), request);
    }

    const result = await requestCorrections(parsedRequest.data);
    const tEnd = Date.now();
    logRequestMetrics({
      batchId: parsedRequest.data.correctionBlock.id,
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
