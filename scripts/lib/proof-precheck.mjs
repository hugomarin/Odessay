// Pure rules behind `ops:proof:precheck` (ODE-656). No git and no I/O here:
// the CLI (scripts/check-proof-precheck.mjs) collects commits and file text,
// these functions decide. Keeping them pure is what lets
// tests/proof-precheck.test.ts cover every rule without a repository.
//
// The rules turn checks REVIEW used to do by hand (capability-proof-contract.md
// rule 8 and the map row format) into a gate that runs before the PR opens.

export const CAPABILITY_MAP_PATH = "workflow/quality/capability-integration-map.md"

const TEST_PATH_PATTERNS = [
  /^tests\//,
  /^src-tauri\/tests\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
]

// Docs and process records may ride along in any commit: they are not
// production code, so they never break the "test commit" boundary.
const DOC_PATH_PATTERNS = [/\.md$/, /^workflow\//, /^docs\//]

// A real call starts its line; a mention inside a string or comment does not,
// so test fixtures that quote "it.fails(" never trip the rule.
const FAILS_CALL = /^(\s*)(it|test)\.fails\(/

export function isTestPath(path) {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(path))
}

export function isDocPath(path) {
  return DOC_PATH_PATTERNS.some((pattern) => pattern.test(path))
}

export function isProductionPath(path) {
  return !isTestPath(path) && !isDocPath(path)
}

/**
 * Conventional-commit type of a subject: `test(desk): …` → `test`. A leading
 * issue marker (`[ODE-593] test: …`) is skipped; both forms are in the history.
 */
export function commitType(subject) {
  const match = /^([a-z]+)(?:\([^)]*\))?!?:/.exec(subject.trim().replace(/^\[[^\]]+\]\s*/, ""))
  return match ? match[1] : null
}

/**
 * Split a unified diff of ONE file (as printed by `git show -U0 -- <file>`)
 * into its removed and added content lines, in order.
 */
export function diffLines(patch) {
  const removed = []
  const added = []
  for (const line of patch.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue
    if (line.startsWith("-")) removed.push(line.slice(1))
    else if (line.startsWith("+")) added.push(line.slice(1))
  }
  return { removed, added }
}

/**
 * @param {{ sha: string, subject: string, files: string[], testPatches: Record<string, string> }} commit
 *   `testPatches` maps each touched test file to its `-U0` diff in this commit.
 * @returns {{ sha: string, rule: string, detail: string }[]}
 */
export function checkCommit(commit) {
  const violations = []
  const short = commit.sha.slice(0, 8)
  const production = commit.files.filter(isProductionPath)

  if (commitType(commit.subject) === "test" && production.length > 0) {
    violations.push({
      sha: short,
      rule: "test-commit-touches-production",
      detail: `"${commit.subject}" is a test(...) commit but changes production files: ${production.join(", ")}. Move them to their own commit.`,
    })
  }

  for (const [file, patch] of Object.entries(commit.testPatches)) {
    const { removed, added } = diffLines(patch)
    const introducesFails = added.some((line) => FAILS_CALL.test(line)) &&
      !removed.some((line) => FAILS_CALL.test(line))
    const flipsFails = removed.some((line) => FAILS_CALL.test(line))

    if (introducesFails && production.length > 0) {
      violations.push({
        sha: short,
        rule: "it-fails-with-production",
        detail: `${file} introduces an it.fails in the same commit that changes production (${production.join(", ")}). The red test lands alone, before its fix.`,
      })
    }

    if (flipsFails) {
      const flipped = removed.map((line) => line.replace(FAILS_CALL, "$1$2("))
      const sameLength = flipped.length === added.length
      const onlyFlip = sameLength && flipped.every((line, index) => line === added[index])
      if (!onlyFlip) {
        violations.push({
          sha: short,
          rule: "it-fails-flip-edits-test",
          detail: `${file}: the commit that turns it.fails into it also changes other lines of the test (${removed.length} removed, ${added.length} added). The fix may only flip it.fails → it.`,
        })
      }
    }
  }

  return violations
}

/** Split a Markdown table row on unescaped pipes, like GitHub does. */
export function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/)
}

const SEPARATOR_ROW = /^\|\s*:?-{3,}/
const SCENARIO_ROW = /^\|\s*([A-Z]+-\d+)\s*\|/
const STILL_PARTIAL = /\b(remains|stays|still|sigue|queda|permanece)\b[^.|]{0,40}\bPARTIAL/i
const HISTORICAL = /histor|hist[oó]ric|\bat the time of\b|\ben su momento\b|\b(before|until|antes de|hasta) ODE-|\b(was|were|reported|estaba|quedaba|seguía)\b/i

/**
 * Check the capability map rows whose exact text appears in `changedLines`
 * (the lines a branch added). Rows the branch did not touch are never judged,
 * so a pre-existing defect elsewhere cannot block an unrelated PR.
 *
 * @param {string} text the full map file at the branch head
 * @param {Set<string>} changedLines lines added by the branch
 */
export function checkCapabilityMap(text, changedLines) {
  const violations = []
  const lines = text.split("\n")
  let headerCells = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.startsWith("|")) {
      headerCells = null
      continue
    }
    if (SEPARATOR_ROW.test(line)) continue
    if (index + 1 < lines.length && SEPARATOR_ROW.test(lines[index + 1])) {
      headerCells = tableCells(line).length
      continue
    }
    if (headerCells === null || !changedLines.has(line)) continue

    const cells = tableCells(line)
    const id = SCENARIO_ROW.exec(line)?.[1] ?? `line ${index + 1}`
    if (cells.length !== headerCells) {
      violations.push({
        sha: "map",
        rule: "map-row-cell-count",
        detail: `${CAPABILITY_MAP_PATH}:${index + 1} (${id}) has ${cells.length} cells; its table header has ${headerCells}. Escape literal pipes as \\| or move the text into the Note.`,
      })
      continue
    }

    // Scenario tables: ID | Capability | Chain | Invariant | Status | Priority | Evidence | Note
    if (headerCells === 8 && SCENARIO_ROW.test(line)) {
      const status = cells[4].replace(/[\s*`]/g, "")
      if (status !== "INTEGRATION") continue
      const sentences = cells[7].split(/(?<=[.;])\s+/)
      const contradiction = sentences.find(
        (sentence) => STILL_PARTIAL.test(sentence) && !HISTORICAL.test(sentence),
      )
      if (contradiction) {
        violations.push({
          sha: "map",
          rule: "map-status-note-contradiction",
          detail: `${CAPABILITY_MAP_PATH}:${index + 1} (${id}) is INTEGRATION but its Note still says: "${contradiction.trim().slice(0, 160)}". Rewrite it or mark it historical.`,
        })
      }
    }
  }

  return violations
}
