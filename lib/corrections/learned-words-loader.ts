import { normalizeLearnedWord } from "@/lib/corrections/learned-words"
import type {
  AIService,
  LearnedWordEntry,
  ListLearnedWordsInput,
} from "@/lib/services/contracts/ai-service"

const LEARNED_WORDS_PAGE_LIMIT = 100
const LEARNED_WORDS_RETRY_DELAY_MS = 5000
const LEARNED_WORDS_ADDITIONAL_PAGE_DELAY_MS = 3000

let learnedWordsCache: LearnedWordEntry[] | null = null
let learnedWordsLoadPromise: Promise<LearnedWordsLoadResult> | null = null

type Timer = {
  setTimeout(callback: () => void, delayMs: number): unknown
}

export type LearnedWordsLoadResult =
  | {
      ok: true
      items: LearnedWordEntry[]
    }
  | {
      ok: false
      message: string
    }

const wait = (timer: Timer, delayMs: number) =>
  new Promise<void>((resolve) => {
    timer.setTimeout(resolve, delayMs)
  })

export const mergeLearnedWordEntries = (
  current: readonly LearnedWordEntry[],
  incoming: readonly LearnedWordEntry[],
) => {
  const byWord = new Map<string, LearnedWordEntry>()

  for (const item of current) {
    const normalized = normalizeLearnedWord(item.word)
    if (normalized) {
      byWord.set(normalized, item)
    }
  }

  for (const item of incoming) {
    const normalized = normalizeLearnedWord(item.word)
    if (normalized) {
      byWord.set(normalized, item)
    }
  }

  return [...byWord.values()]
}

export const getCachedLearnedWords = () => learnedWordsCache

export const primeLearnedWordsCache = (items: readonly LearnedWordEntry[]) => {
  learnedWordsCache = [...items]
}

export const upsertCachedLearnedWord = (entry: LearnedWordEntry) => {
  learnedWordsCache = mergeLearnedWordEntries(learnedWordsCache ?? [], [entry])
}

export const removeCachedLearnedWord = (id: string) => {
  if (!learnedWordsCache) {
    return
  }

  learnedWordsCache = learnedWordsCache.filter((item) => item.id !== id)
}

export const resetLearnedWordsCacheForTest = () => {
  learnedWordsCache = null
  learnedWordsLoadPromise = null
}

export const loadLearnedWordsPages = async (
  service: Pick<AIService, "listLearnedWords">,
  options: {
    limit?: number
    retryDelayMs?: number
    additionalPageDelayMs?: number
    timer?: Timer
  } = {},
): Promise<LearnedWordsLoadResult> => {
  const limit = options.limit ?? LEARNED_WORDS_PAGE_LIMIT
  const retryDelayMs = options.retryDelayMs ?? LEARNED_WORDS_RETRY_DELAY_MS
  const additionalPageDelayMs = options.additionalPageDelayMs ?? LEARNED_WORDS_ADDITIONAL_PAGE_DELAY_MS
  const timer = options.timer ?? globalThis

  const loadOnce = async () => {
    const items: LearnedWordEntry[] = []
    let cursor: ListLearnedWordsInput["cursor"] = null
    let loadedPages = 0

    do {
      if (loadedPages > 0 && additionalPageDelayMs > 0) {
        await wait(timer, additionalPageDelayMs)
      }

      const result = await service.listLearnedWords({ limit, cursor })

      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? result.error?.code ?? "unknown")
      }

      items.push(...result.data.items)
      cursor = result.data.nextCursor
      loadedPages += 1
    } while (cursor)

    return items
  }

  try {
    return {
      ok: true,
      items: await loadOnce(),
    }
  } catch {
    await wait(timer, retryDelayMs)
  }

  try {
    return {
      ok: true,
      items: await loadOnce(),
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export const loadCachedLearnedWordsPages = (
  service: Pick<AIService, "listLearnedWords">,
  options: Parameters<typeof loadLearnedWordsPages>[1] = {},
) => {
  if (learnedWordsCache) {
    return Promise.resolve<LearnedWordsLoadResult>({
      ok: true,
      items: learnedWordsCache,
    })
  }

  if (learnedWordsLoadPromise) {
    return learnedWordsLoadPromise
  }

  learnedWordsLoadPromise = loadLearnedWordsPages(service, options).then((result) => {
    if (result.ok) {
      primeLearnedWordsCache(result.items)
    }

    return result
  }).finally(() => {
    learnedWordsLoadPromise = null
  })

  return learnedWordsLoadPromise
}
