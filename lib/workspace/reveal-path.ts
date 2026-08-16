"use client"

import { open } from "@tauri-apps/plugin-shell"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

/**
 * Opens a workspace folder with the system's default file manager.
 *
 * The desktop shell currently registers `shell:allow-open` only, so this uses
 * the generic `open` primitive. On macOS this opens the folder in Finder rather
 * than revealing it with `open -R`; a true reveal action will need the
 * `shell:allow-execute` capability (or `@tauri-apps/plugin-opener`) once the
 * design brief requires it.
 */
export async function revealWorkspacePath(path: string): Promise<void> {
  if (!isDesktopRuntime()) {
    return
  }

  try {
    await open(path)
  } catch (error) {
    console.error("[workspace:reveal] failed to reveal path", path, error)
    throw error instanceof Error ? error : new Error("Could not open folder")
  }
}
