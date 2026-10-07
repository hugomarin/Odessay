// ODE-616 PR1 — clientes reales contra la instancia Supabase local.
// Sin imports de la app: el harness no toca `createAdminClient` de producción
// ni el cliente de servidor; construye los suyos desde el entorno que fijó el
// runner (`supabase status -o json`).

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { assertLocalSupabaseEnv } from "../../../scripts/lib/supabase-local-env.mjs"

export type LocalSupabaseEnv = {
  url: string
  publishableKey: string
  serviceRoleKey: string
}

export type UserSessionTokens = {
  accessToken: string
  refreshToken: string
}

export function localSupabaseEnv(): LocalSupabaseEnv {
  return assertLocalSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })
}

export function createLocalAdminClient(): SupabaseClient {
  const env = localSupabaseEnv()
  return createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function createUserClient(user: UserSessionTokens): Promise<SupabaseClient> {
  const env = localSupabaseEnv()
  const client = createClient(env.url, env.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.setSession({
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
  })
  if (error) {
    throw new Error(`[supabase-local] setSession falló para el usuario del harness: ${error.message}`)
  }
  return client
}
