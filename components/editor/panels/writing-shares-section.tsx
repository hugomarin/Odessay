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
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
}

type WritingSharesSectionProps = {
  writingId: string
  onSharesStateChange?: (hasShares: boolean) => void
}

export function WritingSharesSection({ writingId, onSharesStateChange }: WritingSharesSectionProps) {
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

  useEffect(() => {
    setIsLoadingShares(true)
    fetch(sharesApiPath)
      .then((response) => response.json() as Promise<ApiEnvelope<ShareEntry[]>>)
      .then((payload) => {
        if (payload.data) {
          setShares(payload.data)
          onSharesStateChange?.(payload.data.length > 0)
        }
      })
      .catch(() => null)
      .finally(() => setIsLoadingShares(false))
  }, [onSharesStateChange, sharesApiPath])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    const trimmed = searchQuery.trim()

    if (trimmed.length < 2) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true)

      try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(trimmed)}`)
        const payload = (await response.json()) as ApiEnvelope<UserSearchResult[]>
        const existingIds = new Set(shares.map((share) => share.shared_with_id))
        const results = (payload.data ?? []).filter((user) => !existingIds.has(user.id))

        setSearchResults(results)
        setShowDropdown(true)
      } catch {
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [searchQuery, shares])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    return () => document.removeEventListener("mousedown", handlePointerDown)
  }, [])

  const handleAddUser = useCallback(
    async (user: UserSearchResult) => {
      setShowDropdown(false)
      setSearchQuery("")
      setSearchResults([])
      setIsSaving(true)
      setError(null)

      try {
        const response = await fetch(sharesApiPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_with_id: user.id }),
        })
        const payload = (await response.json()) as ApiEnvelope<ShareEntry>

        if (!response.ok || !payload.data) {
          setError(payload.error?.code === "ALREADY_SHARED" ? "Already shared with this user." : "Couldn't add this user. Please try again.")
          return
        }

        setShares((current) => {
          const nextShares = [...current, payload.data!]
          onSharesStateChange?.(nextShares.length > 0)
          return nextShares
        })
      } catch {
        setError("Couldn't add this user. Please try again.")
      } finally {
        setIsSaving(false)
      }
    },
    [onSharesStateChange, sharesApiPath],
  )

  const handleRevoke = useCallback(
    async (sharedWithId: string) => {
      setIsSaving(true)
      setError(null)

      try {
        const response = await fetch(sharesApiPath, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_with_id: sharedWithId }),
        })

        if (!response.ok) {
          setError("Couldn't revoke access. Please try again.")
          return
        }

        setShares((current) => {
          const nextShares = current.filter((share) => share.shared_with_id !== sharedWithId)
          onSharesStateChange?.(nextShares.length > 0)
          return nextShares
        })
      } catch {
        setError("Couldn't revoke access. Please try again.")
      } finally {
        setIsSaving(false)
      }
    },
    [onSharesStateChange, sharesApiPath],
  )

  return (
    <div className="border-b-[0.5px] border-border px-3 py-[11px]" data-testid="writing-shares-section">
      <div className="mb-2">
        <p className="text-[12px] font-medium text-ink-2">People</p>
        <p className="mt-0.5 text-[11px] leading-[1.45] text-ink-4">
          Invite Odessay users to read or respond.
        </p>
      </div>

      <div ref={containerRef} className="relative">
        <input
          type="text"
          placeholder="Search by name or username…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onFocus={() => {
            if (searchResults.length > 0) {
              setShowDropdown(true)
            }
          }}
          disabled={isSaving}
          className={cn(
            "h-[30px] w-full rounded-[6px] border-[0.5px] border-border bg-sb px-[10px] text-[12px] text-ink outline-none transition-colors",
            "placeholder:text-ink-4 focus:border-ink-3 disabled:cursor-not-allowed disabled:opacity-50",
          )}
          aria-label="Search users to share with"
          data-testid="shares-search-input"
        />

        {showDropdown ? (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-[8px] border-[0.5px] border-border bg-sb p-1 shadow-float-md"
            role="listbox"
            aria-label="User search results"
          >
            {isSearching ? (
              <p className="px-2 py-2 text-[11px] text-ink-4">Searching…</p>
            ) : searchResults.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-ink-4">No users found.</p>
            ) : (
              searchResults.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => handleAddUser(user)}
                  className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left transition-colors hover:bg-muted"
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
        ) : null}
      </div>

      {isLoadingShares ? <p className="mt-2 text-[11px] text-ink-4">Loading…</p> : null}

      {!isLoadingShares && shares.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="shares-list">
          {shares.map((share) => {
            const name = share.profiles?.display_name?.trim() || share.profiles?.username || "Unknown"
            const detail = share.can_respond ? "can respond" : "can read"

            return (
              <span
                key={share.id}
                className="inline-flex items-center gap-[5px] rounded-[6px] bg-[hsl(220_40%_96%)] px-[10px] py-1 text-[11px] font-medium text-[hsl(220_40%_38%)]"
                data-testid="share-entry"
              >
                <span className="truncate">{`${name} · ${detail}`}</span>
                <button
                  type="button"
                  onClick={() => void handleRevoke(share.shared_with_id)}
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-current/70 transition-colors hover:text-current"
                  aria-label={`Remove ${name}`}
                >
                  <X className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </span>
            )
          })}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[11px] text-[hsl(0,72%,45%)]">{error}</p> : null}
    </div>
  )
}
