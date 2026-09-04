"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import { Switch } from "@/components/ui/switch"
import { VocabularyIcon } from "@/components/settings/vocabulary-icon"
import {
  VocabularyEditorModal,
  type VocabularyDraft,
  type VocabularyKind,
} from "@/components/settings/vocabulary-editor-modal"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { getStatusChipTint, getVocabularyTint, type VocabularyItem } from "@/lib/settings/vocabulary"
import { cn } from "@/lib/utils"

/**
 * Artifact types and writing statuses are one component with two item shapes —
 * `docs/design/views/settings.md` §"Artifact types and Status". The only
 * difference the list knows about is the trailing switch, which statuses have
 * and types do not.
 *
 * Geometry read from the render of `Artifact Studio Settings.dc.html`: cards at
 * radius 12 over the sheet, 8px apart, 38px colour chip at radius 10, name at
 * 14/500 over a 12/1.45 description, a 32px "Edit" ghost and the 40×23 switch.
 *
 * Divergence recorded in the ODE-432 PR: the prose says radius 10 and a 44px add
 * row; the render draws 12 and 42. Per `docs/design/migration-plan.md` §4 the
 * prototype wins.
 *
 * ODE-475: Save/Delete are wired here through `UserSettingsProvider`'s
 * vocabulary CRUD — this is the only place in the settings surface that talks
 * to `SettingsService`, so `ArtifactTypeSettings`/`WritingStatusSettings`
 * stay pure presentation.
 */

export function VocabularyList({
  kind,
  items,
  addLabel,
  onToggle,
  toggleBusy = false,
  footnote,
}: {
  kind: VocabularyKind
  items: VocabularyItem[]
  /** "New type" / "New status" — the dashed row's label. */
  addLabel: string
  /** Statuses only. Absent for types, which have no switch. */
  onToggle?: (id: string, nextEnabled: boolean) => void
  toggleBusy?: boolean
  footnote?: React.ReactNode
}) {
  const { createVocabularyItem, updateVocabularyItem, deleteVocabularyItem, getVocabularyUsage } =
    useUserSettingsContext()
  const [editing, setEditing] = React.useState<VocabularyItem | null>(null)
  const [open, setOpen] = React.useState(false)

  // Requirement 6/2: the dashed row opens the editor immediately. It opens on
  // an empty draft rather than appending a row first, which is what keeps the
  // promise that an untitled row never appears in the list.
  const openEditor = (item: VocabularyItem | null) => {
    setEditing(item)
    setOpen(true)
  }

  const handleSave = React.useCallback(
    async (draft: VocabularyDraft) => {
      if (editing) {
        await updateVocabularyItem(editing.id, {
          name: draft.name,
          description: draft.description,
          icon: draft.icon,
          color: draft.color,
        })
        return
      }
      await createVocabularyItem({
        kind,
        name: draft.name,
        description: draft.description,
        icon: draft.icon,
        color: draft.color,
      })
    },
    [editing, kind, createVocabularyItem, updateVocabularyItem],
  )

  const handleDelete = React.useMemo(() => {
    if (!editing || editing.locked) return undefined
    return async () => deleteVocabularyItem(editing.id)
  }, [editing, deleteVocabularyItem])

  const fetchUsage = React.useMemo(() => {
    if (!editing) return undefined
    return async () => {
      const usage = await getVocabularyUsage()
      // `null` propagates as "unavailable" — requirement 7 never treats that as zero.
      return usage ? (usage[editing.id] ?? 0) : null
    }
  }, [editing, getVocabularyUsage])

  return (
    <>
      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const chipTint = item.color.startsWith("#")
            ? getVocabularyTint(item.color)
            : getStatusChipTint(item.color)

          return (
            <div
              key={item.id}
              data-testid={`vocabulary-item-${item.id}`}
              className="rounded-xl border-[0.5px] border-line-soft bg-sb transition-colors"
            >
              <div className="flex items-center gap-3.5 px-3.5 py-3">
                <span
                  className="inline-flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg"
                  style={{ background: chipTint, color: item.color }}
                >
                  <VocabularyIcon name={item.icon} />
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2.5">
                    <span className="truncate text-[14px] font-medium leading-tight text-ink">
                      {item.name}
                    </span>
                    {item.required ? (
                      <span className="flex-shrink-0 text-[12px] leading-none text-ink-5">
                        Required
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-[12px] leading-[1.45] text-ink-4">
                    {item.description || "No description"}
                  </span>
                </span>

                <button
                  type="button"
                  onClick={() => openEditor(item)}
                  className="inline-flex h-8 flex-shrink-0 items-center rounded-md border-[0.5px] border-border bg-sb px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-menu-hover hover:text-ink"
                >
                  Edit
                </button>

                {onToggle ? (
                  <Switch
                    variant="settings"
                    checked={item.enabled ?? true}
                    // Requirement 4: only a required status (draft) cannot be
                    // hidden — `locked` alone would also catch every other
                    // base status, which can be hidden like any custom one.
                    disabled={item.required || toggleBusy}
                    onCheckedChange={(next) => onToggle(item.id, next)}
                    aria-label={`Show ${item.name} in menus`}
                    title={item.required ? item.lockNote : "Show in menus"}
                    // A required status reads as on-and-fixed, not as faded:
                    // the prototype fills its track with ink-5 at full opacity
                    // rather than dimming the ink one.
                    className={cn(
                      item.required && "disabled:opacity-100 data-[state=checked]:bg-ink-5",
                    )}
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => openEditor(null)}
        className="mt-3 inline-flex h-[42px] items-center gap-2 rounded-lg border-[0.5px] border-dashed border-ink-6 bg-transparent px-4 text-[13px] font-medium text-ink-3 transition-colors hover:border-ink-5 hover:text-ink"
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        {addLabel}
      </button>

      {footnote ? (
        <p className="mt-3.5 max-w-[52ch] text-[12px] leading-[1.6] text-ink-5">{footnote}</p>
      ) : null}

      <VocabularyEditorModal
        open={open}
        onOpenChange={setOpen}
        kind={kind}
        item={editing}
        onSave={handleSave}
        onDelete={handleDelete}
        fetchUsage={fetchUsage}
      />
    </>
  )
}
