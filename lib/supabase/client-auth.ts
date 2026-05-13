import { createClient } from "@supabase/supabase-js"
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/shared"

const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? ""
const storageKey = projectRef ? `sb-${projectRef}-auth-token` : "sb-auth-token"

/**
 * Cliente de Supabase para flujos de auth PKCE (reset password, email change).
 * Usa localStorage para el code_verifier, evitando problemas con cookies
 * en @supabase/ssr durante navegación cross-site (email → Supabase → app).
 *
 * El storageKey coincide exactamente con el que usa @supabase/ssr por defecto,
 * asegurando compatibilidad si ambos clientes coexisten.
 */
export const createAuthClient = () =>
  createClient(supabaseUrl, supabasePublicKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      storageKey,
      storage: {
        getItem: (key) => {
          try {
            return localStorage.getItem(key)
          } catch {
            return null
          }
        },
        setItem: (key, value) => {
          try {
            localStorage.setItem(key, value)
          } catch {}
        },
        removeItem: (key) => {
          try {
            localStorage.removeItem(key)
          } catch {}
        },
      },
    },
  })
