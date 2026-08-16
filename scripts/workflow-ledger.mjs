#!/usr/bin/env node

/**
 * Consulta y mantenimiento de los ledgers de workflow.
 *
 * Existe para que un agente no tenga que cargar 400 KB de bitácora en contexto
 * para responder "¿qué se entregó en ODE-447?". Consultar, no leer el archivo.
 *
 *   npm run ops:ledger -- built --issue ODE-447
 *   npm run ops:ledger -- built --phase "Fase 10" --brief
 *   npm run ops:ledger -- built --last 10 --brief
 *   npm run ops:ledger -- review --issue ODE-447
 *   npm run ops:ledger -- append-built '<json>'
 *   npm run ops:ledger -- append-review '<json>'
 *   npm run ops:ledger -- rotate --before 2026-09-01
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARCHIVE_DIR,
  BUILT_PATH,
  REVIEW_HISTORY_PATH,
  appendBuilt,
  appendReviewEvent,
  parseJsonl,
  readBuilt,
  readReviewHistory,
} from "./lib/workflow-ledger.mjs";

function fail(message) {
  console.error(`[ops:ledger] ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];

function flag(name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : (args[index + 1] ?? null);
}

const hasFlag = (name) => args.includes(`--${name}`);

function briefBuilt(entry) {
  return `${entry.date ?? "?"}  ${entry.issue ?? "?"}  ${entry.what ?? ""}`;
}

function briefReview(entry) {
  return `${(entry.ts ?? "?").slice(0, 16)}  ${entry.issue ?? "?"}  ${entry.type ?? "?"}  score=${entry.score ?? "-"}  ${entry.gate_result ?? ""}`;
}

function query(entries, brief) {
  const issue = flag("issue");
  const phase = flag("phase");
  const since = flag("since");
  const last = flag("last");

  let result = entries;
  if (issue) result = result.filter((e) => e.issue === issue);
  if (phase) result = result.filter((e) => (e.phase ?? "").includes(phase));
  if (since)
    result = result.filter((e) => String(e.date ?? e.ts ?? "") >= since);
  if (last) result = result.slice(-Number.parseInt(last, 10));

  if (result.length === 0) {
    console.log("[ops:ledger] No entries matched.");
    return;
  }

  if (hasFlag("brief")) {
    for (const entry of result) console.log(brief(entry));
    console.log(`\n[ops:ledger] ${result.length} entries.`);
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

function parseInlineJson(raw) {
  if (!raw) fail("Missing JSON payload.");
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`Payload is not valid JSON: ${err.message}`);
  }
}

/**
 * Mueve del ledger activo al archivo todo lo anterior a --before. El archivo
 * queda congelado: al no recibir appends nunca vuelve a conflictuar, y el
 * activo se mantiene chico para el contexto de los agentes.
 */
function rotate() {
  const before = flag("before");
  if (!before) fail("rotate requires --before YYYY-MM-DD.");

  for (const [path, key, prefix] of [
    [BUILT_PATH, "date", "built"],
    [REVIEW_HISTORY_PATH, "ts", "review-history"],
  ]) {
    if (!existsSync(path)) continue;
    const entries = parseJsonl(readFileSync(path, "utf8"), path);
    const stays = entries.filter((e) => String(e[key] ?? "") >= before);
    const moves = entries.filter((e) => String(e[key] ?? "") < before);
    if (moves.length === 0) {
      console.log(`[ops:ledger] ${path}: nothing older than ${before}.`);
      continue;
    }

    const dates = moves
      .map((e) => String(e[key] ?? ""))
      .filter(Boolean)
      .sort();
    const span = `${dates.at(0).slice(0, 10)}--${dates.at(-1).slice(0, 10)}`;
    const target = join(ARCHIVE_DIR, `${prefix}-${span}.jsonl`);
    if (existsSync(target)) fail(`Archive already exists: ${target}`);
    if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });

    const serialize = (list) =>
      list.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    writeFileSync(target, serialize(moves));
    writeFileSync(path, stays.length === 0 ? "" : serialize(stays));
    console.log(
      `[ops:ledger] ${path}: moved ${moves.length} entries to ${target}, kept ${stays.length}.`,
    );
  }
}

switch (command) {
  case "built":
    query(readBuilt({ includeArchive: !hasFlag("active-only") }), briefBuilt);
    break;
  case "review":
    query(
      readReviewHistory({ includeArchive: !hasFlag("active-only") }),
      briefReview,
    );
    break;
  case "append-built": {
    const entry = parseInlineJson(args[1]);
    if (!entry.issue) fail("Built entry requires an `issue` field.");
    if (!entry.date) fail("Built entry requires a `date` field.");
    console.log(`[ops:ledger] Appended ${entry.issue} to ${appendBuilt(entry)}`);
    break;
  }
  case "append-review": {
    const event = parseInlineJson(args[1]);
    if (!event.issue) fail("Review event requires an `issue` field.");
    if (!event.ts) fail("Review event requires a `ts` field.");
    console.log(
      `[ops:ledger] Appended ${event.issue} ${event.type ?? ""} to ${appendReviewEvent(event)}`,
    );
    break;
  }
  case "rotate":
    rotate();
    break;
  default:
    fail(
      "Usage: built | review | append-built <json> | append-review <json> | rotate --before YYYY-MM-DD",
    );
}
