"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { getAuthService } from "@/lib/services/auth-service-factory"
import { cn } from "@/lib/utils"

type SignOutButtonProps = {
  variant?: "outline" | "ghost" | "default"
  className?: string
}

export function SignOutButton({ variant = "outline", className }: SignOutButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [warning, setWarning] = useState<string | null>(null)

  const handleSignOut = () => {
    setWarning(null)
    startTransition(async () => {
      const result = await getAuthService().signOut()
      if (result.error?.code === "SIGNOUT_INCOMPLETE") {
        setWarning(result.error.message)
      }
      router.replace("/login")
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        className={cn("h-10 px-4 text-[13px]", className)}
        disabled={isPending}
        onClick={handleSignOut}
        type="button"
        variant={variant}
      >
        {isPending ? "Signing out..." : "Sign out"}
      </Button>
      {warning ? <p className="text-[12px] text-amber-600">{warning}</p> : null}
    </div>
  )
}
