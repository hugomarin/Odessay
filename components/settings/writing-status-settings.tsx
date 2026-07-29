"use client"

import { useCallback, useMemo, useState } from "react"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { Switch } from "@/components/ui/switch"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { bulkRemapStatusToDraft } from "@/lib/writings/bulk-remap"
import {
  getWritingStatusLabel,
  MANDATORY_WRITING_STATUSES,
  WRITING_STATUS_VALUES,
} from "@/lib/writings/status"
import type { WritingStatus } from "@/lib/writings/status"
import { cn } from "@/lib/utils"

type ConfirmationState = {
  open: boolean
  status: WritingStatus | null
  affectedCount: number
}
const DEFAULT_CONFIRMATION: ConfirmationState = {
  open: false,
  status: null,
  affectedCount: 0,
}

export default function WritingStatusSettings() {
  const { settings, isLoading, error, update } = useUserSettingsContext()
  const [confirmation, setConfirmation] = useState<ConfirmationState>(DEFAULT_CONFIRMATION)
  const [isRemapping, setIsRemapping] = useState(false)
  const [remapError, setRemapError] = useState<string | null>(null)
  const [remapSuccess, setRemapSuccess] = useState<string | null>(null)

  const disabledSet = useMemo(
    () => new Set(settings.disabledStatuses),
    [settings.disabledStatuses],
  )

  const checkAffectedCount = useCallback(async (status: WritingStatus) => {
    const { localDB } = await import("@/lib/local-db")
    const allWritings = await localDB.writings.getAll()
    const count = allWritings.filter(
      (w) => w.status === status && w.sync_status !== "deleted",
    ).length
    return count
  }, [])

  const handleToggle = useCallback(
    async (status: WritingStatus, nextEnabled: boolean) => {
      setRemapError(null)
      setRemapSuccess(null)

      if (nextEnabled) {
        // Enabling a status — just remove from disabled list
        const nextDisabled = settings.disabledStatuses.filter((s) => s !== status)
        await update({ disabledStatuses: nextDisabled })
        return
      }

      // Disabling a status — check if any writings use it
      const affectedCount = await checkAffectedCount(status)

      if (affectedCount > 0) {
        setConfirmation({
          open: true,
          status,
          affectedCount,
        })
        return
      }

      // No writings affected — disable directly
      const nextDisabled = [...settings.disabledStatuses, status]
      await update({ disabledStatuses: nextDisabled })
    },
    [settings.disabledStatuses, update, checkAffectedCount],
  )

  const handleConfirmDisable = useCallback(async () => {
    if (!confirmation.status) {
      return
    }

    setIsRemapping(true)
    setRemapError(null)
    setRemapSuccess(null)

    try {
      const result = await bulkRemapStatusToDraft(confirmation.status)

      if (result.errors.length > 0) {
        setRemapError(`${result.errors.length} writings could not be remapped.`)
      }

      const nextDisabled = [...settings.disabledStatuses, confirmation.status]
      await update({ disabledStatuses: nextDisabled })

      if (result.affectedCount > 0) {
        setRemapSuccess(
          `${result.affectedCount} writing${result.affectedCount !== 1 ? "s" : ""} moved to Draft.`,
        )
      }

      setConfirmation(DEFAULT_CONFIRMATION)
    } catch (error) {
      setRemapError(error instanceof Error ? error.message : "Failed to remap writings.")
    } finally {
      setIsRemapping(false)
    }
  }, [confirmation.status, settings.disabledStatuses, update])

  const handleCancelDisable = useCallback(() => {
    setConfirmation(DEFAULT_CONFIRMATION)
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-lora text-[24px] font-medium text-ink">Writing statuses</h1>
        <p className="mt-1 text-[13px] text-ink-4">
          Choose which statuses appear in menus and filters across Desk and the editor.
        </p>
      </div>

      {error ? (
        <p className="text-[13px] text-[hsl(0,72%,45%)]">
          Could not load settings. {error}
        </p>
      ) : null}

      {remapSuccess ? (
        <p className="text-[13px] text-[hsl(140,40%,30%)]">{remapSuccess}</p>
      ) : null}

      {remapError ? (
        <p className="text-[13px] text-[hsl(0,72%,45%)]">{remapError}</p>
      ) : null}

      <div className="space-y-1">
        {WRITING_STATUS_VALUES.map((status) => {
          const isMandatory = MANDATORY_WRITING_STATUSES.includes(status)
          const isEnabled = !disabledSet.has(status)

          return (
            <div
              key={status}
              className={cn(
                "flex items-center justify-between rounded-[8px] border-[0.5px] border-border bg-sb px-4 py-3",
                isMandatory && "opacity-80",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="flex shrink-0 items-center text-ink-3">
                  <WritingStatusIcon status={status} className="h-[14px] w-[14px]" />
                </span>
                <span className="text-[13px] font-medium text-ink">
                  {getWritingStatusLabel(status)}
                </span>
                {isMandatory ? (
                  <span className="text-[11px] text-ink-4">Required</span>
                ) : null}
              </div>

              <Switch
                checked={isEnabled}
                disabled={isMandatory || isLoading || isRemapping}
                onCheckedChange={(checked) => void handleToggle(status, checked)}
                aria-label={`Toggle ${getWritingStatusLabel(status)} status`}
              />
            </div>
          )
        })}
      </div>

      {confirmation.open && confirmation.status ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="w-full max-w-[400px] rounded-[12px] border-[0.5px] border-border bg-sb p-6 shadow-float-lg">
            <h2 className="font-lora text-[18px] font-medium text-ink">
              Disable {getWritingStatusLabel(confirmation.status)}?
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
              {confirmation.affectedCount} writing
              {confirmation.affectedCount !== 1 ? "s" : ""} currently use{" "}
              {getWritingStatusLabel(confirmation.status)}. If you continue, those writings will be
              moved to <strong>Draft</strong>.
            </p>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelDisable}
                disabled={isRemapping}
                className="inline-flex h-9 items-center rounded-[8px] border-[0.5px] border-border bg-bg px-4 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDisable()}
                disabled={isRemapping}
                className="inline-flex h-9 items-center rounded-[8px] bg-ink px-4 text-[13px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isRemapping ? "Moving…" : "Move to Draft"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
