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

export function isOdysseyInternalPath(path: string) {
  return path.includes("/.odyssey/") || path.endsWith("/.odyssey")
}
