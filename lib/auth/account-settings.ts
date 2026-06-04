import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { getConfiguredAuthConfirmRedirectUrl } from "@/lib/auth/validation"

export function getAccountEmailChangeRedirectUrl(redirectTo?: string) {
  return getConfiguredAuthConfirmRedirectUrl(redirectTo ?? "/settings/account")
}

export async function verifyCurrentPassword(email: string, password: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabasePublicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabasePublicKey) {
    throw new Error("Missing Supabase env for password verification.")
  }

  const verificationClient = createSupabaseClient(supabaseUrl, supabasePublicKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { error } = await verificationClient.auth.signInWithPassword({
    email,
    password,
  })

  return !error
}
