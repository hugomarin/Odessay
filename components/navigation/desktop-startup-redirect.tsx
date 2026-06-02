"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { isTauriRuntime } from "@/lib/runtime/detect"
import { createDesktopClient } from "@/lib/supabase/desktop-client"

/**
 * In the Tauri desktop build, the app always starts at `/`. This component
 * checks for a stored session and redirects to /desk (authenticated) or
 * /login (unauthenticated) so the user never sees the marketing homepage.
 *
 * On web this renders nothing — isTauriRuntime() returns false.
 */
export function DesktopStartupRedirect() {
  const router = useRouter()

  useEffect(() => {
    if (!isTauriRuntime()) return
    createDesktopClient()
      .auth.getSession()
      .then(({ data }) => {
        router.replace(data.session ? "/desk" : "/login")
      })
  }, [router])

  return null
}
