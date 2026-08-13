#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  collectMarkdownFiles,
  loadEnvFile,
  mintWritingId,
  parseCliArgs,
  pathExists,
  printJson,
  readJson,
  readMarkdownIdentity,
  readWorkspaceIndex,
  writeWorkspaceIndex,
} from "./lib.mjs";

function parseArgs(argv) {
  const { help, options } = parseCliArgs(argv, {
    defaults: {
      roots: [],
      envPath: ".env.local",
      apply: false,
      cloud: false,
      authorId: null,
      backupDir: null,
      json: false,
    },
    flags: {
      "--workspace-root": { type: "value", key: "roots", multiple: true },
      "--env": { type: "value", key: "envPath" },
      "--author-id": { type: "value", key: "authorId" },
      "--backup-dir": { type: "value", key: "backupDir" },
      "--apply": { type: "boolean", key: "apply" },
      "--cloud": { type: "boolean", key: "cloud" },
      "--json": { type: "boolean", key: "json" },
    },
    allowPositionals: false,
  });

  if (help) {
    printHelp();
    process.exit(0);
  }

  if (options.roots.length === 0) {
    options.roots.push(process.cwd());
  }
  if (options.cloud && options.apply && !options.authorId) {
    throw new Error("--cloud --apply requires --author-id for newly minted writings.");
  }
  if (options.apply && !options.backupDir) {
    throw new Error("--apply requires --backup-dir created by backup-restore.mjs backup.");
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/identity/harvest-ids.mjs --workspace-root <dir> [--workspace-root <dir>] [--apply --backup-dir <dir>] [--cloud --author-id <uuid>] [--env .env.local] [--json]

Dry-run is the default. The script never writes markdown/frontmatter.
--apply writes .odessay/index.json.
--cloud with --apply inserts/updates matching cloud writings content_hash rows.`);
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
    throw new Error(`Backup verification failed before harvest apply:\n${failures.join("\n")}`);
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

function makeCloudRow({ id, identity, relativePath, authorId }) {
  const now = new Date().toISOString();
  const title = path.basename(relativePath, path.extname(relativePath));
  return {
    id,
    author_id: authorId,
    title,
    body_json: { type: "doc", content: [] },
    body_text: "",
    content_hash: identity.contentHash,
    status: "draft",
    artifact_type: "letter",
    visibility: "private",
    version: 1,
    created_at: now,
    updated_at: now,
    content_updated_at: now,
    metadata_updated_at: now,
  };
}

async function fetchCloudRows(supabase, ids) {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("writings")
    .select("id, content_hash")
    .in("id", ids);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((row) => [row.id, row]));
}

async function applyCloudRows(supabase, rows) {
  const updated = [];
  const inserted = [];

  for (const row of rows) {
    const { error: updateError } = await supabase
      .from("writings")
      .update({ content_hash: row.content_hash, updated_at: row.updated_at })
      .eq("id", row.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    const { data: existing, error: selectError } = await supabase
      .from("writings")
      .select("id")
      .eq("id", row.id)
      .maybeSingle();

    if (selectError) {
      throw new Error(selectError.message);
    }

    if (existing) {
      updated.push(row.id);
      continue;
    }

    const { error: insertError } = await supabase.from("writings").insert(row);
    if (insertError) {
      throw new Error(insertError.message);
    }
    inserted.push(row.id);
  }

  return { updated, inserted };
}

async function harvestWorkspace(rootInput, options, supabase) {
  const workspaceRoot = path.resolve(rootInput);
  const backup = options.apply
    ? await verifyBackupForApply(workspaceRoot, path.resolve(options.backupDir))
    : null;
  const markdownFiles = await collectMarkdownFiles(workspaceRoot);
  const index = await readWorkspaceIndex(workspaceRoot);
  const nextIndex = {
    ...index.document,
    files: { ...(index.document.files ?? {}) },
  };
  const docs = [];
  const cloudCandidateRows = [];

  for (const file of markdownFiles) {
    const identity = await readMarkdownIdentity(file.absolutePath);
    const existingEntry = nextIndex.files[file.relativePath] ?? {};
    const existingIndexId = existingEntry.id ?? null;
    const conflict =
      Boolean(existingIndexId) &&
      Boolean(identity.frontmatterId) &&
      existingIndexId !== identity.frontmatterId;
    const id = existingIndexId || identity.frontmatterId || mintWritingId();
    const status = conflict
      ? "failed-conflicting-id"
      : existingIndexId
        ? "already-registered"
        : identity.frontmatterId
          ? "harvested-frontmatter-id"
          : "minted-missing-id";

    if (!conflict) {
      nextIndex.files[file.relativePath] = {
        ...existingEntry,
        id,
        inode: identity.inode,
        content_hash: identity.contentHash,
        lastSeen: identity.mtimeMs,
        size: identity.size,
      };
    }

    docs.push({
      path: file.relativePath,
      id,
      frontmatterId: identity.frontmatterId,
      previousIndexId: existingIndexId,
      contentHash: identity.contentHash,
      status,
      failureReason: conflict
        ? "frontmatter.id differs from existing workspace index id"
        : null,
    });

    if (!conflict) {
      cloudCandidateRows.push(
        makeCloudRow({
          id,
          identity,
          relativePath: file.relativePath,
          authorId: options.authorId,
        }),
      );
    }
  }

  const counts = {
    total: docs.length,
    harvested: docs.filter((doc) => doc.status === "harvested-frontmatter-id").length,
    minted: docs.filter((doc) => doc.status === "minted-missing-id").length,
    alreadyRegistered: docs.filter((doc) => doc.status === "already-registered").length,
    failed: docs.filter((doc) => doc.status.startsWith("failed-")).length,
  };

  let cloud = { enabled: false, existing: 0, missing: 0, updated: [], inserted: [] };
  if (options.cloud && !(options.apply && counts.failed > 0)) {
    const cloudRows = await fetchCloudRows(
      supabase,
      cloudCandidateRows.map((row) => row.id),
    );
    const rowsToApply = cloudCandidateRows.map((row) => ({
      ...row,
      alreadyExists: cloudRows.has(row.id),
    }));
    cloud = {
      enabled: true,
      existing: rowsToApply.filter((row) => row.alreadyExists).length,
      missing: rowsToApply.filter((row) => !row.alreadyExists).length,
      updated: [],
      inserted: [],
    };
    if (options.apply) {
      const applied = await applyCloudRows(
        supabase,
        rowsToApply.map(({ alreadyExists, ...row }) => row),
      );
      cloud = { ...cloud, ...applied };
    }
  }

  if (options.apply && counts.failed === 0) {
    await writeWorkspaceIndex(workspaceRoot, nextIndex);
  }

  return {
    root: workspaceRoot,
    apply: options.apply,
    backup,
    indexPath: index.indexPath,
    counts,
    cloud,
    docs,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const supabase = options.cloud ? await createSupabaseAdmin(options.envPath) : null;
  const workspaces = [];

  for (const root of options.roots) {
    workspaces.push(await harvestWorkspace(root, options, supabase));
  }

  const summary = workspaces.reduce(
    (acc, workspace) => {
      acc.total += workspace.counts.total;
      acc.harvested += workspace.counts.harvested;
      acc.minted += workspace.counts.minted;
      acc.alreadyRegistered += workspace.counts.alreadyRegistered;
      acc.failed += workspace.counts.failed;
      return acc;
    },
    { total: 0, harvested: 0, minted: 0, alreadyRegistered: 0, failed: 0 },
  );

  const cloudSummary = options.cloud
    ? workspaces.reduce(
        (acc, workspace) => {
          acc.existing += workspace.cloud.existing;
          acc.missing += workspace.cloud.missing;
          acc.updated.push(...workspace.cloud.updated);
          acc.inserted.push(...workspace.cloud.inserted);
          return acc;
        },
        { enabled: true, existing: 0, missing: 0, updated: [], inserted: [] },
      )
    : { enabled: false };

  const result = {
    generatedAt: new Date().toISOString(),
    dryRun: !options.apply,
    cloud: cloudSummary,
    summary,
    workspaces,
  };

  if (options.json) {
    printJson(result);
  } else {
    console.log(`harvest-ids: ${summary.failed === 0 ? "OK" : "FAIL"}`);
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
