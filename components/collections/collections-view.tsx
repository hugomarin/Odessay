"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Tags, Trash2 } from "lucide-react"
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu"
import { CollectionCreateDialog } from "@/components/collections/collection-create-dialog"
import {
  buildCollectionDetailItems,
  buildCollectionOptions,
  buildCollectionSummaries,
  dedupeCollectionIds,
  getUncategorizedWritings,
  getWritingCollectionIds,
  UNCATEGORIZED_COLLECTION_ID,
} from "@/lib/collections/collections"
import { hydrateLocalCollectionsFromRemote } from "@/lib/collections/remote-bootstrap"
import {
  createLocalCollection,
  deleteLocalCollection,
  setLocalWritingCollections,
  updateLocalCollection,
} from "@/lib/local-db/collections"
import {
  getLocalDBScope,
  localDB,
  subscribeToLocalDBChanges,
  subscribeToLocalDBScopeChanges,
} from "@/lib/local-db"
import type { LocalCollection, LocalWriting, LocalWritingCollection } from "@/lib/local-db/schema"
import { hydrateLocalWritingsFromRemote } from "@/lib/sync/remote-bootstrap"
import { getSyncWorker } from "@/lib/sync/worker"

type CollectionsViewProps = {
  initialExpandedCollectionId?: string | null
}

const formatDate = (value: string) => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "Unknown date"
  }

  return new Intl.DateTimeFormat("es-MX", {
    month: "short",
    day: "numeric",
  }).format(date)
}

const buildStatusLabel = (status: LocalWriting["status"]) => (status === "finished" ? "Done" : "Draft")

export function CollectionsView({ initialExpandedCollectionId = null }: CollectionsViewProps) {
  const router = useRouter()
  const [writings, setWritings] = useState<LocalWriting[]>([])
  const [collections, setCollections] = useState<LocalCollection[]>([])
  const [assignments, setAssignments] = useState<LocalWritingCollection[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)

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

    const unsubscribeChanges = subscribeToLocalDBChanges(() => void loadLocalState())
    const unsubscribeScope = subscribeToLocalDBScopeChanges(() => void bootstrap())

    return () => {
      cancelled = true
      unsubscribeChanges()
      unsubscribeScope()
    }
  }, [loadLocalState])

  const collectionOptions = useMemo(() => buildCollectionOptions(collections), [collections])
  const collectionSummaries = useMemo(
    () => buildCollectionSummaries(collections, writings, assignments),
    [assignments, collections, writings],
  )
  const uncategorizedCount = useMemo(
    () => getUncategorizedWritings(writings, assignments).length,
    [assignments, writings],
  )
  const activeCollection = useMemo(
    () =>
      initialExpandedCollectionId && initialExpandedCollectionId !== UNCATEGORIZED_COLLECTION_ID
        ? collections.find((collection) => collection.id === initialExpandedCollectionId) ?? null
        : null,
    [collections, initialExpandedCollectionId],
  )
  const detailItems = useMemo(() => {
    if (!initialExpandedCollectionId) {
      return []
    }

    return buildCollectionDetailItems({
      collectionId: initialExpandedCollectionId,
      writings,
      collections,
      assignments,
    })
  }, [assignments, collections, initialExpandedCollectionId, writings])

  const createCollection = useCallback(async (name: string) => {
    const ownerId = getLocalDBScope()
    const collection = await createLocalCollection({
      ownerId: ownerId === "anonymous" ? null : ownerId,
      name,
    })

    getSyncWorker().schedule(0)
    return collection
  }, [])

  const toggleWritingCollection = useCallback(
    async (writingId: string, collectionId: string) => {
      const currentIds = getWritingCollectionIds(writingId, assignments)
      const nextIds = currentIds.includes(collectionId)
        ? currentIds.filter((id) => id !== collectionId)
        : [...currentIds, collectionId]

      await setLocalWritingCollections(writingId, dedupeCollectionIds(nextIds))
      getSyncWorker().schedule(0)
    },
    [assignments],
  )

  const createCollectionAndAssign = useCallback(
    async (writingId: string, name: string) => {
      const collection = await createCollection(name)
      const currentIds = getWritingCollectionIds(writingId, assignments)
      await setLocalWritingCollections(writingId, dedupeCollectionIds([...currentIds, collection.id]))
      getSyncWorker().schedule(0)
    },
    [assignments, createCollection],
  )

  if (!initialExpandedCollectionId) {
    return (
      <section data-page="collections" className="flex min-h-screen flex-col bg-bg">
        <header className="border-b-[0.5px] border-border">
          <div className="flex h-[46px] items-center px-6 md:px-9">
            <p className="font-lora text-[15px] text-ink-2">Collections</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-9">
          <div className="mx-auto grid w-full max-w-[1040px] grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            <Link
              href={`/collections/${UNCATEGORIZED_COLLECTION_ID}`}
              className="flex min-h-[96px] flex-col justify-between rounded-[10px] border-[0.5px] border-dashed border-border bg-transparent px-[14px] py-3 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-lora text-[18px] font-medium text-ink">Uncategorized</h2>
                <span className="rounded-full border-[0.5px] border-border px-2 py-0.5 text-[11px] text-ink-4">
                  {uncategorizedCount}
                </span>
              </div>
            </Link>

            {collectionSummaries.map((summary) => (
              <Link
                key={summary.id}
                href={`/collections/${summary.id}`}
                className="flex min-h-[96px] flex-col justify-between rounded-[10px] border-[0.5px] border-border bg-sb px-[14px] py-3 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-lora text-[18px] font-medium text-ink">{summary.name}</h2>
                  <span className="rounded-full border-[0.5px] border-border px-2 py-0.5 text-[11px] text-ink-4">
                    {summary.writingsCount}
                  </span>
                </div>
              </Link>
            ))}

            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex min-h-[96px] flex-col justify-between rounded-[10px] border-[0.5px] border-dashed border-border bg-transparent px-[14px] py-3 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-sans text-[14px] font-medium text-ink-2">New collection</h2>
                <Plus className="h-4 w-4 text-ink-4" strokeWidth={1.5} />
              </div>
            </button>
          </div>
        </div>

        <CollectionCreateDialog
          open={createOpen}
          pending={isCreating}
          onOpenChange={setCreateOpen}
          onSubmit={async (name) => {
            setIsCreating(true)
            try {
              const collection = await createCollection(name)
              setCreateOpen(false)
              router.push(`/collections/${collection.id}`)
            } finally {
              setIsCreating(false)
            }
          }}
        />
      </section>
    )
  }

  const isUncategorizedView = initialExpandedCollectionId === UNCATEGORIZED_COLLECTION_ID
  const collectionName = isUncategorizedView ? "Uncategorized" : activeCollection?.name ?? "Collection"

  return (
    <section data-page="collections-detail" className="flex min-h-screen flex-col bg-bg">
      <header className="border-b-[0.5px] border-border">
        <div className="flex min-h-[88px] items-end justify-between gap-4 px-6 py-5 md:px-9">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] text-ink-4">
              <Link href="/collections" className="transition-colors hover:text-ink-2">
                Collections
              </Link>
              <span>{">"}</span>
              <span className="truncate">{collectionName}</span>
            </div>
            <h1 className="pt-2 font-lora text-[28px] font-medium text-ink">{collectionName}</h1>
            {isUncategorizedView ? (
              <p className="pt-2 text-[12px] leading-relaxed text-ink-4">
                Derived label for writings without collections. It cannot be renamed or deleted.
              </p>
            ) : null}
          </div>

          {activeCollection ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRenameOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border-[0.5px] border-border px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Delete "${activeCollection.name}"? Writings will remain available in Desk.`)) {
                    return
                  }

                  void deleteLocalCollection(activeCollection).then(() => {
                    getSyncWorker().schedule(0)
                    router.push("/collections")
                  })
                }}
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border-[0.5px] border-border px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted hover:text-[hsl(0_72%_42%)]"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-10 pt-4 md:px-9">
        <div className="mx-auto w-full max-w-[980px]">
          {!isUncategorizedView && !activeCollection ? (
            <p className="font-lora text-[18px] italic text-ink-3">Collection not found.</p>
          ) : detailItems.length === 0 ? (
            <p className="font-lora text-[18px] italic text-ink-3">No writings here yet.</p>
          ) : (
            <div className="border-t-[0.5px] border-border">
              {detailItems.map((item) => {
                const selectedIds = getWritingCollectionIds(item.id, assignments)

                return (
                  <div
                    key={item.id}
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(`/write/${item.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        router.push(`/write/${item.id}`)
                      }
                    }}
                    className="group grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 border-b-[0.5px] border-border px-1 py-[18px] transition-colors duration-150 ease-out hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                  >
                    <div className="min-w-0">
                      <h2 className="font-lora text-[15px] font-medium leading-[1.3] text-ink transition-colors duration-150 ease-out group-hover:text-cursor">
                        {item.title}
                      </h2>
                      <p className="truncate pt-1 text-[12px] text-ink-3">{item.excerpt}</p>
                      {item.otherCollections.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.otherCollections.map((collection) => (
                            <span
                              key={collection.id}
                              className="rounded-[13px] border-[0.5px] border-border bg-muted px-2 py-0.5 text-[11px] text-ink-3"
                            >
                              {collection.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="pt-0.5 text-right text-[12px] text-ink-4">
                      <p>{`${item.wordCount.toLocaleString()} words · ${formatDate(item.updatedAt)} · ${buildStatusLabel(item.status)}`}</p>
                    </div>

                    <div
                      className="flex items-start justify-end"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                    >
                      <div className="flex items-center gap-2 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100">
                        {isUncategorizedView ? (
                          <CollectionAssignmentMenu
                            collections={collectionOptions}
                            selectedIds={selectedIds}
                            title="Add to collections"
                            description="Choose multiple labels, then close when you're done."
                            onToggleCollection={async (collectionId) => {
                              await toggleWritingCollection(item.id, collectionId)
                            }}
                            onCreateCollection={async (name) => {
                              await createCollectionAndAssign(item.id, name)
                            }}
                            trigger={
                              <button
                                type="button"
                                className="inline-flex h-7 items-center gap-2 rounded-[999px] border-[0.5px] border-border px-3 text-[12px] text-ink-2 transition-colors hover:bg-muted"
                              >
                                <Tags className="h-3.5 w-3.5" strokeWidth={1.5} />
                                Add to collections
                              </button>
                            }
                          />
                        ) : (
                          <>
                            <CollectionAssignmentMenu
                              collections={collectionOptions}
                              selectedIds={selectedIds}
                              title="Add to collections"
                              description="Choose multiple labels, then close when you're done."
                              onToggleCollection={async (collectionId) => {
                                await toggleWritingCollection(item.id, collectionId)
                              }}
                              onCreateCollection={async (name) => {
                                await createCollectionAndAssign(item.id, name)
                              }}
                              trigger={
                                <button
                                  type="button"
                                  className="inline-flex h-7 items-center gap-2 rounded-[999px] border-[0.5px] border-border px-3 text-[12px] text-ink-2 transition-colors hover:bg-muted"
                                >
                                  <Tags className="h-3.5 w-3.5" strokeWidth={1.5} />
                                  Add to collections
                                </button>
                              }
                            />
                            <button
                              type="button"
                              onClick={() =>
                                void setLocalWritingCollections(
                                  item.id,
                                  selectedIds.filter((collectionId) => collectionId !== initialExpandedCollectionId),
                                ).then(() => getSyncWorker().schedule(0))
                              }
                              className="inline-flex h-7 items-center rounded-[6px] border-[0.5px] border-border px-2 text-[12px] text-ink-2 transition-colors hover:bg-muted"
                            >
                              Remove from collection
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {activeCollection ? (
        <CollectionCreateDialog
          open={renameOpen}
          title="Rename collection"
          description="Update the label name used across Desk, Collections, and the editor."
          confirmLabel="Save"
          initialName={activeCollection.name}
          pending={isRenaming}
          onOpenChange={setRenameOpen}
          onSubmit={async (name) => {
            setIsRenaming(true)
            try {
              await updateLocalCollection(activeCollection, { name })
              getSyncWorker().schedule(0)
              setRenameOpen(false)
            } finally {
              setIsRenaming(false)
            }
          }}
        />
      ) : null}
    </section>
  )
}
