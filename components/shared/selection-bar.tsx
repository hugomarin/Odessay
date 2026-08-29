"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Selection bar — one component, two surfaces.
 *
 * The Desk and Settings › Archived artifacts render the same floating bar; the
 * prototypes agree on it to the pixel (`Artifact Studio Desk.dc.html` and
 * `Artifact Studio Settings.dc.html`), and only the action set differs. That is
 * why the geometry lives here and the actions arrive as configuration: a view
 * chooses what the bar does, never how it looks.
 *
 * Geometry, read from the prototypes: 56px tall, radius 14, ink background,
 * centred, 26px off the bottom edge, `--shadow-selection-bar`, 22px of leading
 * padding against 14px of trailing padding, 10px gaps.
 *
 * The component knows nothing about artifacts, writings or archives. It takes a
 * count, labels and handlers.
 */

/** Padding the sheet gets while the bar is up, so the last row stays reachable. */
export const SELECTION_BAR_SHEET_PADDING = 96

/**
 * Marks the scrollable sheet the bar floats over. The bar pads it while it is
 * visible; without the attribute it falls back to the nearest scrollable
 * ancestor, so a view that forgets to mark its sheet still keeps its last row
 * clickable.
 */
export const SELECTION_BAR_SHEET_ATTR = "data-selection-bar-sheet"

export interface SelectionBarAction {
  /** Stable key; also the accessible name when no label is rendered. */
  id: string
  label: string
  icon?: React.ReactNode
  /** Trailing glyph — the prototypes render a 14px chevron on chips that open a menu. */
  trailingIcon?: React.ReactNode
  /** Renders the destructive treatment: terracotta tint, lighter label. */
  destructive?: boolean
  /**
   * Runs the action. A promise puts the whole bar in its busy state until it
   * settles — success or failure — so a slow bulk operation can never leave the
   * bar disabled forever.
   */
  onSelect?: () => void | Promise<unknown>
  /**
   * Renders the chip inside a caller-owned wrapper (a dropdown trigger, for
   * instance). The chip element is handed back so the wrapper keeps the exact
   * geometry instead of restyling it.
   */
  render?: (chip: React.ReactElement) => React.ReactNode
}

export interface SelectionBarProps {
  /** Number of selected rows. At zero the bar renders nothing. */
  selectedCount: number
  /** Formats the count. Defaults to "N selected", as both prototypes render it. */
  countLabel?: (count: number) => string
  /** Omitted or false hides "Select all" — Settings › Archive shows only "Deselect". */
  onSelectAll?: () => void
  canSelectAll?: boolean
  /** Also bound to Escape. */
  onDeselectAll: () => void
  actions: SelectionBarAction[]
  /**
   * `fixed` pins the bar to the viewport; `absolute` pins it to the nearest
   * positioned ancestor, which is what the prototypes render (the bar sits
   * inside the sheet). Nothing else about the geometry is configurable.
   */
  placement?: "fixed" | "absolute"
  id?: string
  "data-testid"?: string
}

const CHIP_CLASS =
  "inline-flex h-9 items-center gap-2 rounded-[9px] px-[13px] text-[14px] font-medium text-bg transition-colors disabled:cursor-not-allowed disabled:opacity-60"

/**
 * Pads the sheet the bar floats over for as long as the bar is mounted, then
 * puts the sheet back exactly as it found it. Doing this from the bar — rather
 * than asking every consumer for a conditional padding class — is what makes
 * requirement 4 hold in all three views that render it today.
 */
function useSheetPadding(barRef: React.RefObject<HTMLDivElement | null>, active: boolean) {
  React.useEffect(() => {
    const bar = active ? barRef.current : null
    if (!bar) return

    const sheet = findSheet(bar)
    if (!sheet) return

    const previous = sheet.style.paddingBottom
    sheet.style.paddingBottom = `${SELECTION_BAR_SHEET_PADDING}px`
    return () => {
      sheet.style.paddingBottom = previous
    }
  }, [barRef, active])
}

/**
 * Finds the scrolling sheet the bar floats over.
 *
 * The bar is a *sibling* of that sheet, not a descendant — it is positioned
 * against the sheet's wrapper so it can sit on top of the rows. So the search
 * climbs the ancestors and, at each level, looks back down for the sheet: first
 * an explicitly marked one, then a scrollable descendant.
 */
function findSheet(from: HTMLElement): HTMLElement | null {
  const view = from.ownerDocument.defaultView

  for (let node: HTMLElement | null = from; node; node = node.parentElement) {
    if (node.hasAttribute(SELECTION_BAR_SHEET_ATTR)) return node

    const marked = node.querySelector<HTMLElement>(`[${SELECTION_BAR_SHEET_ATTR}]`)
    if (marked) return marked
  }

  for (let node: HTMLElement | null = from.parentElement; node; node = node.parentElement) {
    const scrollable = Array.from(node.querySelectorAll<HTMLElement>("*")).find((candidate) => {
      const overflowY = view?.getComputedStyle(candidate).overflowY
      return overflowY === "auto" || overflowY === "scroll"
    })
    if (scrollable) return scrollable

    const overflowY = view?.getComputedStyle(node).overflowY
    if (overflowY === "auto" || overflowY === "scroll") return node
  }

  return null
}

export function SelectionBar({
  selectedCount,
  countLabel = (count) => `${count} selected`,
  onSelectAll,
  canSelectAll = true,
  onDeselectAll,
  actions,
  placement = "fixed",
  id,
  "data-testid": testId = "selection-bar",
}: SelectionBarProps) {
  const barRef = React.useRef<HTMLDivElement | null>(null)
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)
  const hasSelection = selectedCount > 0

  useSheetPadding(barRef, hasSelection)

  React.useEffect(() => {
    if (!hasSelection) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDeselectAll()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [hasSelection, onDeselectAll])

  // A selection emptied by the watcher or by sync while an action was in flight
  // must not leave the bar stuck in its busy state on the next mount.
  React.useEffect(() => {
    if (!hasSelection) setPendingAction(null)
  }, [hasSelection])

  const runAction = React.useCallback(
    async (action: SelectionBarAction) => {
      // The selection can empty between the click and the handler — another
      // source removing the last selected row, or a racing "Deselect". An action
      // over nothing is not an action.
      if (selectedCount < 1 || !action.onSelect) return
      setPendingAction(action.id)
      try {
        await action.onSelect()
      } catch {
        // Reporting the failure belongs to the view that owns the mutation —
        // it shows the error where the user can act on it. What the bar owns is
        // the guarantee that a rejected action still releases the busy state
        // instead of leaving every chip disabled forever.
      } finally {
        setPendingAction(null)
      }
    },
    [selectedCount],
  )

  if (!hasSelection) return null

  const busy = pendingAction !== null

  return (
    <div
      ref={barRef}
      id={id}
      role="toolbar"
      aria-label="Selection actions"
      aria-busy={busy || undefined}
      data-testid={testId}
      data-selection-bar="true"
      data-placement={placement}
      className={cn(
        "pointer-events-none inset-x-0 bottom-[26px] z-40 flex h-14 items-center justify-center",
        placement === "fixed" ? "fixed" : "absolute",
      )}
    >
      <div className="pointer-events-auto flex h-14 origin-center animate-bar-in items-center gap-2.5 whitespace-nowrap rounded-bar bg-ink pl-[22px] pr-3.5 shadow-selection-bar">
        <span className="text-[14px] font-medium text-bg">{countLabel(selectedCount)}</span>

        {onSelectAll && canSelectAll ? (
          <button
            type="button"
            onClick={onSelectAll}
            className="px-[2px] text-[14px] font-normal text-bg/55 transition-colors hover:text-bg"
          >
            Select all
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDeselectAll}
          className="px-[2px] text-[14px] font-normal text-bg/55 transition-colors hover:text-bg"
        >
          Deselect
        </button>

        <span aria-hidden className="mx-1 h-[26px] w-px bg-bg/[.14]" />

        {actions.map((action) => {
          const chip = (
            <button
              key={action.id}
              type="button"
              disabled={busy}
              data-testid={`selection-bar-action-${action.id}`}
              onClick={action.onSelect ? () => void runAction(action) : undefined}
              className={cn(
                CHIP_CLASS,
                action.destructive
                  ? "bg-cursor/30 text-danger-chip-fg hover:bg-cursor/[.42]"
                  : "bg-bg/10 hover:bg-bg/[.16]",
              )}
            >
              {action.icon}
              {action.label}
              {action.trailingIcon}
            </button>
          )

          return (
            <React.Fragment key={action.id}>
              {action.render ? action.render(chip) : chip}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
