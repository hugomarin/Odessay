#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const LEGACY_INDEX_DIR = concatLegacyIndexDir();
const INDEX_DIRS = new Set([".odessay", LEGACY_INDEX_DIR]);
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

function parseArgs(argv) {
  const roots = [];
  let jsonOnly = false;

  for (const arg of argv) {
    if (arg === "--json") {
      jsonOnly = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      roots.push(arg);
    }
  }

  return {
    roots: roots.length > 0 ? roots : [process.cwd()],
    jsonOnly,
  };
}

function printHelp() {
  console.log(`Usage: node scripts/identity/count-id-conflicts.mjs [--json] [workspace-root ...]

Counts UUID conflicts between markdown frontmatter.id and workspace index ids.

The script is read-only. For each root, it uses the root itself when it contains
.odessay/index.json or the legacy index.json. Otherwise it discovers
workspace roots below it. It reports: total docs, docs with frontmatter.id, docs
with index.id, conflicts, and docs without either id.`);
}

function concatLegacyIndexDir() {
  return ".ody" + "ssey";
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function getIndexEntries(indexJson) {
  if (indexJson && typeof indexJson.files === "object" && !Array.isArray(indexJson.files)) {
    return Object.entries(indexJson.files);
  }

  if (Array.isArray(indexJson?.files)) {
    return indexJson.files.map((entry) => {
      const relativePath = entry.path ?? entry.relativePath ?? entry.canonical_path;
      return [relativePath, entry];
    });
  }

  if (Array.isArray(indexJson?.entries)) {
    return indexJson.entries.map((entry) => {
      const relativePath = entry.path ?? entry.relativePath ?? entry.canonical_path;
      return [relativePath, entry];
    });
  }

  return [];
}

function normalizeRelative(filePath) {
  return filePath.split(path.sep).join("/");
}

function indexIdForEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return entry.id ?? entry.uuid ?? entry.document_id ?? entry.writing_id ?? null;
}

async function loadWorkspaceIndexes(workspaceRoot) {
  const indexedIds = new Map();
  const loadedIndexes = [];

  for (const indexDir of INDEX_DIRS) {
    const indexPath = path.join(workspaceRoot, indexDir, "index.json");
    if (!(await pathExists(indexPath))) {
      continue;
    }

    const indexJson = await readJson(indexPath);
    loadedIndexes.push(indexPath);

    for (const [relativePath, entry] of getIndexEntries(indexJson)) {
      if (!relativePath || typeof relativePath !== "string") {
        continue;
      }

      const id = indexIdForEntry(entry);
      const normalized = normalizeRelative(path.normalize(relativePath));
      indexedIds.set(normalized, typeof id === "string" && id.length > 0 ? id : null);
    }
  }

  return { indexedIds, loadedIndexes };
}

async function hasWorkspaceIndex(workspaceRoot) {
  for (const indexDir of INDEX_DIRS) {
    if (await pathExists(path.join(workspaceRoot, indexDir, "index.json"))) {
      return true;
    }
  }

  return false;
}

async function discoverWorkspaceRoots(searchRoot, found = new Set()) {
  const absoluteRoot = path.resolve(searchRoot);
  if (await hasWorkspaceIndex(absoluteRoot)) {
    found.add(absoluteRoot);
    return found;
  }

  let entries;
  try {
    entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(absoluteRoot, entry.name);
    if (INDEX_DIRS.has(entry.name)) {
      if (await pathExists(path.join(fullPath, "index.json"))) {
        found.add(path.dirname(fullPath));
      }
      continue;
    }

    await discoverWorkspaceRoots(fullPath, found);
  }

  return found;
}

async function collectMarkdownFiles(dir, baseDir = dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || INDEX_DIRS.has(entry.name)) {
        continue;
      }
      await collectMarkdownFiles(fullPath, baseDir, files);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push({
        absolutePath: fullPath,
        relativePath: normalizeRelative(path.relative(baseDir, fullPath)),
      });
    }
  }

  return files;
}

async function readFrontmatterId(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return null;
  }

  const newline = raw.startsWith("---\r\n") ? "\r\n" : "\n";
  const endMarker = `${newline}---${newline}`;
  const endIndex = raw.indexOf(endMarker, 3);
  if (endIndex === -1) {
    return null;
  }

  const frontmatterRaw = raw.slice(3 + newline.length, endIndex);
  return parseFrontmatterId(frontmatterRaw);
}

function parseFrontmatterId(frontmatterRaw) {
  for (const rawLine of frontmatterRaw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^id\s*:\s*(.+?)\s*$/);
    if (!match) {
      continue;
    }

    const value = match[1].trim();
    if (!value || value === "null" || value === "~") {
      return null;
    }

    const quoted = value.match(/^['"](.+)['"]$/);
    return quoted ? quoted[1] : value;
  }

  return null;
}

async function countWorkspace(workspaceRootInput) {
  const workspaceRoot = path.resolve(workspaceRootInput);
  const { indexedIds, loadedIndexes } = await loadWorkspaceIndexes(workspaceRoot);
  const markdownFiles = await collectMarkdownFiles(workspaceRoot);
  const docs = [];

  const counts = {
    totalDocs: markdownFiles.length,
    withFrontmatterId: 0,
    withIndexId: 0,
    conflicts: 0,
    withoutEitherId: 0,
  };

  for (const file of markdownFiles) {
    const frontmatterId = await readFrontmatterId(file.absolutePath);
    const indexId = indexedIds.get(file.relativePath) ?? null;
    const hasFrontmatterId = Boolean(frontmatterId);
    const hasIndexId = Boolean(indexId);
    const conflict = hasFrontmatterId && hasIndexId && frontmatterId !== indexId;

    if (hasFrontmatterId) counts.withFrontmatterId += 1;
    if (hasIndexId) counts.withIndexId += 1;
    if (conflict) counts.conflicts += 1;
    if (!hasFrontmatterId && !hasIndexId) counts.withoutEitherId += 1;

    docs.push({
      path: file.relativePath,
      frontmatterId,
      indexId,
      conflict,
    });
  }

  return {
    root: workspaceRoot,
    loadedIndexes,
    counts,
    conflicts: docs.filter((doc) => doc.conflict),
  };
}

function aggregate(workspaces) {
  return workspaces.reduce(
    (acc, workspace) => {
      acc.totalDocs += workspace.counts.totalDocs;
      acc.withFrontmatterId += workspace.counts.withFrontmatterId;
      acc.withIndexId += workspace.counts.withIndexId;
      acc.conflicts += workspace.counts.conflicts;
      acc.withoutEitherId += workspace.counts.withoutEitherId;
      return acc;
    },
    {
      totalDocs: 0,
      withFrontmatterId: 0,
      withIndexId: 0,
      conflicts: 0,
      withoutEitherId: 0,
    },
  );
}

function printTable(summary) {
  const rows = [
    ["total docs", summary.totalDocs],
    ["with frontmatter.id", summary.withFrontmatterId],
    ["with index.id", summary.withIndexId],
    ["conflicts", summary.conflicts],
    ["without either id", summary.withoutEitherId],
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length));

  console.log("Frontmatter <-> workspace index UUID count");
  console.log("");
  console.log("Metric".padEnd(labelWidth) + "  Count");
  console.log("-".repeat(labelWidth) + "  -----");
  for (const [label, value] of rows) {
    console.log(label.padEnd(labelWidth) + "  " + String(value));
  }
}

async function main() {
  const { roots, jsonOnly } = parseArgs(process.argv.slice(2));
  const workspaceRoots = new Set();
  const workspaces = [];

  for (const root of roots) {
    const discovered = await discoverWorkspaceRoots(root);
    if (discovered.size === 0) {
      workspaceRoots.add(path.resolve(root));
    } else {
      for (const workspaceRoot of discovered) {
        workspaceRoots.add(workspaceRoot);
      }
    }
  }

  for (const workspaceRoot of workspaceRoots) {
    workspaces.push(await countWorkspace(workspaceRoot));
  }

  const result = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    workspaces,
    summary: aggregate(workspaces),
  };

  if (!jsonOnly) {
    printTable(result.summary);
    console.log("");
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
