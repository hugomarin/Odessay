import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const CONTRACTS_DIR = resolve(process.cwd(), "lib/services/contracts")
const contractFiles = readdirSync(CONTRACTS_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => resolve(CONTRACTS_DIR, f))

const forbiddenImportPatterns = [
  /^next(\/.*)?$/,
  /^@supabase(\/.*)?$/,
  /^@\/lib\/supabase(\/.*)?$/,
  /^cookie$/,
  /^js-cookie$/,
  /^node:fs$/,
  /^fs(\/.*)?$/,
  /^fs-extra$/,
  /^path$/,
  /^os$/,
]

const forbiddenGlobalPatterns = [
  "fetch(",
  "window.",
  "document.",
  "localStorage.",
  "sessionStorage.",
  "indexedDB.",
]

const allowedImports = new Set(["./service-types", "@/lib/writings/status"])

describe("web adapter boundary compliance", () => {
  it("checks every file in lib/services/contracts/", () => {
    expect(contractFiles.length).toBeGreaterThan(0)
  })

  it("does not import runtime-specific modules", () => {
    for (const filePath of contractFiles) {
      const source = readFileSync(filePath, "utf8")
      const imports = Array.from(
        source.matchAll(/from\s+["']([^"']+)["']/g),
        (match) => match[1],
      )

      for (const importPath of imports) {
        const isAllowed =
          allowedImports.has(importPath) ||
          forbiddenImportPatterns.every((pattern) => !pattern.test(importPath))
        expect(isAllowed).toBe(true)
      }
    }
  })

  it("does not reference browser or Node runtime globals", () => {
    for (const filePath of contractFiles) {
      const source = readFileSync(filePath, "utf8")
      for (const pattern of forbiddenGlobalPatterns) {
        expect(source.includes(pattern)).toBe(false)
      }
    }
  })
})
