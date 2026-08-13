import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

import type { IncomingMessage, ServerResponse } from "node:http"

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(__dirname, "..")
const harvestScript = path.join(repoRoot, "scripts/identity/harvest-ids.mjs")
const backupScript = path.join(repoRoot, "scripts/identity/backup-restore.mjs")
const cleanScript = path.join(repoRoot, "scripts/identity/clean-frontmatter.mjs")
const tempRoots: string[] = []

async function makeTempWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "odessay-identity-"))
  tempRoots.push(root)
  return root
}

async function runJson(script: string, args: string[]) {
  let stdout = ""
  try {
    const result = await execFileAsync("node", [script, ...args, "--json"], {
      cwd: repoRoot,
    })
    stdout = result.stdout
  } catch (error) {
    const execError = error as { stdout?: string }
    stdout = execError.stdout ?? ""
  }
  return JSON.parse(stdout)
}

async function createBackup(root: string) {
  const backupDir = path.join(root, "..", `${path.basename(root)}-backup`)
  tempRoots.push(backupDir)
  await runJson(backupScript, ["backup", "--workspace-root", root, "--backup-dir", backupDir])
  return backupDir
}

function parseRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8")
        resolve(raw ? JSON.parse(raw) : null)
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

interface FakeServer {
  url: string
  requests: { method: string; path: string; body: unknown }[]
  close: () => Promise<void>
}

function createFakeSupabaseServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: unknown) => void | Promise<void>,
): Promise<FakeServer> {
  const requests: FakeServer["requests"] = []
  const server = createServer(async (req, res) => {
    const body = await parseRequestBody(req)
    requests.push({ method: req.method ?? "GET", path: req.url ?? "/", body })
    await handler(req, res, body)
  })
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind fake server"))
        return
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      })
    })
    server.on("error", reject)
  })
}

async function runWithCloudServer(
  script: string,
  args: string[],
  workspaceRoot: string,
  handler: (req: IncomingMessage, res: ServerResponse, body: unknown) => void | Promise<void>,
) {
  const server = await createFakeSupabaseServer(handler)
  tempRoots.push(workspaceRoot)
  const envPath = path.join(workspaceRoot, ".env.cloud-test")
  await fs.writeFile(
    envPath,
    `NEXT_PUBLIC_SUPABASE_URL=${server.url}\nSUPABASE_SERVICE_ROLE_KEY=fake-service-role-key\n`,
    "utf8",
  )
  try {
    return { result: await runJson(script, [...args, "--env", envPath, "--cloud"]), requests: server.requests }
  } finally {
    await server.close()
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("identity harvest scripts", () => {
  it("harvests frontmatter ids into the workspace index without rewriting markdown", async () => {
    const root = await makeTempWorkspace()
    const markdown = "---\nid: writing-from-frontmatter\nstatus: draft\n---\n\nHello\n"
    await fs.writeFile(path.join(root, "letter.md"), markdown, "utf8")

    const dryRun = await runJson(harvestScript, ["--workspace-root", root])

    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.summary).toMatchObject({
      total: 1,
      harvested: 1,
      minted: 0,
      alreadyRegistered: 0,
      failed: 0,
    })
    await expect(fs.stat(path.join(root, ".odessay/index.json"))).rejects.toThrow()

    const backupDir = await createBackup(root)
    const applied = await runJson(harvestScript, [
      "--workspace-root",
      root,
      "--apply",
      "--backup-dir",
      backupDir,
    ])
    const index = JSON.parse(await fs.readFile(path.join(root, ".odessay/index.json"), "utf8"))

    expect(applied.dryRun).toBe(false)
    expect(index.files["letter.md"].id).toBe("writing-from-frontmatter")
    expect(index.files["letter.md"].content_hash).toMatch(/^blake3:[0-9a-f]{64}$/)
    await expect(fs.readFile(path.join(root, "letter.md"), "utf8")).resolves.toBe(markdown)
  })

  it("mints ids only into the index for markdown without frontmatter id", async () => {
    const root = await makeTempWorkspace()
    await fs.writeFile(path.join(root, "plain.md"), "No frontmatter\n", "utf8")

    const backupDir = await createBackup(root)
    const applied = await runJson(harvestScript, [
      "--workspace-root",
      root,
      "--apply",
      "--backup-dir",
      backupDir,
    ])
    const index = JSON.parse(await fs.readFile(path.join(root, ".odessay/index.json"), "utf8"))

    expect(applied.summary).toMatchObject({
      total: 1,
      harvested: 0,
      minted: 1,
      alreadyRegistered: 0,
      failed: 0,
    })
    expect(index.files["plain.md"].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    await expect(fs.readFile(path.join(root, "plain.md"), "utf8")).resolves.toBe("No frontmatter\n")
  })

  it("reports conflicting frontmatter and index ids as failed", async () => {
    const root = await makeTempWorkspace()
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true })
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify(
        {
          version: 1,
          selectedPaths: [],
          files: {
            "letter.md": {
              id: "index-id",
              inode: 0,
              lastSeen: 0,
              size: 0,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    )
    await fs.writeFile(path.join(root, "letter.md"), "---\nid: frontmatter-id\n---\n\nHello\n", "utf8")

    const backupDir = await createBackup(root)
    const result = await runJson(harvestScript, [
      "--workspace-root",
      root,
      "--apply",
      "--backup-dir",
      backupDir,
    ])
    const index = JSON.parse(await fs.readFile(path.join(root, ".odessay/index.json"), "utf8"))

    expect(result.summary.failed).toBe(1)
    expect(result.workspaces[0].docs[0]).toMatchObject({
      status: "failed-conflicting-id",
      previousIndexId: "index-id",
      frontmatterId: "frontmatter-id",
      failureReason: "frontmatter.id differs from existing workspace index id",
    })
    expect(index.files["letter.md"].id).toBe("index-id")
  })

  it("backs up, verifies, and restores markdown files", async () => {
    const root = await makeTempWorkspace()
    const backupDir = path.join(root, "..", `${path.basename(root)}-backup`)
    tempRoots.push(backupDir)
    await fs.mkdir(path.join(root, "nested"), { recursive: true })
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true })
    await fs.writeFile(path.join(root, "nested/letter.md"), "---\nid: restore-me\n---\n\nOriginal\n", "utf8")
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 1, selectedPaths: [], files: { "nested/letter.md": { id: "restore-me" } } }),
      "utf8",
    )

    const backup = await runJson(backupScript, [
      "backup",
      "--workspace-root",
      root,
      "--backup-dir",
      backupDir,
    ])
    expect(backup).toMatchObject({ ok: true, command: "backup", files: 1 })

    const verifyBefore = await runJson(backupScript, [
      "verify",
      "--workspace-root",
      root,
      "--backup-dir",
      backupDir,
    ])
    expect(verifyBefore).toMatchObject({ ok: true, checkedFiles: 1, failures: [] })

    await fs.writeFile(path.join(root, "nested/letter.md"), "Changed\n", "utf8")
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 1, selectedPaths: [], files: { "nested/letter.md": { id: "changed" } } }),
      "utf8",
    )
    const verifyAfter = await runJson(backupScript, [
      "verify",
      "--workspace-root",
      root,
      "--backup-dir",
      backupDir,
    ])
    expect(verifyAfter.ok).toBe(false)
    expect(verifyAfter.failures[0]).toMatchObject({
      path: "nested/letter.md",
      reason: "live file differs from backup",
    })

    const restore = await runJson(backupScript, [
      "restore",
      "--workspace-root",
      root,
      "--backup-dir",
      backupDir,
      "--apply",
    ])
    expect(restore).toMatchObject({ ok: true, command: "restore" })
    await expect(fs.readFile(path.join(root, "nested/letter.md"), "utf8")).resolves.toBe(
      "---\nid: restore-me\n---\n\nOriginal\n",
    )
    const restoredIndex = JSON.parse(await fs.readFile(path.join(root, ".odessay/index.json"), "utf8"))
    expect(restoredIndex.files["nested/letter.md"].id).toBe("restore-me")
  })

  it("dry-runs Odessay frontmatter cleanup without rewriting markdown", async () => {
    const root = await makeTempWorkspace()
    const markdown = "---\nid: writing-id\nstatus: draft\n---\n\nHello\n"
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true })
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 1, selectedPaths: [], files: { "letter.md": { id: "writing-id" } } }),
      "utf8",
    )
    await fs.writeFile(path.join(root, "letter.md"), markdown, "utf8")

    const dryRun = await runJson(cleanScript, ["--workspace-root", root])

    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.summary).toMatchObject({
      total: 1,
      changed: 1,
      cleaned: 0,
      unchanged: 0,
      failed: 0,
    })
    expect(dryRun.workspaces[0].docs[0]).toMatchObject({
      path: "letter.md",
      id: "writing-id",
      status: "would-clean",
      removedKeys: ["id", "status"],
      removedWholeBlock: true,
    })
    await expect(fs.readFile(path.join(root, "letter.md"), "utf8")).resolves.toBe(markdown)
  })

  it("refuses to clean frontmatter ids that were not harvested into the index", async () => {
    const root = await makeTempWorkspace()
    await fs.writeFile(path.join(root, "letter.md"), "---\nid: only-in-frontmatter\n---\n\nHello\n", "utf8")

    const result = await runJson(cleanScript, ["--workspace-root", root])

    expect(result.summary.failed).toBe(1)
    expect(result.workspaces[0].docs[0]).toMatchObject({
      status: "failed",
      id: "only-in-frontmatter",
      indexId: null,
      failureReason: "missing workspace index id; run harvest first or verify with --cloud",
    })
    await expect(fs.readFile(path.join(root, "letter.md"), "utf8")).resolves.toBe(
      "---\nid: only-in-frontmatter\n---\n\nHello\n",
    )
  })

  it("removes only Odessay keys while preserving foreign frontmatter", async () => {
    const root = await makeTempWorkspace()
    const markdown =
      "---\nname: My Skill\ndescription: Useful context\nid: writing-id\nstatus: active\nvisibility: private\n---\n\nBody\n"
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true })
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 1, selectedPaths: [], files: { "skill.md": { id: "writing-id" } } }),
      "utf8",
    )
    await fs.writeFile(path.join(root, "skill.md"), markdown, "utf8")

    const backupDir = await createBackup(root)
    const applied = await runJson(cleanScript, [
      "--workspace-root",
      root,
      "--apply",
      "--backup-dir",
      backupDir,
    ])

    expect(applied.summary).toMatchObject({ total: 1, changed: 1, cleaned: 1, failed: 0 })
    expect(applied.workspaces[0].docs[0]).toMatchObject({
      status: "cleaned",
      removedKeys: ["id", "status", "visibility"],
      preservedKeys: ["name", "description"],
      removedWholeBlock: false,
      cloudMetadata: {
        status: "active",
        visibility: "private",
      },
    })
    await expect(fs.readFile(path.join(root, "skill.md"), "utf8")).resolves.toBe(
      "---\nname: My Skill\ndescription: Useful context\n---\n\nBody\n",
    )
  })

  it("removes the full frontmatter block when it only contains Odessay keys", async () => {
    const root = await makeTempWorkspace()
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true })
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 1, selectedPaths: [], files: { "letter.md": { id: "writing-id" } } }),
      "utf8",
    )
    await fs.writeFile(
      path.join(root, "letter.md"),
      "---\nid: writing-id\nslug: hello\nstatus: draft\nvisibility: private\nversion: 2\n---\n\nHello\n",
      "utf8",
    )

    const backupDir = await createBackup(root)
    const applied = await runJson(cleanScript, [
      "--workspace-root",
      root,
      "--apply",
      "--backup-dir",
      backupDir,
    ])

    expect(applied.workspaces[0].docs[0]).toMatchObject({
      status: "cleaned",
      removedWholeBlock: true,
      cloudMetadata: {
        slug: "hello",
        status: "draft",
        visibility: "private",
        version: 2,
      },
    })
    await expect(fs.readFile(path.join(root, "letter.md"), "utf8")).resolves.toBe("Hello\n")
  })

  it("refuses apply when live files diverge from the backup", async () => {
    const root = await makeTempWorkspace()
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true })
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 1, selectedPaths: [], files: { "letter.md": { id: "writing-id" } } }),
      "utf8",
    )
    await fs.writeFile(path.join(root, "letter.md"), "---\nid: writing-id\n---\n\nOriginal\n", "utf8")

    const backupDir = await createBackup(root)
    await fs.writeFile(path.join(root, "letter.md"), "---\nid: writing-id\n---\n\nChanged\n", "utf8")

    await expect(
      execFileAsync(
        "node",
        [cleanScript, "--workspace-root", root, "--apply", "--backup-dir", backupDir],
        { cwd: repoRoot },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Backup verification failed before clean apply"),
    })
    await expect(fs.readFile(path.join(root, "letter.md"), "utf8")).resolves.toBe(
      "---\nid: writing-id\n---\n\nChanged\n",
    )
  })

  it("rejects unknown arguments and missing values in harvest-ids", async () => {
    await expect(
      execFileAsync("node", [harvestScript, "--workspace-root"], { cwd: repoRoot }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Missing value for --workspace-root"),
    })

    await expect(
      execFileAsync("node", [harvestScript, "--unknown-flag"], { cwd: repoRoot }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Unknown argument: --unknown-flag"),
    })

    await expect(
      execFileAsync("node", [harvestScript, "--env", "--apply"], { cwd: repoRoot }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Missing value for --env"),
    })
  })

  it("rejects unknown arguments and missing values in clean-frontmatter", async () => {
    await expect(
      execFileAsync("node", [cleanScript, "--backup-dir"], { cwd: repoRoot }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Missing value for --backup-dir"),
    })

    await expect(
      execFileAsync("node", [cleanScript, "positional-root"], { cwd: repoRoot }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Unknown argument: positional-root"),
    })
  })

  it("harvest-ids --cloud dry-run queries cloud rows without writing", async () => {
    const root = await makeTempWorkspace()
    await fs.writeFile(
      path.join(root, "letter.md"),
      "---\nid: writing-from-frontmatter\n---\n\nHello\n",
      "utf8",
    )

    const { result, requests } = await runWithCloudServer(
      harvestScript,
      ["--workspace-root", root],
      root,
      (_req, res, _body) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify([{ id: "writing-from-frontmatter", content_hash: "old-hash" }]))
      },
    )

    expect(result.cloud).toMatchObject({
      enabled: true,
      existing: 1,
      missing: 0,
      updated: [],
      inserted: [],
    })
    expect(requests.some((r) => r.method === "GET" && r.path.includes("/rest/v1/writings"))).toBe(true)
    expect(requests.some((r) => r.method === "PATCH")).toBe(false)
  })

  it("harvest-ids --cloud --apply updates existing cloud rows", async () => {
    const root = await makeTempWorkspace()
    await fs.writeFile(
      path.join(root, "letter.md"),
      "---\nid: writing-from-frontmatter\n---\n\nHello\n",
      "utf8",
    )
    const backupDir = await createBackup(root)

    const { result } = await runWithCloudServer(
      harvestScript,
      ["--workspace-root", root, "--apply", "--backup-dir", backupDir, "--author-id", "a1b2c3d4-0001-0001-0001-000000000001"],
      root,
      (req, res, body) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        if (req.method === "GET") {
          res.end(JSON.stringify([{ id: "writing-from-frontmatter", content_hash: "old-hash" }]))
          return
        }
        if (req.method === "PATCH") {
          expect(body).toMatchObject({
            content_hash: expect.stringMatching(/^blake3:[0-9a-f]{64}$/),
          })
          res.end("[]")
          return
        }
        res.end("[]")
      },
    )

    expect(result.cloud).toMatchObject({
      enabled: true,
      existing: 1,
      missing: 0,
      updated: ["writing-from-frontmatter"],
      inserted: [],
    })
  })

  it("clean-frontmatter --cloud dry-run checks cloud rows without writing", async () => {
    const root = await makeTempWorkspace()
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true })
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 1, selectedPaths: [], files: { "letter.md": { id: "writing-id" } } }),
      "utf8",
    )
    await fs.writeFile(
      path.join(root, "letter.md"),
      "---\nid: writing-id\nslug: hello\nstatus: draft\nvisibility: private\nversion: 2\n---\n\nHello\n",
      "utf8",
    )

    const { result, requests } = await runWithCloudServer(
      cleanScript,
      ["--workspace-root", root],
      root,
      (_req, res, _body) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify([{ id: "writing-id", slug: "hello", status: "draft", visibility: "private", version: 2 }]))
      },
    )

    expect(result.summary).toMatchObject({ total: 1, changed: 1, failed: 0 })
    expect(result.cloud).toMatchObject({
      enabled: true,
      checked: 1,
      missing: [],
      updated: [],
      skipped: [],
    })
    expect(requests.some((r) => r.method === "GET" && r.path.includes("/rest/v1/writings"))).toBe(true)
    expect(requests.some((r) => r.method === "PATCH")).toBe(false)
  })

  it("clean-frontmatter --cloud --apply updates cloud metadata", async () => {
    const root = await makeTempWorkspace()
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true })
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 1, selectedPaths: [], files: { "letter.md": { id: "writing-id" } } }),
      "utf8",
    )
    await fs.writeFile(
      path.join(root, "letter.md"),
      "---\nid: writing-id\nslug: hello\nstatus: draft\nvisibility: private\nversion: 2\n---\n\nHello\n",
      "utf8",
    )
    const backupDir = await createBackup(root)

    const patched: unknown[] = []
    const { result } = await runWithCloudServer(
      cleanScript,
      ["--workspace-root", root, "--apply", "--backup-dir", backupDir],
      root,
      (req, res, body) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        if (req.method === "GET") {
          res.end(JSON.stringify([{ id: "writing-id", slug: "hello", status: "draft", visibility: "private", version: 2 }]))
          return
        }
        if (req.method === "PATCH") {
          patched.push(body)
          res.end("[]")
          return
        }
        res.end("[]")
      },
    )

    expect(result.cloud).toMatchObject({
      enabled: true,
      checked: 1,
      missing: [],
      updated: ["writing-id"],
      skipped: [],
    })
    expect(patched).toHaveLength(1)
    expect(patched[0]).toMatchObject({
      slug: "hello",
      status: "draft",
      visibility: "private",
      version: 2,
    })
  })

  it("clean-frontmatter --cloud fails when cloud writing is missing", async () => {
    const root = await makeTempWorkspace()
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true })
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 1, selectedPaths: [], files: { "letter.md": { id: "writing-id" } } }),
      "utf8",
    )
    await fs.writeFile(
      path.join(root, "letter.md"),
      "---\nid: writing-id\nstatus: draft\n---\n\nHello\n",
      "utf8",
    )

    const { result } = await runWithCloudServer(
      cleanScript,
      ["--workspace-root", root],
      root,
      (_req, res, _body) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end("[]")
      },
    )

    expect(result.summary).toMatchObject({ total: 1, changed: 1, failed: 1 })
    expect(result.workspaces[0].docs[0]).toMatchObject({
      status: "failed",
      failureReason: expect.stringContaining("missing cloud writing row"),
    })
  })
})
