import type {
  DocumentCatalogRecord,
  PathResolution,
  RegisterBindingInput,
} from "@/lib/services/contracts/document-catalog"
import {
  reconcileSingleFile,
  type CloudHashLookup,
  type KnownBinding,
  type ResolutionStrategy,
} from "@/lib/services/desktop/workspace-reconciler"

/**
 * openDocument — the single application use case for opening a desktop document
 * (ODE-375, Fase 9 M3, spec §Apertura unificada).
 *
 * Both entry kinds converge to a UUID *before* the editor hydrates:
 *   - `id`   resolves only through the DocumentCatalog. A UUID-looking value is
 *            identity, never a filesystem path.
 *   - `path` resolves through the catalog, and when unbound exhausts the
 *            reconciliation ladder (manifest → path → inode → local hash → cloud
 *            hash) before a UUID is ever minted. Reopening the same path is
 *            idempotent because `resolvePath` returns the already-bound record.
 *
 * Every outcome is explicit and recoverable. A failure (unreadable file, catalog
 * error, orphaned binding, ambiguous hash) NEVER mints a UUID and NEVER creates a
 * draft — draft creation stays an explicit New Writing action (invariant #10).
 *
 * This module is pure and injectable: all storage/filesystem access is a port,
 * so the whole ladder is unit-testable without Tauri. The desktop wiring lives in
 * `lib/services/desktop/open-document-desktop.ts`.
 */

export type OpenDocumentInput =
  | { kind: "id"; id: string }
  | { kind: "path"; path: string; confirmRegisterRoot?: boolean }

/** How a path open resolved its identity; `existing` = already bound in catalog. */
export type OpenStrategy = ResolutionStrategy | "existing"

export type OpenDocumentResult =
  | { status: "opened"; documentId: string; record: DocumentCatalogRecord; strategy: OpenStrategy }
  | { status: "needs-binding-root-confirmation"; path: string; parentDir: string }
  | { status: "ambiguous"; path: string; candidates: string[] }
  | { status: "conflict"; documentId: string; record: DocumentCatalogRecord }
  | { status: "orphaned"; id?: string; path?: string }
  | { status: "failed"; reason: string }

/** Identity evidence read from one file on disk (adapter concern). */
export type FileOpenEvidence = {
  canonicalPath: string
  inode: number | null
  contentHash: string | null
  size: number | null
  modifiedAt: number | null
  /** Filename-derived title cached for the catalog row; content stays in `.md`. */
  title: string | null
  /** UUID already recorded for this path in the v2 manifest ledger, if any. */
  manifestId?: string | null
}

/** A BindingRoot that already contains `path`, with the file's relative path. */
export type BindingRootMatch = {
  bindingRootId: string
  rootPath: string
  relativePath: string
}

export type BindingRootLocation =
  | { kind: "inside"; match: BindingRootMatch }
  | { kind: "outside"; parentDir: string }

export type OpenDocumentPorts = {
  catalog: {
    getById(id: string): Promise<DocumentCatalogRecord | null>
    resolvePath(path: string): Promise<PathResolution>
    registerBinding(input: RegisterBindingInput): Promise<DocumentCatalogRecord>
  }
  /** Reads a file's identity evidence. Throwing means `failed` — never a mint. */
  readFileEvidence(input: BindingRootMatch & { path: string }): Promise<FileOpenEvidence>
  /** Finds the root containing `path`, or reports it is outside every root. */
  locateBindingRoot(path: string): Promise<BindingRootLocation>
  /**
   * Registers the parent folder as an external root with `selectedPaths` limited
   * to this one file. Only invoked after explicit confirmation (spec §Archivo
   * fuera de un BindingRoot).
   */
  registerExternalRoot(input: { parentDir: string; filePath: string }): Promise<BindingRootMatch>
  /** Prior local bindings for a root, feeding the reconciliation priority. */
  listKnownBindings(bindingRootId: string): Promise<KnownBinding[]>
  /**
   * Materializes a cloud-only record into a local `.md` inside a BindingRoot
   * (spec §Drafts nuevos y cloud-only). ODE-371 owns the final adapter; when it
   * is not wired, cloud-only surfaces as an explicit `failed`, never as missing.
   */
  materializeCloudOnly?: (input: { documentId: string }) => Promise<DocumentCatalogRecord>
  cloudHashLookup?: CloudHashLookup
  mintId?: () => string
}

const DEFAULT_MINT = () => globalThis.crypto.randomUUID()

export function createOpenDocumentUseCase(ports: OpenDocumentPorts) {
  const mintId = ports.mintId ?? DEFAULT_MINT

  /** Turns an already-known catalog record into an explicit open outcome. */
  async function openExistingRecord(
    record: DocumentCatalogRecord,
  ): Promise<OpenDocumentResult> {
    if (record.syncStatus === "conflict") {
      return { status: "conflict", documentId: record.id, record }
    }

    if (!record.localPresent && record.cloudPresent) {
      // cloud-only: must materialize a local `.md` before editing; a caller may
      // never reinterpret this as missing or spawn an Untitled draft.
      if (!ports.materializeCloudOnly) {
        return {
          status: "failed",
          reason: `document ${record.id} is cloud-only; materialization is owned by ODE-371 and is not wired in this build`,
        }
      }
      const materialized = await ports.materializeCloudOnly({ documentId: record.id })
      return { status: "opened", documentId: materialized.id, record: materialized, strategy: "existing" }
    }

    if (!record.localPresent && !record.cloudPresent) {
      // Neither local nor cloud presence: an orphaned binding, not an openable
      // document (spec §Modelo de estados). Recoverable, never a draft.
      return { status: "orphaned", id: record.id }
    }

    return { status: "opened", documentId: record.id, record, strategy: "existing" }
  }

  /** Registers (or upserts) the resolved binding and returns the opened record. */
  async function registerAndOpen(
    documentId: string,
    strategy: OpenStrategy,
    match: BindingRootMatch,
    evidence: FileOpenEvidence,
  ): Promise<OpenDocumentResult> {
    const existing = strategy === "minted" ? null : await ports.catalog.getById(documentId)
    const now = Date.now()

    const document = existing
      ? stripBinding({ ...existing, localPresent: true })
      : {
          id: documentId,
          localPresent: true,
          cloudPresent: false,
          cloudAccountId: null,
          syncStatus: "local-only" as const,
          title: evidence.title,
          slug: null,
          status: null,
          artifactType: null,
          visibility: null,
          version: null,
          createdAt: now,
          modifiedAt: evidence.modifiedAt ?? now,
        }

    const record = await ports.catalog.registerBinding({
      document,
      binding: {
        documentId,
        bindingRootId: match.bindingRootId,
        relativePath: match.relativePath,
        canonicalPath: evidence.canonicalPath,
        inode: evidence.inode,
        contentHash: evidence.contentHash,
        size: evidence.size,
        lastSeenAt: now,
      },
    })

    return { status: "opened", documentId: record.id, record, strategy }
  }

  async function openById(id: string): Promise<OpenDocumentResult> {
    const record = await ports.catalog.getById(id)
    if (!record) {
      return { status: "orphaned", id }
    }
    return openExistingRecord(record)
  }

  async function openByPath(
    path: string,
    confirmRegisterRoot: boolean,
  ): Promise<OpenDocumentResult> {
    const resolution = await ports.catalog.resolvePath(path)
    if (resolution.kind === "resolved") {
      // Idempotent: the same path already carries a stable UUID.
      return openExistingRecord(resolution.record)
    }

    const location = await ports.locateBindingRoot(path)
    let match: BindingRootMatch
    if (location.kind === "outside") {
      if (!confirmRegisterRoot) {
        return { status: "needs-binding-root-confirmation", path, parentDir: location.parentDir }
      }
      match = await ports.registerExternalRoot({ parentDir: location.parentDir, filePath: path })
    } else {
      match = location.match
    }

    const evidence = await ports.readFileEvidence({ ...match, path })
    const knownBindings = await ports.listKnownBindings(match.bindingRootId)
    const resolved = reconcileSingleFile({
      file: {
        relativePath: match.relativePath,
        canonicalPath: evidence.canonicalPath,
        inode: evidence.inode,
        contentHash: evidence.contentHash,
        size: evidence.size,
        modifiedAt: evidence.modifiedAt,
        manifestId: evidence.manifestId ?? null,
      },
      bindingRootId: match.bindingRootId,
      knownBindings,
      cloudHashLookup: ports.cloudHashLookup,
      mintId,
    })

    if (resolved.strategy === "ambiguous" || !resolved.documentId) {
      return { status: "ambiguous", path, candidates: resolved.candidates ?? [] }
    }

    return registerAndOpen(resolved.documentId, resolved.strategy, match, evidence)
  }

  return async function openDocument(
    input: OpenDocumentInput,
  ): Promise<OpenDocumentResult> {
    try {
      if (input.kind === "id") {
        return await openById(input.id)
      }
      return await openByPath(input.path, input.confirmRegisterRoot ?? false)
    } catch (error) {
      // Any failure is recoverable and terminal for this attempt: no UUID is
      // minted and no draft is created as a fallback (invariant #10).
      return {
        status: "failed",
        reason: error instanceof Error ? error.message : "Failed to open document",
      }
    }
  }
}

function stripBinding(
  record: DocumentCatalogRecord,
): Omit<DocumentCatalogRecord, "binding"> {
  const rest = { ...record }
  delete (rest as { binding?: unknown }).binding
  return rest
}
