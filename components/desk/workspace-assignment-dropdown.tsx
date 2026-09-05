"use client"

import { ChevronDown, Folder, FolderPlus, Monitor, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { WorkspaceAssignmentOption } from "@/lib/workspace/assignment"
import { cn } from "@/lib/utils"

/**
 * Shared Workspace assignment control for Desk (table row) and Preview (rail).
 *
 * Desk and Preview render the *same* component so the interaction and copy stay
 * identical across surfaces — only the trigger chrome differs by `variant`. The
 * control surfaces the contextual document↔workspace assignment without ever
 * exposing a local path: it only ever shows workspace names.
 *
 * States (ODE-318 scope):
 *  - closed, assigned   → shows the current workspace name.
 *  - closed, unassigned → clear affordance to assign ("Assign workspace").
 *  - open, assigned     → `Current` section + `Move to` list + `New workspace…`.
 *  - open, unassigned   → `Add to workspace` list + `New workspace…`.
 *  - web (unavailable)  → informative state; workspaces require the desktop app.
 *
 * Semantics (ADR D7 amended, ODE-403): for folder-backed workspaces "Move to"
 * physically moves the `.md` into the workspace folder, and leaving one returns
 * the file to Writings — the copy says so ("Return to Writings"). Presentation-
 * only workspaces keep the metadata-only "Remove from workspace" copy.
 */

// Centralized copy so both surfaces are guaranteed to match.
//
// ODE-439 vocabulary note: every product noun below reads "artifact", except
// `returnToWritings`. "Writings" there is not the product unit — it is the
// literal name of the on-disk default folder created by
// `lib/services/document-service-factory.ts` (`appDataDir()/Writings`). The
// copy names a real path, so renaming it would make the sentence false. It
// changes when that folder is migrated, not with a copy sweep.
export const WORKSPACE_COPY = {
  assignAffordance: "Assign workspace",
  emptyClosed: "No workspace",
  current: "Current",
  moveTo: "Move to",
  addTo: "Add to workspace",
  removeFromWorkspace: "Remove from workspace",
  returnToWritings: "Return to Writings",
  newWorkspace: "New workspace…",
  noWorkspaces: "No workspaces yet",
  desktopOnly: "Workspaces live in the desktop app.",
} as const

type WorkspaceAssignmentDropdownProps = {
  writingId: string
  currentSlug: string | null
  currentName: string | null
  options: WorkspaceAssignmentOption[]
  available: boolean
  /**
   * `desk` is the redesigned Desk row's trigger, read from the prototype: 160px
   * wide, 38px tall, radius 8, hairline border, 13/400. The other three are the
   * pre-redesign chrome used by Collections, the preview rail and cards.
   */
  variant?: "table" | "rail" | "card" | "desk"
  title: string
  onAssign: (writingId: string, slug: string) => void | Promise<void>
  onUnassign: (writingId: string) => void | Promise<void>
  onCreateWorkspace: (writingId: string) => void | Promise<void>
}

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

export function WorkspaceAssignmentDropdown({
  writingId,
  currentSlug,
  currentName,
  options,
  available,
  variant = "table",
  title,
  onAssign,
  onUnassign,
  onCreateWorkspace,
}: WorkspaceAssignmentDropdownProps) {
  const isAssigned = Boolean(currentSlug)
  const moveTargets = options.filter((option) => option.slug !== currentSlug)
  // Folder-backed current workspace → leaving it physically returns the file
  // to Writings, and the copy must say so (conscious move, ADR D7 amended).
  const currentIsFolderBacked = Boolean(
    options.find((option) => option.slug === currentSlug)?.rootPath?.trim(),
  )

  const triggerLabel = isAssigned
    ? (currentName ?? currentSlug ?? WORKSPACE_COPY.emptyClosed)
    : available
      ? WORKSPACE_COPY.assignAffordance
      : WORKSPACE_COPY.emptyClosed

  const TriggerIcon = isAssigned ? Folder : Monitor

  const trigger =
    variant === "desk" ? (
      <button
        type="button"
        aria-label={`Manage workspace for ${title}`}
        className="flex h-[38px] w-full items-center gap-2 rounded-[8px] bg-sb px-[11px] text-[13px] text-ink-2 transition-colors hover:bg-surface-row-hover data-[state=open]:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
      >
        <TriggerIcon className="h-[14px] w-[14px] flex-shrink-0 text-ink-3" strokeWidth={1.5} />
        <span className="flex-1 truncate text-left">{triggerLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.5} />
      </button>
    ) : variant === "card" ? (
      <button
        type="button"
        aria-label={`Manage workspace for ${title}`}
        className={cn(
          "inline-flex h-7 max-w-full items-center gap-1.5 rounded-[6px] border-[0.5px] border-border bg-bg px-2 text-[11px] transition-colors hover:bg-muted data-[state=open]:border-ink-3 data-[state=open]:bg-sb focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
          isAssigned ? "text-ink-2" : "text-ink-3",
        )}
      >
        <TriggerIcon className="h-[11px] w-[11px] shrink-0 text-ink-4" strokeWidth={1.5} />
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="h-[11px] w-[11px] shrink-0 text-ink-4" strokeWidth={1.5} />
      </button>
    ) : variant === "rail" ? (
      <button
        type="button"
        aria-label={`Manage workspace for ${title}`}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[13px] font-medium transition-colors hover:bg-muted data-[state=open]:border-ink-3 data-[state=open]:bg-sb focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
          isAssigned ? "text-ink-2" : "text-ink-3",
        )}
      >
        <span className="flex shrink-0 items-center text-ink-3">
          <TriggerIcon className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </span>
        <span className="flex-1 truncate text-left">{triggerLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-ink-4" strokeWidth={1.5} />
      </button>
    ) : (
      <button
        type="button"
        aria-label={`Manage workspace for ${title}`}
        className={cn(
          "inline-flex h-10 w-full min-w-[164px] items-center justify-between gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-3 text-[13px] font-medium transition-colors hover:bg-muted data-[state=open]:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
          isAssigned ? "text-ink-2" : "text-ink-3",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <TriggerIcon className="h-[12px] w-[12px] shrink-0 text-ink-4" strokeWidth={1.5} />
          <span className="truncate">{triggerLabel}</span>
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-ink-4" strokeWidth={1.5} />
      </button>
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[248px] rounded-[18px] p-2 shadow-float-md"
        onClick={stop}
      >
        {!available ? (
          <DropdownMenuItem disabled className="gap-2 text-[13px]">
            <Monitor className="h-[12px] w-[12px]" strokeWidth={1.5} />
            {WORKSPACE_COPY.desktopOnly}
          </DropdownMenuItem>
        ) : (
          <>
            {isAssigned ? (
              <>
                <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">
                  {WORKSPACE_COPY.current}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled
                  className="items-center justify-between gap-2 rounded-[10px] px-2 text-[13px] opacity-100"
                >
                  <span className="flex min-w-0 items-center gap-2 text-ink">
                    <Folder className="h-[13px] w-[13px] shrink-0 text-ink-3" strokeWidth={1.5} />
                    <span className="truncate font-medium">{currentName ?? currentSlug}</span>
                  </span>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ink" aria-hidden="true" />
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer gap-2 rounded-[10px] px-2 text-[13px] text-ink-3"
                  onClick={(event) => {
                    event.stopPropagation()
                    void onUnassign(writingId)
                  }}
                >
                  <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
                  {currentIsFolderBacked
                    ? WORKSPACE_COPY.returnToWritings
                    : WORKSPACE_COPY.removeFromWorkspace}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}

            <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">
              {isAssigned ? WORKSPACE_COPY.moveTo : WORKSPACE_COPY.addTo}
            </DropdownMenuLabel>

            {moveTargets.length > 0 ? (
              moveTargets.map((option) => (
                <DropdownMenuItem
                  key={option.slug}
                  className="cursor-pointer gap-2 rounded-[10px] px-2 text-[13px]"
                  onClick={(event) => {
                    event.stopPropagation()
                    void onAssign(writingId, option.slug)
                  }}
                >
                  <Folder className="h-[13px] w-[13px] shrink-0 text-ink-4" strokeWidth={1.5} />
                  <span className="truncate">{option.name}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled className="px-2 text-[13px] text-ink-4">
                {WORKSPACE_COPY.noWorkspaces}
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer gap-2 rounded-[10px] px-2 text-[13px] font-medium text-ink-2"
              onClick={(event) => {
                event.stopPropagation()
                void onCreateWorkspace(writingId)
              }}
            >
              <FolderPlus className="h-[13px] w-[13px] shrink-0" strokeWidth={1.5} />
              {WORKSPACE_COPY.newWorkspace}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
