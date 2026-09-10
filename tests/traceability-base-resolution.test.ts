import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { githubCompareCommitSubjects } from "../scripts/lib/traceability-github.mjs"

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

  const prBranchPoint = git(root, "merge-base", base, prHead)
  return { root, base, prHead, prBranchPoint, merge }
}

function traceabilityEnv(fixture: ReturnType<typeof createRepository>) {
  return {
    ...process.env,
    // A shared PR keeps its historical head branch name when another issue is
    // added later. CI pins the new issue IDs from the PR title.
    GITHUB_HEAD_REF: "codex/wf-ship-ODE-465",
    TRACEABILITY_BASE_SHA: fixture.base,
    TRACEABILITY_MERGE_BASE_SHA: fixture.base,
    TRACEABILITY_PR_HEAD_SHA: fixture.prHead,
    TRACEABILITY_PR_BRANCH_POINT_SHA: fixture.prBranchPoint,
    TRACEABILITY_HEAD_SHA: fixture.merge,
    TRACEABILITY_MERGE_SHA: fixture.merge,
    TRACEABILITY_ISSUE_IDS: "ODE-465,ODE-466",
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
    const deliveryBefore = runScript(fixture.root, "check-delivery-gate.mjs", env)
    expect(deliveryBefore).toContain(`Comparing ${fixture.prBranchPoint}..${fixture.prHead} for commit traceability`)
    expect(deliveryBefore).toContain("have branch and commit traceability")

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
    const deliveryAfter = runScript(fixture.root, "check-delivery-gate.mjs", env)
    expect(deliveryAfter).toContain(`Comparing ${fixture.prBranchPoint}..${fixture.prHead} for commit traceability`)
    expect(deliveryAfter).toContain("have branch and commit traceability")
  })

  it("still rejects real process drift introduced by the PR", () => {
    const fixture = createRepository({ processDrift: true })
    expect(() => runScript(fixture.root, "check-process-sync.mjs", traceabilityEnv(fixture))).toThrow()
  })
})

describe("GitHub traceability comparison", () => {
  it("paginates the immutable range and returns complete commit evidence", async () => {
    const requests: URL[] = []
    const pages = [
      {
        total_commits: 3,
        commits: [
          { commit: { message: "feat: first [ODE-504]\nbody" } },
          { commit: { message: "fix: second [ODE-504]" } },
        ],
      },
      {
        total_commits: 3,
        commits: [{ commit: { message: "test: third [ODE-504]" } }],
      },
    ]
    const fetchImpl = async (url: URL) => {
      requests.push(url)
      return new Response(JSON.stringify(pages[requests.length - 1]), { status: 200 })
    }

    const subjects = await githubCompareCommitSubjects({
      repository: "hugomarin/Odessay",
      base: "base-sha",
      head: "head-sha",
      token: "test-token",
      fetchImpl,
    })

    expect(subjects).toEqual([
      "feat: first [ODE-504]",
      "fix: second [ODE-504]",
      "test: third [ODE-504]",
    ])
    expect(requests.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"])
  })

  it("rejects a partial comparison instead of accepting missing commits", async () => {
    let requestCount = 0
    const fetchImpl = async () => {
      requestCount += 1
      return new Response(JSON.stringify({
        total_commits: 2,
        commits: requestCount === 1
          ? [{ commit: { message: "feat: only first [ODE-504]" } }]
          : [],
      }), { status: 200 })
    }

    await expect(githubCompareCommitSubjects({
      repository: "hugomarin/Odessay",
      base: "base-sha",
      head: "head-sha",
      fetchImpl,
    })).rejects.toThrow("returned only 1 of 2 commits")
  })
})
