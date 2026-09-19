import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import yaml from "js-yaml"
import { describe, expect, it } from "vitest"

// Enforces architecture/boundaries.yml as a ratchet: the baseline in
// architecture/boundaries.baseline.json must equal the actual set of current
// violations, exactly. A file that starts violating without being added to
// the baseline fails CI, and so does a baseline entry that has stopped
// violating — the baseline can only shrink, never linger, so paid-down debt
// cannot silently reappear in the same file. See Odyssey Quality Harness
// spec §7.6.
const ROOT = process.cwd()

type BoundaryRule = {
  from: string[]
  forbidPattern: string
}

type BoundariesConfig = {
  boundaries: Record<string, BoundaryRule>
}

const config = yaml.load(readFileSync(resolve(ROOT, "architecture/boundaries.yml"), "utf8")) as BoundariesConfig
const baseline = JSON.parse(readFileSync(resolve(ROOT, "architecture/boundaries.baseline.json"), "utf8")) as Record<string, string[]>

function listFilesRecursive(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
      files.push(fullPath)
    }
  }
  return files
}

function toRepoRelative(absolutePath: string): string {
  return absolutePath.slice(ROOT.length + 1)
}

describe("persistence boundary ratchet", () => {
  for (const [ruleName, rule] of Object.entries(config.boundaries)) {
    it(`${ruleName}: baseline equals the actual set of violations, exactly`, () => {
      const baselineEntries = new Set(baseline[ruleName] ?? [])
      const candidateFiles = rule.from.flatMap((dir) => listFilesRecursive(resolve(ROOT, dir)))

      const actualViolators = new Set(
        candidateFiles
          .filter((filePath) => readFileSync(filePath, "utf8").includes(rule.forbidPattern))
          .map(toRepoRelative),
      )

      const newViolations = [...actualViolators].filter((filePath) => !baselineEntries.has(filePath))
      const staleBaselineEntries = [...baselineEntries].filter((filePath) => !actualViolators.has(filePath))

      expect(newViolations, `new "${ruleName}" violations not covered by architecture/boundaries.baseline.json`).toEqual([])
      expect(staleBaselineEntries, `"${ruleName}" baseline entries that no longer violate — remove them from architecture/boundaries.baseline.json so the debt can't silently reappear there`).toEqual([])
    })
  }
})
