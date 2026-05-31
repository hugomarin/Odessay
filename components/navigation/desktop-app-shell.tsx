"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/navigation/sidebar"
import { getAuthService } from "@/lib/services/auth-service-factory"

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
    void getAuthService()
      .getSession()
      .then((result) => {
        if (!result.data?.user) {
          router.replace("/login")
          return
        }
        const { email, displayName, username } = result.data.user
        setUser({ email: email ?? null, displayName: displayName ?? null, username: username ?? null })
      })
  }, [router])

  return (
    <Sidebar initialSidebarMode="expanded" user={user}>
      {children}
    </Sidebar>
  )
}
