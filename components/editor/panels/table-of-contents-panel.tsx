"use client"

import type { TableOfContentDataItem } from "@tiptap/extension-table-of-contents"
import { ListTree, X } from "lucide-react"
import { cn } from "@/lib/utils"

type TableOfContentsPanelProps = {
  items: TableOfContentDataItem[]
  activeItemId: string | null
  onNavigate: (item: TableOfContentDataItem) => void
  isOpen: boolean
  onToggleOpen: () => void
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
  isOpen,
  onToggleOpen,
}: TableOfContentsPanelProps) {
  const scrollActiveId = items.find((item) => item.isActive)?.id ?? null
  const visibleActiveId = activeItemId ?? scrollActiveId

  return (
    <div
      className="pointer-events-none fixed top-[76px] z-30 flex max-h-[calc(100vh-76px-40px)] flex-col items-start transition-[left] duration-300 ease-layout"
      style={{ left: "calc(var(--app-shell-left-offset, 52px) + 12px)" }}
      aria-label="Table of contents"
    >
      <button
        type="button"
        onClick={onToggleOpen}
        className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-muted hover:text-ink"
        aria-label={isOpen ? "Hide table of contents" : "Show table of contents"}
        aria-pressed={isOpen}
      >
        <ListTree className="h-[13px] w-[13px]" strokeWidth={1.5} aria-hidden="true" />
      </button>

      {isOpen ? (
        <aside
          id="editor-panel-table-of-contents"
          data-section="editor-panel-table-of-contents"
          data-testid="editor-panel-table-of-contents"
          className="pointer-events-auto mt-2 max-h-[calc(100vh-76px-40px-40px)] w-[232px] overflow-y-auto rounded-[10px] border-[0.5px] border-border/40 bg-transparent p-3.5"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">
                Contents
              </p>
              {items.length > 0 ? (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-medium text-ink-3">
                  {items.length}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onToggleOpen}
              className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
              aria-label="Hide table of contents"
            >
              <X className="h-[11px] w-[11px]" strokeWidth={1.5} />
            </button>
          </div>

          {items.length === 0 ? (
            <div className="px-2 py-3">
              <p className="font-lora text-[12px] italic leading-relaxed text-ink-4">
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
                          "group flex min-h-7 w-full items-center rounded-[7px] pr-2 text-left font-sans text-[11px] leading-snug transition-colors",
                          getIndentClass(item.level),
                          isActive
                            ? "bg-[hsl(220,40%,92%)]/70 text-[hsl(220,50%,40%)]"
                            : "text-ink-3 hover:bg-muted/70 hover:text-ink",
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
        </aside>
      ) : null}
    </div>
  )
}
