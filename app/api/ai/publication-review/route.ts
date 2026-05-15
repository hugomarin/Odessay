export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildCorrectionBlocks,
  buildMechanicalCorrectionsPrompt,
  normalizeCanonicalCorrections,
  type CanonicalCorrectionsResponse,
  type CorrectionBlock,
} from "@/lib/ai/corrections";
import { filterCorrectionsByMemory } from "@/lib/ai/correction-memory";
import { adaptCorrectionsContract } from "@/lib/ai/corrections-contract-adapter";
import { detectCorrectionLanguage } from "@/lib/ai/language-detection";
import { getAIProviderConfig } from "@/lib/ai/provider-config";
import { createClient } from "@/lib/supabase/server";

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
  correctionMemory: z.object({
    entries: z.array(memoryEntrySchema).default([]),
  }).optional(),
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

async function getCurrentUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { userId: user?.id ?? null };
}

async function callCorrectionsModel({
  config,
  promptText,
  strictJson,
}: {
  config: ReturnType<typeof getAIProviderConfig>;
  promptText: string;
  strictJson: boolean;
}) {
  const response = await fetch(config.chatCompletionsUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.apiKey}`,
      "user-agent": "Odessay/1.0",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: strictJson ? 0 : 0.1,
      top_p: config.topP,
      messages: [
        {
          role: "system",
          content: strictJson
            ? "Return strictly valid JSON only: no markdown, no prose, no trailing commas."
            : "Return only valid JSON for conservative mechanical corrections.",
        },
        {
          role: "user",
          content: promptText,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    console.info(`[corrections] error body=${errorPayload.slice(0, 500)}`);
    throw new Error(`AI request failed (${response.status}): ${errorPayload}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = payload.choices?.[0]?.message?.content ?? "";
  if (!text) {
    throw new Error("AI returned an empty response.");
  }

  return text;
}

const applyMemory = (
  canonical: CanonicalCorrectionsResponse,
  correctionMemory: z.infer<typeof requestSchema>["correctionMemory"],
): CanonicalCorrectionsResponse => ({
  ...canonical,
  corrections: filterCorrectionsByMemory(canonical.corrections, correctionMemory),
});

async function requestCorrections(requestBody: z.infer<typeof requestSchema>) {
  const t0 = Date.now();
  const config = getAIProviderConfig();
  const sourceText = requestBody.bodyText.trim() || requestBody.markdown;
  const blocks = buildCorrectionBlocks(sourceText);
  const fallbackLanguage = detectCorrectionLanguage(sourceText);
  const promptText = buildMechanicalCorrectionsPrompt(blocks);

  console.info(
    `[corrections] start provider=${config.baseUrl} model=${config.model} blocks=${blocks.length} promptChars=${promptText.length}`,
  );

  const firstText = await callCorrectionsModel({ config, promptText, strictJson: false });
  const t1 = Date.now();
  console.info(`[corrections] first response latencyMs=${t1 - t0}`);

  try {
    const parsedJson = parseModelJson(firstText);
    const canonical = normalizeCanonicalCorrections(parsedJson, blocks, fallbackLanguage);
    const t2 = Date.now();
    console.info(`[corrections] first parse ok totalLatencyMs=${t2 - t0}`);
    return {
      model: config.model,
      blocks,
      canonical: applyMemory(canonical, requestBody.correctionMemory),
    };
  } catch {
    const firstJsonText = extractJsonPayload(firstText);
    console.info(`[corrections] first parse failed. textLength=${firstJsonText.length}`);
    console.info("[corrections] retrying with strict JSON mode");

    const retryText = await callCorrectionsModel({ config, promptText, strictJson: true });
    const retryJsonText = extractJsonPayload(retryText);

    try {
      const parsedJson = parseModelJson(retryText);
      const canonical = normalizeCanonicalCorrections(parsedJson, blocks, fallbackLanguage);
      const t2 = Date.now();
      console.info(`[corrections] retry parse ok totalLatencyMs=${t2 - t0}`);
      return {
        model: config.model,
        blocks,
        canonical: applyMemory(canonical, requestBody.correctionMemory),
      };
    } catch (retryErr) {
      console.info(`[corrections] retry parse failed. textLength=${retryJsonText.length}`);
      throw new Error(
        `AI returned invalid JSON: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
      );
    }
  }
}

const createJsonResponsePayload = ({
  requestBody,
  model,
  canonical,
}: {
  requestBody: z.infer<typeof requestSchema>;
  model: string;
  canonical: CanonicalCorrectionsResponse;
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
  };
};

const encodeNdjson = (value: unknown) => `${JSON.stringify(value)}\n`;

const streamCorrectionsResponse = ({
  requestBody,
  model,
  blocks,
  canonical,
}: {
  requestBody: z.infer<typeof requestSchema>;
  model: string;
  blocks: CorrectionBlock[];
  canonical: CanonicalCorrectionsResponse;
}) => {
  const encoder = new TextEncoder();
  const payload = createJsonResponsePayload({ requestBody, model, canonical });
  const blockHashById = new Map(blocks.map((block) => [block.id, block.hash]));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          encodeNdjson({
            type: "meta",
            sourceHash: requestBody.sourceHash,
            sourceMarkdown: requestBody.markdown,
            model,
            language: payload.language,
            summary: payload.summary,
          }),
        ),
      );

      payload.suggestions.forEach((suggestion, index) => {
        controller.enqueue(
          encoder.encode(
            encodeNdjson({
              type: "suggestion",
              sourceHash: requestBody.sourceHash,
              blockId: suggestion.block_id,
              blockHash: suggestion.block_id ? blockHashById.get(suggestion.block_id) ?? null : null,
              suggestion,
              index,
            }),
          ),
        );
      });

      payload.checklist.forEach((item, index) => {
        controller.enqueue(
          encoder.encode(
            encodeNdjson({
              type: "uncertain",
              sourceHash: requestBody.sourceHash,
              item,
              index,
            }),
          ),
        );
      });

      controller.enqueue(
        encoder.encode(
          encodeNdjson({
            type: "done",
            data: payload,
          }),
        ),
      );
      controller.close();
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
  const tStart = Date.now();
  console.info("[corrections] POST start");

  const { userId } = await getCurrentUserId();
  const tAuth = Date.now();
  console.info(`[corrections] auth done authMs=${tAuth - tStart}`);

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  try {
    getAIProviderConfig();
  } catch (configErr) {
    const message = configErr instanceof Error ? configErr.message : "AI provider not configured.";
    return jsonError(500, "MISSING_CONFIG", message);
  }

  const rawBody = await request.json();
  const parsedRequest = requestSchema.safeParse(rawBody);

  if (!parsedRequest.success) {
    return jsonError(400, "INVALID_INPUT", parsedRequest.error.message);
  }

  try {
    const result = await requestCorrections(parsedRequest.data);
    const tEnd = Date.now();
    console.info(`[corrections] success totalRouteMs=${tEnd - tStart}`);

    if (parsedRequest.data.stream) {
      return streamCorrectionsResponse({
        requestBody: parsedRequest.data,
        model: result.model,
        blocks: result.blocks,
        canonical: result.canonical,
      });
    }

    return NextResponse.json(
      {
        data: createJsonResponsePayload({
          requestBody: parsedRequest.data,
          model: result.model,
          canonical: result.canonical,
        }),
        error: null,
      },
      { status: 200 },
    );
  } catch (error) {
    const tEnd = Date.now();
    const message = error instanceof Error ? error.message : "Publication review request failed.";
    console.info(`[corrections] error totalRouteMs=${tEnd - tStart} message=${message}`);

    return jsonError(502, "AI_REVIEW_FAILED", message);
  }
}
