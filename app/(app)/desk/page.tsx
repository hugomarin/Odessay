import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SignOutButton } from "@/components/auth/sign-out-button"
import { createClient } from "@/lib/supabase/server"

export default async function DeskPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", user.id)
    .maybeSingle()

  return (
    <section
      id="desk"
      data-page="desk"
      className="min-h-screen bg-bg"
    >
      <div
        id="desk-topbar"
        data-section="desk-topbar"
        data-testid="desk-topbar"
        className="DeskTopbar flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-6"
      >
        <p className="text-[15px] text-ink-2">Desk</p>
        <SignOutButton />
      </div>

      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-16">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">
            Auth ready
          </p>
          <h1 className="font-lora text-[2.25rem] font-medium leading-[1.18] tracking-[-0.01em] text-ink">
            Welcome back, {profile?.display_name ?? "writer"}.
          </h1>
          <p className="max-w-[38rem] text-[15px] leading-7 text-ink-3">
            This is the initial protected desk for ODE-15. Signup, login, session refresh, and logout are now wired before the full desk experience lands in its own phase.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Authenticated session</CardTitle>
            <CardDescription>
              Your Supabase session is active and middleware is protecting all private routes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-[8px] border-[0.5px] border-border bg-bg px-4 py-3 text-sm text-ink-2">
              <span className="font-medium text-ink">Email:</span> {user.email}
            </div>
            <div className="rounded-[8px] border-[0.5px] border-border bg-bg px-4 py-3 text-sm text-ink-2">
              <span className="font-medium text-ink">Username:</span> {profile?.username ?? "pending"}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
