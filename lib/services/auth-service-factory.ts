"use client"

import { isTauriRuntime } from "@/lib/runtime/detect"
import { desktopAuthService } from "@/lib/services/desktop-auth-service"
import { webAuthService } from "@/lib/services/web-auth-service"
import type { AuthService } from "@/lib/services/contracts/auth-service"

// Side-effect-free: selection is based purely on isTauriRuntime() which
// reads window.__TAURI_INTERNALS__ without mutating any state.
export function getAuthService(): AuthService {
  return isTauriRuntime() ? desktopAuthService : webAuthService
}
