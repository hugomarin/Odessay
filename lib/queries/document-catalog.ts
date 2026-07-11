"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type {
  CatalogChange,
  DocumentCatalogQuery,
  DocumentCatalogRecord,
} from "@/lib/services/contracts/document-catalog"
import { getDocumentCatalog } from "@/lib/services/document-catalog-factory"
import {
  deriveDocumentStateFromCatalogRecord,
  type CatalogStateSignals,
  type DocumentState,
} from "@/lib/writings/document-state"
import { getWritingStatusLabel, normalizeWritingStatus, type WritingStatus } from "@/lib/writings/status"
import { normalizeArtifactType, type ArtifactType } from "@/lib/writings/artifact-type"

/**
 * Shared DocumentCatalog view layer (ODE-373).
 *
 * This module is the ONE place Desk and Workspace read identity, state and
 * cached metadata from. Both surfaces consume the same `DocumentCatalogRecord[]`
 * base set and the same derivations here; the only permitted difference between
 * the two views is the query, the grouping and the presentation (spec
 * `odessay-desktop-document-catalog.md` §Desk y Workspace como vistas del
 * catálogo). Nothing here imports IndexedDB, SQLite, Tauri, manifests or
 * Supabase directly — it depends only on the DocumentCatalog contract, so no
 * storage coupling leaks into presentation components.
 */

const UNTITLED_TITLE = "Untitled writing"

/** BindingRoot bucket used to group cloud-only records that have no local binding yet. */
export const CATALOG_CLOUD_GROUP_KEY = "__cloud__"

export type CatalogRowViewModel = {
  id: string
  title: string
  slug: string | null
  /** Shared document state — identical for a UUID across Desk and Workspace. */
  state: DocumentState
  status: WritingStatus | null
  artifactType: ArtifactType | null
  localPath: string | null
  relativePath: string | null
  bindingRootId: string | null
  cloudAccountId: string | null
  localPresent: boolean
  cloudPresent: boolean
  createdAt: number | null
  modifiedAt: number | null
}

export type CatalogGroup = {
  key: string
  label: string
  rows: CatalogRowViewModel[]
}

/**
 * Map one catalog record into the shared row view-model. `signalsById` carries
 * per-document operational overlays (e.g. an ambiguous binding) so the same
 * record produces the same state everywhere it is rendered.
 */
export function toCatalogRowViewModel(
  record: DocumentCatalogRecord,
  signals: CatalogStateSignals = {},
): CatalogRowViewModel {
  return {
    id: record.id,
    title: record.title?.trim() || UNTITLED_TITLE,
    slug: record.slug,
    state: deriveDocumentStateFromCatalogRecord(record, signals),
    status: record.status ? normalizeWritingStatus(record.status) : null,
    artifactType: normalizeArtifactType(record.artifactType),
    localPath: record.binding?.canonicalPath ?? null,
    relativePath: record.binding?.relativePath ?? null,
    bindingRootId: record.binding?.bindingRootId ?? null,
    cloudAccountId: record.cloudAccountId,
    localPresent: record.localPresent,
    cloudPresent: record.cloudPresent,
    createdAt: record.createdAt,
    modifiedAt: record.modifiedAt,
  }
}

export type BuildCatalogRowsOptions = {
  /** Per-document operational overlays keyed by UUID. */
  signalsById?: Record<string, CatalogStateSignals>
  /** List-wide overlay applied to every row (stale watcher / rebuilding SQLite). */
  listSignals?: CatalogStateSignals
}

/**
 * Build the shared base row set. This is what both views start from; grouping
 * and presentation are layered on top without changing identity or state.
 */
export function buildCatalogRows(
  records: DocumentCatalogRecord[],
  options: BuildCatalogRowsOptions = {},
): CatalogRowViewModel[] {
  const { signalsById, listSignals } = options
  return records.map((record) =>
    toCatalogRowViewModel(record, {
      ...listSignals,
      ...signalsById?.[record.id],
    }),
  )
}

/** Deterministic UUID → state map — the parity assertion both views must satisfy. */
export function catalogStateById(
  rows: CatalogRowViewModel[],
): Map<string, DocumentState> {
  return new Map(rows.map((row) => [row.id, row.state]))
}

export type DeskGroupBy = "none" | "state"

const DOCUMENT_STATE_ORDER: DocumentState[] = [
  "conflict",
  "ambiguous",
  "sync-failed",
  "pending",
  "rebuilding",
  "stale",
  "local-only",
  "cloud-only",
  "synced",
]

const DOCUMENT_STATE_GROUP_LABEL: Record<DocumentState, string> = {
  conflict: "Needs resolution",
  ambiguous: "Needs review",
  "sync-failed": "Sync failed",
  pending: "Syncing",
  rebuilding: "Rebuilding",
  stale: "Reconnecting",
  "local-only": "Local only",
  "cloud-only": "Cloud only",
  synced: "Synced",
}

const byModifiedDesc = (left: CatalogRowViewModel, right: CatalogRowViewModel) =>
  (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0)

/**
 * Desk view: all accessible records, optionally grouped by state. Desk shows the
 * full catalog regardless of BindingRoot location.
 */
export function groupCatalogForDesk(
  rows: CatalogRowViewModel[],
  options: { groupBy?: DeskGroupBy } = {},
): CatalogGroup[] {
  const sorted = [...rows].sort(byModifiedDesc)

  if (options.groupBy !== "state") {
    return sorted.length ? [{ key: "all", label: "All", rows: sorted }] : []
  }

  const buckets = new Map<DocumentState, CatalogRowViewModel[]>()
  for (const row of sorted) {
    buckets.set(row.state, [...(buckets.get(row.state) ?? []), row])
  }

  return DOCUMENT_STATE_ORDER.flatMap((state) => {
    const groupRows = buckets.get(state)
    if (!groupRows?.length) return []
    return [{ key: state, label: DOCUMENT_STATE_GROUP_LABEL[state], rows: groupRows }]
  })
}

export type WorkspaceGroupOptions = {
  /** Restrict to the BindingRoots visible as Workspaces (the location hierarchy). */
  visibleBindingRootIds?: string[]
  /** bindingRootId → human label (workspace/folder name). */
  rootLabels?: Map<string, string>
  /** Include cloud-only records (no local binding) in a dedicated bucket. */
  includeCloudOnly?: boolean
}

/**
 * Workspace view: the SAME base rows, filtered and grouped by the visible
 * BindingRoot / location hierarchy. A row's identity and state are untouched —
 * only its placement changes — which is what guarantees Desk/Workspace parity.
 */
export function groupCatalogForWorkspace(
  rows: CatalogRowViewModel[],
  options: WorkspaceGroupOptions = {},
): CatalogGroup[] {
  const { visibleBindingRootIds, rootLabels, includeCloudOnly } = options
  const visible = visibleBindingRootIds ? new Set(visibleBindingRootIds) : null

  const buckets = new Map<string, CatalogRowViewModel[]>()
  const cloudOnly: CatalogRowViewModel[] = []

  for (const row of [...rows].sort(byModifiedDesc)) {
    if (row.bindingRootId) {
      if (visible && !visible.has(row.bindingRootId)) continue
      buckets.set(row.bindingRootId, [...(buckets.get(row.bindingRootId) ?? []), row])
    } else if (includeCloudOnly && row.cloudPresent) {
      cloudOnly.push(row)
    }
  }

  const groups: CatalogGroup[] = Array.from(buckets.entries())
    .map(([bindingRootId, groupRows]) => ({
      key: bindingRootId,
      label: rootLabels?.get(bindingRootId) ?? "Workspace",
      rows: groupRows,
    }))
    .sort((left, right) => left.label.localeCompare(right.label))

  if (cloudOnly.length) {
    groups.push({ key: CATALOG_CLOUD_GROUP_KEY, label: "Cloud only", rows: cloudOnly })
  }

  return groups
}

/** Re-exported label helper so both surfaces render identical group headers. */
export function catalogStatusLabel(status: WritingStatus | null): string {
  return status ? getWritingStatusLabel(status) : "Draft"
}

/* -------------------------------------------------------------------------- */
/*  Imperative + reactive access to the catalog                               */
/* -------------------------------------------------------------------------- */

/** Load the base record set. Local records return without waiting on the cloud. */
export async function loadCatalogRecords(
  query?: DocumentCatalogQuery,
): Promise<DocumentCatalogRecord[]> {
  const catalog = await getDocumentCatalog()
  return catalog.list(query)
}

/**
 * Subscribe to catalog change bursts. The returned unsubscribe is safe to call
 * even before the async catalog resolves. Used so a watcher-discovered file
 * updates every mounted view without navigating to Workspace first.
 */
export function subscribeToCatalog(
  listener: (change: CatalogChange) => void,
): () => void {
  let unsubscribe: (() => void) | null = null
  let cancelled = false

  void getDocumentCatalog().then((catalog) => {
    if (cancelled) return
    unsubscribe = catalog.subscribe(listener)
  })

  return () => {
    cancelled = true
    unsubscribe?.()
  }
}

export type UseCatalogRecordsState = {
  records: DocumentCatalogRecord[]
  isLoading: boolean
  error: string | null
  refresh: () => void
}

/**
 * Local-first catalog subscription for a surface. Renders the local list
 * immediately, then coalesces catalog change bursts into a single refresh so one
 * bulk reconciliation causes exactly one view update (Performance Contract:
 * reactive fan-out). Skeletons only show on the first load; later refreshes are
 * silent.
 */
export function useCatalogRecords(
  query?: DocumentCatalogQuery,
  options: { enabled?: boolean; coalesceMs?: number } = {},
): UseCatalogRecordsState {
  const { enabled = true, coalesceMs = 80 } = options
  const queryKey = JSON.stringify(query ?? {})
  const [records, setRecords] = useState<DocumentCatalogRecord[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)
  const coalesceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await loadCatalogRecords(query ? JSON.parse(queryKey) : undefined)
      setRecords(next)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load catalog")
    } finally {
      if (!hasLoadedRef.current) {
        hasLoadedRef.current = true
        setIsLoading(false)
      }
    }
    // queryKey encodes the query; query is intentionally excluded to keep a stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey])

  const refresh = useCallback(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }

    hasLoadedRef.current = false
    setIsLoading(true)
    void load()

    const scheduleRefresh = () => {
      if (coalesceTimer.current) return
      coalesceTimer.current = setTimeout(() => {
        coalesceTimer.current = null
        void load()
      }, coalesceMs)
    }

    const unsubscribe = subscribeToCatalog(scheduleRefresh)

    return () => {
      unsubscribe()
      if (coalesceTimer.current) {
        clearTimeout(coalesceTimer.current)
        coalesceTimer.current = null
      }
    }
  }, [enabled, coalesceMs, load])

  return { records, isLoading, error, refresh }
}
