"use client"

import { useCallback, useState } from "react"

import { VocabularyList } from "@/components/settings/vocabulary-list"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { useVocabulary } from "@/hooks/useVocabulary"
import { getWritingStatusVocabulary } from "@/lib/settings/vocabulary"

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
  const { isLoading, error, updateVocabularyItem } = useUserSettingsContext()
  // Subscribes this page to the shared catalog so it repaints the instant
  // Save/Delete resolves — requirement 1/9, without a reload.
  useVocabulary()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const items = getWritingStatusVocabulary()

  const handleToggle = useCallback(
    (id: string, nextEnabled: boolean) => {
      setSaveError(null)
      setIsSaving(true)

      void updateVocabularyItem(id, { hidden: !nextEnabled })
        .catch((cause: unknown) =>
          setSaveError(cause instanceof Error ? cause.message : "Could not save that change."),
        )
        .finally(() => setIsSaving(false))
    },
    [updateVocabularyItem],
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
