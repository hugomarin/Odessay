"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react"
import { Tags } from "lucide-react"
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu"
import { buildCollectionOptions } from "@/lib/collections/collections"
import {
  createLocalCollection,
  getLocalDBScope,
  loadCollectionState,
  setLocalWritingCollections,
  subscribeToCollectionChanges,
} from "@/lib/queries/desk-catalog-source"
import type { LocalCollection } from "@/lib/local-db/schema"
import { getSyncService } from "@/lib/sync"

type WritingCollectionsSectionProps = {
  writingId: string
}

type CollectionSelection = {
  writingId: string | null
  ids: string[]
}

type AssignmentOp = { kind: "toggle" | "add"; collectionId: string }

type PendingAssignmentIntent = {
  writingId: string
  ops: AssignmentOp[]
  resolvedIds: string[] | null
}

/** Sole synchronous writer for the collection selection and its live ref (ODE-643). */
function useSelectedCollectionIdsState() {
  const [selection, commitSelection] = useState<CollectionSelection>({
    writingId: null,
    ids: [],
  })
  const selectionRef = useRef<CollectionSelection>({ writingId: null, ids: [] })
  const setSelection = useCallback((next: SetStateAction<CollectionSelection>) => {
    const resolved = typeof next === "function" ? next(selectionRef.current) : next
    selectionRef.current = resolved
    commitSelection(resolved)
  }, [])
  return { selection, selectionRef, setSelection }
}

function applyAssignmentOps(baseIds: string[], ops: AssignmentOp[]): string[] {
  const next = [...baseIds]
  for (const op of ops) {
    const index = next.indexOf(op.collectionId)
    if (op.kind === "add") {
      if (index === -1) next.push(op.collectionId)
    } else if (index === -1) {
      next.push(op.collectionId)
    } else {
      next.splice(index, 1)
    }
  }
  return next
}

export function WritingCollectionsSection({ writingId }: WritingCollectionsSectionProps) {
  const { selection, selectionRef, setSelection } = useSelectedCollectionIdsState()
  const [collections, setCollections] = useState<LocalCollection[]>([])
  const pendingIntentRef = useRef<PendingAssignmentIntent | null>(null)
  const writingGenerationRef = useRef(0)
  const lastWritingIdRef = useRef(writingId)
  if (lastWritingIdRef.current !== writingId) {
    lastWritingIdRef.current = writingId
    writingGenerationRef.current += 1
  }

  const loadLocalState = async (currentWritingId: string, cancelled?: () => boolean) => {
    const { collections: nextCollections, writingCollections: assignments } =
      await loadCollectionState(currentWritingId)

    if (cancelled?.()) {
      return
    }

    const baseIds = assignments.map((assignment) => assignment.collection_id)
    const pending =
      pendingIntentRef.current?.writingId === currentWritingId ? pendingIntentRef.current : null
    let shouldPersistPending = false
    if (pending && pending.resolvedIds === null) {
      pending.resolvedIds = applyAssignmentOps(baseIds, pending.ops)
      shouldPersistPending = true
    }
    const nextSelectedIds = pending?.resolvedIds ?? baseIds
    setCollections(nextCollections)
    setSelection({ writingId: currentWritingId, ids: nextSelectedIds })

    if (pending && shouldPersistPending) {
      await setLocalWritingCollections(currentWritingId, nextSelectedIds)
      void getSyncService().scheduleFlush()
    }
  }

  useEffect(() => {
    let cancelled = false

    const hydrate = async () => {
      await getSyncService().hydrateCollections().catch(() => null)
      await loadLocalState(writingId, () => cancelled)
    }

    void hydrate()
    const unsubscribe = subscribeToCollectionChanges(() => void loadLocalState(writingId, () => cancelled))

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

  useEffect(() => {
    if (pendingIntentRef.current && pendingIntentRef.current.writingId !== writingId) {
      pendingIntentRef.current = null
    }
  }, [writingId])

  useEffect(() => {
    return () => {
      writingGenerationRef.current += 1
    }
  }, [])

  const options = useMemo(() => buildCollectionOptions(collections), [collections])

  const queuePendingAssignment = (ownerWritingId: string, op: AssignmentOp) => {
    const existing = pendingIntentRef.current
    const pending =
      existing && existing.writingId === ownerWritingId
        ? existing
        : { writingId: ownerWritingId, ops: [], resolvedIds: null }
    if (pending.resolvedIds !== null) {
      pending.resolvedIds = applyAssignmentOps(pending.resolvedIds, [op])
    } else {
      pending.ops.push(op)
    }
    pendingIntentRef.current = pending
  }

  const releasePendingIntent = (ownerWritingId: string) => {
    if (pendingIntentRef.current?.writingId === ownerWritingId) {
      pendingIntentRef.current = null
    }
  }

  const toggleCollection = async (collectionId: string) => {
    const ownerWritingId = writingId
    const current = selectionRef.current

    if (current.writingId !== ownerWritingId) {
      queuePendingAssignment(ownerWritingId, { kind: "toggle", collectionId })
      return
    }

    releasePendingIntent(ownerWritingId)
    const nextIds = current.ids.includes(collectionId)
      ? current.ids.filter((id) => id !== collectionId)
      : [...current.ids, collectionId]

    setSelection({ writingId: ownerWritingId, ids: nextIds })
    await setLocalWritingCollections(ownerWritingId, nextIds)
    void getSyncService().scheduleFlush()
  }

  const createAndAssign = async (name: string) => {
    const ownerWritingId = writingId
    const generation = writingGenerationRef.current
    const ownerId = getLocalDBScope()
    const collection = await createLocalCollection({
      ownerId: ownerId === "anonymous" ? null : ownerId,
      name,
    })

    if (writingGenerationRef.current === generation) {
      const current = selectionRef.current

      if (current.writingId === ownerWritingId) {
        releasePendingIntent(ownerWritingId)
        const nextIds = [...current.ids, collection.id]

        setSelection({ writingId: ownerWritingId, ids: nextIds })
        await setLocalWritingCollections(ownerWritingId, nextIds)
      } else {
        queuePendingAssignment(ownerWritingId, { kind: "add", collectionId: collection.id })
      }
    }

    setCollections((current) => [collection, ...current])
    void getSyncService().scheduleFlush()
  }

  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Collections</p>
      <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border bg-bg">
        <CollectionAssignmentMenu
          collections={options}
          selectedIds={selection.ids}
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
              {selection.ids.length > 0 ? `Collections (${selection.ids.length})` : "Add to collections"}
            </button>
          }
        />

        <div className="px-3 py-[9px]">
          {selection.ids.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {options
                .filter((collection) => selection.ids.includes(collection.id))
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
