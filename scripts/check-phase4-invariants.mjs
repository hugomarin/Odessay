#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_REPORT_PATH = "artifacts/phase4/phase4-invariants-report.json";
const DEFAULT_STDOUT_PATH = "artifacts/phase4/phase4-invariants.log";

const SUITES = [
  "tests/fase4-invariants.test.ts",
  "tests/reading-regression.test.tsx",
  "tests/document-service.test.ts",
  "tests/editor-write-path.test.tsx",
  "tests/sync-service.test.ts",
  "tests/sync-hydration.test.ts",
  "tests/markdown-roundtrip.test.ts",
  "tests/ai-auth-services.test.ts",
  "tests/sharing-service.test.ts",
  "tests/test-link-access.test.ts",
  "tests/test-link.test.ts",
  "tests/service-contracts.test.ts",
];

const MANUAL_QA_FLOWS = [
  "write/save/close/reopen in browser",
  "Rich ↔ Source on representative content",
  "import/export round-trip with real files",
  "preview/shared/public human reading check",
  "share/test-link real access check",
  "offline/online sync perception",
];

function fail(message) {
  console.error(`[phase4:invariants] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    reportPath: DEFAULT_REPORT_PATH,
    stdoutPath: DEFAULT_STDOUT_PATH,
  };

  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === "--report") {
      if (!value) fail("Missing value for --report.");
      options.reportPath = value;
      index += 1;
      continue;
    }

    if (arg === "--stdout") {
      if (!value) fail("Missing value for --stdout.");
      options.stdoutPath = value;
      index += 1;
      continue;
    }

    fail(`Unknown option "${arg}".`);
  }

  return options;
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function main() {
  const options = parseArgs(process.argv);
  const command = ["vitest", "run", ...SUITES];

  let stdout = "";
  try {
    stdout = execFileSync("npx", command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const failureStdout = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    ensureParent(options.stdoutPath);
    writeFileSync(options.stdoutPath, `${failureStdout}\n`, "utf8");
    fail(`Invariant suite failed. See ${options.stdoutPath}.`);
  }

  ensureParent(options.stdoutPath);
  writeFileSync(options.stdoutPath, `${stdout.trim()}\n`, "utf8");

  const report = {
    generated_at_utc: new Date().toISOString(),
    suite: "phase4-invariants",
    status: "pass",
    command: `npx ${command.join(" ")}`,
    suites: SUITES,
    categories: {
      canonical_document_contract: [
        "tests/markdown-roundtrip.test.ts",
        "tests/reading-regression.test.tsx",
      ],
      write_path_boundary: [
        "tests/document-service.test.ts",
        "tests/editor-write-path.test.tsx",
      ],
      sync_boundary: [
        "tests/sync-service.test.ts",
        "tests/sync-hydration.test.ts",
      ],
      remote_capability_boundaries: [
        "tests/ai-auth-services.test.ts",
        "tests/sharing-service.test.ts",
        "tests/test-link-access.test.ts",
        "tests/service-contracts.test.ts",
      ],
    },
    manual_qa_required: MANUAL_QA_FLOWS,
    stdout_path: options.stdoutPath,
  };

  ensureParent(options.reportPath);
  writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`[phase4:invariants] PASS - report written to ${options.reportPath}`);
}

main();
