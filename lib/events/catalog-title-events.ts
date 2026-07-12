export const CATALOG_TITLE_CHANGE_EVENT = "odessay:catalog-title-change"

export type CatalogTitleChangeDetail = {
  titles: Array<{
    writingId: string
    title: string
  }>
}

const latestTitles = new Map<string, string>()

export function getLatestCatalogTitle(writingId: string) {
  return latestTitles.get(writingId) ?? null
}

export function emitCatalogTitleChange(titlesByWritingId: ReadonlyMap<string, string>) {
  if (titlesByWritingId.size === 0) {
    return
  }

  titlesByWritingId.forEach((title, writingId) => {
    latestTitles.set(writingId, title)
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
