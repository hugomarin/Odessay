#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";

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
  const lines = content.split("\n").filter((line) => line.trim() !== "");

  for (let i = 0; i < lines.length; i++) {
    try {
      JSON.parse(lines[i]);
    } catch (err) {
      console.error(
        `[validate-workflow-json] INVALID JSONL in ${filePath} at line ${i + 1}: ${err.message}`,
      );
      hasError = true;
      return;
    }
  }

  console.log(
    `[validate-workflow-json] OK: ${filePath} (${lines.length} lines)`,
  );
}

validateJsonFile("workflow/status.json");
validateJsonlFile("workflow/review-history.jsonl");

if (hasError) {
  console.error(
    "[validate-workflow-json] ABORT — fix the errors above before committing.",
  );
  process.exit(1);
}
