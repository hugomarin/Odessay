import { spawnSync } from "node:child_process"

const suites = ["tests/parity/parser-output.spec.ts", "tests/parity/render-output.spec.ts"]
const vitestBin = process.platform === "win32" ? "vitest.cmd" : "vitest"
const result = spawnSync(vitestBin, ["run", ...suites], {
  stdio: "inherit",
  shell: process.platform === "win32",
})

process.exit(result.status ?? 1)
