"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { getAuthService } from "@/lib/services/auth-service-factory"
import { cn } from "@/lib/utils"

type SignOutButtonProps = {
  variant?: "outline" | "ghost" | "default"
  className?: string
  /**
   * Leading glyph. The Settings nav renders "Sign out" as one of its own rows,
   * which means it needs the same 34px icon column as the rows above it.
   */
  icon?: React.ReactNode
}

export function SignOutButton({ variant = "outline", className, icon }: SignOutButtonProps) {
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
        {icon}
        {isPending ? "Signing out..." : "Sign out"}
      </Button>
      {warning ? <p className="text-[12px] text-amber-600">{warning}</p> : null}
    </div>
  )
}
