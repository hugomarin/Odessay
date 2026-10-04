/**
 * Shared port composition for the desktop WorkspaceReconciler (ODE-645).
 *
 * Production (`desktop-workspace-reconciler.ts`) and the catalog seam recorder
 * (`tests/support/catalog-seam-recorder.ts`) used to build `scanRoot`,
 * `bindUnbound` and `commit` over the same collaborators — the real
 * `SqliteDocumentCatalog` plus `tauriWorkspaceSync` — in two hand-copied
 * blocks. This module owns that glue exactly once: a change here moves the
 * recorded seam and turns the drift gate red, instead of leaving the proof
 * representing a sequence production no longer emits (STALE_PROOF,
 * capability-proof-contract rule 2).
 *
 * Deliberately out of scope: `loadRoots` (production reads Settings; the
 * recorder uses synthetic roots), the Settings upsert of the narrowed scope
 * (injected through `onSelectedPathsChanged`), the fs watcher and the
 * app-lifetime singleton. This module holds no runtime state and takes no
 * AppHandle, so it is importable from both production and Vitest.
 */

import type { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import {
  tauriWorkspaceSync,
  type DesktopWorkspaceSnapshot,
} from "@/lib/services/desktop/tauri-commands"
import type {
  KnownBinding,
  ObservedFile,
  ReconcilerRoot,
  UnboundFile,
  WorkspaceReconcilerDeps,
} from "@/lib/services/desktop/workspace-reconciler"

/** Catalog surface the ports use; the canonical owner is `SqliteDocumentCatalog`. */
export type WorkspaceReconcilerPortCatalog = Pick<
  SqliteDocumentCatalog,
  "listByBindingRoot" | "applyReconcileTransaction"
>

export type WorkspaceReconcilerPorts = Pick<
  WorkspaceReconcilerDeps,
  "scanRoot" | "bindUnbound" | "commit"
>

export type WorkspaceReconcilerPortsOptions = {
  catalog: WorkspaceReconcilerPortCatalog
  /**
   * Persistence hook for the scope `workspace_sync` reports back. Production
   * passes the Settings upsert; the recorder has synthetic whole-root scopes
   * and omits it. The factory narrows `root.selectedPaths` itself before the
   * hook runs, exactly like the production adapter did.
   */
  onSelectedPathsChanged?: (
    root: ReconcilerRoot,
    selectedPaths: string[],
  ) => Promise<void>
}

/** One mapper for the scan and the bind snapshot: same wire shape, same seam. */
function observedFilesFromSnapshot(snapshot: DesktopWorkspaceSnapshot): ObservedFile[] {
  return snapshot.files.map((file) => ({
    relativePath: file.relativePath,
    canonicalPath: file.path,
    inode: file.inode || null,
    device: file.device ?? null,
    contentHash: file.contentHash || null,
    size: file.size,
    modifiedAt: file.modifiedAt,
    manifestId: file.id || null,
  }))
}

function unboundFilesFromSnapshot(snapshot: DesktopWorkspaceSnapshot): UnboundFile[] {
  return (snapshot.unboundFiles ?? []).map((file) => ({
    relativePath: file.relativePath,
    inode: file.inode || null,
    device: file.device ?? null,
    contentHash: file.contentHash || null,
    size: file.size,
    modifiedAt: file.modifiedAt,
  }))
}

export function createWorkspaceReconcilerPorts(
  options: WorkspaceReconcilerPortsOptions,
): WorkspaceReconcilerPorts {
  const { catalog, onSelectedPathsChanged } = options

  return {
    async scanRoot(root) {
      let observed: ObservedFile[] | null
      let unbound: UnboundFile[] = []
      try {
        // The manifest is the durable scope ledger. Omitting selectedPaths lets a
        // rename-correlated manifest update take effect instead of overwriting it
        // with a stale Settings path.
        //
        // `mintUnbound: false`: this scan must not mint identity. The pass
        // correlates unbound files across roots first and binds them in a
        // single later call, so the manifest never records an id the
        // correlation would have reused (ODE-657).
        const snapshot = await tauriWorkspaceSync(root.rootPath, undefined, undefined, {
          mintUnbound: false,
        })
        if (
          snapshot.selectedPaths.length !== root.selectedPaths.length ||
          snapshot.selectedPaths.some((path, index) => path !== root.selectedPaths[index])
        ) {
          root.selectedPaths = snapshot.selectedPaths
          await onSelectedPathsChanged?.(root, snapshot.selectedPaths)
        }
        observed = observedFilesFromSnapshot(snapshot)
        unbound = unboundFilesFromSnapshot(snapshot)
      } catch {
        // Permission loss / unmounted volume: temporarily unobservable, never a
        // delete. reconcileRoot treats `null` as "leave the catalog as-is".
        observed = null
        unbound = []
      }

      // Prior catalog bindings for this root are what SQLite currently believes;
      // the reconciler diffs them against `observed` to detect moves/detaches.
      // Scoped to this root (not `catalog.list()`) so a reconcile triggered by
      // the fs watcher never pulls the whole catalog or reschedules excerpt
      // hydration — this runs on every watcher burst, so its cost must stay
      // proportional to one root, not to the whole install.
      const rows = await catalog.listByBindingRoot(root.id)
      const knownBindings: KnownBinding[] = rows
        .filter((row) => row.binding?.bindingRootId === root.id)
        .map((row) => ({
          documentId: row.id,
          bindingRootId: root.id,
          relativePath: row.binding!.relativePath,
          inode: row.binding!.inode,
          contentHash: row.binding!.contentHash,
        }))

      return { observed, unbound, knownBindings }
    },
    async bindUnbound(root, ids) {
      // One manifest write for every id the pass decided (correlated or
      // minted), replacing the wrapper's own mint-and-retry second call. The
      // returned snapshot is the refreshed observed list the orchestrator
      // re-resolves before committing SQLite.
      const snapshot = await tauriWorkspaceSync(root.rootPath, undefined, ids)
      return observedFilesFromSnapshot(snapshot)
    },
    async commit(commit) {
      await catalog.applyReconcileTransaction(commit)
    },
  }
}
