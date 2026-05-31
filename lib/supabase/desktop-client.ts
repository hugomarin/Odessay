import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import { keychainStorage } from "@/lib/auth/secure-storage"

let client: SupabaseClient | null = null

// Singleton: all desktop auth operations share one client instance so that
// the in-memory session written by signIn is visible to subsequent getUser()
// calls without requiring a Keychain round-trip on every operation.
export const createDesktopClient = (): SupabaseClient => {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
  client = createBrowserClient(url, key, {
    auth: { storage: keychainStorage },
  })
  return client
}
