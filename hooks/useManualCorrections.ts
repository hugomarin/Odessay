"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Editor } from "@tiptap/core"
import { collectCorrectionBlocks, getCurrentCorrectionBlock, type CorrectionTriggerBlock } from "@/lib/editor/correction-trigger-plugin"
import {
  packageCorrectionBlocks,
  type CorrectionPackage,
  type PackagedBlocksResult,
} from "@/lib/corrections/engine/packaging"
import { CORRECTION_ENGINE_REVISION } from "@/lib/ai/corrections-config"
import { adaptCorrectionsContract } from "@/lib/ai/corrections-contract-adapter"
import { getAIService } from "@/lib/services/ai-service-factory"
import { readCorrectionMemory } from "@/lib/editor/correction-memory-client"
import { replaceBlockSuggestions, hashPublicationSource } from "@/lib/editor/suggestion-engine"
import { restorePendingSuggestions } from "@/lib/corrections/engine/lifecycle"
import { createCorrectionBlockRecordId } from "@/lib/corrections/persistence"
import type { LocalCorrectionBlock, PublicationSuggestion } from "@/lib/local-db/schema"
import type { CorrectionMemoryEntry, LearnedWordEntry } from "@/lib/services/contracts/ai-service"
import type { CorrectionEvent } from "@/lib/observability/corrections-log"

export type CorrectionAnalysisRunState =
  | "idle"
  | "running"
  | "partial"
  | "failed"
  | "completed"
  | "cancelled"

export type CorrectionAnalysisProgress = {
  completedBlocks: number
  totalBlocks: number
}

type CorrectionToast = {
  phase: "running" | "complete" | "error"
  completed: number
  total: number
  message?: string
}

type ManualCorrectionsInput = {
  currentWritingId: string | null
  editorRef: React.RefObject<Editor | null>
  currentWritingIdRef: React.RefObject<string | null>
  titleRef: React.RefObject<string>
  learnedWordsRef: React.RefObject<LearnedWordEntry[]>
  persistedCorrectionBlocksRef: React.RefObject<Map<string, LocalCorrectionBlock>>
  readCorrectionMemory: () => CorrectionMemoryEntry[]
  admitCorrectionSuggestions: (
    candidates: PublicationSuggestion[],
    blocks?: CorrectionTriggerBlock[],
  ) => PublicationSuggestion[]
  applyCorrectionSuggestionUpdate: (
    updater: (current: PublicationSuggestion[]) => PublicationSuggestion[],
    options?: { immediate?: boolean },
  ) => void
  normalizeAutomaticSuggestion: (
    block: CorrectionTriggerBlock,
    suggestion: PublicationSuggestion,
  ) => PublicationSuggestion
  persistCorrectionBlockWriteThrough: (
    block: LocalCorrectionBlock,
    deletedBlockIds?: string[],
  ) => Promise<void>
  updatePersistedBlocksFromSuggestions: (
    nextSuggestions: PublicationSuggestion[],
    blockHashes: string[],
  ) => Promise<void>
  logCorrectionEvent: (event: CorrectionEvent) => void
  showCorrectionToast: (toast: CorrectionToast, durationMs: number) => void
}

export type ManualCorrectionsResult = {
  runState: CorrectionAnalysisRunState
  progress: CorrectionAnalysisProgress
  failedPackages: CorrectionPackage<CorrectionTriggerBlock>[]
  startAnalysis: () => Promise<void>
  retryFailedPackages: () => Promise<void>
  cancelAnalysis: () => void
}

function isValidLanguage(
  value: string,
): value is "es" | "en" | "mixed" | "unknown" {
  return value === "es" || value === "en" || value === "mixed" || value === "unknown"
}

async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const iterator = items.entries()

  const workers = Array.from({ length: limit }, async () => {
    for (const entry of iterator) {
      const [index, item] = entry
      await fn(item, index)
    }
  })

  await Promise.all(workers)
}

export function useManualCorrections(input: ManualCorrectionsInput): ManualCorrectionsResult {
  const [runState, setRunState] = useState<CorrectionAnalysisRunState>("idle")
  const [progress, setProgress] = useState<CorrectionAnalysisProgress>({
    completedBlocks: 0,
    totalBlocks: 0,
  })
  const [failedPackages, setFailedPackages] = useState<CorrectionPackage<CorrectionTriggerBlock>[]>([])

  const runIdRef = useRef<unknown>(null)
  const cancelledRef = useRef(false)
  const previousWritingIdRef = useRef(input.currentWritingId)

  const inputRef = useRef(input)
  inputRef.current = input

  useEffect(() => {
    if (previousWritingIdRef.current === input.currentWritingId) {
      return
    }

    previousWritingIdRef.current = input.currentWritingId
    cancelledRef.current = true
    runIdRef.current = null
    setFailedPackages([])
    setProgress({ completedBlocks: 0, totalBlocks: 0 })
    setRunState("idle")
  }, [input.currentWritingId])

  const isCurrentRun = useCallback((runId: unknown) => {
    return !cancelledRef.current && runIdRef.current === runId
  }, [])

  const applyCachedBlockSuggestions = useCallback(
    (block: CorrectionTriggerBlock, cached: LocalCorrectionBlock) => {
      const admitted = inputRef.current.admitCorrectionSuggestions(
        restorePendingSuggestions(cached.suggestions),
        [block],
      )

      const normalized = admitted.map((suggestion) =>
        inputRef.current.normalizeAutomaticSuggestion(block, suggestion),
      )

      inputRef.current.applyCorrectionSuggestionUpdate((current) =>
        replaceBlockSuggestions(current, block.id, normalized).suggestions,
      )
    },
    [],
  )

  const processPackageResponse = useCallback(
    async (
      pkg: CorrectionPackage<CorrectionTriggerBlock>,
      result: Awaited<ReturnType<ReturnType<typeof getAIService>["reviewPublication"]>>,
      requestStartedAt: number,
      requestWritingId: string,
      runId: unknown,
    ): Promise<{ success: boolean; suggestionCount: number }> => {
      if (result.error || !result.data) {
        return { success: false, suggestionCount: 0 }
      }

      const { current: input } = inputRef
      const editor = input.editorRef.current

      if (
        !editor ||
        !isCurrentRun(runId) ||
        input.currentWritingIdRef.current !== requestWritingId
      ) {
        return { success: false, suggestionCount: 0 }
      }

      const adapted = adaptCorrectionsContract({
        summary: result.data.summary,
        language: isValidLanguage(result.data.language) ? result.data.language : "unknown",
        corrections: result.data.corrections,
        uncertain: result.data.uncertain,
      })

      const suggestionsByBlockId = new Map<string, PublicationSuggestion[]>()

      for (const suggestion of adapted.legacy.suggestions) {
        if (!suggestion.block_id) {
          continue
        }

        const blockSuggestions = suggestionsByBlockId.get(suggestion.block_id) ?? []
        blockSuggestions.push(suggestion)
        suggestionsByBlockId.set(suggestion.block_id, blockSuggestions)
      }

      const engineRevision = result.data.engineRevision ?? CORRECTION_ENGINE_REVISION
      const model = result.data.usage?.model ?? "unknown"
      const promptTokens = result.data.usage?.promptTokens ?? null
      const completionTokens = result.data.usage?.completionTokens ?? null

      let suggestionCount = 0

      for (const block of pkg.blocks) {
        if (
          !isCurrentRun(runId) ||
          input.currentWritingIdRef.current !== requestWritingId
        ) {
          return { success: false, suggestionCount }
        }

        const currentBlock = getCurrentCorrectionBlock(editor.state.doc, block.id)

        if (!currentBlock || currentBlock.hash !== block.hash || currentBlock.text !== block.text) {
          setProgress((current) => ({
            ...current,
            completedBlocks: current.completedBlocks + 1,
          }))
          continue
        }

        const blockSuggestions = suggestionsByBlockId.get(block.id) ?? []
        const normalized = input.admitCorrectionSuggestions(
          blockSuggestions.map((suggestion) => input.normalizeAutomaticSuggestion(block, suggestion)),
          [currentBlock],
        )

        suggestionCount += normalized.length

        input.applyCorrectionSuggestionUpdate((current) =>
          replaceBlockSuggestions(current, block.id, normalized).suggestions,
        )

        const record: LocalCorrectionBlock = {
          id: createCorrectionBlockRecordId(requestWritingId, block.hash),
          writingId: requestWritingId,
          blockId: block.id,
          blockHash: block.hash,
          suggestions: normalized,
          model,
          engineRevision,
          createdAt: new Date().toISOString(),
          latencyMs: Date.now() - requestStartedAt,
          promptTokens,
          completionTokens,
          syncedAt: null,
        }

        await input.persistCorrectionBlockWriteThrough(record)

        setProgress((current) => ({
          ...current,
          completedBlocks: current.completedBlocks + 1,
        }))
      }

      return { success: true, suggestionCount }
    },
    [isCurrentRun],
  )

  const runPackages = useCallback(
    async (
      packages: CorrectionPackage<CorrectionTriggerBlock>[],
      allBlocks: CorrectionTriggerBlock[],
      runId: unknown,
      totalBlocks: number,
      completedBlocks: number,
      isRetry: boolean,
    ): Promise<CorrectionPackage<CorrectionTriggerBlock>[]> => {
      const failed: CorrectionPackage<CorrectionTriggerBlock>[] = []
      const { current: input } = inputRef

      setProgress((current) => ({
        ...current,
        completedBlocks,
        totalBlocks,
      }))
      input.showCorrectionToast(
        {
          phase: "running",
          completed: completedBlocks,
          total: totalBlocks,
        },
        2000,
      )

      await runWithConcurrencyLimit(packages, 2, async (pkg, index) => {
        if (!isCurrentRun(runId)) {
          return
        }

        const batchId = `manual-${isRetry ? "retry" : "run"}-${index}-${hashPublicationSource(
          pkg.blocks.map((block) => block.hash).join("|"),
        )}`
        const requestStartedAt = Date.now()
        const requestWritingId = input.currentWritingIdRef.current

        input.logCorrectionEvent({
          type: "request:start",
          batchId,
          blockIds: pkg.blocks.map((block) => block.id),
        })

        if (!requestWritingId) {
          failed.push(pkg)
          return
        }

        try {
          const result = await getAIService().reviewPublication({
            writingId: requestWritingId,
            title: input.titleRef.current,
            markdown: pkg.blocks.map((block) => block.text).join("\n\n"),
            bodyText: pkg.blocks.map((block) => block.text).join("\n\n"),
            sourceHash: hashPublicationSource(pkg.blocks.map((block) => block.hash).join("|")),
            correctionBlocks: pkg.blocks.map((block) => ({
              id: block.id,
              text: block.text,
              hash: block.hash,
            })),
            correctionMemory: {
              entries: input.readCorrectionMemory(),
            },
            learnedWords: {
              entries: input.learnedWordsRef.current.map((item) => ({
                word: item.word,
                language: item.language,
              })),
            },
            stream: false,
          })

          if (!isCurrentRun(runId)) {
            return
          }

          if (input.currentWritingIdRef.current !== requestWritingId) {
            cancelledRef.current = true
            setRunState("cancelled")
            return
          }

          const { success, suggestionCount } = await processPackageResponse(
            pkg,
            result,
            requestStartedAt,
            requestWritingId,
            runId,
          )

          if (!success) {
            failed.push(pkg)
          }

          input.logCorrectionEvent({
            type: "request:end",
            batchId,
            latencyMs: Date.now() - requestStartedAt,
            suggestions: success ? suggestionCount : 0,
            missing: success ? [] : pkg.blocks.map((block) => block.id),
          })
        } catch (error) {
          failed.push(pkg)
          console.info(
            `[corrections] package failed message=${error instanceof Error ? error.message : String(error)}`,
          )
        }
      })

      return failed
    },
    [isCurrentRun, processPackageResponse],
  )

  const startAnalysis = useCallback(async () => {
    const input = inputRef.current
    const editor = input.editorRef.current
    const writingId = input.currentWritingIdRef.current

    if (!editor || !writingId) {
      setRunState("failed")
      input.showCorrectionToast(
        {
          phase: "error",
          completed: 0,
          total: 0,
          message: "No document to analyze.",
        },
        4000,
      )
      return
    }

    const runId = {}
    runIdRef.current = runId
    cancelledRef.current = false
    setFailedPackages([])
    setRunState("running")

    const allBlocks = collectCorrectionBlocks(editor.state.doc).filter(
      (block) => block.text.trim().length > 0,
    )
    const { packages, skippedBlocks } = packageCorrectionBlocks(allBlocks)
    const skippedPackages: CorrectionPackage<CorrectionTriggerBlock>[] = skippedBlocks.map((block) => ({
      blocks: [block],
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
    }))
    const totalBlocks = allBlocks.length
    let completedBlocks = 0

    const cachedBlockHashes = new Set<string>()

    for (const block of allBlocks) {
      const cached = input.persistedCorrectionBlocksRef.current.get(block.hash)

      if (cached && cached.engineRevision === CORRECTION_ENGINE_REVISION) {
        cachedBlockHashes.add(block.hash)
        applyCachedBlockSuggestions(block, cached)
        completedBlocks += 1
        input.logCorrectionEvent({
          type: "cache:hit",
          blockId: block.id,
          source: cached.syncedAt ? "supabase" : "idb",
        })
      }
    }

    const pendingPackages = packages
      .map((pkg) => ({
        ...pkg,
        blocks: pkg.blocks.filter((block) => !cachedBlockHashes.has(block.hash)),
      }))
      .filter((pkg) => pkg.blocks.length > 0)

    if (pendingPackages.length === 0) {
      setProgress({ completedBlocks: totalBlocks - skippedBlocks.length, totalBlocks })
      setFailedPackages(skippedPackages)
      setRunState(skippedPackages.length > 0 ? "partial" : "completed")
      input.showCorrectionToast(
        {
          phase: skippedPackages.length > 0 ? "error" : "complete",
          completed: totalBlocks - skippedBlocks.length,
          total: totalBlocks,
          message: skippedPackages.length > 0
            ? "Some sections couldn’t be analyzed. Your existing results are safe."
            : undefined,
        },
        skippedPackages.length > 0 ? 5000 : 2000,
      )
      return
    }

    const failed = [
      ...skippedPackages,
      ...await runPackages(pendingPackages, allBlocks, runId, totalBlocks, completedBlocks, false),
    ]

    if (cancelledRef.current) {
      return
    }

    setFailedPackages(failed)

    if (failed.length > 0) {
      const failedBlockCount = failed.reduce((sum, pkg) => sum + pkg.blocks.length, 0)
      const nextRunState = totalBlocks - failedBlockCount > 0 ? "partial" : "failed"
      setRunState(nextRunState)
      input.showCorrectionToast(
        {
          phase: "error",
          completed: progressRef.current.completedBlocks,
          total: totalBlocks,
          message: nextRunState === "failed"
            ? "We couldn’t analyze this document. Check your connection and try again."
            : "Some sections couldn’t be analyzed. Your existing results are safe.",
        },
        5000,
      )
    } else {
      setRunState("completed")
      input.showCorrectionToast(
        {
          phase: "complete",
          completed: totalBlocks,
          total: totalBlocks,
        },
        2000,
      )
    }
  }, [applyCachedBlockSuggestions, runPackages])

  const progressRef = useRef(progress)
  progressRef.current = progress

  const retryFailedPackages = useCallback(async () => {
    if (failedPackages.length === 0) {
      return
    }

    const input = inputRef.current
    const runId = {}
    runIdRef.current = runId
    cancelledRef.current = false
    setFailedPackages([])
    setRunState("running")

    const totalBlocks = progressRef.current.totalBlocks
    const completedBlocks = progressRef.current.completedBlocks
    const packagesToRetry = [...failedPackages]
    const failed = await runPackages(packagesToRetry, [], runId, totalBlocks, completedBlocks, true)

    if (cancelledRef.current) {
      return
    }

    setFailedPackages(failed)

    if (failed.length > 0) {
      const failedBlockCount = failed.reduce((sum, pkg) => sum + pkg.blocks.length, 0)
      const nextRunState = totalBlocks - failedBlockCount > 0 ? "partial" : "failed"
      setRunState(nextRunState)
      input.showCorrectionToast(
        {
          phase: "error",
          completed: progressRef.current.completedBlocks,
          total: totalBlocks,
          message: nextRunState === "failed"
            ? "We still couldn’t analyze this document. Check your connection and try again."
            : "Some sections still couldn’t be analyzed. Your existing results are safe.",
        },
        5000,
      )
    } else {
      setRunState("completed")
      input.showCorrectionToast(
        {
          phase: "complete",
          completed: totalBlocks,
          total: totalBlocks,
        },
        2000,
      )
    }
  }, [failedPackages, runPackages])

  const cancelAnalysis = useCallback(() => {
    cancelledRef.current = true
    runIdRef.current = null
    setRunState("cancelled")
    inputRef.current.showCorrectionToast(
      {
        phase: "error",
        completed: progressRef.current.completedBlocks,
        total: progressRef.current.totalBlocks,
        message: "Analysis cancelled.",
      },
      3000,
    )
  }, [])

  return {
    runState,
    progress,
    failedPackages,
    startAnalysis,
    retryFailedPackages,
    cancelAnalysis,
  }
}
