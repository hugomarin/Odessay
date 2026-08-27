export type HydrationGenerationResult<T> = { status: "current"; value: T } | { status: "stale" }

export type HydrationGeneration = {
  readonly writingId: string
  isCurrent: () => boolean
  run: <T>(effect: () => T) => HydrationGenerationResult<T>
  runAsync: <T>(effect: () => Promise<T>) => Promise<HydrationGenerationResult<T>>
}

export type HydrationGenerationOwner = {
  start: (writingId: string) => HydrationGeneration
  cancel: (generation: HydrationGeneration) => void
}

/**
 * Owns the single hydration generation allowed to mutate editor state.
 *
 * A generation is identified by token identity rather than writing id: a
 * second attempt for the same document must invalidate the first one too.
 * Async work may still finish when it cannot be aborted, but `runAsync`
 * discards its result if another generation became current while it waited.
 */
export function createHydrationGenerationOwner(): HydrationGenerationOwner {
  let currentGeneration: HydrationGeneration | null = null

  const start = (writingId: string): HydrationGeneration => {
    const generation: HydrationGeneration = {
      writingId,
      isCurrent: () => currentGeneration === generation,
      run: <T>(effect: () => T): HydrationGenerationResult<T> => {
        if (currentGeneration !== generation) {
          return { status: "stale" }
        }
        return { status: "current", value: effect() }
      },
      runAsync: async <T>(effect: () => Promise<T>): Promise<HydrationGenerationResult<T>> => {
        if (currentGeneration !== generation) {
          return { status: "stale" }
        }
        const value = await effect()
        if (currentGeneration !== generation) {
          return { status: "stale" }
        }
        return { status: "current", value }
      },
    }

    currentGeneration = generation
    return generation
  }

  return {
    start,
    cancel: (generation) => {
      if (currentGeneration === generation) {
        currentGeneration = null
      }
    },
  }
}
