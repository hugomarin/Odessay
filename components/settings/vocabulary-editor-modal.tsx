"use client"

import * as React from "react"
import { Sparkles } from "lucide-react"

import { FormModal } from "@/components/ui/dialog"
import { VocabularyIcon } from "@/components/settings/vocabulary-icon"
import { VocabularyDeleteConfirm } from "@/components/settings/vocabulary-delete-dialog"
import {
  ARTIFACT_TYPE_ICON_NAMES,
  VOCABULARY_COLORS,
  WRITING_STATUS_ICON_NAMES,
  getVocabularyTint,
  type VocabularyIconName,
  type VocabularyItem,
} from "@/lib/settings/vocabulary"
import { cn } from "@/lib/utils"

/** The prototype counts the description against 180 characters. */
const DESCRIPTION_LIMIT = 180

/**
 * The AI affordances stay off deliberately — owner decision, 2026-08-30: AI
 * assistance for the vocabulary editor is out of scope for this package, not
 * "not wired yet". Kept as a `title`, same rule as every disabled control on
 * this screen: a reason, never nothing.
 */
const AI_OUT_OF_SCOPE_REASON = "AI assistance for the vocabulary editor is out of scope for this release."

const FIELD_LABEL_CLASS =
  "mb-2 mt-[18px] text-[12px] font-medium uppercase leading-none tracking-[0.04em] text-ink-2"

export type VocabularyKind = "type" | "status"

export type VocabularyDraft = {
  name: string
  description: string
  icon: VocabularyIconName
  color: string
}

export function VocabularyEditorModal({
  open,
  onOpenChange,
  kind,
  item,
  onSave,
  onDelete,
  fetchUsage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: VocabularyKind
  /** `null` is the "New type" / "New status" case opened by the dashed row. */
  item: VocabularyItem | null
  /** Bound to `item` by the caller for an edit; bound to `kind` for a create. */
  onSave: (draft: VocabularyDraft) => Promise<void>
  /** Present only when this item can be deleted (a non-locked, already-saved item). */
  onDelete?: () => Promise<{ rewrittenCount: number }>
  fetchUsage?: () => Promise<number | null>
}) {
  const isType = kind === "type"
  const iconNames: readonly VocabularyIconName[] = isType
    ? ARTIFACT_TYPE_ICON_NAMES
    : WRITING_STATUS_ICON_NAMES

  const seed = React.useMemo<VocabularyDraft>(
    () => ({
      name: item?.name ?? "",
      description: item?.description ?? "",
      icon: item?.icon ?? (isType ? "book-open" : "circle"),
      color: item?.color ?? (isType ? "#5B5BD6" : "#8E837B"),
    }),
    [item, isType],
  )

  const [draft, setDraft] = React.useState<VocabularyDraft>(seed)
  const [isSaving, setIsSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)
  const [usage, setUsage] = React.useState<number | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  // Reopening on another row must not carry the previous row's edits over.
  React.useEffect(() => {
    if (open) {
      setDraft(seed)
      setSaveError(null)
      setConfirmingDelete(false)
      setDeleteError(null)
    }
  }, [open, seed])

  const patch = React.useCallback(
    (next: Partial<VocabularyDraft>) => setDraft((current) => ({ ...current, ...next })),
    [],
  )

  const dirty = draft.name !== seed.name || draft.description !== seed.description
    || draft.icon !== seed.icon || draft.color !== seed.color

  const chipTint = getVocabularyTint(draft.color)
  const canSave = draft.name.trim().length > 0 && !isSaving

  const handleSave = async () => {
    if (!canSave) return
    setIsSaving(true)
    setSaveError(null)
    try {
      await onSave(draft)
      onOpenChange(false)
    } catch (cause) {
      // Requirement 11: keep the modal open, keep the draft, show the error.
      setSaveError(cause instanceof Error ? cause.message : "Could not save that change.")
    } finally {
      setIsSaving(false)
    }
  }

  const openDeleteConfirm = async () => {
    setDeleteError(null)
    setUsage(null)
    setConfirmingDelete(true)
    if (fetchUsage) {
      const count = await fetchUsage().catch(() => null)
      setUsage(count)
    }
  }

  const handleConfirmDelete = async () => {
    if (!onDelete) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await onDelete()
      onOpenChange(false)
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Could not delete that item.")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <FormModal
      open={open}
      onOpenChange={(next) => {
        if (!next && confirmingDelete) return
        onOpenChange(next)
      }}
      width={520}
      title={draft.name || (isType ? "New type" : "New status")}
      description={isType ? "Artifact type" : "Artifact status"}
      dirty={dirty && !confirmingDelete}
      discardMessage="You have unsaved changes to this item. Discard them?"
      chip={
        <span
          className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: chipTint, color: draft.color }}
        >
          <VocabularyIcon name={draft.icon} size={20} />
        </span>
      }
      footer={
        <>
          {item?.locked ? (
            <span className="mr-auto max-w-[30ch] text-[12px] leading-snug text-ink-5">
              {item.lockNote}
            </span>
          ) : item && onDelete ? (
            <button
              type="button"
              onClick={() => void openDeleteConfirm()}
              className="mr-auto px-1 text-[13px] font-normal text-ink-3 transition-colors hover:text-cursor"
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-[34px] items-center rounded-md border-[0.5px] border-border bg-sb px-3.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-menu-hover hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            title={!canSave && !isSaving ? "Enter a name first." : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-[9px] bg-ink px-[15px] text-[13px] font-medium text-bg transition-opacity",
              !canSave && "cursor-not-allowed opacity-60",
            )}
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <label className={cn(FIELD_LABEL_CLASS, "block")} htmlFor="vocabulary-name">
        Name
      </label>
      <input
        id="vocabulary-name"
        value={draft.name}
        onChange={(event) => patch({ name: event.target.value })}
        className="h-[42px] w-full rounded-[9px] border-[0.5px] border-border bg-sb px-[13px] text-[14px] leading-none text-ink outline-none transition-colors focus:border-ink-5"
      />

      <div className="flex items-baseline justify-between gap-2.5">
        <label className={FIELD_LABEL_CLASS} htmlFor="vocabulary-description">
          Description
        </label>
        <span className="text-[11px] leading-none text-ink-5">When to use it</span>
      </div>
      <textarea
        id="vocabulary-description"
        value={draft.description}
        maxLength={DESCRIPTION_LIMIT}
        onChange={(event) => patch({ description: event.target.value })}
        placeholder="An artifact that…"
        className="h-[92px] w-full resize-none rounded-[9px] border-[0.5px] border-border bg-sb px-[13px] py-[11px] text-[14px] leading-[1.55] text-ink outline-none transition-colors placeholder:text-ink-5 focus:border-ink-5"
      />

      <div className="mt-[9px] flex items-center gap-2">
        <button
          type="button"
          disabled
          title={AI_OUT_OF_SCOPE_REASON}
          className="inline-flex h-8 cursor-not-allowed items-center gap-[7px] rounded-md border-[0.5px] border-border bg-sb px-3 text-[12px] font-medium text-ink-5"
        >
          Recommend to me
        </button>
        <button
          type="button"
          disabled
          title={AI_OUT_OF_SCOPE_REASON}
          aria-describedby="vocabulary-improve-reason"
          className="inline-flex h-8 cursor-not-allowed items-center rounded-md border-[0.5px] border-line-soft bg-sb px-3 text-[12px] font-medium text-ink-6"
        >
          <span className="mr-[7px] flex text-ink-6">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          Improve with AI
        </button>
        <span className="sr-only" id="vocabulary-improve-reason">
          {AI_OUT_OF_SCOPE_REASON}
        </span>
        <span className="flex-1" />
        <span className="text-[11px] leading-none text-ink-6">
          {draft.description.length}/{DESCRIPTION_LIMIT}
        </span>
      </div>

      <p className={FIELD_LABEL_CLASS}>Icon</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
        {iconNames.map((name) => {
          const selected = name === draft.icon
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={name}
              onClick={() => patch({ icon: name })}
              className={cn(
                "inline-flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border-[0.5px] transition-colors hover:border-ink-5",
                selected
                  ? "border-ink bg-surface-menu-hover text-ink"
                  : "border-border bg-sb text-ink-4",
              )}
            >
              <VocabularyIcon name={name} />
            </button>
          )
        })}
      </div>

      <p className={FIELD_LABEL_CLASS}>Color</p>
      <div className="flex gap-2.5 pb-1.5" role="radiogroup" aria-label="Color">
        {VOCABULARY_COLORS.map((color) => {
          const selected = color.hex.toLowerCase() === draft.color.toLowerCase()
          return (
            <button
              key={color.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={color.name}
              title={color.name}
              onClick={() => patch({ color: color.hex })}
              className="h-[30px] w-[30px] rounded-full border-0 transition-shadow"
              style={{
                background: color.hex,
                // 3px of sheet, then the 2px ring — the prototype's two-stop shadow.
                boxShadow: selected ? "0 0 0 3px #FFFFFF, 0 0 0 5px #1E1915" : undefined,
              }}
            />
          )
        })}
      </div>

      {saveError ? (
        <p role="alert" className="mt-3 text-[13px] leading-relaxed text-destructive">
          {saveError}
        </p>
      ) : null}

      {item ? (
        <VocabularyDeleteConfirm
          open={confirmingDelete}
          kind={kind}
          itemName={item.name}
          usage={usage}
          isDeleting={isDeleting}
          errorMessage={deleteError}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}
    </FormModal>
  )
}
