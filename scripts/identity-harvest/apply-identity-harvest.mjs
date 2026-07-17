#!/usr/bin/env node

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathExists, readJson, writeJsonAtomic } from "../identity/lib.mjs";
import {
  buildCatalogSql,
  buildManifest,
  buildWritePlan,
  isUuid,
  sqlLiteral,
} from "./write-phase-lib.mjs";

function parseArgs(argv) {
  const options = { report: null, db: null, root: null, settings: null, backupDir: null, rollbackBackup: null, apply: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report") options.report = argv[++index];
    else if (arg === "--db") options.db = argv[++index];
    else if (arg === "--workspace-root") options.root = argv[++index];
    else if (arg === "--settings") options.settings = argv[++index];
    else if (arg === "--backup-dir") options.backupDir = argv[++index];
    else if (arg === "--rollback-backup") options.rollbackBackup = argv[++index];
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.db || (!options.rollbackBackup && !options.report)) {
    throw new Error("--db and either --report or --rollback-backup are required");
  }
  return options;
}

function sqlite(dbPath, sql, { readOnly = false } = {}) {
  const args = readOnly ? ["-readonly", "-json", dbPath, sql] : [dbPath];
  const result = spawnSync("/usr/bin/sqlite3", args, {
    encoding: "utf8",
    input: readOnly ? undefined : sql,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "sqlite3 failed");
  return result.stdout.trim();
}

function sqliteRows(dbPath, query) {
  const output = sqlite(dbPath, query, { readOnly: true });
  return output ? JSON.parse(output) : [];
}

async function fingerprintMarkdown(workspace) {
  const digest = crypto.createHash("sha256");
  for (const row of [...workspace.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    const canonicalPath = row.proposedBinding?.canonicalPath;
    const stat = await fs.stat(canonicalPath);
    if (
      stat.size !== row.evidence.currentSize ||
      Math.trunc(stat.mtimeMs) !== row.evidence.currentMtimeMs
    ) {
      throw new Error(`Source drift detected before write: ${row.relativePath}`);
    }
    digest.update(row.relativePath);
    digest.update("\0");
    digest.update(await fs.readFile(canonicalPath));
    digest.update("\0");
  }
  return digest.digest("hex");
}

async function copyIfPresent(source, target) {
  if (!(await pathExists(source))) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = path.resolve(options.db);
  if (options.rollbackBackup) {
    const backupDir = path.resolve(options.rollbackBackup);
    const checkpoint = await readJson(path.join(backupDir, "checkpoint.json"));
    const rootPath = path.resolve(options.root ?? checkpoint.rootPath);
    const dbBackup = path.join(backupDir, "desktop-index.before.sqlite3");
    if (!(await pathExists(dbBackup))) throw new Error("Rollback database backup is missing");
    sqlite(dbPath, `.restore ${sqlLiteral(dbBackup)}\n`);
    const manifestPath = path.join(rootPath, ".odessay", "index.json");
    const manifestBackup = path.join(backupDir, "odessay-index.before.json");
    if (checkpoint.manifestExistedBefore) {
      await writeJsonAtomic(manifestPath, await readJson(manifestBackup));
    } else {
      await fs.rm(manifestPath, { force: true });
    }
    if (checkpoint.settingsPath && checkpoint.settingsExistedBefore) {
      await writeJsonAtomic(checkpoint.settingsPath, await readJson(path.join(backupDir, "settings.before.json")));
    }
    const integrity = sqlite(dbPath, "PRAGMA integrity_check;", { readOnly: true });
    if (!integrity.includes("ok")) throw new Error(`Rollback integrity check failed: ${integrity}`);
    const result = { mode: "rollback", stage: "complete", rootPath, backupDir, integrity: "ok" };
    await writeJsonAtomic(path.join(backupDir, "rollback-complete.json"), result);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const report = await readJson(path.resolve(options.report));
  if (report.workspaces?.length !== 1) throw new Error("Write phase requires exactly one workspace");
  const workspace = report.workspaces[0];
  const rootPath = path.resolve(options.root ?? workspace.root);
  if (rootPath !== path.resolve(workspace.root)) throw new Error("Report root does not match --workspace-root");
  const integrity = sqlite(dbPath, "PRAGMA integrity_check;", { readOnly: true });
  if (!integrity.includes("ok")) throw new Error(`SQLite integrity check failed: ${integrity}`);

  const catalog = {
    documents: sqliteRows(dbPath, "SELECT * FROM documents"),
    bindings: sqliteRows(dbPath, "SELECT * FROM document_bindings"),
  };
  const rootRows = sqliteRows(
    dbPath,
    `SELECT * FROM binding_roots WHERE root_path=${sqlLiteral(rootPath)}`,
  );
  const previousRootId = rootRows[0]?.id ?? null;
  const existingManifestId = workspace.manifests?.odessay?.bindingRootId ?? null;
  const bindingRootId = isUuid(existingManifestId)
    ? existingManifestId
    : isUuid(previousRootId)
      ? previousRootId
      : crypto.randomUUID();
  const planned = await buildWritePlan({ workspace, catalog });
  const selectedPaths = workspace.manifests?.odessay?.selectedPaths?.length
    ? workspace.manifests.odessay.selectedPaths
    : workspace.manifests?.odyssey?.selectedPaths ?? [];
  const manifest = buildManifest({ bindingRootId, selectedPaths, planned });
  const markdownFingerprintBefore = await fingerprintMarkdown(workspace);
  const counts = planned.reduce((acc, entry) => {
    acc[entry.resolution] = (acc[entry.resolution] ?? 0) + 1;
    if (entry.rejectedEvidence) acc.rejectedEvidence += 1;
    if (entry.previousCatalogId && entry.previousCatalogId !== entry.id) acc.rekeyed += 1;
    return acc;
  }, { rejectedEvidence: 0, rekeyed: 0 });
  const preview = {
    mode: options.apply ? "apply" : "dry-run",
    rootPath,
    bindingRootId,
    previousRootId,
    files: planned.length,
    uniqueUuidCount: new Set(planned.map((entry) => entry.id)).size,
    counts,
    markdownFingerprintBefore,
  };
  if (!options.apply) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backupDir = path.resolve(options.backupDir ?? path.join(path.dirname(dbPath), "ode-374-backups", stamp));
  await fs.mkdir(backupDir, { recursive: true });
  const manifestPath = path.join(rootPath, ".odessay", "index.json");
  const legacyManifestPath = path.join(rootPath, ".odyssey", "index.json");
  const manifestExistedBefore = await pathExists(manifestPath);
  const legacyManifestExistedBefore = await pathExists(legacyManifestPath);
  const checkpointPath = path.join(backupDir, "checkpoint.json");
  const settingsPath = options.settings ? path.resolve(options.settings) : null;
  const settingsExistedBefore = settingsPath ? await pathExists(settingsPath) : false;
  await copyIfPresent(manifestPath, path.join(backupDir, "odessay-index.before.json"));
  await copyIfPresent(legacyManifestPath, path.join(backupDir, "odyssey-index.before.json"));
  if (settingsPath) await copyIfPresent(settingsPath, path.join(backupDir, "settings.before.json"));
  await fs.copyFile(path.resolve(options.report), path.join(backupDir, "harvest-report.json"));
  sqlite(dbPath, `.backup ${sqlLiteral(path.join(backupDir, "desktop-index.before.sqlite3"))}\n`);
  await writeJsonAtomic(path.join(backupDir, "write-plan.json"), { rootPath, bindingRootId, planned });
  const checkpointBase = {
    ...preview,
    backupDir,
    manifestExistedBefore,
    legacyManifestExistedBefore,
    settingsPath,
    settingsExistedBefore,
    startedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(checkpointPath, { ...checkpointBase, stage: "backed-up" });

  await writeJsonAtomic(manifestPath, manifest);
  if (settingsPath) {
    const settingsDocument = await readJson(settingsPath);
    const desktop = settingsDocument.desktop_settings_v1 ?? {};
    const roots = Array.isArray(desktop.bindingRoots) ? desktop.bindingRoots : [];
    const nowIso = new Date().toISOString();
    const migratedRoot = {
      id: bindingRootId,
      rootPath,
      kind: "external",
      visibleAsWorkspace: false,
      selectedPaths,
      consentedAt: nowIso,
      createdAt: nowIso,
    };
    desktop.bindingRoots = roots.some((root) => root.id === bindingRootId || root.rootPath === rootPath)
      ? roots.map((root) => root.id === bindingRootId || root.rootPath === rootPath ? { ...root, ...migratedRoot } : root)
      : [...roots, migratedRoot];
    settingsDocument.desktop_settings_v1 = desktop;
    await writeJsonAtomic(settingsPath, settingsDocument);
  }
  await writeJsonAtomic(checkpointPath, { ...checkpointBase, stage: "manifest-written" });

  const now = Date.now();
  const sql = buildCatalogSql({ rootPath, previousRootId, bindingRootId, planned, now });
  const sqlOutput = sqlite(dbPath, sql);
  if (!sqlOutput.includes("ok")) throw new Error(`Post-migration SQLite integrity check failed: ${sqlOutput}`);

  const markdownFingerprintAfter = await fingerprintMarkdown(workspace);
  if (markdownFingerprintAfter !== markdownFingerprintBefore) {
    throw new Error("Markdown content changed during identity migration");
  }
  const parity = sqliteRows(
    dbPath,
    `SELECT COUNT(*) AS count FROM document_bindings WHERE binding_root_id=${sqlLiteral(bindingRootId)}`,
  )[0]?.count;
  if (Number(parity) < planned.length) throw new Error(`Catalog parity failed: ${parity}/${planned.length}`);
  const final = {
    ...checkpointBase,
    stage: "complete",
    catalogBindingsForRoot: Number(parity),
    markdownFingerprintAfter,
    completedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(checkpointPath, final);
  console.log(JSON.stringify(final, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
