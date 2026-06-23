import type { CookieOptions } from "@supabase/ssr"
import { isTauriRuntimeServer } from "@/lib/runtime/detect-server"
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/shared"

const isTauriRuntime = isTauriRuntimeServer()

export const createClient = isTauriRuntime ? createDesktopClient : createWebClient

async function createDesktopClient() {
  const { createClient: createSupabaseClient } = await import("@supabase/supabase-js")
  return createSupabaseClient(supabaseUrl, supabasePublicKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function createWebClient() {
  const { createServerClient } = await import("@supabase/ssr")
  const { cookies } = await import("next/headers")
  const cookieStore = await cookies()

  return createServerClient(supabaseUrl, supabasePublicKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(
        cookiesToSet: Array<{
          name: string
          value: string
          options?: CookieOptions
        }>,
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Components cannot always set cookies.
          // Middleware refreshes auth cookies on requests.
        }
      },
    },
  })
}
