"use client"

import { appConfigDir, join } from "@tauri-apps/api/path"
import {
  filenameToTitle,
  resolveUniqueFilename,
  titleToFilename,
} from "@/lib/desktop/document-naming"
import { serializeDocumentToMarkdown } from "@/lib/editor/document-serialization"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import { createDesktopClient } from "@/lib/supabase/desktop-client"
import {
  tauriListRecentFiles,
  tauriCatalogFindEligibleCloudHash,
  tauriWorkspaceSync,
  tauriWriteFile,
} from "@/lib/services/desktop/tauri-commands"
import type { KnownBinding } from "@/lib/services/desktop/workspace-reconciler"
import {
  createOpenDocumentUseCase,
  RetryableOpenError,
  TerminalOpenError,
  type BindingRootLocation,
  type BindingRootMatch,
  type FileOpenEvidence,
  type OpenDocumentInput,
  type OpenDocumentResult,
} from "@/lib/services/open-document"

/**
 * Wraps a desktop port call so an IPC/OS-level throw (SQLite busy, filesystem
 * hiccup, Tauri command failure) surfaces as retryable — those are the transient
 * failure modes ODE-454 rearms automatically. A caller that already knows a
 * failure is permanent throws `TerminalOpenError` directly instead of calling
 * this helper.
 */
async function asRetryable<T>(
  reasonCode: "catalog-unavailable" | "file-unreadable" | "cloud-materialization-failed",
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof RetryableOpenError || error instanceof TerminalOpenError) throw error
    throw new RetryableOpenError(
      reasonCode,
      error instanceof Error ? error.message : "Desktop open failed",
    )
  }
}

const MANAGED_ROOT_DIRNAME = "artifact-studio-managed"

function dirname(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return separator <= 0 ? path : path.slice(0, separator)
}

function basename(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return separator < 0 ? path : path.slice(separator + 1)
}

function relativeTo(rootPath: string, path: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "")
  if (path === normalizedRoot) return ""
  const prefix = `${normalizedRoot}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : basename(path)
}

function scopeContains(relativePath: string, selectedPaths: string[]): boolean {
  return selectedPaths.length === 0 || selectedPaths.some(
    (selectedPath) => relativePath === selectedPath || relativePath.startsWith(`${selectedPath}/`),
  )
}

function scopeForExplicitOpen(relativePath: string, selectedPaths: string[] | undefined): string[] | undefined {
  if (!selectedPaths || selectedPaths.length === 0) return selectedPaths
  if (scopeContains(relativePath, selectedPaths)) return selectedPaths
  return Array.from(new Set([...selectedPaths, relativePath]))
}

async function buildDesktopOpenDocumentUseCase() {
  const configDir = await appConfigDir()
  const settings = new DesktopSettingsService(configDir)
  const catalog = new SqliteDocumentCatalog(
    await join(configDir, "desktop-index.sqlite3"),
  )

  function contains(rootPath: string, path: string): boolean {
    return path === rootPath || path.startsWith(`${rootPath.replace(/[\\/]+$/, "")}/`)
  }

  async function locateBindingRoot(path: string): Promise<BindingRootLocation> {
    const [bindingRoots, desktopSettings] = await Promise.all([
      settings.getBindingRoots(),
      settings.getDesktopSettings(),
    ])

    // Registered BindingRoots (managed + external) carry their id directly.
    const rootMatch = bindingRoots
      .filter((root) => contains(root.rootPath, path))
      .sort((a, b) => b.rootPath.length - a.rootPath.length)[0]
    if (rootMatch) {
      return {
        kind: "inside",
        match: {
          bindingRootId: rootMatch.id,
          rootPath: rootMatch.rootPath,
          relativePath: relativeTo(rootMatch.rootPath, path),
          selectedPaths: rootMatch.selectedPaths,
        },
      }
    }

    // Workspace folders are BindingRoots too (their `.odessay/index.json` holds a
    // bindingRootId). They live in a separate settings list until ODE-373 adopts
    // them, so resolve their id from the manifest via workspace_sync here.
    const workspaces = desktopSettings.data?.workspaces ?? []
    const workspaceMatch = workspaces
      .filter((workspace) => contains(workspace.rootPath, path))
      .sort((a, b) => b.rootPath.length - a.rootPath.length)[0]
    if (workspaceMatch) {
      const snapshot = await tauriWorkspaceSync(workspaceMatch.rootPath)
      return {
        kind: "inside",
        match: {
          bindingRootId: snapshot.bindingRootId,
          rootPath: workspaceMatch.rootPath,
          relativePath: relativeTo(workspaceMatch.rootPath, path),
          selectedPaths: snapshot.selectedPaths,
        },
      }
    }

    return { kind: "outside", parentDir: dirname(path) }
  }

  async function registerExternalRoot(input: {
    parentDir: string
    filePath: string
  }): Promise<BindingRootMatch> {
    const relativePath = relativeTo(input.parentDir, input.filePath)

    // Manifest first, then projections. `.odessay/index.json` is the durable
    // binding ledger and mints/persists the authoritative bindingRootId, so it
    // must exist before Settings or the catalog record so all three agree on ONE
    // id (spec §Reglas de escritura + §Guardado: manifest before SQLite). Scope
    // is limited to just this file — never the whole folder (requirement 3).
    const snapshot = await tauriWorkspaceSync(input.parentDir, [relativePath])
    const bindingRootId = snapshot.bindingRootId
    const nowIso = new Date().toISOString()

    try {
      await settings.upsertBindingRoot({
        id: bindingRootId,
        rootPath: input.parentDir,
        kind: "external",
        visibleAsWorkspace: false,
        selectedPaths: [relativePath],
        consentedAt: nowIso,
        createdAt: nowIso,
      })
    } catch (error) {
      // The manifest already carries this id, so re-running Open Document on the
      // same file resolves the same bindingRootId and re-attempts the Settings
      // upsert idempotently — no divergent id is ever created. Surface the write
      // failure so the caller yields `failed` instead of a partial open.
      throw new Error(
        `Failed to register BindingRoot for ${input.parentDir}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      )
    }

    return {
      bindingRootId,
      rootPath: input.parentDir,
      relativePath,
      selectedPaths: snapshot.selectedPaths,
    }
  }

  async function readFileEvidence(
    input: BindingRootMatch & { path: string },
  ): Promise<FileOpenEvidence> {
    return asRetryable("file-unreadable", async () => {
      // Opening one file is an additive scope operation. Passing a singleton
      // array here used to replace a full Workspace scope and atomically discard
      // every sibling binding from `.odessay/index.json`.
      const selectedPaths = scopeForExplicitOpen(input.relativePath, input.selectedPaths)
      const snapshot = await tauriWorkspaceSync(input.rootPath, selectedPaths)
      if (
        input.selectedPaths &&
        (snapshot.selectedPaths.length !== input.selectedPaths.length ||
          snapshot.selectedPaths.some((path, index) => path !== input.selectedPaths![index]))
      ) {
        const current = (await settings.getBindingRoots()).find(
          (root) => root.id === input.bindingRootId,
        )
        if (current) {
          await settings.upsertBindingRoot({ ...current, selectedPaths: snapshot.selectedPaths })
        }
      }
      const file =
        snapshot.files.find((entry) => entry.relativePath === input.relativePath) ??
        snapshot.files.find((entry) => entry.path === input.path)

      if (!file) {
        // The workspace_sync round-trip succeeded but the file is absent from the
        // fresh snapshot: this can be a slow write, an unmount race, or a real
        // deletion, and this layer cannot tell those apart. Treat it as transient
        // so a bounded rearm gets one more chance before giving up.
        throw new RetryableOpenError(
          "file-unreadable",
          `File is not present in its BindingRoot: ${input.path}`,
        )
      }

      return {
        canonicalPath: file.path,
        inode: file.inode || null,
        contentHash: file.contentHash || null,
        size: file.size,
        modifiedAt: file.modifiedAt,
        title: filenameToTitle(file.path),
        manifestId: file.id || null,
      }
    })
  }

  async function listKnownBindings(bindingRootId: string): Promise<KnownBinding[]> {
    const rows = await catalog.list({ limit: 5000 })
    return rows
      .filter((row) => row.binding?.bindingRootId === bindingRootId)
      .map((row) => ({
        documentId: row.id,
        bindingRootId,
        relativePath: row.binding!.relativePath,
        inode: row.binding!.inode,
        contentHash: row.binding!.contentHash,
      }))
  }

  async function materializeCloudOnly(input: {
    documentId: string
    bindingRootId?: string
  }): Promise<DocumentCatalogRecord> {
    const supabase = createDesktopClient()
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    const userId = sessionData.session?.user.id
    // No session is a permanent state for this attempt — retrying without the
    // user re-authenticating changes nothing.
    if (sessionError || !userId) {
      throw new TerminalOpenError(
        "cloud-materialization-unavailable",
        "Cloud materialization requires authentication",
      )
    }
    const { data: materializedWriting, error: writingError } = await supabase
      .from("writings")
      .select("id,author_id,title,body_json,slug,status,artifact_type,visibility,version,created_at,updated_at")
      .eq("id", input.documentId)
      .eq("author_id", userId)
      .maybeSingle()
    // A query error (network blip, transient PostgREST failure) is retryable;
    // the row genuinely not existing is not.
    if (writingError) throw new RetryableOpenError("cloud-materialization-failed", writingError.message)
    if (!materializedWriting) {
      throw new TerminalOpenError(
        "cloud-materialization-unavailable",
        `Cloud document ${input.documentId} was not found`,
      )
    }

    let markdown: string
    try {
      markdown = serializeDocumentToMarkdown(materializedWriting.body_json)
    } catch (error) {
      // A malformed body will fail the same way on every retry.
      throw new TerminalOpenError(
        "cloud-materialization-failed",
        error instanceof Error ? error.message : "JSON→Markdown serialization failed",
      )
    }

    const registeredRoots = await settings.getBindingRoots()
    const selectedRoot = input.bindingRootId
      ? registeredRoots.find((root) => root.id === input.bindingRootId)
      : null
    if (input.bindingRootId && !selectedRoot) {
      throw new Error(`BindingRoot ${input.bindingRootId} is not registered`)
    }
    const root = selectedRoot ?? await settings.ensureManagedRoot(
      await join(configDir, MANAGED_ROOT_DIRNAME),
    )
    async function registerMaterializedFile(
      snapshot: Awaited<ReturnType<typeof tauriWorkspaceSync>>,
      file: Awaited<ReturnType<typeof tauriWorkspaceSync>>["files"][number],
    ): Promise<DocumentCatalogRecord> {
      const existing = await catalog.getById(input.documentId)
      if (!existing) {
        throw new TerminalOpenError(
          "cloud-materialization-failed",
          `Cloud catalog record ${input.documentId} disappeared`,
        )
      }
      const record = await catalog.registerBinding({
        document: { ...existing, localPresent: true, syncStatus: "synced" },
        binding: {
          documentId: input.documentId,
          bindingRootId: snapshot.bindingRootId,
          relativePath: file.relativePath,
          canonicalPath: file.path,
          inode: file.inode || null,
          contentHash: file.contentHash || null,
          size: file.size,
          lastSeenAt: file.modifiedAt,
        },
      })

      return record
    }

    // Writing the `.md` and its manifest/catalog binding is filesystem/IPC I/O:
    // a transient failure here (disk momentarily busy, IPC hiccup) is worth one
    // more attempt rather than surfacing an unrecoverable materialization.
    return asRetryable("cloud-materialization-failed", async () => {
      const existingFiles = await tauriListRecentFiles(root.rootPath, 5000)
      const filename = resolveUniqueFilename(
        titleToFilename(materializedWriting.title?.trim() || "Untitled"),
        existingFiles.map((file) => file.name),
      )
      const canonicalPath = await join(root.rootPath, filename)

      // Content commit first. The following workspace_sync persists the binding
      // manifest atomically with the cloud UUID override; only then may SQLite be
      // updated (spec §Guardado).
      await tauriWriteFile(canonicalPath, markdown)
      const snapshot = await tauriWorkspaceSync(
        root.rootPath,
        root.kind === "external"
          ? Array.from(new Set([...root.selectedPaths, filename]))
          : undefined,
        { [filename]: input.documentId },
      )
      if (root.kind === "external") {
        await settings.upsertBindingRoot({
          ...root,
          selectedPaths: snapshot.selectedPaths,
        })
      }
      const file = snapshot.files.find((entry) => entry.relativePath === filename)
      if (!file || file.id !== input.documentId) {
        throw new RetryableOpenError(
          "cloud-materialization-failed",
          `Materialized file ${filename} was not bound to ${input.documentId}`,
        )
      }

      return registerMaterializedFile(snapshot, file)
    })
  }

  const openDocument = createOpenDocumentUseCase({
    catalog: {
      // SQLite access is out-of-process IPC (Tauri command) — a lock/busy DB or
      // a dropped IPC round-trip is transient, not a reason to give up on this
      // open attempt.
      getById: (id) => asRetryable("catalog-unavailable", () => catalog.getById(id)),
      resolvePath: (path) => asRetryable("catalog-unavailable", () => catalog.resolvePath(path)),
      registerBinding: (registerInput) =>
        asRetryable("catalog-unavailable", () => catalog.registerBinding(registerInput)),
    },
    readFileEvidence,
    locateBindingRoot,
    registerExternalRoot,
    listKnownBindings,
    materializeCloudOnly,
    cloudHashLookup: async (contentHash) => {
      const { data, error } = await createDesktopClient().auth.getSession()
      if (error || !data.session?.user.id) return null
      const candidates = await tauriCatalogFindEligibleCloudHash(
        catalog.dbPath,
        contentHash,
        data.session.user.id,
      )
      return candidates.length === 1 ? candidates[0] : candidates.length > 1 ? "ambiguous" : null
    },
  })

  return { openDocument, settings, configDir }
}

let useCasePromise: ReturnType<typeof buildDesktopOpenDocumentUseCase> | null = null

function getDesktopOpenDocumentUseCase() {
  if (!useCasePromise) {
    useCasePromise = buildDesktopOpenDocumentUseCase()
  }
  return useCasePromise
}

/**
 * Desktop opener bound to the SQLite catalog (ODE-375 M3). Runs the pure use case;
 * it never seeds an empty draft — the editor hydrates the resolved UUID by reading
 * the authoritative `.md` through DocumentService.openWriting, which resolves the
 * canonical path from the catalog. There is no IndexedDB fallback: an id absent
 * from SQLite is orphaned and never creates durable state.
 */
export async function openDesktopDocument(
  input: OpenDocumentInput,
): Promise<OpenDocumentResult> {
  const { openDocument } = await getDesktopOpenDocumentUseCase()
  return openDocument(input)
}

export { MANAGED_ROOT_DIRNAME }
