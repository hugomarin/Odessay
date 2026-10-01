/**
 * ODE-616 PR1 — carrera de reclamo del lock entre worktrees.
 *
 * Dos procesos reales compiten por el mismo lock huérfano. El test controla el
 * interleaving pausando a cada waiter justo antes del `rmSync` del lock
 * huérfano: los hijos parchean `process.stderr.write` (por donde sale el
 * `console.warn` del reclamo) y esperan un archivo `go` del test. Así, con el
 * bug, A borra y crea el lock y B —que ya observó el huérfano— borra el lock
 * recién creado: ambos lo dan por tomado y sus intervalos de hold se solapan.
 * Con el fix, solo un waiter gana la reclamación atómica y el otro espera.
 *
 * El lock vive en `$(git rev-parse --git-common-dir)`, así que el test crea un
 * repo git temporal; no toca la instancia Supabase real ni el lock compartido.
 *
 * Mutación de la Guía de review: reproducir el código viejo (en `claimOrphan`,
 * devolver siempre `true`, y saltarse la reverificación de `staleReason` antes
 * del `rmSync` del huérfano) deja rojo este caso. Cualquiera de las dos capas
 * por separado lo mantiene verde.
 */
import { execFileSync, spawn } from "node:child_process"
import type { ChildProcessByStdio } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Readable } from "node:stream"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const lockModuleUrl = pathToFileURL(join(import.meta.dirname, "..", "scripts", "lib", "supabase-lock.mjs")).href

const workerSource = `
import fs from "node:fs"
import { acquireSupabaseLock } from ${JSON.stringify(lockModuleUrl)}

const { ODE616_LOCK_CWD, ODE616_SIGNAL, ODE616_GO, ODE616_LOG, ODE616_LABEL, ODE616_HOLD_MS } = process.env

// Pausa el proceso en el primer console.warn (reclamo o espera), para que el
// test fije el interleaving de los dos waiters.
const originalWrite = process.stderr.write.bind(process.stderr)
let paused = false
process.stderr.write = (chunk, encoding, callback) => {
  if (!paused) {
    paused = true
    fs.writeFileSync(ODE616_SIGNAL, String(process.pid))
    const sleeper = new Int32Array(new SharedArrayBuffer(4))
    const deadline = Date.now() + 30000
    while (!fs.existsSync(ODE616_GO) && Date.now() < deadline) {
      Atomics.wait(sleeper, 0, 0, 20)
    }
  }
  return originalWrite(chunk, encoding, callback)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const lock = await acquireSupabaseLock({ cwd: ODE616_LOCK_CWD, waitMs: 30000, pollMs: 10 })
fs.appendFileSync(ODE616_LOG, "hold " + ODE616_LABEL + " " + Date.now() + "\\n")
await sleep(Number(ODE616_HOLD_MS))
fs.appendFileSync(ODE616_LOG, "release " + ODE616_LABEL + " " + Date.now() + "\\n")
lock.release()
`

type Waiter = {
  child: ChildProcessByStdio<null, Readable, Readable>
  output: () => string
}

const temporaryDirs: string[] = []

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createOrphanRepo(): { repoDir: string; lockPath: string } {
  const root = mkdtempSync(join(tmpdir(), "ode-616-lock-"))
  temporaryDirs.push(root)
  const repoDir = join(root, "repo")
  mkdirSync(repoDir)
  execFileSync("git", ["init", "-q"], { cwd: repoDir })
  const lockPath = join(repoDir, ".git", "odessay-supabase-local.lock")
  mkdirSync(lockPath)
  writeFileSync(
    join(lockPath, "owner.json"),
    JSON.stringify({
      pid: 999999,
      worktree: "/tmp/huerfano-ode-616",
      startedAt: "2026-10-01T00:00:00.000Z",
      command: "corrida interrumpida",
    }),
  )
  return { repoDir, lockPath }
}

function spawnWaiter(options: {
  root: string
  repoDir: string
  label: string
  logPath: string
  holdMs: number
}): { waiter: Waiter; signalPath: string; goPath: string } {
  const signalPath = join(options.root, `signal-${options.label}`)
  const goPath = join(options.root, `go-${options.label}`)
  const workerPath = join(options.root, "waiter.mjs")
  if (!existsSync(workerPath)) writeFileSync(workerPath, workerSource)
  const child = spawn(process.execPath, [workerPath], {
    env: {
      ...process.env,
      ODE616_LOCK_CWD: options.repoDir,
      ODE616_SIGNAL: signalPath,
      ODE616_GO: goPath,
      ODE616_LOG: options.logPath,
      ODE616_LABEL: options.label,
      ODE616_HOLD_MS: String(options.holdMs),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  child.stdout.on("data", (chunk) => {
    output += chunk
  })
  child.stderr.on("data", (chunk) => {
    output += chunk
  })
  return { waiter: { child, output: () => output }, signalPath, goPath }
}

async function waitForFile(file: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file)) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return existsSync(file)
}

async function waitForLog(file: string, marker: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file) && readFileSync(file, "utf8").includes(marker)) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return false
}

function waitForExit(child: ChildProcessByStdio<null, Readable, Readable>, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`el waiter no terminó en ${timeoutMs}ms: ${child.spawnargs.join(" ")}`))
    }, timeoutMs)
    child.on("exit", (code) => {
      clearTimeout(timer)
      resolve(code ?? -1)
    })
  })
}

type Interval = { label: string; start: number; end: number }

function parseIntervals(log: string): Interval[] {
  const holds = new Map<string, number>()
  const intervals: Interval[] = []
  for (const line of log.split("\n").filter(Boolean)) {
    const [kind, label, timestamp] = line.split(" ")
    if (kind === "hold") holds.set(label, Number(timestamp))
    if (kind === "release") intervals.push({ label, start: holds.get(label) ?? 0, end: Number(timestamp) })
  }
  return intervals
}

describe("lock de Supabase local entre worktrees", () => {
  it.fails(
    "serializa a dos procesos que reclaman el mismo lock huérfano",
    async () => {
      const { repoDir } = createOrphanRepo()
      const root = temporaryDirs[temporaryDirs.length - 1]
      const logPath = join(root, "holds.log")
      writeFileSync(logPath, "")

      const a = spawnWaiter({ root, repoDir, label: "A", logPath, holdMs: 1200 })
      const aSignaled = await waitForFile(a.signalPath, 10000)
      expect(aSignaled, `A no llegó al reclamo; salida: ${a.waiter.output()}`).toBe(true)

      const b = spawnWaiter({ root, repoDir, label: "B", logPath, holdMs: 1200 })
      const bSignaled = await waitForFile(b.signalPath, 10000)
      expect(bSignaled, `B no llegó al reclamo; salida: ${b.waiter.output()}`).toBe(true)

      writeFileSync(a.goPath, "go")
      const aHeld = await waitForLog(logPath, "hold A", 10000)
      expect(aHeld, `A no tomó el lock; salida: ${a.waiter.output()}`).toBe(true)

      writeFileSync(b.goPath, "go")
      const [codeA, codeB] = await Promise.all([waitForExit(a.waiter.child, 20000), waitForExit(b.waiter.child, 20000)])
      expect(codeA, `A falló; salida: ${a.waiter.output()}`).toBe(0)
      expect(codeB, `B falló; salida: ${b.waiter.output()}`).toBe(0)

      const intervals = parseIntervals(readFileSync(logPath, "utf8"))
      expect(intervals.map((interval) => interval.label).sort()).toEqual(["A", "B"])
      const [first, second] = intervals
      const overlap = first.start < second.end && second.start < first.end
      expect(
        overlap,
        `los dos waiters tuvieron el lock a la vez: ${intervals.map((i) => `${i.label}[${i.start},${i.end}]`).join(" ")}`,
      ).toBe(false)
    },
    30000,
  )
})
