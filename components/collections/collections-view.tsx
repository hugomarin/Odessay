"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CollectionItem } from "@/components/collections/collection-item"
import { UncategorizedBanner } from "@/components/collections/uncategorized-banner"
import {
  buildCollectionSummaries,
  buildCollectionWritingMap,
  getUncategorizedWritings,
} from "@/lib/collections/collections"
import { hydrateLocalCollectionsFromRemote } from "@/lib/collections/remote-bootstrap"
import { createLocalCollection, deleteLocalCollection, setLocalWritingCollections, updateLocalCollection } from "@/lib/local-db/collections"
import { getLocalDBScope, localDB, subscribeToLocalDBScopeChanges } from "@/lib/local-db"
import type { LocalCollection, LocalWriting, LocalWritingCollection } from "@/lib/local-db/schema"
import { hydrateLocalWritingsFromRemote } from "@/lib/sync/remote-bootstrap"
import { getSyncWorker } from "@/lib/sync/worker"

type CollectionsViewProps = {
  initialExpandedCollectionId?: string | null
}

export function CollectionsView({ initialExpandedCollectionId = null }: CollectionsViewProps) {
  const router = useRouter()
  const [writings, setWritings] = useState<LocalWriting[]>([])
  const [collections, setCollections] = useState<LocalCollection[]>([])
  const [assignments, setAssignments] = useState<LocalWritingCollection[]>([])
  const [selectedUncategorizedIds, setSelectedUncategorizedIds] = useState<string[]>([])
  const [expandedCollectionId, setExpandedCollectionId] = useState<string | null>(initialExpandedCollectionId)
  const [newCollectionName, setNewCollectionName] = useState("")

  const loadLocalState = useCallback(async () => {
    const [nextWritings, nextCollections, nextAssignments] = await Promise.all([
      localDB.writings.getAll(),
      localDB.collections.getAll(),
      localDB.writingCollections.listAll(),
    ])

    setWritings(nextWritings)
    setCollections(nextCollections)
    setAssignments(nextAssignments)
  }, [])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      await Promise.all([
        hydrateLocalWritingsFromRemote().catch(() => null),
        hydrateLocalCollectionsFromRemote().catch(() => null),
      ])
      if (!cancelled) {
        await loadLocalState()
      }
    }

    void bootstrap()
    getSyncWorker().schedule(0)

    return () => {
      cancelled = true
    }
  }, [loadLocalState])

  useEffect(() => subscribeToLocalDBScopeChanges(() => void loadLocalState()), [loadLocalState])

  const uncategorizedWritings = useMemo(
    () => getUncategorizedWritings(writings, assignments),
    [assignments, writings],
  )
  const collectionSummaries = useMemo(
    () => buildCollectionSummaries(collections, writings, assignments),
    [assignments, collections, writings],
  )
  const writingMap = useMemo(
    () => buildCollectionWritingMap(writings, assignments),
    [assignments, writings],
  )
  const collectionById = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection])),
    [collections],
  )

  const toggleUncategorized = useCallback((writingId: string) => {
    setSelectedUncategorizedIds((current) =>
      current.includes(writingId)
        ? current.filter((id) => id !== writingId)
        : [...current, writingId],
    )
  }, [])

  const assignSelectedToCollection = useCallback(
    async (collectionId: string) => {
      for (const writingId of selectedUncategorizedIds) {
        const currentAssignments = assignments
          .filter((assignment) => assignment.writing_id === writingId)
          .map((assignment) => assignment.collection_id)

        await setLocalWritingCollections(writingId, [...currentAssignments, collectionId])
      }

      setSelectedUncategorizedIds([])
      await loadLocalState()
      getSyncWorker().schedule(0)
    },
    [assignments, loadLocalState, selectedUncategorizedIds],
  )

  const createCollectionAndAssign = useCallback(
    async (name: string) => {
      const ownerId = getLocalDBScope()
      const collection = await createLocalCollection({
        ownerId: ownerId === "anonymous" ? null : ownerId,
        name,
      })

      if (selectedUncategorizedIds.length > 0) {
        for (const writingId of selectedUncategorizedIds) {
          const currentAssignments = assignments
            .filter((assignment) => assignment.writing_id === writingId)
            .map((assignment) => assignment.collection_id)

          await setLocalWritingCollections(writingId, [...currentAssignments, collection.id])
        }

        setSelectedUncategorizedIds([])
      }

      setExpandedCollectionId(collection.id)
      await loadLocalState()
      getSyncWorker().schedule(0)
    },
    [assignments, loadLocalState, selectedUncategorizedIds],
  )

  const createTopLevelCollection = useCallback(async () => {
    if (!newCollectionName.trim()) {
      return
    }

    await createCollectionAndAssign(newCollectionName.trim())
    setNewCollectionName("")
  }, [createCollectionAndAssign, newCollectionName])

  return (
    <section data-page="collections" className="flex min-h-screen flex-col bg-bg">
      <header className="border-b-[0.5px] border-border">
        <div className="flex h-[46px] items-center justify-between px-6 md:px-9">
          <p className="font-lora text-[15px] text-ink-2">Collections</p>
          <div className="flex items-center gap-2">
            <input
              value={newCollectionName}
              onChange={(event) => setNewCollectionName(event.target.value)}
              placeholder="New collection"
              className="hidden h-8 rounded-md border-[0.5px] border-border bg-sb px-3 text-[12px] text-ink outline-none placeholder:text-ink-4 md:block"
            />
            <button
              type="button"
              onClick={() => void createTopLevelCollection()}
              className="h-8 rounded-md bg-ink px-3 text-[12px] font-medium text-bg transition-opacity hover:opacity-90"
            >
              New collection
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-10 pt-6 md:px-9">
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5">
          <UncategorizedBanner
            writings={uncategorizedWritings}
            collections={collections}
            selectedIds={selectedUncategorizedIds}
            onToggleWriting={toggleUncategorized}
            onAssign={assignSelectedToCollection}
            onCreateCollection={createCollectionAndAssign}
          />

          {collectionSummaries.map((summary) => {
            const collection = collectionById.get(summary.id)

            if (!collection) {
              return null
            }

            return (
              <CollectionItem
                key={summary.id}
                collection={collection}
                writings={writingMap.get(summary.id) ?? []}
                expanded={expandedCollectionId === summary.id}
                onToggle={() => {
                  const nextId = expandedCollectionId === summary.id ? null : summary.id
                  setExpandedCollectionId(nextId)
                  router.replace(nextId ? `/collections/${nextId}` : "/collections", { scroll: false })
                }}
                onSave={async (updates) => {
                  await updateLocalCollection(collection, updates)
                  await loadLocalState()
                  getSyncWorker().schedule(0)
                }}
                onDelete={async () => {
                  await deleteLocalCollection(collection)
                  if (expandedCollectionId === collection.id) {
                    setExpandedCollectionId(null)
                    router.replace("/collections", { scroll: false })
                  }
                  await loadLocalState()
                  getSyncWorker().schedule(0)
                }}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
}
