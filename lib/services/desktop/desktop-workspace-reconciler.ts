"use client"

/**
 * Desktop wiring for the WorkspaceReconciler (ODE-370, Fase 9 M2).
 *
 * Binds the pure reconciler to Tauri: BindingRoots come from desktop settings,
 * scans come from `workspace_sync` (manifest v2), and commits go through the
 * SQLite `DocumentCatalog`. A module-level singleton guarantees exactly one
 * reconciler + one watcher for the whole app lifetime, so route remounts of
 * DesktopAppShell never create duplicate watchers.
 *
 * Everything here is gated by the M1 dual-write feature flag: with the flag off
 * the reconciler is inert and desktop behaves exactly as before this slice.
 */

import { appConfigDir, join } from "@tauri-apps/api/path"
import { isDesktopCatalogDualWriteEnabled } from "@/lib/services/desktop/catalog-feature-flag"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"
import {
  resolveActionableRootIds,
  watchFsPaths,
  type UnwatchFn,
} from "@/lib/services/desktop/tauri-fs-watch"
import { tauriWorkspaceSync } from "@/lib/services/desktop/tauri-commands"
import {
  createWorkspaceReconciler,
  type KnownBinding,
  type ObservedFile,
  type ReconcilerRoot,
  type WorkspaceReconciler,
} from "@/lib/services/desktop/workspace-reconciler"

const MANAGED_ROOT_DIRNAME = "artifact-studio-managed"

type Runtime = {
  reconciler: WorkspaceReconciler
  unwatch: UnwatchFn | null
  disposed: boolean
}

let runtimePromise: Promise<Runtime | null> | null = null

async function configureRootWatcher(
  runtime: Runtime,
  roots: ReconcilerRoot[],
): Promise<void> {
  if (runtime.unwatch) {
    await runtime.unwatch()
    runtime.unwatch = null
  }

  const watchPaths = roots.flatMap((root) =>
    root.selectedPaths.length > 0
      ? root.selectedPaths.map((selected) => `${root.rootPath}/${selected}`)
      : [root.rootPath],
  )
  const rootRefs = roots.map((root) => ({ id: root.id, rootPath: root.rootPath }))

  if (watchPaths.length === 0 || runtime.disposed) return

  runtime.unwatch = await watchFsPaths(
    watchPaths,
    (event) => {
      for (const rootId of resolveActionableRootIds(event.paths, rootRefs)) {
        runtime.reconciler.notifyRootChanged(rootId)
      }
    },
    { recursive: true, delayMs: 300 },
  )
}

function toReconcilerRoot(record: {
  id: string
  rootPath: string
  kind: "managed" | "external"
  visibleAsWorkspace: boolean
  selectedPaths: string[]
}): ReconcilerRoot {
  return {
    id: record.id,
    rootPath: record.rootPath,
    kind: record.kind,
    visibleAsWorkspace: record.visibleAsWorkspace,
    selectedPaths: record.selectedPaths,
  }
}

async function buildRuntime(): Promise<Runtime | null> {
  if (!isDesktopRuntime() || !isDesktopCatalogDualWriteEnabled()) return null

  const configDir = await appConfigDir()
  const settings = new DesktopSettingsService(configDir)
  const catalog = new SqliteDocumentCatalog(
    await join(configDir, "desktop-index.sqlite3"),
  )

  const loadRoots = async (): Promise<ReconcilerRoot[]> => {
    const managedPath = await join(configDir, MANAGED_ROOT_DIRNAME)
    await settings.ensureManagedRoot(managedPath)
    const roots = await settings.getBindingRoots()
    return roots.map(toReconcilerRoot)
  }

  const reconciler = createWorkspaceReconciler({
    loadRoots,
    async scanRoot(root) {
      let observed: ObservedFile[] | null
      try {
        const snapshot = await tauriWorkspaceSync(root.rootPath, root.selectedPaths)
        observed = snapshot.files.map((file) => ({
          relativePath: file.relativePath,
          canonicalPath: file.path,
          inode: file.inode || null,
          contentHash: file.contentHash || null,
          size: file.size,
          modifiedAt: file.modifiedAt,
          manifestId: file.id || null,
        }))
      } catch {
        // Permission loss / unmounted volume: temporarily unobservable, never a
        // delete. reconcileRoot treats `null` as "leave the catalog as-is".
        observed = null
      }

      // Prior catalog bindings for this root are what SQLite currently believes;
      // the reconciler diffs them against `observed` to detect moves/detaches.
      const rows = await catalog.list({ limit: 5000 })
      const knownBindings: KnownBinding[] = rows
        .filter((row) => row.binding?.bindingRootId === root.id)
        .map((row) => ({
          documentId: row.id,
          bindingRootId: root.id,
          relativePath: row.binding!.relativePath,
          inode: row.binding!.inode,
          contentHash: row.binding!.contentHash,
        }))

      return { observed, knownBindings }
    },
    async commit(commit) {
      await catalog.applyReconcileTransaction(commit)
    },
  })

  const runtime: Runtime = { reconciler, unwatch: null, disposed: false }

  await reconciler.start()

  // Watch every registered root scope and coalesce bursts per affected root.
  try {
    const roots = await loadRoots()
    await configureRootWatcher(runtime, roots)
  } catch {
    // A watcher that fails to start leaves the catalog visible-but-stale; the
    // startup projection already ran, and rescanAll can recover on focus.
  }

  return runtime
}

/** Idempotently start the single app-lifetime reconciler. Safe to call on every mount. */
export async function ensureWorkspaceReconciler(): Promise<WorkspaceReconciler | null> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime().catch(() => null)
  }
  const runtime = await runtimePromise
  return runtime?.reconciler ?? null
}

/**
 * Reload roots after Workspace adoption, project them to SQLite immediately,
 * and rebuild the global watcher so the new root is observed on every route.
 */
export async function refreshWorkspaceReconcilerRoots(): Promise<void> {
  // Workspace adoption can run before DesktopAppShell's effect has initialized
  // this module (and dev/HMR can evaluate the route chunk first). Ensure the
  // singleton exists instead of silently treating a missing runtime as success.
  await ensureWorkspaceReconciler()
  const runtime = runtimePromise ? await runtimePromise : null
  if (!runtime || runtime.disposed) return

  await runtime.reconciler.rescanAll()

  const configDir = await appConfigDir()
  const settings = new DesktopSettingsService(configDir)
  const roots = (await settings.getBindingRoots()).map(toReconcilerRoot)
  try {
    await configureRootWatcher(runtime, roots)
  } catch {
    // The root is already projected to SQLite. A watcher restart failure leaves
    // it visible-but-stale and must not make the completed adoption look failed;
    // the next app start or explicit rescan can recover observation.
  }
}

/** Tear down the reconciler and its watcher (used only in tests / full teardown). */
export async function disposeWorkspaceReconciler(): Promise<void> {
  const runtime = runtimePromise ? await runtimePromise : null
  if (runtime) {
    runtime.disposed = true
    runtime.reconciler.dispose()
    if (runtime.unwatch) await runtime.unwatch()
  }
  runtimePromise = null
}
