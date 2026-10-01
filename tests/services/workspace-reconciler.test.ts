import { describe, expect, it, vi } from "vitest"
import {
  correlateAcrossRoots,
  createWorkspaceReconciler,
  matchesSelectedPaths,
  reconcileRoot,
  type CloudHashLookup,
  type CrossRootCorrelationRoot,
  type KnownBinding,
  type ObservedFile,
  type ReconcileCommit,
  type ReconcilerRoot,
  type UnboundFile,
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
    device: 1,
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

function unboundFile(overrides: Partial<UnboundFile> = {}): UnboundFile {
  return {
    relativePath: "letter.md",
    inode: 100,
    device: 1,
    contentHash: "blake3:aaa",
    size: 10,
    modifiedAt: 1000,
    ...overrides,
  }
}

// Los casos rojos de ODE-657 (review ronda 1, P1) se escribieron antes de que
// `device` existiera en los tipos públicos de evidencia. Estos constructores
// locales aportan el volumen que introduce el fix, para que el commit rojo
// compile contra el contrato previo (regla 8: el fix solo voltea `it.fails`).
function observedWithDevice(overrides: Partial<ObservedFile> & { device?: number | null } = {}) {
  return { ...observed(), device: 1, ...overrides }
}

function unboundFileWithDevice(
  overrides: Partial<UnboundFile> & { device?: number | null } = {},
) {
  return { ...unboundFile(), device: 1, ...overrides }
}

function correlationRoot(
  device: number | null,
  overrides: Partial<CrossRootCorrelationRoot> = {},
) {
  return { rootId: "root-1", observable: true, unbound: [], detached: [], ...overrides, device }
}

describe("correlateAcrossRoots — cross-root move evidence", () => {
  it("correlates an unbound file with the unique detached binding of another root", () => {
    const result = correlateAcrossRoots({
      roots: [
        {
          rootId: "root-a",
          observable: true,
          device: 1,
          unbound: [],
          detached: [known({ bindingRootId: "root-a" })],
        },
        {
          rootId: "root-b",
          observable: true,
          device: 1,
          unbound: [unboundFile({ relativePath: "moved.md" })],
          detached: [],
        },
      ],
      mintId,
    })
    expect(result.idsByRoot.get("root-b")?.get("moved.md")).toBe("doc-a")
    expect([...result.correlatedIds]).toEqual(["doc-a"])
  })

  it("does not correlate when the hash differs, even with the same inode (inode reuse)", () => {
    const result = correlateAcrossRoots({
      roots: [
        {
          rootId: "root-a",
          observable: true,
          device: 1,
          unbound: [],
          detached: [known({ bindingRootId: "root-a" })],
        },
        {
          rootId: "root-b",
          observable: true,
          device: 1,
          unbound: [unboundFile({ relativePath: "other.md", contentHash: "blake3:other" })],
          detached: [],
        },
      ],
      mintId,
    })
    expect(result.idsByRoot.get("root-b")?.get("other.md")).toMatch(/^minted-/)
    expect(result.correlatedIds.size).toBe(0)
  })

  it.fails(
    "no correlaciona el mismo inode y hash entre volúmenes distintos (inode reutilizado)",
    () => {
      // Un inode solo es único dentro de un volumen: aunque inode y hash
      // coincidan, una raíz en otro dispositivo no es el mismo archivo movido.
      const result = correlateAcrossRoots({
        roots: [
          correlationRoot(1, { rootId: "root-a", detached: [known({ bindingRootId: "root-a" })] }),
          correlationRoot(2, {
            rootId: "root-b",
            unbound: [unboundFileWithDevice({ relativePath: "moved.md", device: 2 })],
          }),
        ],
        mintId,
      })
      expect(result.idsByRoot.get("root-b")?.get("moved.md")).toMatch(/^minted-/)
      expect(result.correlatedIds.size).toBe(0)
    },
  )

  it("does not correlate when the origin root's volume is unknown", () => {
    // Sin evidencia de archivos no se puede afirmar que ambas raíces compartan
    // volumen: se conserva el comportamiento seguro (UUID nuevo + detach).
    const result = correlateAcrossRoots({
      roots: [
        {
          rootId: "root-a",
          observable: true,
          device: null,
          unbound: [],
          detached: [known({ bindingRootId: "root-a" })],
        },
        {
          rootId: "root-b",
          observable: true,
          device: 1,
          unbound: [unboundFile({ relativePath: "moved.md", device: 1 })],
          detached: [],
        },
      ],
      mintId,
    })
    expect(result.idsByRoot.get("root-b")?.get("moved.md")).toMatch(/^minted-/)
    expect(result.correlatedIds.size).toBe(0)
  })

  it("does not correlate when the unbound file's volume is unknown", () => {
    const result = correlateAcrossRoots({
      roots: [
        {
          rootId: "root-a",
          observable: true,
          device: 1,
          unbound: [],
          detached: [known({ bindingRootId: "root-a" })],
        },
        {
          rootId: "root-b",
          observable: true,
          device: null,
          unbound: [unboundFile({ relativePath: "moved.md", device: null })],
          detached: [],
        },
      ],
      mintId,
    })
    expect(result.idsByRoot.get("root-b")?.get("moved.md")).toMatch(/^minted-/)
    expect(result.correlatedIds.size).toBe(0)
  })

  it("does not correlate when the origin binding is still present (hard link)", () => {
    // The origin path was observed, so `reconcileRoot` consumed its binding and
    // it never reaches `detached`.
    const result = correlateAcrossRoots({
      roots: [
        { rootId: "root-a", observable: true, device: 1, unbound: [], detached: [] },
        {
          rootId: "root-b",
          observable: true,
          device: 1,
          unbound: [unboundFile({ relativePath: "copy.md" })],
          detached: [],
        },
      ],
      mintId,
    })
    expect(result.idsByRoot.get("root-b")?.get("copy.md")).toMatch(/^minted-/)
    expect(result.correlatedIds.size).toBe(0)
  })

  it("does not correlate with two detached candidates for one file", () => {
    const result = correlateAcrossRoots({
      roots: [
        {
          rootId: "root-a",
          observable: true,
          device: 1,
          unbound: [],
          detached: [known({ bindingRootId: "root-a" })],
        },
        {
          rootId: "root-c",
          observable: true,
          device: 1,
          unbound: [],
          detached: [known({ documentId: "doc-c", bindingRootId: "root-c" })],
        },
        {
          rootId: "root-b",
          observable: true,
          device: 1,
          unbound: [unboundFile({ relativePath: "moved.md" })],
          detached: [],
        },
      ],
      mintId,
    })
    expect(result.idsByRoot.get("root-b")?.get("moved.md")).toMatch(/^minted-/)
    expect(result.correlatedIds.size).toBe(0)
  })

  it("does not correlate when two unbound files share one detached candidate", () => {
    const result = correlateAcrossRoots({
      roots: [
        {
          rootId: "root-a",
          observable: true,
          device: 1,
          unbound: [],
          detached: [known({ bindingRootId: "root-a" })],
        },
        {
          rootId: "root-b",
          observable: true,
          device: 1,
          unbound: [unboundFile({ relativePath: "one.md" })],
          detached: [],
        },
        {
          rootId: "root-c",
          observable: true,
          device: 1,
          unbound: [unboundFile({ relativePath: "two.md" })],
          detached: [],
        },
      ],
      mintId,
    })
    expect(result.idsByRoot.get("root-b")?.get("one.md")).toMatch(/^minted-/)
    expect(result.idsByRoot.get("root-c")?.get("two.md")).toMatch(/^minted-/)
    expect(result.correlatedIds.size).toBe(0)
  })

  it("does not correlate when the origin root is unobservable", () => {
    const result = correlateAcrossRoots({
      roots: [
        {
          rootId: "root-a",
          observable: false,
          device: 1,
          unbound: [],
          detached: [known({ bindingRootId: "root-a" })],
        },
        {
          rootId: "root-b",
          observable: true,
          device: 1,
          unbound: [unboundFile({ relativePath: "moved.md" })],
          detached: [],
        },
      ],
      mintId,
    })
    expect(result.idsByRoot.get("root-b")?.get("moved.md")).toMatch(/^minted-/)
    expect(result.correlatedIds.size).toBe(0)
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

  it("continues reconciling later roots when an earlier root fails", async () => {
    const committedRootIds: string[] = []
    const reconciler = createWorkspaceReconciler({
      loadRoots: async () => [
        root({ id: "broken-root", rootPath: "/Users/h/Broken" }),
        root({ id: "new-root", rootPath: "/Users/h/New" }),
      ],
      scanRoot: async (candidate) => {
        if (candidate.id === "broken-root") {
          throw new Error("legacy root unavailable")
        }
        return {
          observed: [
            observed({
              relativePath: "New.md",
              canonicalPath: "/Users/h/New/New.md",
              manifestId: "new-document",
            }),
          ],
          knownBindings: [],
        }
      },
      commit: async (commit) => {
        committedRootIds.push(commit.bindingRootId)
      },
    })

    await reconciler.start()

    expect(committedRootIds).toEqual(["new-root"])
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

describe("createWorkspaceReconciler — cross-root correlation (ODE-657)", () => {
  function twoRoots() {
    return [
      root({ id: "root-a", rootPath: "/Users/h/A" }),
      root({ id: "root-b", rootPath: "/Users/h/B" }),
    ]
  }

  it("correlates a move across roots in one pass and never detaches the origin", async () => {
    const commits: ReconcileCommit[] = []
    const bindCalls: Array<{ rootId: string; ids: Record<string, string> }> = []
    const reconciler = createWorkspaceReconciler({
      loadRoots: async () => twoRoots(),
      scanRoot: async (candidate) => {
        if (candidate.id === "root-a") {
          return {
            // The resident sibling keeps root A's volume knowable after the
            // move; without file evidence the volume is unknown and the
            // correlation refuses to match (ODE-657 review P1).
            observed: [
              observed({ relativePath: "resident.md", manifestId: "doc-resident" }),
            ],
            unbound: [],
            knownBindings: [
              known({
                documentId: "doc-a",
                bindingRootId: "root-a",
                relativePath: "letter.md",
                inode: 100,
                contentHash: "blake3:aaa",
              }),
            ],
          }
        }
        return {
          observed: [],
          unbound: [unboundFile({ relativePath: "letter.md" })],
          knownBindings: [],
        }
      },
      bindUnbound: async (candidate, ids) => {
        bindCalls.push({ rootId: candidate.id, ids })
        return [
          observed({
            relativePath: "letter.md",
            canonicalPath: "/Users/h/B/letter.md",
            inode: 100,
            contentHash: "blake3:aaa",
            manifestId: ids["letter.md"],
          }),
        ]
      },
      commit: async (commit) => {
        commits.push(commit)
      },
    })

    await reconciler.start()

    expect(reconciler.getReadiness()).toBe("ready")
    expect(bindCalls).toEqual([{ rootId: "root-b", ids: { "letter.md": "doc-a" } }])
    const commitA = commits.find((commit) => commit.bindingRootId === "root-a")
    expect(commitA?.detached, "el id correlacionado no se desliga de A").toEqual([])
    const commitB = commits.find((commit) => commit.bindingRootId === "root-b")
    expect(commitB?.upserts.map((upsert) => upsert.documentId)).toEqual(["doc-a"])
    expect(commitB?.upserts[0].bindingRootId).toBe("root-b")
  })

  it.fails(
    "no adopta una identidad de otro volumen aunque inode y hash coincidan",
    async () => {
      // Las dos raíces están en volúmenes distintos, evidenciado por el otro
      // archivo residente de cada una. El inode reutilizado en B no es un
      // movimiento de A: B acuña identidad y A desliga su binding.
      const commits: ReconcileCommit[] = []
      const reconciler = createWorkspaceReconciler({
        loadRoots: async () => twoRoots(),
        mintId,
        scanRoot: async (candidate) => {
          if (candidate.id === "root-a") {
            return {
              observed: [
                observedWithDevice({
                  relativePath: "residente-a.md",
                  manifestId: "doc-residente-a",
                  device: 1,
                }),
              ],
              unbound: [],
              knownBindings: [
                known({
                  documentId: "doc-a",
                  bindingRootId: "root-a",
                  relativePath: "letter.md",
                  inode: 100,
                  contentHash: "blake3:aaa",
                }),
              ],
            }
          }
          return {
            observed: [
              observedWithDevice({
                relativePath: "residente-b.md",
                manifestId: "doc-residente-b",
                device: 2,
              }),
            ],
            unbound: [unboundFileWithDevice({ relativePath: "letter.md", device: 2 })],
            knownBindings: [],
          }
        },
        bindUnbound: async (candidate, ids) => [
          observedWithDevice({
            relativePath: "letter.md",
            canonicalPath: `${candidate.rootPath}/letter.md`,
            inode: 100,
            contentHash: "blake3:aaa",
            manifestId: ids["letter.md"],
            device: 2,
          }),
        ],
        commit: async (commit) => {
          commits.push(commit)
        },
      })

      await reconciler.start()

      const commitB = commits.find((commit) => commit.bindingRootId === "root-b")
      expect(
        commitB?.upserts[0].documentId,
        "B no adopta la identidad de un inode de otro volumen",
      ).toMatch(/^minted-/)
      expect(commitB?.upserts.map((upsert) => upsert.documentId)).not.toContain("doc-a")
      const commitA = commits.find((commit) => commit.bindingRootId === "root-a")
      expect(commitA?.detached, "A desliga su binding: no hay correlación entre volúmenes").toEqual([
        "doc-a",
      ])
    },
  )

  it("does not bind (no extra workspace_sync) when no root has unbound files", async () => {
    const bindUnbound = vi.fn()
    const reconciler = createWorkspaceReconciler({
      loadRoots: async () => twoRoots(),
      scanRoot: async (candidate) => ({
        observed: [
          observed({
            relativePath: "letter.md",
            canonicalPath: `${candidate.rootPath}/letter.md`,
            manifestId: `doc-${candidate.id}`,
          }),
        ],
        unbound: [],
        knownBindings: [],
      }),
      bindUnbound,
      commit: async () => {},
    })

    await reconciler.start()
    expect(bindUnbound).not.toHaveBeenCalled()
  })

  it("keeps the correlated id out of the detach when bindUnbound fails, and marks failed", async () => {
    const commits: ReconcileCommit[] = []
    const reconciler = createWorkspaceReconciler({
      loadRoots: async () => twoRoots(),
      scanRoot: async (candidate) => {
        if (candidate.id === "root-a") {
          return {
            // The resident sibling keeps root A's volume knowable after the
            // move; without file evidence the volume is unknown and the
            // correlation refuses to match (ODE-657 review P1).
            observed: [
              observed({ relativePath: "resident.md", manifestId: "doc-resident" }),
            ],
            unbound: [],
            knownBindings: [
              known({
                documentId: "doc-a",
                bindingRootId: "root-a",
                relativePath: "letter.md",
                inode: 100,
                contentHash: "blake3:aaa",
              }),
            ],
          }
        }
        return {
          observed: [],
          unbound: [unboundFile({ relativePath: "letter.md" })],
          knownBindings: [],
        }
      },
      bindUnbound: async () => {
        throw new Error("manifest write failed")
      },
      commit: async (commit) => {
        commits.push(commit)
      },
    })

    await reconciler.start()

    expect(reconciler.getReadiness()).toBe("failed")
    const commitA = commits.find((commit) => commit.bindingRootId === "root-a")
    expect(commitA?.detached, "el binding stale se conserva para la próxima pasada").toEqual([])
    const commitB = commits.find((commit) => commit.bindingRootId === "root-b")
    expect(commitB?.upserts).toEqual([])
  })
})
