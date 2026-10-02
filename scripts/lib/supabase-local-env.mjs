// ODE-616 PR1 — pieza compartida del harness Vitest ↔ Supabase local.
//
// Es el único owner de tres decisiones que el runner, el lock y el guard de
// Vitest tienen que acordar: qué host cuenta como stack local, cómo se
// traduce `supabase status -o json` al entorno que consumen los tests, y cómo
// se descarta el entorno heredado (el `.env.local` de cada worktree es un
// symlink al del checkout principal y trae la service role de PRODUCCIÓN).

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

export const LOCAL_SUPABASE_HOSTS = ["127.0.0.1", "localhost"]

export function isLocalSupabaseUrl(url) {
  if (typeof url !== "string" || url.length === 0) return false
  try {
    return LOCAL_SUPABASE_HOSTS.includes(new URL(url).hostname)
  } catch {
    return false
  }
}

export function readSupabaseStatus({ cwd = process.cwd(), command = "supabase" } = {}) {
  const result = spawnSync(command, ["status", "-o", "json"], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  if (result.error || result.status !== 0) return null
  try {
    const parsed = JSON.parse(result.stdout)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function localEnvFromStatus(status) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: status?.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: status?.ANON_KEY ?? status?.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status?.SERVICE_ROLE_KEY ?? status?.SECRET_KEY,
  }
}

export function assertLocalSupabaseEnv(env) {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL
  if (!url) {
    throw new Error("[supabase-local] falta NEXT_PUBLIC_SUPABASE_URL; usa `npm run test:supabase`.")
  }
  if (!isLocalSupabaseUrl(url)) {
    throw new Error(
      `[supabase-local] NEXT_PUBLIC_SUPABASE_URL no apunta al stack local (${url}). ` +
        "Solo se aceptan 127.0.0.1 o localhost; el harness nunca corre contra un proyecto remoto.",
    )
  }
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
  if (!publishableKey) {
    throw new Error(
      "[supabase-local] falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY local; usa `npm run test:supabase`.",
    )
  }
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error("[supabase-local] falta SUPABASE_SERVICE_ROLE_KEY local; usa `npm run test:supabase`.")
  }
  return { url, publishableKey, serviceRoleKey }
}

export function sanitizeSupabaseEnv(baseEnv, localEnv) {
  const sanitized = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (/SUPABASE/i.test(key)) continue
    if (key.startsWith("TAURI_")) continue
    sanitized[key] = value
  }
  for (const [key, value] of Object.entries(localEnv)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`[supabase-local] \`supabase status\` no devolvió ${key}; ¿está el stack local arriba?`)
    }
    sanitized[key] = value
  }
  return sanitized
}

export function resolveGitCommonDir({ cwd = process.cwd() } = {}) {
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" })
  if (result.error || result.status !== 0) return null
  const raw = result.stdout.trim()
  return raw ? path.resolve(cwd, raw) : null
}

export function readSupabaseProjectId({ cwd = process.cwd() } = {}) {
  try {
    const text = readFileSync(path.join(cwd, "supabase/config.toml"), "utf8")
    return /^project_id\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? "odessay"
  } catch {
    return "odessay"
  }
}
