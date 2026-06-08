"use client"

import { appConfigDir } from "@tauri-apps/api/path"
import { open } from "@tauri-apps/plugin-dialog"
import { localDB } from "@/lib/local-db"
import { getDocumentService } from "@/lib/services/document-service-factory"
import {
  markDesktopWritingDeletedByCanonicalPath,
  relocateDesktopWritingByCanonicalPath,
} from "@/lib/services/document-service-factory"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"
import {
  isOdysseyInternalPath,
  watchFsPaths,
  type TauriWatchEvent,
  type UnwatchFn,
} from "@/lib/services/desktop/tauri-fs-watch"
import {
  tauriCreateFile,
  tauriOpenFile,
  tauriWorkspaceCreate,
  tauriWorkspaceSync,
  type DesktopWorkspaceSnapshot,
} from "@/lib/services/desktop/tauri-commands"
import type {
  WorkspaceDetail,
  WorkspaceFile,
  WorkspaceLayout,
  WorkspaceRecord,
  WorkspaceStatus,
  WorkspaceSummary,
} from "@/lib/workspace/types"

const MAX_PREVIEW_LENGTH = 420

let workspaceServicePromise: Promise<DesktopWorkspaceService> | null = null

function slugifyWorkspaceName(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || "workspace"
}

function formatWorkspaceFromSnapshot(
  record: WorkspaceRecord,
  snapshot: DesktopWorkspaceSnapshot,
): WorkspaceDetail {
  return {
    slug: record.slug,
    name: record.name,
    rootPath: record.rootPath,
    source: record.source,
    status: "ready",
    missingReason: null,
    addedAt: record.addedAt,
    lastOpenedAt: record.lastOpenedAt,
    fileCount: snapshot.fileCount,
    folderCount: snapshot.folderCount,
    updatedAt: snapshot.updatedAt,
    files: snapshot.files.map((file) => ({
      id: file.id,
      path: file.path,
      relativePath: file.relativePath,
      name: file.name,
      modifiedAt: file.modifiedAt,
      size: file.size,
      inode: file.inode,
    })),
  }
}

function formatMissingWorkspace(
  record: WorkspaceRecord,
  reason: string,
  status: WorkspaceStatus = "missing",
): WorkspaceDetail {
  return {
    slug: record.slug,
    name: record.name,
    rootPath: record.rootPath,
    source: record.source,
    status,
    missingReason: reason,
    addedAt: record.addedAt,
    lastOpenedAt: record.lastOpenedAt,
    fileCount: 0,
    folderCount: 0,
    updatedAt: null,
    files: [],
  }
}

function ensureMarkdownName(fileName: string) {
  const trimmed = fileName.trim()
  if (!trimmed) {
    return ""
  }

  if (trimmed.endsWith(".md") || trimmed.endsWith(".txt")) {
    return trimmed
  }

  return `${trimmed}.md`
}

async function reconcileWorkspaceSnapshot(
  previousSnapshot: DesktopWorkspaceSnapshot | null,
  nextSnapshot: DesktopWorkspaceSnapshot,
) {
  if (!previousSnapshot) {
    return
  }

  const nextFilesById = new Map(nextSnapshot.files.map((file) => [file.id, file]))

  for (const previousFile of previousSnapshot.files) {
    const nextFile = nextFilesById.get(previousFile.id)

    if (nextFile && nextFile.path !== previousFile.path) {
      await relocateDesktopWritingByCanonicalPath(previousFile.path, nextFile.path)
      continue
    }

    if (!nextFile) {
      await markDesktopWritingDeletedByCanonicalPath(previousFile.path)
    }
  }
}

export class DesktopWorkspaceService {
  constructor(private readonly settingsService: DesktopSettingsService) {}

  private async readRecords(): Promise<WorkspaceRecord[]> {
    const result = await this.settingsService.getDesktopSettings()
    const workspaces = result.data?.workspaces ?? []
    return Array.isArray(workspaces) ? workspaces : []
  }

  private async writeRecords(records: WorkspaceRecord[]) {
    await this.settingsService.updateDesktopSettings({ workspaces: records })
  }

  async getLayout(): Promise<WorkspaceLayout> {
    const result = await this.settingsService.getDesktopSettings()
    return result.data?.workspaceLayout === "list" ? "list" : "grid"
  }

  async setLayout(layout: WorkspaceLayout) {
    await this.settingsService.updateDesktopSettings({ workspaceLayout: layout })
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const records = await this.readRecords()
    const snapshots = await Promise.all(
      records.map(async (record) => {
        try {
          const snapshot = await tauriWorkspaceSync(record.rootPath)
          return formatWorkspaceFromSnapshot(record, snapshot)
        } catch (error) {
          const message = error instanceof Error ? error.message : "Workspace folder is unavailable"
          return formatMissingWorkspace(record, message)
        }
      }),
    )

    return snapshots
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "ready" ? -1 : 1
        }

        const leftValue = left.lastOpenedAt ? new Date(left.lastOpenedAt).getTime() : left.updatedAt ?? 0
        const rightValue = right.lastOpenedAt ? new Date(right.lastOpenedAt).getTime() : right.updatedAt ?? 0
        return rightValue - leftValue
      })
      .map((workspace) => ({
        slug: workspace.slug,
        name: workspace.name,
        rootPath: workspace.rootPath,
        source: workspace.source,
        status: workspace.status,
        missingReason: workspace.missingReason,
        addedAt: workspace.addedAt,
        lastOpenedAt: workspace.lastOpenedAt,
        fileCount: workspace.fileCount,
        folderCount: workspace.folderCount,
        updatedAt: workspace.updatedAt,
      }))
  }

  async getWorkspace(slug: string): Promise<WorkspaceDetail | null> {
    const records = await this.readRecords()
    const record = records.find((candidate) => candidate.slug === slug)
    if (!record) {
      return null
    }

    try {
      const snapshot = await tauriWorkspaceSync(record.rootPath)
      return formatWorkspaceFromSnapshot(record, snapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace folder is unavailable"
      return formatMissingWorkspace(record, message)
    }
  }

  async addExistingWorkspace(): Promise<WorkspaceRecord | null> {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== "string") {
      return null
    }

    return this.registerWorkspace(selected, "existing-folder")
  }

  async createWorkspace(name: string): Promise<WorkspaceRecord | null> {
    const selected = await open({ directory: true, multiple: false, title: "Choose location" })
    if (!selected || typeof selected !== "string") {
      return null
    }

    const rootPath = await tauriWorkspaceCreate(selected, name.trim())
    return this.registerWorkspace(rootPath, "scratch", name.trim())
  }

  private async registerWorkspace(
    rootPath: string,
    source: WorkspaceRecord["source"],
    explicitName?: string,
  ): Promise<WorkspaceRecord> {
    const records = await this.readRecords()
    const existing = records.find((record) => record.rootPath === rootPath)
    const snapshot = await tauriWorkspaceSync(rootPath)

    if (existing) {
      return existing
    }

    const baseName = explicitName?.trim() || snapshot.name
    const baseSlug = slugifyWorkspaceName(baseName)
    let slug = baseSlug
    let suffix = 2

    while (records.some((record) => record.slug === slug)) {
      slug = `${baseSlug}-${suffix}`
      suffix += 1
    }

    const nowIso = new Date().toISOString()
    const nextRecord: WorkspaceRecord = {
      slug,
      name: baseName,
      rootPath,
      source,
      addedAt: nowIso,
      lastOpenedAt: null,
    }

    await this.writeRecords([...records, nextRecord])
    return nextRecord
  }

  async openFileInEditor(filePath: string): Promise<string> {
    const documentService = await getDocumentService()
    const openResult = await documentService.openWriting(filePath)
    if (openResult.error) {
      throw new Error(openResult.error.message)
    }

    const localWriting =
      (await localDB.writings.getByCanonicalPath(filePath)) ??
      (await localDB.writings.get(openResult.data?.id ?? filePath))

    return localWriting?.id ?? openResult.data?.id ?? filePath
  }

  async readFilePreview(filePath: string) {
    const content = await tauriOpenFile(filePath)
    const preview = content.trim().slice(0, MAX_PREVIEW_LENGTH)
    return { content, preview }
  }

  async createFile(workspace: WorkspaceDetail, fileName: string): Promise<WorkspaceFile> {
    const normalizedName = ensureMarkdownName(fileName)
    if (!normalizedName) {
      throw new Error("File name is required")
    }

    await tauriCreateFile(workspace.rootPath, normalizedName)
    const refreshed = await this.getWorkspace(workspace.slug)
    if (!refreshed) {
      throw new Error("Workspace not found after creating file")
    }

    const file = refreshed.files.find((candidate) => candidate.name === normalizedName)
    if (!file) {
      throw new Error("New file was not found after refresh")
    }

    return file
  }

  async markWorkspaceOpened(slug: string): Promise<void> {
    const records = await this.readRecords()
    const nowIso = new Date().toISOString()
    const nextRecords = records.map((record) =>
      record.slug === slug ? { ...record, lastOpenedAt: nowIso } : record,
    )
    await this.writeRecords(nextRecords)
  }

  async renameWorkspace(slug: string, nextName: string): Promise<WorkspaceRecord> {
    const normalizedName = nextName.trim()
    if (!normalizedName) {
      throw new Error("Workspace name is required")
    }

    const records = await this.readRecords()
    const target = records.find((record) => record.slug === slug)
    if (!target) {
      throw new Error("Workspace not found")
    }

    const nextRecords = records.map((record) =>
      record.slug === slug ? { ...record, name: normalizedName } : record,
    )
    await this.writeRecords(nextRecords)

    return { ...target, name: normalizedName }
  }

  async removeWorkspace(slug: string): Promise<void> {
    const records = await this.readRecords()
    const nextRecords = records.filter((record) => record.slug !== slug)
    await this.writeRecords(nextRecords)
  }

  async watchWorkspace(rootPath: string, onChange: () => void): Promise<UnwatchFn> {
    let previousSnapshot: DesktopWorkspaceSnapshot | null = null
    let reconcilePromise = Promise.resolve()

    try {
      previousSnapshot = await tauriWorkspaceSync(rootPath)
    } catch {
      previousSnapshot = null
    }

    console.log("[workspace:watch] starting watcher for", rootPath)

    return watchFsPaths(
      [rootPath],
      (event) => {
        if (shouldIgnoreWorkspaceWatchEvent(event)) {
          console.log("[workspace:watch] ignored event", event.type, event.paths)
          return
        }

        console.log("[workspace:watch] event received", event.type, event.paths)

        reconcilePromise = reconcilePromise
          .catch(() => undefined)
          .then(async () => {
            let nextSnapshot: DesktopWorkspaceSnapshot | null = null

            try {
              nextSnapshot = await tauriWorkspaceSync(rootPath)
            } catch {
              nextSnapshot = null
            }

            if (nextSnapshot) {
              await reconcileWorkspaceSnapshot(previousSnapshot, nextSnapshot)
            }

            previousSnapshot = nextSnapshot
            console.log("[workspace:watch] calling onChange after sync")
            onChange()
          })
      },
      { recursive: true, delayMs: 300 },
    )
  }

  async watchWorkspaces(rootPaths: string[], onChange: () => void): Promise<UnwatchFn> {
    const uniquePaths = Array.from(new Set(rootPaths.filter(Boolean)))
    const snapshotByRoot = new Map<string, DesktopWorkspaceSnapshot | null>()
    let reconcilePromise = Promise.resolve()

    await Promise.all(
      uniquePaths.map(async (rootPath) => {
        try {
          snapshotByRoot.set(rootPath, await tauriWorkspaceSync(rootPath))
        } catch {
          snapshotByRoot.set(rootPath, null)
        }
      }),
    )

    return watchFsPaths(
      uniquePaths,
      (event) => {
        if (shouldIgnoreWorkspaceWatchEvent(event)) {
          return
        }

        reconcilePromise = reconcilePromise
          .catch(() => undefined)
          .then(async () => {
            const changedRoots = uniquePaths.filter((rootPath) =>
              event.paths.some((path) => path === rootPath || path.startsWith(`${rootPath}/`)),
            )

            await Promise.all(
              changedRoots.map(async (rootPath) => {
                const previousSnapshot = snapshotByRoot.get(rootPath) ?? null
                let nextSnapshot: DesktopWorkspaceSnapshot | null = null

                try {
                  nextSnapshot = await tauriWorkspaceSync(rootPath)
                } catch {
                  nextSnapshot = null
                }

                if (nextSnapshot) {
                  await reconcileWorkspaceSnapshot(previousSnapshot, nextSnapshot)
                }

                snapshotByRoot.set(rootPath, nextSnapshot)
              }),
            )

            onChange()
          })
      },
      { recursive: true, delayMs: 700 },
    )
  }
}

function shouldIgnoreWorkspaceWatchEvent(event: TauriWatchEvent) {
  if (!event.paths.some((path) => !isOdysseyInternalPath(path))) {
    return true
  }

  if (event.type === "any" || event.type === "other") {
    return false
  }

  if ("access" in event.type) {
    const accessKind = event.type.access.kind
    return accessKind === "open" || accessKind === "close"
  }

  return false
}

export async function getDesktopWorkspaceService() {
  if (!workspaceServicePromise) {
    workspaceServicePromise = appConfigDir().then((configDir) => {
      return new DesktopWorkspaceService(new DesktopSettingsService(configDir))
    })
  }

  return workspaceServicePromise
}
