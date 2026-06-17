import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { blake3 } from "hash-wasm";

export const WORKSPACE_DIR_NAME = ".odessay";
export const LEGACY_WORKSPACE_DIR_NAME = ".ody" + "ssey";
export const WORKSPACE_INDEX_FILE_NAME = "index.json";
export const CONTENT_HASH_PREFIX = "blake3";
export const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  WORKSPACE_DIR_NAME,
  LEGACY_WORKSPACE_DIR_NAME,
]);

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function normalizeRelative(filePath) {
  return filePath.split(path.sep).join("/");
}

export function canonicalizeMarkdownForContentHash(markdown) {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export async function computeMarkdownContentHash(markdown) {
  const canonicalMarkdown = canonicalizeMarkdownForContentHash(markdown);
  const digest = await blake3(new TextEncoder().encode(canonicalMarkdown));
  return `${CONTENT_HASH_PREFIX}:${digest}`;
}

export function getIndexEntries(indexJson) {
  if (indexJson && typeof indexJson.files === "object" && !Array.isArray(indexJson.files)) {
    return Object.entries(indexJson.files);
  }

  if (Array.isArray(indexJson?.files)) {
    return indexJson.files.map((entry) => {
      const relativePath = entry.path ?? entry.relativePath ?? entry.canonical_path;
      return [relativePath, entry];
    });
  }

  if (Array.isArray(indexJson?.entries)) {
    return indexJson.entries.map((entry) => {
      const relativePath = entry.path ?? entry.relativePath ?? entry.canonical_path;
      return [relativePath, entry];
    });
  }

  return [];
}

export function indexIdForEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return entry.id ?? entry.uuid ?? entry.document_id ?? entry.writing_id ?? null;
}

export async function readWorkspaceIndex(workspaceRoot) {
  const indexPath = path.join(workspaceRoot, WORKSPACE_DIR_NAME, WORKSPACE_INDEX_FILE_NAME);
  const legacyIndexPath = path.join(
    workspaceRoot,
    LEGACY_WORKSPACE_DIR_NAME,
    WORKSPACE_INDEX_FILE_NAME,
  );
  const sourcePath = (await pathExists(indexPath))
    ? indexPath
    : (await pathExists(legacyIndexPath))
      ? legacyIndexPath
      : indexPath;

  if (!(await pathExists(sourcePath))) {
    return {
      indexPath,
      sourcePath,
      document: { version: 1, selectedPaths: [], files: {} },
      exists: false,
    };
  }

  const raw = await readJson(sourcePath);
  const files = {};
  for (const [relativePath, entry] of getIndexEntries(raw)) {
    if (!relativePath || typeof relativePath !== "string" || !entry || typeof entry !== "object") {
      continue;
    }
    files[normalizeRelative(path.normalize(relativePath))] = { ...entry };
  }

  return {
    indexPath,
    sourcePath,
    document: {
      version: raw.version ?? 1,
      selectedPaths: Array.isArray(raw.selectedPaths) ? raw.selectedPaths : [],
      files,
    },
    exists: true,
  };
}

export async function writeWorkspaceIndex(workspaceRoot, document) {
  const indexPath = path.join(workspaceRoot, WORKSPACE_DIR_NAME, WORKSPACE_INDEX_FILE_NAME);
  await writeJson(indexPath, {
    version: document.version ?? 1,
    selectedPaths: Array.isArray(document.selectedPaths) ? document.selectedPaths : [],
    files: document.files ?? {},
  });
  return indexPath;
}

export async function collectMarkdownFiles(dir, baseDir = dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await collectMarkdownFiles(fullPath, baseDir, files);
      continue;
    }

    if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name)) {
      files.push({
        absolutePath: fullPath,
        relativePath: normalizeRelative(path.relative(baseDir, fullPath)),
      });
    }
  }

  return files;
}

export async function readMarkdownIdentity(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const stat = await fs.stat(filePath);
  return {
    raw,
    frontmatterId: readFrontmatterIdFromMarkdown(raw),
    contentHash: await computeMarkdownContentHash(raw),
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    inode: typeof stat.ino === "number" ? stat.ino : 0,
  };
}

export function readFrontmatterIdFromMarkdown(raw) {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return null;
  }

  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const endIndex = normalized.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return null;
  }

  return parseFrontmatterId(normalized.slice(4, endIndex));
}

export function parseFrontmatterId(frontmatterRaw) {
  for (const rawLine of frontmatterRaw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^id\s*:\s*(.+?)\s*$/);
    if (!match) {
      continue;
    }

    const value = match[1].trim();
    if (!value || value === "null" || value === "~") {
      return null;
    }

    const quoted = value.match(/^['"](.+)['"]$/);
    return quoted ? quoted[1] : value;
  }

  return null;
}

export function mintWritingId() {
  return crypto.randomUUID();
}

export function loadEnvFile(envPath = ".env.local") {
  return fs.readFile(envPath, "utf8").then((raw) => {
    const parsed = {};
    for (const rawLine of raw.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) continue;
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      parsed[key] = value;
    }
    return parsed;
  });
}

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
