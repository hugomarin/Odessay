#!/usr/bin/env node

/**
 * Acceso compartido a los ledgers de workflow.
 *
 * Por qué existe: `built` vivía como array dentro de `workflow/status.json`. Un
 * array JSON append-only obliga a cada rama a reescribir las mismas líneas de
 * cierre, así que dos ramas paralelas conflictúan siempre y git no puede unir
 * arrays. Como JSONL, cada entrega es una línea propia y `merge=union`
 * (ver `.gitattributes`) resuelve los appends concurrentes sin intervención.
 *
 * Los ledgers se parten en dos: el archivo activo (fase corriente, el único que
 * recibe appends) y los archivos rotados en `workflow/archive/`, congelados —
 * lo congelado no conflictúa ni se carga salvo que se pida explícitamente.
 */

import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const WORKFLOW_DIR = "workflow";
export const ARCHIVE_DIR = join(WORKFLOW_DIR, "archive");
export const STATUS_PATH = join(WORKFLOW_DIR, "status.json");
export const BUILT_PATH = join(WORKFLOW_DIR, "built.jsonl");
export const REVIEW_HISTORY_PATH = join(WORKFLOW_DIR, "review-history.jsonl");

const BUILT_ARCHIVE_PREFIX = "built-";
const REVIEW_ARCHIVE_PREFIX = "review-history-";

export function parseJsonl(content, sourcePath) {
  const entries = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch (err) {
      throw new Error(
        `INVALID JSONL in ${sourcePath} at line ${i + 1}: ${err.message}`,
      );
    }
  }
  return entries;
}

function readJsonlFile(path) {
  if (!existsSync(path)) return [];
  return parseJsonl(readFileSync(path, "utf8"), path);
}

function archivePaths(prefix) {
  if (!existsSync(ARCHIVE_DIR)) return [];
  return readdirSync(ARCHIVE_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".jsonl"))
    .sort()
    .map((name) => join(ARCHIVE_DIR, name));
}

export function builtArchivePaths() {
  return archivePaths(BUILT_ARCHIVE_PREFIX);
}

export function reviewArchivePaths() {
  return archivePaths(REVIEW_ARCHIVE_PREFIX);
}

/** Todos los ledgers en disco, activos y archivados. Para validación. */
export function allLedgerPaths() {
  return [
    BUILT_PATH,
    REVIEW_HISTORY_PATH,
    ...builtArchivePaths(),
    ...reviewArchivePaths(),
  ];
}

/**
 * Ordena por el campo temporal. Es necesario, no cosmético: `merge=union` une
 * los appends de dos ramas por posición de hunk, no por fecha, así que el orden
 * físico del archivo deja de ser cronológico apenas hay ramas paralelas.
 * Cualquier consumidor que lea la cola del archivo ("los últimos 10", "los 3 más
 * recientes") leería lo que no es. Los lectores reciben orden garantizado; el
 * archivo en disco queda como git lo dejó.
 */
function sortChronologically(entries, key) {
  return [...entries].sort((a, b) =>
    String(a[key] ?? "").localeCompare(String(b[key] ?? "")),
  );
}

/**
 * Entregas registradas, en orden cronológico ascendente (la más reciente al
 * final). `includeArchive: false` limita a la fase activa.
 */
export function readBuilt({ includeArchive = true } = {}) {
  const paths = includeArchive
    ? [...builtArchivePaths(), BUILT_PATH]
    : [BUILT_PATH];
  return sortChronologically(
    paths.flatMap((path) => readJsonlFile(path)),
    "date",
  );
}

/** Eventos de review/build/ship, mismo orden que `readBuilt`. */
export function readReviewHistory({ includeArchive = true } = {}) {
  const paths = includeArchive
    ? [...reviewArchivePaths(), REVIEW_HISTORY_PATH]
    : [REVIEW_HISTORY_PATH];
  return sortChronologically(
    paths.flatMap((path) => readJsonlFile(path)),
    "ts",
  );
}

export function readStatus() {
  return JSON.parse(readFileSync(STATUS_PATH, "utf8"));
}

/**
 * Append de una línea. Fuerza newline final: un archivo sin salto al final hace
 * que el próximo append se pegue a la última línea, y ahí `merge=union` produce
 * JSONL corrupto en vez de una unión limpia.
 */
function appendLine(path, entry) {
  const line = `${JSON.stringify(entry)}\n`;
  if (existsSync(path)) {
    const content = readFileSync(path, "utf8");
    if (content !== "" && !content.endsWith("\n")) {
      writeFileSync(path, `${content}\n`);
    }
  }
  appendFileSync(path, line);
  return path;
}

export function appendBuilt(entry) {
  return appendLine(BUILT_PATH, entry);
}

export function appendReviewEvent(event) {
  return appendLine(REVIEW_HISTORY_PATH, event);
}
