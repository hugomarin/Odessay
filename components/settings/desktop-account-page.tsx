"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AccountForm } from "@/components/settings/account-form"
import { Button } from "@/components/ui/button"
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
  const [unverified, setUnverified] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Only a genuine anonymous session justifies a redirect, and it may fire at
  // most once. The previous version redirected on any failed getSession()
  // (including offline transport errors) and, with `router` in the effect
  // deps, looped history.replaceState until WebKit killed the app (ODE-415).
  const redirectFiredRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const result = await getAuthService().getSession()
    const user = result.data?.user

    if (user?.email) {
      setAccount({
        id: user.id,
        email: user.email,
        displayName: user.displayName ?? "",
        username: user.username ?? "",
      })
      setUnverified(result.data?.status === "unverified")
      setLoading(false)
      return
    }

    if (result.error) {
      // Session could not be verified and no local identity exists: degrade
      // with a retryable error state, never redirect on a network condition.
      setLoadError(result.error.message)
      setLoading(false)
      return
    }

    // Genuine anonymous session: a single bounded navigation, never a loop.
    if (!redirectFiredRef.current) {
      redirectFiredRef.current = true
      router.replace("/login?next=/settings/account")
    }
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  // When connectivity comes back while the error state is visible, retry once
  // per online event so the view converges without restarting the app.
  useEffect(() => {
    if (!loadError) return
    const onOnline = () => void load()
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [loadError, load])

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-[8px] border-[0.5px] border-border p-4 text-[13px] text-ink-3"
      >
        <p>Could not load your account. Check your connection and try again.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    )
  }

  if (loading || !account) {
    return null
  }

  return (
    <div className="space-y-4">
      {unverified ? (
        <p className="rounded-[8px] border-[0.5px] border-border px-4 py-3 text-[13px] text-ink-4">
          You appear to be offline. Showing your locally stored account data; changes will sync
          when you reconnect.
        </p>
      ) : null}
      <AccountForm initialAccount={account} />
    </div>
  )
}
