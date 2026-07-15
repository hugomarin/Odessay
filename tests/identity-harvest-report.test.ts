import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..");
const harvestScript = path.join(repoRoot, "scripts/identity-harvest/harvest-legacy-identities.mjs");
const verifyScript = path.join(repoRoot, "scripts/identity-harvest/verify-odyssey-migration.mjs");
const tempRoots: string[] = [];

async function makeTempWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "odessay-harvest-"));
  tempRoots.push(root);
  return root;
}

async function runJson(script: string, args: string[]) {
  let stdout = "";
  try {
    const result = await execFileAsync("node", [script, ...args, "--json"], {
      cwd: repoRoot,
    });
    stdout = result.stdout;
  } catch (error) {
    const execError = error as { stdout?: string };
    stdout = execError.stdout ?? "";
  }
  return JSON.parse(stdout);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("harvest-legacy-identities", () => {
  it("preserves v2 index ids and reports frontmatter as supporting evidence", async () => {
    const root = await makeTempWorkspace();
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({
        version: 2,
        bindingRootId: "root-1",
        selectedPaths: ["."],
        files: {
          "letter.md": { id: "v2-id", inode: 100, content_hash: "blake3:abc", lastSeen: 1000, size: 20 },
        },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(root, "letter.md"), "---\nid: frontmatter-id\n---\nHello", "utf8");

    const result = await runJson(harvestScript, ["--workspace-root", root]);

    expect(result.summary).toMatchObject({
      total: 1,
      preserveV2Index: 1,
      conflicts: 1,
      pendingHuman: 0,
    });
    expect(result.workspaces[0].files[0]).toMatchObject({
      relativePath: "letter.md",
      source: "odessay-index",
      proposedId: "v2-id",
      decision: "preserve-v2-index",
      outcome: "proposed",
      evidence: {
        frontmatterId: "frontmatter-id",
        odessayId: "v2-id",
      },
    });
    expect(result.workspaces[0].files[0].conflictReason).toContain("frontmatter-id");
    expect(result.workspaces[0].files[0].evidence.odessayBinding).toMatchObject({
      inode: 100,
      contentHash: "blake3:abc",
      lastSeen: 1000,
      size: 20,
    });
  });

  it("adopts a legacy .odyssey index id when no v2 index exists", async () => {
    const root = await makeTempWorkspace();
    await fs.mkdir(path.join(root, ".odyssey"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".odyssey/index.json"),
      JSON.stringify({
        version: 1,
        files: {
          "legacy.md": { id: "legacy-id", inode: 200, content_hash: "blake3:def", last_seen: 2000, size: 15 },
        },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(root, "legacy.md"), "No frontmatter", "utf8");

    const result = await runJson(harvestScript, ["--workspace-root", root]);

    expect(result.summary).toMatchObject({
      total: 1,
      adoptLegacyIndex: 1,
      conflicts: 0,
      pendingHuman: 0,
    });
    expect(result.workspaces[0].files[0]).toMatchObject({
      relativePath: "legacy.md",
      source: "odyssey-index",
      proposedId: "legacy-id",
      decision: "adopt-legacy-index",
      outcome: "proposed",
    });
  });

  it("harvests a frontmatter id when no index entry exists", async () => {
    const root = await makeTempWorkspace();
    await fs.writeFile(
      path.join(root, "frontmatter.md"),
      "---\nid: frontmatter-only\n---\nBody",
      "utf8",
    );

    const result = await runJson(harvestScript, ["--workspace-root", root]);

    expect(result.summary).toMatchObject({
      total: 1,
      harvestFrontmatter: 1,
      conflicts: 0,
      pendingHuman: 0,
    });
    expect(result.workspaces[0].files[0]).toMatchObject({
      relativePath: "frontmatter.md",
      source: "frontmatter",
      proposedId: "frontmatter-only",
      decision: "harvest-frontmatter",
      outcome: "proposed",
    });
  });

  it("reports conflicts when v2 index disagrees with legacy/frontmatter sources", async () => {
    const root = await makeTempWorkspace();
    await fs.mkdir(path.join(root, ".odyssey"), { recursive: true });
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".odyssey/index.json"),
      JSON.stringify({
        version: 1,
        files: { "letter.md": { id: "legacy-id" } },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({
        version: 2,
        bindingRootId: "root-1",
        selectedPaths: [],
        files: { "letter.md": { id: "v2-id" } },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(root, "letter.md"), "---\nid: frontmatter-id\n---\nHello", "utf8");

    const result = await runJson(harvestScript, ["--workspace-root", root]);

    expect(result.summary).toMatchObject({
      total: 1,
      preserveV2Index: 1,
      conflicts: 1,
      pendingHuman: 0,
    });
    expect(result.workspaces[0].files[0]).toMatchObject({
      relativePath: "letter.md",
      source: "odessay-index",
      proposedId: "v2-id",
      decision: "preserve-v2-index",
      outcome: "proposed",
    });
    expect(result.workspaces[0].files[0].conflictReason).toContain("legacy-id");
    expect(result.workspaces[0].files[0].conflictReason).toContain("frontmatter-id");
    expect(result.workspaces[0].conflicts[0]).toMatchObject({
      relativePath: "letter.md",
      proposedId: "v2-id",
    });
  });

  it("reports ambiguous identities as pending-human without --allow-mint", async () => {
    const root = await makeTempWorkspace();
    await fs.writeFile(path.join(root, "plain.md"), "No identity signal", "utf8");

    const result = await runJson(harvestScript, ["--workspace-root", root]);

    expect(result.summary).toMatchObject({
      total: 1,
      mintRequired: 1,
      pendingHuman: 1,
    });
    expect(result.workspaces[0].files[0]).toMatchObject({
      relativePath: "plain.md",
      source: "none",
      proposedId: null,
      decision: "mint-required",
      outcome: "pending-human",
    });
  });

  it("mints ids for anonymous files when --allow-mint is passed", async () => {
    const root = await makeTempWorkspace();
    await fs.writeFile(path.join(root, "plain.md"), "No identity signal", "utf8");

    const result = await runJson(harvestScript, ["--workspace-root", root, "--allow-mint"]);

    expect(result.summary).toMatchObject({
      total: 1,
      mintForTooling: 1,
      pendingHuman: 0,
    });
    expect(result.workspaces[0].files[0].proposedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("emits dangling legacy index entries that lack a matching markdown file", async () => {
    const root = await makeTempWorkspace();
    await fs.mkdir(path.join(root, ".odyssey"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".odyssey/index.json"),
      JSON.stringify({
        version: 1,
        files: { "missing.md": { id: "dangling-id" } },
      }),
      "utf8",
    );

    const result = await runJson(harvestScript, ["--workspace-root", root]);

    expect(result.summary.danglingIndexEntries).toBe(1);
    expect(result.workspaces[0].dangling[0]).toMatchObject({
      relativePath: "missing.md",
      source: "odyssey",
      entry: { id: "dangling-id" },
    });
  });

  it("writes the report to disk with --out", async () => {
    const root = await makeTempWorkspace();
    const outDir = path.join(root, "out");
    const outFile = path.join(outDir, "report.json");
    await fs.writeFile(path.join(root, "letter.md"), "---\nid: x\n---\nY", "utf8");

    const result = await runJson(harvestScript, ["--workspace-root", root, "--out", outFile]);
    const written = JSON.parse(await fs.readFile(outFile, "utf8"));

    expect(written.generatedAt).toBe(result.generatedAt);
    expect(written.summary.total).toBe(1);
  });
});

describe("verify-odyssey-migration", () => {
  it("reports id, inode and hash preservation for a clean migration", async () => {
    const root = await makeTempWorkspace();
    await fs.mkdir(path.join(root, ".odyssey"), { recursive: true });
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".odyssey/index.json"),
      JSON.stringify({
        version: 1,
        selectedPaths: ["."],
        files: {
          "letter.md": {
            id: "preserved-id",
            inode: 123,
            content_hash: "blake3:abc",
            last_seen: 1000,
            size: 10,
          },
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({
        version: 2,
        bindingRootId: "root-1",
        selectedPaths: ["."],
        files: {
          "letter.md": {
            id: "preserved-id",
            inode: 123,
            content_hash: "blake3:abc",
            lastSeen: 1000,
            size: 10,
          },
        },
      }),
      "utf8",
    );

    const result = await runJson(verifyScript, ["--workspace-root", root]);

    expect(result.backupAvailable).toBe(true);
    expect(result.selectedPathsMatch).toBe(true);
    expect(result.counts).toMatchObject({
      totalBindings: 1,
      idPreserved: 1,
      idChanged: 0,
      missingInTarget: 0,
      missingInSource: 0,
      discrepancies: 0,
    });
    expect(result.bindings[0]).toMatchObject({
      relativePath: "letter.md",
      present: "both-present",
      idPreserved: true,
      inodeMatch: true,
      contentHashMatch: true,
      sizeMatch: true,
      lastSeenMatch: true,
    });
  });

  it("reports missing target bindings and changed ids", async () => {
    const root = await makeTempWorkspace();
    await fs.mkdir(path.join(root, ".odyssey"), { recursive: true });
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".odyssey/index.json"),
      JSON.stringify({
        version: 1,
        selectedPaths: [],
        files: {
          "gone.md": { id: "gone-id" },
          "changed.md": { id: "old-id" },
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({
        version: 2,
        bindingRootId: "root-1",
        selectedPaths: [],
        files: {
          "changed.md": { id: "new-id" },
          "new.md": { id: "new-file-id" },
        },
      }),
      "utf8",
    );

    const result = await runJson(verifyScript, ["--workspace-root", root]);

    expect(result.counts).toMatchObject({
      totalBindings: 3,
      idPreserved: 0,
      idChanged: 1,
      missingInTarget: 1,
      missingInSource: 1,
      discrepancies: 3,
    });
    expect(result.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: "gone.md", present: "missing-in-target" }),
        expect.objectContaining({ relativePath: "changed.md", present: "both-present", idPreserved: false }),
        expect.objectContaining({ relativePath: "new.md", present: "missing-in-source" }),
      ]),
    );
  });

  it("reports selectedPaths mismatch", async () => {
    const root = await makeTempWorkspace();
    await fs.mkdir(path.join(root, ".odyssey"), { recursive: true });
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".odyssey/index.json"),
      JSON.stringify({ version: 1, selectedPaths: ["letters"], files: {} }),
      "utf8",
    );
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 2, bindingRootId: "root-1", selectedPaths: ["."], files: {} }),
      "utf8",
    );

    const result = await runJson(verifyScript, ["--workspace-root", root]);

    expect(result.selectedPathsMatch).toBe(false);
  });

  it("reads the source index from a backup directory when provided", async () => {
    const root = await makeTempWorkspace();
    const backupDir = path.join(root, "backup");
    await fs.mkdir(path.join(backupDir, "index"), { recursive: true });
    await fs.writeFile(
      path.join(backupDir, "index/index.json"),
      JSON.stringify({
        version: 1,
        selectedPaths: [],
        files: { "backup-only.md": { id: "backup-id" } },
      }),
      "utf8",
    );
    await fs.mkdir(path.join(root, ".odessay"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".odessay/index.json"),
      JSON.stringify({ version: 2, bindingRootId: "root-1", selectedPaths: [], files: {} }),
      "utf8",
    );

    const result = await runJson(verifyScript, ["--workspace-root", root, "--backup-dir", backupDir]);

    expect(result.source.source).toBe("backup");
    expect(result.source.path).toContain("backup/index/index.json");
    expect(result.counts.missingInTarget).toBe(1);
  });
});
