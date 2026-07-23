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
  tauriWorkspaceSync: vi.fn(),
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
  tauriWorkspaceSync: tauriMocks.tauriWorkspaceSync,
}));
vi.mock("@/lib/services/desktop/desktop-workspace-reconciler", () => ({
  refreshWorkspaceReconcilerRoots: reconcilerMocks.refreshRoots,
}));

import { DesktopWorkspaceService } from "@/lib/services/desktop/workspace-service";
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
    tauriMocks.tauriWorkspaceSync.mockReset();
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
});
