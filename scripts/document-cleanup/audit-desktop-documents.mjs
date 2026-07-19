#!/usr/bin/env node

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  buildCleanupRecommendations,
  classifyMarkdown,
  csvEscape,
  isManagedRoot,
  normalizeTitle,
  sha256,
} from "./lib.mjs"

const DEFAULT_DB = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "com.z9ne.odessay",
  "desktop-index.sqlite3",
)

function parseArgs(argv) {
  const options = {
    db: DEFAULT_DB,
    outputDir: path.resolve("artifacts/document-cleanup"),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--") continue
    if (arg === "--db") options.db = path.resolve(argv[++index])
    else if (arg === "--output-dir") options.outputDir = path.resolve(argv[++index])
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function sqliteRows(dbPath, query) {
  const result = spawnSync("/usr/bin/sqlite3", ["-readonly", "-json", dbPath, query], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || "sqlite3 failed")
  return result.stdout.trim() ? JSON.parse(result.stdout) : []
}

async function readManifest(rootPath) {
  const manifestPath = path.join(rootPath, ".odessay", "index.json")
  try {
    return { path: manifestPath, document: JSON.parse(await fs.readFile(manifestPath, "utf8")) }
  } catch (error) {
    if (error?.code === "ENOENT") return { path: manifestPath, document: null }
    throw error
  }
}

function toIso(value) {
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null
}

function selectRows(dbPath) {
  return sqliteRows(
    dbPath,
    `SELECT
      d.id,
      d.local_present AS localPresent,
      d.cloud_present AS cloudPresent,
      d.cloud_account_id AS cloudAccountId,
      d.sync_status AS syncStatus,
      d.title_cache AS title,
      d.deleted_at_cache AS deletedAt,
      d.created_at AS createdAt,
      d.modified_at AS modifiedAt,
      b.binding_root_id AS bindingRootId,
      b.relative_path AS relativePath,
      b.canonical_path AS canonicalPath,
      b.content_hash AS catalogContentHash,
      b.size AS catalogSize,
      b.last_seen_at AS lastSeenAt,
      br.root_path AS rootPath,
      br.visible_as_workspace AS visibleAsWorkspace,
      (SELECT COUNT(*) FROM sync_mutations sm
        WHERE sm.document_id=d.id AND sm.status!='synced') +
      (SELECT COUNT(*) FROM metadata_sync_mutations mm
        WHERE mm.entity_kind='writing' AND mm.entity_id=d.id AND mm.status!='synced')
        AS unsyncedMutationCount
    FROM documents d
    LEFT JOIN document_bindings b ON b.document_id=d.id
    LEFT JOIN binding_roots br ON br.id=b.binding_root_id
    WHERE d.deleted_at_cache IS NULL
    ORDER BY d.modified_at DESC`,
  )
}

async function inspectRow(row, dbPath, manifestCache) {
  const canonicalPath = row.canonicalPath ? path.resolve(row.canonicalPath) : null
  const rootPath = row.rootPath ? path.resolve(row.rootPath) : null
  if (!canonicalPath || !rootPath) {
    return {
      ...row,
      localPresent: Boolean(row.localPresent),
      cloudPresent: Boolean(row.cloudPresent),
      unsyncedMutationCount: Number(row.unsyncedMutationCount ?? 0),
      fileExists: false,
      managedRoot: false,
      manifestPath: null,
      manifestMatches: false,
      isEmpty: false,
      emptyKind: null,
      rawHash: null,
      canonicalHash: null,
      bodyHash: null,
      fileSize: null,
      fileMtimeMs: null,
      fileMtime: null,
      decisionTimestampMs: Number(row.modifiedAt ?? row.createdAt ?? 0),
      decisionTimestamp: toIso(Number(row.modifiedAt ?? row.createdAt ?? 0)),
    }
  }

  let manifest = manifestCache.get(rootPath)
  if (!manifest) {
    manifest = await readManifest(rootPath)
    manifestCache.set(rootPath, manifest)
  }
  const manifestEntry = manifest.document?.files?.[row.relativePath] ?? null
  const manifestMatches = manifestEntry?.id === row.id

  try {
    const [bytes, stat] = await Promise.all([fs.readFile(canonicalPath), fs.stat(canonicalPath)])
    const markdown = bytes.toString("utf8")
    const classification = classifyMarkdown(markdown, {
      filename: row.relativePath,
      title: row.title,
    })
    const decisionTimestampMs = Math.trunc(stat.mtimeMs)
    return {
      ...row,
      localPresent: Boolean(row.localPresent),
      cloudPresent: Boolean(row.cloudPresent),
      unsyncedMutationCount: Number(row.unsyncedMutationCount ?? 0),
      fileExists: true,
      managedRoot: isManagedRoot(rootPath, dbPath),
      manifestPath: manifest.path,
      manifestMatches,
      rawHash: sha256(bytes),
      fileSize: stat.size,
      fileMtimeMs: decisionTimestampMs,
      fileMtime: stat.mtime.toISOString(),
      decisionTimestampMs,
      decisionTimestamp: stat.mtime.toISOString(),
      ...classification,
      canonicalMarkdown: undefined,
      canonicalBody: undefined,
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    return {
      ...row,
      localPresent: Boolean(row.localPresent),
      cloudPresent: Boolean(row.cloudPresent),
      unsyncedMutationCount: Number(row.unsyncedMutationCount ?? 0),
      fileExists: false,
      managedRoot: isManagedRoot(rootPath, dbPath),
      manifestPath: manifest.path,
      manifestMatches,
      isEmpty: false,
      emptyKind: null,
      rawHash: null,
      canonicalHash: null,
      bodyHash: null,
      fileSize: null,
      fileMtimeMs: null,
      fileMtime: null,
      decisionTimestampMs: Number(row.modifiedAt ?? row.createdAt ?? 0),
      decisionTimestamp: toIso(Number(row.modifiedAt ?? row.createdAt ?? 0)),
    }
  }
}

function buildTitleGroups(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const key = normalizeTitle(entry.title || path.basename(entry.relativePath ?? "", ".md"))
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(entry.id)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .filter(([, memberIds]) => memberIds.length > 1)
    .map(([normalizedTitle, memberIds]) => ({ normalizedTitle, memberIds, count: memberIds.length }))
    .sort((a, b) => b.count - a.count)
}

function buildCsv(entries) {
  const columns = [
    "recommendedAction", "approved", "reasons", "blockers", "duplicateGroupId", "id",
    "title", "canonicalPath", "rootPath", "fileMtime", "fileSize", "emptyKind",
    "cloudPresent", "cloudAccountId", "syncStatus", "unsyncedMutationCount", "bodyHash",
  ]
  return [
    columns.join(","),
    ...entries.map((entry) =>
      columns.map((column) => csvEscape(column === "approved" ? false : entry[column])).join(","),
    ),
  ].join("\n") + "\n"
}

function buildMarkdown(report) {
  const summary = report.summary
  const largest = report.duplicateGroups.slice(0, 20)
  return `# Desktop document cleanup audit

Generated: ${report.generatedAt}

## Summary

- Active catalog rows: ${summary.activeCatalogRows}
- Active rows with local or cloud presence: ${summary.activeRowsWithPresence}
- Catalog rows marked local: ${summary.catalogLocalRows}
- Local files inspected: ${summary.localFilesInspected}
- Missing files still marked local: ${summary.missingBoundFiles}
- Cloud-only rows not content-inspected: ${summary.cloudOnlyRows}
- Orphan catalog rows (no local or cloud presence): ${summary.orphanRows}
- Empty files: ${summary.emptyFiles}
  - Blank: ${summary.emptyByKind.blank ?? 0}
  - Frontmatter only: ${summary.emptyByKind["frontmatter-only"] ?? 0}
  - Frontmatter fragment only: ${summary.emptyByKind["frontmatter-fragment-only"] ?? 0}
  - Title only: ${summary.emptyByKind["title-only"] ?? 0}
- Duplicate body groups: ${summary.duplicateGroups}
- Extra duplicate copies: ${summary.extraDuplicateCopies}
- Safe delete candidates: ${summary.safeDeleteCandidates}
- Manual review: ${summary.manualReview}
- Keep: ${summary.keep}

## Decision policy

Duplicates are grouped by normalized Markdown body after removing a leading frontmatter block. Empty groups are handled separately. The keeper is selected by protected identity first (unsynced/conflict/cloud), then newest filesystem modification date. Automatic candidates are limited to local-only files in the managed root with a matching manifest and no pending mutation.

## Largest duplicate groups

${largest.map((group) => `- ${group.groupId}: ${group.count} copies; keep ${group.keeperId}`).join("\n") || "None."}

The complete row-level evidence is in \`desktop-document-audit.csv\` and \`desktop-document-audit.json\`. The generated cleanup plan is inert until individual rows are marked \`approved: true\`.
`
}

async function writeAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp-${process.pid}`
  await fs.writeFile(temporary, value)
  await fs.rename(temporary, filePath)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const dbStat = await fs.stat(options.db)
  const rows = selectRows(options.db)
  const manifestCache = new Map()
  const inspected = []
  for (const row of rows) inspected.push(await inspectRow(row, options.db, manifestCache))
  const { entries, duplicateGroups } = buildCleanupRecommendations(inspected)
  const emptyByKind = Object.create(null)
  for (const entry of entries.filter((item) => item.isEmpty)) {
    emptyByKind[entry.emptyKind] = (emptyByKind[entry.emptyKind] ?? 0) + 1
  }
  const summary = {
    activeCatalogRows: entries.length,
    activeRowsWithPresence: entries.filter((entry) => entry.localPresent || entry.cloudPresent).length,
    catalogLocalRows: entries.filter((entry) => entry.localPresent).length,
    localFilesInspected: entries.filter((entry) => entry.fileExists).length,
    missingBoundFiles: entries.filter((entry) => entry.localPresent && !entry.fileExists).length,
    cloudOnlyRows: entries.filter((entry) => !entry.localPresent && entry.cloudPresent).length,
    orphanRows: entries.filter((entry) => !entry.localPresent && !entry.cloudPresent).length,
    emptyFiles: entries.filter((entry) => entry.isEmpty).length,
    emptyByKind,
    duplicateGroups: duplicateGroups.length,
    extraDuplicateCopies: duplicateGroups.reduce((total, group) => total + group.count - 1, 0),
    safeDeleteCandidates: entries.filter((entry) => entry.recommendedAction === "delete-candidate").length,
    manualReview: entries.filter((entry) => entry.recommendedAction === "manual-review").length,
    keep: entries.filter((entry) => entry.recommendedAction === "keep").length,
  }
  const generatedAt = new Date().toISOString()
  const planId = sha256(`${options.db}\0${dbStat.size}\0${Math.trunc(dbStat.mtimeMs)}\0${generatedAt}`).slice(0, 24)
  const report = {
    version: 1,
    planId,
    generatedAt,
    source: {
      dbPath: options.db,
      dbSize: dbStat.size,
      dbMtimeMs: Math.trunc(dbStat.mtimeMs),
      supabaseContentInspected: false,
    },
    summary,
    duplicateGroups,
    sameTitleGroups: buildTitleGroups(entries),
    entries,
  }
  const cleanupPlan = {
    version: 1,
    planId,
    generatedAt,
    dbPath: options.db,
    policy: "local managed root only; protected identity first; newest mtime among equivalents",
    candidates: entries
      .filter((entry) => entry.recommendedAction === "delete-candidate")
      .map((entry) => ({
        id: entry.id,
        approved: false,
        reasons: entry.reasons,
        canonicalPath: entry.canonicalPath,
        rootPath: entry.rootPath,
        relativePath: entry.relativePath,
        manifestPath: entry.manifestPath,
        expectedRawHash: entry.rawHash,
        expectedSize: entry.fileSize,
        expectedMtimeMs: entry.fileMtimeMs,
        duplicateGroupId: entry.duplicateGroupId,
      })),
  }

  await Promise.all([
    writeAtomic(path.join(options.outputDir, "desktop-document-audit.json"), `${JSON.stringify(report, null, 2)}\n`),
    writeAtomic(path.join(options.outputDir, "desktop-document-audit.csv"), buildCsv(entries)),
    writeAtomic(path.join(options.outputDir, "desktop-document-audit.md"), buildMarkdown(report)),
    writeAtomic(path.join(options.outputDir, "desktop-cleanup-plan.json"), `${JSON.stringify(cleanupPlan, null, 2)}\n`),
  ])
  console.log(JSON.stringify({ planId, outputDir: options.outputDir, summary }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
