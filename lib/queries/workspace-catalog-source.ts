import { localDB } from "@/lib/local-db"
import { loadCatalogRecords, buildCatalogRows } from "@/lib/queries/document-catalog"
import { isCatalogReadEnabled } from "@/lib/queries/desk-catalog-source"
import {
  deriveDocumentStateForLocalWriting,
  type DocumentState,
} from "@/lib/writings/document-state"
import { normalizeArtifactType, type ArtifactType } from "@/lib/writings/artifact-type"
import { normalizeWritingStatus, type WritingStatus } from "@/lib/writings/status"

/**
 * Application query port for Workspace (ODE-373).
 *
 * Workspace's on-disk file list comes from the filesystem, but the document
 * identity and state joined to each file must come from the DocumentCatalog — the
 * same base set Desk renders — not from a direct IndexedDB read. This port owns
 * that join so the Workspace shell holds no storage import. When the catalog read
 * is not enabled it falls back to the legacy local read (inside the port), so the
 * shell is storage-free on every path.
 */

const CATALOG_LIST_LIMIT = 10_000

export type WorkspaceDocumentInfo = {
  id: string
  state: DocumentState
  status: WritingStatus
  artifactType: ArtifactType
}

function normalizeRoot(rootPath: string): string {
  return rootPath.replace(/[\\/]+$/, "")
}

function isWithinRoot(rootPath: string, canonicalPath: string): boolean {
  const root = normalizeRoot(rootPath)
  return canonicalPath === root || canonicalPath.startsWith(`${root}/`)
}

/**
 * Build the canonical-path → document info map for one workspace root. The base
 * records (identity/state) come from the DocumentCatalog filtered to this root's
 * location; enrichment stays out of the map (Workspace only needs identity/state
 * and the badge fields here).
 */
export async function loadWorkspaceDocumentJoin(
  rootPath: string,
): Promise<Map<string, WorkspaceDocumentInfo>> {
  const map = new Map<string, WorkspaceDocumentInfo>()

  if (isCatalogReadEnabled()) {
    const records = await loadCatalogRecords({ limit: CATALOG_LIST_LIMIT })
    const scoped = records.filter(
      (record) => record.binding && isWithinRoot(rootPath, record.binding.canonicalPath),
    )
    for (const row of buildCatalogRows(scoped)) {
      if (!row.localPath) continue
      map.set(row.localPath, {
        id: row.id,
        state: row.state,
        status: row.status ?? "draft",
        artifactType: row.artifactType ?? "general",
      })
    }
    return map
  }

  // Reversible fallback: legacy local read, still normalized to the shared shape.
  const writings = await localDB.writings.getAll()
  for (const writing of writings) {
    const canonicalPath = writing.canonical_path?.trim()
    if (!canonicalPath || !isWithinRoot(rootPath, canonicalPath)) continue
    map.set(canonicalPath, {
      id: writing.id,
      state: deriveDocumentStateForLocalWriting(writing),
      status: normalizeWritingStatus(writing.status),
      artifactType: normalizeArtifactType(writing.artifact_type),
    })
  }
  return map
}
