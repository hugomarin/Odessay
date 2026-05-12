import { createClient } from "@supabase/supabase-js"
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/shared"

/**
 * Cliente de Supabase para flujos de auth (reset password, email change).
 * Usa localStorage para el PKCE code_verifier en lugar de cookies,
 * evitando problemas de compatibilidad con @supabase/ssr v0.9.0.
 *
 * NOTA: Este cliente solo debe usarse para operaciones de auth donde
 * el usuario permanece en el mismo navegador (forgot-password, reset-password).
 * Para operaciones regulares de sesión, usar createClient de @/lib/supabase/client.
 */
export const createAuthClient = () =>
  createClient(supabaseUrl, supabasePublicKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      storageKey: "odessay-auth-token",
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
