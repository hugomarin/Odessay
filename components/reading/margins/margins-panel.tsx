"use client"

import { useEffect, useState } from "react"
import { MarginEntry, type MarginData } from "./margin-entry"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

type MarginsPanelProps = {
  open: boolean
  margins: MarginData[]
  authorName: string | null
  onUpdateNote: (id: string, note: string | null) => void
  onDelete: (id: string) => void
  onShare: () => void
  onToggleShare?: (id: string, shared: boolean) => void
  onScrollToText?: (anchorStart: number) => void
  onCopyAiAnnotations: () => void
  onCopyAiFullText: () => void
  alreadyShared: boolean
  onClose: () => void
}

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)")

    const update = () => {
      setIsMobile(media.matches)
    }

    update()
    media.addEventListener("change", update)

    return () => {
      media.removeEventListener("change", update)
    }
  }, [])

  return isMobile
}

export function MarginsPanel({
  open,
  margins,
  authorName,
  onUpdateNote,
  onDelete,
  onShare,
  onToggleShare,
  onScrollToText,
  onCopyAiAnnotations,
  onCopyAiFullText,
  alreadyShared,
  onClose,
}: MarginsPanelProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<"all" | "personal" | "ai">("all")
  const isMobile = useIsMobileViewport()
  const sharedCount = margins.filter((m) => m.shared).length
  const aiCount = margins.filter((margin) => margin.type === "ai").length
  const visibleMargins =
    activeFilter === "all" ? margins : margins.filter((margin) => margin.type === activeFilter)
  const filterTabs = [
    { id: "all", label: "All" },
    { id: "personal", label: "Personal" },
    { id: "ai", label: "AI" },
  ] as const

  const renderFilters = () => (
    <div className="flex flex-wrap gap-1 px-4 py-2">
      {filterTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveFilter(tab.id)}
          className={`rounded-full px-2.5 py-1 font-sans text-[11px] transition-colors ${
            activeFilter === tab.id ? "bg-ink text-bg" : "bg-muted text-ink-3 hover:bg-muted-hover"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )

  if (isMobile) {
    return (
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onClose()
          }
        }}
      >
        <SheetContent
          id="reading-margin-panel"
          data-section="reading-margin-panel"
          data-testid="reading-margin-panel"
          side="bottom"
          className="h-[75dvh] max-h-[75dvh] rounded-t-[18px] border-t-[0.5px] p-0"
        >
          <div className="flex h-full flex-col overflow-hidden">
            <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-muted" />

            <SheetHeader className="border-b-[0.5px] border-border px-4 py-3 text-left">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-[13px]">Margins</SheetTitle>
                  {margins.length > 0 ? (
                    <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-muted px-1 font-sans text-[10px] text-ink-3">
                      {margins.length}
                    </span>
                  ) : null}
                </div>
                {!alreadyShared && margins.length > 0 && authorName ? (
                  <button
                    onClick={onShare}
                    className="font-sans text-[12px] text-cursor transition-colors hover:underline"
                    aria-label={`Share all margins with ${authorName}`}
                  >
                    Share all
                  </button>
                ) : alreadyShared ? (
                  <span className="font-sans text-[11px] text-ink-4">Shared ({sharedCount})</span>
                ) : null}
              </div>
              <SheetDescription className="sr-only">
                Review and annotate passages in this writing.
              </SheetDescription>
            </SheetHeader>
            {renderFilters()}

            <div className="flex-1 overflow-y-auto px-4 py-2">
              {visibleMargins.length === 0 ? (
                <p className="px-2 py-6 text-center font-lora italic text-[13px] text-ink-4">
                  Select text to mark or annotate passages.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5 pl-[2.5px]">
                  {visibleMargins.map((margin) => (
                    <MarginEntry
                      key={margin.id}
                      margin={margin}
                      focused={focusedId === margin.id}
                      onFocus={() => setFocusedId(margin.id)}
                      onBlur={() => setFocusedId(null)}
                      onUpdateNote={onUpdateNote}
                      onDelete={onDelete}
                      onToggleShare={onToggleShare}
                      onScrollToText={onScrollToText}
                    />
                  ))}
                </div>
              )}
            </div>

            {margins.length > 0 && authorName ? (
              <div className="shrink-0 border-t-[0.5px] border-border px-4 py-3">
                {aiCount > 0 ? (
                  <div className="mb-3 rounded-[10px] border-[0.5px] border-border bg-sb p-3">
                    <p className="font-sans text-[11px] uppercase tracking-[0.07em] text-ink-4">
                      Copiar para AI
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={onCopyAiAnnotations}
                        className="rounded-[8px] bg-muted px-3 py-1.5 font-sans text-[12px] text-ink-2"
                      >
                        Anotaciones
                      </button>
                      <button
                        onClick={onCopyAiFullText}
                        className="rounded-[8px] bg-ink px-3 py-1.5 font-sans text-[12px] text-bg"
                      >
                        Texto completo
                      </button>
                    </div>
                  </div>
                ) : null}
                {alreadyShared ? (
                  <p className="text-center font-sans text-[12px] text-ink-4">
                    All margins shared with {authorName}
                  </p>
                ) : (
                  <button
                    onClick={onShare}
                    className="w-full rounded-[8px] border-[0.5px] border-dashed border-border py-2 font-sans text-[12px] text-ink-3 transition-colors hover:border-cursor hover:text-ink-2"
                  >
                    Share all margins with {authorName}…
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      id="reading-margin-panel"
      data-section="reading-margin-panel"
      data-testid="reading-margin-panel"
      className="ReadingMarginPanel hidden shrink-0 flex-col overflow-hidden border-l-[0.5px] border-border bg-bg md:flex"
      style={{
        width: open ? 296 : 0,
        transition: "width 300ms cubic-bezier(0.4,0,0.15,1)",
        opacity: open ? 1 : 0,
      }}
      aria-hidden={!open}
    >
      {open && (
        <>
          {/* Header */}
          <div className="flex h-[46px] shrink-0 items-center justify-between border-b-[0.5px] border-border px-4">
            <div className="flex items-center gap-2">
              <span className="font-sans text-[13px] font-medium text-ink">Margins</span>
              {margins.length > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-muted px-1 font-sans text-[10px] text-ink-3">
                  {margins.length}
                </span>
              )}
            </div>
            {!alreadyShared && margins.length > 0 && authorName && (
              <button
                onClick={onShare}
                className="font-sans text-[12px] text-cursor transition-colors hover:underline"
                aria-label={`Share all margins with ${authorName}`}
              >
                Share all
              </button>
            )}
            {alreadyShared && (
              <span className="font-sans text-[11px] text-ink-4">Shared ({sharedCount})</span>
            )}
          </div>
          {renderFilters()}

          {/* Entries */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {visibleMargins.length === 0 ? (
              <p className="px-2 py-6 text-center font-lora italic text-[13px] text-ink-4">
                Select text to mark or annotate passages.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5 pl-[2.5px]">
                {visibleMargins.map((margin) => (
                  <MarginEntry
                    key={margin.id}
                    margin={margin}
                    focused={focusedId === margin.id}
                    onFocus={() => setFocusedId(margin.id)}
                    onBlur={() => setFocusedId(null)}
                    onUpdateNote={onUpdateNote}
                    onDelete={onDelete}
                    onToggleShare={onToggleShare}
                    onScrollToText={onScrollToText}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer — share */}
          {margins.length > 0 && authorName && (
            <div className="shrink-0 border-t-[0.5px] border-border px-4 py-3">
              {aiCount > 0 ? (
                <div className="mb-3 rounded-[10px] border-[0.5px] border-border bg-sb p-3">
                  <p className="font-sans text-[11px] uppercase tracking-[0.07em] text-ink-4">
                    Copiar para AI
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={onCopyAiAnnotations}
                      className="rounded-[8px] bg-muted px-3 py-1.5 font-sans text-[12px] text-ink-2"
                    >
                      Anotaciones
                    </button>
                    <button
                      onClick={onCopyAiFullText}
                      className="rounded-[8px] bg-ink px-3 py-1.5 font-sans text-[12px] text-bg"
                    >
                      Texto completo
                    </button>
                  </div>
                </div>
              ) : null}
              {alreadyShared ? (
                <p className="text-center font-sans text-[12px] text-ink-4">
                  All margins shared with {authorName}
                </p>
              ) : (
                <button
                  onClick={onShare}
                  className="w-full rounded-[8px] border-[0.5px] border-dashed border-border py-2 font-sans text-[12px] text-ink-3 transition-colors hover:border-cursor hover:text-ink-2"
                >
                  Share all margins with {authorName}…
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
