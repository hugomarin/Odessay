"use client"

import { useCallback, useMemo, useState } from "react"

import { VocabularyList } from "@/components/settings/vocabulary-list"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { getWritingStatusVocabulary } from "@/lib/settings/vocabulary"
import type { WritingStatus } from "@/lib/writings/status"

/**
 * Settings › Status.
 *
 * The switch is the one thing on this screen that persists: it writes
 * `profiles.disabled_statuses` through the settings provider that already
 * existed. Everything else the editor modal offers is presentation — see
 * `lib/settings/vocabulary.ts` for why.
 *
 * **Requirement 9 changed shipped behaviour.** Turning a status off used to call
 * `bulkRemapStatusToDraft`, which rewrote every artifact carrying that status.
 * The brief is explicit that turning a status off removes it from menus and
 * filters and *never* rewrites existing artifacts, so the remap — and the
 * confirmation dialog that fronted it — are gone. An artifact left on a hidden
 * status keeps that status; it simply stops being offered in the pickers.
 */
export default function WritingStatusSettings() {
  const { settings, isLoading, error, update } = useUserSettingsContext()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const items = useMemo(
    () => getWritingStatusVocabulary(settings.disabledStatuses),
    [settings.disabledStatuses],
  )

  const handleToggle = useCallback(
    (id: string, nextEnabled: boolean) => {
      const status = id as WritingStatus
      setSaveError(null)
      setIsSaving(true)

      const nextDisabled = nextEnabled
        ? settings.disabledStatuses.filter((entry) => entry !== status)
        : [...settings.disabledStatuses, status]

      void update({ disabledStatuses: nextDisabled })
        .catch((cause: unknown) =>
          setSaveError(cause instanceof Error ? cause.message : "Could not save that change."),
        )
        .finally(() => setIsSaving(false))
    },
    [settings.disabledStatuses, update],
  )

  return (
    <div id="settings-status" data-section="settings-status" data-testid="settings-status">
      {error ? (
        <p role="alert" className="mb-3 text-[13px] text-destructive">
          Could not load settings. {error}
        </p>
      ) : null}

      {saveError ? (
        <p role="alert" className="mb-3 text-[13px] text-destructive">
          {saveError}
        </p>
      ) : null}

      <VocabularyList
        kind="status"
        items={items}
        addLabel="New status"
        onToggle={handleToggle}
        toggleBusy={isLoading || isSaving}
        footnote="Hiding a status keeps it out of menus and filters. Artifacts already carrying it are left exactly as they are."
      />
    </div>
  )
}
