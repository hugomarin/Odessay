"use client"

import { useCallback, useEffect, useState } from "react"
import type { WritingStatus } from "@/lib/writings/status"
import type { UserSettings } from "@/lib/user/settings"
import type { VocabularyItem } from "@/lib/vocabulary/types"

type UserSettingsState = {
  settings: UserSettings
  isLoading: boolean
  error: string | null
}

const DEFAULT_SETTINGS: UserSettings = {
  disabledStatuses: [],
  vocabulary: [],
}

type SettingsPayload = { disabledStatuses: WritingStatus[]; vocabulary: VocabularyItem[] }

async function fetchSettings(): Promise<UserSettings> {
  const response = await fetch("/api/user/settings", { method: "GET" })
  const payload = (await response.json()) as {
    data: SettingsPayload | null
    error: { code: string; message: string } | null
  }

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Failed to load settings.")
  }

  return {
    disabledStatuses: payload.data.disabledStatuses,
    vocabulary: payload.data.vocabulary,
  }
}

async function patchSettings(updates: Partial<UserSettings>): Promise<UserSettings> {
  const response = await fetch("/api/user/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      disabled_statuses: updates.disabledStatuses,
    }),
  })

  const payload = (await response.json()) as {
    data: SettingsPayload | null
    error: { code: string; message: string } | null
  }

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Failed to save settings.")
  }

  return {
    disabledStatuses: payload.data.disabledStatuses,
    vocabulary: payload.data.vocabulary,
  }
}

export function useUserSettings() {
  const [state, setState] = useState<UserSettingsState>({
    settings: DEFAULT_SETTINGS,
    isLoading: true,
    error: null,
  })

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))
    try {
      const settings = await fetchSettings()
      setState({ settings, isLoading: false, error: null })
    } catch (error) {
      setState({
        settings: DEFAULT_SETTINGS,
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to load settings.",
      })
    }
  }, [])

  const update = useCallback(async (updates: Partial<UserSettings>) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))
    try {
      const settings = await patchSettings(updates)
      setState({ settings, isLoading: false, error: null })
      return settings
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to save settings.",
      }))
      throw error
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return {
    ...state,
    reload: load,
    update,
  }
}
