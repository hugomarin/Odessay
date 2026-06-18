#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  collectMarkdownFiles,
  loadEnvFile,
  pathExists,
  printJson,
  readJson,
  readMarkdownIdentity,
  readWorkspaceIndex,
} from "./lib.mjs";

const ODESSAY_FRONTMATTER_KEYS = new Set(["id", "slug", "status", "visibility", "version"]);
const CLOUD_METADATA_KEYS = new Set(["slug", "status", "visibility", "version"]);

function parseArgs(argv) {
  const options = {
    roots: [],
    envPath: ".env.local",
    apply: false,
    cloud: false,
    backupDir: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace-root") {
      options.roots.push(argv[++index]);
    } else if (arg === "--env") {
      options.envPath = argv[++index];
    } else if (arg === "--backup-dir") {
      options.backupDir = argv[++index];
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--cloud") {
      options.cloud = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      options.roots.push(arg);
    }
  }

  if (options.roots.length === 0) {
    options.roots.push(process.cwd());
  }
  if (options.apply && !options.backupDir) {
    throw new Error("--apply requires --backup-dir created by backup-restore.mjs backup.");
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/identity/clean-frontmatter.mjs --workspace-root <dir> [--workspace-root <dir>] [--apply --backup-dir <dir>] [--cloud] [--env .env.local] [--json]

Dry-run is the default. The script removes only Odessay frontmatter keys:
id, slug, status, visibility, version.
--apply rewrites markdown and requires a verified backup.
--cloud updates matching writings metadata rows before rewriting markdown.`);
}

async function verifyBackupForApply(workspaceRoot, backupDir) {
  const manifestPath = path.join(backupDir, "manifest.json");
  if (!(await pathExists(manifestPath))) {
    throw new Error(`Missing backup manifest: ${manifestPath}`);
  }

  const manifest = await readJson(manifestPath);
  const failures = [];
  for (const file of manifest.files ?? []) {
    const livePath = path.join(workspaceRoot, file.path);
    const backupPath = path.join(backupDir, "files", file.backupPath);
    if (!(await pathExists(livePath))) {
      failures.push(`${file.path}: missing live file`);
      continue;
    }
    if (!(await pathExists(backupPath))) {
      failures.push(`${file.path}: missing backup file`);
      continue;
    }
    const liveIdentity = await readMarkdownIdentity(livePath);
    const backupIdentity = await readMarkdownIdentity(backupPath);
    if (liveIdentity.contentHash !== file.contentHash) {
      failures.push(`${file.path}: live file does not match backup manifest`);
    }
    if (backupIdentity.contentHash !== file.contentHash) {
      failures.push(`${file.path}: backup file does not match backup manifest`);
    }
  }

  if (manifest.index?.existed) {
    const backupPath = path.join(backupDir, manifest.index.backupPath);
    if (!(await pathExists(backupPath))) {
      failures.push(`${manifest.index.sourcePath}: missing index backup file`);
    } else if (await pathExists(manifest.index.sourcePath)) {
      const backupRaw = await fs.readFile(backupPath, "utf8");
      const liveRaw = await fs.readFile(manifest.index.sourcePath, "utf8");
      if (backupRaw !== liveRaw) {
        failures.push(`${manifest.index.sourcePath}: live index differs from backup`);
      }
    }
  } else if (manifest.index?.sourcePath && (await pathExists(manifest.index.sourcePath))) {
    failures.push(`${manifest.index.sourcePath}: live index was created after backup`);
  }

  if (failures.length > 0) {
    throw new Error(`Backup verification failed before clean apply:\n${failures.join("\n")}`);
  }

  return { checkedFiles: manifest.files?.length ?? 0 };
}

async function createSupabaseAdmin(envPath) {
  const env = await loadEnvFile(envPath);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function findFrontmatter(raw) {
  const opener = raw.startsWith("---\n") ? "---\n" : raw.startsWith("---\r\n") ? "---\r\n" : null;
  if (!opener) {
    return null;
  }

  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const endIndex = normalized.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return null;
  }

  const frontmatterRaw = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + "\n---\n".length);
  return { frontmatterRaw, body };
}

function parseScalarValue(valueRaw) {
  const value = valueRaw.trim();
  if (!value || value === "null" || value === "~") {
    return null;
  }
  const quoted = value.match(/^['"](.+)['"]$/);
  return quoted ? quoted[1] : value;
}

function parseFrontmatterLine(line) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
  if (!match) {
    return null;
  }
  return { key: match[1], value: parseScalarValue(match[2]) };
}

function cleanFrontmatter(raw) {
  const parsed = findFrontmatter(raw);
  if (!parsed) {
    return {
      changed: false,
      nextRaw: raw,
      removedKeys: [],
      preservedKeys: [],
      metadata: {},
      removedWholeBlock: false,
    };
  }

  const lines = parsed.frontmatterRaw.split("\n");
  const keptLines = [];
  const removedKeys = [];
  const preservedKeys = [];
  const metadata = {};

  for (const line of lines) {
    const parsedLine = parseFrontmatterLine(line);
    if (!parsedLine || !ODESSAY_FRONTMATTER_KEYS.has(parsedLine.key)) {
      keptLines.push(line);
      if (parsedLine?.key) {
        preservedKeys.push(parsedLine.key);
      }
      continue;
    }

    removedKeys.push(parsedLine.key);
    if (CLOUD_METADATA_KEYS.has(parsedLine.key) && parsedLine.value !== null) {
      metadata[parsedLine.key] =
        parsedLine.key === "version" ? Number(parsedLine.value) : parsedLine.value;
    }
  }

  if (removedKeys.length === 0) {
    return {
      changed: false,
      nextRaw: raw,
      removedKeys: [],
      preservedKeys,
      metadata: {},
      removedWholeBlock: false,
    };
  }

  const meaningfulKeptLines = keptLines.filter((line) => line.trim() !== "");
  const removedWholeBlock = meaningfulKeptLines.length === 0;
  const nextRaw = removedWholeBlock
    ? parsed.body.replace(/^\n/, "")
    : `---\n${keptLines.join("\n").replace(/\n+$/g, "")}\n---\n${parsed.body}`;

  return {
    changed: true,
    nextRaw,
    removedKeys,
    preservedKeys,
    metadata,
    removedWholeBlock,
  };
}

async function fetchCloudRows(supabase, ids) {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("writings")
    .select("id, slug, status, visibility, version")
    .in("id", ids);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((row) => [row.id, row]));
}

async function applyCloudMetadata(supabase, docs) {
  const updated = [];
  const skipped = [];

  for (const doc of docs) {
    const metadata = doc.cloudMetadata;
    if (!doc.changed || !metadata || Object.keys(metadata).length === 0) {
      skipped.push(doc.path);
      continue;
    }

    const { error } = await supabase.from("writings").update(metadata).eq("id", doc.id);
    if (error) {
      throw new Error(error.message);
    }
    updated.push(doc.id);
  }

  return { updated, skipped };
}

async function cleanWorkspace(rootInput, options, supabase) {
  const workspaceRoot = path.resolve(rootInput);
  const backup = options.apply
    ? await verifyBackupForApply(workspaceRoot, path.resolve(options.backupDir))
    : null;
  const markdownFiles = await collectMarkdownFiles(workspaceRoot);
  const index = await readWorkspaceIndex(workspaceRoot);
  const docs = [];

  for (const file of markdownFiles) {
    const raw = await fs.readFile(file.absolutePath, "utf8");
    const identity = await readMarkdownIdentity(file.absolutePath);
    const indexEntry = index.document.files?.[file.relativePath] ?? null;
    const indexId = indexEntry?.id ?? indexEntry?.uuid ?? indexEntry?.document_id ?? null;
    const clean = cleanFrontmatter(raw);
    const id = indexId ?? identity.frontmatterId ?? null;
    const failures = [];

    if (clean.changed && !id) {
      failures.push("missing identity in workspace index/frontmatter");
    }
    if (clean.changed && !indexId && !options.cloud) {
      failures.push("missing workspace index id; run harvest first or verify with --cloud");
    }
    if (clean.metadata.version !== undefined && !Number.isFinite(clean.metadata.version)) {
      failures.push("frontmatter version is not numeric");
    }

    docs.push({
      path: file.relativePath,
      absolutePath: file.absolutePath,
      id,
      indexId,
      frontmatterId: identity.frontmatterId,
      changed: clean.changed,
      removedKeys: clean.removedKeys,
      preservedKeys: clean.preservedKeys,
      removedWholeBlock: clean.removedWholeBlock,
      cloudMetadata: clean.metadata,
      beforeBytes: raw.length,
      afterBytes: clean.nextRaw.length,
      nextRaw: clean.nextRaw,
      status: failures.length > 0 ? "failed" : clean.changed ? "would-clean" : "unchanged",
      failureReason: failures.length > 0 ? failures.join("; ") : null,
    });
  }

  let cloud = { enabled: false, checked: 0, missing: [], updated: [], skipped: [] };
  if (options.cloud) {
    const ids = [...new Set(docs.filter((doc) => doc.changed && doc.id).map((doc) => doc.id))];
    const cloudRows = await fetchCloudRows(supabase, ids);
    const missing = ids.filter((id) => !cloudRows.has(id));
    for (const doc of docs) {
      if (doc.changed && doc.id && !cloudRows.has(doc.id)) {
        doc.status = "failed";
        doc.failureReason = [doc.failureReason, "missing cloud writing row"].filter(Boolean).join("; ");
      }
    }
    cloud = { enabled: true, checked: ids.length, missing, updated: [], skipped: [] };
    if (options.apply && missing.length === 0) {
      const applied = await applyCloudMetadata(
        supabase,
        docs.filter((doc) => doc.status !== "failed"),
      );
      cloud = { ...cloud, ...applied };
    }
  }

  const failed = docs.filter((doc) => doc.status === "failed");
  if (options.apply && failed.length === 0) {
    for (const doc of docs) {
      if (doc.changed) {
        await fs.writeFile(doc.absolutePath, doc.nextRaw, "utf8");
        doc.status = "cleaned";
      }
    }
  }

  const publicDocs = docs.map(({ absolutePath, nextRaw, ...doc }) => doc);
  const counts = {
    total: publicDocs.length,
    changed: publicDocs.filter((doc) => doc.changed).length,
    cleaned: publicDocs.filter((doc) => doc.status === "cleaned").length,
    unchanged: publicDocs.filter((doc) => doc.status === "unchanged").length,
    failed: publicDocs.filter((doc) => doc.status === "failed").length,
  };

  return {
    root: workspaceRoot,
    apply: options.apply,
    backup,
    indexPath: index.sourcePath,
    counts,
    cloud,
    docs: publicDocs,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const supabase = options.cloud ? await createSupabaseAdmin(options.envPath) : null;
  const workspaces = [];

  for (const root of options.roots) {
    workspaces.push(await cleanWorkspace(root, options, supabase));
  }

  const summary = workspaces.reduce(
    (acc, workspace) => {
      acc.total += workspace.counts.total;
      acc.changed += workspace.counts.changed;
      acc.cleaned += workspace.counts.cleaned;
      acc.unchanged += workspace.counts.unchanged;
      acc.failed += workspace.counts.failed;
      return acc;
    },
    { total: 0, changed: 0, cleaned: 0, unchanged: 0, failed: 0 },
  );

  const result = {
    generatedAt: new Date().toISOString(),
    dryRun: !options.apply,
    cloud: options.cloud,
    summary,
    workspaces,
  };

  if (options.json) {
    printJson(result);
  } else {
    console.log(`clean-frontmatter: ${summary.failed === 0 ? "OK" : "FAIL"}`);
    printJson(result);
  }

  if (summary.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
