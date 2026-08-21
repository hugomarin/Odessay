"use client"

import * as React from "react"
import { ChevronRight, FilePlus, Folder, Info, Plus, Sparkles, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The three view states — first run, connected-but-empty, and no workspace.
 *
 * They are not interchangeable: the difference between them is *what the user
 * has to do next*, which is why they are three compositions rather than one
 * component with a copy prop. All three live **inside the sheet**, so the view
 * header, its primary action and the rail stay put — the user never loses the
 * nav to an empty state.
 *
 * Geometry read from the render of
 * `docs/design/reference/Artifact Studio Empty States.dc.html`. Divergences
 * against `docs/design/views/empty-states.md` are recorded in the ODE-438 PR;
 * per `docs/design/migration-plan.md` §4 the prototype wins.
 */

/* --------------------------------------------------------------- option row */

/**
 * The row both the first-run state and the no-workspace state are built from,
 * and the same row the add-workspace flow offers on its origin step.
 *
 * Divergence recorded in the ODE-438 PR: the prose calls the tile 36px with a
 * 14/500 title; the render draws a 44px tile and a 15/500 title, and adds the
 * trailing chevron the prose does not mention.
 */
export function EmptyStateOptionRow({
  icon: Icon,
  title,
  description,
  onSelect,
  href,
  "data-testid": testId,
}: {
  icon: LucideIcon
  title: string
  description: string
  onSelect?: () => void
  href?: string
  "data-testid"?: string
}) {
  const content = (
    <>
      <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[11px] border-[0.5px] border-border bg-sb text-ink-2">
        <Icon className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span className="text-[15px] font-medium leading-[1.3] text-ink">{title}</span>
        <span className="text-pretty text-[13px] leading-[1.5] text-ink-4">{description}</span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] flex-shrink-0 text-ink-5" strokeWidth={1.5} />
    </>
  )

  const className =
    "flex w-full items-center gap-4 rounded-xl border-[0.5px] border-line-soft bg-surface-option p-4 text-left transition-colors hover:border-ink-6 hover:bg-surface-menu-hover"

  if (href) {
    return (
      <a href={href} data-testid={testId} className={className}>
        {content}
      </a>
    )
  }

  return (
    <button type="button" onClick={onSelect} data-testid={testId} className={className}>
      {content}
    </button>
  )
}

/**
 * Why "Restore starter documents" is inert.
 *
 * The repo has no starter-document seeding: nothing writes them, so there is
 * nothing to restore. Requirement 7 (idempotent restore) presumes a mechanism
 * that does not exist yet — raised as a Context Gap on ODE-438. Stating the
 * reason in `title` is the rule this phase already applies to every disabled
 * control.
 */
export const STARTER_DOCUMENTS_UNAVAILABLE =
  "There are no starter documents to restore yet."

/* ------------------------------------------------------------------ buttons */

const PRIMARY_CLASS =
  "inline-flex h-10 items-center gap-2 rounded-[9px] bg-ink px-[17px] text-[14px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
const GHOST_CLASS =
  "inline-flex h-10 items-center rounded-[9px] border-[0.5px] border-border bg-sb px-[15px] text-[14px] font-medium text-ink-2 transition-colors hover:bg-surface-menu-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"

/*
 * A note on the max-widths below: the prototype declares `max-width` on a
 * content box (it ships no CSS reset), so its 16px of padding sits *outside*
 * the cap. Tailwind's reset makes everything border-box, so each cap is written
 * as the prototype's content width plus that padding — 680 → 712, 620 → 652 —
 * to land on the same column.
 */

/* ------------------------------------------------------- 1. first run block */

export type StarterArtifact = {
  id: string
  icon: LucideIcon
  title: string
  description: string
  href?: string
  onOpen?: () => void
}

/**
 * First run, with the starter artifacts already written.
 *
 * **Never a checklist with progress.** The seeded artifacts *are* the tutorial,
 * and the issue makes that an explicit design decision rather than an omission.
 *
 * Divergence recorded in the ODE-438 PR: requirement 1 and the prose both close
 * this block with "New Artifact" (ink) and "Connect another folder" (ghost); the
 * render closes it with a `sparkles` hint pointing at ⌘N and no buttons at all.
 * The render also keeps requirement 5 true — the view header already carries the
 * one primary action, so a second "New Artifact" here would be a second primary.
 */
export function FirstRunEmptyState({
  artifacts,
  shortcutHint = "⌘N",
}: {
  artifacts: StarterArtifact[]
  shortcutHint?: string
}) {
  return (
    <div
      data-testid="empty-state-first-run"
      /* 680 of content + the 16px padding either side — see the note below. */
      className="max-w-[712px] px-4 pb-10 pt-16"
    >
      <h2 className="mb-2.5 text-[24px] font-medium leading-[1.25] tracking-[-0.01em] text-ink">
        Start here
      </h2>
      <p className="mb-7 max-w-[56ch] text-pretty text-[15px] leading-[1.65] text-ink-3">
        We left two artifacts written for you. They&rsquo;re ordinary markdown: edit them, delete
        them, or point the app at another folder.
      </p>

      <div className="mb-[30px] flex flex-col gap-2.5">
        {artifacts.map((artifact) => (
          <EmptyStateOptionRow
            key={artifact.id}
            icon={artifact.icon}
            title={artifact.title}
            description={artifact.description}
            href={artifact.href}
            onSelect={artifact.onOpen}
            data-testid={`empty-state-starter-${artifact.id}`}
          />
        ))}
      </div>

      <div className="flex items-center gap-2.5 border-t-[0.5px] border-line-soft pt-[22px]">
        <Sparkles className="h-[15px] w-[15px] flex-shrink-0 text-ink-5" strokeWidth={1.5} />
        <p className="text-[13px] leading-[1.6] text-ink-4">
          Or write the first one:{" "}
          <strong className="font-medium text-ink-2">{shortcutHint}</strong> creates a blank
          artifact.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------- 2. connected but empty */

export function NoArtifactsEmptyState({
  onCreate,
  onRestoreStarters,
  restoreDisabledReason,
  status,
}: {
  onCreate?: () => void
  onRestoreStarters?: () => void
  /** When set, "Restore starter documents" is inert and says why in `title`. */
  restoreDisabledReason?: string
  /** Result or failure of the last restore, rendered under the actions. */
  status?: { tone: "info" | "error"; message: string } | null
}) {
  return (
    <div
      data-testid="empty-state-no-artifacts"
      className="flex min-h-[440px] flex-col items-center justify-center gap-3.5 px-4 py-10 text-center"
    >
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[13px] border-[0.5px] border-dashed border-line-dashed text-ink-5">
        <FilePlus className="h-[22px] w-[22px]" strokeWidth={1.5} />
      </span>
      <h2 className="text-[20px] font-medium leading-[1.3] text-ink">No artifacts yet</h2>
      <p className="max-w-[40ch] text-pretty text-[14px] leading-[1.6] text-ink-4">
        This workspace is connected and empty. Whatever you write here is saved as markdown in that
        folder.
      </p>
      <div className="mt-1.5 flex items-center gap-2.5">
        <button type="button" onClick={onCreate} className={PRIMARY_CLASS}>
          <Plus className="h-[15px] w-[15px]" strokeWidth={1.5} />
          New Artifact
        </button>
        <button
          type="button"
          onClick={onRestoreStarters}
          disabled={Boolean(restoreDisabledReason)}
          title={restoreDisabledReason}
          data-testid="empty-state-restore-starters"
          className={GHOST_CLASS}
        >
          Restore starter documents
        </button>
      </div>
      {status ? (
        <p
          role={status.tone === "error" ? "alert" : "status"}
          className={cn(
            "max-w-[46ch] text-pretty text-[13px] leading-[1.6]",
            status.tone === "error" ? "text-destructive" : "text-ink-4",
          )}
        >
          {status.message}
        </p>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------- 3. no workspace at all */

export function NoWorkspaceEmptyState({
  onUseExistingFolder,
  onCreateFromScratch,
  starterWorkspaceName,
}: {
  onUseExistingFolder?: () => void
  onCreateFromScratch?: () => void
  /** Named in the footnote so the starter documents are never lost. */
  starterWorkspaceName?: string | null
}) {
  return (
    <div
      data-testid="empty-state-no-workspace"
      /* 620 of content + the 16px padding either side. */
      className="max-w-[652px] px-4 pb-10 pt-16"
    >
      <h2 className="mb-2.5 text-[24px] font-medium leading-[1.25] tracking-[-0.01em] text-ink">
        You haven&rsquo;t connected a folder yet
      </h2>
      <p className="mb-7 max-w-[54ch] text-pretty text-[15px] leading-[1.65] text-ink-3">
        A workspace is a folder of yours that Artifact Studio watches. Nothing is moved and nothing
        is copied.
      </p>

      <div className="flex flex-col gap-2.5">
        <EmptyStateOptionRow
          icon={Folder}
          title="Use an existing folder"
          description="Connect a folder you already work from."
          onSelect={onUseExistingFolder}
          data-testid="empty-state-use-existing-folder"
        />
        <EmptyStateOptionRow
          icon={Plus}
          title="Create from scratch"
          description="Create a new folder and start clean."
          onSelect={onCreateFromScratch}
          data-testid="empty-state-create-from-scratch"
        />
      </div>

      {starterWorkspaceName ? (
        <div className="mt-[30px] flex items-start gap-2.5 border-t-[0.5px] border-line-soft pt-[22px]">
          <Info className="mt-0.5 h-[15px] w-[15px] flex-shrink-0 text-ink-5" strokeWidth={1.5} />
          <p className="max-w-[52ch] text-pretty text-[13px] leading-[1.6] text-ink-4">
            Meanwhile, the two starter documents live in{" "}
            <strong className="font-medium text-ink-2">{starterWorkspaceName}</strong>, a local
            workspace that doesn&rsquo;t touch your folders.
          </p>
        </div>
      ) : null}
    </div>
  )
}
