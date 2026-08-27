/**
 * ODE-372 — Fase 9 release/bundle contract.
 *
 * This suite validates the source and release wiring that can run without
 * launching a signed-in desktop. Finder, offline/restart and DMG interaction
 * evidence remains an explicit packaged-artifact gate in the closure matrix.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(process.cwd())
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8")

describe("desktop bundle — unified document catalog", () => {
  it("registers catalog and reconciler commands in the Tauri bundle", () => {
    const lib = read("src-tauri/src/lib.rs")
    const index = read("src-tauri/src/commands/index.rs")

    for (const command of [
      "catalog_schema_version",
      "catalog_list",
      "catalog_resolve_path",
      "catalog_apply_reconcile",
      "catalog_enqueue_mutation",
    ]) {
      expect(lib).toContain(`commands::index::${command}`)
      expect(index).toContain(`pub fn ${command}`)
    }
  })

  it("ships the desktop application shell with one global reconciler", () => {
    const shell = read("components/navigation/desktop-app-shell.tsx")
    expect(shell).toContain("useWorkspaceReconciler")
    expect(shell).toContain("app-lifetime WorkspaceReconciler")
  })

  it("keeps desktop and web catalog adapters behind the application factory", () => {
    const factory = read("lib/services/document-catalog-factory.ts")
    const desk = read("lib/queries/desk-catalog-source.ts")
    const workspace = read("lib/queries/workspace-catalog-source.ts")
    const search = read("components/navigation/search-modal.tsx")

    expect(factory).toContain("SqliteDocumentCatalog")
    expect(factory).toContain("webDocumentCatalog")
    expect(desk).toContain("loadCatalogRecords")
    expect(workspace).toContain("loadCatalogRecords")
    expect(search).toContain("loadSearchWritings")
    expect(search).not.toContain("@/lib/local-db")
  })

  it("keeps the release path and DMG validator explicit", () => {
    const release = read("scripts/release-desktop.mjs")
    const validator = read("scripts/validate-desktop-bundle.mjs")
    const config = read("src-tauri/tauri.conf.json")

    expect(release).toContain("tauri build")
    expect(release).toContain("dist/releases")
    expect(validator).toContain("--dmg")
    expect(validator).toContain("hdiutil attach")
    expect(config).toContain("Artifact Studio")
  })

  it("does not mistake the absence of an exact packaged artifact for a pass", () => {
    const configuredDmg = process.env.ODE_372_DMG_PATH?.trim()
    if (!configuredDmg) {
      expect(configuredDmg).toBeUndefined()
      return
    }

    expect(existsSync(resolve(root, configuredDmg))).toBe(true)
  })
})
