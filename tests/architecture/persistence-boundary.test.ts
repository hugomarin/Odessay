import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import yaml from "js-yaml"
import { describe, expect, it } from "vitest"

// Enforces architecture/boundaries.yml as a ratchet: existing violations
// listed in architecture/boundaries.baseline.json are grandfathered in, but
// any file not already in the baseline that starts matching a forbidden
// pattern fails CI. See Odyssey Quality Harness spec §7.6.
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
    it(`${ruleName}: no new violations beyond the known baseline`, () => {
      const allowedViolators = new Set(baseline[ruleName] ?? [])
      const candidateFiles = rule.from.flatMap((dir) => listFilesRecursive(resolve(ROOT, dir)))

      const actualViolators = candidateFiles
        .filter((filePath) => readFileSync(filePath, "utf8").includes(rule.forbidPattern))
        .map(toRepoRelative)

      const newViolations = actualViolators.filter((filePath) => !allowedViolators.has(filePath))

      expect(newViolations, `new "${ruleName}" violations not covered by architecture/boundaries.baseline.json`).toEqual([])
    })
  }

  it("baseline entries are still real files (no stale ratchet entries)", () => {
    for (const filePaths of Object.values(baseline)) {
      for (const filePath of filePaths) {
        expect(() => readFileSync(resolve(ROOT, filePath), "utf8"), `baseline entry "${filePath}" no longer exists`).not.toThrow()
      }
    }
  })
})
