import { isTauriRuntime } from "@/lib/runtime/detect"
import { getDesktopWorkspaceService } from "@/lib/services/desktop/workspace-service"
import type {
  WorkspaceAssignmentMap,
  WorkspaceAssignmentOption,
} from "@/lib/workspace/assignment"
import { getDocumentCatalog } from "@/lib/services/document-catalog-factory"
import { loadWorkspaceDocumentJoin } from "@/lib/queries/workspace-catalog-source"
import { subscribeToCatalog } from "@/lib/queries/document-catalog"
import type { CatalogChange } from "@/lib/services/contracts/document-catalog"
import type { DocumentState } from "@/lib/writings/document-state"
import type {
  ContextualWorkspace,
  ContextualWorkspaceDocument,
  ContextualWorkspaceOutcome,
  WorkspaceDetail,
} from "@/lib/workspace/types"

/**
 * Runtime-agnostic entry point for document↔workspace assignment, shared by Desk
 * and Preview so both surfaces speak the same contract.
 *
 * Workspace is a desktop-first capability (`odessay-workspace.md`): only the
 * desktop runtime can register local folders and persist assignments. On web
 * there are no real local workspaces, so the service reports `isAvailable:
 * false` and returns empty data. Consumers render the same control either way;
 * the web informative state replaces real actions.
 */
export interface WorkspaceAssignmentService {
  /** True when the runtime can register workspaces and persist assignments. */
  readonly isAvailable: boolean
  /** Registered workspaces available as assignment targets. */
  listWorkspaces(): Promise<WorkspaceAssignmentOption[]>
  /** Full writing id → workspace slug map. */
  listAssignments(): Promise<WorkspaceAssignmentMap>
  /** Current workspace slug for a writing, or null. */
  getAssignment(writingId: string): Promise<string | null>
  /** Full workspace detail for destination-picking or inspection flows. */
  getWorkspaceDetail(slug: string): Promise<WorkspaceDetail | null>
  /**
   * Moves a writing to an existing workspace. For a folder-backed workspace
   * this physically relocates the canonical `.md` into the workspace folder
   * (ADR D7 amended — conscious move, same UUID); presentation-only workspaces
   * and writings without a local file stay metadata-only.
   */
  assign(writingId: string, slug: string): Promise<void>
  /**
   * Removes a writing from its workspace. When the file physically lives in a
   * folder-backed workspace, it returns to the managed root via the same
   * relocate primitive (symmetric, reversible); otherwise only the metadata
   * assignment is dropped.
   */
  clearAssignment(writingId: string): Promise<void>
  /**
   * Registers a new workspace (native folder picker on desktop) and returns it
   * so the caller can immediately assign the writing to it. Null when the user
   * cancels or the runtime cannot create workspaces.
   */
  createWorkspace(): Promise<WorkspaceAssignmentOption | null>
}

class DesktopWorkspaceAssignmentService implements WorkspaceAssignmentService {
  readonly isAvailable = true

  async listWorkspaces(): Promise<WorkspaceAssignmentOption[]> {
    const service = await getDesktopWorkspaceService()
    return service.listAssignableWorkspaces()
  }

  async listAssignments(): Promise<WorkspaceAssignmentMap> {
    const service = await getDesktopWorkspaceService()
    return service.listAssignments()
  }

  async getAssignment(writingId: string): Promise<string | null> {
    const service = await getDesktopWorkspaceService()
    return service.getAssignment(writingId)
  }

  async getWorkspaceDetail(slug: string): Promise<WorkspaceDetail | null> {
    const service = await getDesktopWorkspaceService()
    return service.getWorkspace(slug)
  }

  async assign(writingId: string, slug: string): Promise<void> {
    const service = await getDesktopWorkspaceService()
    await service.assignToWorkspace(writingId, slug)
  }

  async clearAssignment(writingId: string): Promise<void> {
    const service = await getDesktopWorkspaceService()
    await service.clearAssignment(writingId)
  }

  async createWorkspace(): Promise<WorkspaceAssignmentOption | null> {
    const service = await getDesktopWorkspaceService()
    const record = await service.addExistingWorkspace()
    return record ? { slug: record.slug, name: record.name } : null
  }
}

class UnavailableWorkspaceAssignmentService implements WorkspaceAssignmentService {
  readonly isAvailable = false

  async listWorkspaces(): Promise<WorkspaceAssignmentOption[]> {
    return []
  }

  async listAssignments(): Promise<WorkspaceAssignmentMap> {
    return {}
  }

  async getAssignment(): Promise<string | null> {
    return null
  }

  async getWorkspaceDetail(): Promise<WorkspaceDetail | null> {
    return null
  }

  async assign(): Promise<void> {
    // No real local workspaces on web — silently ignore so callers stay simple.
  }

  async clearAssignment(): Promise<void> {
    // No real local workspaces on web.
  }

  async createWorkspace(): Promise<WorkspaceAssignmentOption | null> {
    return null
  }
}

let desktopServiceSingleton: DesktopWorkspaceAssignmentService | null = null
const unavailableService = new UnavailableWorkspaceAssignmentService()

export function getWorkspaceAssignmentService(): WorkspaceAssignmentService {
  if (!isTauriRuntime()) {
    return unavailableService
  }

  if (!desktopServiceSingleton) {
    desktopServiceSingleton = new DesktopWorkspaceAssignmentService()
  }

  return desktopServiceSingleton
}

/**
 * Resolves the Workspace of a writing by scanning its root. This is the
 * authoritative read — it discovers files that reconciliation has not reached
 * yet — but it costs a full `tauriWorkspaceSync` of the root plus a manifest
 * write, so it belongs to writing changes and explicit retries, never to a
 * catalog notification. Use `refreshContextualWorkspaceDocuments` for those.
 *
 * The outcome is discriminated because three different situations used to
 * collapse into `null`, and the UI rendered all of them as "this artifact does
 * not belong to a Workspace" — a claim that is simply false on web, where the
 * runtime cannot answer the question at all.
 */
export async function loadContextualWorkspace(
  documentId: string,
): Promise<ContextualWorkspaceOutcome> {
  if (!isTauriRuntime()) return { kind: "unsupported-runtime" }

  const catalog = await getDocumentCatalog()
  const record = await catalog.getById(documentId)
  const canonicalPath = record?.binding?.canonicalPath
  if (!canonicalPath) return { kind: "no-membership" }

  const service = await getDesktopWorkspaceService()
  const workspace = await service.getWorkspaceContainingPath(canonicalPath)
  if (!workspace) return { kind: "no-membership" }

  const documentJoin = workspace.status === "ready"
    ? await loadWorkspaceDocumentJoin(workspace.rootPath)
    : new Map()

  return {
    kind: "workspace",
    workspace: {
      slug: workspace.slug,
      name: workspace.name,
      status: workspace.status,
      missingReason: workspace.missingReason,
      documents: workspace.files.map((file) => {
        const document = documentJoin.get(file.path)
        return {
          id: document?.id ?? null,
          name: file.name,
          relativePath: file.relativePath,
          state: document?.state ?? "rebuilding",
          openable: Boolean(document?.id),
        }
      }),
    },
  }
}

const basename = (path: string) => path.split("/").pop() ?? path

function sameDocuments(
  left: ContextualWorkspaceDocument[],
  right: ContextualWorkspaceDocument[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((document, index) => {
    const other = right[index]
    return (
      document.id === other.id &&
      document.name === other.name &&
      document.relativePath === other.relativePath &&
      document.state === other.state &&
      document.openable === other.openable
    )
  })
}

/**
 * Applies a catalog change to an already-loaded Workspace without touching the
 * filesystem: it reads the catalog join for the root and patches only the
 * documents the change names. Saving the active writing emits an `upsert` on
 * every autosave, and resolving that through `loadContextualWorkspace` would
 * rescan the whole root — a second full scan right after the one `persist`
 * already performed.
 *
 * Returns `null` when nothing the tree renders actually changed, so an autosave
 * that only bumps content produces no re-render at all. Documents registered
 * under this root by the same transaction are appended, and documents that left
 * the catalog are dropped, so add/move/remove stay reactive.
 */
export async function refreshContextualWorkspaceDocuments(
  workspace: ContextualWorkspace,
  changedDocumentIds: string[],
): Promise<ContextualWorkspace | null> {
  if (!isTauriRuntime()) return null
  if (workspace.status !== "ready") return null

  const service = await getDesktopWorkspaceService()
  const record = await service.findWorkspaceRecord(workspace.slug)
  if (!record) return null

  const root = record.rootPath.replace(/[\\/]+$/, "")
  const documentJoin = await loadWorkspaceDocumentJoin(record.rootPath)
  const byId = new Map<string, { relativePath: string; state: DocumentState }>()
  for (const [canonicalPath, info] of documentJoin) {
    const normalized = canonicalPath.replace(/\\/g, "/")
    byId.set(info.id, {
      relativePath: normalized.startsWith(`${root}/`)
        ? normalized.slice(root.length + 1)
        : normalized,
      state: info.state,
    })
  }

  const changed = new Set(changedDocumentIds)
  const kept = new Set<string>()
  const documents: ContextualWorkspaceDocument[] = []

  for (const document of workspace.documents) {
    if (document.id) kept.add(document.id)
    if (!document.id || !changed.has(document.id)) {
      documents.push(document)
      continue
    }
    const entry = byId.get(document.id)
    // The change removed it from this root — a move out, or a delete.
    if (!entry) continue
    documents.push({
      id: document.id,
      name: basename(entry.relativePath),
      relativePath: entry.relativePath,
      state: entry.state,
      openable: true,
    })
  }

  for (const id of changed) {
    if (kept.has(id)) continue
    const entry = byId.get(id)
    if (!entry) continue
    documents.push({
      id,
      name: basename(entry.relativePath),
      relativePath: entry.relativePath,
      state: entry.state,
      openable: true,
    })
  }

  return sameDocuments(workspace.documents, documents)
    ? null
    : { ...workspace, documents }
}

export function subscribeToContextualWorkspaceChanges(
  onChange: (change: CatalogChange) => void,
): () => void {
  return subscribeToCatalog(onChange)
}
