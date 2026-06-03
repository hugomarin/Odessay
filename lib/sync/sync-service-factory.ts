"use client"

import { isTauriRuntime } from "@/lib/runtime/detect"
import type { SyncService } from "@/lib/services/contracts/sync-service"
import { webSyncService } from "@/lib/services/web-sync-service"
import { desktopSyncService } from "@/lib/sync/desktop-sync-service"

export function getSyncService(): SyncService {
  return isTauriRuntime() ? desktopSyncService : webSyncService
}
