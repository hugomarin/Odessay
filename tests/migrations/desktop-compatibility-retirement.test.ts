import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".git",
  "target",
  "test-results",
  ".playwright-mcp",
]);

const SOURCE_LIKE_GLOBS = /\.(ts|tsx|js|mjs|cjs|rs)$/;

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        files.push(...(await walkFiles(fullPath)));
      }
      continue;
    }
    if (entry.isFile() && SOURCE_LIKE_GLOBS.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function grepFiles(pattern: RegExp): Promise<Set<string>> {
  const allFiles = await walkFiles(repoRoot);
  const matches = new Set<string>();

  await Promise.all(
    allFiles.map(async (filePath) => {
      try {
        const content = await fs.readFile(filePath, "utf8");
        if (pattern.test(content)) {
          matches.add(path.relative(repoRoot, filePath));
        }
      } catch {
        // Ignore unreadable files.
      }
    }),
  );

  return matches;
}

/**
 * Static reachability proof for ODE-374.
 *
 * These tests document where legacy identity and compatibility paths are still
 * allowed to live. They fail if a new consumer appears outside the allowed set,
 * which is the definition of "no dynamic Tauri/import consumer remains" during
 * the gated cleanup phase.
 *
 * The allowed sets intentionally include:
 *   - the Rust command that implements the legacy behavior
 *   - the TypeScript adapter/service that wraps it
 *   - migration scripts and tooling
 *   - tests that exercise or audit the legacy path
 *
 * As cleanup progresses, each allowed set shrinks until it reaches zero and the
 * legacy code can be deleted.
 */
describe("desktop compatibility retirement reachability", () => {
  it("frontmatter identity extraction has no runtime implementation", async () => {
    const files = await grepFiles(/extract_writing_id_from_frontmatter/);
    const unexpected = [...files].filter((file) => file !== "tests/migrations/desktop-compatibility-retirement.test.ts");
    expect(unexpected).toEqual([]);
  });

  it("Rust has no fallback that mints missing document ids", async () => {
    const files = await grepFiles(/missing client document id|extract_writing_id_from_frontmatter/);
    const unexpected = [...files].filter((file) =>
      file !== "src-tauri/src/commands/workspace.rs" &&
      file !== "tests/migrations/desktop-compatibility-retirement.test.ts"
    );
    expect(unexpected).toEqual([]);
  });

  it("legacy index commands have zero runtime consumers or registrations", async () => {
    const files = await grepFiles(/index_upsert|index_list|index_delete|index_rebuild/);
    const unexpected = [...files].filter((file) => file !== "tests/migrations/desktop-compatibility-retirement.test.ts");
    expect(unexpected).toEqual([]);
  });

  it("pre-M5 filesystem migration has zero runtime consumers", async () => {
    const files = await grepFiles(/migrateIndexedDbToFilesystem/);
    const unexpected = [...files].filter((file) => file !== "tests/migrations/desktop-compatibility-retirement.test.ts");
    expect(unexpected).toEqual([]);
  });

  it("desktop document, workspace, opener and sync adapters do not import IndexedDB", async () => {
    const files = await grepFiles(/from ["']@\/lib\/local-db["']/);
    const forbidden = [...files].filter((file) =>
      file === "lib/services/document-service-factory.ts" ||
      file.startsWith("lib/services/desktop/") ||
      file === "lib/sync/desktop-catalog-sync-service.ts"
    );
    expect(forbidden).toEqual([]);
  });

  it("legacy .odyssey spelling is confined to workspace command, identity tooling and tests", async () => {
    const files = await grepFiles(/\.odyssey/);
    const allowed = new Set([
      "src-tauri/src/commands/workspace.rs",
      "scripts/identity/lib.mjs",
      "scripts/identity/count-id-conflicts.mjs",
      "scripts/identity-harvest/lib.mjs",
      "scripts/identity-harvest/harvest-legacy-identities.mjs",
      "scripts/identity-harvest/apply-identity-harvest.mjs",
      "scripts/identity-harvest/verify-odyssey-migration.mjs",
      "tests/count-id-conflicts.test.ts",
      "tests/identity-harvest-report.test.ts",
      "tests/migrations/desktop-compatibility-retirement.test.ts",
    ]);

    const unexpected = [...files].filter((file) => !allowed.has(file));
    expect(unexpected).toEqual([]);
  });
});
