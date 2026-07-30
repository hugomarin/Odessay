"use client"

import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export function ArchivedWritingActions({ disabled, onDownload, onRestore, onDelete }: { disabled: boolean; onDownload: () => void; onRestore: () => void; onDelete: () => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" disabled={disabled} aria-label="Writing actions"><MoreHorizontal strokeWidth={1.5} /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={onDownload}>Download</DropdownMenuItem>
      <DropdownMenuItem onSelect={onRestore}>Restore</DropdownMenuItem>
      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>Delete permanently</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
