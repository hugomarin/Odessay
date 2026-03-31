"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

type ShareEntry = {
  id: string
  shared_with_id: string
  can_respond: boolean
  created_at: string
  profiles: { username: string; display_name: string } | null
}

type UserSearchResult = {
  id: string
  username: string
  display_name: string
}

type ApiEnvelope<T> = { data: T | null; error: { code: string; message: string } | null }

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

type WritingSharesSectionProps = {
  writingId: string
}

export function WritingSharesSection({ writingId }: WritingSharesSectionProps) {
  const sharesApiPath = `/api/writings/${writingId}/shares`
  const [shares, setShares] = useState<ShareEntry[]>([])
  const [isLoadingShares, setIsLoadingShares] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load current shares on mount
  useEffect(() => {
    setIsLoadingShares(true)
    fetch(sharesApiPath)
      .then((r) => r.json() as Promise<ApiEnvelope<ShareEntry[]>>)
      .then((payload) => {
        if (payload.data) setShares(payload.data)
      })
      .catch(() => {})
      .finally(() => setIsLoadingShares(false))
  }, [sharesApiPath])

  // Debounced user search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = searchQuery.trim()

    if (trimmed.length < 2) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(trimmed)}`)
        const payload = (await res.json()) as ApiEnvelope<UserSearchResult[]>
        const results = payload.data ?? []
        // Filter out users already in the share list
        const existingIds = new Set(shares.map((s) => s.shared_with_id))
        setSearchResults(results.filter((u) => !existingIds.has(u.id)))
        setShowDropdown(true)
      } catch {
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery, shares])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const handleAddUser = useCallback(
    async (user: UserSearchResult) => {
      setShowDropdown(false)
      setSearchQuery("")
      setSearchResults([])
      setIsSaving(true)
      setError(null)

      try {
        const res = await fetch(sharesApiPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_with_id: user.id }),
        })
        const payload = (await res.json()) as ApiEnvelope<ShareEntry>

        if (!res.ok || !payload.data) {
          const code = payload.error?.code
          if (code === "ALREADY_SHARED") {
            setError("Already shared with this user.")
          } else {
            setError("Couldn't add this user. Please try again.")
          }
          return
        }

        setShares((prev) => [...prev, payload.data!])
      } catch {
        setError("Couldn't add this user. Please try again.")
      } finally {
        setIsSaving(false)
      }
    },
    [sharesApiPath],
  )

  const handleRevoke = useCallback(
    async (sharedWithId: string) => {
      setIsSaving(true)
      setError(null)

      try {
        const res = await fetch(sharesApiPath, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_with_id: sharedWithId }),
        })

        if (!res.ok) {
          setError("Couldn't revoke access. Please try again.")
          return
        }

        setShares((prev) => prev.filter((s) => s.shared_with_id !== sharedWithId))
      } catch {
        setError("Couldn't revoke access. Please try again.")
      } finally {
        setIsSaving(false)
      }
    },
    [sharesApiPath],
  )

  return (
    <section className="space-y-2" data-testid="writing-shares-section">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Share</p>

      <div className="space-y-3 rounded-lg border-[0.5px] border-border bg-bg p-3">
        {/* Search input */}
        <div ref={containerRef} className="relative">
          <input
            type="text"
            placeholder="Search by name or username…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) setShowDropdown(true)
            }}
            disabled={isSaving}
            className={cn(
              "h-8 w-full rounded-md border-[0.5px] border-border bg-sb px-3 text-[12px] text-ink",
              "placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-ink/20",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            aria-label="Search users to share with"
            data-testid="shares-search-input"
          />

          {/* Dropdown */}
          {showDropdown && (
            <div
              className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border-[0.5px] border-border bg-sb shadow-float-md"
              role="listbox"
              aria-label="User search results"
            >
              {isSearching ? (
                <p className="px-3 py-2 text-[11px] text-ink-4">Searching…</p>
              ) : searchResults.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-ink-4">No users found.</p>
              ) : (
                searchResults.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => handleAddUser(user)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted"
                    data-testid="shares-search-result"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-ink-3">
                      {getInitials(user.display_name)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-ink">{user.display_name}</p>
                      <p className="text-[10px] text-ink-4">@{user.username}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* People with access */}
        {isLoadingShares ? (
          <p className="text-[11px] text-ink-4">Loading…</p>
        ) : shares.length > 0 ? (
          <div className="space-y-1" data-testid="shares-list">
            <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">
              People with access
            </p>
            <ul className="space-y-1">
              {shares.map((share) => {
                const name = share.profiles?.display_name ?? "Unknown"
                return (
                  <li
                    key={share.id}
                    className="flex items-center gap-2"
                    data-testid="share-entry"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-ink-3">
                      {getInitials(name)}
                    </div>
                    <p className="min-w-0 flex-1 truncate text-[12px] text-ink">{name}</p>
                    <button
                      type="button"
                      onClick={() => handleRevoke(share.shared_with_id)}
                      disabled={isSaving}
                      className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-4 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Remove access for ${name}`}
                      data-testid="share-revoke-button"
                    >
                      <X className="h-[10px] w-[10px]" strokeWidth={1.5} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p className="text-[11px] text-[hsl(0,72%,45%)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  )
}
