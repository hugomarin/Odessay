import { createBrowserClient } from "@supabase/ssr"
import { keychainStorage } from "@/lib/auth/secure-storage"

// Env vars are read inside the factory (not at module load) to avoid
// throwing during test module resolution when env is not configured.
export const createDesktopClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
  return createBrowserClient(url, key, {
    auth: { storage: keychainStorage },
  })
}
