#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { sha256, sqlLiteral } from "./lib.mjs"

function parseArgs(argv) {
  const options = {
    plan: null,
    apply: false,
    confirm: null,
    backupDir: null,
    approveSafe: false,
    onlyReasons: [],
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--") continue
    if (arg === "--plan") options.plan = path.resolve(argv[++index])
    else if (arg === "--backup-dir") options.backupDir = path.resolve(argv[++index])
    else if (arg === "--confirm") options.confirm = argv[++index]
    else if (arg === "--approve-safe") options.approveSafe = true
    else if (arg === "--only-reason") options.onlyReasons.push(argv[++index])
    else if (arg === "--apply") options.apply = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!options.plan) throw new Error("--plan is required")
  return options
}

function sqlite(dbPath, sql, { readOnly = false } = {}) {
  const result = spawnSync(
    "/usr/bin/sqlite3",
    readOnly ? ["-readonly", dbPath, sql] : [dbPath],
    { encoding: "utf8", input: readOnly ? undefined : sql, maxBuffer: 128 * 1024 * 1024 },
  )
  if (result.status !== 0) throw new Error(result.stderr.trim() || "sqlite3 failed")
  return result.stdout.trim()
}

function sqliteRows(dbPath, query) {
  const result = spawnSync("/usr/bin/sqlite3", ["-readonly", "-json", dbPath, query], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || "sqlite3 failed")
  return result.stdout.trim() ? JSON.parse(result.stdout) : []
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"))
}

async function writeJsonAtomic(filePath, document) {
  const temporary = `${filePath}.tmp-${process.pid}`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`)
  await fs.rename(temporary, filePath)
}

async function copyIfExists(source, target) {
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(source, target)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

function assertAppClosed() {
  const result = spawnSync("/bin/ps", ["-ax", "-o", "comm="], { encoding: "utf8" })
  if (result.status !== 0) throw new Error("Could not verify whether Artifact Studio is running")
  const running = result.stdout
    .split("\n")
    .some((command) => /(?:^|\/)Artifact Studio(?:\.app\/|$)/.test(command.trim()))
  if (running) throw new Error("Quit Artifact Studio before applying cleanup")
}

async function assertCandidateUnchanged(candidate) {
  const [bytes, stat] = await Promise.all([
    fs.readFile(candidate.canonicalPath),
    fs.stat(candidate.canonicalPath),
  ])
  const actualHash = sha256(bytes)
  if (
    actualHash !== candidate.expectedRawHash ||
    stat.size !== candidate.expectedSize ||
    Math.trunc(stat.mtimeMs) !== candidate.expectedMtimeMs
  ) {
    throw new Error(`Source drift detected: ${candidate.canonicalPath}`)
  }
}

function assertCatalogCandidatesSafe(dbPath, selected) {
  const ids = selected.map((candidate) => sqlLiteral(candidate.id)).join(",")
  const rows = sqliteRows(
    dbPath,
    `SELECT d.id,d.cloud_present AS cloudPresent,d.sync_status AS syncStatus,
      b.canonical_path AS canonicalPath,
      (SELECT COUNT(*) FROM sync_mutations sm
        WHERE sm.document_id=d.id AND sm.status!='synced') +
      (SELECT COUNT(*) FROM metadata_sync_mutations mm
        WHERE mm.entity_kind='writing' AND mm.entity_id=d.id AND mm.status!='synced')
        AS unsyncedMutationCount
    FROM documents d
    JOIN document_bindings b ON b.document_id=d.id
    WHERE d.id IN (${ids})`,
  )
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const candidate of selected) {
    const row = byId.get(candidate.id)
    if (!row) throw new Error(`Catalog row disappeared: ${candidate.id}`)
    if (row.canonicalPath !== candidate.canonicalPath) {
      throw new Error(`Catalog binding drift detected: ${candidate.id}`)
    }
    if (Boolean(row.cloudPresent)) throw new Error(`Cloud-backed row is not deletable: ${candidate.id}`)
    if (["pending", "failed", "conflict"].includes(row.syncStatus)) {
      throw new Error(`Unsafe sync status for ${candidate.id}: ${row.syncStatus}`)
    }
    if (Number(row.unsyncedMutationCount) > 0) {
      throw new Error(`Unsynced mutation appeared for ${candidate.id}`)
    }
  }
}

function rootKey(rootPath) {
  return sha256(rootPath).slice(0, 16)
}

async function backup(planPath, plan, selected, backupDir) {
  await fs.mkdir(backupDir, { recursive: true })
  sqlite(plan.dbPath, `.backup ${sqlLiteral(path.join(backupDir, "desktop-index.before.sqlite3"))}\n`)
  await fs.copyFile(planPath, path.join(backupDir, "cleanup-plan.json"))
  const manifestPaths = [...new Set(selected.map((candidate) => candidate.manifestPath))]
  const manifests = []
  for (const manifestPath of manifestPaths) {
    const target = path.join(backupDir, "manifests", `${sha256(manifestPath).slice(0, 16)}.json`)
    const existed = await copyIfExists(manifestPath, target)
    manifests.push({ manifestPath, backupPath: target, existed })
  }
  const checkpoint = {
    planId: plan.planId,
    dbPath: plan.dbPath,
    backupDir,
    selectedIds: selected.map((candidate) => candidate.id),
    manifests,
    movedFiles: [],
    stage: "backed-up",
    startedAt: new Date().toISOString(),
  }
  await writeJsonAtomic(path.join(backupDir, "checkpoint.json"), checkpoint)
  return checkpoint
}

async function updateManifests(selected, backupDir) {
  const byManifest = new Map()
  for (const candidate of selected) {
    const group = byManifest.get(candidate.manifestPath) ?? []
    group.push(candidate)
    byManifest.set(candidate.manifestPath, group)
  }
  for (const [manifestPath, candidates] of byManifest) {
    const manifest = await readJson(manifestPath)
    for (const candidate of candidates) {
      if (manifest.files?.[candidate.relativePath]?.id !== candidate.id) {
        throw new Error(`Manifest drift detected for ${candidate.relativePath}`)
      }
      delete manifest.files[candidate.relativePath]
    }
    await writeJsonAtomic(manifestPath, manifest)
  }
  await writeJsonAtomic(path.join(backupDir, "manifests-after.json"), {
    paths: [...byManifest.keys()],
  })
}

function buildDeleteSql(selected) {
  const ids = selected.map((candidate) => sqlLiteral(candidate.id)).join(",")
  return `PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
DELETE FROM writing_collections WHERE writing_id IN (${ids});
DELETE FROM sync_mutations WHERE document_id IN (${ids});
DELETE FROM metadata_sync_mutations WHERE entity_kind='writing' AND entity_id IN (${ids});
DELETE FROM document_bindings WHERE document_id IN (${ids});
DELETE FROM documents
WHERE id IN (${ids})
  AND cloud_present=0
  AND sync_status NOT IN ('pending','failed','conflict');
SELECT CASE WHEN changes()=${selected.length} THEN 'deleted-ok' ELSE 'delete-count-mismatch' END;
COMMIT;
PRAGMA integrity_check;
`
}

async function rollback(checkpoint) {
  sqlite(checkpoint.dbPath, `.restore ${sqlLiteral(path.join(checkpoint.backupDir, "desktop-index.before.sqlite3"))}\n`)
  for (const manifest of checkpoint.manifests) {
    if (manifest.existed) await fs.copyFile(manifest.backupPath, manifest.manifestPath)
  }
  for (const moved of [...checkpoint.movedFiles].reverse()) {
    await fs.mkdir(path.dirname(moved.source), { recursive: true })
    await fs.rename(moved.target, moved.source)
  }
  checkpoint.stage = "rolled-back"
  checkpoint.rolledBackAt = new Date().toISOString()
  await writeJsonAtomic(path.join(checkpoint.backupDir, "checkpoint.json"), checkpoint)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const plan = await readJson(options.plan)
  const selected = plan.candidates.filter((candidate) => {
    const approved = options.approveSafe || candidate.approved === true
    const matchesReason =
      options.onlyReasons.length === 0 ||
      candidate.reasons.some((reason) => options.onlyReasons.includes(reason))
    return approved && matchesReason
  })
  const preview = {
    mode: options.apply ? "apply" : "dry-run",
    planId: plan.planId,
    dbPath: plan.dbPath,
    selectedCount: selected.length,
    onlyReasons: options.onlyReasons,
    selectedIds: selected.map((candidate) => candidate.id),
  }
  if (!options.apply) {
    console.log(JSON.stringify(preview, null, 2))
    return
  }
  if (!selected.length) throw new Error("No approved candidates. Mark approved:true or use --approve-safe")
  if (options.confirm !== plan.planId) {
    throw new Error(`Apply requires --confirm ${plan.planId}`)
  }
  assertAppClosed()
  assertCatalogCandidatesSafe(plan.dbPath, selected)
  for (const candidate of selected) await assertCandidateUnchanged(candidate)
  const integrity = sqlite(plan.dbPath, "PRAGMA integrity_check;", { readOnly: true })
  if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity}`)

  const stamp = new Date().toISOString().replaceAll(":", "-")
  const backupDir = options.backupDir ?? path.join(path.dirname(plan.dbPath), "document-cleanup-backups", stamp)
  const checkpoint = await backup(options.plan, plan, selected, backupDir)
  try {
    for (const candidate of selected) {
      const target = path.join(
        backupDir,
        "quarantine",
        rootKey(candidate.rootPath),
        candidate.relativePath,
      )
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.rename(candidate.canonicalPath, target)
      checkpoint.movedFiles.push({ source: candidate.canonicalPath, target })
      checkpoint.stage = "files-quarantined"
      await writeJsonAtomic(path.join(backupDir, "checkpoint.json"), checkpoint)
    }
    await updateManifests(selected, backupDir)
    checkpoint.stage = "manifests-written"
    await writeJsonAtomic(path.join(backupDir, "checkpoint.json"), checkpoint)
    const output = sqlite(plan.dbPath, buildDeleteSql(selected))
    if (!output.includes("deleted-ok") || !output.trim().endsWith("ok")) {
      throw new Error(`Catalog cleanup validation failed: ${output}`)
    }
    checkpoint.stage = "complete"
    checkpoint.completedAt = new Date().toISOString()
    await writeJsonAtomic(path.join(backupDir, "checkpoint.json"), checkpoint)
    console.log(JSON.stringify({ ...preview, backupDir, integrity: "ok" }, null, 2))
  } catch (error) {
    await rollback(checkpoint)
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
