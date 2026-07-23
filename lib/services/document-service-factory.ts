import type {
  DeleteWritingInput,
  DocumentService,
  ExportWritingInput,
  ListWritingsInput,
  RenameWritingInput,
  SaveWritingInput,
  SetWritingCollectionsInput,
  WritingCollectionMembership,
  WritingRecord,
  WritingSummary,
} from "@/lib/services/contracts/document-service"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { normalizeArtifactType } from "@/lib/writings/artifact-type"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { webDocumentService } from "@/lib/services/web-document-service"
import { FilesystemDocumentService } from "@/lib/services/desktop/filesystem-document-service"
import { desktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import { EMPTY_EDITOR_JSON } from "@/lib/editor/extensions"
import { filenameToTitle, UNTITLED_DOCUMENT_NAME } from "@/lib/desktop/document-naming"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import {
  loadDesktopCollections,
  setDesktopWritingCollections,
} from "@/lib/services/desktop/desktop-collection-service"
import {
  tauriOpenFile,
  tauriRelocateFile,
  tauriWorkspaceSync,
  tauriWriteFile,
  type DesktopCatalogDualWriteInput,
} from "@/lib/services/desktop/tauri-commands"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"

type DesktopRuntimeServices = {
  writingsDir: string
  dbPath: string
  filesystem: FilesystemDocumentService
  catalog: SqliteDocumentCatalog
}

type DesktopDraftOptions = {
  writingId?: string | null
  authorId?: string | null
  title?: string | null
  slug?: string | null
  status?: WritingRecord["status"]
  visibility?: WritingRecord["visibility"]
  preferredPath?: string | null
  initialBodyJson?: Record<string, unknown> | null
  initialBodyText?: string
}

function ok<T>(data: T): ServiceResponse<T> { return { data, error: null } }
function err<T>(code: ServiceError["code"], message: string): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable: false } }
}
function unexpected(error: unknown, fallback: ServiceError["code"] = "UNAVAILABLE"): ServiceError {
  return { code: fallback, message: error instanceof Error ? error.message : "Unexpected error", retryable: false }
}
function createWritingId() { return crypto.randomUUID() }
function dirname(value: string) {
  const separator = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"))
  return separator <= 0 ? value : value.slice(0, separator)
}
function basename(value: string) {
  const separator = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"))
  return separator < 0 ? value : value.slice(separator + 1)
}

function toWriting(record: DocumentCatalogRecord, bodyJson: Record<string, unknown>, bodyText: string): WritingRecord {
  const createdAt = new Date(record.createdAt ?? record.modifiedAt ?? Date.now()).toISOString()
  const updatedAt = new Date(record.modifiedAt ?? Date.now()).toISOString()
  return {
    id: record.id,
    authorId: record.cloudAccountId,
    title: record.binding ? filenameToTitle(record.binding.relativePath) : record.title,
    content: { richText: bodyJson, markdown: null, plainText: bodyText, canonicalSource: "markdown" },
    slug: record.slug,
    status: record.status ?? "draft",
    artifactType: normalizeArtifactType(record.artifactType),
    visibility: record.visibility ?? "private",
    parentId: null,
    correspondenceId: null,
    version: Math.max(1, record.version ?? 1),
    deletedAt: record.deletedAt,
    createdAt,
    updatedAt,
    lifecycle: record.cloudPresent
      ? "server-confirmed"
      : record.syncStatus === "pending"
        ? "syncing"
        : "local-only",
  }
}

function toSummary(record: DocumentCatalogRecord): WritingSummary {
  const createdAt = new Date(record.createdAt ?? record.modifiedAt ?? Date.now()).toISOString()
  const updatedAt = new Date(record.modifiedAt ?? Date.now()).toISOString()
  return {
    id: record.id, authorId: record.cloudAccountId, title: record.title, slug: record.slug,
    status: record.status ?? "draft", artifactType: normalizeArtifactType(record.artifactType),
    visibility: record.visibility ?? "private", parentId: null, correspondenceId: null,
    version: Math.max(1, record.version ?? 1), deletedAt: record.deletedAt, createdAt, updatedAt,
    excerpt: record.excerpt ?? null,
  }
}

async function resolveDesktopRuntimeServices(): Promise<DesktopRuntimeServices> {
  const { appConfigDir, appDataDir, join } = await import("@tauri-apps/api/path")
  const configDir = await appConfigDir()
  const writingsDir = await join(await appDataDir(), "Writings")
  const dbPath = await join(configDir, "desktop-index.sqlite3")
  return {
    writingsDir,
    dbPath,
    filesystem: new FilesystemDocumentService(writingsDir),
    catalog: new SqliteDocumentCatalog(dbPath),
  }
}

class DesktopDocumentService implements DocumentService {
  constructor(private readonly runtime: DesktopRuntimeServices) {}

  private serialize(record: WritingRecord) {
    const result = desktopDocumentEngine.serializeBodyJson(
      (record.content.richText as Record<string, unknown> | null | undefined) ?? EMPTY_EDITOR_JSON,
    )
    if (!result.success) throw new Error(result.error)
    return result.markdown
  }

  private async persist(
    record: WritingRecord,
    canonicalPath: string,
    operation: "upsert" | "delete" = "upsert",
  ): Promise<WritingRecord> {
    const markdown = this.serialize(record)
    if (operation === "upsert") {
      const fileResult = await this.runtime.filesystem.saveWriting({
        writing: {
          ...record,
          id: canonicalPath,
          content: { markdown, richText: null, plainText: record.content.plainText, canonicalSource: "markdown" },
        },
      })
      if (fileResult.error) throw new Error(fileResult.error.message)
    }

    const catalogBefore = await this.runtime.catalog.getById(record.id)
    const priorBinding = catalogBefore?.binding
    const rootPath = priorBinding
      ? priorBinding.canonicalPath.slice(0, -(priorBinding.relativePath.length + 1))
      : dirname(canonicalPath)
    const relativePath = canonicalPath.startsWith(`${rootPath}/`)
      ? canonicalPath.slice(rootPath.length + 1)
      : basename(canonicalPath)
    // Omit selectedPaths so the durable manifest keeps its existing whole-root
    // or exact-file scope; a save must never narrow a BindingRoot implicitly.
    const snapshot = await tauriWorkspaceSync(rootPath, undefined, { [relativePath]: record.id })
    const file = snapshot.files.find((entry) => entry.path === canonicalPath || entry.relativePath === relativePath)
    if (!file) throw new Error(`Manifest did not retain ${relativePath}`)
    const now = Date.now()
    const input: DesktopCatalogDualWriteInput = {
      document: {
        id: record.id,
        localPresent: true,
        cloudPresent: catalogBefore?.cloudPresent ?? false,
        cloudAccountId: record.authorId,
        syncStatus: "pending",
        title: filenameToTitle(file.relativePath),
        slug: record.slug,
        status: record.status,
        artifactType: record.artifactType,
        visibility: record.visibility,
        version: Math.max(1, record.version),
        deletedAt: record.deletedAt,
        createdAt: Date.parse(record.createdAt),
        modifiedAt: Date.parse(record.updatedAt),
      },
      binding: {
        bindingRootId: snapshot.bindingRootId,
        rootPath: snapshot.rootPath,
        manifestVersion: 2,
        visibleAsWorkspace: false,
        relativePath: file.relativePath,
        canonicalPath: file.path,
        inode: file.inode || null,
        contentHash: file.contentHash || null,
        size: file.size,
        lastSeenAt: file.modifiedAt,
      },
      mutation: {
        id: crypto.randomUUID(),
        operation,
        payloadJson: JSON.stringify({
          title: filenameToTitle(file.relativePath), bodyText: record.content.plainText,
          bodyJson: record.content.richText, slug: record.slug, status: record.status,
          artifactType: record.artifactType, visibility: record.visibility,
          parentId: record.parentId, correspondenceId: record.correspondenceId,
          version: Math.max(1, record.version), updatedAt: record.updatedAt,
          deletedAt: operation === "delete" ? new Date().toISOString() : record.deletedAt,
        }),
        status: "pending", attemptCount: 0, nextRetryAt: null, createdAt: now, lastError: null,
      },
    }
    await this.runtime.catalog.commitDualWrite(input)
    return { ...record, title: filenameToTitle(file.relativePath) }
  }

  async listWritings(input?: ListWritingsInput): Promise<ServiceResponse<WritingSummary[]>> {
    try {
      const rows = await this.runtime.catalog.list({ includeDeleted: input?.includeDeleted, limit: 5000 })
      return ok(rows.map(toSummary))
    } catch (error) { return { data: null, error: unexpected(error, "DB_ERROR") } }
  }

  async openWriting(id: string): Promise<ServiceResponse<WritingRecord>> {
    try {
      const record = await this.runtime.catalog.getById(id)
      if (!record?.binding?.canonicalPath) return err("NOT_FOUND", `Writing ${id} has no local binding`)
      const file = await this.runtime.filesystem.openWriting(record.binding.canonicalPath)
      if (file.error || !file.data) return err("NOT_FOUND", file.error?.message ?? `Writing ${id} not found`)
      const parsed = desktopDocumentEngine.parseSourceDocument(file.data.content.markdown ?? "")
      if (!parsed.success) return err("INVALID_INPUT", parsed.error)
      return ok(toWriting(
        record,
        parsed.document.snapshot.bodyJson as Record<string, unknown>,
        parsed.document.snapshot.bodyText,
      ))
    } catch (error) { return { data: null, error: unexpected(error, "DB_ERROR") } }
  }

  async saveWriting(input: SaveWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      const existing = await this.runtime.catalog.getById(input.writing.id)
      if (!existing?.binding?.canonicalPath) return err("NOT_FOUND", `Writing ${input.writing.id} has no local binding`)
      return ok(await this.persist(input.writing, existing.binding.canonicalPath))
    } catch (error) { return { data: null, error: unexpected(error, "DB_ERROR") } }
  }

  async createDraft(options: DesktopDraftOptions = {}): Promise<ServiceResponse<WritingRecord>> {
    try {
      const now = new Date().toISOString()
      const id = options.writingId?.trim() || createWritingId()
      const title = options.title?.trim() || UNTITLED_DOCUMENT_NAME
      const allocation = options.preferredPath
        ? { path: options.preferredPath }
        : (await this.runtime.filesystem.createDraft(title)).data
      if (!allocation?.path) return err("UNAVAILABLE", "Failed to allocate canonical file")
      const record: WritingRecord = {
        id, authorId: options.authorId ?? null, title,
        content: {
          richText: options.initialBodyJson ?? EMPTY_EDITOR_JSON,
          markdown: null, plainText: options.initialBodyText ?? "", canonicalSource: "rich-text",
        },
        slug: options.slug ?? null, status: options.status ?? "draft", artifactType: "general",
        visibility: options.visibility ?? "private", parentId: null, correspondenceId: null,
        version: 1, deletedAt: null, createdAt: now, updatedAt: now,
      }
      return ok(await this.persist(record, allocation.path))
    } catch (error) { return { data: null, error: unexpected(error, "DB_ERROR") } }
  }

  async renameWriting(input: RenameWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      const existing = await this.openWriting(input.writingId)
      if (existing.error || !existing.data) return existing
      const binding = await this.runtime.catalog.getById(input.writingId)
      if (!binding?.binding?.canonicalPath) return err("NOT_FOUND", `Writing ${input.writingId} not found`)
      const renamed = await this.runtime.filesystem.renameWriting({
        writingId: binding.binding.canonicalPath, title: input.title, updatedAt: input.updatedAt,
      })
      if (renamed.error || !renamed.data) return err("UNAVAILABLE", renamed.error?.message ?? "Rename failed")
      const next = { ...existing.data, title: renamed.data.title, updatedAt: input.updatedAt }
      return ok(await this.persist(next, renamed.data.id))
    } catch (error) { return { data: null, error: unexpected(error, "DB_ERROR") } }
  }

  async deleteWriting(input: DeleteWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      const catalogRecord = await this.runtime.catalog.getById(input.writingId)
      if (!catalogRecord) return err("NOT_FOUND", `Writing ${input.writingId} not found`)

      let existing = toWriting(catalogRecord, {}, "")
      const localBinding = catalogRecord.binding
      if (localBinding?.canonicalPath) {
        const opened = await this.openWriting(input.writingId)
        if (opened.error || !opened.data) return opened
        existing = opened.data
        const removed = await this.runtime.filesystem.deleteWriting({
          ...input,
          writingId: localBinding.canonicalPath,
        })
        if (removed.error) return err("STORAGE_ERROR", removed.error.message)

        const rootPath = localBinding.canonicalPath.slice(
          0,
          -(localBinding.relativePath.length + 1),
        )
        await tauriWorkspaceSync(rootPath)
      }

      const deleted = {
        ...existing,
        version: input.version,
        deletedAt: input.deletedAt,
        updatedAt: input.updatedAt,
      }
      const now = Date.now()
      await this.runtime.catalog.commitDualWrite({
        document: {
          id: catalogRecord.id,
          localPresent: false,
          cloudPresent: catalogRecord.cloudPresent,
          cloudAccountId: catalogRecord.cloudAccountId,
          syncStatus: "deleted",
          title: catalogRecord.title,
          slug: catalogRecord.slug,
          status: catalogRecord.status,
          artifactType: catalogRecord.artifactType,
          visibility: catalogRecord.visibility,
          version: input.version,
          deletedAt: input.deletedAt,
          createdAt: catalogRecord.createdAt,
          modifiedAt: Date.parse(input.updatedAt),
        },
        binding: null,
        mutation: catalogRecord.cloudPresent ? {
          id: crypto.randomUUID(),
          operation: "delete",
          payloadJson: JSON.stringify({
            version: input.version,
            deletedAt: input.deletedAt,
            updatedAt: input.updatedAt,
          }),
          status: "pending",
          attemptCount: 0,
          nextRetryAt: null,
          createdAt: now,
          lastError: null,
        } : null,
      })
      return ok(deleted)
    } catch (error) { return { data: null, error: unexpected(error, "DB_ERROR") } }
  }

  async listWritingCollections(id: string): Promise<ServiceResponse<WritingCollectionMembership[]>> {
    const state = await loadDesktopCollections()
    return ok(state.writingCollections.filter((row) => row.writing_id === id).map((row) => ({
      collectionId: row.collection_id, addedAt: row.added_at,
    })))
  }
  async setWritingCollections(input: SetWritingCollectionsInput): Promise<ServiceResponse<WritingCollectionMembership[]>> {
    await setDesktopWritingCollections(input.writingId, input.collectionIds)
    return this.listWritingCollections(input.writingId)
  }
  async exportWriting(input: ExportWritingInput) { return this.runtime.filesystem.exportWriting(input) }
}

let desktopServicePromise: Promise<DocumentService> | null = null
export async function getDocumentService(): Promise<DocumentService> {
  if (!isDesktopRuntime()) return webDocumentService
  desktopServicePromise ??= resolveDesktopRuntimeServices().then((runtime) => new DesktopDocumentService(runtime))
  return desktopServicePromise
}

export async function createDesktopDraft(options: DesktopDraftOptions = {}) {
  const service = await getDocumentService()
  if (!(service instanceof DesktopDocumentService)) return err<WritingRecord>("UNAVAILABLE", "Desktop runtime required")
  return service.createDraft(options)
}

export type RelocateDesktopWritingResult =
  | { status: "relocated"; path: string }
  | { status: "failed"; message: string }
  | { status: "unsupported" }

/**
 * Reads the canonical `.md` path bound to a writing UUID, or null when the
 * document has no local binding on this machine (cloud-only) or the runtime is
 * not desktop. Read-only: lets workspace flows decide between a physical move
 * and metadata-only membership without inferring identity from the filesystem.
 */
export async function getDesktopWritingCanonicalPath(id: string): Promise<string | null> {
  if (!isDesktopRuntime()) return null
  const runtime = await resolveDesktopRuntimeServices()
  const record = await runtime.catalog.getById(id)
  return record?.binding?.canonicalPath ?? null
}

function matchesSelectedPaths(relativePath: string, selectedPaths: string[]) {
  if (selectedPaths.length === 0) return true
  return selectedPaths.some(
    (selected) => relativePath === selected || relativePath.startsWith(`${selected}/`),
  )
}

function sameSelectedPaths(left: string[], right: string[]) {
  return left.length === right.length && left.every((path, index) => path === right[index])
}

/**
 * Conscious relocate primitive (ODE-402, ADR D7 amendment): physically MOVE the
 * canonical `.md` to the user-chosen path while preserving the document's UUID
 * and keeping exactly ONE canonical_path at every step.
 *
 * Durable order (spec §Guardado): content commit to the current `.md` → physical
 * rename (no copy; collision-suffixed; cross-device safe) → destination manifest
 * atomic bind to the SAME UUID → SQLite binding replacement + sync enqueue in one
 * transaction → origin ledger drop. Cloud sync flushes in background.
 *
 * Every failure leaves a recoverable state (NOT_FOUND / unbound file / stale
 * origin manifest); it never mints a draft or any other durable fallback.
 */
export async function relocateDesktopWriting(
  id: string,
  requestedPath: string,
  content?: string,
): Promise<RelocateDesktopWritingResult> {
  if (!isDesktopRuntime()) return { status: "unsupported" }
  try {
    const runtime = await resolveDesktopRuntimeServices()
    const record = await runtime.catalog.getById(id)
    const binding = record?.binding
    if (!record || !binding?.canonicalPath) {
      // Recoverable: a UUID without a local binding never becomes a draft here.
      return { status: "failed", message: `Writing ${id} has no local binding` }
    }
    const sourcePath = binding.canonicalPath
    const sourceRootPath = sourcePath.slice(0, -(binding.relativePath.length + 1))

    // 1. Commit the latest editor content to the CURRENT canonical file first:
    //    the move then transports exactly those bytes and there is a single
    //    canonical copy at all times (never write-copy-then-move).
    if (typeof content === "string") {
      await tauriWriteFile(sourcePath, content)
    }

    // 2. Physical move: rename, no copy. Collisions auto-suffix ("Name 2.md");
    //    cross-device degrades to copy+verify+delete-original in Rust.
    const finalPath = await tauriRelocateFile(sourcePath, requestedPath)

    // 3. Resolve the destination BindingRoot: deepest registered root (Settings
    //    BindingRoots, or a Workspace root not yet adopted into bindingRoots —
    //    ODE-373 bridge). Otherwise the chosen folder becomes a new external root.
    const { appConfigDir } = await import("@tauri-apps/api/path")
    const settings = new DesktopSettingsService(await appConfigDir())
    const [bindingRoots, desktopSettings] = await Promise.all([
      settings.getBindingRoots(),
      settings.getDesktopSettings(),
    ])
    const contains = (rootPath: string) =>
      finalPath.startsWith(`${rootPath.replace(/[\\/]+$/, "")}/`)
    const settingsRecord =
      bindingRoots
        .filter((root) => contains(root.rootPath))
        .sort((a, b) => b.rootPath.length - a.rootPath.length)[0] ?? null
    const workspaceRecord =
      (desktopSettings.data?.workspaces ?? [])
        .filter((workspace) => contains(workspace.rootPath))
        .sort((a, b) => b.rootPath.length - a.rootPath.length)[0] ?? null
    const destRootPath =
      settingsRecord &&
      (!workspaceRecord || settingsRecord.rootPath.length >= workspaceRecord.rootPath.length)
        ? settingsRecord.rootPath
        : (workspaceRecord?.rootPath ?? dirname(finalPath))
    const isNewRoot = !settingsRecord && !workspaceRecord
    const relativePath = finalPath.slice(destRootPath.length + 1)

    // 4. Destination ledger: the atomic manifest write binds the moved file to
    //    the SAME UUID. Scope: a new root starts limited to exactly this file
    //    (never indexes the rest of the folder); a narrowed existing selection
    //    is extended with the file the user explicitly chose.
    let selectedPaths: string[] | undefined
    if (isNewRoot) {
      selectedPaths = [relativePath]
    } else if (
      settingsRecord &&
      settingsRecord.selectedPaths.length > 0 &&
      !matchesSelectedPaths(relativePath, settingsRecord.selectedPaths)
    ) {
      selectedPaths = Array.from(new Set([...settingsRecord.selectedPaths, relativePath]))
    }
    let snapshot = await tauriWorkspaceSync(destRootPath, selectedPaths, { [relativePath]: id })
    let file = snapshot.files.find((entry) => entry.relativePath === relativePath)
    if (!file && snapshot.selectedPaths.length > 0) {
      // The durable manifest scope did not cover the destination; extend it with
      // the user's explicit choice instead of failing the conscious move.
      snapshot = await tauriWorkspaceSync(
        destRootPath,
        Array.from(new Set([...snapshot.selectedPaths, relativePath])),
        { [relativePath]: id },
      )
      file = snapshot.files.find((entry) => entry.relativePath === relativePath)
    }
    if (!file) throw new Error(`Destination manifest did not retain ${relativePath}`)
    if (file.id !== id) {
      // Ambiguity is never auto-chosen: leave the recoverable state to the
      // reconciler/Open Document instead of forcing a second identity.
      throw new Error(`Destination manifest bound ${relativePath} to a different identity`)
    }

    // 5. SQLite + sync enqueue in ONE transaction. The binding upsert is keyed by
    //    document_id, so the origin binding row is replaced — a single
    //    canonical_path, zero residue. Cloud sync then flushes in background.
    const markdown = typeof content === "string" ? content : await tauriOpenFile(file.path)
    const parsed = desktopDocumentEngine.parseSourceDocument(markdown)
    if (!parsed.success) throw new Error(parsed.error)
    const nowIso = new Date().toISOString()
    const now = Date.now()
    const title = filenameToTitle(file.relativePath)
    const version = Math.max(1, record.version ?? 1)
    await runtime.catalog.commitDualWrite({
      document: {
        id,
        localPresent: true,
        cloudPresent: record.cloudPresent,
        cloudAccountId: record.cloudAccountId,
        syncStatus: "pending",
        title,
        slug: record.slug,
        status: record.status ?? "draft",
        artifactType: record.artifactType,
        visibility: record.visibility ?? "private",
        version,
        deletedAt: record.deletedAt,
        createdAt: record.createdAt ?? now,
        modifiedAt: now,
      },
      binding: {
        bindingRootId: snapshot.bindingRootId,
        rootPath: snapshot.rootPath,
        manifestVersion: 2,
        visibleAsWorkspace: settingsRecord?.visibleAsWorkspace ?? false,
        relativePath: file.relativePath,
        canonicalPath: file.path,
        inode: file.inode || null,
        contentHash: file.contentHash || null,
        size: file.size,
        lastSeenAt: file.modifiedAt,
      },
      mutation: {
        id: crypto.randomUUID(),
        operation: "upsert",
        payloadJson: JSON.stringify({
          title,
          bodyText: parsed.document.snapshot.bodyText,
          bodyJson: parsed.document.snapshot.bodyJson,
          slug: record.slug,
          status: record.status ?? "draft",
          artifactType: record.artifactType,
          visibility: record.visibility ?? "private",
          parentId: null,
          correspondenceId: null,
          version,
          updatedAt: nowIso,
          deletedAt: record.deletedAt,
        }),
        status: "pending",
        attemptCount: 0,
        nextRetryAt: null,
        createdAt: now,
        lastError: null,
      },
    })

    // 6. Origin ledger drop: re-scanning the source root rewrites its manifest
    //    atomically without the moved file. SQLite already replaced the binding,
    //    so nothing references the origin path anymore.
    if (destRootPath !== sourceRootPath) {
      try {
        await tauriWorkspaceSync(sourceRootPath)
      } catch {
        // Recoverable: the next reconciler scan of the source root converges the
        // manifest; the file is gone and the catalog already moved on.
      }
    }

    // 7. Register/extend the destination root so the global reconciler observes
    //    it. Consent = the user's explicit folder choice in the Save dialog; a
    //    new root is never a visible Workspace by default.
    if (isNewRoot) {
      await settings.upsertBindingRoot({
        id: snapshot.bindingRootId,
        rootPath: destRootPath,
        kind: "external",
        visibleAsWorkspace: false,
        selectedPaths: snapshot.selectedPaths,
        consentedAt: nowIso,
        createdAt: nowIso,
      })
      const { refreshWorkspaceReconcilerRoots } = await import(
        "@/lib/services/desktop/desktop-workspace-reconciler"
      )
      await refreshWorkspaceReconcilerRoots()
    } else if (
      settingsRecord &&
      !sameSelectedPaths(settingsRecord.selectedPaths, snapshot.selectedPaths)
    ) {
      await settings.upsertBindingRoot({
        ...settingsRecord,
        selectedPaths: snapshot.selectedPaths,
      })
    }

    return { status: "relocated", path: file.path }
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Relocate failed",
    }
  }
}

/**
 * Watcher-observed move projection: the file already moved on disk (e.g. Finder)
 * and `workspace_sync` re-bound the manifest to the SAME UUID via inode/content
 * hash. Project that verdict into SQLite through the same reconcile transaction
 * the WorkspaceReconciler uses, so a Finder move and a UI move converge on one
 * identity and one canonical_path. Ambiguity is never auto-chosen.
 */
export async function relocateDesktopWritingByCanonicalPath(previous: string, next: string): Promise<void> {
  if (!isDesktopRuntime()) return
  const runtime = await resolveDesktopRuntimeServices()
  const resolved = await runtime.catalog.resolvePath(previous)
  if (resolved.kind !== "resolved" || !resolved.record.binding) return
  const record = resolved.record
  const rootPath = resolved.record.binding.canonicalPath.slice(
    0,
    -(resolved.record.binding.relativePath.length + 1),
  )
  let snapshot: Awaited<ReturnType<typeof tauriWorkspaceSync>>
  try {
    snapshot = await tauriWorkspaceSync(rootPath)
  } catch {
    // Root temporarily unobservable — never a detach, never a new identity.
    return
  }
  const file = snapshot.files.find((entry) => entry.path === next)
  if (!file || file.id !== record.id) return
  const { appConfigDir } = await import("@tauri-apps/api/path")
  const settings = new DesktopSettingsService(await appConfigDir())
  const roots = await settings.getBindingRoots()
  const rootRecord =
    roots.find((root) => root.id === snapshot.bindingRootId || root.rootPath === rootPath) ?? null
  await runtime.catalog.applyReconcileTransaction({
    transactionId: crypto.randomUUID(),
    bindingRootId: snapshot.bindingRootId,
    rootPath: snapshot.rootPath,
    visibleAsWorkspace: rootRecord?.visibleAsWorkspace ?? false,
    upserts: [
      {
        documentId: record.id,
        bindingRootId: snapshot.bindingRootId,
        relativePath: file.relativePath,
        canonicalPath: file.path,
        inode: file.inode || null,
        contentHash: file.contentHash || null,
        size: file.size,
        modifiedAt: file.modifiedAt,
        strategy: "path",
      },
    ],
    detached: [],
  })
}
export async function markDesktopWritingDeletedByCanonicalPath(canonicalPath: string): Promise<void> {
  if (!isDesktopRuntime()) return
  const runtime = await resolveDesktopRuntimeServices()
  const resolved = await runtime.catalog.resolvePath(canonicalPath)
  if (resolved.kind === "resolved") await runtime.catalog.detachLocalFile(resolved.record.id)
}

export async function importDesktopWritingFile(path: string, content: string) {
  const parsed = desktopDocumentEngine.parseSourceDocument(content)
  if (!parsed.success) return err<WritingRecord>("INVALID_INPUT", parsed.error)
  return createDesktopDraft({
    writingId: createWritingId(), title: filenameToTitle(path), preferredPath: path,
    initialBodyJson: parsed.document.snapshot.bodyJson as Record<string, unknown>,
    initialBodyText: parsed.document.snapshot.bodyText,
  })
}
