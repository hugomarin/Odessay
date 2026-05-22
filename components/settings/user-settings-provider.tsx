"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import type { WritingStatus } from "@/lib/writings/status"
import type { UserSettings } from "@/lib/user/settings"

type UserSettingsContextValue = {
  settings: UserSettings
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  update: (updates: { disabledStatuses: WritingStatus[] }) => Promise<void>
}

const DEFAULT_SETTINGS: UserSettings = {
  disabledStatuses: [],
}

const UserSettingsContext = createContext<UserSettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  isLoading: true,
  error: null,
  refresh: async () => {},
  update: async () => {},
})

export function useUserSettingsContext() {
  return useContext(UserSettingsContext)
}

export function UserSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/user/settings", { method: "GET" })
      const payload = (await response.json()) as {
        data: { disabledStatuses: WritingStatus[] } | null
        error: { code: string; message: string } | null
      }

      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Failed to load settings.")
      }

      setSettings({ disabledStatuses: payload.data.disabledStatuses })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const update = useCallback(async (updates: { disabledStatuses: WritingStatus[] }) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled_statuses: updates.disabledStatuses }),
      })

      const payload = (await response.json()) as {
        data: { disabledStatuses: WritingStatus[] } | null
        error: { code: string; message: string } | null
      }

      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Failed to save settings.")
      }

      setSettings({ disabledStatuses: payload.data.disabledStatuses })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.")
      throw err
    } finally {
      setIsLoading(false)
    }
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
    <UserSettingsContext.Provider value={{ settings, isLoading, error, refresh, update }}>
      {children}
    </UserSettingsContext.Provider>
  )
}
