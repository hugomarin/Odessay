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
    // Routing fallback for local-first drafts: UUID-shaped identifiers may
    // correspond to writings that exist only in localDB (lifecycle: "local-only").
    // The server cannot inspect IndexedDB, so we use the UUID convention as a
    // coarse signal to route to the editor shell instead of 404. The client
    // then resolves the actual lifecycle from localDB and decides how to hydrate.
    if (isUuidLikeWritingIdentifier(identifier)) {
      return { kind: "editor", writingId: identifier }
    }

    return { kind: "not-found" }
  }

  if (writing.slug && identifier !== writing.slug) {
    return { kind: "redirect", href: `/write/${writing.slug}` }
  }

  return { kind: "editor", writingId: writing.id }
}
