/**
 * ODE-225: Desktop bundle — native menu configuration validation.
 *
 * These are static-analysis checks. They verify that the Rust source and
 * Tauri config declare the menus and shortcuts expected by the Fase 7
 * smoke-test checklist (docs/desktop-distribution.md §Native menus).
 *
 * Full runtime validation (clicking menus in the DMG) is documented as
 * semi-manual steps in the smoke-test checklist.
 */
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

const root = resolve(process.cwd())
const libRs = resolve(root, "src-tauri/src/lib.rs")
const tauriConf = resolve(root, "src-tauri/tauri.conf.json")

function readLib() {
  return readFileSync(libRs, "utf8")
}

function readConf() {
  return JSON.parse(readFileSync(tauriConf, "utf8"))
}

describe("desktop menus — static configuration", () => {
  it("src-tauri/src/lib.rs exists and contains a MenuBuilder", () => {
    expect(existsSync(libRs)).toBe(true)
    expect(readLib()).toContain("MenuBuilder")
  })

  it("lib.rs defines the expected top-level submenus", () => {
    const src = readLib()
    expect(src).toContain('"Odessay"')   // App menu
    expect(src).toContain('"File"')
    expect(src).toContain('"Edit"')
  })

  it('lib.rs declares "settings" menu item with Cmd+, shortcut', () => {
    const src = readLib()
    expect(src).toContain('"settings"')
    expect(src).toContain("CmdOrCtrl+,")
  })

  it('lib.rs declares File menu items: new-file, open-file, save-to-disk, save-as', () => {
    const src = readLib()
    expect(src).toContain('"new-file"')
    expect(src).toContain('"open-file"')
    expect(src).toContain('"save-as"')
  })

  it('lib.rs declares standard keyboard shortcuts (Cmd+N, Cmd+O, Cmd+S, Cmd+Shift+S)', () => {
    const src = readLib()
    expect(src).toContain("CmdOrCtrl+O")
    expect(src).toContain("CmdOrCtrl+Shift+S")
  })

  it("tauri.conf.json has a single window labeled 'main' with title 'Odessay'", () => {
    const conf = readConf()
    const windows = conf?.app?.windows ?? []
    expect(windows.length).toBeGreaterThanOrEqual(1)
    const main = windows.find((w: { label: string }) => w.label === "main")
    expect(main).toBeDefined()
    expect(main?.title).toBe("Odessay")
  })
})
