#!/usr/bin/env node
// ODE-616 PR1 — `npm run supabase:locked -- <comando>`. Corre cualquier
// comando que toque la instancia Supabase local compartida bajo el mismo lock
// entre worktrees que `npm run test:supabase`, con el entorno heredado
// *SUPABASE* / TAURI_* descartado. Es el camino para pgTAP
// (`supabase test db --local`), psql, DDL y aplicar migraciones.

import { spawnSync } from "node:child_process"
import { acquireSupabaseLock } from "./lib/supabase-lock.mjs"
import {
  assertLocalSupabaseEnv,
  localEnvFromStatus,
  readSupabaseStatus,
  sanitizeSupabaseEnv,
} from "./lib/supabase-local-env.mjs"

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error("uso: npm run supabase:locked -- <comando> [args...]")
  process.exit(1)
}

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
      "[supabase:locked] `supabase status -o json` falló: el stack local no está arriba. " +
        "Levántalo con `supabase start` antes de correr el comando.",
    )
  }

  const localEnv = localEnvFromStatus(status)
  assertLocalSupabaseEnv(localEnv)

  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: sanitizeSupabaseEnv(process.env, localEnv),
    shell: process.platform === "win32",
  })
  process.exitCode = result.status ?? 1
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  release()
}
