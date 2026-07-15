#!/usr/bin/env node

/**
 * ODE-374 — Harvest legacy identities into an auditable report.
 *
 * This script is TOOLING-ONLY. It may inspect historical frontmatter and legacy
 * `.odyssey/index.json` files, but it never writes markdown or frontmatter. The
 * report it produces is the preservation/evidence gate required before the final
 * M6 cleanup can retire runtime compatibility paths.
 *
 * Output fields per the issue brief:
 *   - source: where the identity came from (frontmatter, odyssey-index, odessay-index, ...)
 *   - proposed UUID/binding
 *   - evidence: content hash, inode, size, mtime, manifest entry
 *   - conflict reason
 *   - decision: preserve-v2-index | adopt-legacy-index | harvest-frontmatter |
 *               conflict-unresolved | mint-required
 *   - outcome: proposed | pending-human
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  buildIdentitySourceMap,
  buildProposedBinding,
  decideIdentity,
  readWorkspaceManifests,
  serializeReport,
} from "./lib.mjs";
import { mintWritingId, printJson } from "../identity/lib.mjs";

function parseArgs(argv) {
  const options = {
    roots: [],
    outFile: null,
    json: false,
    allowMint: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace-root") {
      options.roots.push(argv[++index]);
    } else if (arg === "--out") {
      options.outFile = argv[++index];
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--allow-mint") {
      options.allowMint = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (!arg.startsWith("-")) {
      options.roots.push(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.roots.length === 0) {
    options.roots.push(process.cwd());
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/identity-harvest/harvest-legacy-identities.mjs \
    --workspace-root <dir> [--workspace-root <dir>] [--out <report.json>] [--json] [--allow-mint]

Produces an auditable harvest report without modifying any source file.
--allow-mint includes proposed minted ids for files with no identity signal;
without it they remain pending-human.`);
}

function buildManifestSummary(manifests) {
  return {
    odyssey: {
      path: manifests.odyssey.path,
      exists: manifests.odyssey.exists,
      version: manifests.odyssey.document?.version ?? null,
      bindingRootId: manifests.odyssey.document?.bindingRootId ?? null,
      selectedPaths: manifests.odyssey.document?.selectedPaths ?? [],
      fileCount: manifests.odyssey.exists
        ? Object.keys(manifests.odyssey.document.files).length
        : 0,
    },
    odessay: {
      path: manifests.odessay.path,
      exists: manifests.odessay.exists,
      version: manifests.odessay.document?.version ?? null,
      bindingRootId: manifests.odessay.document?.bindingRootId ?? null,
      selectedPaths: manifests.odessay.document?.selectedPaths ?? [],
      fileCount: manifests.odessay.exists
        ? Object.keys(manifests.odessay.document.files).length
        : 0,
    },
  };
}

async function harvestRoot(rootInput, options) {
  const workspaceRoot = path.resolve(rootInput);
  const manifests = await readWorkspaceManifests(workspaceRoot);
  const sourceMap = await buildIdentitySourceMap(workspaceRoot);
  const bindingRootId = manifests.odessay.document?.bindingRootId ?? null;

  const files = [];
  const conflicts = [];
  const pendingHuman = [];

  for (const entry of sourceMap.entries) {
    const decision = decideIdentity(entry);

    if (decision.decision === "mint-required" && options.allowMint) {
      decision.proposedId = mintWritingId();
      decision.source = "minted";
      decision.decision = "mint-for-tooling";
      decision.outcome = "proposed";
    }

    const proposedBinding = buildProposedBinding(entry, decision, workspaceRoot, bindingRootId);

    const reportRow = {
      relativePath: entry.relativePath,
      source: decision.source,
      proposedId: decision.proposedId,
      proposedBinding,
      evidence: {
        frontmatterId: entry.evidence.frontmatterId,
        odysseyId: entry.odyssey?.id ?? null,
        odysseyBinding: entry.odyssey
          ? {
              inode: entry.odyssey.inode,
              contentHash: entry.odyssey.contentHash,
              size: entry.odyssey.size,
              lastSeen: entry.odyssey.lastSeen,
            }
          : null,
        odessayId: entry.odessay?.id ?? null,
        odessayBinding: entry.odessay
          ? {
              inode: entry.odessay.inode,
              contentHash: entry.odessay.contentHash,
              size: entry.odessay.size,
              lastSeen: entry.odessay.lastSeen,
            }
          : null,
        currentContentHash: entry.evidence.contentHash,
        currentInode: entry.evidence.inode,
        currentSize: entry.evidence.size,
        currentMtimeMs: entry.evidence.mtimeMs,
      },
      conflictReason: decision.conflictReason,
      decision: decision.decision,
      outcome: decision.outcome,
    };

    files.push(reportRow);

    if (decision.conflictReason) {
      conflicts.push({
        relativePath: entry.relativePath,
        conflictReason: decision.conflictReason,
        proposedId: decision.proposedId,
      });
    }

    if (decision.outcome === "pending-human") {
      pendingHuman.push({
        relativePath: entry.relativePath,
        reason: decision.conflictReason ?? "missing identity signal",
      });
    }
  }

  const counts = {
    total: files.length,
    preserveV2Index: files.filter((f) => f.decision === "preserve-v2-index").length,
    adoptLegacyIndex: files.filter((f) => f.decision === "adopt-legacy-index").length,
    harvestFrontmatter: files.filter((f) => f.decision === "harvest-frontmatter").length,
    mintForTooling: files.filter((f) => f.decision === "mint-for-tooling").length,
    conflictUnresolved: files.filter((f) => f.decision === "conflict-unresolved").length,
    mintRequired: files.filter((f) => f.decision === "mint-required").length,
    conflicts: conflicts.length,
    pendingHuman: pendingHuman.length,
    danglingIndexEntries: sourceMap.dangling.length,
  };

  return {
    root: workspaceRoot,
    manifests: buildManifestSummary(manifests),
    counts,
    files,
    conflicts,
    pendingHuman,
    dangling: sourceMap.dangling,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspaces = [];

  for (const root of options.roots) {
    workspaces.push(await harvestRoot(root, options));
  }

  const summary = workspaces.reduce(
    (acc, workspace) => {
      acc.total += workspace.counts.total;
      acc.preserveV2Index += workspace.counts.preserveV2Index;
      acc.adoptLegacyIndex += workspace.counts.adoptLegacyIndex;
      acc.harvestFrontmatter += workspace.counts.harvestFrontmatter;
      acc.mintForTooling += workspace.counts.mintForTooling;
      acc.conflictUnresolved += workspace.counts.conflictUnresolved;
      acc.mintRequired += workspace.counts.mintRequired;
      acc.conflicts += workspace.counts.conflicts;
      acc.pendingHuman += workspace.counts.pendingHuman;
      acc.danglingIndexEntries += workspace.counts.danglingIndexEntries;
      return acc;
    },
    {
      total: 0,
      preserveV2Index: 0,
      adoptLegacyIndex: 0,
      harvestFrontmatter: 0,
      mintForTooling: 0,
      conflictUnresolved: 0,
      mintRequired: 0,
      conflicts: 0,
      pendingHuman: 0,
      danglingIndexEntries: 0,
    },
  );

  const report = {
    generatedAt: new Date().toISOString(),
    allowMint: options.allowMint,
    summary,
    workspaces,
  };

  const serialized = serializeReport(report);

  if (options.outFile) {
    await fs.mkdir(path.dirname(path.resolve(options.outFile)), { recursive: true });
    await fs.writeFile(path.resolve(options.outFile), serialized, "utf8");
  }

  if (options.json) {
    printJson(report);
  } else {
    console.log(`harvest-legacy-identities: ${summary.conflicts === 0 ? "OK" : "CONFLICTS"}`);
    printJson(report);
  }

  if (summary.conflicts > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
