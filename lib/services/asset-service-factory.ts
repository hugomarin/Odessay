"use client"

import { isTauriRuntime } from "@/lib/runtime/detect"
import { desktopAssetService } from "@/lib/services/desktop/desktop-asset-service"
import { webAssetService } from "@/lib/services/web-asset-service"
import type { AssetService } from "@/lib/services/contracts/asset-service"

export function getAssetService(): AssetService {
  return isTauriRuntime() ? desktopAssetService : webAssetService
}
