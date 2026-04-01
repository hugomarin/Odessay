"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SignOutButton } from "@/components/auth/sign-out-button"
import { DeskActivityTable } from "@/components/desk/desk-activity-table"
import { DeskFilterBar } from "@/components/desk/desk-filter-bar"
import { DeskHero } from "@/components/desk/desk-hero"
import { getLocalDBScope, localDB, subscribeToLocalDBScopeChanges } from "@/lib/local-db"
import {
  buildDeskActivitySummary,
  type DeskActivityFilter,
  type DeskActivitySummary,
} from "@/lib/queries/desk-activity"
import { hydrateLocalWritingsFromRemote } from "@/lib/sync/remote-bootstrap"
import { enqueueWritingDelete } from "@/lib/sync/queue"

type ApiEnvelope<T> = {
  data: T | null
  error: { code: string; message: string } | null
}

type ShareProfile = {
  username: string
  display_name: string
}

type ShareEntry = {
  id: string
  shared_with_id: string
  can_respond: boolean
  created_at: string
  profiles: ShareProfile | ShareProfile[] | null
}

type RecipientPreview = {
  username: string
  displayName: string
}

const EMPTY_SUMMARY: DeskActivitySummary = {
  heroDrafts: [],
  groups: [],
  counts: {
    all: 0,
    correspondence: 0,
    "with-responses": 0,
    received: 0,
  },
  total: 0,
}

export default function DeskPage() {
  const [activeFilter, setActiveFilter] = useState<DeskActivityFilter>("all")
  const [summary, setSummary] = useState<DeskActivitySummary>(EMPTY_SUMMARY)
  const [isLoading, setIsLoading] = useState(true)
  const hasHydratedRemoteRef = useRef(false)

  const normalizeProfile = useCallback((profiles: ShareEntry["profiles"]) => {
    if (!profiles) {
      return null
    }

    if (Array.isArray(profiles)) {
      return profiles[0] ?? null
    }

    return profiles
  }, [])

  const loadRecipientPreviews = useCallback(
    async (writingIds: string[]) => {
      if (writingIds.length === 0) {
        return {}
      }

      const entries = await Promise.all(
        writingIds.map(async (writingId) => {
          try {
            const response = await fetch(`/api/writings/${writingId}/shares`, {
              cache: "no-store",
            })
            const payload = (await response.json()) as ApiEnvelope<ShareEntry[]>

            if (!response.ok || payload.error || !payload.data) {
              return [writingId, [] as RecipientPreview[]] as const
            }

            const recipientPreviews = payload.data
              .map((share) => {
                const profile = normalizeProfile(share.profiles)

                if (!profile) {
                  return null
                }

                return {
                  username: profile.username,
                  displayName: profile.display_name,
                }
              })
              .filter((item): item is RecipientPreview => Boolean(item))

            return [writingId, recipientPreviews] as const
          } catch {
            return [writingId, [] as RecipientPreview[]] as const
          }
        }),
      )

      return Object.fromEntries(entries)
    },
    [normalizeProfile],
  )

  const syncRemoteWritings = useCallback(async () => {
    try {
      await hydrateLocalWritingsFromRemote()
    } catch (error) {
      console.error("[desk:hydrate]", error)
    }
  }, [])

  const hydrateRemoteIfNeeded = useCallback(
    async (force = false) => {
      if (!force && hasHydratedRemoteRef.current) {
        return
      }

      await syncRemoteWritings()
      hasHydratedRemoteRef.current = true
    },
    [syncRemoteWritings],
  )

  const loadDeskActivity = useCallback(async (filter: DeskActivityFilter) => {
    const localWritings = await localDB.writings.getAll()
    const localScope = getLocalDBScope()
    const recipientPreviewsByWritingId = await loadRecipientPreviews(
      localWritings
        .filter((writing) => writing.visibility === "shared" && writing.sync_status !== "deleted")
        .map((writing) => writing.id),
    )

    setSummary(
      buildDeskActivitySummary(localWritings, {
        filter,
        userId: localScope === "anonymous" ? null : localScope,
        recipientPreviewsByWritingId,
      }),
    )
  }, [loadRecipientPreviews])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      await hydrateRemoteIfNeeded()
      await loadDeskActivity(activeFilter)
      if (!cancelled) {
        setIsLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [activeFilter, hydrateRemoteIfNeeded, loadDeskActivity])

  useEffect(() => {
    return subscribeToLocalDBScopeChanges(() => {
      hasHydratedRemoteRef.current = false
      void hydrateRemoteIfNeeded(true).then(() => loadDeskActivity(activeFilter))
    })
  }, [activeFilter, hydrateRemoteIfNeeded, loadDeskActivity])

  useEffect(() => {
    const handleRefresh = () => {
      void hydrateRemoteIfNeeded(true).then(() => loadDeskActivity(activeFilter))
    }

    window.addEventListener("focus", handleRefresh)
    window.addEventListener("online", handleRefresh)

    return () => {
      window.removeEventListener("focus", handleRefresh)
      window.removeEventListener("online", handleRefresh)
    }
  }, [activeFilter, hydrateRemoteIfNeeded, loadDeskActivity])

  const counts = useMemo(() => summary.counts, [summary.counts])

  return (
    <section id="desk" data-page="desk" className="Desk flex min-h-screen flex-col bg-bg">
      <div
        id="desk-topbar"
        data-section="desk-topbar"
        data-testid="desk-topbar"
        className="DeskTopbar flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-9"
      >
        <p className="font-lora text-[15px] text-ink-2">Desk</p>
        <SignOutButton />
      </div>

      <DeskHero drafts={summary.heroDrafts} />

      <DeskFilterBar activeFilter={activeFilter} counts={counts} onFilterChange={setActiveFilter} />

      <DeskActivityTable
        groups={summary.groups}
        isLoading={isLoading}
        onDeleteRequest={async (id) => {
          await enqueueWritingDelete(id)
          await loadDeskActivity(activeFilter)
        }}
      />
    </section>
  )
}
