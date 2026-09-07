"use client"

import { localDB } from "@/lib/local-db"
import type {
  AIService,
  LearnedWordEntry,
  LearnWordInput,
  PersistCorrectionBlockInput,
  PersistCorrectionBlockResult,
  PersistedCorrectionBlock,
  PublicationReviewRequest,
  PublicationReviewResult,
  ListLearnedWordsInput,
  TitleSuggestion,
  TitleSuggestionRequest,
  WorkspaceAskRequest,
  WorkspaceAskResult,
  WorkspaceClassificationRequest,
  WorkspaceClassificationResult,
  WorkspaceToolPresentationRequest,
  WorkspaceToolPresentationResult,
} from "@/lib/services/contracts/ai-service"
import type { ServiceError } from "@/lib/services/contracts/service-types"
import { err, ok, parseServiceEnvelope } from "@/lib/services/service-response"

async function checkWritingLifecycleForRemoteAI(writingId: string): Promise<{ allowed: boolean; reason?: string }> {
  const localWriting = await localDB.writings.get(writingId)

  if (!localWriting) {
    return { allowed: false, reason: "no local writing" }
  }

  if (localWriting.lifecycle === "local-only") {
    return { allowed: false, reason: "local-only lifecycle" }
  }

  if (localWriting.lifecycle === "syncing") {
    return { allowed: false, reason: "syncing lifecycle" }
  }

  return { allowed: true }
}

type TitleSuggestionPayload = {
  title: string
  rationale?: string | null
}

type PublicationReviewPayload = {
  summary?: string
  language: string
  corrections: PublicationReviewResult["corrections"]
  uncertain?: PublicationReviewResult["uncertain"]
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
  engineRevision?: string | null
}

type WorkspaceClassificationPayload = {
  summary: string
  proposals: WorkspaceClassificationResult["proposals"]
  requestedDocumentIds: string[]
  model: string
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  latencyMs: number | null
}

type WorkspaceAskPayload = {
  answer: string
  evidence: WorkspaceAskResult["evidence"]
  requestedDocumentIds: string[]
  model: string
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  latencyMs: number | null
}

type WorkspaceToolPresentationPayload = {
  note: string
  model: string
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  latencyMs: number | null
}

type LearnedWordsPayload = {
  items: LearnedWordEntry[]
  nextCursor: string | null
}

function unavailable<T>(message: string, code: ServiceError["code"] = "UNAVAILABLE") {
  return err<T>({
    code,
    message,
    retryable: code === "UNAVAILABLE",
  })
}

export const webAIService: AIService = {
  async suggestTitle(input: TitleSuggestionRequest) {
    if (input.writingId) {
      const lifecycleCheck = await checkWritingLifecycleForRemoteAI(input.writingId)

      if (!lifecycleCheck.allowed) {
        return err<TitleSuggestion>({
          code: "INVALID_INPUT",
          message: `Cannot suggest a title for a writing that has not been synced yet. (${lifecycleCheck.reason})`,
          retryable: false,
        })
      }
    }

    try {
      const response = await fetch("/api/ai/title-suggestions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      })

      const parsed = await parseServiceEnvelope<TitleSuggestionPayload>(
        response,
        "AI_REQUEST_FAILED",
        "Could not suggest a title right now.",
      )

      if (parsed.error) {
        return parsed
      }

      return ok<TitleSuggestion>({
        title: parsed.data.title,
        rationale: parsed.data.rationale ?? null,
      })
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not suggest a title right now.")
    }
  },

  async reviewPublication(input: PublicationReviewRequest) {
    try {
      const response = await fetch("/api/ai/publication-review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      })

      const parsed = await parseServiceEnvelope<PublicationReviewPayload>(
        response,
        "AI_REQUEST_FAILED",
        "Could not review this text right now.",
      )

      if (parsed.error) {
        return parsed
      }

      return ok<PublicationReviewResult>({
        summary: parsed.data.summary ?? "",
        language: parsed.data.language,
        corrections: parsed.data.corrections,
        uncertain: parsed.data.uncertain ?? [],
        usage: {
          model: "web-route",
          promptTokens: parsed.data.promptTokens ?? null,
          completionTokens: parsed.data.completionTokens ?? null,
          totalTokens: parsed.data.totalTokens ?? null,
          latencyMs: null,
        },
        engineRevision: parsed.data.engineRevision ?? null,
      })
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not review this text right now.")
    }
  },

  async classifyWorkspace(input: WorkspaceClassificationRequest) {
    try {
      const response = await fetch("/api/ai/workspace-classification", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      })

      const parsed = await parseServiceEnvelope<WorkspaceClassificationPayload>(
        response,
        "AI_REQUEST_FAILED",
        "Could not classify the selected artifacts right now.",
      )

      if (parsed.error) return parsed

      return ok<WorkspaceClassificationResult>({
        summary: parsed.data.summary,
        proposals: parsed.data.proposals,
        requestedDocumentIds: parsed.data.requestedDocumentIds,
        usage: {
          model: parsed.data.model,
          promptTokens: parsed.data.promptTokens,
          completionTokens: parsed.data.completionTokens,
          totalTokens: parsed.data.totalTokens,
          latencyMs: parsed.data.latencyMs,
        },
      })
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not classify the selected artifacts right now.")
    }
  },

  async askWorkspace(input: WorkspaceAskRequest) {
    try {
      const response = await fetch("/api/ai/workspace-ask", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      })

      const parsed = await parseServiceEnvelope<WorkspaceAskPayload>(
        response,
        "AI_REQUEST_FAILED",
        "Could not answer that question right now.",
      )

      if (parsed.error) return parsed

      return ok<WorkspaceAskResult>({
        answer: parsed.data.answer,
        evidence: parsed.data.evidence,
        requestedDocumentIds: parsed.data.requestedDocumentIds,
        usage: {
          model: parsed.data.model,
          promptTokens: parsed.data.promptTokens,
          completionTokens: parsed.data.completionTokens,
          totalTokens: parsed.data.totalTokens,
          latencyMs: parsed.data.latencyMs,
        },
      })
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not answer that question right now.")
    }
  },

  async presentToolResult(input: WorkspaceToolPresentationRequest) {
    try {
      const response = await fetch("/api/ai/workspace-tool-presentation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      })

      const parsed = await parseServiceEnvelope<WorkspaceToolPresentationPayload>(
        response,
        "AI_REQUEST_FAILED",
        "Could not phrase this result right now.",
      )

      if (parsed.error) return parsed

      return ok<WorkspaceToolPresentationResult>({
        note: parsed.data.note,
        usage: {
          model: parsed.data.model,
          promptTokens: parsed.data.promptTokens,
          completionTokens: parsed.data.completionTokens,
          totalTokens: parsed.data.totalTokens,
          latencyMs: parsed.data.latencyMs,
        },
      })
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not phrase this result right now.")
    }
  },

  async hydrateCorrectionBlocks(writingId: string) {
    const lifecycleCheck = await checkWritingLifecycleForRemoteAI(writingId)

    if (!lifecycleCheck.allowed) {
      console.info(`[ai-service:hydrate] skipped remote hydration for ${writingId}: ${lifecycleCheck.reason}`)
      return ok<PersistedCorrectionBlock[]>([])
    }

    try {
      const response = await fetch(`/api/corrections/hydrate?writingId=${encodeURIComponent(writingId)}`, {
        method: "GET",
        cache: "no-store",
      })

      return parseServiceEnvelope<PersistedCorrectionBlock[]>(
        response,
        "UNAVAILABLE",
        "Could not load correction blocks.",
      )
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not load correction blocks.")
    }
  },

  async persistCorrectionBlock(input: PersistCorrectionBlockInput) {
    try {
      const response = await fetch("/api/corrections/persist", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          writingId: input.writingId ?? input.block?.writingId,
          block: input.block
            ? {
                id: input.block.id,
                writing_id: input.block.writingId,
                block_id: input.block.blockId,
                block_hash: input.block.blockHash,
                suggestions: input.block.suggestions,
                model: input.block.model,
                engine_revision: input.block.engineRevision,
                created_at: input.block.createdAt,
                latency_ms: input.block.latencyMs,
                prompt_tokens: input.block.promptTokens,
                completion_tokens: input.block.completionTokens,
              }
            : undefined,
          deletedBlockIds: input.deletedBlockIds ?? [],
        }),
      })

      return parseServiceEnvelope<PersistCorrectionBlockResult>(
        response,
        "UNAVAILABLE",
        "Could not persist correction blocks.",
      )
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not persist correction blocks.")
    }
  },

  async listLearnedWords(input: ListLearnedWordsInput = {}) {
    try {
      const params = new URLSearchParams()
      if (input.limit) params.set("limit", String(input.limit))
      if (input.cursor) params.set("cursor", input.cursor)

      const response = await fetch(`/api/corrections/learned-words?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      })

      return parseServiceEnvelope<LearnedWordsPayload>(
        response,
        "UNAVAILABLE",
        "Could not load learned words.",
      )
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not load learned words.")
    }
  },

  async learnWord(input: LearnWordInput) {
    try {
      const response = await fetch("/api/corrections/learned-words", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      })

      return parseServiceEnvelope<LearnedWordEntry>(
        response,
        "UNAVAILABLE",
        "Could not save learned word.",
      )
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not save learned word.")
    }
  },

  async deleteLearnedWord(id: string) {
    try {
      const response = await fetch("/api/corrections/learned-words", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ id }),
      })

      return parseServiceEnvelope<{ deletedId: string }>(
        response,
        "UNAVAILABLE",
        "Could not delete learned word.",
      )
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not delete learned word.")
    }
  },
}
