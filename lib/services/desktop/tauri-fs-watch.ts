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

function pruneExpiredSelfWritePaths(now: number) {
  for (const [path, expiresAt] of selfWriteExpiresAtByPath) {
    if (expiresAt < now) {
      selfWriteExpiresAtByPath.delete(path)
    }
  }
}
