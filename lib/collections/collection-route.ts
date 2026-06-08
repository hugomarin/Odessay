// NEXT_PUBLIC_TAURI_BUILD (not plain TAURI_BUILD) because this runs at client
// runtime when building hrefs; only NEXT_PUBLIC_* vars are inlined into the
// client bundle. Set by scripts/prepare-tauri-build.mjs for the DMG build.
const isTauriBuild = process.env.NEXT_PUBLIC_TAURI_BUILD === "true"

/**
 * Builds the href for a collection detail page.
 *
 * The packaged desktop app is a static export: dynamic path segments like
 * /collections/<uuid> have no generated HTML file and fail on hard navigation,
 * causing a fallback to "/" which then redirects to /desk. Use a query param
 * on the static base route instead (/collections?id=<uuid>), which the desktop
 * collections page reads on the client. Web keeps clean path-based routing.
 */
export const buildCollectionHref = (collectionId: string): string => {
  if (isTauriBuild) {
    return `/collections?id=${encodeURIComponent(collectionId)}`
  }

  return `/collections/${collectionId}`
}
