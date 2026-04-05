import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { Sidebar } from "@/components/navigation/sidebar"
import { parseSidebarModeCookie, SIDEBAR_MODE_COOKIE_KEY } from "@/lib/stores/ui-shell-state"
import { createClient } from "@/lib/supabase/server"

type AppLayoutProps = Readonly<{
  children: React.ReactNode
}>

export default async function AppLayout({ children }: AppLayoutProps) {
  const cookieStore = await cookies()
  const initialSidebarMode = parseSidebarModeCookie(cookieStore.get(SIDEBAR_MODE_COOKIE_KEY)?.value)
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
    <Sidebar
      initialSidebarMode={initialSidebarMode}
      user={{
        email: user.email ?? null,
        displayName: profile?.display_name ?? null,
        username: profile?.username ?? null,
      }}
    >
      {children}
    </Sidebar>
  )
}
