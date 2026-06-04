import { createClient } from "@/lib/supabase/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/shared"

/**
 * Extract the current user from a Request, supporting both web cookie auth
 * and desktop Bearer token auth.
 *
 * Order:
 * 1. Bearer token in Authorization header (desktop proxy)
 * 2. Cookie-based session via createClient() (web)
 */
export async function getCurrentUserFromRequest(
  request: Request,
): Promise<{ userId: string | null }> {
  const authHeader = request.headers.get("authorization")

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim()

    if (token) {
      try {
        const supabase = createSupabaseClient(supabaseUrl, supabasePublicKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        })

        const { data, error } = await supabase.auth.getUser(token)

        if (!error && data.user) {
          return { userId: data.user.id }
        }
      } catch {
        // Fall through to cookie auth on any failure
      }
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { userId: user?.id ?? null }
}
