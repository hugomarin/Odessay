import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function mintUnique(used, mintId) {
  let id;
  do id = mintId(); while (!isUuid(id) || used.has(id));
  used.add(id);
  return id;
}

function bindingPath(row) {
  return row.proposedBinding?.canonicalPath ?? null;
}

/**
 * Resolve the historical report against the operational catalog. Exact valid
 * catalog bindings win. Historical ids are admitted only when they are unique
 * and do not steal a live binding; rejected/invalid evidence gets a fresh UUID.
 */
export async function buildWritePlan({ workspace, catalog, mintId = () => crypto.randomUUID() }) {
  const rows = workspace.files ?? [];
  const bindings = catalog.bindings ?? [];
  const documents = catalog.documents ?? [];
  const byPath = new Map(bindings.map((entry) => [entry.canonical_path, entry]));
  const bindingById = new Map(bindings.map((entry) => [entry.document_id, entry]));
  const documentById = new Map(documents.map((entry) => [entry.id, entry]));
  const candidateGroups = new Map();

  for (const row of rows) {
    if (!isUuid(row.proposedId)) continue;
    const bucket = candidateGroups.get(row.proposedId) ?? [];
    bucket.push(row);
    candidateGroups.set(row.proposedId, bucket);
  }

  const duplicateOwner = new Map();
  for (const [candidate, bucket] of candidateGroups) {
    if (bucket.length === 1) continue;
    const exactOwners = bucket.filter((row) => byPath.get(bindingPath(row))?.document_id === candidate);
    if (exactOwners.length === 1) {
      duplicateOwner.set(candidate, exactOwners[0]);
      continue;
    }
    const cloudHash = documentById.get(candidate)?.cloud_content_hash;
    const hashOwners = cloudHash
      ? bucket.filter((row) => row.evidence?.currentContentHash === cloudHash)
      : [];
    if (hashOwners.length === 1) duplicateOwner.set(candidate, hashOwners[0]);
  }

  const used = new Set();
  const planned = [];
  for (const row of rows) {
    const canonicalPath = bindingPath(row);
    if (!canonicalPath) throw new Error(`Missing proposed binding for ${row.relativePath}`);
    const exact = byPath.get(canonicalPath);
    let id = null;
    let resolution = null;
    let rejectedEvidence = null;

    if (exact && isUuid(exact.document_id) && !used.has(exact.document_id)) {
      id = exact.document_id;
      resolution = "catalog-path";
    } else if (isUuid(row.proposedId)) {
      const group = candidateGroups.get(row.proposedId) ?? [];
      const owner = duplicateOwner.get(row.proposedId);
      const boundElsewhere = bindingById.get(row.proposedId);
      const boundElsewhereExists = boundElsewhere
        ? await fs.access(boundElsewhere.canonical_path).then(() => true, () => false)
        : false;
      const canAdoptDuplicate = group.length === 1 || owner === row;
      const canAdoptBinding =
        !boundElsewhere ||
        boundElsewhere.canonical_path === canonicalPath ||
        (!boundElsewhereExists && boundElsewhere.content_hash === row.evidence?.currentContentHash);

      if (canAdoptDuplicate && canAdoptBinding && !used.has(row.proposedId)) {
        id = row.proposedId;
        resolution = row.source === "minted" ? "tooling-mint" : "historical-evidence";
      } else {
        rejectedEvidence = group.length > 1 ? "duplicate-historical-id" : "id-bound-elsewhere";
      }
    } else if (row.proposedId) {
      rejectedEvidence = "non-uuid-historical-id";
    }

    if (!id) {
      id = mintUnique(used, mintId);
      resolution = rejectedEvidence ? "mint-after-reject" : "mint";
    } else {
      used.add(id);
    }

    planned.push({
      relativePath: row.relativePath,
      canonicalPath,
      id,
      resolution,
      rejectedEvidence,
      previousCatalogId: exact?.document_id ?? null,
      binding: {
        inode: row.evidence?.currentInode ?? null,
        contentHash: row.evidence?.currentContentHash ?? null,
        size: row.evidence?.currentSize ?? null,
        lastSeen: row.evidence?.currentMtimeMs ?? null,
      },
    });
  }

  const ids = planned.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !isUuid(id))) {
    throw new Error("Write plan did not converge to unique UUID identities");
  }

  return planned;
}

export function buildManifest({ bindingRootId, selectedPaths = [], planned }) {
  const files = {};
  for (const entry of planned) {
    files[entry.relativePath] = {
      id: entry.id,
      inode: entry.binding.inode,
      content_hash: entry.binding.contentHash,
      lastSeen: entry.binding.lastSeen,
      size: entry.binding.size,
    };
  }
  return { version: 2, bindingRootId, selectedPaths, files };
}

export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.trunc(value)) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildCatalogSql({ rootPath, previousRootId, bindingRootId, planned, now }) {
  const q = sqlLiteral;
  const lines = ["PRAGMA foreign_keys=ON;", "BEGIN IMMEDIATE;", "PRAGMA defer_foreign_keys=ON;"];
  if (previousRootId && previousRootId !== bindingRootId) {
    lines.push(`UPDATE binding_roots SET id=${q(bindingRootId)},manifest_version=2,last_scanned_at=${q(now)} WHERE id=${q(previousRootId)};`);
    lines.push(`UPDATE document_bindings SET binding_root_id=${q(bindingRootId)} WHERE binding_root_id=${q(previousRootId)};`);
  } else {
    lines.push(
      `INSERT INTO binding_roots(id,root_path,manifest_version,visible_as_workspace,last_scanned_at) VALUES(${q(bindingRootId)},${q(rootPath)},2,0,${q(now)}) ON CONFLICT(root_path) DO UPDATE SET manifest_version=2,last_scanned_at=excluded.last_scanned_at;`,
    );
  }

  for (const entry of planned) {
    const oldId = entry.previousCatalogId;
    if (oldId && oldId !== entry.id) {
      lines.push(`DELETE FROM document_bindings WHERE canonical_path=${q(entry.canonicalPath)} AND document_id=${q(oldId)};`);
      lines.push(
        `UPDATE documents SET local_present=0,sync_status=CASE WHEN cloud_present=1 THEN 'synced' ELSE 'deleted' END WHERE id=${q(oldId)} AND NOT EXISTS(SELECT 1 FROM document_bindings WHERE document_id=${q(oldId)});`,
      );
    }
    const title = path.basename(entry.relativePath).replace(/\.(md|mdx)$/i, "");
    lines.push(
      `INSERT INTO documents(id,local_present,cloud_present,sync_status,title_cache,modified_at) VALUES(${q(entry.id)},1,0,'local-only',${q(title)},${q(entry.binding.lastSeen ?? now)}) ON CONFLICT(id) DO UPDATE SET local_present=1,title_cache=COALESCE(documents.title_cache,excluded.title_cache),modified_at=MAX(COALESCE(documents.modified_at,0),COALESCE(excluded.modified_at,0)),sync_status=CASE WHEN documents.cloud_present=1 AND documents.sync_status='deleted' THEN 'synced' WHEN documents.sync_status='deleted' THEN 'local-only' ELSE documents.sync_status END;`,
    );
    lines.push(
      `INSERT INTO document_bindings(document_id,binding_root_id,relative_path,canonical_path,inode,content_hash,size,last_seen_at) VALUES(${q(entry.id)},${q(bindingRootId)},${q(entry.relativePath)},${q(entry.canonicalPath)},${q(entry.binding.inode)},${q(entry.binding.contentHash)},${q(entry.binding.size)},${q(entry.binding.lastSeen)}) ON CONFLICT(document_id) DO UPDATE SET binding_root_id=excluded.binding_root_id,relative_path=excluded.relative_path,canonical_path=excluded.canonical_path,inode=excluded.inode,content_hash=excluded.content_hash,size=excluded.size,last_seen_at=excluded.last_seen_at;`,
    );
  }
  lines.push("DROP TABLE IF EXISTS writings_index;");
  lines.push("COMMIT;", "PRAGMA integrity_check;");
  return `${lines.join("\n")}\n`;
}
