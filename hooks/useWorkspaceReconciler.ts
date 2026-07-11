"use client"

import { useEffect, useState } from "react"
import { ensureWorkspaceReconciler } from "@/lib/services/desktop/desktop-workspace-reconciler"
import type { CatalogReadiness } from "@/lib/services/desktop/workspace-reconciler"

/**
 * Mounts the single app-lifetime WorkspaceReconciler (ODE-370) and exposes its
 * catalog readiness. Intended to be called once, from DesktopAppShell, so the
 * reconciler stays active on every route. With the M1 dual-write flag off (or on
 * web) this is a no-op and readiness stays `idle`.
 *
 * Consumers read readiness through this hook — never by touching SQLite/manifests
 * directly (spec §Boundaries; requirement #9).
 */
export function useWorkspaceReconciler(): CatalogReadiness {
  const [readiness, setReadiness] = useState<CatalogReadiness>("idle")

  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let cancelled = false

    void ensureWorkspaceReconciler().then((reconciler) => {
      if (!reconciler || cancelled) return
      setReadiness(reconciler.getReadiness())
      unsubscribe = reconciler.subscribeReadiness(setReadiness)
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return readiness
}
