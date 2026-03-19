"use client"

import { useRouter } from "next/navigation"
import type { DeskActivityGroup, DeskBadgeTone } from "@/lib/queries/desk-activity"
import { cn } from "@/lib/utils"

type DeskActivityTableProps = {
  groups: DeskActivityGroup[]
  isLoading?: boolean
}

const BADGE_STYLES: Record<DeskBadgeTone, string> = {
  "new-reply": "bg-[hsl(22,55%,92%)] text-cursor",
  waiting: "bg-[hsl(45,60%,91%)] text-[hsl(35,55%,32%)]",
  replied: "bg-[hsl(140,30%,91%)] text-[hsl(140,40%,32%)]",
  shared: "bg-[hsl(220,40%,92%)] text-[hsl(220,50%,40%)]",
  read: "bg-muted text-ink-4",
}

export function DeskActivityTable({ groups, isLoading = false }: DeskActivityTableProps) {
  const router = useRouter()

  if (isLoading) {
    return (
      <div
        id="desk-activity-table"
        data-section="desk-activity-table"
        data-testid="desk-activity-table"
        className="DeskActivityTable p-9"
      >
        <p className="text-[13px] text-ink-4">Loading local activity...</p>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div
        id="desk-activity-table"
        data-section="desk-activity-table"
        data-testid="desk-activity-table"
        className="DeskActivityTable p-9"
      >
        <p className="font-lora text-[18px] italic text-ink-3">No recent activity.</p>
      </div>
    )
  }

  return (
    <div
      id="desk-activity-table"
      data-section="desk-activity-table"
      data-testid="desk-activity-table"
      className="DeskActivityTable overflow-y-auto"
    >
      {groups.map((group) => (
        <div key={group.label}>
          <div className="border-b-[0.5px] border-border px-9 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">{group.label}</p>
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-[0.5px] border-border">
                <th className="w-8 px-9 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">·</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">Writing</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">State</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">With</th>
                <th className="px-9 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">Date</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => {
                const isNavigable = Boolean(row.destinationHref)
                const navigate = () => {
                  if (row.destinationHref) {
                    router.push(row.destinationHref)
                  }
                }

                return (
                <tr
                  key={row.id}
                  role={isNavigable ? "link" : undefined}
                  tabIndex={isNavigable ? 0 : -1}
                  aria-label={isNavigable ? `Open writing ${row.title}` : `${row.title} is read-only on Desk`}
                  onClick={navigate}
                  onKeyDown={(event) => {
                    if (!isNavigable) {
                      return
                    }

                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      navigate()
                    }
                  }}
                  className={cn(
                    "border-b-[0.5px] border-border transition-colors",
                    isNavigable
                      ? "cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                      : "cursor-default bg-muted/20",
                  )}
                >
                  <td className="px-9 py-[18px] align-middle">
                    {row.isNew ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(220,50%,55%)]" /> : null}
                  </td>
                  <td className="px-4 py-[18px] align-middle">
                    <p className="font-lora text-[15px] font-medium leading-[1.3] text-ink">{row.title}</p>
                    <p className="max-w-[420px] truncate pt-1 text-[12px] text-ink-3">{row.excerpt}</p>
                  </td>
                  <td className="px-4 py-[18px] align-middle">
                    <span className={cn(
                      "inline-flex rounded-md px-[10px] py-[5px] text-[12px] font-medium",
                      BADGE_STYLES[row.stateTone],
                    )}>
                      {row.stateLabel}
                    </span>
                  </td>
                  <td className="px-4 py-[18px] align-middle text-[13px] text-ink-2">
                    {row.withLabel}
                    {!isNavigable ? (
                      <span className="block pt-1 text-[11px] text-ink-4">Read-only in Desk</span>
                    ) : null}
                  </td>
                  <td className="px-9 py-[18px] text-right align-middle text-[13px] text-ink-4">{row.dateLabel}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
