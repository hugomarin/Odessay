/**
 * ODE-225: Desktop bundle — filesystem I/O capability validation.
 *
 * Verifies that the bundle is configured for local file access and that
 * the FilesystemDocumentService adapter exists and respects the desktop
 * boundary rules (no web-only imports, no /api/ calls).
 *
 * Runtime validation of actual file creation/persistence is covered by
 * the semi-manual checklist in docs/desktop-distribution.md §Local file I/O.
 */
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

const root = resolve(process.cwd())
const cargoToml = resolve(root, "src-tauri/Cargo.toml")
const capabilities = resolve(root, "src-tauri/capabilities/default.json")
const fsDocService = resolve(root, "lib/services/desktop/filesystem-document-service.ts")
const tauriCommands = resolve(root, "lib/services/desktop/tauri-commands.ts")

describe("desktop file-io — capabilities and service boundary", () => {
  it("tauri-plugin-fs is present in Cargo.toml with watch feature", () => {
    expect(existsSync(cargoToml)).toBe(true)
    const cargo = readFileSync(cargoToml, "utf8")
    expect(cargo).toMatch(/tauri-plugin-fs/)
    expect(cargo).toMatch(/watch/)
  })

  it("capabilities/default.json grants fs access to $DOCUMENT/**", () => {
    expect(existsSync(capabilities)).toBe(true)
    const caps = JSON.parse(readFileSync(capabilities, "utf8"))
    const permissions: unknown[] = caps.permissions ?? []
    const fsPerms = permissions.filter(
      (p) =>
        (typeof p === "string" && p.startsWith("fs:")) ||
        (typeof p === "object" && p !== null && (p as Record<string, unknown>).identifier === "fs:default"),
    )
    expect(fsPerms.length).toBeGreaterThan(0)
    const fsDefault = permissions.find(
      (p) => typeof p === "object" && p !== null && (p as Record<string, unknown>).identifier === "fs:default",
    ) as Record<string, unknown> | undefined
    if (fsDefault) {
      const allow = (fsDefault.allow as Array<{ path: string }>) ?? []
      const hasDocumentScope = allow.some((a) => a.path?.includes("$DOCUMENT"))
      expect(hasDocumentScope).toBe(true)
    }
  })

  it("FilesystemDocumentService exists", () => {
    expect(existsSync(fsDocService)).toBe(true)
  })

  it("FilesystemDocumentService does not call fetch('/api/')", () => {
    const src = readFileSync(fsDocService, "utf8")
    expect(src).not.toMatch(/fetch\s*\(\s*['"`]\/api\//)
  })

  it("FilesystemDocumentService does not import @supabase/ssr", () => {
    const src = readFileSync(fsDocService, "utf8")
    expect(src).not.toMatch(/@supabase\/ssr/)
  })

  it("tauri-commands.ts exists (desktop FS Tauri command bridge)", () => {
    expect(existsSync(tauriCommands)).toBe(true)
  })

  it("registers the native Workspace agent path guard", () => {
    const lib = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8")
    const workspace = readFileSync(resolve(root, "src-tauri/src/commands/workspace.rs"), "utf8")
    expect(lib).toContain("commands::workspace::workspace_agent_validate_path")
    expect(workspace).toContain("pub fn workspace_agent_validate_path")
    expect(workspace).toContain("canonicalize_workspace_agent_candidate")
  })
})
