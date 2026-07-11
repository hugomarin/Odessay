import { describe, expect, it, vi } from "vitest"
import {
  createWorkspaceReconciler,
  matchesSelectedPaths,
  reconcileRoot,
  type CloudHashLookup,
  type KnownBinding,
  type ObservedFile,
  type ReconcileCommit,
  type ReconcilerRoot,
} from "@/lib/services/desktop/workspace-reconciler"

function root(overrides: Partial<ReconcilerRoot> = {}): ReconcilerRoot {
  return {
    id: "root-1",
    rootPath: "/Users/h/Docs",
    kind: "external",
    visibleAsWorkspace: true,
    selectedPaths: [],
    ...overrides,
  }
}

function observed(overrides: Partial<ObservedFile> = {}): ObservedFile {
  return {
    relativePath: "a.md",
    canonicalPath: "/Users/h/Docs/a.md",
    inode: 100,
    contentHash: "blake3:aaa",
    size: 10,
    modifiedAt: 1000,
    manifestId: null,
    ...overrides,
  }
}

function known(overrides: Partial<KnownBinding> = {}): KnownBinding {
  return {
    documentId: "doc-a",
    bindingRootId: "root-1",
    relativePath: "a.md",
    inode: 100,
    contentHash: "blake3:aaa",
    ...overrides,
  }
}

let mintCounter = 0
const mintId = () => `minted-${++mintCounter}`

describe("reconcileRoot — identity priority", () => {
  it("prefers the durable manifest ledger id over every heuristic", () => {
    const result = reconcileRoot({
      root: root(),
      observed: [observed({ manifestId: "ledger-1", inode: 999, contentHash: "blake3:zzz" })],
      knownBindings: [known()],
      mintId,
    })
    expect(result.resolved[0]).toMatchObject({ documentId: "ledger-1", strategy: "path" })
  })

  it("resolves by same relative path even when inode and hash both changed (atomic save)", () => {
    const result = reconcileRoot({
      root: root(),
      observed: [observed({ inode: 200, contentHash: "blake3:new" })],
      knownBindings: [known({ inode: 100, contentHash: "blake3:old" })],
      mintId,
    })
    expect(result.resolved[0]).toMatchObject({ documentId: "doc-a", strategy: "path" })
    expect(result.detached).toEqual([])
  })

  it("resolves a correlated move by inode when the path changed", () => {
    const result = reconcileRoot({
      root: root(),
      observed: [observed({ relativePath: "nested/a.md", canonicalPath: "/Users/h/Docs/nested/a.md", inode: 100 })],
      knownBindings: [known({ relativePath: "a.md", inode: 100 })],
      mintId,
    })
    expect(result.resolved[0]).toMatchObject({ documentId: "doc-a", strategy: "inode" })
    // The moved file consumed its old binding — it is not a delete.
    expect(result.detached).toEqual([])
    expect(result.outOfScope).toEqual([])
  })

  it("resolves by unique local content hash when path and inode differ", () => {
    const result = reconcileRoot({
      root: root(),
      observed: [observed({ relativePath: "b.md", canonicalPath: "/Users/h/Docs/b.md", inode: 300, contentHash: "blake3:aaa" })],
      knownBindings: [known({ relativePath: "a.md", inode: 100, contentHash: "blake3:aaa" })],
      mintId,
    })
    expect(result.resolved[0]).toMatchObject({ documentId: "doc-a", strategy: "local_hash" })
  })

  it("never auto-chooses when several local bindings share the content hash", () => {
    const result = reconcileRoot({
      root: root(),
      observed: [observed({ relativePath: "c.md", canonicalPath: "/Users/h/Docs/c.md", inode: 500, contentHash: "blake3:dup" })],
      knownBindings: [
        known({ documentId: "doc-x", relativePath: "x.md", inode: 10, contentHash: "blake3:dup" }),
        known({ documentId: "doc-y", relativePath: "y.md", inode: 20, contentHash: "blake3:dup" }),
      ],
      mintId,
    })
    expect(result.resolved[0]).toMatchObject({ documentId: null, strategy: "ambiguous" })
    expect(result.resolved[0].candidates?.sort()).toEqual(["doc-x", "doc-y"])
    expect(result.ambiguous).toHaveLength(1)
  })

  it("resolves by unique cloud hash when there is no local match", () => {
    const cloudHashLookup: CloudHashLookup = (hash) => (hash === "blake3:cloud" ? "cloud-doc" : null)
    const result = reconcileRoot({
      root: root(),
      observed: [observed({ relativePath: "new.md", canonicalPath: "/Users/h/Docs/new.md", inode: 700, contentHash: "blake3:cloud" })],
      knownBindings: [],
      cloudHashLookup,
      mintId,
    })
    expect(result.resolved[0]).toMatchObject({ documentId: "cloud-doc", strategy: "cloud_hash" })
  })

  it("stays ambiguous when the cloud hash matches several records", () => {
    const cloudHashLookup: CloudHashLookup = () => "ambiguous"
    const result = reconcileRoot({
      root: root(),
      observed: [observed({ inode: 800, contentHash: "blake3:multi" })],
      knownBindings: [],
      cloudHashLookup,
      mintId,
    })
    expect(result.resolved[0]).toMatchObject({ documentId: null, strategy: "ambiguous" })
  })

  it("mints a fresh UUID only after exhausting every resolution path", () => {
    const result = reconcileRoot({
      root: root(),
      observed: [observed({ relativePath: "brand.md", canonicalPath: "/Users/h/Docs/brand.md", inode: 900, contentHash: "blake3:unique", manifestId: null })],
      knownBindings: [],
      mintId,
    })
    expect(result.resolved[0].strategy).toBe("minted")
    expect(result.resolved[0].documentId).toMatch(/^minted-/)
  })
})

describe("reconcileRoot — presence classification", () => {
  it("treats an unobservable root (observed=null) as no-op: nothing detached", () => {
    const result = reconcileRoot({
      root: root(),
      observed: null,
      knownBindings: [known()],
      mintId,
    })
    expect(result.unobservable).toBe(true)
    expect(result.detached).toEqual([])
    expect(result.resolved).toEqual([])
  })

  it("keeps (does not detach) a known file whose path fell out of scope", () => {
    const result = reconcileRoot({
      root: root({ selectedPaths: ["Letters"] }),
      observed: [],
      knownBindings: [known({ documentId: "doc-notes", relativePath: "Notes/n.md" })],
      mintId,
    })
    expect(result.outOfScope).toEqual(["doc-notes"])
    expect(result.detached).toEqual([])
  })

  it("detaches only a confirmed-absent, in-scope file", () => {
    const result = reconcileRoot({
      root: root(),
      observed: [],
      knownBindings: [known({ documentId: "doc-gone", relativePath: "gone.md" })],
      mintId,
    })
    expect(result.detached).toEqual(["doc-gone"])
    expect(result.outOfScope).toEqual([])
  })
})

describe("matchesSelectedPaths", () => {
  it("matches everything when scope is empty", () => {
    expect(matchesSelectedPaths("any/file.md", [])).toBe(true)
  })
  it("matches an exact selected path or its descendants only", () => {
    expect(matchesSelectedPaths("Letters/a.md", ["Letters"])).toBe(true)
    expect(matchesSelectedPaths("Letters", ["Letters"])).toBe(true)
    expect(matchesSelectedPaths("Notes/a.md", ["Letters"])).toBe(false)
  })
})

describe("createWorkspaceReconciler — orchestrator", () => {
  it("projects roots on start and reaches ready", async () => {
    const commits: ReconcileCommit[] = []
    const reconciler = createWorkspaceReconciler({
      loadRoots: async () => [root()],
      scanRoot: async () => ({
        observed: [observed({ manifestId: "doc-a" })],
        knownBindings: [],
      }),
      commit: async (c) => {
        commits.push(c)
      },
    })
    await reconciler.start()
    expect(reconciler.getReadiness()).toBe("ready")
    expect(commits).toHaveLength(1)
    expect(commits[0].upserts.map((u) => u.documentId)).toEqual(["doc-a"])
  })

  it("coalesces a burst of notifications into ONE commit per affected root", async () => {
    const commits: ReconcileCommit[] = []
    let flush: (() => void) | null = null
    const reconciler = createWorkspaceReconciler({
      loadRoots: async () => [root()],
      scanRoot: async () => ({ observed: [observed({ manifestId: "doc-a" })], knownBindings: [] }),
      commit: async (c) => {
        commits.push(c)
      },
      // Capture the coalesce timer so we flush it exactly once, deterministically.
      setTimer: (fn) => {
        flush = fn
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => {},
    })
    await reconciler.start()
    commits.length = 0

    reconciler.notifyRootChanged("root-1")
    reconciler.notifyRootChanged("root-1")
    reconciler.notifyRootChanged("root-1")
    expect(flush).not.toBeNull()
    flush!()
    await Promise.resolve()
    await Promise.resolve()

    expect(commits).toHaveLength(1)
  })

  it("marks the catalog stale (not failed) when a root is unobservable", async () => {
    const reconciler = createWorkspaceReconciler({
      loadRoots: async () => [root()],
      scanRoot: async () => ({ observed: null, knownBindings: [known()] }),
      commit: async () => {},
    })
    await reconciler.start()
    expect(reconciler.getReadiness()).toBe("stale")
  })

  it("marks the catalog failed when a commit throws, without fabricating deletes", async () => {
    const reconciler = createWorkspaceReconciler({
      loadRoots: async () => [root()],
      scanRoot: async () => ({ observed: [observed({ manifestId: "doc-a" })], knownBindings: [] }),
      commit: async () => {
        throw new Error("sqlite locked")
      },
    })
    await reconciler.start()
    expect(reconciler.getReadiness()).toBe("failed")
  })

  it("notifies readiness subscribers and stops after dispose", async () => {
    const states: string[] = []
    const reconciler = createWorkspaceReconciler({
      loadRoots: async () => [root()],
      scanRoot: async () => ({ observed: [], knownBindings: [] }),
      commit: async () => {},
    })
    reconciler.subscribeReadiness((s) => states.push(s))
    await reconciler.start()
    expect(states).toContain("rebuilding")
    expect(states).toContain("ready")

    const cleared = vi.fn()
    reconciler.dispose()
    reconciler.notifyRootChanged("root-1")
    // After dispose, no further work is scheduled.
    expect(cleared).not.toHaveBeenCalled()
  })
})
