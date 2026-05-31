"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { Session } from "@supabase/supabase-js"
import { Sidebar } from "@/components/navigation/sidebar"
import { createDesktopClient } from "@/lib/supabase/desktop-client"

type ShellUser = {
  displayName: string | null
  email: string | null
  username: string | null
}

const ANON_USER: ShellUser = { email: null, displayName: null, username: null }

export function DesktopAppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<ShellUser>(ANON_USER)

  useEffect(() => {
    const supabase = createDesktopClient()
    let mounted = true

    const hydrate = (session: Session | null) => {
      if (!mounted) return
      if (!session?.user) {
        router.replace("/login")
        return
      }
      const u = session.user
      setUser({
        email: u.email ?? null,
        displayName: (u.user_metadata?.display_name as string) ?? null,
        username: (u.user_metadata?.username as string) ?? null,
      })
    }

    void supabase.auth.getSession().then(({ data }) => hydrate(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => hydrate(session))

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
