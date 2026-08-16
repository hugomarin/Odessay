#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import {
  STATUS_PATH,
  allLedgerPaths,
  parseJsonl,
} from "./lib/workflow-ledger.mjs";

let hasError = false;

function validateJsonFile(filePath) {
  if (!existsSync(filePath)) {
    console.error(`[validate-workflow-json] MISSING: ${filePath}`);
    hasError = true;
    return;
  }

  const content = readFileSync(filePath, "utf8");

  try {
    JSON.parse(content);
    console.log(`[validate-workflow-json] OK: ${filePath}`);
  } catch (err) {
    console.error(
      `[validate-workflow-json] INVALID JSON in ${filePath}: ${err.message}`,
    );
    hasError = true;
  }
}

function validateJsonlFile(filePath) {
  if (!existsSync(filePath)) {
    console.error(`[validate-workflow-json] MISSING: ${filePath}`);
    hasError = true;
    return;
  }

  const content = readFileSync(filePath, "utf8");

  // Un merge=union mal resuelto deja marcadores de conflicto o líneas pegadas.
  // Ambos rompen el parseo línea a línea, así que este chequeo es la red que
  // atrapa una unión corrupta antes de que llegue a main.
  if (/^<{7}|^={7}$|^>{7}/m.test(content)) {
    console.error(
      `[validate-workflow-json] CONFLICT MARKERS in ${filePath} — resolve the merge before committing.`,
    );
    hasError = true;
    return;
  }

  try {
    const entries = parseJsonl(content, filePath);
    if (content !== "" && !content.endsWith("\n")) {
      console.error(
        `[validate-workflow-json] MISSING TRAILING NEWLINE in ${filePath} — the next append would join the last line.`,
      );
      hasError = true;
      return;
    }
    console.log(
      `[validate-workflow-json] OK: ${filePath} (${entries.length} entries)`,
    );
  } catch (err) {
    console.error(`[validate-workflow-json] ${err.message}`);
    hasError = true;
  }
}

validateJsonFile(STATUS_PATH);
for (const ledgerPath of allLedgerPaths()) {
  validateJsonlFile(ledgerPath);
}

if (hasError) {
  console.error(
    "[validate-workflow-json] ABORT — fix the errors above before committing.",
  );
  process.exit(1);
}
