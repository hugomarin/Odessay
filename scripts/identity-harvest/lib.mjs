import path from "node:path";
import {
  collectMarkdownFiles,
  LEGACY_WORKSPACE_DIR_NAME,
  normalizeRelative,
  pathExists,
  readJson,
  readMarkdownIdentity,
  WORKSPACE_DIR_NAME,
  WORKSPACE_INDEX_FILE_NAME,
} from "../identity/lib.mjs";

/**
 * Read a manifest file at an exact path, returning its raw document and whether it
 * exists. Does not fall back to the legacy directory — callers must ask for each
 * source explicitly.
 */
export async function readManifestAt(manifestPath) {
  if (!(await pathExists(manifestPath))) {
    return { manifestPath, exists: false, document: null };
  }
  const raw = await readJson(manifestPath);
  return { manifestPath, exists: true, document: normalizeManifest(raw) };
}

/**
 * Normalize the shape of v1 and v2 manifests into a common structure.
 * v2 adds bindingRootId, selectedPaths and keeps files keyed by relative path.
 */
export function normalizeManifest(raw) {
  if (!raw || typeof raw !== "object") {
    return { version: 1, bindingRootId: null, selectedPaths: [], files: {} };
  }

  const files = {};
  if (raw.files && typeof raw.files === "object" && !Array.isArray(raw.files)) {
    for (const [relativePath, entry] of Object.entries(raw.files)) {
      if (!entry || typeof entry !== "object") continue;
      files[normalizeRelative(path.normalize(relativePath))] = {
        id: entry.id ?? entry.uuid ?? entry.document_id ?? null,
        inode: typeof entry.inode === "number" ? entry.inode : null,
        contentHash: entry.content_hash ?? entry.contentHash ?? null,
        lastSeen: entry.lastSeen ?? entry.last_seen ?? null,
        size: typeof entry.size === "number" ? entry.size : null,
      };
    }
  }

  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    bindingRootId: raw.bindingRootId ?? raw.binding_root_id ?? null,
    selectedPaths: Array.isArray(raw.selectedPaths) ? raw.selectedPaths : [],
    files,
  };
}

/**
 * Read both legacy `.odyssey/index.json` and current `.odessay/index.json` for a
 * workspace root, preserving provenance.
 */
export async function readWorkspaceManifests(workspaceRoot) {
  const odysseyPath = path.join(workspaceRoot, LEGACY_WORKSPACE_DIR_NAME, WORKSPACE_INDEX_FILE_NAME);
  const odessayPath = path.join(workspaceRoot, WORKSPACE_DIR_NAME, WORKSPACE_INDEX_FILE_NAME);

  const odyssey = await readManifestAt(odysseyPath);
  const odessay = await readManifestAt(odessayPath);

  return {
    workspaceRoot,
    odyssey: { path: odysseyPath, exists: odyssey.exists, document: odyssey.document },
    odessay: { path: odessayPath, exists: odessay.exists, document: odessay.document },
  };
}

/**
 * Evidence bag for a single file. Gathers every identity signal we can observe
 * without mutating anything.
 */
export async function gatherFileEvidence(workspaceRoot, relativePath, absolutePath) {
  const identity = await readMarkdownIdentity(absolutePath);
  return {
    relativePath,
    absolutePath,
    frontmatterId: identity.frontmatterId,
    contentHash: identity.contentHash,
    inode: typeof identity.inode === "number" ? identity.inode : null,
    size: identity.size,
    mtimeMs: identity.mtimeMs,
  };
}

/**
 * Build an identity source map for every markdown file under the workspace root.
 */
export async function buildIdentitySourceMap(workspaceRoot) {
  const manifests = await readWorkspaceManifests(workspaceRoot);
  const markdownFiles = await collectMarkdownFiles(workspaceRoot);

  const odysseyFiles = manifests.odyssey.document?.files ?? {};
  const odessayFiles = manifests.odessay.document?.files ?? {};

  const entries = [];
  for (const file of markdownFiles) {
    const evidence = await gatherFileEvidence(workspaceRoot, file.relativePath, file.absolutePath);
    const odysseyEntry = odysseyFiles[file.relativePath] ?? null;
    const odessayEntry = odessayFiles[file.relativePath] ?? null;

    entries.push({
      relativePath: file.relativePath,
      evidence,
      odyssey: odysseyEntry,
      odessay: odessayEntry,
    });
  }

  // Surface index entries that no longer have a corresponding markdown file.
  const knownPaths = new Set(markdownFiles.map((f) => f.relativePath));
  const dangling = [];
  for (const source of ["odyssey", "odessay"]) {
    const files = source === "odyssey" ? odysseyFiles : odessayFiles;
    for (const relativePath of Object.keys(files)) {
      if (!knownPaths.has(relativePath)) {
        dangling.push({
          relativePath,
          source,
          entry: files[relativePath],
        });
      }
    }
  }

  return { manifests, entries, dangling };
}

/**
 * Decide which identity a file should keep, given the available evidence.
 *
 * Decision rules (non-destructive, auditable):
 * 1. If v2 index has an id, preserve it (manifest is durable binding ledger).
 * 2. Else if v1/legacy index has an id, propose adopting it.
 * 3. Else if frontmatter has an id, propose harvesting it.
 * 4. Else propose minting a new id.
 *
 * Conflicts are never silently resolved. A conflict is reported when two
 * non-null sources disagree and neither is already authoritative in v2.
 */
export function decideIdentity(entry) {
  const { evidence, odyssey, odessay } = entry;
  const frontmatterId = evidence.frontmatterId;
  const odysseyId = odyssey?.id ?? null;
  const odessayId = odessay?.id ?? null;

  const sources = [];
  if (odessayId) sources.push({ name: "odessay-index", id: odessayId });
  if (odysseyId) sources.push({ name: "odyssey-index", id: odysseyId });
  if (frontmatterId) sources.push({ name: "frontmatter", id: frontmatterId });

  // V2 manifest is authoritative when it exists.
  if (odessayId) {
    const conflicting = sources.filter((s) => s.id !== odessayId);
    if (conflicting.length > 0) {
      return {
        proposedId: odessayId,
        source: "odessay-index",
        decision: "preserve-v2-index",
        outcome: "proposed",
        conflictReason: `v2 index id ${odessayId} differs from: ${conflicting
          .map((s) => `${s.name}=${s.id}`)
          .join(", ")}`,
      };
    }
    return {
      proposedId: odessayId,
      source: "odessay-index",
      decision: "preserve-v2-index",
      outcome: "proposed",
      conflictReason: null,
    };
  }

  // No v2 index. Look for agreement among v1/legacy index and frontmatter.
  const nonNullSources = sources.filter((s) => s.id !== null);
  const uniqueIds = [...new Set(nonNullSources.map((s) => s.id))];

  if (uniqueIds.length === 1) {
    const winningSource = nonNullSources[0];
    return {
      proposedId: winningSource.id,
      source: winningSource.name,
      decision: winningSource.name === "frontmatter" ? "harvest-frontmatter" : "adopt-legacy-index",
      outcome: "proposed",
      conflictReason: null,
    };
  }

  if (uniqueIds.length > 1) {
    return {
      proposedId: null,
      source: "ambiguous",
      decision: "conflict-unresolved",
      outcome: "pending-human",
      conflictReason: `multiple identity sources disagree: ${nonNullSources
        .map((s) => `${s.name}=${s.id}`)
        .join(", ")}`,
    };
  }

  // No identity anywhere — mint only when explicitly requested by the caller.
  return {
    proposedId: null,
    source: "none",
    decision: "mint-required",
    outcome: "pending-human",
    conflictReason: null,
  };
}

/**
 * Build a proposed binding for a file entry, deriving the binding root id from the
 * manifest v2 when available. This is a proposal only — it does not write anything.
 */
export function buildProposedBinding(entry, decisionResult, workspaceRoot, bindingRootId) {
  const { evidence, odyssey, odessay } = entry;
  const manifestEntry = odessay ?? odyssey;

  if (!decisionResult.proposedId) {
    return null;
  }

  return {
    bindingRootId: bindingRootId ?? null,
    relativePath: evidence.relativePath,
    canonicalPath: evidence.absolutePath,
    inode: evidence.inode ?? manifestEntry?.inode ?? null,
    contentHash: evidence.contentHash ?? manifestEntry?.contentHash ?? null,
    size: evidence.size ?? manifestEntry?.size ?? null,
    lastSeenAt: evidence.mtimeMs ?? manifestEntry?.lastSeen ?? null,
  };
}

/**
 * Serialize a harvest report to JSON, stable and diff-friendly.
 */
export function serializeReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
