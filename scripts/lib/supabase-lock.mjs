// ODE-616 PR1 — lock exclusivo entre worktrees para la única instancia
// Supabase local (project_id "odessay"). Vive en
// `$(git rev-parse --git-common-dir)/odessay-supabase-local.lock`, así que
// todos los worktrees del checkout comparten el mismo archivo.
//
// mkdir es la operación atómica de adquisición; dentro queda owner.json con
// pid, worktree y hora. Un lock cuyo pid ya no existe queda huérfano (una
// corrida interrumpida) y se reclama; un lock sin owner legible espera 15
// minutos antes de considerarse caducado.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { resolveGitCommonDir } from "./supabase-local-env.mjs"

const LOCK_NAME = "odessay-supabase-local.lock"
const STALE_MS = 15 * 60 * 1000
const DEFAULT_WAIT_MS = 10 * 60 * 1000
const DEFAULT_POLL_MS = 2000

export function supabaseLockPath({ cwd = process.cwd() } = {}) {
  const commonDir = resolveGitCommonDir({ cwd })
  if (!commonDir) {
    throw new Error("[supabase-lock] no pude resolver `git rev-parse --git-common-dir`")
  }
  return path.join(commonDir, LOCK_NAME)
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "EPERM"
  }
}

function readOwner(lockPath) {
  try {
    return JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8"))
  } catch {
    return null
  }
}

// Devuelve el motivo por el que el lock está caducado, o null si sigue vivo.
function staleReason(lockPath) {
  const owner = readOwner(lockPath)
  if (owner?.pid && isPidAlive(owner.pid)) return null
  try {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs
    if (owner?.pid) return `su pid ${owner.pid} ya no existe`
    if (ageMs >= STALE_MS) return "sin owner legible y con más de 15 minutos"
    return null
  } catch {
    return "ilegible"
  }
}

export async function acquireSupabaseLock({ cwd = process.cwd(), waitMs = DEFAULT_WAIT_MS, pollMs = DEFAULT_POLL_MS } = {}) {
  const lockPath = supabaseLockPath({ cwd })
  const startedAt = Date.now()
  let announced = false

  for (;;) {
    try {
      mkdirSync(lockPath)
      writeFileSync(
        path.join(lockPath, "owner.json"),
        JSON.stringify(
          {
            pid: process.pid,
            worktree: cwd,
            startedAt: new Date().toISOString(),
            command: process.argv.join(" "),
          },
          null,
          2,
        ),
      )
      return {
        path: lockPath,
        release() {
          rmSync(lockPath, { recursive: true, force: true })
        },
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
    }

    const reason = staleReason(lockPath)
    if (reason) {
      console.warn(`[supabase-lock] lock huérfano (${reason}); lo reclamo: ${lockPath}`)
      rmSync(lockPath, { recursive: true, force: true })
      continue
    }

    if (!announced) {
      const owner = readOwner(lockPath)
      console.warn(
        `[supabase-lock] esperando el lock que tiene ${owner?.worktree ?? "otro worktree"} ` +
          `(pid ${owner?.pid ?? "?"}, desde ${owner?.startedAt ?? "?"})`,
      )
      announced = true
    }

    if (Date.now() - startedAt >= waitMs) {
      const owner = readOwner(lockPath)
      throw new Error(
        `[supabase-lock] ${lockPath} sigue tomado por ${owner?.worktree ?? "?"} ` +
          `(pid ${owner?.pid ?? "?"}, desde ${owner?.startedAt ?? "?"}) tras ${Math.round(waitMs / 1000)}s.`,
      )
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
