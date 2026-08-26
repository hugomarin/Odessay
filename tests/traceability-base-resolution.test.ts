import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const repoRoot = resolve(import.meta.dirname, "..")
const temporaryRepos: string[] = []

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function commit(root: string, message: string): string {
  git(root, "add", ".")
  git(root, "commit", "-m", message)
  return git(root, "rev-parse", "HEAD")
}

function createRepository(options: { processDrift?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "odessay-traceability-"))
  temporaryRepos.push(root)
  git(root, "init", "-b", "main")
  git(root, "config", "user.email", "traceability@example.com")
  git(root, "config", "user.name", "Traceability Test")

  mkdirSync(join(root, "workflow"), { recursive: true })
  writeFileSync(join(root, "workflow", "status.json"), JSON.stringify({ last_updated: "2026-08-26" }))
  writeFileSync(join(root, "workflow", "built.jsonl"), "")
  writeFileSync(join(root, "workflow", "workflow.md"), "workflow\n")
  mkdirSync(join(root, ".agents", "skills", "skill-product-manager"), { recursive: true })
  mkdirSync(join(root, ".agents", "skills", "skill-code-review"), { recursive: true })
  writeFileSync(join(root, ".agents", "skills", "skill-product-manager", "SKILL.md"), "pm\n")
  writeFileSync(join(root, ".agents", "skills", "skill-code-review", "SKILL.md"), "review\n")
  writeFileSync(join(root, "baseline.txt"), "base\n")
  commit(root, "chore: baseline")

  git(root, "switch", "-c", "feature")
  if (options.processDrift) {
    writeFileSync(join(root, "workflow", "workflow.md"), "workflow changed\n")
  } else {
    writeFileSync(join(root, "feature.txt"), "feature\n")
  }
  const prHead = commit(root, "fix(ci): traceability change [ODE-466]")

  git(root, "switch", "main")
  writeFileSync(join(root, "main.txt"), "main advanced before merge\n")
  const base = commit(root, "chore: advance main")
  git(root, "update-ref", "refs/remotes/origin/main", base)

  git(root, "switch", "-c", "merge-ref")
  git(root, "merge", "--no-ff", "feature", "-m", "Merge feature for test")
  const merge = git(root, "rev-parse", "HEAD")

  return { root, base, prHead, merge }
}

function traceabilityEnv(fixture: ReturnType<typeof createRepository>) {
  return {
    ...process.env,
    GITHUB_HEAD_REF: "codex/wf-ship-ODE-466",
    TRACEABILITY_BASE_SHA: fixture.base,
    TRACEABILITY_PR_HEAD_SHA: fixture.prHead,
    TRACEABILITY_HEAD_SHA: fixture.merge,
    TRACEABILITY_MERGE_SHA: fixture.merge,
  }
}

function runScript(root: string, script: string, env: NodeJS.ProcessEnv): string {
  return execFileSync(process.execPath, [join(repoRoot, "scripts", script)], {
    cwd: root,
    env,
    encoding: "utf8",
  })
}

afterEach(() => {
  for (const root of temporaryRepos.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("immutable Traceability range", () => {
  it("keeps every gate on the pinned PR range when main advances during the job", () => {
    const fixture = createRepository()
    const env = traceabilityEnv(fixture)

    const before = runScript(fixture.root, "check-traceability-refs.mjs", env)
    expect(before).toContain(`base=${fixture.base}`)
    expect(runScript(fixture.root, "check-process-sync.mjs", env)).toContain("pinned-environment")
    expect(runScript(fixture.root, "check-status-drift.mjs", env)).toContain(`aligned against ${fixture.base}`)
    expect(runScript(fixture.root, "check-delivery-gate.mjs", env)).toContain("have branch and commit traceability")

    git(fixture.root, "switch", "main")
    writeFileSync(join(fixture.root, "main-after-preflight.txt"), "main moved again\n")
    const advancedMain = commit(fixture.root, "chore: advance main during job")
    git(fixture.root, "update-ref", "refs/remotes/origin/main", advancedMain)
    git(fixture.root, "switch", "--detach", fixture.merge)

    const after = runScript(fixture.root, "check-traceability-refs.mjs", env)
    expect(after).toContain(`base=${fixture.base}`)
    expect(after).not.toContain(advancedMain)
    expect(runScript(fixture.root, "check-process-sync.mjs", env)).toContain("pinned-environment")
    expect(runScript(fixture.root, "check-status-drift.mjs", env)).toContain(`aligned against ${fixture.base}`)
    expect(runScript(fixture.root, "check-delivery-gate.mjs", env)).toContain("have branch and commit traceability")
  })

  it("still rejects real process drift introduced by the PR", () => {
    const fixture = createRepository({ processDrift: true })
    expect(() => runScript(fixture.root, "check-process-sync.mjs", traceabilityEnv(fixture))).toThrow()
  })
})
