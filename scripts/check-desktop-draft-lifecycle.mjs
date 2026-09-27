#!/usr/bin/env node
import { spawnSync } from "node:child_process"

const commands = [
  ["npx", ["vitest", "run", "tests/editor-shell-draft-materialization-desktop.test.tsx", "tests/editor-shell-close-commit-window-desktop.test.tsx", "tests/editor-shell-blank-draft-naming-desktop.test.tsx", "tests/editor-session-store.test.ts", "tests/editor-hydration-session.test.ts", "tests/services/document-service-factory.test.ts"]],
  ["npx", ["playwright", "test", "tests/playwright/write-blank-lifecycle.e2e.ts", "tests/playwright/write-new-first-paste.e2e.ts"]],
]

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
