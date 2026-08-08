"use client"

import { createDesktopClient } from "@/lib/supabase/desktop-client"
import type {
  AIService,
  LearnedWordEntry,
  LearnedWordsPage,
  LearnWordInput,
  PersistCorrectionBlockInput,
  PersistCorrectionBlockResult,
  PersistedCorrectionBlock,
  PublicationReviewRequest,
  PublicationReviewResult,
  ListLearnedWordsInput,
  TitleSuggestion,
  TitleSuggestionRequest,
} from "@/lib/services/contracts/ai-service"
import type { ServiceError } from "@/lib/services/contracts/service-types"
import { err, ok, parseServiceEnvelope } from "@/lib/services/service-response"

function getWebRuntimeBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured")
  }
  return url.replace(/\/$/, "")
}

async function getBearerToken(): Promise<string | null> {
  try {
    const supabase = createDesktopClient()
    const { data, error } = await supabase.auth.getSession()

    if (error || !data.session) {
      return null
    }

    return data.session.access_token
  } catch {
    return null
  }
}

function unavailable<T>(message: string, code: ServiceError["code"] = "UNAVAILABLE") {
  return err<T>({
    code,
    message,
    retryable: code === "UNAVAILABLE",
  })
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
  engineRevision?: string | null
}

type LearnedWordsPayload = {
  items: LearnedWordEntry[]
  nextCursor: string | null
}

export const desktopAIService: AIService = {
  async suggestTitle(input: TitleSuggestionRequest) {
    const token = await getBearerToken()

    if (!token) {
      return err<TitleSuggestion>({
        code: "UNAUTHORIZED",
        message: "No active session.",
        retryable: false,
      })
    }

    try {
      const response = await fetch(`${getWebRuntimeBaseUrl()}/api/ai/title-suggestions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${token}`,
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
    const token = await getBearerToken()

    if (!token) {
      return err<PublicationReviewResult>({
        code: "UNAUTHORIZED",
        message: "No active session.",
        retryable: false,
      })
    }

    try {
      const response = await fetch(`${getWebRuntimeBaseUrl()}/api/ai/publication-review`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${token}`,
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
          model: "desktop-proxy",
          promptTokens: parsed.data.promptTokens ?? null,
          completionTokens: parsed.data.completionTokens ?? null,
          latencyMs: null,
        },
        engineRevision: parsed.data.engineRevision ?? null,
      })
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Could not review this text right now.")
    }
  },

  async hydrateCorrectionBlocks(writingId: string) {
    const token = await getBearerToken()

    if (!token) {
      console.info(`[desktop-ai-service:hydrate] skipped remote hydration for ${writingId}: no session`)
      return ok<PersistedCorrectionBlock[]>([])
    }

    try {
      const response = await fetch(
        `${getWebRuntimeBaseUrl()}/api/corrections/hydrate?writingId=${encodeURIComponent(writingId)}`,
        {
          method: "GET",
          headers: {
            "authorization": `Bearer ${token}`,
          },
          cache: "no-store",
        },
      )

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
    const token = await getBearerToken()

    if (!token) {
      return err<PersistCorrectionBlockResult>({
        code: "UNAUTHORIZED",
        message: "No active session.",
        retryable: false,
      })
    }

    try {
      const response = await fetch(`${getWebRuntimeBaseUrl()}/api/corrections/persist`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${token}`,
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
    const token = await getBearerToken()

    if (!token) {
      return err<LearnedWordsPage>({
        code: "UNAUTHORIZED",
        message: "No active session.",
        retryable: false,
      })
    }

    try {
      const params = new URLSearchParams()
      if (input.limit) params.set("limit", String(input.limit))
      if (input.cursor) params.set("cursor", input.cursor)

      const response = await fetch(`${getWebRuntimeBaseUrl()}/api/corrections/learned-words?${params.toString()}`, {
        method: "GET",
        headers: {
          "authorization": `Bearer ${token}`,
        },
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
    const token = await getBearerToken()

    if (!token) {
      return err<LearnedWordEntry>({
        code: "UNAUTHORIZED",
        message: "No active session.",
        retryable: false,
      })
    }

    try {
      const response = await fetch(`${getWebRuntimeBaseUrl()}/api/corrections/learned-words`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${token}`,
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
    const token = await getBearerToken()

    if (!token) {
      return err<{ deletedId: string }>({
        code: "UNAUTHORIZED",
        message: "No active session.",
        retryable: false,
      })
    }

    try {
      const response = await fetch(`${getWebRuntimeBaseUrl()}/api/corrections/learned-words`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${token}`,
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
