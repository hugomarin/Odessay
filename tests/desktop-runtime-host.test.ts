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
  readRuntimeManifest,
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
  it("rejects an artifact whose declared host is local", () => {
    const verdict = evaluateEmbeddedRuntimeHost({
      manifest: { appUrl: "http://localhost:3000" },
      assets: [
        { path: "_next/static/chunks/main.js", contents: 'const h="http://localhost:3000"' },
        { path: "_next/static/chunks/other.js", contents: "const x = 1" },
      ],
    })

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe("local-host")
    expect(verdict.appUrl).toBe("http://localhost:3000")
    expect(verdict.carriers).toEqual(["_next/static/chunks/main.js"])
    expect(formatEmbeddedHostFailure(verdict)).toContain("NEXT_PUBLIC_APP_URL=https://odessay.vercel.app")
  })

  it("accepts an artifact that declares and embeds the hosted runtime", () => {
    const verdict = evaluateEmbeddedRuntimeHost({
      manifest: { appUrl: "https://odessay.vercel.app/" },
      assets: [{ path: "main.js", contents: 'const h="https://odessay.vercel.app"' }],
    })

    expect(verdict.ok).toBe(true)
    expect(verdict.reason).toBe("remote-host")
    expect(verdict.appUrl).toBe("https://odessay.vercel.app")
  })

  it("does not blame a dependency that ships its own local default", () => {
    // gotrue-js embeds `http://localhost:9999` as an unused constant. A blanket
    // scan would fail every production bundle on it.
    const verdict = evaluateEmbeddedRuntimeHost({
      manifest: { appUrl: "https://odessay.vercel.app" },
      assets: [
        { path: "auth.js", contents: 'o="http://localhost:9999"' },
        { path: "app.js", contents: 'h="https://odessay.vercel.app"' },
      ],
    })

    expect(verdict.ok).toBe(true)
    expect(verdict.reason).toBe("remote-host")
  })

  it("refuses to certify an artifact that never declared its host", () => {
    for (const manifest of [null, {}, { appUrl: "   " }]) {
      const verdict = evaluateEmbeddedRuntimeHost({
        manifest,
        assets: [{ path: "main.js", contents: 'h="https://odessay.vercel.app"' }],
      })
      expect(verdict.ok).toBe(false)
      expect(verdict.reason).toBe("missing-manifest")
    }
    expect(
      formatEmbeddedHostFailure({
        ok: false,
        reason: "missing-manifest",
        scanned: 1,
        appUrl: null,
        carriers: [],
      }),
    ).toContain("cannot be verified")
  })

  it("fails when the manifest and the shipped bundle disagree", () => {
    const verdict = evaluateEmbeddedRuntimeHost({
      manifest: { appUrl: "https://odessay.vercel.app" },
      assets: [{ path: "main.js", contents: 'h="http://localhost:3000"' }],
    })

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe("manifest-mismatch")
    expect(formatEmbeddedHostFailure(verdict)).toContain("disagree")
  })

  it("still names the local host under --allow-localhost, but does not block", () => {
    const verdict = evaluateEmbeddedRuntimeHost({
      manifest: { appUrl: "http://localhost:3000" },
      assets: [{ path: "main.js", contents: 'h="http://localhost:3000"' }],
      allowLocalhost: true,
    })

    expect(verdict.ok).toBe(true)
    expect(verdict.reason).toBe("local-host")
  })
})

describe("readRuntimeManifest", () => {
  it("reads the manifest from the first candidate that has one", () => {
    const empty = makeBundle({ "main.js": "x" })
    const withManifest = makeBundle({
      "odessay-runtime.json": JSON.stringify({ appUrl: "https://odessay.vercel.app", tauriBuild: true }),
    })

    expect(readRuntimeManifest([empty, withManifest]).manifest).toEqual({
      appUrl: "https://odessay.vercel.app",
      tauriBuild: true,
    })
  })

  it("treats an unreadable manifest as absent rather than valid", () => {
    const broken = makeBundle({ "odessay-runtime.json": "{ not json" })

    expect(readRuntimeManifest([broken]).manifest).toBeNull()
  })

  it("returns null when no candidate declares a runtime host", () => {
    expect(readRuntimeManifest([makeBundle({ "main.js": "x" }), null])).toEqual({ path: null, manifest: null })
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
