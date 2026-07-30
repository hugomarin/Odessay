/**
 * @contract ODE-409 — a distributable desktop artifact must fail the release
 * gate when the host it embeds is localhost. The env var describes intent; this
 * guard reads what actually landed in the shipped frontend.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  collectFrontendAssets,
  evaluateEmbeddedRuntimeHost,
  findLocalRuntimeHosts,
  formatEmbeddedHostFailure,
  stripCspMeta,
} from "@/scripts/lib/desktop-runtime-host.mjs"

const created: string[] = []

function makeBundle(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "ode-409-bundle-"))
  created.push(dir)
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(dir, relativePath)
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, contents, "utf8")
  }
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true })
  }
})

describe("findLocalRuntimeHosts", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://localhost",
    "http://0.0.0.0:8080",
  ])("flags %s", (host) => {
    expect(findLocalRuntimeHosts(`fetch("${host}/api/margins/transcribe")`)).toEqual([host.toLowerCase()])
  })

  it.each([
    "https://odessay.vercel.app",
    "http://ipc.localhost",
    "https://asset.localhost",
    "http://tauri.localhost",
  ])("does not flag %s", (host) => {
    expect(findLocalRuntimeHosts(`connect-src ${host}`)).toEqual([])
  })

  it("ignores the Tauri CSP meta tag, which allow-lists localhost for dev on purpose", () => {
    const html =
      `<meta http-equiv="Content-Security-Policy" content="connect-src 'self' ipc: http://localhost:3000">` +
      `<script src="/_next/app.js"></script>`

    expect(stripCspMeta(html)).not.toContain("localhost:3000")
    expect(findLocalRuntimeHosts(html, { isHtml: true })).toEqual([])
  })

  it("still flags a localhost host embedded in HTML outside the CSP meta tag", () => {
    const html =
      `<meta http-equiv="Content-Security-Policy" content="connect-src 'self' ipc:">` +
      `<script>window.__APP_URL="http://localhost:3000"</script>`

    expect(findLocalRuntimeHosts(html, { isHtml: true })).toEqual(["http://localhost:3000"])
  })
})

describe("evaluateEmbeddedRuntimeHost", () => {
  it("rejects a bundle that embeds localhost", () => {
    const verdict = evaluateEmbeddedRuntimeHost({
      assets: [
        { path: "_next/static/chunks/main.js", contents: 'fetch("http://localhost:3000/api/margins/transcribe")' },
        { path: "_next/static/chunks/other.js", contents: 'fetch("https://odessay.vercel.app/api/ai")' },
      ],
    })

    expect(verdict.ok).toBe(false)
    expect(verdict.scanned).toBe(2)
    expect(verdict.offenders).toEqual([
      { path: "_next/static/chunks/main.js", hosts: ["http://localhost:3000"] },
    ])
    expect(formatEmbeddedHostFailure(verdict.offenders)).toContain("NEXT_PUBLIC_APP_URL=https://odessay.vercel.app")
  })

  it("accepts a bundle that only reaches the hosted runtime", () => {
    const verdict = evaluateEmbeddedRuntimeHost({
      assets: [{ path: "main.js", contents: 'fetch("https://odessay.vercel.app/api/margins/transcribe")' }],
    })

    expect(verdict.ok).toBe(true)
    expect(verdict.offenders).toEqual([])
  })

  it("still reports offenders under --allow-localhost, but does not block", () => {
    const verdict = evaluateEmbeddedRuntimeHost({
      assets: [{ path: "main.js", contents: 'fetch("http://localhost:3000/api")' }],
      allowLocalhost: true,
    })

    expect(verdict.ok).toBe(true)
    expect(verdict.offenders).toHaveLength(1)
  })
})

describe("collectFrontendAssets", () => {
  it("reads .js/.mjs/.html recursively and skips everything else", () => {
    const dir = makeBundle({
      "index.html": "<html></html>",
      "_next/static/chunks/main.js": "const a = 1",
      "_next/static/chunks/edge.mjs": "export const b = 2",
      "_next/static/css/app.css": "body{}",
      "icon.png": "not-really-a-png",
    })

    const { baseDir, assets } = collectFrontendAssets([dir])

    expect(baseDir).toBe(dir)
    expect(assets.map((asset) => asset.path).sort()).toEqual([
      "_next/static/chunks/edge.mjs",
      "_next/static/chunks/main.js",
      "index.html",
    ])
  })

  it("falls back to the next candidate when the first has no frontend assets", () => {
    const empty = makeBundle({ "readme.txt": "nothing here" })
    const populated = makeBundle({ "main.js": 'fetch("https://odessay.vercel.app")' })

    expect(collectFrontendAssets([empty, populated]).baseDir).toBe(populated)
  })

  it("reports no assets when nothing is scannable, so the release refuses to publish blind", () => {
    const empty = makeBundle({ "readme.txt": "nothing here" })

    expect(collectFrontendAssets([empty, join(empty, "missing")])).toEqual({ baseDir: null, assets: [] })
  })
})
