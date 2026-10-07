#!/usr/bin/env node
// ODE-616 PR1 — `npm run test:supabase`, el único punto de entrada del
// harness Vitest ↔ Supabase local. Toma el lock entre worktrees, aborta si el
// stack local no está arriba, falla si quedaron objetos `zz_mutation_%` de una
// corrida interrumpida y le entrega a Vitest un entorno donde toda variable
// heredada *SUPABASE* o TAURI_* fue descartada (el `.env.local` del worktree
// apunta a la service role de PRODUCCIÓN).
//
// Acepta archivos concretos: `npm run test:supabase -- tests/integration/...`.
// Sin archivos, Vitest corre toda la suite `.supabase.test.*`. Nunca hay
// `passWithNoTests`: 0 tests es un fallo.

import { spawnSync } from "node:child_process"
import { acquireSupabaseLock } from "./lib/supabase-lock.mjs"
import {
  assertLocalSupabaseEnv,
  localEnvFromStatus,
  readSupabaseStatus,
  sanitizeSupabaseEnv,
} from "./lib/supabase-local-env.mjs"
import { findMutationArtifacts } from "./lib/supabase-local-db.mjs"

const vitestBin = process.platform === "win32" ? "vitest.cmd" : "vitest"

const lock = await acquireSupabaseLock()
const release = () => lock.release()
process.once("SIGINT", () => {
  release()
  process.exit(130)
})
process.once("SIGTERM", () => {
  release()
  process.exit(143)
})

try {
  const status = readSupabaseStatus()
  if (!status) {
    throw new Error(
      "[test:supabase] `supabase status -o json` falló: el stack local no está arriba. " +
        "Levántalo con `supabase start` antes de correr la suite.",
    )
  }

  const localEnv = localEnvFromStatus(status)
  assertLocalSupabaseEnv(localEnv)

  const mutations = findMutationArtifacts(status.DB_URL)
  if (mutations.length > 0) {
    throw new Error(
      `[test:supabase] la instancia local tiene objetos zz_mutation_% sin limpiar: ${mutations.join(", ")}. ` +
        'Bórralos con `npm run supabase:locked -- psql "<DB_URL>" -c "drop trigger/function ..."` antes de continuar.',
    )
  }

  const result = spawnSync(vitestBin, ["run", "--config", "vitest.supabase.config.ts", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: sanitizeSupabaseEnv(process.env, localEnv),
  })
  process.exitCode = result.status ?? 1
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  release()
}
