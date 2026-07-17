import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error — tooling is intentionally shipped as native ESM JavaScript.
import * as writePhase from "../scripts/identity-harvest/write-phase-lib.mjs";

const { buildCatalogSql, buildManifest, buildWritePlan } = writePhase;

const tempRoots: string[] = [];
const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "odessay-write-phase-"));
  tempRoots.push(root);
  return root;
}

function row(root: string, name: string, id: string, source = "frontmatter") {
  return {
    relativePath: name,
    source,
    proposedId: id,
    proposedBinding: { canonicalPath: path.join(root, name) },
    evidence: {
      currentInode: 10,
      currentContentHash: `blake3:${name}`,
      currentSize: 4,
      currentMtimeMs: 100,
    },
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("identity harvest write phase", () => {
  it("keeps exact catalog UUIDs and refuses duplicate historical ownership", async () => {
    const root = await tempRoot();
    const catalogId = uuid("1");
    const duplicateId = uuid("2");
    const minted = [uuid("3"), uuid("4")];
    for (const name of ["catalog.md", "owner.md", "copy.md"]) {
      await fs.writeFile(path.join(root, name), "body");
    }
    const workspace = {
      files: [
        row(root, "catalog.md", uuid("9"), "minted"),
        row(root, "owner.md", duplicateId),
        row(root, "copy.md", duplicateId),
      ],
    };
    const catalog = {
      documents: [{ id: catalogId }, { id: duplicateId }],
      bindings: [
        { document_id: catalogId, canonical_path: path.join(root, "catalog.md") },
        { document_id: duplicateId, canonical_path: path.join(root, "owner.md") },
      ],
    };
    let index = 0;
    const plan = await buildWritePlan({ workspace, catalog, mintId: () => minted[index++] });

    expect(plan.map((entry: { id: string }) => entry.id)).toEqual([catalogId, duplicateId, minted[0]]);
    expect(plan.map((entry: { resolution: string }) => entry.resolution)).toEqual([
      "catalog-path",
      "catalog-path",
      "mint-after-reject",
    ]);
    expect(plan[2].rejectedEvidence).toBe("duplicate-historical-id");
  });

  it("replaces path-as-id evidence with a UUID and emits a v2 manifest", async () => {
    const root = await tempRoot();
    const freshId = uuid("5");
    await fs.writeFile(path.join(root, "legacy.md"), "body");
    const plan = await buildWritePlan({
      workspace: { files: [row(root, "legacy.md", "/old/path.md")] },
      catalog: {
        documents: [{ id: "/old/path.md", cloud_present: 1 }],
        bindings: [{ document_id: "/old/path.md", canonical_path: path.join(root, "legacy.md") }],
      },
      mintId: () => freshId,
    });
    const manifest = buildManifest({ bindingRootId: uuid("6"), planned: plan });

    expect(plan[0]).toMatchObject({
      id: freshId,
      previousCatalogId: "/old/path.md",
      resolution: "mint-after-reject",
      rejectedEvidence: "non-uuid-historical-id",
    });
    expect(manifest).toMatchObject({
      version: 2,
      bindingRootId: uuid("6"),
      files: { "legacy.md": { id: freshId } },
    });
  });

  it("builds a deferred-FK transaction that preserves cloud rows during rekey", () => {
    const sql = buildCatalogSql({
      rootPath: "/root",
      previousRootId: "legacy-root:/root",
      bindingRootId: uuid("7"),
      now: 100,
      planned: [{
        relativePath: "legacy.md",
        canonicalPath: "/root/legacy.md",
        id: uuid("8"),
        previousCatalogId: "/old/path.md",
        binding: { inode: 1, contentHash: "blake3:x", size: 4, lastSeen: 100 },
      }],
    });

    expect(sql).toContain("PRAGMA defer_foreign_keys=ON")
    expect(sql).toContain(`UPDATE binding_roots SET id='${uuid("7")}'`)
    expect(sql).toContain("UPDATE documents SET local_present=0")
    expect(sql).not.toContain("DELETE FROM documents")
  });
});
