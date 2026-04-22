import { redirect } from "next/navigation"
import { AccountForm } from "@/components/settings/account-form"
import { getCurrentAccountSettings } from "@/lib/supabase/queries/user"

export default async function SettingsAccountPage() {
  const account = await getCurrentAccountSettings()

  if (!account) {
    redirect("/login?next=/settings/account")
  }

  return <AccountForm initialAccount={account} />
}
