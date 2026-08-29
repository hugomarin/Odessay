import type {
  CatalogChange,
  DocumentCatalogQuery,
  DocumentCatalogRecord,
} from "@/lib/services/contracts/document-catalog"
import { getDocumentCatalog } from "@/lib/services/document-catalog-factory"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import {
  deriveDocumentStateFromCatalogRecord,
  type CatalogStateSignals,
  type DocumentState,
} from "@/lib/writings/document-state"
import { normalizeWritingStatus, type WritingStatus } from "@/lib/writings/status"
import { normalizeArtifactType, type ArtifactType } from "@/lib/writings/artifact-type"

/**
 * Shared DocumentCatalog view layer (ODE-373).
 *
 * This module is the one place Desk and Workspace read identity, state and cached
 * metadata from. Both surfaces consume the same `DocumentCatalogRecord[]` base set
 * and the same derivation here; the only permitted difference between the two
 * views is the query, the grouping and the presentation (spec
 * `odessay-desktop-document-catalog.md` §Desk y Workspace como vistas del
 * catálogo). Nothing here imports IndexedDB, SQLite, Tauri, manifests or Supabase
 * directly — it depends only on the DocumentCatalog contract, so no storage
 * coupling leaks into presentation components.
 */

const UNTITLED_TITLE = "Untitled writing"

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
  excerpt: string | null
}

/**
 * Map one catalog record into the shared row view-model. `signals` carries
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
    excerpt: record.excerpt?.trim() || null,
  }
}

export type BuildCatalogRowsOptions = {
  /** Per-document operational overlays keyed by UUID. */
  signalsById?: Record<string, CatalogStateSignals>
  /** List-wide overlay applied to every row (stale watcher / rebuilding SQLite). */
  listSignals?: CatalogStateSignals
}

/**
 * Build the shared base row set. Both views start from this; grouping and
 * presentation are layered on top without changing identity or state.
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

/** Load the base record set. Local records return without waiting on the cloud. */
export async function loadCatalogRecords(
  query: DocumentCatalogQuery = {},
): Promise<DocumentCatalogRecord[]> {
  const catalog = await getDocumentCatalog()
  if (!isDesktopRuntime() || query.cloudAccountId !== undefined) {
    return catalog.list(query)
  }

  // Desktop SQLite is shared across local files and cloud accounts. Local
  // documents remain visible without a session, while cloud-only rows must be
  // scoped to the active account. Resolve that capability here so every
  // application query (Desk, Search, Recent and Workspace) observes the same
  // catalog boundary instead of relying on each caller to remember it.
  const { desktopAuthService } = await import("@/lib/services/desktop-auth-service")
  const session = await desktopAuthService.getSession()
  const cloudAccountId = session.data?.user?.id ?? null

  return catalog.list({ ...query, cloudAccountId })
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
