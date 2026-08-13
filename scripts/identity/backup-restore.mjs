#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  collectMarkdownFiles,
  loadEnvFile,
  parseCliArgs,
  pathExists,
  printJson,
  readJson,
  readMarkdownIdentity,
  readWorkspaceIndex,
  writeJson,
} from "./lib.mjs";

const WRITINGS_COLUMNS = [
  "id",
  "author_id",
  "title",
  "body_json",
  "body_text",
  "slug",
  "status",
  "visibility",
  "parent_id",
  "correspondence_id",
  "version",
  "sync_status",
  "deleted_at",
  "created_at",
  "updated_at",
  "content_updated_at",
  "metadata_updated_at",
  "content_hash",
  "artifact_type",
].join(",");

const MARGINS_COLUMNS = [
  "id",
  "reader_id",
  "writing_id",
  "anchor_start",
  "anchor_end",
  "anchor_text",
  "note",
  "shared",
  "shared_at",
  "created_at",
  "updated_at",
  "type",
  "text",
  "resolved",
  "archived",
].join(",");

function parseArgs(argv) {
  const { help, options, positionals } = parseCliArgs(argv, {
    defaults: {
      workspaceRoot: null,
      backupDir: null,
      envPath: ".env.local",
      cloud: false,
      apply: false,
      json: false,
    },
    flags: {
      "--workspace-root": { type: "value", key: "workspaceRoot" },
      "--backup-dir": { type: "value", key: "backupDir" },
      "--env": { type: "value", key: "envPath" },
      "--cloud": { type: "boolean", key: "cloud" },
      "--apply": { type: "boolean", key: "apply" },
      "--json": { type: "boolean", key: "json" },
    },
    allowPositionals: true,
  });

  if (help) {
    printHelp();
    process.exit(0);
  }

  const command = positionals[0] ?? null;
  if (!["backup", "verify", "restore"].includes(command)) {
    throw new Error("Missing command: backup, verify, or restore.");
  }
  if (!options.workspaceRoot) {
    throw new Error("Missing --workspace-root.");
  }
  if (!options.backupDir) {
    throw new Error("Missing --backup-dir.");
  }
  if (command === "restore" && !options.apply) {
    throw new Error("restore requires --apply.");
  }

  return { ...options, command };
}

function printHelp() {
  console.log(`Usage:
  node scripts/identity/backup-restore.mjs backup --workspace-root <dir> --backup-dir <dir> [--cloud] [--env .env.local] [--json]
  node scripts/identity/backup-restore.mjs verify --workspace-root <dir> --backup-dir <dir> [--json]
  node scripts/identity/backup-restore.mjs restore --workspace-root <dir> --backup-dir <dir> --apply [--cloud] [--env .env.local] [--json]

Backs up markdown files and, with --cloud, matching writings/margins rows.
Restore is intentionally gated behind --apply.`);
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

async function copyFilePreservingPath(sourceRoot, sourcePath, targetRoot) {
  const relativePath = path.relative(sourceRoot, sourcePath);
  const targetPath = path.join(targetRoot, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  return relativePath.split(path.sep).join("/");
}

async function backup(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const backupDir = path.resolve(options.backupDir);
  const filesDir = path.join(backupDir, "files");
  const indexDir = path.join(backupDir, "index");
  const cloudDir = path.join(backupDir, "cloud");
  const markdownFiles = await collectMarkdownFiles(workspaceRoot);
  const manifestFiles = [];
  const ids = new Set();

  await fs.mkdir(filesDir, { recursive: true });

  for (const file of markdownFiles) {
    const identity = await readMarkdownIdentity(file.absolutePath);
    const backupRelativePath = await copyFilePreservingPath(
      workspaceRoot,
      file.absolutePath,
      filesDir,
    );
    if (identity.frontmatterId) {
      ids.add(identity.frontmatterId);
    }
    manifestFiles.push({
      path: file.relativePath,
      backupPath: backupRelativePath,
      frontmatterId: identity.frontmatterId,
      contentHash: identity.contentHash,
      size: identity.size,
      mtimeMs: identity.mtimeMs,
    });
  }

  const workspaceIndex = await readWorkspaceIndex(workspaceRoot);
  let index = { existed: workspaceIndex.exists, sourcePath: workspaceIndex.sourcePath, backupPath: null };
  if (workspaceIndex.exists) {
    await fs.mkdir(indexDir, { recursive: true });
    const indexBackupPath = path.join(indexDir, "index.json");
    await fs.copyFile(workspaceIndex.sourcePath, indexBackupPath);
    index = { ...index, backupPath: "index/index.json" };
  }

  let cloud = { enabled: false, writings: [], margins: [] };
  if (options.cloud && ids.size > 0) {
    const supabase = await createSupabaseAdmin(options.envPath);
    await fs.mkdir(cloudDir, { recursive: true });
    const idList = Array.from(ids);
    const { data: writings, error: writingsError } = await supabase
      .from("writings")
      .select(WRITINGS_COLUMNS)
      .in("id", idList);
    if (writingsError) throw new Error(writingsError.message);

    const { data: margins, error: marginsError } = await supabase
      .from("margins")
      .select(MARGINS_COLUMNS)
      .in("writing_id", idList);
    if (marginsError) throw new Error(marginsError.message);

    cloud = {
      enabled: true,
      writings: writings ?? [],
      margins: margins ?? [],
    };
    await writeJson(path.join(cloudDir, "writings.json"), cloud.writings);
    await writeJson(path.join(cloudDir, "margins.json"), cloud.margins);
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    files: manifestFiles,
    index,
    cloud: {
      enabled: cloud.enabled,
      writingsCount: cloud.writings.length,
      marginsCount: cloud.margins.length,
    },
  };

  await writeJson(path.join(backupDir, "manifest.json"), manifest);
  return {
    ok: true,
    command: "backup",
    backupDir,
    files: manifestFiles.length,
    index: manifest.index,
    cloud: manifest.cloud,
  };
}

async function verify(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const backupDir = path.resolve(options.backupDir);
  const manifest = await readJson(path.join(backupDir, "manifest.json"));
  const failures = [];

  for (const file of manifest.files ?? []) {
    const backupPath = path.join(backupDir, "files", file.backupPath);
    if (!(await pathExists(backupPath))) {
      failures.push({ path: file.path, reason: "missing backup file" });
      continue;
    }

    const backupIdentity = await readMarkdownIdentity(backupPath);
    if (backupIdentity.contentHash !== file.contentHash) {
      failures.push({ path: file.path, reason: "backup hash mismatch" });
    }

    const livePath = path.join(workspaceRoot, file.path);
    if (await pathExists(livePath)) {
      const liveIdentity = await readMarkdownIdentity(livePath);
      if (liveIdentity.contentHash !== file.contentHash) {
        failures.push({ path: file.path, reason: "live file differs from backup" });
      }
    }
  }

  if (manifest.index?.existed) {
    const backupPath = path.join(backupDir, manifest.index.backupPath);
    if (!(await pathExists(backupPath))) {
      failures.push({ path: manifest.index.sourcePath, reason: "missing index backup file" });
    } else if (await pathExists(manifest.index.sourcePath)) {
      const backupRaw = await fs.readFile(backupPath, "utf8");
      const liveRaw = await fs.readFile(manifest.index.sourcePath, "utf8");
      if (backupRaw !== liveRaw) {
        failures.push({ path: manifest.index.sourcePath, reason: "live index differs from backup" });
      }
    }
  } else if (manifest.index?.sourcePath && (await pathExists(manifest.index.sourcePath))) {
    failures.push({ path: manifest.index.sourcePath, reason: "live index was created after backup" });
  }

  return {
    ok: failures.length === 0,
    command: "verify",
    backupDir,
    checkedFiles: manifest.files?.length ?? 0,
    checkedIndex: Boolean(manifest.index?.existed),
    failures,
  };
}

async function restore(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const backupDir = path.resolve(options.backupDir);
  const manifest = await readJson(path.join(backupDir, "manifest.json"));
  const restoredFiles = [];

  for (const file of manifest.files ?? []) {
    const sourcePath = path.join(backupDir, "files", file.backupPath);
    const targetPath = path.join(workspaceRoot, file.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    restoredFiles.push(file.path);
  }

  if (manifest.index?.existed) {
    const sourcePath = path.join(backupDir, manifest.index.backupPath);
    const targetPath = manifest.index.sourcePath;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  } else if (manifest.index?.sourcePath) {
    await fs.rm(manifest.index.sourcePath, { force: true });
  }

  let cloud = { enabled: false, writingsCount: 0, marginsCount: 0 };
  if (options.cloud) {
    const supabase = await createSupabaseAdmin(options.envPath);
    const writingsPath = path.join(backupDir, "cloud", "writings.json");
    const marginsPath = path.join(backupDir, "cloud", "margins.json");
    const writings = (await pathExists(writingsPath)) ? await readJson(writingsPath) : [];
    const margins = (await pathExists(marginsPath)) ? await readJson(marginsPath) : [];

    if (writings.length > 0) {
      const { error } = await supabase.from("writings").upsert(writings, { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
    if (margins.length > 0) {
      const { error } = await supabase.from("margins").upsert(margins, { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
    cloud = { enabled: true, writingsCount: writings.length, marginsCount: margins.length };
  }

  return {
    ok: true,
    command: "restore",
    backupDir,
    restoredFiles,
    restoredIndex: manifest.index?.existed ? manifest.index.sourcePath : null,
    cloud,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result =
    options.command === "backup"
      ? await backup(options)
      : options.command === "verify"
        ? await verify(options)
        : await restore(options);

  if (options.json) {
    printJson(result);
  } else {
    console.log(`${result.command}: ${result.ok ? "OK" : "FAIL"}`);
    printJson(result);
  }

  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
