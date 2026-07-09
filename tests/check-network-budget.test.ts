import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(__dirname, "..")
const scriptPath = path.join(repoRoot, "scripts/check-network-budget.mjs")
const tempRoots: string[] = []

function entry(startOffsetMs: number, url: string, bodySize = 1000) {
  return {
    startedDateTime: new Date(Date.UTC(2026, 6, 8, 12, 0, 0, startOffsetMs)).toISOString(),
    request: {
      method: "GET",
      url,
    },
    response: {
      status: 200,
      headersSize: 100,
      bodySize,
      _transferSize: bodySize + 100,
    },
    time: 10,
  }
}

async function makeHar(entries: unknown[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "odessay-network-budget-"))
  tempRoots.push(root)
  const harPath = path.join(root, "capture.har")
  await fs.writeFile(
    harPath,
    JSON.stringify({ log: { version: "1.2", creator: { name: "test", version: "1" }, entries } }),
    "utf8",
  )
  return { root, harPath }
}

async function makeResources(entries: unknown[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "odessay-network-budget-"))
  tempRoots.push(root)
  const resourcesPath = path.join(root, "resources.json")
  await fs.writeFile(
    resourcesPath,
    JSON.stringify({ timeOrigin: Date.UTC(2026, 6, 8, 12, 0, 0, 0), entries }),
    "utf8",
  )
  return { root, resourcesPath }
}

async function runGate(harPath: string, root: string, extraArgs: string[] = []) {
  return execFileAsync(
    "node",
    [
      scriptPath,
      "--har",
      harPath,
      "--report",
      path.join(root, "report.json"),
      "--metrics",
      path.join(root, "metrics.json"),
      ...extraArgs,
    ],
    { cwd: repoRoot },
  )
}

async function runResourceGate(resourcesPath: string, root: string, extraArgs: string[] = []) {
  return execFileAsync(
    "node",
    [
      scriptPath,
      "--resources",
      resourcesPath,
      "--report",
      path.join(root, "report.json"),
      "--metrics",
      path.join(root, "metrics.json"),
      ...extraArgs,
    ],
    { cwd: repoRoot },
  )
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("check-network-budget", () => {
  it("passes a bounded startup with no duplicates or listener churn", async () => {
    const { root, harPath } = await makeHar([
      entry(0, "http://localhost:3000/desk", 20000),
      entry(100, "https://example.supabase.co/rest/v1/writings?select=id%2Cupdated_at", 40000),
      entry(200, "https://example.supabase.co/rest/v1/collections?select=id", 8000),
      entry(6100, "http://localhost:3000/write/abc", 12000),
    ])

    const result = await runGate(harPath, root)
    const report = JSON.parse(await fs.readFile(path.join(root, "report.json"), "utf8"))

    expect(result.stdout).toContain("[ops:network:gate] OK")
    expect(report.summary.required_failures).toBe(0)
    expect(report.metrics.startup.duplicate_identical_requests).toBe(0)
    expect(report.metrics.navigation.listener_churn_requests).toBe(0)
  })

  it("fails when startup has identical duplicate requests", async () => {
    const duplicateUrl = "https://example.supabase.co/rest/v1/writings?select=id%2Cbody_json"
    const { root, harPath } = await makeHar([
      entry(0, "http://localhost:3000/desk", 20000),
      entry(100, duplicateUrl, 40000),
      entry(150, duplicateUrl, 40000),
    ])

    await expect(runGate(harPath, root)).rejects.toMatchObject({
      stdout: expect.stringContaining("FAIL startup.duplicate_identical_requests = 1"),
      stderr: expect.stringContaining("Network gate failed"),
    })
  })

  it("excludes static assets from transfer bytes and duplicate runtime failures", async () => {
    const staticChunk = "http://localhost:3000/_next/static/chunks/app/(app)/write/page.js"
    const icon = "http://localhost:3000/icon.png?hash"
    const { root, harPath } = await makeHar([
      entry(0, staticChunk, 6_000_000),
      entry(100, staticChunk, 6_000_000),
      entry(200, icon, 1000),
      entry(300, icon, 1000),
      entry(400, "http://localhost:3000/api/writings?fields=manifest", 40_000),
    ])

    const result = await runGate(harPath, root)
    const report = JSON.parse(await fs.readFile(path.join(root, "report.json"), "utf8"))

    expect(result.stdout).toContain("[ops:network:gate] OK")
    expect(report.metrics.startup.total_requests).toBe(5)
    expect(report.metrics.startup.transfer_bytes).toBe(40_100)
    expect(report.metrics.startup.duplicate_identical_requests).toBe(0)
  })

  it("redacts sensitive HAR paths and duplicate request URLs from artifacts", async () => {
    const duplicateUrl =
      "https://example.supabase.co/rest/v1/writings?select=id%2Cbody_json&apikey=sensitive"
    const { root, harPath } = await makeHar([
      entry(0, "http://localhost:3000/desk", 20000),
      entry(100, duplicateUrl, 40000),
      entry(150, duplicateUrl, 40000),
    ])

    await expect(runGate(harPath, root, ["--redact"])).rejects.toMatchObject({
      stderr: expect.stringContaining("Network gate failed"),
    })

    const reportText = await fs.readFile(path.join(root, "report.json"), "utf8")
    const metricsText = await fs.readFile(path.join(root, "metrics.json"), "utf8")
    const report = JSON.parse(reportText)
    const metrics = JSON.parse(metricsText)

    expect(report.redacted).toBe(true)
    expect(report.input_path).toBe("[redacted]")
    expect(reportText).not.toContain("apikey=sensitive")
    expect(metricsText).not.toContain("apikey=sensitive")
    expect(metrics.duplicate_groups[0]).toMatchObject({
      count: 2,
      duplicates: 1,
    })
    expect(metrics.duplicate_groups[0].identity_hash).toMatch(/^[a-f0-9]{16}$/)
    expect(metrics.duplicate_groups[0].identity).toBeUndefined()
  })

  it("evaluates Resource Timing exports without requiring a HAR", async () => {
    const { root, resourcesPath } = await makeResources([
      {
        name: "http://localhost:3000/desk",
        startTime: 0,
        duration: 10,
        transferSize: 20000,
        encodedBodySize: 19900,
      },
      {
        name: "https://example.supabase.co/rest/v1/writings?select=id%2Cupdated_at",
        startTime: 100,
        duration: 20,
        transferSize: 40000,
        encodedBodySize: 39900,
      },
      {
        name: "http://localhost:3000/write/abc",
        startTime: 6100,
        duration: 20,
        transferSize: 12000,
        encodedBodySize: 11900,
      },
    ])

    const result = await runResourceGate(resourcesPath, root, ["--redact"])
    const report = JSON.parse(await fs.readFile(path.join(root, "report.json"), "utf8"))

    expect(result.stdout).toContain("[ops:network:gate] OK")
    expect(report.input_type).toBe("resource-timing")
    expect(report.input_path).toBe("[redacted]")
    expect(report.summary.required_failures).toBe(0)
  })

  it("fails when navigation registers Tauri listeners after startup", async () => {
    const { root, harPath } = await makeHar([
      entry(0, "http://localhost:3000/desk", 20000),
      entry(6100, "http://ipc.localhost/plugin:event|listen", 500),
      entry(6200, "http://ipc.localhost/plugin:event|unlisten", 500),
    ])

    await expect(runGate(harPath, root)).rejects.toMatchObject({
      stdout: expect.stringContaining("FAIL navigation.listener_churn_requests = 2"),
      stderr: expect.stringContaining("Network gate failed"),
    })
  })

  it("fails malformed HAR input clearly", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "odessay-network-budget-"))
    tempRoots.push(root)
    const harPath = path.join(root, "capture.har")
    await fs.writeFile(harPath, JSON.stringify({ log: {} }), "utf8")

    await expect(runGate(harPath, root)).rejects.toMatchObject({
      stderr: expect.stringContaining("missing log.entries array"),
    })
  })
})
