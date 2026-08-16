"use client"

import * as React from "react"
import {
  ChevronDown,
  CircleDashed,
  Download,
  FolderPlus,
  Shapes,
  Trash2,
  Undo2,
} from "lucide-react"

import { SELECTION_BAR_SHEET_ATTR, SelectionBar, type SelectionBarAction } from "@/components/shared/selection-bar"

const CHEVRON = <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
const GLYPH = "h-[15px] w-[15px]"

const DESK_ACTIONS: SelectionBarAction[] = [
  { id: "status", label: "Status", icon: <CircleDashed className={GLYPH} strokeWidth={1.5} />, trailingIcon: CHEVRON },
  { id: "type", label: "Artifacts", icon: <Shapes className={GLYPH} strokeWidth={1.5} />, trailingIcon: CHEVRON },
  { id: "collections", label: "Collections", icon: <FolderPlus className={GLYPH} strokeWidth={1.5} />, trailingIcon: CHEVRON },
  { id: "delete", label: "Delete", icon: <Trash2 className={GLYPH} strokeWidth={1.5} />, destructive: true, onSelect: () => {} },
]

const ARCHIVE_ACTIONS: SelectionBarAction[] = [
  { id: "restore", label: "Restore", icon: <Undo2 className={GLYPH} strokeWidth={1.5} />, onSelect: () => {} },
  { id: "download", label: "Download", icon: <Download className={GLYPH} strokeWidth={1.5} />, onSelect: () => {} },
  {
    id: "delete-forever",
    label: "Delete forever",
    icon: <Trash2 className={GLYPH} strokeWidth={1.5} />,
    destructive: true,
    onSelect: () => {},
  },
]

const ROWS = [
  "Leccion 5 - Evaluacion de prompts",
  "Omega",
  "Beta",
  "05-Implementing a client",
  "Mapa-razonamiento-y-desarrollo-Leccion2",
  "Alpha",
  "transcript-llamada-2026-07-24",
  "Brief for the model comparison",
  "Narratif tone guide",
  "Publishing checklist",
  "Last row — must stay clickable",
]

function Sheet({
  label,
  actions,
  showSelectAll,
  testId,
}: {
  label: string
  actions: SelectionBarAction[]
  showSelectAll: boolean
  testId: string
}) {
  const [selected, setSelected] = React.useState<Record<string, boolean>>({ [ROWS[0]]: true, [ROWS[1]]: true })
  const [lastClicked, setLastClicked] = React.useState<string | null>(null)
  const count = Object.values(selected).filter(Boolean).length

  return (
    <section className="flex h-[560px] flex-col">
      <p className="px-4 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-[.13em] text-ink-4">{label}</p>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-sb shadow-float">
        <div {...{ [SELECTION_BAR_SHEET_ATTR]: "" }} className="od-scroll min-h-0 flex-1 overflow-y-auto">
          {ROWS.map((row) => (
            <button
              key={row}
              type="button"
              data-testid={`${testId}-row`}
              onClick={() => {
                setSelected((current) => ({ ...current, [row]: !current[row] }))
                setLastClicked(row)
              }}
              className="flex h-[60px] w-full items-center gap-4 border-b-[0.5px] border-line-soft px-[26px] text-left transition-colors hover:bg-surface-row-hover"
            >
              <span
                className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[5px] border-[1.5px] ${
                  selected[row] ? "border-ink bg-ink" : "border-ink-6 bg-sb"
                }`}
              />
              <span className="text-[15px] font-medium text-ink">{row}</span>
            </button>
          ))}
        </div>

        <SelectionBar
          data-testid={testId}
          selectedCount={count}
          onSelectAll={showSelectAll ? () => setSelected(Object.fromEntries(ROWS.map((row) => [row, true]))) : undefined}
          onDeselectAll={() => setSelected({})}
          actions={actions}
          placement="absolute"
        />
      </div>
      <p data-testid={`${testId}-last-clicked`} className="px-4 py-2 text-[12px] text-ink-4">
        Last row clicked: {lastClicked ?? "—"}
      </p>
    </section>
  )
}

export function SelectionBarHarnessClient() {
  return (
    <main className="min-h-screen bg-bg p-2 font-sans">
      <Sheet label="Desk" actions={DESK_ACTIONS} showSelectAll testId="harness-desk-bar" />
      <Sheet
        label="Settings › Archived artifacts"
        actions={ARCHIVE_ACTIONS}
        showSelectAll={false}
        testId="harness-archive-bar"
      />
    </main>
  )
}
