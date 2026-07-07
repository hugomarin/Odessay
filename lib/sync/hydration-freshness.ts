// Freshness window for the web hydration paths, mirroring the desktop
// mechanism in desktop-sync-service. Single-flight only collapses concurrent
// callers; sequential callers (Desk mounting after bootstrap, focus refresh)
// would still re-fetch without this. Keys are localDB scopes (the userId on
// authenticated sessions) so a user switch never reuses another scope's
// freshness.
export const HYDRATION_FRESHNESS_WINDOW_MS = 45_000

export type HydrationFreshness = {
  isFresh: (scope: string | undefined) => boolean
  markFresh: (scope: string | undefined) => void
  invalidate: (scope?: string) => void
}

export const createHydrationFreshness = (
  windowMs: number = HYDRATION_FRESHNESS_WINDOW_MS,
): HydrationFreshness => {
  const lastHydratedAtByScope = new Map<string, number>()

  return {
    isFresh(scope) {
      if (!scope) return false
      const lastHydratedAt = lastHydratedAtByScope.get(scope)
      return lastHydratedAt !== undefined && Date.now() - lastHydratedAt < windowMs
    },
    markFresh(scope) {
      if (!scope) return
      lastHydratedAtByScope.set(scope, Date.now())
    },
    invalidate(scope) {
      if (scope) {
        lastHydratedAtByScope.delete(scope)
      } else {
        lastHydratedAtByScope.clear()
      }
    },
  }
}
