/**
 * Drains file paths macOS asked us to open (Finder "Open With", or a file
 * dropped on the Dock icon) via `take_pending_open_paths` — see
 * `src-tauri/src/lib.rs` RunEvent::Opened.
 *
 * The Rust side queues every path and only signals the frontend (no payload)
 * that the queue changed; it never hands the path over directly. That keeps
 * a single delivery path: whether this runs from the boot-time drain (cold
 * start, before any listener existed) or from the live `menu:os-open-path`
 * signal (warm runtime), it drains the same queue — so a path is never
 * delivered twice. `inFlight` coalesces concurrent callers onto one drain.
 */

let inFlight: Promise<void> | null = null

export function drainPendingOsOpenPaths(onPath: (path: string) => Promise<void>): Promise<void> {
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const paths = await invoke<string[]>("take_pending_open_paths").catch(() => [])
      // `.catch()` only guards a rejected promise. A resolved-but-non-array
      // value (e.g. a test mock's generic `mockResolvedValue(undefined)`
      // covering many unrelated `invoke` calls) would otherwise throw here
      // uncaught, since a `for...of` over a non-iterable is a sync throw
      // inside an async function — an unhandled rejection that failed CI's
      // `npm test` even when every assertion still passed (ODE-543).
      for (const path of Array.isArray(paths) ? paths : []) {
        await onPath(path)
      }
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}
