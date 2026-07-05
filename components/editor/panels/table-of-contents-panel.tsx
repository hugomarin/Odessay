"use client"

import type { TableOfContentDataItem } from "@tiptap/extension-table-of-contents"
import { ListTree, X } from "lucide-react"
import { cn } from "@/lib/utils"

type TableOfContentsPanelProps = {
  items: TableOfContentDataItem[]
  activeItemId: string | null
  onNavigate: (item: TableOfContentDataItem) => void
  onClose: () => void
}

const getIndentClass = (level: number) => {
  if (level <= 1) return "pl-2"
  if (level === 2) return "pl-6"
  return "pl-10"
}

export function TableOfContentsPanel({
  items,
  activeItemId,
  onNavigate,
  onClose,
}: TableOfContentsPanelProps) {
  const scrollActiveId = items.find((item) => item.isActive)?.id ?? null
  const visibleActiveId = activeItemId ?? scrollActiveId

  return (
    <aside
      id="editor-panel-table-of-contents"
      data-section="editor-panel-table-of-contents"
      data-testid="editor-panel-table-of-contents"
      className="EditorPanelTableOfContents flex h-full w-[296px] min-w-[296px] max-w-[296px] flex-col border-r-[0.5px] border-border bg-sb"
      aria-label="Table of contents"
    >
      <div className="flex h-[46px] shrink-0 items-center justify-between border-b-[0.5px] border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <ListTree className="h-[13px] w-[13px] text-ink-4" strokeWidth={1.5} aria-hidden="true" />
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">
            Contents
          </p>
          {items.length > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-ink-3">
              {items.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
          aria-label="Hide table of contents"
        >
          <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {items.length === 0 ? (
          <div className="px-3 py-4">
            <p className="font-lora text-[13px] italic leading-relaxed text-ink-4">
              Sin secciones todavía.
            </p>
          </div>
        ) : (
          <nav aria-label="Document sections">
            <ul className="space-y-px">
              {items.map((item) => {
                const isActive = item.id === visibleActiveId

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(item)}
                      aria-current={isActive ? "location" : undefined}
                      className={cn(
                        "group flex min-h-8 w-full items-center rounded-[7px] pr-2 text-left font-sans text-[12px] leading-snug transition-colors",
                        getIndentClass(item.level),
                        isActive
                          ? "bg-[hsl(220,40%,92%)] text-[hsl(220,50%,40%)]"
                          : "text-ink-3 hover:bg-muted hover:text-ink",
                      )}
                    >
                      <span
                        className={cn(
                          "block min-w-0 truncate",
                          item.originalLevel <= 1 ? "font-medium" : "font-normal",
                        )}
                      >
                        {item.textContent}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}
      </div>
    </aside>
  )
}
