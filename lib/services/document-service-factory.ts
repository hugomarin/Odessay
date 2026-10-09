import type {
  DeleteWritingInput,
  DocumentService,
  ExportWritingInput,
  ListWritingsInput,
  RenameWritingInput,
  SaveWritingInput,
  UpdateWritingMetadataInput,
  UpdateWritingsMetadataInput,
  SetWritingCollectionsInput,
  WritingCollectionMembership,
  WritingRecord,
  WritingSummary,
  RestoreWritingInput,
  PermanentlyDeleteWritingInput,
  DownloadWritingInput,
} from "@/lib/services/contracts/document-service"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { normalizeArtifactType } from "@/lib/writings/artifact-type"
import { computeMarkdownContentHash } from "@/lib/content-hash"
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
  tauriWorkspaceTouchFile,
  tauriWriteFile,
  type DesktopCatalogDualWriteInput,
  type DesktopWorkspaceFile,
} from "@/lib/services/desktop/tauri-commands"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"
import { getSyncService } from "@/lib/sync/sync-service-factory"

type DesktopRuntimeServices = {
  writingsDir: string
  dbPath: string
  filesystem: FilesystemDocumentService
  catalog: SqliteDocumentCatalog
  scheduleSyncFlush: () => Promise<ServiceResponse<void>>
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
function conflict(message: string): ServiceError {
  return { code: "CONFLICT", message, retryable: false }
}
function isConflictError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "CONFLICT"
  )
}
function unexpected(error: unknown, fallback: ServiceError["code"] = "UNAVAILABLE"): ServiceError {
  // A caller inside this class (persist()) can throw an already-well-formed
  // ServiceError — e.g. the WATCH-07 CONFLICT from a write-side hash
  // mismatch — and that specific code must survive to the outer
  // ServiceResponse, not collapse into a generic fallback the way a plain
  // Error's message-only info would.
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return error as ServiceError
  }
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
    lifecycle: record.cloudAccountId !== null
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
    archiveState: record.deletedAt
      ? record.syncStatus === "pending" ? "pending-deletion" : record.syncStatus === "failed" ? "error" : "archived"
      : undefined,
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
    scheduleSyncFlush: () => getSyncService().scheduleFlush(),
  }
}

type DesktopPathOperation = {
  promise: Promise<unknown>
  waitBeforeSave: boolean
}

class DesktopDocumentService implements DocumentService {
  /**
   * ODE-629/ODE-693 — a rename or relocate moves the `.md` before its catalog
   * commit. This single per-writingId registry stays live through that commit
   * or a recoverable error. A save that arrives during relocate waits before
   * resolving the binding; rename keeps its existing conflict-and-retry path.
   */
  private readonly renamesInFlight = new Map<string, DesktopPathOperation>()

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
    expectedContentHash?: string | null,
    options: { writeContent?: boolean } = {},
  ): Promise<WritingRecord> {
    const wroteContent = operation === "upsert" && options.writeContent !== false
    let targetPath = canonicalPath
    let writtenMarkdown = ""
    if (wroteContent) {
      // ODE-635 (review ronda 2) — the caller resolved `canonicalPath` before
      // this save reached the write, and a rename of this document can move
      // the `.md` in between. Re-read the binding immediately before writing
      // and re-target when the rename already committed: the bytes must land
      // on the path the catalog owns, never on a stale one. The re-read does
      // NOT wait for a rename still in flight: ODE-629 requires a save to land
      // on the old path while a rename holds its pre-move snapshot, so the
      // rename transports those bytes instead of overwriting them. Swaps of
      // that path are refused by the transport's identity guard below (a
      // different file is never replaced); `null` continues to mean "no
      // baseline" and is not replaced by any hash.
      const bound = await this.runtime.catalog.getById(record.id)
      const boundPath = bound?.binding?.canonicalPath ?? null
      if (boundPath && boundPath !== targetPath) targetPath = boundPath
      // With no content baseline the transport still refuses to replace a
      // different file at the resolved path: the binding's inode identifies
      // the file this save is allowed to overwrite (ODE-635, review ronda 2).
      const expectedInode = expectedContentHash == null ? (bound?.binding?.inode ?? null) : null
      const markdown = this.serialize(record)
      writtenMarkdown = markdown
      const fileResult = await this.runtime.filesystem.saveWriting({
        writing: {
          ...record,
          id: targetPath,
          content: { markdown, richText: null, plainText: record.content.plainText, canonicalSource: "markdown" },
        },
        expectedContentHash,
        expectedInode,
      })
      if (fileResult.error) throw fileResult.error
      // A rename may also start while the write is in flight: wait for it
      // before reading the catalog so the binding compared below is settled,
      // never half-committed.
      await this.renamesInFlight.get(record.id)?.promise.catch(() => undefined)
    }

    const catalogBefore = await this.runtime.catalog.getById(record.id)
    if (
      wroteContent &&
      catalogBefore?.binding?.canonicalPath &&
      catalogBefore.binding.canonicalPath !== targetPath
    ) {
      // A rename (or conscious move) committed a different canonical path
      // while the write was in flight, so the write landed on a path this
      // document no longer owns. The retire must prove it moves exactly THIS
      // operation's recreation: another writer may have replaced or updated
      // that path in the write→retire interval, and the watcher's recent-write
      // suppression means that edit may not be reconciled yet. Compare the
      // hash of what is on disk against the markdown this operation wrote; if
      // they differ (or the path cannot be read), nothing is retired — the
      // other writer's content stays recoverable at the old path, never in
      // `.trash` — and the same `CONFLICT` shape routes the bytes to the path
      // the catalog owns. Only when the recreation is exact is it retired
      // through the filesystem owner's trash move, and a failure of that move
      // is propagated so `persistFollowingRename` cannot report success with
      // the stale recreation still on disk (round 1, P1+P2). `null` keeps
      // meaning "no baseline": this only routes the bytes to the path the
      // catalog owns; it never substitutes a hash and never rebinds the stale
      // path.
      const writtenHash = await computeMarkdownContentHash(writtenMarkdown)
      const onDisk = await this.runtime.filesystem.openWriting(targetPath)
      const diskHash = onDisk.data
        ? await computeMarkdownContentHash(onDisk.data.content.markdown ?? "")
        : null
      if (diskHash === null || diskHash !== writtenHash) {
        throw conflict(
          `Writing ${record.id} moved to ${catalogBefore.binding.canonicalPath} while the save was in flight; content at ${targetPath} differs from this save and was kept`,
        )
      }
      const retired = await this.runtime.filesystem.deleteWriting({
        writingId: targetPath,
        version: record.version,
        updatedAt: record.updatedAt,
        deletedAt: new Date().toISOString(),
      })
      if (retired.error) throw retired.error
      throw conflict(
        `Writing ${record.id} moved to ${catalogBefore.binding.canonicalPath} while the save was in flight`,
      )
    }
    const priorBinding = catalogBefore?.binding
    const rootPath = priorBinding
      ? priorBinding.canonicalPath.slice(0, -(priorBinding.relativePath.length + 1))
      : dirname(targetPath)
    const relativePath = targetPath.startsWith(`${rootPath}/`)
      ? targetPath.slice(rootPath.length + 1)
      : basename(targetPath)
    // Steady state (ODE-459): a document that already carries a durable binding
    // only needs its own manifest entry refreshed, so the save path never walks
    // the BindingRoot. Anything unverifiable falls back to the full
    // reconciliation below, which stays the owner of scans, scope changes and
    // identity minting.
    let binding: { bindingRootId: string; rootPath: string; file: DesktopWorkspaceFile } | null = null
    if (priorBinding && priorBinding.relativePath === relativePath) {
      const touched = await tauriWorkspaceTouchFile(rootPath, relativePath, record.id)
      if (touched.status === "updated") {
        binding = { bindingRootId: touched.bindingRootId, rootPath: touched.rootPath, file: touched.file }
      }
    }
    if (!binding) {
      // Omit selectedPaths so the durable manifest keeps its existing whole-root
      // or exact-file scope; a save must never narrow a BindingRoot implicitly.
      const snapshot = await tauriWorkspaceSync(rootPath, undefined, { [relativePath]: record.id })
      const synced = snapshot.files.find((entry) => entry.path === targetPath || entry.relativePath === relativePath)
      if (!synced) throw new Error(`Manifest did not retain ${relativePath}`)
      binding = { bindingRootId: snapshot.bindingRootId, rootPath: snapshot.rootPath, file: synced }
    }
    const file = binding.file
    const now = Date.now()
    // ODE-453: a bound document's content lives in the canonical `.md` file.
    // The flush re-reads and re-parses that file whenever it needs to write
    // cloud content, so shipping bodyJson/bodyText inside the durable SQLite
    // mutation would be a full copy of the document that's never read back.
    // `contentUnchanged` lets the flush skip that re-read/re-parse and the
    // content columns entirely when this save didn't touch the file bytes.
    const priorContentHash = priorBinding?.contentHash || null
    const nextContentHash = file.contentHash || null
    const contentUnchanged = operation === "upsert"
      && (catalogBefore?.cloudPresent ?? false)
      && priorContentHash !== null
      && nextContentHash !== null
      && priorContentHash === nextContentHash
    const nextTitle = filenameToTitle(file.relativePath)
    // Desk/Collections/Workspace only render title, slug, status, artifact
    // type, visibility and where the file lives — none of which a keystroke
    // autosave normally touches. Comparing against the pre-save row lets those
    // views skip reacting (and re-reading the whole catalog) for a save that
    // only changed document body bytes, without them having to inspect the
    // payload themselves.
    const metadataChanged = operation === "delete"
      || !catalogBefore
      || catalogBefore.title !== nextTitle
      || catalogBefore.slug !== record.slug
      || catalogBefore.status !== record.status
      || catalogBefore.artifactType !== record.artifactType
      || catalogBefore.visibility !== record.visibility
      || catalogBefore.deletedAt !== record.deletedAt
      || (catalogBefore.binding?.relativePath ?? null) !== file.relativePath
    const input: DesktopCatalogDualWriteInput = {
      document: {
        id: record.id,
        localPresent: true,
        cloudPresent: catalogBefore?.cloudPresent ?? false,
        cloudAccountId: record.authorId,
        syncStatus: "pending",
        title: nextTitle,
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
        bindingRootId: binding.bindingRootId,
        rootPath: binding.rootPath,
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
        // No bodyJson/bodyText here (ODE-453): the flush resolves content from
        // the canonical `.md` via `record.binding.canonicalPath`, keyed by
        // contentHash/contentUnchanged below — never from this payload.
        payloadJson: JSON.stringify({
          title: nextTitle, slug: record.slug, status: record.status,
          artifactType: record.artifactType, visibility: record.visibility,
          parentId: record.parentId, correspondenceId: record.correspondenceId,
          version: Math.max(1, record.version), updatedAt: record.updatedAt,
          deletedAt: operation === "delete" ? new Date().toISOString() : record.deletedAt,
          contentHash: nextContentHash, contentUnchanged,
        }),
        status: "pending", attemptCount: 0, nextRetryAt: null, createdAt: now, lastError: null,
      },
    }
    await this.runtime.catalog.commitDualWrite(input, metadataChanged ? "upsert" : "content")
    void this.runtime.scheduleSyncFlush().catch(() => {
      // The SQLite mutation is durable. The rescue ticker will retry if the
      // in-memory scheduler is unavailable during shutdown.
    })
    return { ...record, title: nextTitle, contentHash: nextContentHash }
  }

  async listWritings(input?: ListWritingsInput): Promise<ServiceResponse<WritingSummary[]>> {
    try {
      const { getAuthService } = await import("@/lib/services/auth-service-factory")
      const session = await getAuthService().getSession()
      const rows = await this.runtime.catalog.list({
        cloudAccountId: session.data?.user?.id ?? null,
        includeDeleted: input?.includeDeleted,
        limit: 5000,
      })
      const filteredRows = input?.archivedOnly
        ? rows.filter((row) => row.deletedAt !== null)
        : rows
      const offset = Math.max(0, input?.offset ?? 0)
      const limit = input?.limit == null ? undefined : Math.max(0, input.limit)
      const page = limit == null
        ? filteredRows.slice(offset)
        : filteredRows.slice(offset, offset + limit)
      return ok(page.map(toSummary))
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

  /**
   * ODE-629 — a save resolves its canonical path once (`catalog.getById`) and
   * `write_file` guards that path with `expectedContentHash`. When a rename
   * moves the `.md` while the save is in flight, the old path is gone and the
   * write is refused with CONFLICT. If the catalog now binds the same UUID to a
   * different path, that CONFLICT is the rename having moved the document, not
   * an external edit: the save retries against the new path so the content
   * lands instead of living only in memory. A CONFLICT at a still-current path
   * is a real external-change conflict and is rethrown untouched.
   *
   * The retry must also wait for a rename of this document that is mid-flight:
   * the rename moves the file before committing the catalog, so a save can
   * CONFLICT inside that window (`rename_file` already moved it) and a bare
   * catalog read would still return the old path — the same conflict again.
   * Awaiting the in-flight rename commits the catalog first; the loop stays
   * bounded by its own attempt budget.
   */
  private async persistFollowingRename(
    record: WritingRecord,
    canonicalPath: string,
    expectedContentHash?: string | null,
  ): Promise<WritingRecord> {
    let target = canonicalPath
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.waitForRelocateBeforeSave(record.id)
      try {
        return await this.persist(record, target, "upsert", expectedContentHash)
      } catch (error) {
        lastError = error
        if (!isConflictError(error)) throw error
        await this.renamesInFlight.get(record.id)?.promise.catch(() => undefined)
        const current = await this.runtime.catalog.getById(record.id)
        const currentPath = current?.binding?.canonicalPath ?? null
        if (!currentPath || currentPath === target) throw error
        target = currentPath
      }
    }
    throw lastError ?? new Error("Save retry exhausted")
  }

  private async waitForRelocateBeforeSave(writingId: string): Promise<void> {
    while (true) {
      const operation = this.renamesInFlight.get(writingId)
      if (!operation?.waitBeforeSave) return

      await operation.promise.catch(() => undefined)
      await Promise.resolve()
      if (this.renamesInFlight.get(writingId) === operation) {
        throw new Error(`Relocate for ${writingId} settled without releasing its in-flight entry`)
      }
    }
  }

  async saveWriting(input: SaveWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      await this.waitForRelocateBeforeSave(input.writing.id)
      const existing = await this.runtime.catalog.getById(input.writing.id)
      if (!existing?.binding?.canonicalPath) return err("NOT_FOUND", `Writing ${input.writing.id} has no local binding`)
      return ok(await this.persistFollowingRename(input.writing, existing.binding.canonicalPath, input.expectedContentHash))
    } catch (error) { return { data: null, error: unexpected(error, "DB_ERROR") } }
  }

  async updateWritingMetadata(input: UpdateWritingMetadataInput): Promise<ServiceResponse<WritingRecord>> {
    const result = await this.updateWritingsMetadata({ updates: [input] })
    if (result.error) return { data: null, error: result.error }
    if (!result.data?.[0]) return err("NOT_FOUND", `Writing ${input.writingId} not found`)
    return ok(result.data[0])
  }

  async updateWritingsMetadata(input: UpdateWritingsMetadataInput): Promise<ServiceResponse<WritingRecord[]>> {
    try {
      const prepared = []
      for (const change of input.updates) {
        const existing = await this.runtime.catalog.getById(change.writingId)
        if (!existing || existing.deletedAt) return err("NOT_FOUND", `Writing ${change.writingId} not found`)
        const hasCloudOwnership = existing.cloudPresent || existing.cloudAccountId !== null
        const updated: DocumentCatalogRecord = {
          ...existing,
          status: change.status ?? existing.status,
          artifactType: change.artifactType ?? existing.artifactType,
          version: change.version,
          modifiedAt: Date.parse(change.updatedAt),
          syncStatus: hasCloudOwnership ? "pending" : "local-only",
        }
        const binding = existing.binding
        const rootPath = binding
          ? binding.canonicalPath.slice(0, -(binding.relativePath.length + 1))
          : null
        prepared.push({ updated, dualWrite: {
        document: {
          id: updated.id,
          localPresent: updated.localPresent,
          cloudPresent: updated.cloudPresent,
          cloudAccountId: updated.cloudAccountId,
          syncStatus: hasCloudOwnership ? "pending" : "local-only",
          title: updated.title,
          slug: updated.slug,
          status: updated.status,
          artifactType: updated.artifactType,
          visibility: updated.visibility,
          version: updated.version,
          deletedAt: updated.deletedAt,
          createdAt: updated.createdAt,
          modifiedAt: updated.modifiedAt,
        },
        binding: binding && rootPath ? {
          bindingRootId: binding.bindingRootId,
          rootPath,
          manifestVersion: 2,
          visibleAsWorkspace: false,
          relativePath: binding.relativePath,
          canonicalPath: binding.canonicalPath,
          inode: binding.inode,
          contentHash: binding.contentHash,
          size: binding.size,
          lastSeenAt: binding.lastSeenAt,
        } : null,
        mutation: hasCloudOwnership ? {
          id: crypto.randomUUID(),
          operation: "upsert",
          payloadJson: JSON.stringify({
            mutationKind: "metadata",
            status: updated.status,
            artifactType: updated.artifactType,
            version: updated.version,
            updatedAt: change.updatedAt,
          }),
          status: "pending",
          attemptCount: 0,
          nextRetryAt: null,
          createdAt: Date.now(),
          lastError: null,
        } : null,
        } satisfies DesktopCatalogDualWriteInput })
      }
      await this.runtime.catalog.commitBulkDualWrite(prepared.map(({ dualWrite }) => dualWrite))
      if (prepared.some(({ dualWrite }) => dualWrite.mutation !== null)) {
        void this.runtime.scheduleSyncFlush().catch(() => {
          // Local metadata remains durable and pending when scheduling fails.
        })
      }
      return ok(prepared.map(({ updated }) => toWriting(updated, {}, "")))
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
    // ODE-629: register the whole rename — from before the file move to after
    // the catalog commit — so a save that CONFLICTs inside the move→commit
    // window can wait for it instead of reading a half-committed catalog (see
    // persistFollowingRename). The entry is removed only once the rename has
    // fully settled, so an absent entry means the catalog is already current.
    const inFlight = this.performRenameWriting(input)
    const operation: DesktopPathOperation = { promise: inFlight, waitBeforeSave: false }
    this.renamesInFlight.set(input.writingId, operation)
    try {
      return await inFlight
    } finally {
      if (this.renamesInFlight.get(input.writingId) === operation) {
        this.renamesInFlight.delete(input.writingId)
      }
    }
  }

  async relocateWriting(
    writingId: string,
    requestedPath: string,
    content?: string,
  ): Promise<RelocateDesktopWritingResult> {
    const inFlight = performRelocateDesktopWriting(this.runtime, writingId, requestedPath, content)
    const operation: DesktopPathOperation = { promise: inFlight, waitBeforeSave: true }
    this.renamesInFlight.set(writingId, operation)
    try {
      return await inFlight
    } finally {
      if (this.renamesInFlight.get(writingId) === operation) {
        this.renamesInFlight.delete(writingId)
      }
    }
  }

  private async performRenameWriting(input: RenameWritingInput): Promise<ServiceResponse<WritingRecord>> {
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
      // ODE-629: the move already transported the bytes that were on disk; the
      // rename only rebinds. Writing `next` here would resurrect the snapshot
      // `openWriting()` read before the move and could silently clobber a save
      // that landed in between. The binding is refreshed from the real file
      // stats (`writeContent: false`), so a save racing the rename lands on the
      // new path through `persistFollowingRename`.
      return ok(await this.persist(next, renamed.data.id, "upsert", null, { writeContent: false }))
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
      if (catalogRecord.cloudPresent) {
        void this.runtime.scheduleSyncFlush().catch(() => {
          // The archive mutation stays in SQLite for the rescue ticker.
        })
      }
      return ok(deleted)
    } catch (error) { return { data: null, error: unexpected(error, "DB_ERROR") } }
  }

  async restoreWriting(input: RestoreWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      const current = await this.runtime.catalog.getById(input.writingId)
      if (!current?.deletedAt) return err("NOT_FOUND", `Archived artifact ${input.writingId} not found`)
      if (current.version !== input.version) return err("CONFLICT", `Archived artifact ${input.writingId} changed before it could be restored`)
      const mutationId = crypto.randomUUID()
      const mutationCreatedAt = Date.now()
      const mutationPayload = JSON.stringify({
        mutationKind: "restore",
        deletedAt: null,
        expectedVersion: input.version,
        version: input.version + 1,
        updatedAt: input.updatedAt,
      })
      const restored = { ...current, deletedAt: null, syncStatus: "pending" as const, version: input.version + 1, modifiedAt: Date.parse(input.updatedAt) }
      await this.runtime.catalog.commitDualWrite({
        document: {
          id: restored.id, localPresent: restored.localPresent, cloudPresent: restored.cloudPresent,
          cloudAccountId: restored.cloudAccountId, syncStatus: restored.syncStatus, title: restored.title,
          slug: restored.slug, status: restored.status, artifactType: restored.artifactType,
          visibility: restored.visibility, version: restored.version, deletedAt: restored.deletedAt,
          createdAt: restored.createdAt, modifiedAt: restored.modifiedAt,
        },
        binding: current.binding ? {
          bindingRootId: current.binding.bindingRootId, rootPath: current.binding.canonicalPath.slice(0, -(current.binding.relativePath.length + 1)), manifestVersion: 2, visibleAsWorkspace: false,
          relativePath: current.binding.relativePath, canonicalPath: current.binding.canonicalPath, inode: current.binding.inode, contentHash: current.binding.contentHash, size: current.binding.size, lastSeenAt: current.binding.lastSeenAt,
        } : null,
        mutation: { id: mutationId, operation: "upsert", payloadJson: mutationPayload, status: "pending", attemptCount: 0, nextRetryAt: null, createdAt: mutationCreatedAt, lastError: null },
      })
      const { getSyncService } = await import("@/lib/sync/sync-service-factory")
      const flushed = await getSyncService().flushPending()
      if (flushed.error || flushed.data?.failedMutations.includes(mutationId)) {
        await this.runtime.catalog.commitDualWrite({
          document: {
            id: current.id, localPresent: current.localPresent, cloudPresent: current.cloudPresent,
            cloudAccountId: current.cloudAccountId, syncStatus: "failed", title: current.title,
            slug: current.slug, status: current.status, artifactType: current.artifactType,
            visibility: current.visibility, version: current.version, deletedAt: current.deletedAt,
            createdAt: current.createdAt, modifiedAt: current.modifiedAt,
          },
          binding: current.binding ? {
            bindingRootId: current.binding.bindingRootId, rootPath: current.binding.canonicalPath.slice(0, -(current.binding.relativePath.length + 1)), manifestVersion: 2, visibleAsWorkspace: false,
            relativePath: current.binding.relativePath, canonicalPath: current.binding.canonicalPath, inode: current.binding.inode, contentHash: current.binding.contentHash, size: current.binding.size, lastSeenAt: current.binding.lastSeenAt,
          } : null,
          mutation: {
            id: mutationId,
            operation: "upsert",
            payloadJson: mutationPayload,
            status: "failed",
            attemptCount: 1,
            nextRetryAt: flushed.data?.nextRetryAt ?? Date.now() + 1_000,
            createdAt: mutationCreatedAt,
            lastError: flushed.error?.message ?? "The archived writing could not be restored",
          },
        })
        if (flushed.error) return { data: null, error: flushed.error }
        return err("UNAVAILABLE", "The archived writing could not be restored")
      }
      return ok(toWriting(restored, {}, ""))
    } catch (error) { return { data: null, error: unexpected(error, "DB_ERROR") } }
  }

  async permanentlyDeleteWriting(input: PermanentlyDeleteWritingInput): Promise<ServiceResponse<void>> {
    try {
      const current = await this.runtime.catalog.getById(input.writingId)
      if (!current?.deletedAt) return err("NOT_FOUND", `Archived artifact ${input.writingId} not found`)
      const mutationId = crypto.randomUUID()
      await this.runtime.catalog.commitDualWrite({
        document: {
          id: current.id, localPresent: current.localPresent, cloudPresent: current.cloudPresent,
          cloudAccountId: current.cloudAccountId, syncStatus: "pending", title: current.title,
          slug: current.slug, status: current.status, artifactType: current.artifactType,
          visibility: current.visibility, version: current.version, deletedAt: current.deletedAt,
          createdAt: current.createdAt, modifiedAt: current.modifiedAt,
        },
        binding: null,
        mutation: { id: mutationId, operation: "delete", payloadJson: JSON.stringify({ mutationKind: "permanent-delete", updatedAt: new Date().toISOString() }), status: "pending", attemptCount: 0, nextRetryAt: null, createdAt: Date.now(), lastError: null },
      })
      const { getSyncService } = await import("@/lib/sync/sync-service-factory")
      const flushed = await getSyncService().flushPending()
      if (flushed.error) return { data: null, error: flushed.error }
      if (flushed.data?.failedMutations.includes(mutationId)) {
        return err("UNAVAILABLE", "The archived writing could not be permanently deleted")
      }
      return ok(undefined)
    } catch (error) { return { data: null, error: unexpected(error, "DB_ERROR") } }
  }

  async downloadWriting(input: DownloadWritingInput): Promise<ServiceResponse<import("@/lib/services/contracts/document-service").ExportedDocumentArtifact>> {
    const current = await this.runtime.catalog.getById(input.writingId)
    if (current?.binding?.canonicalPath) return this.runtime.filesystem.downloadWriting({ writingId: current.binding.canonicalPath })
    return webDocumentService.downloadWriting(input)
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
  async exportWriting(input: ExportWritingInput): Promise<ServiceResponse<import("@/lib/services/contracts/document-service").ExportedDocumentArtifact>> {
    const current = await this.runtime.catalog.getById(input.writingId)
    if (current?.binding?.canonicalPath) {
      return this.runtime.filesystem.exportWriting({ writingId: current.binding.canonicalPath, format: input.format })
    }
    return webDocumentService.exportWriting(input)
  }
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
    const service = await getDocumentService()
    if (!(service instanceof DesktopDocumentService)) return { status: "unsupported" }
    return await service.relocateWriting(id, requestedPath, content)
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Relocate failed",
    }
  }
}

async function performRelocateDesktopWriting(
  runtime: DesktopRuntimeServices,
  id: string,
  requestedPath: string,
  content?: string,
): Promise<RelocateDesktopWritingResult> {
  try {
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
