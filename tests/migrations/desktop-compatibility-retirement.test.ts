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
  it("frontmatter identity extraction is confined to workspace command, harvest tooling and tests", async () => {
    const files = await grepFiles(/extract_writing_id_from_frontmatter/);
    const allowed = new Set([
      "src-tauri/src/commands/workspace.rs",
      "src-tauri/src/commands/index.rs",
      "tests/migrations/desktop-compatibility-retirement.test.ts",
    ]);

    const unexpected = [...files].filter((file) => !allowed.has(file));
    expect(unexpected).toEqual([]);
  });

  it("Rust UUID minting is confined to workspace command and tests", async () => {
    const files = await grepFiles(/Uuid::new_v4/);
    const allowed = new Set([
      "src-tauri/src/commands/workspace.rs",
      "src-tauri/src/commands/index.rs",
      "tests/migrations/desktop-compatibility-retirement.test.ts",
    ]);

    const unexpected = [...files].filter((file) => !allowed.has(file));
    expect(unexpected).toEqual([]);
  });

  it("legacy index commands are confined to LocalIndexService, tauri-commands and tests", async () => {
    const files = await grepFiles(/index_upsert|index_list|index_delete|index_rebuild/);
    const allowed = new Set([
      "src-tauri/src/commands/index.rs",
      "src-tauri/src/lib.rs",
      "lib/services/desktop/local-index-service.ts",
      "lib/services/desktop/tauri-commands.ts",
      "tests/local-index-service.test.ts",
      "tests/filesystem-document-service.test.ts",
      "tests/fase6-invariants.test.ts",
      "tests/services/document-service-factory.test.ts",
      "tests/migrations/desktop-compatibility-retirement.test.ts",
    ]);

    const unexpected = [...files].filter((file) => !allowed.has(file));
    expect(unexpected).toEqual([]);
  });

  it("pre-M5 filesystem migration is confined to factory, migration module and tests", async () => {
    const files = await grepFiles(/migrateIndexedDbToFilesystem/);
    const allowed = new Set([
      "lib/migrations/indexeddb-to-filesystem.ts",
      "lib/services/document-service-factory.ts",
      "tests/services/desktop-save-path.test.ts",
      "tests/services/document-service-factory.test.ts",
      "tests/migrations/desktop-compatibility-retirement.test.ts",
    ]);

    const unexpected = [...files].filter((file) => !allowed.has(file));
    expect(unexpected).toEqual([]);
  });

  it("legacy .odyssey spelling is confined to workspace command, identity tooling and tests", async () => {
    const files = await grepFiles(/\.odyssey/);
    const allowed = new Set([
      "src-tauri/src/commands/workspace.rs",
      "scripts/identity/lib.mjs",
      "scripts/identity/count-id-conflicts.mjs",
      "scripts/identity-harvest/lib.mjs",
      "scripts/identity-harvest/harvest-legacy-identities.mjs",
      "scripts/identity-harvest/verify-odyssey-migration.mjs",
      "tests/count-id-conflicts.test.ts",
      "tests/identity-harvest-report.test.ts",
      "tests/migrations/desktop-compatibility-retirement.test.ts",
    ]);

    const unexpected = [...files].filter((file) => !allowed.has(file));
    expect(unexpected).toEqual([]);
  });
});
