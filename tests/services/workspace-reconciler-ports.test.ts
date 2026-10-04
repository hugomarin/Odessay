/**
 * Shared desktop reconciler ports (ODE-645).
 *
 * `createWorkspaceReconcilerPorts` is the one owner of the scanRoot /
 * bindUnbound / commit glue that production (`desktop-workspace-reconciler.ts`)
 * and the catalog seam recorder consume. The seam drift gate
 * (`tests/catalog-seam-fixture.test.ts`) proves the recorder tracks the shared
 * factory; these cases pin the branches that the recorded scenarios never
 * exercise: a rejected `workspace_sync` (must stay `observed: null`, never a
 * mass detach), the narrowing of `root.selectedPaths` before the Settings hook
 * runs, the per-root binding filter, and the call shape of bind/commit.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriWorkspaceSync: vi.fn(),
}))

import { tauriWorkspaceSync } from "@/lib/services/desktop/tauri-commands"
import {
  createWorkspaceReconcilerPorts,
  type WorkspaceReconcilerPortCatalog,
} from "@/lib/services/desktop/workspace-reconciler-ports"
import type {
  DesktopWorkspaceFile,
  DesktopWorkspaceSnapshot,
} from "@/lib/services/desktop/tauri-commands"
import type {
  ReconcilerRoot,
  ReconcileCommit,
} from "@/lib/services/desktop/workspace-reconciler"

const syncMock = vi.mocked(tauriWorkspaceSync)

function root(overrides: Partial<ReconcilerRoot> = {}): ReconcilerRoot {
  return {
    id: "root-a",
    rootPath: "$ROOT_A",
    kind: "managed",
    visibleAsWorkspace: true,
    selectedPaths: [],
    ...overrides,
  }
}

function file(overrides: Partial<DesktopWorkspaceFile> = {}): DesktopWorkspaceFile {
  return {
    id: "doc-a",
    path: "$ROOT_A/notes/a.md",
    relativePath: "notes/a.md",
    name: "a.md",
    modifiedAt: 10,
    size: 20,
    inode: 30,
    device: 1,
    contentHash: "blake3:aaa",
    ...overrides,
  }
}

function snapshot(overrides: Partial<DesktopWorkspaceSnapshot> = {}): DesktopWorkspaceSnapshot {
  return {
    rootPath: "$ROOT_A",
    bindingRootId: "root-a",
    name: "root-a",
    fileCount: 0,
    folderCount: 0,
    updatedAt: null,
    selectedPaths: [],
    files: [],
    unboundPaths: [],
    ...overrides,
  }
}

function catalog(
  rows: {
    id: string
    binding: {
      bindingRootId: string
      relativePath: string
      inode: number | null
      contentHash: string | null
    } | null
  }[] = [],
): WorkspaceReconcilerPortCatalog {
  return {
    listByBindingRoot: vi.fn(async () => rows),
    applyReconcileTransaction: vi.fn(async () => ({})),
  } as unknown as WorkspaceReconcilerPortCatalog
}

describe("createWorkspaceReconcilerPorts (ODE-645)", () => {
  it("scans without minting and maps the snapshot and the catalog bindings", async () => {
    syncMock.mockResolvedValueOnce(
      snapshot({
        files: [file()],
        unboundPaths: ["drafts/b.md"],
        unboundFiles: [
          {
            relativePath: "drafts/b.md",
            inode: 31,
            device: 1,
            contentHash: "blake3:bbb",
            size: 21,
            modifiedAt: 11,
          },
        ],
      }),
    )
    const portCatalog = catalog([
      {
        id: "doc-z",
        binding: {
          bindingRootId: "root-a",
          relativePath: "notes/z.md",
          inode: 32,
          contentHash: "blake3:zzz",
        },
      },
    ])
    const ports = createWorkspaceReconcilerPorts({ catalog: portCatalog })

    const result = await ports.scanRoot!(root())

    expect(syncMock).toHaveBeenCalledWith("$ROOT_A", undefined, undefined, {
      mintUnbound: false,
    })
    expect(result.observed).toEqual([
      {
        relativePath: "notes/a.md",
        canonicalPath: "$ROOT_A/notes/a.md",
        inode: 30,
        device: 1,
        contentHash: "blake3:aaa",
        size: 20,
        modifiedAt: 10,
        manifestId: "doc-a",
      },
    ])
    expect(result.unbound).toEqual([
      {
        relativePath: "drafts/b.md",
        inode: 31,
        device: 1,
        contentHash: "blake3:bbb",
        size: 21,
        modifiedAt: 11,
      },
    ])
    expect(result.knownBindings).toEqual([
      {
        documentId: "doc-z",
        bindingRootId: "root-a",
        relativePath: "notes/z.md",
        inode: 32,
        contentHash: "blake3:zzz",
      },
    ])
  })

  it("keeps a rejected scan as observed:null and never infers a detach", async () => {
    syncMock.mockRejectedValueOnce(new Error("volume unmounted"))
    const portCatalog = catalog([
      {
        id: "doc-a",
        binding: {
          bindingRootId: "root-a",
          relativePath: "notes/a.md",
          inode: 30,
          contentHash: "blake3:aaa",
        },
      },
    ])
    const ports = createWorkspaceReconcilerPorts({ catalog: portCatalog })

    await expect(ports.scanRoot!(root())).resolves.toEqual({
      observed: null,
      unbound: [],
      knownBindings: [
        {
          documentId: "doc-a",
          bindingRootId: "root-a",
          relativePath: "notes/a.md",
          inode: 30,
          contentHash: "blake3:aaa",
        },
      ],
    })
  })

  it("drops catalog rows whose binding belongs to another root", async () => {
    syncMock.mockResolvedValueOnce(snapshot())
    const portCatalog = catalog([
      {
        id: "doc-a",
        binding: {
          bindingRootId: "root-b",
          relativePath: "notes/a.md",
          inode: 30,
          contentHash: "blake3:aaa",
        },
      },
      {
        id: "doc-orphan",
        binding: null,
      },
    ])
    const ports = createWorkspaceReconcilerPorts({ catalog: portCatalog })

    const result = await ports.scanRoot!(root())

    expect(result.knownBindings).toEqual([])
  })

  it("narrows root.selectedPaths before the Settings hook runs", async () => {
    syncMock.mockResolvedValueOnce(snapshot({ selectedPaths: ["notes"] }))
    const observedAtHook: { selectedPaths: string[] }[] = []
    const scannedRoot = root()
    const ports = createWorkspaceReconcilerPorts({
      catalog: catalog(),
      async onSelectedPathsChanged(current, selectedPaths) {
        observedAtHook.push({ selectedPaths: [...current.selectedPaths] })
        expect(selectedPaths).toEqual(["notes"])
      },
    })

    await ports.scanRoot!(scannedRoot)

    expect(scannedRoot.selectedPaths).toEqual(["notes"])
    expect(observedAtHook).toEqual([{ selectedPaths: ["notes"] }])
  })

  it("does not call the Settings hook when the scope is unchanged", async () => {
    syncMock.mockResolvedValueOnce(snapshot({ selectedPaths: ["notes"] }))
    const onSelectedPathsChanged = vi.fn(async () => {})
    const ports = createWorkspaceReconcilerPorts({
      catalog: catalog(),
      onSelectedPathsChanged,
    })

    await ports.scanRoot!(root({ selectedPaths: ["notes"] }))

    expect(onSelectedPathsChanged).not.toHaveBeenCalled()
  })

  it("binds the decided ids in one sync call and maps the refreshed snapshot", async () => {
    syncMock.mockResolvedValueOnce(snapshot({ files: [file()] }))
    const ports = createWorkspaceReconcilerPorts({ catalog: catalog() })

    const observed = await ports.bindUnbound!(root(), { "notes/a.md": "doc-a" })

    expect(syncMock).toHaveBeenCalledWith("$ROOT_A", undefined, {
      "notes/a.md": "doc-a",
    })
    expect(observed).toEqual([
      {
        relativePath: "notes/a.md",
        canonicalPath: "$ROOT_A/notes/a.md",
        inode: 30,
        device: 1,
        contentHash: "blake3:aaa",
        size: 20,
        modifiedAt: 10,
        manifestId: "doc-a",
      },
    ])
  })

  it("commits through the catalog reconcile transaction", async () => {
    const portCatalog = catalog()
    const ports = createWorkspaceReconcilerPorts({ catalog: portCatalog })
    const commit: ReconcileCommit = {
      transactionId: "tx-1",
      bindingRootId: "root-a",
      rootPath: "$ROOT_A",
      visibleAsWorkspace: true,
      upserts: [],
      detached: [],
    }

    await ports.commit!(commit)

    expect(portCatalog.applyReconcileTransaction).toHaveBeenCalledWith(commit)
  })
})
