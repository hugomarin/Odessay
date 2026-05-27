"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { Button } from "@/components/ui/button"
import { webAuthService } from "@/lib/services/web-auth-service"
import { cn } from "@/lib/utils"

type SignOutButtonProps = {
  variant?: "outline" | "ghost" | "default"
  className?: string
}

export function SignOutButton({ variant = "outline", className }: SignOutButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleSignOut = () => {
    startTransition(async () => {
      await webAuthService.signOut()
      router.replace("/login")
      router.refresh()
    })
  }

  return (
    <Button
      className={cn("h-10 px-4 text-[13px]", className)}
      disabled={isPending}
      onClick={handleSignOut}
      type="button"
      variant={variant}
    >
      {isPending ? "Signing out..." : "Sign out"}
    </Button>
  )
}
