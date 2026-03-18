"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

export function SignOutButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleSignOut = () => {
    startTransition(async () => {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.replace("/login")
      router.refresh()
    })
  }

  return (
    <Button
      className="h-10 px-4 text-[13px]"
      disabled={isPending}
      onClick={handleSignOut}
      type="button"
      variant="outline"
    >
      {isPending ? "Signing out..." : "Sign out"}
    </Button>
  )
}
