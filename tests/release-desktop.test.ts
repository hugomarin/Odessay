import { describe, it, expect, vi, beforeEach } from "vitest"
import { join } from "node:path"

// Mock node:fs so we can control what readFileSync returns without hitting disk
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, readFileSync: vi.fn() }
})

import { readFileSync } from "node:fs"
import { checkVersionDrift } from "../scripts/release-desktop.mjs"

const mockReadFileSync = vi.mocked(readFileSync)

function makePackageJson(version: string) {
  return Buffer.from(JSON.stringify({ name: "odessay", version }))
}

function makeTauriConf(version: string) {
  return Buffer.from(JSON.stringify({ productName: "Odessay", version }))
}

describe("checkVersionDrift", () => {
  const root = "/fake/root"

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns ok=true when versions match", () => {
    mockReadFileSync.mockImplementation((path) => {
      if (String(path).endsWith("package.json")) return makePackageJson("0.1.0")
      if (String(path).endsWith("tauri.conf.json")) return makeTauriConf("0.1.0")
      throw new Error(`Unexpected read: ${path}`)
    })

    const result = checkVersionDrift(root)
    expect(result).toEqual({ ok: true, version: "0.1.0" })
  })

  it("returns ok=false with both versions when they differ", () => {
    mockReadFileSync.mockImplementation((path) => {
      if (String(path).endsWith("package.json")) return makePackageJson("0.2.0")
      if (String(path).endsWith("tauri.conf.json")) return makeTauriConf("0.1.0")
      throw new Error(`Unexpected read: ${path}`)
    })

    const result = checkVersionDrift(root)
    expect(result).toEqual({ ok: false, pkg: "0.2.0", tauri: "0.1.0" })
  })

  it("reads from the correct paths relative to root", () => {
    mockReadFileSync.mockImplementation((path) => {
      if (String(path).endsWith("package.json")) return makePackageJson("1.0.0")
      if (String(path).endsWith("tauri.conf.json")) return makeTauriConf("1.0.0")
      throw new Error(`Unexpected read: ${path}`)
    })

    checkVersionDrift(root)

    expect(mockReadFileSync).toHaveBeenCalledWith(join(root, "package.json"), "utf8")
    expect(mockReadFileSync).toHaveBeenCalledWith(join(root, "src-tauri/tauri.conf.json"), "utf8")
  })
})
