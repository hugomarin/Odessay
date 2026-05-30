import { Sidebar } from "@/components/navigation/sidebar"
import { UserSettingsProvider } from "@/components/settings/user-settings-provider"

const isTauriBuild = process.env.TAURI_BUILD === "true"

type AppLayoutProps = Readonly<{
  children: React.ReactNode
}>

export default async function AppLayout({ children }: AppLayoutProps) {
  if (isTauriBuild) {
    return (
      <UserSettingsProvider>
        <Sidebar
          initialSidebarMode="expanded"
          user={{ email: null, displayName: null, username: null }}
        >
          {children}
        </Sidebar>
      </UserSettingsProvider>
    )
  }

  return renderWebAppLayout({ children })
}

async function renderWebAppLayout({ children }: AppLayoutProps) {
  const [
    { cookies },
    { redirect },
    { createClient },
    { parseSidebarModeCookie, SIDEBAR_MODE_COOKIE_KEY },
  ] = await Promise.all([
    import("next/headers"),
    import("next/navigation"),
    import("@/lib/supabase/server"),
    import("@/lib/stores/ui-shell-state"),
  ])

  const cookieStore = await cookies()
  const initialSidebarMode = parseSidebarModeCookie(cookieStore.get(SIDEBAR_MODE_COOKIE_KEY)?.value)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
    throw new Error("unreachable")
  }

  const authedUser = user

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", authedUser.id)
    .maybeSingle()

  return (
    <UserSettingsProvider>
      <Sidebar
        initialSidebarMode={initialSidebarMode}
        user={{
          email: authedUser.email ?? null,
          displayName: profile?.display_name ?? null,
          username: profile?.username ?? null,
        }}
      >
        {children}
      </Sidebar>
    </UserSettingsProvider>
  )
}
