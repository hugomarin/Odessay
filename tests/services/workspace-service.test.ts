/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkspaceNameLookup,
  pruneAssignments,
  readAssignmentSlug,
  withAssignment,
  withoutAssignment,
  type WorkspaceAssignmentMap,
} from "@/lib/workspace/assignment";

const tauriMocks = vi.hoisted(() => ({
  tauriCreateFile: vi.fn(),
  tauriOpenFile: vi.fn(),
  tauriWriteFile: vi.fn(),
  tauriWorkspaceCreate: vi.fn(),
  tauriWorkspaceInspect: vi.fn(),
  tauriWorkspaceRepairManifestBindings: vi.fn(async () => 0),
  tauriWorkspaceSync: vi.fn(),
  tauriCatalogList: vi.fn(async () => [] as unknown[]),
  tauriCatalogCountBindingRootDocuments: vi.fn(async () => ({ total: 0, cloud: 0 })),
  tauriCatalogListBindingRootDocuments: vi.fn(async () => [] as unknown[]),
  tauriCatalogApplyWorkspaceRemoval: vi.fn(async () => [] as string[]),
  tauriCatalogListRetiredBindingRoots: vi.fn(async () => [] as unknown[]),
  tauriCatalogActivateBindingRoot: vi.fn(async () => undefined),
  tauriCatalogReactivateBindingRoot: vi.fn(async () => [] as unknown[]),
  tauriCatalogBulkDualWrite: vi.fn(async () => [] as string[]),
}));
const reconcilerMocks = vi.hoisted(() => ({ refreshRoots: vi.fn() }));
const factoryMocks = vi.hoisted(() => ({
  relocateDesktopWriting: vi.fn(),
  getDesktopWritingCanonicalPath: vi.fn(),
}));

// The desktop workspace service imports Tauri + local-db modules at the top
// level. Stub them so the assignment methods (which only touch the injected
// settings service) can be exercised in isolation.
vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: vi.fn(async () => "/tmp/cfg"),
  join: vi.fn((...parts: string[]) => parts.join("/")),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));
vi.mock("@/lib/editor/extensions", () => ({
  EMPTY_EDITOR_JSON: { type: "doc" },
}));
vi.mock("@/lib/local-db", () => ({ localDB: {} }));
vi.mock("@/lib/services/document-service-factory", () => ({
  getDocumentService: vi.fn(),
  markDesktopWritingDeletedByCanonicalPath: vi.fn(),
  relocateDesktopWritingByCanonicalPath: vi.fn(),
  relocateDesktopWriting: factoryMocks.relocateDesktopWriting,
  getDesktopWritingCanonicalPath: factoryMocks.getDesktopWritingCanonicalPath,
}));
vi.mock("@/lib/services/desktop/open-document-desktop", () => ({
  MANAGED_ROOT_DIRNAME: "artifact-studio-managed",
  openDesktopDocument: vi.fn(),
}));
vi.mock("@/lib/services/desktop/tauri-fs-watch", () => ({
  isOdessayInternalPath: vi.fn(() => false),
  isOdessaySelfWriteEvent: vi.fn(() => false),
  watchFsPaths: vi.fn(),
}));
vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriCreateFile: tauriMocks.tauriCreateFile,
  tauriOpenFile: tauriMocks.tauriOpenFile,
  tauriWriteFile: tauriMocks.tauriWriteFile,
  tauriWorkspaceCreate: tauriMocks.tauriWorkspaceCreate,
  tauriWorkspaceInspect: tauriMocks.tauriWorkspaceInspect,
  tauriWorkspaceRepairManifestBindings: tauriMocks.tauriWorkspaceRepairManifestBindings,
  tauriWorkspaceSync: tauriMocks.tauriWorkspaceSync,
  tauriCatalogList: tauriMocks.tauriCatalogList,
  tauriCatalogCountBindingRootDocuments: tauriMocks.tauriCatalogCountBindingRootDocuments,
  tauriCatalogListBindingRootDocuments: tauriMocks.tauriCatalogListBindingRootDocuments,
  tauriCatalogApplyWorkspaceRemoval: tauriMocks.tauriCatalogApplyWorkspaceRemoval,
  tauriCatalogListRetiredBindingRoots: tauriMocks.tauriCatalogListRetiredBindingRoots,
  tauriCatalogActivateBindingRoot: tauriMocks.tauriCatalogActivateBindingRoot,
  tauriCatalogReactivateBindingRoot: tauriMocks.tauriCatalogReactivateBindingRoot,
  tauriCatalogBulkDualWrite: tauriMocks.tauriCatalogBulkDualWrite,
}));
vi.mock("@/lib/editor/document-serialization", () => ({
  parseDocumentFileToSnapshot: vi.fn((source: string) => ({
    metadata: null,
    markdown: source,
    snapshot: {
      markdown: source,
      bodyText: source.replace(/^#.*\n+/, "").trim(),
      bodyJson: { type: "doc" },
    },
  })),
}));
vi.mock("@/lib/services/desktop/desktop-workspace-reconciler", () => ({
  recoverInterruptedWorkspaceRemovals: vi.fn(async () => undefined),
  refreshWorkspaceReconcilerRoots: reconcilerMocks.refreshRoots,
}));

import { DesktopWorkspaceService } from "@/lib/services/desktop/workspace-service";
import type { DesktopCatalogDualWriteInput } from "@/lib/services/desktop/tauri-commands";
import type { WorkspaceDetail, WorkspaceRecord } from "@/lib/workspace/types";

describe("workspace assignment helpers", () => {
  it("reads the assigned slug, treating empty values as unassigned", () => {
    expect(readAssignmentSlug({ w1: "drafts" }, "w1")).toBe("drafts");
    expect(readAssignmentSlug({ w1: "" }, "w1")).toBeNull();
    expect(readAssignmentSlug(null, "w1")).toBeNull();
    expect(readAssignmentSlug({}, "missing")).toBeNull();
  });

  it("is single-valued: re-assigning replaces the previous slug", () => {
    const initial: WorkspaceAssignmentMap = { w1: "drafts" };
    const moved = withAssignment(initial, "w1", "letters");
    expect(moved).toEqual({ w1: "letters" });
    // original map is not mutated
    expect(initial).toEqual({ w1: "drafts" });
  });

  it("removes an assignment without touching others", () => {
    const map: WorkspaceAssignmentMap = { w1: "drafts", w2: "letters" };
    expect(withoutAssignment(map, "w1")).toEqual({ w2: "letters" });
    expect(withoutAssignment(map, "missing")).toEqual(map);
  });

  it("prunes assignments that point at removed workspaces", () => {
    const map: WorkspaceAssignmentMap = { w1: "drafts", w2: "letters" };
    expect(pruneAssignments(map, ["letters"])).toEqual({ w2: "letters" });
    expect(pruneAssignments(map, [])).toEqual({});
  });

  it("builds a slug → name lookup", () => {
    expect(
      buildWorkspaceNameLookup([
        { slug: "drafts", name: "Drafts" },
        { slug: "letters", name: "Letters" },
      ]),
    ).toEqual({ drafts: "Drafts", letters: "Letters" });
  });
});

type FakeStore = {
  workspaces?: WorkspaceRecord[];
  workspaceAssignments?: WorkspaceAssignmentMap;
  bindingRoots?: Array<{
    id: string;
    rootPath: string;
    kind: "managed" | "external";
    visibleAsWorkspace: boolean;
    selectedPaths: string[];
    consentedAt: string | null;
    createdAt: string;
  }>;
};

function createFakeSettingsService(initial: FakeStore = {}) {
  let store: FakeStore = { ...initial };
  return {
    getDesktopSettings: vi.fn(async () => ({ data: store, error: null })),
    updateDesktopSettings: vi.fn(async (patch: Partial<FakeStore>) => {
      store = { ...store, ...patch };
      return { data: store, error: null };
    }),
    getBindingRoots: vi.fn(async () => store.bindingRoots ?? []),
    upsertBindingRoot: vi.fn(async (record: NonNullable<FakeStore["bindingRoots"]>[number]) => {
      const roots = store.bindingRoots ?? [];
      const matches = (root: NonNullable<FakeStore["bindingRoots"]>[number]) =>
        root.id === record.id || root.rootPath === record.rootPath;
      store.bindingRoots = roots.some(matches)
        ? roots.map((root) => (matches(root) ? record : root))
        : [...roots, record];
    }),
    ensureManagedRoot: vi.fn(async (rootPath: string) => {
      const roots = store.bindingRoots ?? [];
      const existing = roots.find((root) => root.kind === "managed");
      if (existing) return existing;
      const managed = {
        id: "managed-root",
        rootPath,
        kind: "managed" as const,
        visibleAsWorkspace: false,
        selectedPaths: [],
        consentedAt: null,
        createdAt: "2026-06-01T00:00:00.000Z",
      };
      store.bindingRoots = [...roots, managed];
      return managed;
    }),
    get store() {
      return store;
    },
  };
}

const record = (slug: string, name: string): WorkspaceRecord => ({
  slug,
  name,
  rootPath: `/Users/me/${slug}`,
  source: "existing-folder",
  addedAt: "2026-06-01T00:00:00.000Z",
  lastOpenedAt: null,
});

describe("DesktopWorkspaceService assignments", () => {
  let settings: ReturnType<typeof createFakeSettingsService>;
  let service: DesktopWorkspaceService;

  beforeEach(() => {
    tauriMocks.tauriCreateFile.mockReset();
    tauriMocks.tauriOpenFile.mockReset();
    tauriMocks.tauriWriteFile.mockReset();
    tauriMocks.tauriWorkspaceCreate.mockReset();
    tauriMocks.tauriWorkspaceInspect.mockReset().mockResolvedValue({
      rootPath: "/Users/me/new-workspace",
      bindingRootId: "binding-root-from-manifest",
      name: "New Workspace",
      selectedPaths: [],
      fileCount: 2,
      folderCount: 0,
      updatedAt: 1,
      files: [
        { relativePath: "Included.md" },
        { relativePath: "Not selected.md" },
      ],
    });
    tauriMocks.tauriWorkspaceRepairManifestBindings.mockReset().mockResolvedValue(0);
    tauriMocks.tauriWorkspaceSync.mockReset();
    tauriMocks.tauriCatalogList.mockReset().mockResolvedValue([]);
    tauriMocks.tauriCatalogCountBindingRootDocuments.mockReset().mockResolvedValue({ total: 0, cloud: 0 });
    tauriMocks.tauriCatalogListBindingRootDocuments.mockReset().mockResolvedValue([]);
    tauriMocks.tauriCatalogApplyWorkspaceRemoval.mockReset().mockResolvedValue([]);
    tauriMocks.tauriCatalogListRetiredBindingRoots.mockReset().mockResolvedValue([]);
    tauriMocks.tauriCatalogActivateBindingRoot.mockReset().mockResolvedValue(undefined);
    tauriMocks.tauriCatalogReactivateBindingRoot.mockReset().mockResolvedValue([]);
    tauriMocks.tauriCatalogBulkDualWrite.mockReset().mockResolvedValue([]);
    reconcilerMocks.refreshRoots.mockReset();
    factoryMocks.relocateDesktopWriting.mockReset();
    // Default: the writing has no local file, so membership stays metadata-only.
    factoryMocks.getDesktopWritingCanonicalPath.mockReset().mockResolvedValue(null);
    settings = createFakeSettingsService({
      workspaces: [record("drafts", "Drafts"), record("letters", "Letters")],
    });
    // The constructor only stores the settings service; cast through unknown to
    // satisfy the nominal DesktopSettingsService type for the test double.
    service = new DesktopWorkspaceService(settings as unknown as never);
  });

  it("registers an adopted Workspace as a visible BindingRoot and refreshes the global reconciler", async () => {
    tauriMocks.tauriWorkspaceSync.mockResolvedValue({
      rootPath: "/Users/me/new-workspace",
      bindingRootId: "binding-root-from-manifest",
      name: "New Workspace",
      selectedPaths: ["Included.md"],
      fileCount: 1,
      folderCount: 0,
      updatedAt: Date.now(),
      files: [
        {
          id: "document-id",
          path: "/Users/me/new-workspace/Included.md",
          relativePath: "Included.md",
          name: "Included.md",
          modifiedAt: Date.now(),
          size: 10,
          inode: 1,
          contentHash: "hash",
        },
      ],
    });

    await service.addExistingWorkspaceWithSelection(
      "/Users/me/new-workspace",
      ["Included.md"],
    );

    expect(settings.store.bindingRoots).toEqual([
      expect.objectContaining({
        id: "binding-root-from-manifest",
        rootPath: "/Users/me/new-workspace",
        kind: "external",
        visibleAsWorkspace: true,
        selectedPaths: ["Included.md"],
      }),
    ]);
    expect(reconcilerMocks.refreshRoots).toHaveBeenCalledTimes(1);
  });

  it("adopts the complete folder as an open root scope so future markdown files are discovered", async () => {
    tauriMocks.tauriWorkspaceInspect.mockResolvedValue({
      rootPath: "/Users/me/new-workspace",
      bindingRootId: "binding-root-from-manifest",
      name: "New Workspace",
      selectedPaths: ["Included.md"],
      fileCount: 1,
      folderCount: 0,
      updatedAt: 1,
      files: [{ relativePath: "Included.md" }],
    });
    tauriMocks.tauriWorkspaceSync.mockResolvedValue({
      rootPath: "/Users/me/new-workspace",
      bindingRootId: "binding-root-from-manifest",
      name: "New Workspace",
      selectedPaths: [],
      fileCount: 1,
      folderCount: 0,
      updatedAt: 1,
      files: [],
    });

    await service.addExistingWorkspaceWithSelection(
      "/Users/me/new-workspace",
      ["Included.md"],
    );

    expect(tauriMocks.tauriWorkspaceSync).toHaveBeenCalledWith(
      "/Users/me/new-workspace",
      [],
    );
    expect(settings.store.bindingRoots).toEqual([
      expect.objectContaining({ selectedPaths: [] }),
    ]);
  });

  it("inspects every markdown file without applying the manifest selection", async () => {
    const snapshot = {
      rootPath: "/Users/me/writings",
      bindingRootId: "root-1",
      name: "Writings",
      selectedPaths: ["only-in-manifest.md"],
      fileCount: 2,
      folderCount: 0,
      updatedAt: Date.now(),
      files: [
        { id: "doc-a", relativePath: "only-in-manifest.md" },
        { id: "", relativePath: "new-on-disk.md" },
      ],
    };
    tauriMocks.tauriWorkspaceInspect.mockResolvedValue(snapshot);

    await expect(service.inspectWorkspace("/Users/me/writings")).resolves.toBe(snapshot);
    expect(tauriMocks.tauriWorkspaceInspect).toHaveBeenCalledWith("/Users/me/writings");
    expect(tauriMocks.tauriWorkspaceSync).not.toHaveBeenCalled();
  });

  it("lists registered workspaces as assignment targets without syncing the FS", async () => {
    const options = await service.listAssignableWorkspaces();
    expect(options).toEqual([
      { slug: "drafts", name: "Drafts", rootPath: "/Users/me/drafts" },
      { slug: "letters", name: "Letters", rootPath: "/Users/me/letters" },
    ]);
  });

  it("assigns and then moves a writing, replacing the prior workspace", async () => {
    await service.assignToWorkspace("writing-1", "drafts");
    expect(await service.getAssignment("writing-1")).toBe("drafts");

    await service.assignToWorkspace("writing-1", "letters");
    expect(await service.getAssignment("writing-1")).toBe("letters");
    expect(settings.store.workspaceAssignments).toEqual({
      "writing-1": "letters",
    });
  });

  it("rejects assignment to an unknown workspace", async () => {
    await expect(
      service.assignToWorkspace("writing-1", "ghost"),
    ).rejects.toThrow(/Unknown workspace/);
  });

  it("clears an assignment while leaving the file in place", async () => {
    await service.assignToWorkspace("writing-1", "drafts");
    await service.clearAssignment("writing-1");
    expect(await service.getAssignment("writing-1")).toBeNull();
  });

  it("prunes assignments when their workspace is removed", async () => {
    await service.assignToWorkspace("writing-1", "drafts");
    await service.assignToWorkspace("writing-2", "letters");

    await service.removeWorkspace("drafts");

    expect(await service.getAssignment("writing-1")).toBeNull();
    expect(await service.getAssignment("writing-2")).toBe("letters");
    expect(await service.listAssignments()).toEqual({ "writing-2": "letters" });
  });

  describe("folder-backed physical move (ODE-403, ADR D7 amended)", () => {
    beforeEach(() => {
      factoryMocks.getDesktopWritingCanonicalPath.mockResolvedValue(
        "/managed/Letter.md",
      );
      factoryMocks.relocateDesktopWriting.mockResolvedValue({
        status: "relocated",
        path: "/Users/me/drafts/Letter.md",
      });
    });

    it("moves the .md into the workspace folder and clears the stale explicit assignment", async () => {
      // A stale metadata assignment must not survive the physical move.
      await settings.updateDesktopSettings({
        workspaceAssignments: { "writing-1": "letters" },
      });

      await service.assignToWorkspace("writing-1", "drafts");

      expect(factoryMocks.relocateDesktopWriting).toHaveBeenCalledWith(
        "writing-1",
        "/Users/me/drafts/Letter.md",
      );
      // Membership is now inferred from the path — the map holds no second truth.
      expect(settings.store.workspaceAssignments).toEqual({});
    });

    it("reassigning to another folder-backed workspace moves the file to the new root", async () => {
      factoryMocks.getDesktopWritingCanonicalPath.mockResolvedValue(
        "/Users/me/drafts/Letter.md",
      );
      factoryMocks.relocateDesktopWriting.mockResolvedValue({
        status: "relocated",
        path: "/Users/me/letters/Letter.md",
      });

      await service.assignToWorkspace("writing-1", "letters");

      expect(factoryMocks.relocateDesktopWriting).toHaveBeenCalledWith(
        "writing-1",
        "/Users/me/letters/Letter.md",
      );
    });

    it("skips the physical move when the file already lives inside the target root", async () => {
      factoryMocks.getDesktopWritingCanonicalPath.mockResolvedValue(
        "/Users/me/drafts/Sub/Letter.md",
      );
      await settings.updateDesktopSettings({
        workspaceAssignments: { "writing-1": "letters" },
      });

      await service.assignToWorkspace("writing-1", "drafts");

      expect(factoryMocks.relocateDesktopWriting).not.toHaveBeenCalled();
      // The stale metadata entry still gets cleared: path is the single truth.
      expect(settings.store.workspaceAssignments).toEqual({});
    });

    it("keeps metadata-only membership for writings without a local file", async () => {
      factoryMocks.getDesktopWritingCanonicalPath.mockResolvedValue(null);

      await service.assignToWorkspace("writing-1", "drafts");

      expect(factoryMocks.relocateDesktopWriting).not.toHaveBeenCalled();
      expect(await service.getAssignment("writing-1")).toBe("drafts");
    });

    it("surfaces a failed relocate instead of writing metadata that lies about the location", async () => {
      factoryMocks.relocateDesktopWriting.mockResolvedValue({
        status: "failed",
        message: "relocate_file verify: copied content mismatch; original preserved",
      });

      await expect(
        service.assignToWorkspace("writing-1", "drafts"),
      ).rejects.toThrow(/copied content mismatch/);
      expect(settings.store.workspaceAssignments ?? {}).toEqual({});
    });

    it("returns the .md to the managed root when removing from a folder-backed workspace", async () => {
      factoryMocks.getDesktopWritingCanonicalPath.mockResolvedValue(
        "/Users/me/drafts/Letter.md",
      );
      await settings.updateDesktopSettings({
        bindingRoots: [
          {
            id: "managed-root",
            rootPath: "/managed",
            kind: "managed",
            visibleAsWorkspace: false,
            selectedPaths: [],
            consentedAt: null,
            createdAt: "2026-06-01T00:00:00.000Z",
          },
        ],
      });
      factoryMocks.relocateDesktopWriting.mockResolvedValue({
        status: "relocated",
        path: "/managed/Letter.md",
      });

      await service.clearAssignment("writing-1");

      expect(factoryMocks.relocateDesktopWriting).toHaveBeenCalledWith(
        "writing-1",
        "/managed/Letter.md",
      );
      expect(await service.getAssignment("writing-1")).toBeNull();
    });

    it("remove is metadata-only when the file does not live inside any workspace root", async () => {
      factoryMocks.getDesktopWritingCanonicalPath.mockResolvedValue(
        "/Users/me/elsewhere/Letter.md",
      );
      await settings.updateDesktopSettings({
        workspaceAssignments: { "writing-1": "drafts" },
      });

      await service.clearAssignment("writing-1");

      expect(factoryMocks.relocateDesktopWriting).not.toHaveBeenCalled();
      expect(await service.getAssignment("writing-1")).toBeNull();
    });

    it("registers the managed root on demand when none exists yet", async () => {
      factoryMocks.getDesktopWritingCanonicalPath.mockResolvedValue(
        "/Users/me/drafts/Letter.md",
      );
      factoryMocks.relocateDesktopWriting.mockResolvedValue({
        status: "relocated",
        path: "/tmp/cfg/artifact-studio-managed/Letter.md",
      });

      await service.clearAssignment("writing-1");

      expect(settings.ensureManagedRoot).toHaveBeenCalledWith(
        "/tmp/cfg/artifact-studio-managed",
      );
      expect(factoryMocks.relocateDesktopWriting).toHaveBeenCalledWith(
        "writing-1",
        "/tmp/cfg/artifact-studio-managed/Letter.md",
      );
    });
  });

  it("keeps hyphens and underscores in a workspace filename-derived title", async () => {
    const path = "/Users/me/drafts/my-file_name.md";
    const workspace: WorkspaceDetail = {
      ...record("drafts", "Drafts"),
      selectedPaths: [],
      status: "ready",
      missingReason: null,
      fileCount: 0,
      folderCount: 0,
      updatedAt: null,
      files: [],
    };
    tauriMocks.tauriWorkspaceSync.mockResolvedValue({
      selectedPaths: [],
      fileCount: 1,
      folderCount: 0,
      updatedAt: Date.now(),
      files: [
        {
          id: path,
          path,
          relativePath: "my-file_name.md",
          name: "my-file_name.md",
          modifiedAt: Date.now(),
          size: 0,
          inode: 1,
        },
      ],
    });

    await service.createFile(workspace, "my-file_name");

    expect(tauriMocks.tauriCreateFile).toHaveBeenCalledWith(
      "/Users/me/drafts",
      "my-file_name.md",
    );
    expect(tauriMocks.tauriWriteFile).toHaveBeenCalledWith(
      path,
      "# my-file_name\n\n",
    );
  });

  it("falls back to Untitled when the filename stem is empty", async () => {
    const path = "/Users/me/drafts/.md";
    const workspace: WorkspaceDetail = {
      ...record("drafts", "Drafts"),
      selectedPaths: [],
      status: "ready",
      missingReason: null,
      fileCount: 0,
      folderCount: 0,
      updatedAt: null,
      files: [],
    };
    tauriMocks.tauriWorkspaceSync.mockResolvedValue({
      selectedPaths: [],
      fileCount: 1,
      folderCount: 0,
      updatedAt: Date.now(),
      files: [
        {
          id: path,
          path,
          relativePath: ".md",
          name: ".md",
          modifiedAt: Date.now(),
          size: 0,
          inode: 1,
        },
      ],
    });

    await service.createFile(workspace, ".md");

    expect(tauriMocks.tauriCreateFile).toHaveBeenCalledWith(
      "/Users/me/drafts",
      ".md",
    );
    expect(tauriMocks.tauriWriteFile).toHaveBeenCalledWith(
      path,
      "# Untitled\n\n",
    );
  });

describe("workspace removal (ODE-408)", () => {
  const bindingRoot = {
    id: "root-drafts",
    rootPath: "/Users/me/drafts",
    kind: "external" as const,
    visibleAsWorkspace: true,
    selectedPaths: [],
    consentedAt: "2026-06-01T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
  };

  it("previews workspace removal using the catalog count for the binding root", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [bindingRoot] });
    tauriMocks.tauriCatalogCountBindingRootDocuments.mockResolvedValue({
      total: 7,
      cloud: 3,
    });

    const preview = await service.previewWorkspaceRemoval("drafts");

    expect(preview).toEqual({ total: 7, cloud: 3 });
    expect(tauriMocks.tauriCatalogCountBindingRootDocuments).toHaveBeenCalledWith(
      "/tmp/cfg/desktop-index.sqlite3",
      "root-drafts",
    );
  });

  it("removes a workspace by archiving cloud writings and pruning stale assignments", async () => {
    await settings.updateDesktopSettings({
      bindingRoots: [bindingRoot],
      workspaceAssignments: {
        "writing-1": "drafts",
        "writing-2": "letters",
      } as WorkspaceAssignmentMap,
    });
    tauriMocks.tauriCatalogApplyWorkspaceRemoval.mockResolvedValue(["doc-1", "doc-2"]);

    await service.removeWorkspace("drafts");

    expect(tauriMocks.tauriCatalogApplyWorkspaceRemoval).toHaveBeenCalledWith(
      "/tmp/cfg/desktop-index.sqlite3",
      "root-drafts",
      "/Users/me/drafts",
      expect.any(String),
      expect.any(String),
    );
    expect(settings.store.bindingRoots).toEqual([]);
    expect(settings.store.workspaceAssignments).toEqual({
      "writing-2": "letters",
    });
    expect(reconcilerMocks.refreshRoots).toHaveBeenCalled();
  });

  it("repairs every recoverable manifest binding before SQLite removal", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [bindingRoot] });
    tauriMocks.tauriCatalogListBindingRootDocuments.mockResolvedValue([
      {
        id: "doc-a", localPresent: true, cloudPresent: false, cloudAccountId: null,
        syncStatus: "local-only", title: "A", slug: null, status: null,
        artifactType: null, visibility: null, version: null, deletedAt: null,
        createdAt: 1, modifiedAt: 2, bindingRootId: "root-drafts",
        relativePath: "a.md", canonicalPath: "/Users/me/drafts/a.md", inode: 10,
        contentHash: "ha", size: 2, lastSeenAt: 3, excerpt: null,
        excerptContentHash: null,
      },
      {
        id: "doc-b", localPresent: true, cloudPresent: false, cloudAccountId: null,
        syncStatus: "local-only", title: "B", slug: null, status: null,
        artifactType: null, visibility: null, version: null, deletedAt: null,
        createdAt: 1, modifiedAt: 2, bindingRootId: "root-drafts",
        relativePath: "b.md", canonicalPath: "/Users/me/drafts/b.md", inode: 11,
        contentHash: "hb", size: 2, lastSeenAt: 4, excerpt: null,
        excerptContentHash: null,
      },
    ]);

    await service.removeWorkspace("drafts");

    expect(tauriMocks.tauriWorkspaceRepairManifestBindings).toHaveBeenCalledWith(
      "/Users/me/drafts",
      "root-drafts",
      [
        expect.objectContaining({ documentId: "doc-a", relativePath: "a.md" }),
        expect.objectContaining({ documentId: "doc-b", relativePath: "b.md" }),
      ],
    );
    expect(
      tauriMocks.tauriWorkspaceRepairManifestBindings.mock.invocationCallOrder[0],
    ).toBeLessThan(
      tauriMocks.tauriCatalogApplyWorkspaceRemoval.mock.invocationCallOrder[0],
    );
  });

  it("keeps a durable SQLite fence when Settings cleanup fails", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [bindingRoot] });
    settings.updateDesktopSettings.mockResolvedValueOnce({
      data: null,
      error: { code: "UNAVAILABLE", message: "disk full", retryable: false },
    } as never);

    await expect(service.removeWorkspace("drafts")).rejects.toThrow(
      "Workspace removal is durable but Settings cleanup must be retried: disk full",
    );

    expect(tauriMocks.tauriCatalogApplyWorkspaceRemoval).toHaveBeenCalledTimes(1);
    expect(await service.listWorkspaces()).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "drafts" })]),
    );
  });

  it("leaves Settings untouched when the durable catalog removal fails", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [bindingRoot] });
    tauriMocks.tauriCatalogApplyWorkspaceRemoval.mockRejectedValueOnce(
      new Error("sqlite busy"),
    );

    await expect(service.removeWorkspace("drafts")).rejects.toThrow("sqlite busy");

    expect(settings.store.bindingRoots).toEqual([bindingRoot]);
    expect(settings.store.workspaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "drafts" })]),
    );
    expect(reconcilerMocks.refreshRoots).not.toHaveBeenCalled();
  });

  const archivedCloudRow = () => ({
    id: "doc-1",
    localPresent: true,
    cloudPresent: true,
    cloudAccountId: "user-1",
    syncStatus: "pending",
    title: "Note",
    slug: "note",
    status: "draft",
    artifactType: "general",
    visibility: "private",
    version: 5,
    deletedAt: "2026-07-29T00:00:00.000Z",
    createdAt: 1,
    modifiedAt: 2,
    excerpt: null,
    excerptContentHash: null,
    bindingRootId: "root-new",
    relativePath: "Note.md",
    canonicalPath: "/Users/me/new-workspace/Note.md",
    inode: 1,
    contentHash: "hash",
    size: 20,
    lastSeenAt: Date.now(),
  });

  const mockReAddSnapshot = () => {
    tauriMocks.tauriWorkspaceSync.mockResolvedValue({
      rootPath: "/Users/me/new-workspace",
      bindingRootId: "root-new",
      name: "New Workspace",
      selectedPaths: ["Note.md"],
      fileCount: 1,
      folderCount: 0,
      updatedAt: Date.now(),
      files: [
        {
          id: "doc-1",
          path: "/Users/me/new-workspace/Note.md",
          relativePath: "Note.md",
          name: "Note.md",
          modifiedAt: Date.now(),
          size: 20,
          inode: 1,
          contentHash: "hash",
        },
      ],
    });
  };

  it("reactivates archived cloud documents when the workspace folder is re-added", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [] });
    tauriMocks.tauriWorkspaceSync.mockResolvedValue({
      rootPath: "/Users/me/new-workspace",
      bindingRootId: "root-new",
      name: "New Workspace",
      selectedPaths: ["Note.md"],
      fileCount: 1,
      folderCount: 0,
      updatedAt: Date.now(),
      files: [
        {
          id: "doc-1",
          path: "/Users/me/new-workspace/Note.md",
          relativePath: "Note.md",
          name: "Note.md",
          modifiedAt: Date.now(),
          size: 20,
          inode: 1,
          contentHash: "hash",
        },
      ],
    });
    tauriMocks.tauriCatalogReactivateBindingRoot.mockResolvedValue([
      archivedCloudRow(),
    ]);
    tauriMocks.tauriOpenFile.mockResolvedValue("# Note\n\nReactivated content");

    await service.addExistingWorkspaceWithSelection("/Users/me/new-workspace", [
      "Note.md",
    ]);

    expect(tauriMocks.tauriCatalogBulkDualWrite).toHaveBeenCalledTimes(1);
    const call = tauriMocks.tauriCatalogBulkDualWrite.mock
      .calls[0] as unknown as [string, DesktopCatalogDualWriteInput[]];
    expect(call).toBeDefined();
    const inputs = call[1];
    expect(inputs).toHaveLength(1);
    const input = inputs[0];
    expect(input.document.id).toBe("doc-1");
    expect(input.document.deletedAt).toBeNull();
    expect(input.document.syncStatus).toBe("pending");
    expect(input.document.version).toBe(6);
    expect(input.mutation).not.toBeNull();
    expect(input.mutation!.operation).toBe("upsert");
    const payload = JSON.parse(input.mutation!.payloadJson);
    expect(payload.deletedAt).toBeNull();
    expect(payload.bodyText).toBe("Reactivated content");
    expect(payload.version).toBe(6);
    // Local wins: the binding root path comes from the freshly synced snapshot,
    // never reconstructed by slicing the canonical path.
    expect(input.binding!.rootPath).toBe("/Users/me/new-workspace");
  });

  it("never enqueues a cloud mutation when the re-added root has only local-only documents", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [] });
    mockReAddSnapshot();
    // A local-only document is restored inside `catalog_reactivate_binding_root`
    // itself and is deliberately absent from the returned set, so it can never
    // reach the sync queue. Inventing a cloud record for it is exactly what the
    // brief forbids.
    tauriMocks.tauriCatalogReactivateBindingRoot.mockResolvedValue([]);

    await service.addExistingWorkspaceWithSelection("/Users/me/new-workspace", [
      "Note.md",
    ]);

    expect(tauriMocks.tauriCatalogReactivateBindingRoot).toHaveBeenCalledWith(
      "/tmp/cfg/desktop-index.sqlite3",
      "root-new",
    );
    expect(tauriMocks.tauriCatalogBulkDualWrite).not.toHaveBeenCalled();
  });

  it("keeps the workspace registered and surfaces Retry when reactivation cannot read a local file", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [] });
    mockReAddSnapshot();
    tauriMocks.tauriCatalogReactivateBindingRoot.mockResolvedValue([
      archivedCloudRow(),
    ]);
    tauriMocks.tauriOpenFile.mockRejectedValue(new Error("EACCES"));

    await expect(
      service.addExistingWorkspaceWithSelection(
        "/Users/me/new-workspace",
        ["Note.md"],
      ),
    ).rejects.toThrow("choose Add workspace again to retry");

    // Adoption is durable, but the partial outcome is explicit and retryable.
    expect(settings.store.bindingRoots).toHaveLength(1);
    expect(settings.store.workspaces).toContainEqual(
      expect.objectContaining({ rootPath: "/Users/me/new-workspace" }),
    );
    expect(tauriMocks.tauriCatalogBulkDualWrite).not.toHaveBeenCalled();
  });

  it("removes a workspace whose folder is not a BindingRoot without touching the catalog", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [] });

    await service.removeWorkspace("drafts");

    // A presentation-only / pre-BindingRoot workspace has nothing to retire, but
    // must still be removable.
    expect(tauriMocks.tauriCatalogApplyWorkspaceRemoval).not.toHaveBeenCalled();
    expect(await service.listWorkspaces()).toEqual([
      expect.objectContaining({ slug: "letters" }),
    ]);
  });

  it("resolves the BindingRoot even when the workspace path carries a trailing separator", async () => {
    await settings.updateDesktopSettings({
      bindingRoots: [{ ...bindingRoot, rootPath: "/Users/me/drafts/" }],
    });
    tauriMocks.tauriCatalogCountBindingRootDocuments.mockResolvedValue({
      total: 2,
      cloud: 1,
    });

    // Both stores are normalized before comparing: a one-sided comparison used to
    // miss the root and silently skip the catalog half of the removal.
    expect(await service.previewWorkspaceRemoval("drafts")).toEqual({
      total: 2,
      cloud: 1,
    });

    await service.removeWorkspace("drafts");

    expect(tauriMocks.tauriCatalogApplyWorkspaceRemoval).toHaveBeenCalledTimes(1);
    expect(settings.store.bindingRoots).toEqual([]);
  });

  it("is idempotent when the removal is retried after a partial failure", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [bindingRoot] });

    await service.removeWorkspace("drafts");
    // Retry after e.g. an app restart: the root is already gone, so the second
    // pass must converge instead of throwing or re-running the catalog write.
    await service.removeWorkspace("drafts");

    expect(tauriMocks.tauriCatalogApplyWorkspaceRemoval).toHaveBeenCalledTimes(1);
    expect(settings.store.bindingRoots).toEqual([]);
    expect(await service.listWorkspaces()).toEqual([
      expect.objectContaining({ slug: "letters" }),
    ]);
  });

  it("stops observing the removed root before returning", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [bindingRoot] });

    await service.removeWorkspace("drafts");

    // The reconciler reloads roots from settings, which no longer contain the
    // removed one — a late filesystem event cannot reproject its documents.
    expect(settings.store.bindingRoots).toEqual([]);
    const refreshCallOrder =
      reconcilerMocks.refreshRoots.mock.invocationCallOrder.at(-1) ?? 0;
    const removalCallOrder =
      tauriMocks.tauriCatalogApplyWorkspaceRemoval.mock.invocationCallOrder.at(-1) ?? 0;
    expect(refreshCallOrder).toBeGreaterThan(removalCallOrder);
  });

  it("removing the last workspace leaves no substitute writing behind", async () => {
    await settings.updateDesktopSettings({ bindingRoots: [bindingRoot] });

    await service.removeWorkspace("drafts");
    await service.removeWorkspace("letters");

    expect(await service.listWorkspaces()).toEqual([]);
    // No draft is minted as a fallback for an empty Desk.
    expect(tauriMocks.tauriCreateFile).not.toHaveBeenCalled();
    expect(tauriMocks.tauriWriteFile).not.toHaveBeenCalled();
  });
});
});
