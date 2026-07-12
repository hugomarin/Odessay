"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { Session } from "@supabase/supabase-js"
import { Sidebar } from "@/components/navigation/sidebar"
import { createDesktopClient } from "@/lib/supabase/desktop-client"
import { useGlobalOpenFileMenu } from "@/hooks/useGlobalOpenFileMenu"
import { useWorkspaceReconciler } from "@/hooks/useWorkspaceReconciler"
import { useCatalogEditorSessionSync } from "@/hooks/useCatalogEditorSessionSync"

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

    const applySession = (session: Session | null) => {
      if (!mounted || !session?.user) return
      const u = session.user
      setUser({
        email: u.email ?? null,
        displayName: (u.user_metadata?.display_name as string) ?? null,
        username: (u.user_metadata?.username as string) ?? null,
      })
    }

    // Authoritative initial check: getSession reads from storage, then getUser
    // validates the token against the server. A stored token with a rotated key
    // will pass getSession but fail getUser — we force re-login in that case.
    void supabase.auth.getSession().then(async ({ data: sessionData }) => {
      if (!mounted) return
      if (!sessionData.session?.user) {
        router.replace("/login")
        return
      }
      const { error: userError } = await supabase.auth.getUser()
      if (!mounted) return
      if (userError) {
        // Token invalid (e.g., rotated key) — force re-login
        router.replace("/login")
        return
      }
      applySession(sessionData.session)
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
      applySession(session)
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
