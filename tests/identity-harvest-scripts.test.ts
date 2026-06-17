import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(__dirname, "..")
const harvestScript = path.join(repoRoot, "scripts/identity/harvest-ids.mjs")
const backupScript = path.join(repoRoot, "scripts/identity/backup-restore.mjs")
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
})
