"use client"

import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { SharedWritingListItem } from "@/lib/sharing/writing-shares"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import { cn } from "@/lib/utils"

type SharedWithMeListProps = {
  items: SharedWritingListItem[]
  isLoading?: boolean
  error?: string | null
}

const buildInitials = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
  return `${Math.floor(diffDays / 365)} years ago`
}

function groupSharedItems(items: SharedWritingListItem[]) {
  const groups = new Map<string, SharedWritingListItem[]>()

  for (const item of items) {
    const diffDays = Math.floor((Date.now() - new Date(item.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
    const label = diffDays <= 0 ? "Today" : diffDays < 7 ? "This week" : "Earlier"
    const bucket = groups.get(label) ?? []
    bucket.push(item)
    groups.set(label, bucket)
  }

  return Array.from(groups.entries()).map(([label, groupedItems]) => ({
    label,
    items: groupedItems,
  }))
}

export function SharedWithMeList({
  items,
  isLoading = false,
  error = null,
}: SharedWithMeListProps) {
  const router = useRouter()
  const groupedItems = groupSharedItems(items)
  const canOpen = true

  const openWriting = (item: SharedWritingListItem) => {
    router.push(buildWritingRouteHref("/shared", item))
  }

  return (
    <section
      id="desk-shared-list"
      data-page="desk-shared-list"
      data-section="desk-shared-list"
      data-testid="desk-shared-list"
      className="DeskSharedList od-scroll overflow-y-auto"
    >
      {isLoading ? (
        <div className="p-9">
          <p className="text-[13px] text-ink-4">Loading shared artifacts...</p>
        </div>
      ) : error ? (
        <div className="p-9">
          <p className="font-lora text-[18px] italic text-ink-3">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="p-9">
          <p className="font-lora text-[18px] italic text-ink-3">Nothing has been shared with you yet.</p>
        </div>
      ) : (
        <div>
          {groupedItems.map((group) => (
            <div key={group.label}>
              <div className="border-b-[0.5px] border-border px-9 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">{group.label}</p>
              </div>

              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col className="w-[50%]" />
                  <col className="w-[14%]" />
                  <col className="w-[24%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <tbody>
                  {group.items.map((item) => {
                    const authorLabel = item.author
                      ? `${item.author.displayName ?? item.author.username} @${item.author.username}`
                      : "Unknown author"

                    return (
                      <tr
                        key={item.id}
                        data-testid="desk-shared-writing-item"
                        role={canOpen ? "link" : undefined}
                        tabIndex={canOpen ? 0 : undefined}
                        aria-label={canOpen ? `Open shared artifact ${item.title ?? "Untitled"}` : undefined}
                        className={cn(
                          "group border-b-[0.5px] border-border transition-colors",
                          canOpen &&
                            "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
                        )}
                        onClick={canOpen ? () => openWriting(item) : undefined}
                        onKeyDown={
                          canOpen
                            ? (event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault()
                                  openWriting(item)
                                }
                              }
                            : undefined
                        }
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
                              {item.title ?? "Untitled"}
                            </p>
                            <p className="truncate pt-1 text-[12px] text-ink-3">{item.excerpt}</p>
                          </div>
                        </td>
                        <td className="px-4 py-[18px] align-top md:align-middle">
                          <span className="inline-flex rounded-md bg-[hsl(220,40%,92%)] px-[10px] py-[5px] text-[12px] font-medium text-[hsl(220,50%,40%)]">
                            Shared
                          </span>
                        </td>
                        <td className="px-4 py-[18px] align-top text-[13px] text-ink-2 md:align-middle">
                          <div className="flex min-w-0 items-center gap-2">
                            <Avatar className="inline-flex h-5 w-5 shrink-0 border-[0.5px] border-border">
                              <AvatarFallback className="bg-ink-2 text-[9px] text-bg">
                                {buildInitials(item.author?.displayName ?? item.author?.username ?? "UA")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="min-w-0 truncate text-[13px] text-ink-2">{authorLabel}</span>
                          </div>
                        </td>
                        <td className="px-9 py-[18px] text-right align-top text-[13px] text-ink-4 md:align-middle">
                          {formatRelativeDate(item.updatedAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
