type WritingRouteSource = {
  id: string
  slug?: string | null
}

// NEXT_PUBLIC_TAURI_BUILD (not plain TAURI_BUILD) because this runs at client
// runtime when building hrefs; only NEXT_PUBLIC_* vars are inlined into the
// client bundle. Set by scripts/prepare-tauri-build.mjs for the DMG build.
const isTauriBuild = process.env.NEXT_PUBLIC_TAURI_BUILD === "true"

const UUID_LIKE_WRITING_IDENTIFIER_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isUuidLikeWritingIdentifier = (value: string) =>
  UUID_LIKE_WRITING_IDENTIFIER_RE.test(value)

export const getWritingRouteIdentifier = (writing: WritingRouteSource) => {
  if (isTauriBuild) {
    return writing.id
  }

  const slug = writing.slug?.trim()

  return slug?.length ? slug : writing.id
}

export const buildWritingRouteHref = (basePath: string, writing: WritingRouteSource) => {
  // Desktop is a static export with no server: dynamic path segments like
  // /write/<uuid> have no generated HTML file and fail on hard navigation
  // ("Load failed"). Use a query param on the static base route instead
  // (/write?id=<uuid>), which the desktop write page reads on the client. Web
  // keeps clean path-based routing with slugs.
  if (isTauriBuild) {
    return `${basePath}?id=${encodeURIComponent(writing.id)}`
  }

  return `${basePath}/${getWritingRouteIdentifier(writing)}`
}
