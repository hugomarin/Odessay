import { isUuidLikeWritingIdentifier } from "@/lib/writings/writing-route"

type OwnedWritingRouteRow = {
  id: string
  slug: string | null
}

export type WriteDetailRouteResolution =
  | { kind: "not-found" }
  | { kind: "redirect"; href: string }
  | { kind: "editor"; writingId: string }

export const resolveWriteDetailRoute = (
  identifier: string,
  writing: OwnedWritingRouteRow | null,
): WriteDetailRouteResolution => {
  if (!writing) {
    if (isUuidLikeWritingIdentifier(identifier)) {
      // Allow local-first drafts to load while remote sync catches up.
      return { kind: "editor", writingId: identifier }
    }

    return { kind: "not-found" }
  }

  if (writing.slug && identifier !== writing.slug) {
    return { kind: "redirect", href: `/write/${writing.slug}` }
  }

  return { kind: "editor", writingId: writing.id }
}
