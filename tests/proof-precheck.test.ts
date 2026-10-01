import { describe, expect, it } from "vitest"

// ODE-656 — the pure rules behind `ops:proof:precheck`. Each rule has a case
// that violates it and one that honours it. The cases mirror the three review
// FAILs of milestone 4 batch 2 that the precheck now catches before the PR
// opens (ODE-636 r1, ODE-593 r1). Whether a row's Note fits its Status is
// free text, so REVIEW judges it; the precheck does not.

const {
  checkCapabilityMap,
  checkCommit,
  commitType,
  isProductionPath,
  tableCells,
} = await import("../scripts/lib/proof-precheck.mjs")

const HEADER = "| ID | Capability | Chain | Invariant | Status | Priority | Evidence | Note |"
const SEPARATOR = "|---|---|---|---|---|---|---|---|"

function row(status: string, note: string) {
  return `| WATCH-07 | Cap | chain | invariant | ${status} | CRITICAL | evidence | ${note} |`
}

function map(...rows: string[]) {
  return ["# Map", "", HEADER, SEPARATOR, ...rows, ""].join("\n")
}

describe("path and subject classification", () => {
  it("treats tests, Rust tests and docs as non-production", () => {
    expect(isProductionPath("tests/support/editor-shell-doubles.ts")).toBe(false)
    expect(isProductionPath("src-tauri/tests/catalog_seam.rs")).toBe(false)
    expect(isProductionPath("components/foo.test.tsx")).toBe(false)
    expect(isProductionPath("workflow/quality/capability-integration-map.md")).toBe(false)
    expect(isProductionPath("app/(app)/desk/page.tsx")).toBe(true)
    expect(isProductionPath("src-tauri/src/commands/index.rs")).toBe(true)
  })

  it("reads the conventional type with or without a leading issue marker", () => {
    expect(commitType("test(export): cover real Desk callers [ODE-636]")).toBe("test")
    expect(commitType("[ODE-593] test: mirror Rust conflict race outcome")).toBe("test")
    expect(commitType("fix(desk): read desktop Markdown [ODE-636]")).toBe("fix")
    expect(commitType("Merge branch 'main'")).toBeNull()
  })
})

describe("commit rules", () => {
  it("rejects a test(...) commit that carries production code (ODE-636 r1)", () => {
    const violations = checkCommit({
      sha: "888b3fba0000",
      subject: "test(export): cover production page outcomes [ODE-636]",
      files: ["tests/editor-shell-export-delivery-desktop.test.tsx", "components/shared/markdown-export-notice.tsx"],
      testPatches: {},
    })
    expect(violations.map((violation) => violation.rule)).toEqual(["test-commit-touches-production"])
  })

  it("accepts a test(...) commit that only touches tests and docs", () => {
    expect(
      checkCommit({
        sha: "836cb9f70000",
        subject: "test(export): cover real Desk callers [ODE-636]",
        files: ["tests/a.test.tsx", "tests/support/doubles.ts", "workflow/testing/integration-harness-catalog.md"],
        testPatches: {},
      }),
    ).toEqual([])
  })

  it("rejects an it.fails introduced together with its production fix", () => {
    const violations = checkCommit({
      sha: "aaaa00000000",
      subject: "fix(ai): discard stale title responses [ODE-620]",
      files: ["tests/a.test.tsx", "components/editor/modals/rename-writing-modal.tsx"],
      testPatches: { "tests/a.test.tsx": "+it.fails(\"A lands in B\", async () => {\n+  expect(1).toBe(1)\n+})" },
    })
    expect(violations.map((violation) => violation.rule)).toEqual(["it-fails-with-production"])
  })

  it("accepts an it.fails that lands alone in a test commit (positive control)", () => {
    expect(
      checkCommit({
        sha: "b98be6c90000",
        subject: "test(ai): reproduce stale title responses [ODE-620]",
        files: ["tests/a.test.tsx"],
        testPatches: { "tests/a.test.tsx": "+it.fails(\"A lands in B\", async () => {\n+  expect(1).toBe(1)\n+})" },
      }),
    ).toEqual([])
  })

  it("only treats it.fails as the red test the contract names", () => {
    expect(
      checkCommit({
        sha: "cccc00000000",
        subject: "fix(x): change [ODE-1]",
        files: ["tests/a.test.ts", "lib/x.ts"],
        testPatches: { "tests/a.test.ts": "-  test.fails(\"x\", () => {\n+  test(\"x\", () => {\n+  // extra" },
      }),
    ).toEqual([])
  })

  it("rejects a fix that edits the body of the test it flips (ODE-636 r1)", () => {
    const violations = checkCommit({
      sha: "3da8ae850000",
      subject: "fix(export): write Desk Markdown through artifact service [ODE-636]",
      files: ["tests/a.test.tsx", "app/(app)/desk/page.tsx"],
      testPatches: {
        "tests/a.test.tsx": [
          "-  it.fails(\"exports Markdown\", async () => {",
          "+  it(\"exports Markdown\", async () => {",
          "-    expect(written).toBe(true)",
          "+    expect(written).toBe(\"done\")",
        ].join("\n"),
      },
    })
    expect(violations.map((violation) => violation.rule)).toEqual(["it-fails-flip-edits-test"])
  })

  it("ignores it.fails mentioned inside strings or comments", () => {
    expect(
      checkCommit({
        sha: "bbbb00000000",
        subject: "feat(ops): add a gate [ODE-656]",
        files: ["tests/a.test.ts", "scripts/gate.mjs"],
        testPatches: { "tests/a.test.ts": '+    patch: "+it.fails(\\"quoted\\")",\n+  // it.fails( in a comment' },
      }),
    ).toEqual([])
  })

  it("accepts a fix that only flips it.fails → it", () => {
    expect(
      checkCommit({
        sha: "368cb10c0000",
        subject: "fix(export): use artifact delivery for Markdown [ODE-636]",
        files: ["tests/a.test.tsx", "app/(app)/desk/page.tsx"],
        testPatches: {
          "tests/a.test.tsx": "-  it.fails(\"exports Markdown\", async () => {\n+  it(\"exports Markdown\", async () => {",
        },
      }),
    ).toEqual([])
  })
})

describe("capability map rules", () => {
  it("splits cells on unescaped pipes only", () => {
    expect(tableCells("| a | `x\\|y` | c |")).toHaveLength(3)
    expect(tableCells("| a | `x|y` | c |")).toHaveLength(4)
  })

  it("treats a pipe after an escaped backslash as a delimiter (GFM backslash parity)", () => {
    expect(tableCells("| a \\\\| b | c |")).toEqual([" a \\\\", " b ", " c "])
    expect(tableCells("| a \\| b | c |")).toEqual([" a \\| b ", " c "])
  })

  it("rejects a touched row with an extra cell (ODE-593 r1)", () => {
    const broken = row("PARTIAL_INTEGRATION", "note | stray cell")
    const violations = checkCapabilityMap(map(broken), new Set([broken]))
    expect(violations.map((violation) => violation.rule)).toEqual(["map-row-cell-count"])
  })

  it("ignores rows the branch did not touch", () => {
    const broken = row("PARTIAL_INTEGRATION", "note | stray cell")
    expect(checkCapabilityMap(map(broken), new Set())).toEqual([])
  })

})
