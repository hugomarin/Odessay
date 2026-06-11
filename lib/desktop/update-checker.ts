/**
 * Desktop update checker — Tauri updater integration.
 *
 * Checks for updates from GitHub Releases (stable channel).
 * Only runs inside the Tauri desktop runtime; no-op in web.
 *
 * Architecture Contract:
 *   Layer:        Adapter (desktop update pipeline)
 *   Runtime:      desktop
 *   Owner:        backend
 *   Invariants:
 *     - Update check is a single request (no loop).
 *     - User must consent before download/install.
 *     - Never blocks app launch; runs async after UI mounts.
 */
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { isTauriRuntime } from "@/lib/runtime/detect"

export type UpdateCheckResult =
  | { kind: "available"; update: Update }
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "skipped"; reason: "not-desktop" }

const CHECK_TIMEOUT_MS = 15_000

/**
 * Check whether a newer release exists on GitHub.
 * Returns immediately with `skipped` if not running in Tauri.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isTauriRuntime()) {
    return { kind: "skipped", reason: "not-desktop" }
  }

  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS })
    if (update) {
      return { kind: "available", update }
    }
    return { kind: "none" }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Normalize common transient errors so the UI can choose to stay silent.
    if (message.includes("timed out") || message.includes("timeout")) {
      return { kind: "error", message: "Update check timed out." }
    }
    if (message.includes("NetworkError") || message.includes("fetch")) {
      return { kind: "error", message: "Network unavailable for update check." }
    }
    return { kind: "error", message }
  }
}

/**
 * Download, install, and relaunch the app.
 * Callers should obtain explicit user consent before invoking this.
 */
export async function installUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall()
  await relaunch()
}

/**
 * Human-readable summary of an update.
 */
export function formatUpdateLabel(update: Update): string {
  return `Artifact Studio ${update.version} is available`
}
