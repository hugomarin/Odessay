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

const DEFAULT_SELF_WRITE_SUPPRESSION_MS = 2_000

const selfWriteExpiresAtByPath = new Map<string, number>()

class FsWatcherResource extends Resource {}

export type UnwatchFn = () => Promise<void>

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
    || path.includes("/.trash/") || path.endsWith("/.trash")
}

export function markOdessaySelfWritePath(
  path: string,
  now = Date.now(),
  windowMs = DEFAULT_SELF_WRITE_SUPPRESSION_MS,
) {
  selfWriteExpiresAtByPath.set(path, now + windowMs)
}

export function isRecentOdessaySelfWritePath(path: string, now = Date.now()) {
  pruneExpiredSelfWritePaths(now)
  const expiresAt = selfWriteExpiresAtByPath.get(path)
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
    const matches = actionable.some(
      (path) => path === root.rootPath || path.startsWith(`${root.rootPath}/`),
    )
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
