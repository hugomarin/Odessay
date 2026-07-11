"use client"

import { appConfigDir, join } from "@tauri-apps/api/path"
import { EMPTY_EDITOR_JSON } from "@/lib/editor/extensions"
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
    const bindingRootId = globalThis.crypto.randomUUID()
    const nowIso = new Date().toISOString()

    // Acceptance registers the parent folder as an external root whose scope is
    // limited to just this file — never the whole folder (spec §Archivo fuera de
    // un BindingRoot; requirement 3, selectedPaths exact-file).
    await settings.upsertBindingRoot({
      id: bindingRootId,
      rootPath: input.parentDir,
      kind: "external",
      visibleAsWorkspace: false,
      selectedPaths: [relativePath],
      consentedAt: nowIso,
      createdAt: nowIso,
    })

    // Materialize the manifest for the new scope so identity survives restarts.
    await tauriWorkspaceSync(input.parentDir, [relativePath])

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
 * Non-destructive hydration mapping. The editor still hydrates through
 * DocumentService.openWriting(uuid) in M3 (the SQLite-backed openWriting is M4),
 * so it needs an id → canonical_path mapping to read the `.md`. This upserts that
 * mapping WITHOUT deleting other records or clearing sync-queue state — the exact
 * destructive rebind that ODE-375 removes from Workspace (failure mode: "Workspace
 * deletes pending queue state while rebinding by path"). Body/title come from the
 * file on open, so only the path mapping is seeded here.
 */
async function ensureHydrationMapping(
  record: DocumentCatalogRecord,
): Promise<void> {
  const canonicalPath = record.binding?.canonicalPath
  if (!canonicalPath) return

  const existing = await localDB.writings.get(record.id)
  if (existing) {
    if (existing.canonical_path !== canonicalPath) {
      await localDB.writings.save({
        ...existing,
        canonical_path: canonicalPath,
        local_updated_at: Date.now(),
      })
    }
    return
  }

  const nowIso = new Date().toISOString()
  await localDB.writings.save({
    id: record.id,
    canonical_path: canonicalPath,
    body_json: EMPTY_EDITOR_JSON,
    body_text: "",
    title: record.title ?? filenameToTitle(canonicalPath),
    status: "draft",
    visibility: "private",
    version: 1,
    sync_status: "synced",
    lifecycle: "local-only",
    created_at: nowIso,
    updated_at: nowIso,
    local_updated_at: Date.now(),
  })
}

let useCasePromise: ReturnType<typeof buildDesktopOpenDocumentUseCase> | null = null

function getDesktopOpenDocumentUseCase() {
  if (!useCasePromise) {
    useCasePromise = buildDesktopOpenDocumentUseCase()
  }
  return useCasePromise
}

/**
 * Desktop opener bound to the SQLite catalog (ODE-375 M3). Runs the pure use case
 * and, on a successful open, seeds the non-destructive hydration mapping so the
 * editor can read the `.md` for the resolved UUID.
 */
export async function openDesktopDocument(
  input: OpenDocumentInput,
): Promise<OpenDocumentResult> {
  const { openDocument } = await getDesktopOpenDocumentUseCase()
  const result = await openDocument(input)
  if (result.status === "opened") {
    await ensureHydrationMapping(result.record)
  }
  return result
}

export { MANAGED_ROOT_DIRNAME }
