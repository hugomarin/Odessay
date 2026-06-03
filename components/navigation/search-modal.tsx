"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { FileText, Search, X } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useRecentWritings, type RecentWritingItem } from "@/hooks/useRecentWritings"
import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { cn } from "@/lib/utils"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"

type SearchResult = {
  writing: LocalWriting
  snippet: string
}

function getSnippet(bodyText: string, query: string): string {
  const lowerBody = bodyText.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerBody.indexOf(lowerQuery)

  if (index === -1) {
    return bodyText.slice(0, 90).trimStart()
  }

  const start = Math.max(0, index - 45)
  const end = Math.min(bodyText.length, index + 45)
  let snippet = bodyText.slice(start, end).trimStart()

  if (start > 3) {
    snippet = "…" + snippet
  }
  if (end < bodyText.length) {
    snippet = snippet + "…"
  }

  return snippet
}

function filterWritings(writings: LocalWriting[], query: string): SearchResult[] {
  const lowerQuery = query.toLowerCase()
  const results: SearchResult[] = []

  for (const writing of writings) {
    const titleMatch = writing.title?.toLowerCase().includes(lowerQuery) ?? false
    const bodyMatch = writing.body_text.toLowerCase().includes(lowerQuery)

    if (titleMatch || bodyMatch) {
      results.push({
        writing,
        snippet: getSnippet(writing.body_text, query),
      })
    }
  }

  return results.slice(0, 15)
}

function getTimeGroupLabel(timestamp: number): string {
  const now = new Date()
  const date = new Date(timestamp)

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  if (isSameDay(date, now)) return "Today"
  if (isSameDay(date, yesterday)) return "Yesterday"

  const diffMs = now.getTime() - timestamp
  const daysDiff = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (daysDiff < 7) return "Earlier this week"
  if (daysDiff < 30) return "This month"

  return "Older"
}

function groupByTime(items: RecentWritingItem[]): Map<string, RecentWritingItem[]> {
  const groups = new Map<string, RecentWritingItem[]>()
  for (const item of items) {
    const label = getTimeGroupLabel(item.updatedAt)
    if (!groups.has(label)) {
      groups.set(label, [])
    }
    groups.get(label)!.push(item)
  }
  return groups
}

function SearchSkeleton() {
  return (
    <div className="space-y-1 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-[8px]">
          <div className="h-[18px] w-[18px] shrink-0 rounded-full bg-muted animate-pulse" />
          <div className="h-[14px] w-[60%] animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

function RecentSection({ items, onSelect }: { items: RecentWritingItem[]; onSelect: (item: RecentWritingItem) => void }) {
  const grouped = useMemo(() => groupByTime(items), [items])

  return (
    <div className="py-2">
      {Array.from(grouped.entries()).map(([label, groupItems]) => (
        <div key={label}>
          <p className="mb-1 mt-3 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">
            {label}
          </p>
          <div className="space-y-1">
            {groupItems.map((item) => (
              <button
                key={item.writingId}
                type="button"
                onClick={() => onSelect(item)}
                className="flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-[8px] text-left transition-colors hover:bg-muted-hover"
              >
                <FileText className="h-[18px] w-[18px] shrink-0 text-ink-3" strokeWidth={1.5} />
                <span className="min-w-0 truncate font-sans text-[13px] text-ink-2">
                  {item.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ResultsSection({ results, onSelect }: { results: SearchResult[]; onSelect: (result: SearchResult) => void }) {
  return (
    <div className="space-y-1 py-2">
      {results.map((result) => (
        <button
          key={result.writing.id}
          type="button"
          onClick={() => onSelect(result)}
          className="flex w-full flex-col gap-0.5 rounded-md px-3 py-[8px] text-left transition-colors hover:bg-muted-hover"
        >
          <span className="min-w-0 truncate font-sans text-[13px] text-ink">
            {result.writing.title?.trim() || "Untitled writing"}
          </span>
          <span className="line-clamp-1 font-sans text-[12px] text-ink-4">
            {result.snippet}
          </span>
        </button>
      ))}
    </div>
  )
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="font-lora italic text-[15px] text-ink-3 max-w-[280px] leading-relaxed">
        No writings match &ldquo;{query}&rdquo;
      </p>
    </div>
  )
}

type SearchModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SearchModal({ open, onOpenChange }: SearchModalProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [allWritings, setAllWritings] = useState<LocalWriting[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recentWritings = useRecentWritings(8)

  const loadWritings = useCallback(async () => {
    setIsLoading(true)
    try {
      const writings = await localDB.writings.getAll()
      setAllWritings(writings)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      void loadWritings()
      setTimeout(() => {
        inputRef.current?.focus()
      }, 40)
    }
  }, [open, loadWritings])

  useEffect(() => {
    if (!open) {
      setQuery("")
      setDebouncedQuery("")
      setAllWritings(null)
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [open])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim())
    }, 150)
  }, [])

  const searchResults = useMemo(() => {
    if (!debouncedQuery || !allWritings) {
      return []
    }
    return filterWritings(allWritings, debouncedQuery)
  }, [debouncedQuery, allWritings])

  const handleSelectRecent = useCallback((item: RecentWritingItem) => {
    router.push(buildWritingRouteHref("/write", { id: item.writingId, slug: item.slug }))
    onOpenChange(false)
  }, [router, onOpenChange])

  const handleSelectResult = useCallback((result: SearchResult) => {
    router.push(buildWritingRouteHref("/write", { id: result.writing.id, slug: result.writing.slug }))
    onOpenChange(false)
  }, [router, onOpenChange])

  const showSkeleton = isLoading && allWritings === null
  const showRecent = !showSkeleton && !query.trim() && recentWritings.length > 0
  const showResults = !showSkeleton && debouncedQuery && searchResults.length > 0
  const showEmpty = !showSkeleton && debouncedQuery && searchResults.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className={cn(
          "fixed left-1/2 z-50 grid w-full gap-0 rounded-xl border-[0.5px] border-border bg-sb p-0 font-sans shadow-float-lg outline-none",
          "max-w-[560px] top-[100px] -translate-x-1/2 -translate-y-0"
        )}
      >
        <div className="relative flex items-center gap-3 px-4 py-3">
          <Search className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={1.5} />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search writings…"
            className="h-9 border-0 bg-transparent px-0 text-[15px] text-ink shadow-none placeholder:text-ink-4 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <DialogClose className="absolute right-0 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[6px] text-ink-4 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg">
            <X className="h-[18px] w-[18px]" strokeWidth={1.5} />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>

        <div className="h-px bg-border" />

        <div className="max-h-[420px] overflow-y-auto px-1 pb-2">
          {showSkeleton && <SearchSkeleton />}
          {showRecent && (
            <RecentSection items={recentWritings} onSelect={handleSelectRecent} />
          )}
          {showResults && (
            <ResultsSection results={searchResults} onSelect={handleSelectResult} />
          )}
          {showEmpty && <EmptyState query={debouncedQuery} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
