"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, Clipboard, Download, Eye, Pencil, Tags, Trash2 } from "lucide-react"
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CollectionOption } from "@/lib/collections/collections"
import type { DeskActivityGroup, DeskActivityRow, DeskStatusTone } from "@/lib/queries/desk-activity"
import type { WritingStatus } from "@/lib/writings/status"
import { getWritingStatusLabel, WRITING_STATUS_VALUES } from "@/lib/writings/status"
import { DeleteWritingDialog } from "@/components/desk/delete-writing-dialog"
import { WritingStatusIcon } from "@/components/desk/writing-status-icon"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { cn } from "@/lib/utils"

type DeskActivityTableProps = {
  groups: DeskActivityGroup[]
  isLoading?: boolean
  collectionOptions: CollectionOption[]
  collectionIdsByWritingId: Record<string, string[]>
  onToggleCollection: (writingId: string, collectionId: string) => Promise<void>
  onCreateCollection: (writingId: string, name: string) => Promise<void>
  onStatusChange?: (writingId: string, status: WritingStatus) => Promise<void>
  onRenameWriting?: (writingId: string) => void
  onPreviewWriting?: (writingId: string) => void
  onCopyMarkdown?: (writingId: string) => void
  onDownloadMarkdown?: (writingId: string) => void
  onDeleteRequest?: (id: string) => void
  renderExtraActions?: (row: DeskActivityRow) => ReactNode
  showDeleteAction?: boolean
  selectedIds?: Set<string>
  onToggleSelection?: (id: string) => void
  hasSelection?: boolean
}

const STATUS_PILL_STYLES: Record<DeskStatusTone, string> = {
  new: "bg-[hsl(220,40%,94%)] text-[hsl(220,45%,42%)]",
  exploring: "bg-[hsl(35,50%,92%)] text-[hsl(35,50%,32%)]",
  draft: "bg-muted text-ink-4",
  in_review: "bg-[hsl(260,35%,94%)] text-[hsl(260,40%,40%)]",
  done: "bg-[hsl(140,30%,91%)] text-[hsl(140,40%,30%)]",
  archived: "bg-[hsl(210,10%,92%)] text-[hsl(210,10%,40%)]",
  canceled: "bg-[hsl(0,30%,94%)] text-[hsl(0,35%,42%)]",
}

const buildInitials = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

export function DeskActivityTable({
  groups,
  isLoading = false,
  collectionOptions,
  collectionIdsByWritingId,
  onToggleCollection,
  onCreateCollection,
  onStatusChange,
  onRenameWriting,
  onPreviewWriting,
  onCopyMarkdown,
  onDownloadMarkdown,
  onDeleteRequest,
  renderExtraActions,
  showDeleteAction = true,
  selectedIds = new Set(),
  onToggleSelection,
  hasSelection = false,
}: DeskActivityTableProps) {
  const router = useRouter()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const { settings } = useUserSettingsContext()
  const enabledStatuses = WRITING_STATUS_VALUES.filter((s) => !settings.disabledStatuses.includes(s))
  const collectionOptionById = new Map(collectionOptions.map((option) => [option.id, option]))

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
        {groups.map((group, groupIndex) => (
          <div key={group.label || `group-${groupIndex}`}>
            {group.label && (
              <div className="bg-sb px-9 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">{group.label}</p>
              </div>
            )}

            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col className="w-[42px]" />
                <col />
                <col className="w-[154px]" />
                <col className="w-[196px]" />
                <col className="w-[108px]" />
                <col className="w-[96px]" />
              </colgroup>
              <tbody>
                {group.rows.map((row) => {
                  const isNavigable = Boolean(row.destinationHref)
                  const navigate = () => {
                    if (row.destinationHref) {
                      router.push(row.destinationHref)
                    }
                  }

                  const selectedCollectionIds = collectionIdsByWritingId[row.id] ?? []
                  const selectedCollections = selectedCollectionIds
                    .map((collectionId) => collectionOptionById.get(collectionId))
                    .filter((collection): collection is CollectionOption => Boolean(collection))

                  const isRowSelected = selectedIds.has(row.id)

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
                        "group bg-sb transition-colors",
                        isNavigable
                          ? "cursor-pointer hover:bg-[hsl(var(--sb))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                          : "cursor-default",
                      )}
                    >
                      <td
                        className="py-[18px] pl-7 pr-0 align-top md:align-middle"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onToggleSelection?.(row.id)}
                          className={cn(
                            "inline-flex h-4 w-4 items-center justify-center rounded-[4px] border transition-all duration-150",
                            isRowSelected
                              ? "border-ink bg-ink text-bg"
                              : "border-border bg-sb text-transparent hover:border-ink-3",
                            hasSelection ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                          )}
                          aria-label={isRowSelected ? `Deselect ${row.title}` : `Select ${row.title}`}
                          aria-pressed={isRowSelected}
                        >
                          <Check className="h-3 w-3" strokeWidth={2.2} />
                        </button>
                      </td>
                      <td className="py-[18px] pl-3 pr-5 align-top md:align-middle">
                        <div className="min-w-0">
                          <div
                            style={{
                              WebkitMaskImage: "linear-gradient(90deg, #000 86%, transparent)",
                              maskImage: "linear-gradient(90deg, #000 86%, transparent)",
                            }}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate font-lora text-[15px] font-medium leading-[1.3] text-ink">
                                {row.title}
                              </p>
                              {onRenameWriting ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    onRenameWriting(row.id)
                                  }}
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-4 opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                                  aria-label={`Rename ${row.title}`}
                                >
                                  <Pencil className="h-[12px] w-[12px]" strokeWidth={1.5} />
                                </button>
                              ) : null}
                              {onPreviewWriting ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    onPreviewWriting(row.id)
                                  }}
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-4 opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                                  aria-label={`Preview ${row.title}`}
                                >
                                  <Eye className="h-[12px] w-[12px]" strokeWidth={1.5} />
                                </button>
                              ) : null}
                            </div>
                            {row.excerpt ? (
                              <p className="truncate pt-1 text-[12px] text-ink-3">{row.excerpt}</p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-[18px] align-top md:align-middle">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              onClick={(event) => event.stopPropagation()}
                              className={cn(
                                "inline-flex h-8 cursor-pointer items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
                                STATUS_PILL_STYLES[row.stateTone],
                              )}
                            >
                              <WritingStatusIcon status={row.stateTone} />
                              {row.stateLabel}
                              <ChevronDown className="h-3 w-3 text-ink-4" strokeWidth={1.5} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="start"
                            className="min-w-[140px]"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {enabledStatuses.map((status) => (
                              <DropdownMenuItem
                                key={status}
                                className="flex cursor-pointer items-center justify-between gap-3 text-[13px]"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void onStatusChange?.(row.id, status)
                                }}
                              >
                                <span className="flex items-center gap-2">
                                  <WritingStatusIcon status={status} />
                                  {getWritingStatusLabel(status)}
                                </span>
                                {row.stateTone === status ? (
                                  <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                                ) : null}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                      <td className="px-3 py-[18px] align-top text-[13px] text-ink-2 md:align-middle">
                        <div
                          className="flex items-center justify-end gap-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {selectedCollections.length > 0 ? (
                            <div className="flex min-w-0 max-w-[132px] items-center justify-end gap-1">
                              {selectedCollections.slice(0, 2).map((collection) => (
                                <span
                                  key={collection.id}
                                  className="inline-flex max-w-[60px] items-center rounded-[8px] border-[0.5px] border-[hsl(30_16%_78%)] bg-[hsl(34_30%_92%)] px-2 py-1 text-[11px] font-medium text-[hsl(28_22%_22%)]"
                                >
                                  <span className="truncate">{collection.name}</span>
                                </span>
                              ))}
                              {selectedCollections.length > 2 ? (
                                <span className="shrink-0 text-[11px] text-ink-4">+{selectedCollections.length - 2}</span>
                              ) : null}
                            </div>
                          ) : null}
                          {isNavigable ? (
                            <CollectionAssignmentMenu
                              collections={collectionOptions}
                              selectedIds={selectedCollectionIds}
                              onToggleCollection={(collectionId) => onToggleCollection(row.id, collectionId)}
                              onCreateCollection={(name) => onCreateCollection(row.id, name)}
                              title="Add to collections"
                              description="Choose multiple labels, then close when you're done."
                              trigger={
                                <button
                                  type="button"
                                  aria-label={`Assign ${row.title} to collections`}
                                  className="inline-flex h-7 shrink-0 items-center gap-[6px] rounded-[9px] border-[0.5px] border-border bg-muted/40 px-[9px] text-[11px] font-medium text-ink-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                                >
                                  <Tags className="h-[11px] w-[11px]" strokeWidth={1.5} />
                                  <span>Add</span>
                                </button>
                              }
                            />
                          ) : null}
                          {renderExtraActions ? renderExtraActions(row) : null}
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
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-[18px] text-right align-top text-[13px] text-ink-4 md:align-middle">
                        <span className="whitespace-nowrap">{row.dateLabel}</span>
                      </td>
                      <td className="py-[18px] pl-0 pr-7 align-top text-right md:align-middle">
                        <div onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            {onCopyMarkdown ? (
                              <button
                                type="button"
                                aria-label={`Copy markdown for ${row.title}`}
                                onClick={() => onCopyMarkdown(row.id)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-4/70 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                              >
                                <Clipboard className="h-[12px] w-[12px]" strokeWidth={1.5} />
                              </button>
                            ) : null}
                            {onDownloadMarkdown ? (
                              <button
                                type="button"
                                aria-label={`Download markdown for ${row.title}`}
                                onClick={() => onDownloadMarkdown(row.id)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-4/70 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                              >
                                <Download className="h-[12px] w-[12px]" strokeWidth={1.5} />
                              </button>
                            ) : null}
                            {showDeleteAction ? (
                              <button
                                type="button"
                                aria-label={`Delete writing ${row.title}`}
                                onClick={() => setPendingDeleteId(row.id)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-4/70 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                              >
                                <Trash2 className="h-[12px] w-[12px]" strokeWidth={1.5} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <DeleteWritingDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteId(null)
          }
        }}
        onConfirm={() => {
          if (pendingDeleteId) {
            onDeleteRequest?.(pendingDeleteId)
          }
          setPendingDeleteId(null)
        }}
      />
    </>
  )
}
