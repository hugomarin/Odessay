"use client"

import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { DeskActivityGroup, DeskBadgeTone } from "@/lib/queries/desk-activity"
import { cn } from "@/lib/utils"

type DeskActivityTableProps = {
  groups: DeskActivityGroup[]
  isLoading?: boolean
}

const BADGE_STYLES: Record<DeskBadgeTone, string> = {
  private: "bg-muted text-ink-4",
  shared: "bg-[hsl(220,40%,92%)] text-[hsl(220,50%,40%)]",
  public: "bg-[hsl(140,24%,92%)] text-[hsl(140,30%,28%)]",
}

const buildInitials = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

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
    <>
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

            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col className="w-[58%]" />
                <col className="w-[16%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
              </colgroup>
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
                        "group border-b-[0.5px] border-border transition-colors",
                        isNavigable
                          ? "cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                          : "cursor-default bg-muted/20",
                      )}
                    >
                      <td className="px-9 py-[18px] align-top md:align-middle">
                        <div
                          className="min-w-0"
                          style={{
                            WebkitMaskImage: "linear-gradient(90deg, #000 86%, transparent)",
                            maskImage: "linear-gradient(90deg, #000 86%, transparent)",
                          }}
                        >
                          <p className="truncate font-lora text-[15px] font-medium leading-[1.3] text-ink">
                            {row.title}
                          </p>
                          <p className="truncate pt-1 text-[12px] text-ink-3">{row.excerpt}</p>
                        </div>
                      </td>
                      <td className="px-4 py-[18px] align-top md:align-middle">
                        <span
                          className={cn(
                            "inline-flex rounded-md px-[10px] py-[5px] text-[12px] font-medium",
                            BADGE_STYLES[row.stateTone],
                          )}
                        >
                          {row.stateLabel}
                        </span>
                      </td>
                      <td className="px-4 py-[18px] align-top text-[13px] text-ink-2 md:align-middle">
                        {row.recipientPreviews.length > 0 ? (
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="-space-x-1 shrink-0">
                              {row.recipientPreviews.slice(0, 2).map((recipient) => {
                                const initialsSource = recipient.displayName ?? recipient.username

                                return (
                                  <Avatar
                                    key={recipient.username}
                                    className="inline-flex h-5 w-5 border-[0.5px] border-border align-middle"
                                  >
                                    <AvatarFallback className="bg-ink-2 text-[9px] text-bg">
                                      {buildInitials(initialsSource)}
                                    </AvatarFallback>
                                  </Avatar>
                                )
                              })}
                            </div>
                            <span className="min-w-0 truncate text-[13px] text-ink-2">
                              @{row.recipientPreviews[0]?.username}
                            </span>
                            {row.recipientPreviews.length > 1 ? (
                              <span className="shrink-0 text-[12px] text-ink-4">+{row.recipientPreviews.length - 1}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-9 py-[18px] text-right align-top text-[13px] text-ink-4 md:align-middle">
                        {row.dateLabel}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  )
}
