import { createBrowserClient } from "@supabase/ssr"
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/shared"

export const createClient = () =>
  createBrowserClient(supabaseUrl, supabasePublicKey, {
    cookies: {
      getAll() {
        return document.cookie.split(";").map((cookie) => {
          const [name, ...rest] = cookie.trim().split("=")
          return { name, value: rest.join("=") }
        })
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`
          if (options) {
            if (options.path) cookieString += `; Path=${options.path}`
            if (options.maxAge) cookieString += `; Max-Age=${options.maxAge}`
            if (options.expires) cookieString += `; Expires=${options.expires.toUTCString()}`
            if (options.domain) cookieString += `; Domain=${options.domain}`
            if (options.sameSite) cookieString += `; SameSite=${options.sameSite}`
            if (options.secure) cookieString += `; Secure`
            if (options.httpOnly) cookieString += `; HttpOnly`
          }
          document.cookie = cookieString
        })
      },
    },
  })
