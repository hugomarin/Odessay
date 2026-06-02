import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { keychainStorage } from "@/lib/auth/secure-storage"

let client: SupabaseClient | null = null

// IMPORTANT: must use createClient from @supabase/supabase-js, NOT
// createBrowserClient from @supabase/ssr. The latter hardcodes a cookie-based
// storage adapter and silently overrides any custom `auth.storage` passed in
// options (see node_modules/@supabase/ssr/dist/module/createBrowserClient.js).
// Cookies do not persist in the Tauri custom protocol; we need Keychain.
//
// Singleton: all desktop auth operations share one client instance so that
// the in-memory session written by signIn is visible to subsequent getSession()
// calls without requiring a Keychain round-trip on every operation.
//
export const createDesktopClient = (): SupabaseClient => {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
  client = createClient(url, key, {
    auth: {
      storage: keychainStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // desktop email callbacks complete in web, not in-app URLs
    },
  })
  return client
}
