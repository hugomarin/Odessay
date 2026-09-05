import { DesktopAppShell } from "@/components/navigation/desktop-app-shell"
import { Sidebar } from "@/components/navigation/sidebar"
import { UserSettingsProvider } from "@/components/settings/user-settings-provider"
import { VocabularyCatalogBridge } from "@/components/vocabulary/vocabulary-provider"
import { isTauriRuntimeServer } from "@/lib/runtime/detect-server"

const isTauriRuntime = isTauriRuntimeServer()

type AppLayoutProps = Readonly<{
  children: React.ReactNode
}>

export default async function AppLayout({ children }: AppLayoutProps) {
  if (isTauriRuntime) {
    return (
      <UserSettingsProvider>
        <VocabularyCatalogBridge />
        <DesktopAppShell>{children}</DesktopAppShell>
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
      <VocabularyCatalogBridge />
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
