import { describe, expect, it } from "vitest"
import { getOpenAIWorkspaceProviderConfig } from "@/lib/ai/openai-workspace-provider-config"
import {
  buildWorkspaceAskSystemPrompt,
  buildWorkspaceAskUserPrompt,
  workspaceAskResponseSchema,
  workspaceAskTextFormat,
} from "@/lib/ai/workspace-ask"
import type { WorkspaceAskRequest } from "@/lib/services/contracts/ai-service"
import {
  countWorkspaceCompactionItems,
  createWorkspaceExecutionContext,
} from "@/lib/ai/workspace-execution-receipt"
import { callWorkspaceOpenAIResponse } from "@/lib/ai/workspace-openai-response"

const liveEnabled = process.env.RUN_OPENAI_LIVE_TESTS === "1"
  && Boolean(process.env.OPENAI_API_KEY?.trim())
const compactionEnabled = liveEnabled
  && process.env.RUN_OPENAI_COMPACTION_TESTS === "1"
  && Boolean(process.env.OPENAI_WORKSPACE_COMPACTION_THRESHOLD_TOKENS?.trim())

function responseText(response: Awaited<ReturnType<typeof callWorkspaceOpenAIResponse>>): string {
  return response.payload.output_text
    ?? response.payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text")
      .map((content) => content.text ?? "")
      .join("")
    ?? ""
}

function askRequest(): WorkspaceAskRequest {
  return {
    question: "What storage decision does the selected document make?",
    targetDocumentIds: ["live-doc"],
    documents: [{
      id: "live-doc",
      title: "Live acceptance document",
      relativePath: "acceptance/live.md",
      currentArtifactType: null,
      currentStatus: null,
      visibility: null,
      version: 1,
      modifiedAt: 1_700_000_000_000,
      excerpt: null,
      references: [],
      markdown: "# Storage\n\nThe canonical storage decision for this acceptance test is SQLite.\n",
    }],
    collections: [],
    documentCollectionIds: {},
    annotations: [],
    workflow: null,
    catalogTruncated: false,
    focusedDocumentId: "live-doc",
    scopeFingerprint: "scope:live-acceptance",
  }
}

describe.skipIf(!liveEnabled)("Workspace Agent with real OpenAI Responses", () => {
  it("keeps a real Ask response chain across two turns and validates structured output", async () => {
    const config = getOpenAIWorkspaceProviderConfig()
    const execution = createWorkspaceExecutionContext("ask", "cloud", "analysis")
    const systemPrompt = buildWorkspaceAskSystemPrompt()
    const first = await callWorkspaceOpenAIResponse({
      config,
      execution,
      systemPrompt,
      userPrompt: buildWorkspaceAskUserPrompt(askRequest()),
      maxOutputTokens: Math.max(512, config.maxOutputTokens),
      timeoutMs: 60_000,
      textFormat: workspaceAskTextFormat,
      contextManagement: config.compactionThresholdTokens
        ? [{ type: "compaction", compact_threshold: config.compactionThresholdTokens }]
        : undefined,
      messages: {
        unavailable: "OpenAI unavailable",
        timeout: "OpenAI timed out",
        rateLimited: "OpenAI rate limited",
        contractRejected: "OpenAI rejected the contract",
        authRejected: "OpenAI rejected the credentials",
        providerFailed: "OpenAI failed",
        parseFailed: "OpenAI returned invalid output",
      },
    })

    expect(first.payload.id).toMatch(/^resp_/)
    const firstPayload = workspaceAskResponseSchema.parse(JSON.parse(responseText(first)))
    expect(firstPayload.answer.toLocaleLowerCase()).toContain("sqlite")

    const second = await callWorkspaceOpenAIResponse({
      config,
      execution,
      systemPrompt,
      userPrompt: "What storage did you just identify in the selected document? Return the same JSON contract.",
      maxOutputTokens: Math.max(512, config.maxOutputTokens),
      timeoutMs: 60_000,
      textFormat: workspaceAskTextFormat,
      previousResponseId: first.payload.id,
      contextManagement: config.compactionThresholdTokens
        ? [{ type: "compaction", compact_threshold: config.compactionThresholdTokens }]
        : undefined,
      messages: {
        unavailable: "OpenAI unavailable",
        timeout: "OpenAI timed out",
        rateLimited: "OpenAI rate limited",
        contractRejected: "OpenAI rejected the contract",
        authRejected: "OpenAI rejected the credentials",
        providerFailed: "OpenAI failed",
        parseFailed: "OpenAI returned invalid output",
      },
    })

    expect(second.payload.id).toMatch(/^resp_/)
    expect(second.payload.id).not.toBe(first.payload.id)
    expect(second.receipt.responses.at(-1)?.previousResponseId).toBe(first.payload.id)
    const secondPayload = workspaceAskResponseSchema.parse(JSON.parse(responseText(second)))
    expect(secondPayload.answer.toLocaleLowerCase()).toContain("sqlite")
  }, 180_000)
})

describe.skipIf(!compactionEnabled)("Workspace Agent native compaction acceptance", () => {
  it("records at least two real compaction items while preserving the response chain", async () => {
    const config = getOpenAIWorkspaceProviderConfig()
    if (!config.compactionThresholdTokens) throw new Error("Compaction threshold is required for this acceptance test.")
    const execution = createWorkspaceExecutionContext("ask", "cloud", "analysis")
    const systemPrompt = "You are a continuity probe. Reply with one short sentence."
    const contextManagement = [{ type: "compaction", compact_threshold: config.compactionThresholdTokens }]
    const receipts: Awaited<ReturnType<typeof callWorkspaceOpenAIResponse>>["receipt"][] = []
    let previousResponseId: string | null = null

    for (let turn = 0; turn < 8; turn += 1) {
      const response = await callWorkspaceOpenAIResponse({
        config,
        execution,
        systemPrompt,
        userPrompt: `Turn ${turn + 1}. Preserve this opaque continuity marker exactly: ${"context-marker-".repeat(700)}`,
        maxOutputTokens: Math.min(512, config.maxOutputTokens),
        timeoutMs: 60_000,
        textFormat: null,
        previousResponseId,
        contextManagement,
        messages: {
          unavailable: "OpenAI unavailable",
          timeout: "OpenAI timed out",
          rateLimited: "OpenAI rate limited",
          contractRejected: "OpenAI rejected the contract",
          authRejected: "OpenAI rejected the credentials",
          providerFailed: "OpenAI failed",
          parseFailed: "OpenAI returned invalid output",
        },
      })
      expect(response.payload.id).toMatch(/^resp_/)
      receipts.push(response.receipt)
      previousResponseId = response.payload.id ?? null
    }

    const compactionCount = receipts.reduce(
      (total, receipt) => total + countWorkspaceCompactionItems(receipt),
      0,
    )
    expect(compactionCount).toBeGreaterThanOrEqual(2)
    expect(receipts.slice(1).every((receipt, index) => (
      receipt.responses.at(-1)?.previousResponseId === receipts[index]?.responses.at(-1)?.responseId
    ))).toBe(true)
  }, 600_000)
})
