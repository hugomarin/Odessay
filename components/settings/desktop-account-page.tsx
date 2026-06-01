"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AccountForm } from "@/components/settings/account-form"
import { getAuthService } from "@/lib/services/auth-service-factory"

type Account = {
  id: string
  email: string
  displayName: string
  username: string
}

export function DesktopAccountPage() {
  const router = useRouter()
  const [account, setAccount] = useState<Account | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let mounted = true
    void getAuthService()
      .getSession()
      .then((result) => {
        if (!mounted) return
        const u = result.data?.user
        if (!u || !u.email) {
          router.replace("/login?next=/settings/account")
          return
        }
        setAccount({
          id: u.id,
          email: u.email,
          displayName: u.displayName ?? "",
          username: u.username ?? "",
        })
        setLoaded(true)
      })
    return () => {
      mounted = false
    }
  }, [router])

  if (!loaded || !account) {
    return null
  }

  return <AccountForm initialAccount={account} />
}
