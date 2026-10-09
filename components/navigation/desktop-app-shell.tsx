"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/navigation/sidebar"
import { SourceExitConfirmationDialog } from "@/components/editor/source-exit-confirmation-dialog"
import { hasActiveEditorCloseGuard, useTauriCloseGuard } from "@/hooks/useTauriCloseGuard"
import { createDesktopClient } from "@/lib/supabase/desktop-client"
import { useGlobalOpenFileMenu } from "@/hooks/useGlobalOpenFileMenu"
import { useWorkspaceReconciler } from "@/hooks/useWorkspaceReconciler"
import { useCatalogEditorSessionSync } from "@/hooks/useCatalogEditorSessionSync"
import { getAuthService } from "@/lib/services/auth-service-factory"
import type { AccountIdentity } from "@/lib/services/contracts/auth-service"
import {
  clearAllRetainedUnconvertedSources,
  hasRetainedUnconvertedSources,
} from "@/lib/stores/editor-session-store"

type ShellUser = {
  displayName: string | null
  email: string | null
  username: string | null
}

const ANON_USER: ShellUser = { email: null, displayName: null, username: null }

function isWriteRoute(pathname: string) {
  return pathname === "/write" || pathname.startsWith("/write/")
}

export function shouldHandleRetainedSourceWindowClose(pathname: string) {
  if (isWriteRoute(pathname) || hasActiveEditorCloseGuard()) return false
  return hasRetainedUnconvertedSources()
}

export function DesktopAppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<ShellUser>(ANON_USER)
  const [sourceExitWarningOpen, setSourceExitWarningOpen] = useState(false)
  const sourceExitWarningResolverRef = useRef<((closeAnyway: boolean) => void) | null>(null)

  const requestSourceExitConfirmation = useCallback(() => {
    if (sourceExitWarningResolverRef.current) {
      return Promise.resolve(false)
    }

    return new Promise<boolean>((resolve) => {
      sourceExitWarningResolverRef.current = resolve
      setSourceExitWarningOpen(true)
    })
  }, [])

  const resolveSourceExitWarning = useCallback((closeAnyway: boolean) => {
    const resolve = sourceExitWarningResolverRef.current
    if (!resolve) return

    sourceExitWarningResolverRef.current = null
    setSourceExitWarningOpen(false)
    if (closeAnyway) clearAllRetainedUnconvertedSources()
    resolve(closeAnyway)
  }, [])

  const shouldHandleRetainedSourceClose = useCallback(() => {
    return shouldHandleRetainedSourceWindowClose(window.location.pathname)
  }, [])

  useTauriCloseGuard(
    async () => {
      if (!hasRetainedUnconvertedSources()) return true
      return requestSourceExitConfirmation()
    },
    shouldHandleRetainedSourceClose,
    "app",
  )

  useGlobalOpenFileMenu()
  useCatalogEditorSessionSync()
  // Mount the single app-lifetime WorkspaceReconciler (ODE-370). No-op unless the
  // desktop catalog dual-write flag is on; keeps the catalog projecting across
  // every route so a filesystem change is caught from Desk, Write or anywhere.
  useWorkspaceReconciler()

  useEffect(() => {
    const supabase = createDesktopClient()
    let mounted = true

    const applyUser = (u: AccountIdentity | null) => {
      if (!mounted || !u) return
      setUser({
        email: u.email ?? null,
        displayName: u.displayName,
        username: u.username,
      })
    }

    // Authoritative initial check: getSession reads from storage, then getUser
    // validates the token against the server. A stored token with a rotated key
    // will pass getSession but fail getUser — we force re-login in that case.
    void getAuthService().getSession().then((result) => {
      if (!mounted) return
      if (result.error || !result.data?.user) {
        router.replace("/login")
        return
      }
      applyUser(result.data.user)
    })

    // Subscribe to subsequent changes. NEVER redirect on INITIAL_SESSION or
    // TOKEN_REFRESHED with null — those can fire transiently when the layout
    // remounts on navigation, and we'd bounce the authenticated user back to
    // /login. Only redirect on explicit SIGNED_OUT.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === "SIGNED_OUT") {
        router.replace("/login")
        return
      }
      if (session?.user) {
        applyUser({
          id: session.user.id,
          email: session.user.email ?? null,
          pendingEmail: session.user.new_email ?? null,
          emailConfirmedAt: session.user.email_confirmed_at ?? null,
          displayName:
            typeof session.user.user_metadata?.display_name === "string"
              ? session.user.user_metadata.display_name
              : null,
          username:
            typeof session.user.user_metadata?.username === "string"
              ? session.user.user_metadata.username
              : null,
        })
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [router])

  useEffect(() => {
    return () => {
      const resolve = sourceExitWarningResolverRef.current
      sourceExitWarningResolverRef.current = null
      resolve?.(false)
    }
  }, [])

  return (
    <Sidebar initialSidebarMode="expanded" user={user}>
      {children}
      <SourceExitConfirmationDialog
        open={sourceExitWarningOpen}
        onOpenChange={(open) => !open && resolveSourceExitWarning(false)}
        onKeepEditing={() => resolveSourceExitWarning(false)}
        onCloseAnyway={() => resolveSourceExitWarning(true)}
      />
    </Sidebar>
  )
}
