"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import type { WritingStatus } from "@/lib/writings/status"
import type { UserSettings } from "@/lib/user/settings"
import type { SettingsService, VocabularyUsage } from "@/lib/services/contracts/settings-service"
import type { CreateVocabularyItemInput, UpdateVocabularyItemInput, VocabularyItem } from "@/lib/vocabulary/types"
import { isTauriRuntime } from "@/lib/runtime/detect"

type UserSettingsContextValue = {
  settings: UserSettings
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  update: (updates: { disabledStatuses: WritingStatus[] }) => Promise<void>
  createVocabularyItem: (input: CreateVocabularyItemInput) => Promise<VocabularyItem>
  updateVocabularyItem: (id: string, input: UpdateVocabularyItemInput) => Promise<VocabularyItem>
  deleteVocabularyItem: (id: string) => Promise<{ rewrittenCount: number }>
  /** `null` means the count could not be taken — never treat that as zero (requirement 7). */
  getVocabularyUsage: () => Promise<VocabularyUsage | null>
}

const DEFAULT_SETTINGS: UserSettings = {
  disabledStatuses: [],
  vocabulary: [],
}

const noop = async () => {
  throw new Error("UserSettingsProvider is not mounted")
}

const UserSettingsContext = createContext<UserSettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  isLoading: true,
  error: null,
  refresh: async () => {},
  update: noop,
  createVocabularyItem: noop,
  updateVocabularyItem: noop,
  deleteVocabularyItem: noop,
  getVocabularyUsage: async () => null,
})

export function useUserSettingsContext() {
  return useContext(UserSettingsContext)
}

/**
 * Resolves the SettingsService adapter for the current runtime — the one
 * place `UserSettingsProvider` branches on `isTauriRuntime()`, so every
 * settings/vocabulary operation below reads the same way regardless of
 * runtime (ODE-475 requirement 13).
 */
async function getSettingsService(): Promise<SettingsService> {
  if (isTauriRuntime()) {
    const [{ appConfigDir }, { DesktopSettingsService }] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@/lib/services/desktop/desktop-settings-service"),
    ])
    return new DesktopSettingsService(await appConfigDir())
  }
  const { WebSettingsService } = await import("@/lib/services/web/web-settings-service")
  return new WebSettingsService()
}

export function UserSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const service = await getSettingsService()
      const result = await service.getUserSettings()
      if (result.error) {
        throw new Error(result.error.message)
      }
      setSettings(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.")
      // Never fall back to an empty vocabulary — that would read as "you lost
      // your configuration". Base items only, per the failure mode.
      setSettings((prev) => (prev.vocabulary.length > 0 ? prev : DEFAULT_SETTINGS))
    } finally {
      setIsLoading(false)
    }
  }, [])

  const update = useCallback(async (updates: { disabledStatuses: WritingStatus[] }) => {
    setIsLoading(true)
    setError(null)
    try {
      const service = await getSettingsService()
      const result = await service.updateUserSettings(updates)
      if (result.error) {
        throw new Error(result.error.message)
      }
      setSettings(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.")
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  const createVocabularyItem = useCallback(async (input: CreateVocabularyItemInput) => {
    const service = await getSettingsService()
    const result = await service.createVocabularyItem(input)
    if (result.error) {
      throw new Error(result.error.message)
    }
    const created = result.data
    setSettings((prev) => ({ ...prev, vocabulary: [...prev.vocabulary, created] }))
    return created
  }, [])

  const updateVocabularyItem = useCallback(async (id: string, input: UpdateVocabularyItemInput) => {
    const service = await getSettingsService()
    const result = await service.updateVocabularyItem(id, input)
    if (result.error) {
      throw new Error(result.error.message)
    }
    const updated = result.data
    setSettings((prev) => ({
      ...prev,
      vocabulary: prev.vocabulary.some((item) => item.id === id)
        ? prev.vocabulary.map((item) => (item.id === id ? updated : item))
        : [...prev.vocabulary, updated],
    }))
    return updated
  }, [])

  const deleteVocabularyItem = useCallback(async (id: string) => {
    const service = await getSettingsService()
    const result = await service.deleteVocabularyItem(id)
    if (result.error) {
      throw new Error(result.error.message)
    }
    setSettings((prev) => ({
      ...prev,
      vocabulary: prev.vocabulary.filter((item) => item.id !== id),
    }))
    return result.data
  }, [])

  const getVocabularyUsage = useCallback(async () => {
    const service = await getSettingsService()
    const result = await service.getVocabularyUsage()
    // Unavailable, not zero — requirement 7. The caller decides how to word it.
    return result.error ? null : result.data
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Refresh when window regains focus in case settings changed in another tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [refresh])

  return (
    <UserSettingsContext.Provider
      value={{
        settings,
        isLoading,
        error,
        refresh,
        update,
        createVocabularyItem,
        updateVocabularyItem,
        deleteVocabularyItem,
        getVocabularyUsage,
      }}
    >
      {children}
    </UserSettingsContext.Provider>
  )
}
