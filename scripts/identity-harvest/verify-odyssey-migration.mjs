#!/usr/bin/env node

/**
 * ODE-374 — Verify `.odyssey/index.json` → `.odessay/index.json` v2 migration.
 *
 * Requirement 2 of the issue asks for evidence that the migration preserved:
 *   - valid selectedPaths
 *   - binding IDs
 *   - inode/hash evidence
 *   - source backup
 *
 * This tooling-only script compares the legacy `.odyssey/index.json` (or its
 * backup) against the current `.odessay/index.json` and reports every
 * discrepancy. It never writes to either index.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { normalizeManifest, readManifestAt, readWorkspaceManifests } from "./lib.mjs";
import { pathExists, printJson, readJson } from "../identity/lib.mjs";

function parseArgs(argv) {
  const options = {
    workspaceRoot: null,
    backupDir: null,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace-root") {
      options.workspaceRoot = argv[++index];
    } else if (arg === "--backup-dir") {
      options.backupDir = argv[++index];
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!options.workspaceRoot) {
    options.workspaceRoot = process.cwd();
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/identity-harvest/verify-odyssey-migration.mjs \
    --workspace-root <dir> [--backup-dir <dir>] [--json]

Compares the legacy .odyssey/index.json (live or from backup) against the
current .odessay/index.json and reports preservation of selectedPaths, ids,
inode/hash evidence and backup availability. Read-only.`);
}

async function readSourceManifest(workspaceRoot, backupDir) {
  // Prefer an explicit backup if provided.
  if (backupDir) {
    const backupPath = path.join(path.resolve(backupDir), "index", "index.json");
    if (await pathExists(backupPath)) {
      const raw = await readJson(backupPath);
      return {
        source: "backup",
        path: backupPath,
        document: normalizeManifest(raw),
      };
    }
    throw new Error(`Backup index not found at ${backupPath}`);
  }

  // Otherwise read the live legacy index if it still exists.
  const manifests = await readWorkspaceManifests(workspaceRoot);
  if (manifests.odyssey.exists) {
    return {
      source: "live-legacy",
      path: manifests.odyssey.path,
      document: manifests.odyssey.document,
    };
  }

  throw new Error(
    `No .odyssey/index.json found at ${workspaceRoot} and no --backup-dir provided.`,
  );
}

function arrayEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function compareBindings(sourceEntry, targetEntry) {
  if (!sourceEntry && !targetEntry) return { present: "both-missing" };
  if (!sourceEntry) return { present: "missing-in-source", idPreserved: false };
  if (!targetEntry) return { present: "missing-in-target", idPreserved: false };

  const idPreserved =
    sourceEntry.id !== null && targetEntry.id !== null && sourceEntry.id === targetEntry.id;

  return {
    present: "both-present",
    sourceId: sourceEntry.id,
    targetId: targetEntry.id,
    idPreserved,
    inodeMatch:
      sourceEntry.inode === null || targetEntry.inode === null
        ? null
        : sourceEntry.inode === targetEntry.inode,
    contentHashMatch:
      sourceEntry.contentHash === null || targetEntry.contentHash === null
        ? null
        : sourceEntry.contentHash === targetEntry.contentHash,
    sizeMatch:
      sourceEntry.size === null || targetEntry.size === null
        ? null
        : sourceEntry.size === targetEntry.size,
    lastSeenMatch:
      sourceEntry.lastSeen === null || targetEntry.lastSeen === null
        ? null
        : sourceEntry.lastSeen === targetEntry.lastSeen,
  };
}

async function verifyMigration(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const source = await readSourceManifest(workspaceRoot, options.backupDir);
  const targetManifests = await readWorkspaceManifests(workspaceRoot);
  const target = await readManifestAt(targetManifests.odessay.path);

  const targetDocument = target.exists ? target.document : { version: 1, selectedPaths: [], files: {} };

  const selectedPathsMatch = arrayEqual(
    source.document.selectedPaths,
    targetDocument.selectedPaths,
  );

  const allPaths = new Set([
    ...Object.keys(source.document.files),
    ...Object.keys(targetDocument.files),
  ]);

  const bindings = [];
  let idPreservedCount = 0;
  let idChangedCount = 0;
  let missingInTarget = 0;
  let missingInSource = 0;

  for (const relativePath of allPaths) {
    const sourceEntry = source.document.files[relativePath] ?? null;
    const targetEntry = targetDocument.files[relativePath] ?? null;
    const comparison = compareBindings(sourceEntry, targetEntry);

    if (comparison.present === "both-present") {
      if (comparison.idPreserved) idPreservedCount += 1;
      else idChangedCount += 1;
    } else if (comparison.present === "missing-in-target") {
      missingInTarget += 1;
    } else if (comparison.present === "missing-in-source") {
      missingInSource += 1;
    }

    bindings.push({ relativePath, ...comparison });
  }

  const discrepancies = bindings.filter(
    (b) =>
      b.present === "missing-in-target" ||
      b.present === "missing-in-source" ||
      (b.present === "both-present" && !b.idPreserved),
  );

  const backupAvailable = Boolean(options.backupDir) || targetManifests.odyssey.exists;

  return {
    workspaceRoot,
    source: {
      source: source.source,
      path: source.path,
      version: source.document.version,
      bindingRootId: source.document.bindingRootId,
      selectedPaths: source.document.selectedPaths,
      fileCount: Object.keys(source.document.files).length,
    },
    target: {
      path: targetManifests.odessay.path,
      exists: target.exists,
      version: targetDocument.version,
      bindingRootId: targetDocument.bindingRootId,
      selectedPaths: targetDocument.selectedPaths,
      fileCount: Object.keys(targetDocument.files).length,
    },
    backupAvailable,
    selectedPathsMatch,
    counts: {
      totalBindings: bindings.length,
      idPreserved: idPreservedCount,
      idChanged: idChangedCount,
      missingInTarget,
      missingInSource,
      discrepancies: discrepancies.length,
    },
    bindings,
    discrepancies,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await verifyMigration(options);

  if (options.json) {
    printJson(result);
  } else {
    console.log(
      `verify-odyssey-migration: ${result.counts.discrepancies === 0 ? "OK" : "DISCREPANCIES"}`,
    );
    printJson(result);
  }

  if (result.counts.discrepancies > 0 || !result.backupAvailable) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
