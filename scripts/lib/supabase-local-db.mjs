// ODE-616 PR1 — consultas a la instancia Postgres local del harness.
// Usa el psql del host si existe y, si no, el psql dentro del contenedor
// `supabase_db_<project_id>`; el runner lo usa para el preflight de objetos
// `zz_mutation_%` y deja el comando equivalente en los mensajes de error.

import { spawnSync } from "node:child_process"
import { readSupabaseProjectId } from "./supabase-local-env.mjs"

const MUTATION_SQL = `
select 'function ' || p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'zz_mutation_%'
union all
select 'trigger ' || t.tgname
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal and t.tgname like 'zz_mutation_%'
`.trim()

export function runLocalPsql(dbUrl, sql, { cwd = process.cwd() } = {}) {
  if (!dbUrl) throw new Error("[supabase-local] falta DB_URL; ¿está el stack local arriba?")
  const host = spawnSync("psql", [dbUrl, "-tAc", sql], { cwd, encoding: "utf8" })
  if (!host.error && host.status === 0) return { output: host.stdout.trim(), via: "psql" }

  const container = `supabase_db_${readSupabaseProjectId({ cwd })}`
  const docker = spawnSync(
    "docker",
    ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql],
    { cwd, encoding: "utf8" },
  )
  if (docker.error || docker.status !== 0) {
    const detail = (docker.stderr || host.stderr || "sin salida").trim()
    throw new Error(`[supabase-local] no pude consultar Postgres local (psql del host ni ${container}): ${detail}`)
  }
  return { output: docker.stdout.trim(), via: `docker exec ${container}` }
}

export function findMutationArtifacts(dbUrl, { cwd = process.cwd() } = {}) {
  const { output } = runLocalPsql(dbUrl, MUTATION_SQL, { cwd })
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}
