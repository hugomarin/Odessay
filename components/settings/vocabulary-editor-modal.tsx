"use client"

import * as React from "react"
import { Sparkles } from "lucide-react"

import { FormModal } from "@/components/ui/dialog"
import { VocabularyIcon } from "@/components/settings/vocabulary-icon"
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
 * Why Save and Delete are inert. ODE-432 ships the editor as design: the
 * vocabulary has no durable home yet (the catalogue is two closed unions and
 * the only persisted setting is `profiles.disabled_statuses`), so wiring it is
 * the successor issue's job. Stating the reason in `title` is the same rule
 * requirement 7 sets for the disabled "Improve with AI" button — a disabled
 * control without a visible reason is the trap this view is told to avoid.
 */
const NOT_WIRED_REASON = "Editing the vocabulary is not connected yet — this release ships the design."

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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: VocabularyKind
  /** `null` is the "New type" / "New status" case opened by the dashed row. */
  item: VocabularyItem | null
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

  // Reopening on another row must not carry the previous row's edits over.
  React.useEffect(() => {
    if (open) setDraft(seed)
  }, [open, seed])

  const patch = React.useCallback(
    (next: Partial<VocabularyDraft>) => setDraft((current) => ({ ...current, ...next })),
    [],
  )

  const canImprove = draft.name.trim().length > 0 || draft.description.trim().length > 0
  const improveReason = canImprove
    ? NOT_WIRED_REASON
    : "Add a name or a description first."

  const chipTint = getVocabularyTint(draft.color)

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      width={520}
      title={draft.name || (isType ? "New type" : "New status")}
      description={isType ? "Artifact type" : "Writing status"}
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
          ) : (
            <button
              type="button"
              disabled
              title={NOT_WIRED_REASON}
              className="mr-auto cursor-not-allowed px-1 text-[13px] font-normal text-ink-5 transition-colors hover:text-cursor"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-[34px] items-center rounded-md border-[0.5px] border-border bg-sb px-3.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-menu-hover hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled
            title={NOT_WIRED_REASON}
            className="inline-flex h-9 cursor-not-allowed items-center rounded-[9px] bg-ink px-[15px] text-[13px] font-medium text-bg opacity-60"
          >
            Save
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
          title={NOT_WIRED_REASON}
          className="inline-flex h-8 cursor-not-allowed items-center gap-[7px] rounded-md border-[0.5px] border-border bg-sb px-3 text-[12px] font-medium text-ink-5"
        >
          Recommend to me
        </button>
        <button
          type="button"
          disabled
          title={improveReason}
          aria-describedby="vocabulary-improve-reason"
          className={cn(
            "inline-flex h-8 cursor-not-allowed items-center rounded-md border-[0.5px] bg-sb px-3 text-[12px] font-medium transition-colors",
            canImprove ? "border-border text-ink-2" : "border-line-soft text-ink-6",
          )}
        >
          <span className={cn("mr-[7px] flex", canImprove ? "text-cursor" : "text-ink-6")}>
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          Improve with AI
        </button>
        <span className="sr-only" id="vocabulary-improve-reason">
          {improveReason}
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
    </FormModal>
  )
}
