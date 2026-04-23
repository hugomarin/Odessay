"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus } from "lucide-react"
import { CollectionCreateDialog } from "@/components/collections/collection-create-dialog"
import { buildCollectionOptions } from "@/lib/collections/collections"
import { hydrateLocalCollectionsFromRemote } from "@/lib/collections/remote-bootstrap"
import { createLocalCollection, setLocalWritingCollections } from "@/lib/local-db/collections"
import { getLocalDBScope, localDB, subscribeToLocalDBChanges } from "@/lib/local-db"
import type { LocalCollection } from "@/lib/local-db/schema"
import { getSyncWorker } from "@/lib/sync/worker"
import { cn } from "@/lib/utils"

type WritingCollectionsSectionProps = {
  writingId: string
}

export function WritingCollectionsSection({ writingId }: WritingCollectionsSectionProps) {
  const [collections, setCollections] = useState<LocalCollection[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
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
      await hydrateLocalCollectionsFromRemote().catch(() => null)
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
    getSyncWorker().schedule(0)
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
    getSyncWorker().schedule(0)
  }

  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Collections</p>
      <div className="space-y-3 rounded-lg border-[0.5px] border-border bg-bg p-3">
        {options.length === 0 ? (
          <p className="text-[11px] text-ink-4">No collections yet. Create one and assign this writing.</p>
        ) : (
          <div className="grid gap-2">
            {options.map((collection) => {
              const selected = selectedIds.includes(collection.id)

              return (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => void toggleCollection(collection.id)}
                  className={cn(
                    "flex items-center justify-between rounded-md border-[0.5px] px-3 py-2 text-[12px] transition-colors",
                    selected
                      ? "border-ink bg-muted text-ink"
                      : "border-border text-ink-3 hover:bg-muted hover:text-ink",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-[4px] border border-border text-[10px]",
                        selected ? "border-ink bg-ink text-bg" : "bg-sb text-transparent",
                      )}
                    >
                      ✓
                    </span>
                    <span>{collection.name}</span>
                  </span>
                  <span>{selected ? "Assigned" : "Assign"}</span>
                </button>
              )
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex h-8 items-center gap-2 rounded-md border-[0.5px] border-dashed border-border px-3 text-[12px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          New collection...
        </button>
      </div>

      <CollectionCreateDialog
        open={createOpen}
        pending={isCreating}
        onOpenChange={setCreateOpen}
        onSubmit={async (name) => {
          setIsCreating(true)
          try {
            await createAndAssign(name)
            setCreateOpen(false)
          } finally {
            setIsCreating(false)
          }
        }}
      />
    </section>
  )
}
