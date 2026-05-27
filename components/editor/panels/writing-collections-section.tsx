"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Tags } from "lucide-react"
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu"
import { buildCollectionOptions } from "@/lib/collections/collections"
import { createLocalCollection, setLocalWritingCollections } from "@/lib/local-db/collections"
import { getLocalDBScope, localDB, subscribeToLocalDBChanges } from "@/lib/local-db"
import type { LocalCollection } from "@/lib/local-db/schema"
import { webSyncService } from "@/lib/sync"

type WritingCollectionsSectionProps = {
  writingId: string
}

export function WritingCollectionsSection({ writingId }: WritingCollectionsSectionProps) {
  const [collections, setCollections] = useState<LocalCollection[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdsRef = useRef<string[]>([])

  const loadLocalState = async (currentWritingId: string, cancelled?: () => boolean) => {
    const [nextCollections, assignments] = await Promise.all([
      localDB.collections.getAll(),
      localDB.writingCollections.listForWriting(currentWritingId),
    ])

    if (cancelled?.()) {
      return
    }

    const nextSelectedIds = assignments.map((assignment) => assignment.collection_id)
    selectedIdsRef.current = nextSelectedIds
    setCollections(nextCollections)
    setSelectedIds(nextSelectedIds)
  }

  useEffect(() => {
    selectedIdsRef.current = selectedIds
  }, [selectedIds])

  useEffect(() => {
    let cancelled = false

    const hydrate = async () => {
      await webSyncService.hydrateCollections().catch(() => null)
      await loadLocalState(writingId, () => cancelled)
    }

    void hydrate()
    const unsubscribe = subscribeToLocalDBChanges(() => void loadLocalState(writingId, () => cancelled))

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [writingId])

  useEffect(() => {
    let cancelled = false
    void loadLocalState(writingId, () => cancelled)

    return () => {
      cancelled = true
    }
  }, [writingId])

  const options = useMemo(() => buildCollectionOptions(collections), [collections])

  const toggleCollection = async (collectionId: string) => {
    const currentIds = selectedIdsRef.current
    const nextIds = currentIds.includes(collectionId)
      ? currentIds.filter((id) => id !== collectionId)
      : [...currentIds, collectionId]

    selectedIdsRef.current = nextIds
    setSelectedIds(nextIds)
    await setLocalWritingCollections(writingId, nextIds)
    void webSyncService.scheduleFlush()
  }

  const createAndAssign = async (name: string) => {
    const ownerId = getLocalDBScope()
    const collection = await createLocalCollection({
      ownerId: ownerId === "anonymous" ? null : ownerId,
      name,
    })
    const nextIds = [...selectedIdsRef.current, collection.id]

    selectedIdsRef.current = nextIds
    setSelectedIds(nextIds)
    await setLocalWritingCollections(writingId, nextIds)
    setCollections((current) => [collection, ...current])
    void webSyncService.scheduleFlush()
  }

  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Collections</p>
      <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border bg-bg">
        <CollectionAssignmentMenu
          collections={options}
          selectedIds={selectedIds}
          align="start"
          title="Collections"
          description="Use the same picker used in Desk and Collections."
          onToggleCollection={toggleCollection}
          onCreateCollection={createAndAssign}
          trigger={
            <button
              type="button"
              className="flex h-[37px] w-full items-center gap-2 border-b-[0.5px] border-border px-3 text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted"
            >
              <Tags className="h-3.5 w-3.5" strokeWidth={1.5} />
              {selectedIds.length > 0 ? `Collections (${selectedIds.length})` : "Add to collections"}
            </button>
          }
        />

        <div className="px-3 py-[9px]">
          {selectedIds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {options
                .filter((collection) => selectedIds.includes(collection.id))
                .map((collection) => (
                  <span
                    key={collection.id}
                    className="rounded-[13px] border-[0.5px] border-border bg-muted px-2 py-0.5 text-[11px] text-ink-3"
                  >
                    {collection.name}
                  </span>
                ))}
            </div>
          ) : (
            <p className="text-[11px] text-ink-4">No collections assigned yet.</p>
          )}
        </div>
      </div>
    </section>
  )
}
