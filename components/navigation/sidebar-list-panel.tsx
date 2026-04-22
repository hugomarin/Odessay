"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { FileText, FolderPlus } from "lucide-react"
import { buildCollectionSummaries, getUncategorizedWritings } from "@/lib/collections/collections"
import { hydrateLocalCollectionsFromRemote } from "@/lib/collections/remote-bootstrap"
import { createLocalCollection } from "@/lib/local-db/collections"
import { getLocalDBScope, localDB, subscribeToLocalDBScopeChanges } from "@/lib/local-db"
import type { LocalCollection, LocalWriting, LocalWritingCollection } from "@/lib/local-db/schema"
import { hydrateLocalWritingsFromRemote } from "@/lib/sync/remote-bootstrap"
import { getSyncWorker } from "@/lib/sync/worker"
import { cn } from "@/lib/utils"

type SidebarListPanelProps = {
  open: boolean
}

export function SidebarListPanel({ open }: SidebarListPanelProps) {
  const [writings, setWritings] = useState<LocalWriting[]>([])
  const [collections, setCollections] = useState<LocalCollection[]>([])
  const [assignments, setAssignments] = useState<LocalWritingCollection[]>([])

  const loadState = async () => {
    const [nextWritings, nextCollections, nextAssignments] = await Promise.all([
      localDB.writings.getAll(),
      localDB.collections.getAll(),
      localDB.writingCollections.listAll(),
    ])

    setWritings(nextWritings)
    setCollections(nextCollections)
    setAssignments(nextAssignments)
  }

  useEffect(() => {
    void Promise.all([
      hydrateLocalWritingsFromRemote().catch(() => null),
      hydrateLocalCollectionsFromRemote().catch(() => null),
    ]).then(() => loadState())

    return subscribeToLocalDBScopeChanges(() => void loadState())
  }, [])

  const uncategorizedCount = useMemo(
    () => getUncategorizedWritings(writings, assignments).length,
    [assignments, writings],
  )
  const summaries = useMemo(
    () => buildCollectionSummaries(collections, writings, assignments),
    [assignments, collections, writings],
  )

  return (
    <aside
      id="sidebar-list-panel"
      data-section="sidebar-list-panel"
      data-testid="sidebar-list-panel"
      aria-hidden={!open}
      className={cn(
        "overflow-hidden border-r-[0.5px] border-border bg-sb transition-[width] duration-[320ms] ease-layout",
        open ? "w-[240px]" : "w-0 border-r-0",
      )}
    >
      <div className="flex h-full w-[240px] flex-col">
        <header className="border-b-[0.5px] border-border px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Collections</p>
        </header>

        <div className="border-b-[0.5px] border-border px-2 py-2">
          <button
            type="button"
            onClick={() => {
              const ownerId = getLocalDBScope()
              void createLocalCollection({
                ownerId: ownerId === "anonymous" ? null : ownerId,
                name: "New collection",
              }).then(async () => {
                await loadState()
                getSyncWorker().schedule(0)
              })
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-[9px] text-left text-[13px] text-ink-3 transition-colors hover:bg-muted/70 hover:text-ink"
          >
            <FolderPlus className="h-[18px] w-[18px]" strokeWidth={1.5} />
            <span>Create collection</span>
          </button>
        </div>

        <div className="px-2 py-3">
          <Link
            href="/collections"
            className="flex w-full items-center justify-between rounded-md px-2 py-[9px] text-left text-[13px] text-ink-3 transition-colors hover:bg-muted/70 hover:text-ink"
          >
            <span className="flex items-center gap-2">
              <FileText className="h-[18px] w-[18px]" strokeWidth={1.5} />
              <span>Uncategorized</span>
            </span>
            <span className="text-[11px] text-ink-4">{uncategorizedCount}</span>
          </Link>

          {summaries.map((summary) => (
            <Link
              key={summary.id}
              href={`/collections/${summary.id}`}
              className="flex w-full items-center justify-between rounded-md px-2 py-[9px] text-left text-[13px] text-ink-3 transition-colors hover:bg-muted/70 hover:text-ink"
            >
              <span className="flex items-center gap-2">
                <FileText className="h-[18px] w-[18px]" strokeWidth={1.5} />
                <span>{summary.name}</span>
              </span>
              <span className="text-[11px] text-ink-4">{summary.writingsCount}</span>
            </Link>
          ))}
        </div>
      </div>
    </aside>
  )
}
