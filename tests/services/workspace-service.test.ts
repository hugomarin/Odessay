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
};

function createFakeSettingsService(initial: FakeStore = {}) {
  let store: FakeStore = { ...initial };
  return {
    getDesktopSettings: vi.fn(async () => ({ data: store, error: null })),
    updateDesktopSettings: vi.fn(async (patch: Partial<FakeStore>) => {
      store = { ...store, ...patch };
      return { data: store, error: null };
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
    settings = createFakeSettingsService({
      workspaces: [record("drafts", "Drafts"), record("letters", "Letters")],
    });
    // The constructor only stores the settings service; cast through unknown to
    // satisfy the nominal DesktopSettingsService type for the test double.
    service = new DesktopWorkspaceService(settings as unknown as never);
  });

  it("lists registered workspaces as assignment targets without syncing the FS", async () => {
    const options = await service.listAssignableWorkspaces();
    expect(options).toEqual([
      { slug: "drafts", name: "Drafts" },
      { slug: "letters", name: "Letters" },
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
