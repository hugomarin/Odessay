"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { SignOutButton } from "@/components/auth/sign-out-button"
import { DeskActivityTable } from "@/components/desk/desk-activity-table"
import { DeskFilterBar } from "@/components/desk/desk-filter-bar"
import { DeskHero } from "@/components/desk/desk-hero"
import { DeskViewToggle, type DeskViewMode } from "@/components/desk/desk-view-toggle"
import { SharedWithMeList } from "@/components/desk/shared-with-me-list"
import {
  buildCollectionOptions,
  dedupeCollectionIds,
  getWritingCollectionIds,
} from "@/lib/collections/collections"
import { hydrateLocalCollectionsFromRemote } from "@/lib/collections/remote-bootstrap"
import { createLocalCollection, setLocalWritingCollections } from "@/lib/local-db/collections"
import {
  getLocalDBScope,
  localDB,
  subscribeToLocalDBChanges,
  subscribeToLocalDBScopeChanges,
} from "@/lib/local-db"
import type { LocalCollection, LocalWritingCollection } from "@/lib/local-db/schema"
import {
  buildDeskActivitySummary,
  type DeskActivityFilter,
  type DeskActivitySummary,
} from "@/lib/queries/desk-activity"
import type { SharedWritingListItem } from "@/lib/sharing/writing-shares"
import { hydrateLocalWritingsFromRemote } from "@/lib/sync/remote-bootstrap"
import { enqueueWritingDelete } from "@/lib/sync/queue"
import { getSyncWorker } from "@/lib/sync/worker"

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

type SharedApiEnvelope<T> = {
  data: T | null
  error: { code: string; message: string } | null
}

export default function DeskPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [activeFilter, setActiveFilter] = useState<DeskActivityFilter>("all")
  const [summary, setSummary] = useState<DeskActivitySummary>(EMPTY_SUMMARY)
  const [isLoading, setIsLoading] = useState(true)
  const [sharedItems, setSharedItems] = useState<SharedWritingListItem[]>([])
  const [isSharedLoading, setIsSharedLoading] = useState(false)
  const [sharedError, setSharedError] = useState<string | null>(null)
  const [collections, setCollections] = useState<LocalCollection[]>([])
  const [writingCollections, setWritingCollections] = useState<LocalWritingCollection[]>([])
  const [recipientPreviewsByWritingId, setRecipientPreviewsByWritingId] = useState<
    Record<string, RecipientPreview[]>
  >({})
  const recipientPreviewsRef = useRef(recipientPreviewsByWritingId)
  const hasHydratedRemoteRef = useRef(false)
  const hasLoadedSharedRef = useRef(false)

  recipientPreviewsRef.current = recipientPreviewsByWritingId

  const activeView: DeskViewMode = searchParams.get("tab") === "shared" ? "shared" : "mine"

  const updateActiveView = useCallback(
    (nextView: DeskViewMode) => {
      const nextSearchParams = new URLSearchParams(searchParams.toString())

      if (nextView === "shared") {
        nextSearchParams.set("tab", "shared")
      } else {
        nextSearchParams.delete("tab")
      }

      const nextQuery = nextSearchParams.toString()
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

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
      await Promise.all([
        hydrateLocalWritingsFromRemote(),
        hydrateLocalCollectionsFromRemote(),
      ])
      return true
    } catch (error) {
      console.error("[desk:hydrate]", error)
      return false
    }
  }, [])

  const hydrateRemoteIfNeeded = useCallback(
    async (force = false) => {
      if (!force && hasHydratedRemoteRef.current) {
        return
      }

      const hydrated = await syncRemoteWritings()
      hasHydratedRemoteRef.current = hydrated
    },
    [syncRemoteWritings],
  )

  const loadDeskActivity = useCallback(async (filter: DeskActivityFilter) => {
    const localWritings = await localDB.writings.getAll()
    const [nextCollections, nextAssignments] = await Promise.all([
      localDB.collections.getAll(),
      localDB.writingCollections.listAll(),
    ])
    const localScope = getLocalDBScope()

    setSummary(
      buildDeskActivitySummary(localWritings, {
        filter,
        userId: localScope === "anonymous" ? null : localScope,
        recipientPreviewsByWritingId: recipientPreviewsRef.current,
      }),
    )
    setCollections(nextCollections)
    setWritingCollections(nextAssignments)
  }, [])

  const loadRecipientPreviewsAsync = useCallback(async () => {
    const localWritings = await localDB.writings.getAll()
    const sharedWritingIds = localWritings
      .filter((writing) => writing.visibility === "shared" && writing.sync_status !== "deleted")
      .map((writing) => writing.id)

    if (sharedWritingIds.length === 0) {
      return
    }

    const previews = await loadRecipientPreviews(sharedWritingIds)
    setRecipientPreviewsByWritingId((prev) => ({ ...prev, ...previews }))
  }, [loadRecipientPreviews])

  const loadSharedWritings = useCallback(
    async (force = false) => {
      if (!force && hasLoadedSharedRef.current) {
        return
      }

      setIsSharedLoading(true)
      setSharedError(null)

      try {
        const response = await fetch("/api/shared/writings", {
          cache: "no-store",
        })
        const payload = (await response.json()) as SharedApiEnvelope<SharedWritingListItem[]>

        if (!response.ok || payload.error || !payload.data) {
          throw new Error(payload.error?.message ?? "Failed to load shared writings.")
        }

        setSharedItems(payload.data)
        hasLoadedSharedRef.current = true
      } catch (error) {
        setSharedItems([])
        setSharedError(error instanceof Error ? error.message : "Failed to load shared writings.")
      } finally {
        setIsSharedLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (activeView !== "mine") {
      return
    }

    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      // 1. Render local data immediately — don't wait for remote
      await loadDeskActivity(activeFilter)
      void loadRecipientPreviewsAsync()
      if (!cancelled) {
        setIsLoading(false)
      }
      // 2. Hydrate from Supabase in background
      void hydrateRemoteIfNeeded()
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [activeFilter, activeView, hydrateRemoteIfNeeded, loadDeskActivity, loadRecipientPreviewsAsync])

  useEffect(() => {
    if (activeView !== "shared") {
      return
    }

    void loadSharedWritings()
  }, [activeView, loadSharedWritings])

  useEffect(() => {
    if (activeView === "mine") {
      void loadDeskActivity(activeFilter)
    }
  }, [recipientPreviewsByWritingId, activeView, activeFilter, loadDeskActivity])

  useEffect(() => {
    return subscribeToLocalDBScopeChanges(() => {
      hasHydratedRemoteRef.current = false
      if (activeView === "mine") {
        void hydrateRemoteIfNeeded(true).then(() => {
          void loadDeskActivity(activeFilter)
          void loadRecipientPreviewsAsync()
        })
      }
    })
  }, [activeFilter, activeView, hydrateRemoteIfNeeded, loadDeskActivity, loadRecipientPreviewsAsync])

  useEffect(() => {
    return subscribeToLocalDBChanges(() => {
      if (activeView === "mine") {
        void loadDeskActivity(activeFilter)
        void loadRecipientPreviewsAsync()
      }
    })
  }, [activeFilter, activeView, loadDeskActivity, loadRecipientPreviewsAsync])

  useEffect(() => {
    const handleRefresh = () => {
      if (activeView === "mine") {
        void hydrateRemoteIfNeeded(true).then(() => {
          void loadDeskActivity(activeFilter)
          void loadRecipientPreviewsAsync()
        })
        return
      }

      void loadSharedWritings(true)
    }

    window.addEventListener("focus", handleRefresh)
    window.addEventListener("online", handleRefresh)

    return () => {
      window.removeEventListener("focus", handleRefresh)
      window.removeEventListener("online", handleRefresh)
    }
  }, [activeFilter, activeView, hydrateRemoteIfNeeded, loadDeskActivity, loadRecipientPreviewsAsync, loadSharedWritings])

  const counts = useMemo(() => summary.counts, [summary.counts])
  const collectionOptions = useMemo(() => buildCollectionOptions(collections), [collections])
  const collectionIdsByWritingId = useMemo(() => {
    const grouped = new Map<string, string[]>()

    for (const assignment of writingCollections) {
      const nextIds = grouped.get(assignment.writing_id) ?? []
      nextIds.push(assignment.collection_id)
      grouped.set(assignment.writing_id, nextIds)
    }

    return Object.fromEntries(grouped)
  }, [writingCollections])

  return (
    <section id="desk" data-page="desk" className="Desk flex min-h-screen flex-col bg-bg">
      <div
        id="desk-topbar"
        data-section="desk-topbar"
        data-testid="desk-topbar"
        className="DeskTopbar flex h-[46px] items-center justify-between gap-4 border-b-[0.5px] border-border px-5 sm:px-9"
      >
        <div className="flex min-w-0 items-center gap-4">
          <p className="shrink-0 font-lora text-[15px] text-ink-2">Desk</p>
          <DeskViewToggle activeView={activeView} onViewChange={updateActiveView} />
        </div>
        <SignOutButton />
      </div>

      {activeView === "mine" ? (
        <>
          <DeskHero drafts={summary.heroDrafts} />

          <DeskFilterBar activeFilter={activeFilter} counts={counts} onFilterChange={setActiveFilter} />

          <DeskActivityTable
            groups={summary.groups}
            isLoading={isLoading}
            collectionOptions={collectionOptions}
            collectionIdsByWritingId={collectionIdsByWritingId}
            onToggleCollection={async (writingId, collectionId) => {
              const currentIds = getWritingCollectionIds(writingId, writingCollections)
              const nextIds = currentIds.includes(collectionId)
                ? currentIds.filter((id) => id !== collectionId)
                : [...currentIds, collectionId]

              await setLocalWritingCollections(writingId, dedupeCollectionIds(nextIds))
              getSyncWorker().schedule(0)
            }}
            onCreateCollection={async (writingId, name) => {
              const ownerId = getLocalDBScope()
              const collection = await createLocalCollection({
                ownerId: ownerId === "anonymous" ? null : ownerId,
                name,
              })
              const currentIds = getWritingCollectionIds(writingId, writingCollections)
              await setLocalWritingCollections(writingId, dedupeCollectionIds([...currentIds, collection.id]))
              getSyncWorker().schedule(0)
            }}
            onDeleteRequest={async (id) => {
              await enqueueWritingDelete(id)
              await loadDeskActivity(activeFilter)
              void loadRecipientPreviewsAsync()
            }}
          />
        </>
      ) : (
        <SharedWithMeList items={sharedItems} isLoading={isSharedLoading} error={sharedError} />
      )}
    </section>
  )
}
