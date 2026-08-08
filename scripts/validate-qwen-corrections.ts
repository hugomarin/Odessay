/**
 * Validate the Fireworks Qwen 3.7 Plus mechanical-corrections contract.
 *
 * Usage:
 *   FIREWORKS_API_KEY=<key> FIREWORKS_MODEL=accounts/fireworks/models/qwen3p7-plus npx tsx scripts/validate-qwen-corrections.ts
 *
 * This script calls Fireworks directly (bypassing app auth) using the same
 * prompt, response_format and normalization that the Next.js route uses.
 * It prints the request, raw response, parsed JSON and normalized corrections.
 */

import {
  buildMechanicalCorrectionsPrompt,
  buildModelReadyCorrectionBlocks,
  normalizeCanonicalCorrections,
  restoreRealCorrectionBlockIds,
  type CorrectionBlock,
} from "@/lib/ai/corrections";
import { getAIProviderConfig } from "@/lib/ai/provider-config";
import { CORRECTION_PACKAGE_OUTPUT_TOKENS } from "@/lib/ai/corrections-config";

const MASKED_KEY_LENGTH = 8;

function maskKey(key: string | undefined): string {
  if (!key) return "(not set)";
  if (key.length <= MASKED_KEY_LENGTH * 2) return "***";
  return `${key.slice(0, MASKED_KEY_LENGTH)}...${key.slice(-MASKED_KEY_LENGTH)}`;
}

const SAMPLE_BLOCKS: CorrectionBlock[] = [
  {
    id: "correction-block:0.0:demo-a:12",
    text: "El producto funcioando correctamente gracias a un buen diseño.",
    hash: "hash-a",
  },
  {
    id: "correction-block:0.1:demo-b:64",
    text: "Hay que revisar la aplicació antes de publicarla.",
    hash: "hash-b",
  },
  {
    id: "correction-block:0.2:demo-c:110",
    text: "Solo asi tendremos una buen producto.",
    hash: "hash-c",
  },
  {
    id: "correction-block:0.3:demo-d:156",
    text: "El escritorio creo que esta bien ubicado.",
    hash: "hash-d",
  },
];

const LEARNED_WORDS: string[] = [];

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
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
};

function buildSystemPrompt(strictJson: boolean): string {
  const base = [
    "You are a JSON API for Artifact Studio mechanical corrections.",
    "Your response must match the MechanicalCorrectionsResponse JSON schema.",
    "Return exactly one valid JSON object and nothing else.",
    "The first character of your response must be { and the last character must be }.",
    "Do not include markdown fences, explanations, analysis, commentary, or prefaces.",
    "Never start with phrases like 'Let me analyze'.",
    "If there are no corrections, return an empty corrections array.",
  ].join(" ");

  return strictJson
    ? base
    : `${base} Return conservative mechanical corrections only.`;
}

async function callFireworks(
  config: ReturnType<typeof getAIProviderConfig>,
  promptText: string,
  structuredOutput: boolean,
): Promise<{ text: string; usage: { promptTokens: number | null; completionTokens: number | null; model: string } }> {
  const requestBody = {
    model: config.model,
    max_tokens: CORRECTION_PACKAGE_OUTPUT_TOKENS,
    temperature: structuredOutput ? 0 : 0.1,
    top_p: config.topP,
    reasoning_effort: "none",
    ...(structuredOutput ? { response_format: RESPONSE_FORMAT } : {}),
    messages: [
      { role: "system" as const, content: buildSystemPrompt(!structuredOutput) },
      { role: "user" as const, content: promptText },
    ],
  };

  const startedAt = Date.now();
  const response = await fetch(config.chatCompletionsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fireworks HTTP ${response.status}: ${body}`);
  }

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  const usage = json.usage ?? {};

  return {
    text,
    usage: {
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      model: json.model ?? config.model,
    },
  };
}

function extractJsonPayload(value: string): string {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();

  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return value;
  }
  return value.slice(firstBrace, lastBrace + 1);
}

async function main() {
  const apiKey = process.env.FIREWORKS_API_KEY;
  const model = process.env.FIREWORKS_MODEL;

  console.log("=== Qwen 3.7 Plus mechanical-corrections validator ===\n");
  console.log(`FIREWORKS_API_KEY: ${maskKey(apiKey)}`);
  console.log(`FIREWORKS_MODEL:   ${model ?? "(not set)"}\n`);

  if (!apiKey || !model) {
    console.error(
      "Missing FIREWORKS_API_KEY or FIREWORKS_MODEL.\n" +
        "Run with:\n" +
        '  FIREWORKS_API_KEY=<key> FIREWORKS_MODEL=accounts/fireworks/models/qwen3p7-plus npx tsx scripts/validate-qwen-corrections.ts',
    );
    process.exit(1);
  }

  let config;
  try {
    config = getAIProviderConfig();
  } catch (error) {
    console.error("Failed to load AI provider config:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log("Test blocks:");
  for (const block of SAMPLE_BLOCKS) {
    console.log(`  [${block.id}] ${block.text}`);
  }
  console.log();

  const { modelBlocks, idMap } = buildModelReadyCorrectionBlocks(SAMPLE_BLOCKS);
  const promptText = buildMechanicalCorrectionsPrompt(modelBlocks, LEARNED_WORDS);
  console.log("--- Prompt sent to model ---");
  console.log(promptText);
  console.log("--- End prompt ---\n");

  console.log(`Calling Fireworks ${config.chatCompletionsUrl} with structured output (json_schema)...`);
  let result = await callFireworks(config, promptText, true);

  if (!result.text.trim().startsWith("{")) {
    console.log("Structured output did not return JSON object; retrying without response_format...");
    result = await callFireworks(config, promptText, false);
  }

  console.log("\n--- Raw response ---");
  console.log(result.text);
  console.log("--- End raw response ---\n");

  console.log("Usage:", JSON.stringify(result.usage, null, 2), "\n");

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(result.text));
  } catch (error) {
    console.error("Failed to parse JSON:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (typeof parsed === "object" && parsed !== null) {
    const parsedObj = parsed as { corrections?: unknown[]; uncertain?: unknown[] };
    if (Array.isArray(parsedObj.corrections)) {
      parsedObj.corrections = restoreRealCorrectionBlockIds(
        parsedObj.corrections as { blockId: string }[],
        idMap,
      );
    }
    if (Array.isArray(parsedObj.uncertain)) {
      parsedObj.uncertain = restoreRealCorrectionBlockIds(
        parsedObj.uncertain as { blockId: string }[],
        idMap,
      );
    }
  }

  console.log("--- Parsed JSON ---");
  console.log(JSON.stringify(parsed, null, 2));
  console.log("--- End parsed JSON ---\n");

  const normalized = normalizeCanonicalCorrections(parsed, SAMPLE_BLOCKS, "es", LEARNED_WORDS);

  console.log("--- Normalized corrections ---");
  console.log(JSON.stringify(normalized, null, 2));
  console.log("--- End normalized corrections ---\n");

  console.log("Validation summary:");
  console.log(`  Language detected: ${normalized.language}`);
  console.log(`  Corrections returned: ${normalized.corrections.length}`);
  console.log(`  Uncertain items: ${normalized.uncertain.length}`);

  if (normalized.corrections.length === 0) {
    console.log("\n⚠️  Model returned zero corrections. Check the raw response above.");
  } else {
    console.log("\n✅ Model returned a valid, normalized correction set.");
  }
}

void main();
