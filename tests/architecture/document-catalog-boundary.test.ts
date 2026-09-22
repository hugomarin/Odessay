import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

// Desk / Workspace / Search / Recent / Open Document must consume the shared
// document-catalog port (document-catalog-factory / document-service-factory),
// never the concrete adapters directly. See lib/services/document-catalog-factory.ts.
const CONSUMER_DIRS = ["components", "app"]

const forbiddenImportPatterns = [
  /^@\/lib\/services\/desktop\/sqlite-document-catalog$/,
  /^@\/lib\/services\/web-document-catalog$/,
]

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

const consumerFiles = CONSUMER_DIRS.flatMap((dir) => listFilesRecursive(resolve(process.cwd(), dir)))

describe("document catalog boundary compliance", () => {
  it("checks every component/app file", () => {
    expect(consumerFiles.length).toBeGreaterThan(0)
  })

  it("does not import concrete catalog adapters directly outside the shared factory", () => {
    for (const filePath of consumerFiles) {
      const source = readFileSync(filePath, "utf8")
      const imports = Array.from(
        source.matchAll(/from\s+["']([^"']+)["']/g),
        (match) => match[1],
      )

      for (const importPath of imports) {
        const isForbidden = forbiddenImportPatterns.some((pattern) => pattern.test(importPath))
        expect(isForbidden, `${filePath} imports concrete catalog adapter "${importPath}" — go through document-catalog-factory / document-service-factory instead`).toBe(false)
      }
    }
  })
})
