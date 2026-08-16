"use client"

import { Ellipsis } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Archive row menu — `docs/design/overlays.md` §Settings pins the inventory to
 * Restore · Download · divider · Delete forever, and destructive items to
 * terracotta text rather than a red fill.
 */
export function ArchivedWritingActions({
  disabled,
  onDownload,
  onRestore,
  onDelete,
}: {
  disabled: boolean
  onDownload: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Artifact actions"
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-surface-menu-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Ellipsis className="h-[17px] w-[17px]" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRestore}>Restore</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDownload}>Download</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-ink-2 focus:text-cursor" onSelect={onDelete}>
          Delete forever
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
