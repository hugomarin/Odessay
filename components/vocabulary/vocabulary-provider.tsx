"use client"

import { useEffect } from "react"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { setVocabularyCatalog } from "@/lib/vocabulary/catalog"

/**
 * Bridges `UserSettingsProvider`'s already-fetched `settings.vocabulary`
 * into the module-level catalog singleton (`lib/vocabulary/catalog.ts`).
 * Deliberately not a second fetch: `UserSettingsService.getUserSettings()`
 * already returns the resolved vocabulary (ODE-472/473), so mounting a
 * second provider that re-fetches it would violate the "one vocabulary read
 * per app session" waterfall budget. Must be mounted inside
 * `UserSettingsProvider` (see `app/(app)/layout.tsx`) — requirement 1: one
 * catalog, mounted once.
 */
export function VocabularyCatalogBridge() {
  const { settings } = useUserSettingsContext()

  useEffect(() => {
    setVocabularyCatalog(settings.vocabulary)
  }, [settings.vocabulary])

  return null
}
