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

async function runGate(harPath: string, root: string) {
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
