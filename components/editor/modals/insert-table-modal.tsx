"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const GRID_MAX = 6

type InsertTableModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (rows: number, cols: number) => void
}

export function InsertTableModal({ open, onOpenChange, onConfirm }: InsertTableModalProps) {
  const [hovered, setHovered] = useState<{ rows: number; cols: number } | null>(null)
  const [selected, setSelected] = useState<{ rows: number; cols: number } | null>(null)

  const preview = hovered ?? selected

  const handleCellClick = (rows: number, cols: number) => {
    setSelected({ rows, cols })
    onConfirm(rows, cols)
    onOpenChange(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setHovered(null)
      setSelected(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[320px]">
        <DialogHeader>
          <DialogTitle>Insert table</DialogTitle>
          <DialogDescription>
            Select the number of rows and columns.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-1">
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${GRID_MAX}, 1fr)` }}
            onMouseLeave={() => setHovered(null)}
          >
            {Array.from({ length: GRID_MAX }, (_, rowIdx) =>
              Array.from({ length: GRID_MAX }, (_, colIdx) => {
                const row = rowIdx + 1
                const col = colIdx + 1
                const isActive = preview ? row <= preview.rows && col <= preview.cols : false

                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    className={cn(
                      "h-5 w-5 rounded-[3px] border-[0.5px] transition-colors",
                      isActive
                        ? "border-ink bg-ink"
                        : "border-border bg-muted hover:border-ink-3",
                    )}
                    onMouseEnter={() => setHovered({ rows: row, cols: col })}
                    onClick={() => handleCellClick(row, col)}
                    aria-label={`${row} rows × ${col} columns`}
                  />
                )
              }),
            )}
          </div>

          <p className="font-sans text-[12px] text-ink-4">
            {preview ? `${preview.rows} × ${preview.cols}` : "Hover to select"}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
