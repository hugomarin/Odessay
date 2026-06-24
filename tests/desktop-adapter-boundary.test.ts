import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const DESKTOP_SERVICES_DIR = resolve(process.cwd(), "lib/services/desktop")

const desktopServiceFiles = readdirSync(DESKTOP_SERVICES_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => resolve(DESKTOP_SERVICES_DIR, f))

const forbiddenImportPatterns = [
  /^next(\/.*)?$/,
  /^@supabase(\/.*)?$/,
  /^@\/lib\/supabase(\/.*)?$/,
  /^cookie$/,
  /^js-cookie$/,
]

const forbiddenGlobalPatterns = [
  'fetch("/api/',
  "fetch('/api/",
  "window.",
  "document.",
  "localStorage.",
  "sessionStorage.",
  "indexedDB.",
]

const allowedImports = new Set([
  "@tauri-apps/api/core",
  "@tauri-apps/api/path",
  "@tauri-apps/plugin-dialog",
  "@/lib/runtime/detect",
  "@/lib/services/contracts/document-service",
  "@/lib/services/contracts/asset-service",
  "@/lib/services/contracts/settings-service",
  "@/lib/services/contracts/sharing-service",
  "@/lib/services/contracts/service-types",
  "@/lib/services/desktop/tauri-commands",
  "@/lib/services/desktop/tauri-fs-watch",
  "@/lib/services/desktop/local-index-service",
  "@/lib/services/desktop/desktop-settings-service",
  "@/lib/services/document-service-factory",
  // Desktop-only: this module uses @supabase/supabase-js (JWT auth, no cookies/SSR)
  "@/lib/supabase/desktop-client",
  "@/lib/workspace/types",
  "@/lib/workspace/assignment",
  "@/lib/local-db",
  "@/lib/desktop/document-naming",
  "@/lib/editor/document-serialization",
  "@/lib/editor/extensions",
  "@/lib/export/to-docx",
  "@/lib/export/to-pdf",
  "@/lib/export/writing-export",
])

describe("desktop adapter boundary compliance", () => {
  it("checks every desktop service file in lib/services/desktop/", () => {
    expect(desktopServiceFiles.length).toBeGreaterThan(0)
  })

  it("does not import web runtime modules (Next.js, Supabase, cookies)", () => {
    for (const filePath of desktopServiceFiles) {
      const source = readFileSync(filePath, "utf8")
      const imports = Array.from(
        source.matchAll(/from\s+["']([^"']+)["']/g),
        (match) => match[1],
      )

      for (const importPath of imports) {
        const isAllowed =
          allowedImports.has(importPath) ||
          forbiddenImportPatterns.every((pattern) => !pattern.test(importPath))
        expect(
          isAllowed,
          `Forbidden import in ${filePath}: "${importPath}"`,
        ).toBe(true)
      }
    }
  })

  it("does not reference browser runtime globals or /api/ fetch calls", () => {
    for (const filePath of desktopServiceFiles) {
      const source = readFileSync(filePath, "utf8")
      // Strip single-line and multi-line comments to avoid false positives from docstrings
      const sourceWithoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
      for (const pattern of forbiddenGlobalPatterns) {
        expect(
          sourceWithoutComments.includes(pattern),
          `Forbidden global pattern "${pattern}" found in ${filePath}`,
        ).toBe(false)
      }
    }
  })

  it("only imports from allowed desktop-native modules or shared contracts", () => {
    for (const filePath of desktopServiceFiles) {
      const source = readFileSync(filePath, "utf8")
      const imports = Array.from(
        source.matchAll(/from\s+["']([^"']+)["']/g),
        (match) => match[1],
      )

      for (const importPath of imports) {
        const isRelative = importPath.startsWith(".")
        const isAllowed = allowedImports.has(importPath) || isRelative
        expect(
          isAllowed,
          `Unexpected external import in ${filePath}: "${importPath}"`,
        ).toBe(true)
      }
    }
  })
})
