#!/usr/bin/env node

import { execSync } from "node:child_process";

const PROCESS_FILES = [
  "docs/ops/SETUP.md",
  ".agents/skills/skill-product-manager/SKILL.md",
  ".agents/skills/skill-code-review/SKILL.md",
];

function hasRef(ref) {
  try {
    execSync(`git rev-parse --verify ${ref}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findBaseRef() {
  const baseFromCi = process.env.GITHUB_BASE_REF?.trim();
  if (baseFromCi) {
    const ciRemote = `origin/${baseFromCi}`;
    if (hasRef(ciRemote)) return ciRemote;
    if (hasRef(baseFromCi)) return baseFromCi;
  }
  if (hasRef("origin/main")) return "origin/main";
  if (hasRef("main")) return "main";
  return "HEAD";
}

const baseRef = findBaseRef();
const mergeBase = execSync(`git merge-base HEAD ${baseRef}`, {
  encoding: "utf8",
}).trim();

const changedFiles = execSync(`git diff --name-only ${mergeBase}..HEAD`, {
  encoding: "utf8",
})
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const touchedProcessFiles = PROCESS_FILES.filter((file) =>
  changedFiles.includes(file),
);

if (touchedProcessFiles.length === 0) {
  console.log("[ops:process:sync] OK - no process files changed in this PR.");
  process.exit(0);
}

if (touchedProcessFiles.length !== PROCESS_FILES.length) {
  const missing = PROCESS_FILES.filter((file) => !touchedProcessFiles.includes(file));
  console.error(
    "[ops:process:sync] FAIL - process change must update all 3 files together.",
  );
  console.error(`[ops:process:sync] touched: ${touchedProcessFiles.join(", ")}`);
  console.error(`[ops:process:sync] missing: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(
  "[ops:process:sync] OK - process files updated together (SETUP + PM + Code Review).",
);
