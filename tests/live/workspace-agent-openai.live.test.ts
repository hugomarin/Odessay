import { describe, expect, it } from "vitest"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
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
const liveReportPath = process.env.OPENAI_LIVE_REPORT_PATH?.trim()
let liveReportInitialized = false

type LiveScenarioEvidence = {
  documentWordCount?: number
  documentCount?: number
  schema: string | null
  responseTraces: unknown[]
  assertions: Record<string, boolean>
}

function recordLiveEvidence(
  model: string,
  scenario: "short_continuity" | "long_document" | "whole_workspace_over_six" | "provider_incomplete" | "native_compaction",
  evidence: LiveScenarioEvidence,
): void {
  if (!liveReportPath) return
  const path = resolve(liveReportPath)
  mkdirSync(dirname(path), { recursive: true })
  const shouldReuseReport = liveReportInitialized
    || (process.env.OPENAI_LIVE_REPORT_RESET !== "1" && existsSync(path))
  const report = shouldReuseReport
    ? JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    : {
        generatedAt: new Date().toISOString(),
        provider: "openai",
        model,
        contract: "Workspace Agent real Responses smoke",
        storesPromptOrDocumentContent: false,
        scenarios: {},
      }
  const scenarios = report.scenarios as Record<string, LiveScenarioEvidence>
  scenarios[scenario] = evidence
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  liveReportInitialized = true
}

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

function longAskRequest(): WorkspaceAskRequest {
  const filler = Array.from(
    { length: 330 },
    (_, index) => `context${index + 1}`,
  ).join(" ")
  return {
    ...askRequest(),
    question: "What exact release codename is declared at the end of the selected document?",
    documents: [{
      ...askRequest().documents[0],
      title: "Long live acceptance document",
      version: 2,
      markdown: [
        "# Long acceptance context",
        "",
        filler,
        "",
        "# Final release decision",
        "",
        "The exact release codename is HORIZON-CEDAR.",
      ].join("\n"),
    }],
    scopeFingerprint: "scope:live-acceptance-long",
  }
}

function wholeWorkspaceAskRequest(): WorkspaceAskRequest {
  const documents = Array.from({ length: 8 }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, "0")
    return {
      ...askRequest().documents[0],
      id: `workspace-doc-${ordinal}`,
      title: `Workspace document ${ordinal}`,
      relativePath: `acceptance/workspace-${ordinal}.md`,
      version: index + 1,
      markdown: `# Workspace document ${ordinal}\n\nThe exact marker for this document is MARKER-${ordinal}.\n`,
    }
  })
  return {
    ...askRequest(),
    question: "The eight selected documents are the entire Workspace fixture. How many are there, and what exact markers do the first and last documents declare?",
    targetDocumentIds: documents.map((document) => document.id),
    documents,
    focusedDocumentId: documents[0].id,
    scopeFingerprint: "scope:live-acceptance-whole-workspace-eight",
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

    recordLiveEvidence(config.model, "short_continuity", {
      documentWordCount: (askRequest().documents[0].markdown ?? "").split(/\s+/).filter(Boolean).length,
      schema: "workspaceAskResponseSchema",
      responseTraces: [first.receipt.responses.at(-1), second.receipt.responses.at(-1)],
      assertions: {
        structuredOutputValid: true,
        answerGroundedInSelectedDocument: true,
        responseIdsDistinct: true,
        previousResponseIdMatched: true,
      },
    })
  }, 180_000)

  it("grounds structured output in a real selected document larger than 300 words", async () => {
    const config = getOpenAIWorkspaceProviderConfig()
    const execution = createWorkspaceExecutionContext("ask", "cloud", "analysis")
    const request = longAskRequest()
    const wordCount = (request.documents[0].markdown ?? "").split(/\s+/).filter(Boolean).length
    expect(wordCount).toBeGreaterThan(300)

    const response = await callWorkspaceOpenAIResponse({
      config,
      execution,
      systemPrompt: buildWorkspaceAskSystemPrompt(),
      userPrompt: buildWorkspaceAskUserPrompt(request),
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

    expect(response.payload.id).toMatch(/^resp_/)
    const payload = workspaceAskResponseSchema.parse(JSON.parse(responseText(response)))
    expect(payload.answer.toLocaleLowerCase()).toContain("horizon-cedar")
    const trace = response.receipt.responses.at(-1)
    expect(trace?.status).toBe("completed")
    expect(trace?.usage.totalTokens).toBeGreaterThan(0)
    expect(trace?.latencyMs).toBeGreaterThan(0)

    recordLiveEvidence(config.model, "long_document", {
      documentWordCount: wordCount,
      schema: "workspaceAskResponseSchema",
      responseTraces: [trace],
      assertions: {
        structuredOutputValid: true,
        answerGroundedInFinalDocumentSection: true,
        providerCompleted: true,
        usageRecorded: true,
        latencyRecorded: true,
      },
    })
  }, 180_000)

  it("processes an explicit whole-Workspace selection larger than six documents", async () => {
    const config = getOpenAIWorkspaceProviderConfig()
    const execution = createWorkspaceExecutionContext("ask", "cloud", "analysis")
    const request = wholeWorkspaceAskRequest()
    expect(request.documents).toHaveLength(8)
    expect(request.targetDocumentIds).toHaveLength(8)

    const response = await callWorkspaceOpenAIResponse({
      config,
      execution,
      systemPrompt: buildWorkspaceAskSystemPrompt(),
      userPrompt: buildWorkspaceAskUserPrompt(request),
      maxOutputTokens: Math.max(512, config.maxOutputTokens),
      timeoutMs: 60_000,
      textFormat: workspaceAskTextFormat,
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

    const payload = workspaceAskResponseSchema.parse(JSON.parse(responseText(response)))
    const normalizedAnswer = payload.answer.toLocaleLowerCase()
    expect(normalizedAnswer).toMatch(/\b(?:8|eight)\b/)
    expect(normalizedAnswer).toContain("marker-01")
    expect(normalizedAnswer).toContain("marker-08")
    expect(payload.scopeStatus).toBe("ready")

    recordLiveEvidence(config.model, "whole_workspace_over_six", {
      documentCount: request.documents.length,
      schema: "workspaceAskResponseSchema",
      responseTraces: [response.receipt.responses.at(-1)],
      assertions: {
        structuredOutputValid: true,
        explicitScopeContainedEightDocuments: true,
        firstAndLastDocumentsGrounded: true,
        scopeReady: true,
      },
    })
  }, 180_000)

  it("records a real provider incomplete outcome without treating it as success", async () => {
    const config = getOpenAIWorkspaceProviderConfig()
    const execution = createWorkspaceExecutionContext("ask", "cloud", "analysis")
    const response = await callWorkspaceOpenAIResponse({
      config,
      execution,
      systemPrompt: "Return a detailed response of at least 500 words.",
      userPrompt: "Explain the architectural tradeoffs of a local-first document catalog.",
      maxOutputTokens: 16,
      timeoutMs: 60_000,
      textFormat: null,
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

    expect(response.payload.status).toBe("incomplete")
    expect(response.payload.incomplete_details?.reason).toBe("max_output_tokens")
    const trace = response.receipt.responses.at(-1)
    expect(trace?.status).toBe("incomplete")

    recordLiveEvidence(config.model, "provider_incomplete", {
      schema: null,
      responseTraces: [trace],
      assertions: {
        providerReturnedIncomplete: true,
        incompleteReasonWasOutputBudget: true,
        receiptPreservedIncompleteStatus: true,
      },
    })
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

    recordLiveEvidence(config.model, "native_compaction", {
      schema: null,
      responseTraces: receipts.flatMap((receipt) => receipt.responses),
      assertions: {
        atLeastTwoCompactionItems: compactionCount >= 2,
        responseChainPreserved: true,
      },
    })
  }, 600_000)
})
