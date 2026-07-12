"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/navigation/sidebar"
import { createDesktopClient } from "@/lib/supabase/desktop-client"
import { useGlobalOpenFileMenu } from "@/hooks/useGlobalOpenFileMenu"
import { useWorkspaceReconciler } from "@/hooks/useWorkspaceReconciler"
import { useCatalogEditorSessionSync } from "@/hooks/useCatalogEditorSessionSync"
import { getAuthService } from "@/lib/services/auth-service-factory"
import type { AccountIdentity } from "@/lib/services/contracts/auth-service"

type ShellUser = {
  displayName: string | null
  email: string | null
  username: string | null
}

const ANON_USER: ShellUser = { email: null, displayName: null, username: null }

export function DesktopAppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<ShellUser>(ANON_USER)

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

  return (
    <Sidebar initialSidebarMode="expanded" user={user}>
      {children}
    </Sidebar>
  )
}
