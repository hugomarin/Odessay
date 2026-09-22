import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

// Corrections admission and matching must have exactly one canonical
// implementation each — no second admission/matching engine competing with
// lib/corrections/engine/{admission,matching}.ts.
const LIB_DIR = resolve(process.cwd(), "lib")

const CANONICAL_EXPORTS: Array<{ name: string; canonicalPath: string }> = [
  { name: "admitSuggestions", canonicalPath: resolve(LIB_DIR, "corrections/engine/admission.ts") },
  { name: "findTokenBoundaryMatch", canonicalPath: resolve(LIB_DIR, "corrections/engine/matching.ts") },
]

function listFilesRecursive(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath))
    } else if (/\.ts$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(fullPath)
    }
  }
  return files
}

const libFiles = listFilesRecursive(LIB_DIR)

describe("corrections engine ownership", () => {
  for (const { name, canonicalPath } of CANONICAL_EXPORTS) {
    it(`has exactly one implementation of ${name}, at its canonical owner`, () => {
      const exportPattern = new RegExp(`export\\s+(function|const)\\s+${name}\\b`)
      const definers = libFiles.filter((filePath) => exportPattern.test(readFileSync(filePath, "utf8")))

      expect(definers, `expected exactly one definition of ${name}`).toEqual([canonicalPath])
    })
  }
})
