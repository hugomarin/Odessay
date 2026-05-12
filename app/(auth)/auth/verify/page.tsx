"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

export default function AuthVerifyPage() {
  const searchParams = useSearchParams()
  const code = searchParams.get("code")

  const [confirmationUrl, setConfirmationUrl] = useState<string | null>(null)
  const [autoRedirected, setAutoRedirected] = useState(false)

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "")
    if (hash) {
      setConfirmationUrl(hash)
    }
  }, [])

  useEffect(() => {
    if (code && !autoRedirected) {
      setAutoRedirected(true)
      const url = new URL("/reset-password", window.location.origin)
      url.searchParams.set("code", code)
      window.location.replace(url.toString())
    }
  }, [code, autoRedirected])

  const handleContinue = () => {
    if (confirmationUrl) {
      window.location.href = confirmationUrl
    }
  }

  if (code) {
    return (
      <section className="space-y-8">
        <div className="space-y-2">
          <h1 className="font-lora text-[2rem] font-medium leading-[1.18] tracking-[-0.01em] text-ink">
            Redirecting...
          </h1>
          <p className="max-w-sm text-sm leading-6 text-ink-3">
            Please wait while we redirect you.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-lora text-[2rem] font-medium leading-[1.18] tracking-[-0.01em] text-ink">
          Verify your action
        </h1>
        <p className="max-w-sm text-sm leading-6 text-ink-3">
          Click below to continue with the verification process.
        </p>
      </div>

      {confirmationUrl ? (
        <Button className="h-11 w-full text-[14px]" onClick={handleContinue}>
          Continue
        </Button>
      ) : (
        <p className="rounded-[8px] border-[0.5px] border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          Invalid verification link.
        </p>
      )}
    </section>
  )
}
