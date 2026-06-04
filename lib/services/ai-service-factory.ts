"use client"

import { isTauriRuntime } from "@/lib/runtime/detect"
import { desktopAIService } from "@/lib/services/desktop-ai-service"
import { webAIService } from "@/lib/services/web-ai-service"
import type { AIService } from "@/lib/services/contracts/ai-service"

// Side-effect-free: selection is based purely on isTauriRuntime() which
// reads window.__TAURI_INTERNALS__ without mutating any state.
export function getAIService(): AIService {
  return isTauriRuntime() ? desktopAIService : webAIService
}
