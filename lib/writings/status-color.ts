import type { WritingStatus } from "@/lib/writings/status"

/**
 * The colour a status is drawn in.
 *
 * Read from the render of `docs/design/reference/Artifact Studio Desk.dc.html`
 * (`statusColor()` in its logic class). Every colour it uses already has a token
 * — no component writes these hexes:
 *
 *   New        #8E837B  → --ink-4
 *   Exploring  #5B5BD6  → --od-annotation-ai
 *   Draft      #C07B2A  → --od-annotation-highlight
 *   In review  #96532C  → --cursor
 *   Done       #2E7D4F  → --success
 *   Archived   #B5ADA5  → --ink-5
 *
 * **Canceled is not in the prototype.** It has six statuses; the repo has seven.
 * Per `docs/design/migration-plan.md` §4 a value the prototype does not define is
 * a question for the design owner, not an invention — so it is drawn like
 * Archived (both mean "out of circulation") and flagged as an open question in
 * the ODE-430 PR rather than being given a colour of its own.
 *
 * This map is the single place a status colour is resolved. Per-status user
 * colours are a Settings capability that does not exist yet (`UserSettings`
 * carries only `disabledStatuses`); when it lands, it overrides this map here
 * and nowhere else.
 */
const STATUS_COLOR_VAR: Record<WritingStatus, string> = {
  new: "hsl(var(--ink-4))",
  exploring: "var(--od-annotation-ai)",
  draft: "var(--od-annotation-highlight)",
  in_review: "hsl(var(--cursor))",
  done: "hsl(var(--success))",
  archived: "hsl(var(--ink-5))",
  canceled: "hsl(var(--ink-5))",
}

export function getWritingStatusColor(status: WritingStatus): string {
  return STATUS_COLOR_VAR[status] ?? STATUS_COLOR_VAR.draft
}

/**
 * The 9px dashed ring the prototype draws next to a status, in every surface
 * that shows one: the row trigger, the filter menu, the selection bar and the
 * preview's properties column.
 */
export function getWritingStatusDotStyle(status: WritingStatus): React.CSSProperties {
  return { borderColor: getWritingStatusColor(status) }
}
