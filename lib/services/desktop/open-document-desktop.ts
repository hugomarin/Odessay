"use client"

import { appConfigDir, join } from "@tauri-apps/api/path"
import { filenameToTitle } from "@/lib/desktop/document-naming"
import { localDB } from "@/lib/local-db"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import { tauriWorkspaceSync } from "@/lib/services/desktop/tauri-commands"
import type { KnownBinding } from "@/lib/services/desktop/workspace-reconciler"
import {
  createOpenDocumentUseCase,
  type BindingRootLocation,
  type BindingRootMatch,
  type FileOpenEvidence,
  type OpenDocumentInput,
  type OpenDocumentResult,
} from "@/lib/services/open-document"

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

    return { bindingRootId, rootPath: input.parentDir, relativePath }
  }

  async function readFileEvidence(
    input: BindingRootMatch & { path: string },
  ): Promise<FileOpenEvidence> {
    const snapshot = await tauriWorkspaceSync(input.rootPath, [input.relativePath])
    const file =
      snapshot.files.find((entry) => entry.relativePath === input.relativePath) ??
      snapshot.files.find((entry) => entry.path === input.path)

    if (!file) {
      throw new Error(`File is not present in its BindingRoot: ${input.path}`)
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

  const openDocument = createOpenDocumentUseCase({
    catalog: {
      getById: (id) => catalog.getById(id),
      resolvePath: (path) => catalog.resolvePath(path),
      registerBinding: (registerInput) => catalog.registerBinding(registerInput),
    },
    readFileEvidence,
    locateBindingRoot,
    registerExternalRoot,
    listKnownBindings,
    // cloudHashLookup + materializeCloudOnly are owned by ODE-371; not wired here.
  })

  return { openDocument, settings, configDir }
}

/**
 * Non-authoritative projection of a legacy IndexedDB writing as a catalog record.
 *
 * The unified opener resolves identity through the SQLite catalog. During the
 * migration window (until IndexedDB is retired in ODE-376) a valid writing may
 * still live only in IndexedDB — e.g. one created before the catalog dual-write
 * landed. Reading that row lets `openDocument({id})` report `opened` instead of a
 * false `orphaned`, WITHOUT creating any new record or draft (spec Context Gap
 * action: keep IndexedDB as transitional, non-authoritative compatibility). It is
 * never written back and never becomes authoritative.
 */
function projectLegacyWriting(local: {
  id: string
  canonical_path?: string | null
  title?: string | null
  slug?: string | null
  status?: DocumentCatalogRecord["status"]
  visibility?: DocumentCatalogRecord["visibility"]
  version?: number | null
  lifecycle?: string
  author_id?: string | null
  created_at?: string
  updated_at?: string
}): DocumentCatalogRecord {
  const canonicalPath = local.canonical_path?.trim() || null
  return {
    id: local.id,
    localPresent: Boolean(canonicalPath),
    cloudPresent: local.lifecycle === "server-confirmed",
    cloudAccountId: local.author_id ?? null,
    syncStatus: canonicalPath ? "local-only" : "pending",
    title: local.title ?? null,
    slug: local.slug ?? null,
    status: local.status ?? null,
    artifactType: null,
    visibility: local.visibility ?? null,
    version: local.version ?? null,
    createdAt: local.created_at ? Date.parse(local.created_at) : null,
    modifiedAt: local.updated_at ? Date.parse(local.updated_at) : null,
    binding: null,
  }
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
 * canonical path from the catalog. The only exception is the transitional
 * IndexedDB read fallback for `id` opens described in `projectLegacyWriting`.
 */
export async function openDesktopDocument(
  input: OpenDocumentInput,
): Promise<OpenDocumentResult> {
  const { openDocument } = await getDesktopOpenDocumentUseCase()
  const result = await openDocument(input)

  if (input.kind === "id" && result.status === "orphaned") {
    const legacy = await localDB.writings.get(input.id)
    if (legacy) {
      return {
        status: "opened",
        documentId: legacy.id,
        record: projectLegacyWriting(legacy),
        strategy: "existing",
      }
    }
  }

  return result
}

export { MANAGED_ROOT_DIRNAME }
