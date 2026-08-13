export const CATALOG_TITLE_CHANGE_EVENT = "odessay:catalog-title-change"

export type CatalogTitleChangeDetail = {
  titles: Array<{
    writingId: string
    title: string
  }>
}

const MAX_CACHED_TITLES = 100

const latestTitles = new Map<string, string>()

function touchTitle(writingId: string) {
  const title = latestTitles.get(writingId)
  if (title === undefined) {
    return
  }
  // Move to most-recent position; Map preserves insertion order.
  latestTitles.delete(writingId)
  latestTitles.set(writingId, title)
}

function setTitle(writingId: string, title: string) {
  if (latestTitles.has(writingId)) {
    latestTitles.delete(writingId)
  }
  latestTitles.set(writingId, title)
  if (latestTitles.size > MAX_CACHED_TITLES) {
    const oldestKey = latestTitles.keys().next().value as string
    latestTitles.delete(oldestKey)
  }
}

export function getLatestCatalogTitle(writingId: string) {
  const title = latestTitles.get(writingId) ?? null
  if (title !== null) {
    touchTitle(writingId)
  }
  return title
}

export function emitCatalogTitleChange(titlesByWritingId: ReadonlyMap<string, string>) {
  if (titlesByWritingId.size === 0) {
    return
  }

  titlesByWritingId.forEach((title, writingId) => {
    setTitle(writingId, title)
  })

  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new CustomEvent<CatalogTitleChangeDetail>(CATALOG_TITLE_CHANGE_EVENT, {
    detail: {
      titles: [...titlesByWritingId].map(([writingId, title]) => ({ writingId, title })),
    },
  }))
}

/**
 * Wipe the in-memory title cache. Safe to call on logout or scope change;
 * titles will be re-populated from the next catalog emission.
 */
export function clearCatalogTitleCache() {
  latestTitles.clear()
}
