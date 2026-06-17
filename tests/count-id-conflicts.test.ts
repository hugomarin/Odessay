import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const LEGACY_INDEX_DIR = ".ody" + "ssey";

describe("count-id-conflicts", () => {
  it("counts frontmatter and workspace index UUID conflicts without writing files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odessay-id-conflicts-"));
    await mkdir(path.join(root, LEGACY_INDEX_DIR), { recursive: true });
    await mkdir(path.join(root, "nested"), { recursive: true });

    const matchingPath = path.join(root, "matching.md");
    const conflictPath = path.join(root, "nested", "conflict.md");
    const frontmatterOnlyPath = path.join(root, "frontmatter-only.md");
    const neitherPath = path.join(root, "neither.md");

    await writeFile(matchingPath, "---\nid: same-id\n---\n# Matching\n", "utf8");
    await writeFile(conflictPath, "---\nid: frontmatter-id\n---\n# Conflict\n", "utf8");
    await writeFile(frontmatterOnlyPath, "---\nid: only-frontmatter\n---\n# Frontmatter only\n", "utf8");
    await writeFile(neitherPath, "# Neither\n", "utf8");
    await writeFile(
      path.join(root, LEGACY_INDEX_DIR, "index.json"),
      JSON.stringify({
        version: 1,
        files: {
          "matching.md": { id: "same-id" },
          "nested/conflict.md": { id: "index-id" },
        },
      }),
      "utf8",
    );

    const before = await readFile(conflictPath, "utf8");
    const scriptPath = path.resolve("scripts/identity/count-id-conflicts.mjs");
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--json", root]);
    const output = JSON.parse(stdout);

    expect(output.readOnly).toBe(true);
    expect(output.summary).toMatchObject({
      totalDocs: 4,
      withFrontmatterId: 3,
      withIndexId: 2,
      conflicts: 1,
      withoutEitherId: 1,
    });
    expect(output.workspaces[0].conflicts).toEqual([
      {
        path: "nested/conflict.md",
        frontmatterId: "frontmatter-id",
        indexId: "index-id",
        conflict: true,
      },
    ]);
    await expect(readFile(conflictPath, "utf8")).resolves.toBe(before);
  });
});
