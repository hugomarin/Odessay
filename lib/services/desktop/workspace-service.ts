"use client";

import { appConfigDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import {
  filenameToTitle,
  UNTITLED_DOCUMENT_NAME,
} from "@/lib/desktop/document-naming";
import { openDesktopDocument } from "@/lib/services/desktop/open-document-desktop";
import {
  markDesktopWritingDeletedByCanonicalPath,
  relocateDesktopWritingByCanonicalPath,
} from "@/lib/services/document-service-factory";
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service";
import { refreshWorkspaceReconcilerRoots } from "./desktop-workspace-reconciler";
import {
  isOdessayInternalPath,
  isOdessaySelfWriteEvent,
  watchFsPaths,
  type TauriWatchEvent,
  type UnwatchFn,
} from "@/lib/services/desktop/tauri-fs-watch";
import {
  tauriCreateFile,
  tauriOpenFile,
  tauriWriteFile,
  tauriWorkspaceCreate,
  tauriWorkspaceSync,
  type DesktopWorkspaceSnapshot,
} from "@/lib/services/desktop/tauri-commands";
import type {
  WorkspaceDetail,
  WorkspaceFile,
  WorkspaceLayout,
  WorkspaceRecord,
  WorkspaceStatus,
  WorkspaceSummary,
} from "@/lib/workspace/types";
import {
  pruneAssignments,
  readAssignmentSlug,
  withAssignment,
  withoutAssignment,
  type WorkspaceAssignmentMap,
  type WorkspaceAssignmentOption,
} from "@/lib/workspace/assignment";

const MAX_PREVIEW_LENGTH = 420;

let workspaceServicePromise: Promise<DesktopWorkspaceService> | null = null;

function slugifyWorkspaceName(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "workspace";
}

function joinDesktopPath(basePath: string, relativePath: string) {
  const normalizedBase = basePath.replace(/[\\/]+$/, "");
  const normalizedRelative = relativePath.replace(/^[\\/]+/, "");
  return normalizedRelative
    ? `${normalizedBase}/${normalizedRelative}`
    : normalizedBase;
}

function formatWorkspaceFromSnapshot(
  record: WorkspaceRecord,
  snapshot: DesktopWorkspaceSnapshot,
): WorkspaceDetail {
  return {
    slug: record.slug,
    name: record.name,
    rootPath: record.rootPath,
    selectedPaths: snapshot.selectedPaths,
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
  };
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
    selectedPaths: [],
    source: record.source,
    status,
    missingReason: reason,
    addedAt: record.addedAt,
    lastOpenedAt: record.lastOpenedAt,
    fileCount: 0,
    folderCount: 0,
    updatedAt: null,
    files: [],
  };
}

function buildInitialWorkspaceMarkdown(title: string): string {
  const heading = `# ${title.trim() || UNTITLED_DOCUMENT_NAME}\n\n`;
  return heading;
}

function ensureMarkdownName(fileName: string) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.endsWith(".md") || trimmed.endsWith(".txt")) {
    return trimmed;
  }

  return `${trimmed}.md`;
}

async function reconcileWorkspaceSnapshot(
  previousSnapshot: DesktopWorkspaceSnapshot | null,
  nextSnapshot: DesktopWorkspaceSnapshot,
) {
  if (!previousSnapshot) {
    return;
  }

  const nextFilesById = new Map(
    nextSnapshot.files.map((file) => [file.id, file]),
  );

  for (const previousFile of previousSnapshot.files) {
    const nextFile = nextFilesById.get(previousFile.id);

    if (nextFile && nextFile.path !== previousFile.path) {
      await relocateDesktopWritingByCanonicalPath(
        previousFile.path,
        nextFile.path,
      );
      continue;
    }

    if (!nextFile) {
      await markDesktopWritingDeletedByCanonicalPath(previousFile.path);
    }
  }
}

export class DesktopWorkspaceService {
  constructor(private readonly settingsService: DesktopSettingsService) {}

  async pickExistingWorkspaceRoot(): Promise<string | null> {
    const selected = await open({ directory: true, multiple: false });
    return selected && typeof selected === "string" ? selected : null;
  }

  async inspectWorkspace(rootPath: string): Promise<DesktopWorkspaceSnapshot> {
    return tauriWorkspaceSync(rootPath);
  }

  private async readRecords(): Promise<WorkspaceRecord[]> {
    const result = await this.settingsService.getDesktopSettings();
    const workspaces = result.data?.workspaces ?? [];
    return Array.isArray(workspaces) ? workspaces : [];
  }

  private async writeRecords(records: WorkspaceRecord[]) {
    await this.settingsService.updateDesktopSettings({ workspaces: records });
  }

  async getLayout(): Promise<WorkspaceLayout> {
    const result = await this.settingsService.getDesktopSettings();
    return result.data?.workspaceLayout === "list" ? "list" : "grid";
  }

  async setLayout(layout: WorkspaceLayout) {
    await this.settingsService.updateDesktopSettings({
      workspaceLayout: layout,
    });
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const records = await this.readRecords();
    const snapshots = await Promise.all(
      records.map(async (record) => {
        try {
          const snapshot = await tauriWorkspaceSync(record.rootPath);
          return formatWorkspaceFromSnapshot(record, snapshot);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Workspace folder is unavailable";
          return formatMissingWorkspace(record, message);
        }
      }),
    );

    return snapshots
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "ready" ? -1 : 1;
        }

        const leftValue = left.lastOpenedAt
          ? new Date(left.lastOpenedAt).getTime()
          : (left.updatedAt ?? 0);
        const rightValue = right.lastOpenedAt
          ? new Date(right.lastOpenedAt).getTime()
          : (right.updatedAt ?? 0);
        return rightValue - leftValue;
      })
      .map((workspace) => ({
        slug: workspace.slug,
        name: workspace.name,
        rootPath: workspace.rootPath,
        selectedPaths: workspace.selectedPaths,
        source: workspace.source,
        status: workspace.status,
        missingReason: workspace.missingReason,
        addedAt: workspace.addedAt,
        lastOpenedAt: workspace.lastOpenedAt,
        fileCount: workspace.fileCount,
        folderCount: workspace.folderCount,
        updatedAt: workspace.updatedAt,
      }));
  }

  async getWorkspace(slug: string): Promise<WorkspaceDetail | null> {
    const records = await this.readRecords();
    const record = records.find((candidate) => candidate.slug === slug);
    if (!record) {
      return null;
    }

    try {
      const snapshot = await tauriWorkspaceSync(record.rootPath);
      return formatWorkspaceFromSnapshot(record, snapshot);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Workspace folder is unavailable";
      return formatMissingWorkspace(record, message);
    }
  }

  async addExistingWorkspace(): Promise<WorkspaceRecord | null> {
    const rootPath = await this.pickExistingWorkspaceRoot();
    if (!rootPath) {
      return null;
    }

    return this.registerWorkspace(rootPath, "existing-folder");
  }

  async addExistingWorkspaceWithSelection(
    rootPath: string,
    selectedPaths: string[],
  ): Promise<WorkspaceRecord | null> {
    return this.registerWorkspace(
      rootPath,
      "existing-folder",
      undefined,
      selectedPaths,
    );
  }

  async createWorkspace(name: string): Promise<WorkspaceRecord | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose location",
    });
    if (!selected || typeof selected !== "string") {
      return null;
    }

    const rootPath = await tauriWorkspaceCreate(selected, name.trim());
    return this.registerWorkspace(rootPath, "scratch", name.trim());
  }

  private async registerWorkspace(
    rootPath: string,
    source: WorkspaceRecord["source"],
    explicitName?: string,
    selectedPaths?: string[],
  ): Promise<WorkspaceRecord> {
    const records = await this.readRecords();
    const existing = records.find((record) => record.rootPath === rootPath);
    const snapshot = await tauriWorkspaceSync(rootPath, selectedPaths);

    const nowIso = new Date().toISOString();
    const bindingRoots = await this.settingsService.getBindingRoots();
    const existingBindingRoot = bindingRoots.find(
      (root) =>
        root.id === snapshot.bindingRootId || root.rootPath === snapshot.rootPath,
    );
    await this.settingsService.upsertBindingRoot({
      id: snapshot.bindingRootId,
      rootPath: snapshot.rootPath,
      kind: "external",
      visibleAsWorkspace: true,
      selectedPaths: snapshot.selectedPaths,
      consentedAt: existingBindingRoot?.consentedAt ?? nowIso,
      createdAt: existingBindingRoot?.createdAt ?? nowIso,
    });

    if (existing) {
      await refreshWorkspaceReconcilerRoots();
      return existing;
    }

    const baseName = explicitName?.trim() || snapshot.name;
    const baseSlug = slugifyWorkspaceName(baseName);
    let slug = baseSlug;
    let suffix = 2;

    while (records.some((record) => record.slug === slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const nextRecord: WorkspaceRecord = {
      slug,
      name: baseName,
      rootPath,
      source,
      addedAt: nowIso,
      lastOpenedAt: null,
    };

    await this.writeRecords([...records, nextRecord]);
    await refreshWorkspaceReconcilerRoots();
    return nextRecord;
  }

  async openFileInEditor(
    filePath: string,
    workspaceFileId: string,
  ): Promise<string> {
    const result = await openDesktopDocument({ kind: "path", path: filePath });
    if (result.status !== "opened") {
      throw new Error(`Unable to reconcile workspace document: ${result.status}`);
    }
    if (result.documentId !== workspaceFileId) {
      throw new Error("Workspace manifest and catalog resolved different document identities");
    }
    return result.documentId;
  }

  async readFilePreview(filePath: string) {
    const content = await tauriOpenFile(filePath);
    const preview = content.trim().slice(0, MAX_PREVIEW_LENGTH);
    return { content, preview };
  }

  async createFile(
    workspace: WorkspaceDetail,
    fileName: string,
  ): Promise<WorkspaceFile> {
    const normalizedName = ensureMarkdownName(fileName);
    if (!normalizedName) {
      throw new Error("File name is required");
    }

    const expectedPath = joinDesktopPath(workspace.rootPath, normalizedName);
    const title = filenameToTitle(normalizedName);
    const initialMarkdown = buildInitialWorkspaceMarkdown(title);

    await tauriCreateFile(workspace.rootPath, normalizedName);
    await tauriWriteFile(expectedPath, initialMarkdown);

    const refreshed = await this.getWorkspace(workspace.slug);
    if (!refreshed) {
      throw new Error("Workspace not found after creating file");
    }

    const file = refreshed.files.find(
      (candidate) => candidate.path === expectedPath,
    );
    if (!file) {
      throw new Error(`New file was not found after refresh: ${expectedPath}`);
    }

    return file;
  }

  async markWorkspaceOpened(slug: string): Promise<void> {
    const records = await this.readRecords();
    const nowIso = new Date().toISOString();
    const nextRecords = records.map((record) =>
      record.slug === slug ? { ...record, lastOpenedAt: nowIso } : record,
    );
    await this.writeRecords(nextRecords);
  }

  async renameWorkspace(
    slug: string,
    nextName: string,
  ): Promise<WorkspaceRecord> {
    const normalizedName = nextName.trim();
    if (!normalizedName) {
      throw new Error("Workspace name is required");
    }

    const records = await this.readRecords();
    const target = records.find((record) => record.slug === slug);
    if (!target) {
      throw new Error("Workspace not found");
    }

    const nextRecords = records.map((record) =>
      record.slug === slug ? { ...record, name: normalizedName } : record,
    );
    await this.writeRecords(nextRecords);

    return { ...target, name: normalizedName };
  }

  async removeWorkspace(slug: string): Promise<void> {
    const records = await this.readRecords();
    const nextRecords = records.filter((record) => record.slug !== slug);
    await this.writeRecords(nextRecords);

    // Keep assignments honest: a writing can no longer point at a removed
    // workspace. The file itself is untouched ("files in place").
    const assignments = await this.readAssignments();
    const pruned = pruneAssignments(
      assignments,
      nextRecords.map((record) => record.slug),
    );
    await this.writeAssignments(pruned);
  }

  // ─── Document ↔ workspace assignment (contextual ownership) ─────────────────
  //
  // The assignment is logical metadata: it records which workspace a writing
  // belongs to without moving the underlying file or exposing local paths.

  private async readAssignments(): Promise<WorkspaceAssignmentMap> {
    const result = await this.settingsService.getDesktopSettings();
    const assignments = result.data?.workspaceAssignments;
    return assignments && typeof assignments === "object" ? assignments : {};
  }

  private async writeAssignments(assignments: WorkspaceAssignmentMap) {
    await this.settingsService.updateDesktopSettings({
      workspaceAssignments: assignments,
    });
  }

  /** Lists registered workspaces as lightweight assignment targets (no FS sync). */
  async listAssignableWorkspaces(): Promise<WorkspaceAssignmentOption[]> {
    const records = await this.readRecords();
    return records.map((record) => ({
      slug: record.slug,
      name: record.name,
      rootPath: record.rootPath,
    }));
  }

  /** Returns the full writing id → workspace slug map for the current account. */
  async listAssignments(): Promise<WorkspaceAssignmentMap> {
    const [assignments, records] = await Promise.all([
      this.readAssignments(),
      this.readRecords(),
    ]);

    // Never surface assignments that point at workspaces that no longer exist.
    return pruneAssignments(
      assignments,
      records.map((record) => record.slug),
    );
  }

  /** Returns the current workspace slug for a writing, or null when unassigned. */
  async getAssignment(writingId: string): Promise<string | null> {
    const assignments = await this.readAssignments();
    return readAssignmentSlug(assignments, writingId);
  }

  /**
   * Assigns (or moves) a writing to an existing workspace. Single-valued, so a
   * move simply replaces the previous slug. Does not touch the file on disk.
   */
  async assignToWorkspace(writingId: string, slug: string): Promise<void> {
    const records = await this.readRecords();
    if (!records.some((record) => record.slug === slug)) {
      throw new Error(`Unknown workspace: ${slug}`);
    }

    const assignments = await this.readAssignments();
    await this.writeAssignments(withAssignment(assignments, writingId, slug));
  }

  /** Removes any workspace assignment for a writing. The file stays in place. */
  async clearAssignment(writingId: string): Promise<void> {
    const assignments = await this.readAssignments();
    await this.writeAssignments(withoutAssignment(assignments, writingId));
  }

  async watchWorkspace(
    rootPath: string,
    selectedPaths: string[],
    onChange: () => void,
  ): Promise<UnwatchFn> {
    let previousSnapshot: DesktopWorkspaceSnapshot | null = null;
    let reconcilePromise = Promise.resolve();

    try {
      previousSnapshot = await tauriWorkspaceSync(rootPath);
    } catch {
      previousSnapshot = null;
    }

    const watchedPaths = await resolveWorkspaceWatchPaths(
      rootPath,
      selectedPaths,
    );

    console.log("[workspace:watch] starting watcher for", watchedPaths);

    return watchFsPaths(
      watchedPaths,
      (event) => {
        if (shouldIgnoreWorkspaceWatchEvent(event)) {
          console.log(
            "[workspace:watch] ignored event",
            event.type,
            event.paths,
          );
          return;
        }

        console.log(
          "[workspace:watch] event received",
          event.type,
          event.paths,
        );

        reconcilePromise = reconcilePromise
          .catch(() => undefined)
          .then(async () => {
            let nextSnapshot: DesktopWorkspaceSnapshot | null = null;

            try {
              nextSnapshot = await tauriWorkspaceSync(rootPath);
            } catch {
              nextSnapshot = null;
            }

            if (nextSnapshot) {
              await reconcileWorkspaceSnapshot(previousSnapshot, nextSnapshot);
            }

            previousSnapshot = nextSnapshot;
            console.log("[workspace:watch] calling onChange after sync");
            onChange();
          });
      },
      { recursive: true, delayMs: 300 },
    );
  }

  async watchWorkspaces(
    workspaces: Array<Pick<WorkspaceSummary, "rootPath" | "selectedPaths">>,
    onChange: () => void,
  ): Promise<UnwatchFn> {
    const uniqueWorkspaces = Array.from(
      new Map(
        workspaces
          .filter((workspace) => workspace.rootPath)
          .map((workspace) => [workspace.rootPath, workspace]),
      ).values(),
    );
    const rootPaths = uniqueWorkspaces.map((workspace) => workspace.rootPath);
    const snapshotByRoot = new Map<string, DesktopWorkspaceSnapshot | null>();
    let reconcilePromise = Promise.resolve();

    await Promise.all(
      rootPaths.map(async (rootPath) => {
        try {
          snapshotByRoot.set(rootPath, await tauriWorkspaceSync(rootPath));
        } catch {
          snapshotByRoot.set(rootPath, null);
        }
      }),
    );

    const watchedPaths = (
      await Promise.all(
        uniqueWorkspaces.map((workspace) =>
          resolveWorkspaceWatchPaths(
            workspace.rootPath,
            workspace.selectedPaths,
          ),
        ),
      )
    ).flat();

    return watchFsPaths(
      Array.from(new Set(watchedPaths)),
      (event) => {
        if (shouldIgnoreWorkspaceWatchEvent(event)) {
          return;
        }

        reconcilePromise = reconcilePromise
          .catch(() => undefined)
          .then(async () => {
            const changedRoots = rootPaths.filter((rootPath) =>
              event.paths.some(
                (path) => path === rootPath || path.startsWith(`${rootPath}/`),
              ),
            );

            await Promise.all(
              changedRoots.map(async (rootPath) => {
                const previousSnapshot = snapshotByRoot.get(rootPath) ?? null;
                let nextSnapshot: DesktopWorkspaceSnapshot | null = null;

                try {
                  nextSnapshot = await tauriWorkspaceSync(rootPath);
                } catch {
                  nextSnapshot = null;
                }

                if (nextSnapshot) {
                  await reconcileWorkspaceSnapshot(
                    previousSnapshot,
                    nextSnapshot,
                  );
                }

                snapshotByRoot.set(rootPath, nextSnapshot);
              }),
            );

            onChange();
          });
      },
      { recursive: true, delayMs: 700 },
    );
  }
}

async function resolveWorkspaceWatchPaths(
  rootPath: string,
  selectedPaths: string[],
) {
  if (!selectedPaths.length) {
    return [rootPath];
  }

  const watchedPaths = selectedPaths.map((selectedPath) =>
    joinDesktopPath(rootPath, selectedPath),
  );
  return Array.from(new Set(watchedPaths));
}

function shouldIgnoreWorkspaceWatchEvent(event: TauriWatchEvent) {
  if (!event.paths.some((path) => !isOdessayInternalPath(path))) {
    return true;
  }

  if (isOdessaySelfWriteEvent(event)) {
    return true;
  }

  if (event.type === "any" || event.type === "other") {
    return false;
  }

  if ("access" in event.type) {
    const accessKind = event.type.access.kind;
    return accessKind === "open" || accessKind === "close";
  }

  return false;
}

export async function getDesktopWorkspaceService() {
  if (!workspaceServicePromise) {
    workspaceServicePromise = appConfigDir().then((configDir) => {
      return new DesktopWorkspaceService(new DesktopSettingsService(configDir));
    });
  }

  return workspaceServicePromise;
}
