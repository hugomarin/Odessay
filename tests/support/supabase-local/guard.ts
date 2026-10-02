// ODE-616 PR1 — setupFile de `vitest.supabase.config.ts`. Corre antes de que
// ningún archivo de test (y por lo tanto la app) se importe: aborta si el
// entorno no es el stack local. Es la defensa que queda cuando alguien corre
// `vitest --config vitest.supabase.config.ts` directo, sin pasar por el
// runner que sanea las variables heredadas.

import {
  assertLocalSupabaseEnv,
  localEnvFromStatus,
  readSupabaseStatus,
} from "../../../scripts/lib/supabase-local-env.mjs"

const env = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
}

assertLocalSupabaseEnv(env)

const status = readSupabaseStatus()
if (!status) {
  throw new Error(
    "[supabase-local] `supabase status -o json` falló: el stack local no está arriba o falta el CLI. " +
      "Corre la suite con `npm run test:supabase`.",
  )
}

const localEnv = localEnvFromStatus(status)
assertLocalSupabaseEnv(localEnv)

if (localEnv.NEXT_PUBLIC_SUPABASE_URL !== env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error(
    `[supabase-local] NEXT_PUBLIC_SUPABASE_URL (${env.NEXT_PUBLIC_SUPABASE_URL}) no coincide con ` +
      `\`supabase status\` (${localEnv.NEXT_PUBLIC_SUPABASE_URL}). Corre la suite con \`npm run test:supabase\`.`,
  )
}
