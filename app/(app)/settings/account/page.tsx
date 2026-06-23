import { isTauriRuntimeServer } from "@/lib/runtime/detect-server"

const isTauriRuntime = isTauriRuntimeServer()

export default async function SettingsAccountPage() {
  if (isTauriRuntime) {
    // Static export: server-side cookies/session don't exist. Defer the fetch
    // to a client component that reads from DesktopAuthService → Keychain.
    // Otherwise, the page is pre-rendered with no user and bakes in a
    // redirect("/login") that fires on every navigation to /settings/account.
    const { DesktopAccountPage } = await import("@/components/settings/desktop-account-page")
    return <DesktopAccountPage />
  }

  return renderWebAccountPage()
}

async function renderWebAccountPage() {
  const [{ redirect }, { AccountForm }, { getCurrentAccountSettings }] = await Promise.all([
    import("next/navigation"),
    import("@/components/settings/account-form"),
    import("@/lib/supabase/queries/user"),
  ])

  const account = await getCurrentAccountSettings()

  if (!account) {
    redirect("/login?next=/settings/account")
    throw new Error("unreachable")
  }

  return <AccountForm initialAccount={account} />
}
