// ODE-616 PR1 — lock exclusivo entre worktrees para la única instancia
// Supabase local (project_id "odessay"). Vive en
// `$(git rev-parse --git-common-dir)/odessay-supabase-local.lock`, así que
// todos los worktrees del checkout comparten el mismo archivo.
//
// mkdir es la operación atómica de adquisición; dentro queda owner.json con
// pid, worktree, hora y un token único. Un lock cuyo pid ya no existe queda
// huérfano (una corrida interrumpida) y se reclama; un lock sin owner legible
// espera 15 minutos antes de considerarse caducado.
//
// El reclamo del huérfano no borra la ruta a ciegas: `mkdir <lock>.reclaim`
// es la operación atómica que elige a un solo waiter; el resto espera. Solo el
// ganador borra el lock huérfano y vuelve a competir por el mkdir del lock. Si
// el ganador muere entre el claim y el borrado, el claim queda con un pid
// muerto y el siguiente waiter lo mueve a un tombstone único (rename atómico)
// antes de reclamarlo, sin poder robar un claim fresco.
//
// `release()` verifica el token de owner antes de borrar: un proceso que perdió
// el lock (o que ya no es su dueño) no puede tumbar el lock de otro.

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { resolveGitCommonDir } from "./supabase-local-env.mjs"

const LOCK_NAME = "odessay-supabase-local.lock"
const CLAIM_SUFFIX = ".reclaim"
const STALE_MS = 15 * 60 * 1000
const CLAIM_STALE_MS = 30 * 1000
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

function readOwner(dirPath) {
  try {
    return JSON.parse(readFileSync(path.join(dirPath, "owner.json"), "utf8"))
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

function tryCreateClaim(claimPath, token) {
  try {
    mkdirSync(claimPath)
  } catch (error) {
    if (error?.code === "EEXIST") return false
    throw error
  }
  writeFileSync(
    path.join(claimPath, "owner.json"),
    JSON.stringify(
      {
        token,
        pid: process.pid,
        worktree: process.cwd(),
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  return true
}

// El derecho a borrar un lock huérfano lo da `mkdir <lock>.reclaim`: atómico y
// exclusivo. Si el claim existe y su dueño murió, se mueve a un tombstone
// único con rename (también atómico) y se reintenta; si el tombstone resulta
// tener un dueño vivo, se devuelve a su lugar y no se reclama.
function claimOrphan(lockPath, token) {
  const claimPath = `${lockPath}${CLAIM_SUFFIX}`
  if (tryCreateClaim(claimPath, token)) return true

  const claim = readOwner(claimPath)
  if (claim?.pid && isPidAlive(claim.pid)) return false

  if (!claim) {
    try {
      if (Date.now() - statSync(claimPath).mtimeMs < CLAIM_STALE_MS) return false
    } catch {
      return false
    }
  }

  const tombstone = `${claimPath}.dead.${process.pid}.${randomUUID()}`
  try {
    renameSync(claimPath, tombstone)
  } catch {
    return false
  }
  const moved = readOwner(tombstone)
  if (moved?.pid && isPidAlive(moved.pid)) {
    try {
      renameSync(tombstone, claimPath)
    } catch {
      // Si no se pudo devolver, el dueño vivo la reclamará de nuevo.
    }
    return false
  }
  rmSync(tombstone, { recursive: true, force: true })
  return tryCreateClaim(claimPath, token)
}

export async function acquireSupabaseLock({ cwd = process.cwd(), waitMs = DEFAULT_WAIT_MS, pollMs = DEFAULT_POLL_MS } = {}) {
  const lockPath = supabaseLockPath({ cwd })
  const startedAt = Date.now()
  const token = randomUUID()
  let announced = false

  for (;;) {
    try {
      mkdirSync(lockPath)
      writeFileSync(
        path.join(lockPath, "owner.json"),
        JSON.stringify(
          {
            token,
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
          const owner = readOwner(lockPath)
          if (owner?.token !== token) {
            console.warn(`[supabase-lock] no libero ${lockPath}: el owner ya no es este proceso (token distinto).`)
            return
          }
          rmSync(lockPath, { recursive: true, force: true })
        },
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
    }

    const reason = staleReason(lockPath)
    if (reason && claimOrphan(lockPath, token)) {
      console.warn(`[supabase-lock] lock huérfano (${reason}); lo reclamo: ${lockPath}`)
      if (staleReason(lockPath)) {
        rmSync(lockPath, { recursive: true, force: true })
      }
      rmSync(`${lockPath}${CLAIM_SUFFIX}`, { recursive: true, force: true })
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
