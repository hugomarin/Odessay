"use client"

import { Channel, invoke, Resource } from "@tauri-apps/api/core"

export type TauriWatchEventKind =
  | "any"
  | "other"
  | { access: { kind: string; mode?: string } }
  | { create: { kind: string } }
  | { modify: { kind: string; mode?: string } }
  | { remove: { kind: string } }

export type TauriWatchEvent = {
  type: TauriWatchEventKind
  paths: string[]
  attrs: unknown
}

type WatchOptions = {
  recursive?: boolean
  delayMs?: number
}

export type FsWatchTarget = {
  relativePath: string
  recursive: boolean
}

const DEFAULT_SELF_WRITE_SUPPRESSION_MS = 2_000
const LEGACY_WORKSPACE_DIR_NAME = [".ody", "ssey"].join("")

const selfWriteExpiresAtByPath = new Map<string, number>()

class FsWatcherResource extends Resource {}

export type UnwatchFn = () => Promise<void>

function normalizeRelativeWatchPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  return normalized === "." ? "" : normalized.replace(/^\.\//, "")
}

function relativeParentPath(path: string) {
  const separator = path.lastIndexOf("/")
  return separator === -1 ? "" : path.slice(0, separator)
}

/**
 * Derive watcher scopes from the durable BindingRoot selection. Empty
 * selectedPaths means the whole root; an exact Markdown selection observes its
 * parent non-recursively, while a selected folder remains recursive. Keeping
 * these scopes aligned with workspace_sync prevents a watcher on Documents
 * from recursively indexing unrelated files.
 */
export function deriveWatchTargets(selectedPaths: string[]): FsWatchTarget[] {
  if (selectedPaths.length === 0) {
    return [{ relativePath: "", recursive: true }]
  }

  const recursivePaths = selectedPaths
    .filter((path) => !/\.(?:md|mdx)$/i.test(path))
    .map(normalizeRelativeWatchPath)
    .filter(Boolean)
  const fileParentPaths = selectedPaths
    .filter((path) => /\.(?:md|mdx)$/i.test(path))
    .map(normalizeRelativeWatchPath)
    .map(relativeParentPath)

  const uniqueRecursivePaths = [...new Set(recursivePaths)].filter(
    (path) =>
      !recursivePaths.some(
        (parent) => parent !== path && path.startsWith(`${parent}/`),
      ),
  )
  const uniqueFileParentPaths = [...new Set(fileParentPaths)].filter(
    (path) =>
      !uniqueRecursivePaths.some(
        (parent) => path === parent || path.startsWith(`${parent}/`),
      ),
  )

  return [
    ...uniqueRecursivePaths.map((relativePath) => ({ relativePath, recursive: true })),
    ...uniqueFileParentPaths.map((relativePath) => ({ relativePath, recursive: false })),
  ]
}

export async function watchFsPaths(
  paths: string[],
  onEvent: (event: TauriWatchEvent) => void,
  options: WatchOptions = {},
): Promise<UnwatchFn> {
  if (paths.length === 0) {
    return async () => {}
  }

  // The native dialog grants a temporary filesystem scope, but that scope is
  // cleared on restart. BindingRoots are durable user consent; rehydrate each
  // root before starting its watcher so external folders remain observable.
  for (const path of paths) {
    await invoke<void>("allow_watch_path", { path })
  }

  const channel = new Channel<TauriWatchEvent>()
  channel.onmessage = onEvent

  const rid = await invoke<number>("plugin:fs|watch", {
    paths,
    options: {
      recursive: options.recursive ?? true,
      delayMs: options.delayMs,
    },
    onEvent: channel,
  })

  const watcher = new FsWatcherResource(rid)

  return async () => {
    await watcher.close()
  }
}

export function isOdessayInternalPath(path: string) {
  return path.includes("/.odessay/") || path.endsWith("/.odessay")
    || path.includes(`/${LEGACY_WORKSPACE_DIR_NAME}/`) || path.endsWith(`/${LEGACY_WORKSPACE_DIR_NAME}`)
    || path.includes("/.trash/") || path.endsWith("/.trash")
}

// macOS stores filenames on disk in NFD (decomposed) form, so FSEvents reports
// accented paths (á, é, í, ó, ú, ñ) byte-different from the NFC (composed)
// strings JS normally carries. Comparing raw strings made every self-write to
// an accented path invisible to suppression — the watcher saw it as an
// external change and woke the (expensive, full-folder-walk) reconciler on
// every single save of any document whose name or path had an accent.
function toComparablePath(path: string): string {
  return path.normalize("NFC")
}

export function markOdessaySelfWritePath(
  path: string,
  now = Date.now(),
  windowMs = DEFAULT_SELF_WRITE_SUPPRESSION_MS,
) {
  selfWriteExpiresAtByPath.set(toComparablePath(path), now + windowMs)
}

export function isRecentOdessaySelfWritePath(path: string, now = Date.now()) {
  pruneExpiredSelfWritePaths(now)
  const expiresAt = selfWriteExpiresAtByPath.get(toComparablePath(path))
  return typeof expiresAt === "number" && expiresAt >= now
}

export function isOdessaySelfWriteEvent(event: TauriWatchEvent, now = Date.now()) {
  const actionablePaths = event.paths.filter((path) => !isOdessayInternalPath(path))

  return (
    actionablePaths.length > 0 &&
    actionablePaths.every((path) => isRecentOdessaySelfWritePath(path, now))
  )
}

export function clearOdessaySelfWritePathsForTests() {
  selfWriteExpiresAtByPath.clear()
}

/**
 * Map a watcher burst to the BindingRoots it actually touches (ODE-370). Internal
 * `.odessay` paths are ignored so a self-generated manifest write never triggers
 * reconciliation. Used by the reconciler wiring to coalesce a burst into one
 * reconcile call per affected root.
 */
export function resolveActionableRootIds(
  paths: string[],
  roots: Array<{ id: string; rootPath: string }>,
): string[] {
  const actionable = paths.filter((path) => !isOdessayInternalPath(path))
  if (actionable.length === 0) return []

  const affected = new Set<string>()
  for (const root of roots) {
    const comparableRoot = toComparablePath(root.rootPath)
    const matches = actionable.some((path) => {
      const comparablePath = toComparablePath(path)
      return comparablePath === comparableRoot || comparablePath.startsWith(`${comparableRoot}/`)
    })
    if (matches) affected.add(root.id)
  }
  return Array.from(affected)
}

function pruneExpiredSelfWritePaths(now: number) {
  for (const [path, expiresAt] of selfWriteExpiresAtByPath) {
    if (expiresAt < now) {
      selfWriteExpiresAtByPath.delete(path)
    }
  }
}
