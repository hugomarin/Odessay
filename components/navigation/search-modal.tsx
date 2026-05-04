"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Clock3, Search, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useRecentWritings, type RecentWritingItem } from "@/hooks/useRecentWritings"
import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { cn } from "@/lib/utils"

type SearchResult = {
  writing: LocalWriting
  snippet: string
}

function getSnippet(bodyText: string, query: string): string {
  const lowerBody = bodyText.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerBody.indexOf(lowerQuery)

  if (index === -1) {
    return bodyText.slice(0, 90)
  }

  const start = Math.max(0, index - 45)
  const end = Math.min(bodyText.length, index + 45)
  let snippet = bodyText.slice(start, end)

  if (start > 0) {
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

function SearchSkeleton() {
  return (
    <div className="space-y-3 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 px-3 py-2">
          <div className="h-[14px] w-[70%] animate-pulse rounded bg-muted" />
          <div className="h-[12px] w-[45%] animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

function RecentSection({ items, onSelect }: { items: RecentWritingItem[]; onSelect: (item: RecentWritingItem) => void }) {
  return (
    <div className="py-2">
      <div className="mb-2 flex items-center gap-2 px-3">
        <Clock3 className="h-[13px] w-[13px] text-ink-4" strokeWidth={1.5} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">Recent</p>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <button
            key={item.writingId}
            type="button"
            onClick={() => onSelect(item)}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-[8px] text-left transition-colors hover:bg-muted-hover"
          >
            <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0 rounded-full bg-border" />
            <span className="min-w-0 truncate font-sans text-[13px] text-ink-2">
              {item.title}
            </span>
          </button>
        ))}
      </div>
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
      // Debounce completed; filtering happens in memo below
    }, 150)
  }, [])

  const searchResults = useMemo(() => {
    if (!query.trim() || !allWritings) {
      return []
    }
    return filterWritings(allWritings, query.trim())
  }, [query, allWritings])

  const handleSelectRecent = useCallback((item: RecentWritingItem) => {
    router.push(`/write/${item.slug ?? item.writingId}`)
    onOpenChange(false)
  }, [router, onOpenChange])

  const handleSelectResult = useCallback((result: SearchResult) => {
    router.push(`/write/${result.writing.slug ?? result.writing.id}`)
    onOpenChange(false)
  }, [router, onOpenChange])

  const showSkeleton = isLoading && allWritings === null
  const showRecent = !showSkeleton && !query.trim() && recentWritings.length > 0
  const showResults = !showSkeleton && query.trim() && searchResults.length > 0
  const showEmpty = !showSkeleton && query.trim() && searchResults.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          className={cn(
            "fixed left-1/2 z-50 grid w-full gap-0 rounded-xl border-[0.5px] border-border bg-sb p-0 font-sans shadow-float-lg outline-none",
            "max-w-[560px] top-[100px] -translate-x-1/2 -translate-y-0"
          )}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <Search className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={1.5} />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search writings…"
              className="h-9 border-0 bg-transparent px-0 text-[15px] text-ink shadow-none placeholder:text-ink-4 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQuery("")
                  inputRef.current?.focus()
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
                aria-label="Clear search"
              >
                <X className="h-[14px] w-[14px]" strokeWidth={1.5} />
              </button>
            )}
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
            {showEmpty && <EmptyState query={query.trim()} />}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
