type WritingRouteSource = {
  id: string
  slug?: string | null
}

const UUID_LIKE_WRITING_IDENTIFIER_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isUuidLikeWritingIdentifier = (value: string) =>
  UUID_LIKE_WRITING_IDENTIFIER_RE.test(value)

export const getWritingRouteIdentifier = (writing: WritingRouteSource) => {
  const slug = writing.slug?.trim()

  return slug?.length ? slug : writing.id
}

export const buildWritingRouteHref = (basePath: string, writing: WritingRouteSource) =>
  `${basePath}/${getWritingRouteIdentifier(writing)}`
