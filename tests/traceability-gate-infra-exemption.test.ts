import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// Focused regression coverage for documentation and infra/process exemptions
// in scripts/check-traceability-gate.mjs, including the allowlist boundary that
// puts ODE-XX right back when a diff touches product code.

const repoRoot = resolve(import.meta.dirname, "..")
const gateScript = join(repoRoot, "scripts", "check-traceability-gate.mjs")
const temporaryRepos: string[] = []

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function createRepository(files: Record<string, string> = {}, commitMessage = "feat: change"): {
  root: string
  base: string
  head: string
} {
  const root = mkdtempSync(join(tmpdir(), "odessay-traceability-exemption-"))
  temporaryRepos.push(root)
  git(root, "init", "-b", "main")
  git(root, "config", "user.email", "traceability@example.com")
  git(root, "config", "user.name", "Traceability Test")

  writeFileSync(join(root, "baseline.txt"), "base\n")
  git(root, "add", ".")
  git(root, "commit", "-m", "chore: baseline")
  const base = git(root, "rev-parse", "HEAD")

  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content)
  }
  git(root, "add", ".")
  git(root, "commit", "-m", commitMessage)
  const head = git(root, "rev-parse", "HEAD")

  return { root, base, head }
}

function createRepositoryWithMainMerge(): { root: string; base: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "odessay-traceability-main-merge-"))
  temporaryRepos.push(root)
  git(root, "init", "-b", "main")
  git(root, "config", "user.email", "traceability@example.com")
  git(root, "config", "user.name", "Traceability Test")

  writeFileSync(join(root, "baseline.txt"), "base\n")
  git(root, "add", ".")
  git(root, "commit", "-m", "chore: baseline")
  const base = git(root, "rev-parse", "HEAD")

  git(root, "switch", "-c", "feature")
  writeFileSync(join(root, "feature.txt"), "feature\n")
  git(root, "add", ".")
  git(root, "commit", "-m", "fix(feature): implement issue [ODE-500]")

  git(root, "switch", "main")
  writeFileSync(join(root, "main-only.txt"), "already in main\n")
  git(root, "add", ".")
  git(root, "commit", "-m", "docs: already delivered on main")
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD")

  git(root, "switch", "feature")
  git(root, "merge", "--no-ff", "main", "-m", "Merge main into feature")
  const head = git(root, "rev-parse", "HEAD")
  return { root, base, head }
}

function writePullRequestEvent(root: string, labels: string[]): string {
  const eventPath = join(root, "pr-event.json")
  writeFileSync(
    eventPath,
    JSON.stringify({ pull_request: { labels: labels.map((name) => ({ name })) } }),
  )
  return eventPath
}

function runGate(
  fixture: { root: string; base: string; head: string },
  extraEnv: Record<string, string>,
): { code: number; output: string } {
  const env = {
    ...process.env,
    GITHUB_ACTIONS: "",
    // Running this test itself inside a real GitHub Actions PR job means
    // process.env.GITHUB_EVENT_PATH points at THIS PR's own event (which may
    // carry a real "process"/"infra" label) — without clearing it here, that
    // label would leak into scenarios that assume no PR label is present.
    // Scenarios that want a label pass their own path via extraEnv, which
    // overrides this below.
    GITHUB_EVENT_PATH: "",
    TRACEABILITY_BASE_SHA: fixture.base,
    TRACEABILITY_MERGE_BASE_SHA: fixture.base,
    TRACEABILITY_HEAD_SHA: fixture.head,
    ...extraEnv,
  }
  try {
    const output = execFileSync(process.execPath, [gateScript], {
      cwd: fixture.root,
      env,
      encoding: "utf8",
    })
    return { code: 0, output }
  } catch (error) {
    const err = error as { status?: number | null; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` }
  }
}

afterEach(() => {
  for (const root of temporaryRepos.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("infra/process traceability exemption", () => {
  it("PASS: process/ branch prefix with diff limited to allowed paths", () => {
    const fixture = createRepository({
      ".github/workflows/example.yml": "name: example\non:\n  workflow_call: {}\n",
    })

    const result = runGate(fixture, { GITHUB_HEAD_REF: "process/ci-tweak" })

    expect(result.code).toBe(0)
    expect(result.output).toContain("infra/process category")
  })

  it("PASS: PR label 'process' with diff limited to allowed paths", () => {
    const fixture = createRepository({
      "docs/some-note.md": "# note\n",
      ".github/workflows/example.yml": "name: example\non:\n  workflow_call: {}\n",
    })
    const eventPath = writePullRequestEvent(fixture.root, ["process", "some-other-label"])

    const result = runGate(fixture, {
      GITHUB_HEAD_REF: "codex/unrelated-branch-name",
      GITHUB_EVENT_PATH: eventPath,
    })

    expect(result.code).toBe(0)
    expect(result.output).toContain("infra/process category")
  })

  it("PASS: documentation-only changes need no issue ID, branch prefix, or label", () => {
    const fixture = createRepository({
      ".agents/agents/example.md": "# Agent\n",
      ".claude/launch.json": "{}\n",
      ".orca-coordinator-brief.md": "# Coordinator\n",
      "artifacts/example/screenshot.png": "image evidence\n",
      "workflow/docs.json": "{}\n",
      "workflow/workflow.md": "# Workflow\n",
    })

    const result = runGate(fixture, { GITHUB_HEAD_REF: "codex/docs-update" })

    expect(result.code).toBe(0)
    expect(result.output).toContain("documentation-only diff")
  })

  it("FAIL: documentation change plus product code still needs an issue ID", () => {
    const fixture = createRepository({
      "docs/some-note.md": "# note\n",
      "components/foo.tsx": "export default function Foo() { return null }\n",
    })

    const result = runGate(fixture, { GITHUB_HEAD_REF: "codex/docs-update" })

    expect(result.code).toBe(1)
    expect(result.output).toContain("does not include an issue ID")
  })

  it("FAIL: process category but diff touches components/**", () => {
    const fixture = createRepository({
      ".github/workflows/example.yml": "name: example\non:\n  workflow_call: {}\n",
      "components/foo.tsx": "export default function Foo() { return null }\n",
    })

    const result = runGate(fixture, { GITHUB_HEAD_REF: "process/ci-tweak" })

    expect(result.code).toBe(1)
    expect(result.output).toContain("components/foo.tsx")
    expect(result.output).toContain("outside the infra/process allowlist")
  })

  it("FAIL: process category but diff touches lib/**", () => {
    const fixture = createRepository({
      "lib/foo.ts": "export const foo = 1\n",
    })

    const result = runGate(fixture, { GITHUB_HEAD_REF: "process/ci-tweak" })

    expect(result.code).toBe(1)
    expect(result.output).toContain("lib/foo.ts")
    expect(result.output).toContain("outside the infra/process allowlist")
  })

  it("FAIL: feature branch without ODE-XX and without infra/process category", () => {
    const fixture = createRepository({
      "lib/foo.ts": "export const foo = 1\n",
    })

    const result = runGate(fixture, { GITHUB_HEAD_REF: "fix-something-plain" })

    expect(result.code).toBe(1)
    expect(result.output).toContain("does not include an issue ID")
  })

  it("PASS: feature branch with ODE-XX and matching commit traceability", () => {
    const fixture = createRepository(
      { "lib/foo.ts": "export const foo = 1\n" },
      "fix(foo): does something [ODE-500]",
    )

    const result = runGate(fixture, { GITHUB_HEAD_REF: "ODE-500-fix-something" })

    expect(result.code).toBe(0)
    expect(result.output).toContain("have branch and commit traceability")
  })

  it("PASS: excludes commits already present in main from traceability comparison", () => {
    const fixture = createRepositoryWithMainMerge()

    const result = runGate(fixture, {
      GITHUB_HEAD_REF: "ODE-500-feature",
      TRACEABILITY_ISSUE_IDS: "ODE-500",
    })

    expect(result.code).toBe(0)
    expect(result.output).toContain("have branch and commit traceability")
    expect(result.output).not.toContain("already delivered on main")
  })
})
