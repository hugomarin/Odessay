// Pure rules behind `ops:brief:lint` (ODE-656). /wf-build stops with a Context
// Gap when the Architecture Contract is missing or incomplete; this lint finds
// that during planning, before the issue is dispatched. Tested by
// tests/issue-brief-lint.test.ts.

export const ARCHITECTURE_CONTRACT_FIELDS = [
  "Layer",
  "Runtime scope",
  "Owner",
  "Contracts touched",
  "Invariants",
  "Required docs",
]

const SECTION_HEADING = /^#{2,4}\s+.*Architecture Contract.*$/im
const NEXT_HEADING = /^#{1,4}\s+/m
const RECON_PACK_COMMENT = /^##\s+Recon Pack\b/

const REFERENCE_DOCS_HEADING = /^#{2,4}\s+Reference docs\b.*$/im

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** The Architecture Contract section of a brief, or null when there is none. */
export function architectureContractSection(description) {
  const heading = SECTION_HEADING.exec(description)
  if (!heading) return null
  const rest = description.slice(heading.index + heading[0].length)
  const next = NEXT_HEADING.exec(rest)
  return next ? rest.slice(0, next.index) : rest
}

function fieldPattern(field) {
  // Accepts "* Layer:", "- **Layer:**", "**Layer**:", plain "Layer:" and a
  // qualifier before the colon ("**Invariants (ADR D1/D4):**").
  return new RegExp(`^(\\s*)(?:[-*]\\s+)?\\**${escapeRegExp(field)}(?:\\s*\\([^)\\n]*\\))?\\**\\s*:\\**(.*)$`, "im")
}

/**
 * The value of a "Field:" line: the rest of its line or, when that is empty,
 * the lines indented under it ("* **Required docs:**" followed by sub-bullets).
 * Returns null when the field is absent and "" when it is present but empty.
 */
export function fieldValue(text, field) {
  const match = fieldPattern(field).exec(text)
  if (!match) return null
  const inline = match[2].replace(/[*_\s]/g, "")
  if (inline) return match[2].trim()
  const indent = match[1].length
  const following = text.slice(match.index + match[0].length).split("\n").slice(1)
  const nested = []
  for (const line of following) {
    if (line.trim() === "") {
      if (nested.length > 0) break
      continue
    }
    const lineIndent = line.length - line.trimStart().length
    if (lineIndent <= indent) break
    nested.push(line.trim())
  }
  return nested.join("\n")
}

function sectionBody(description, headingPattern) {
  const heading = headingPattern.exec(description)
  if (!heading) return null
  const rest = description.slice(heading.index + heading[0].length)
  const next = NEXT_HEADING.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

/**
 * @param {string} description issue description (the brief)
 * @param {string[]} comments comment bodies
 * @param {{ requireRecon?: boolean }} options
 * @returns {string[]} problems; empty when the brief is dispatchable
 */
export function lintIssueBrief(description, comments = [], { requireRecon = false } = {}) {
  const problems = []
  const section = architectureContractSection(description ?? "")

  if (section === null) {
    problems.push("Missing \"Architecture Contract\" section (a heading such as \"## Architecture Contract\").")
  } else {
    for (const field of ARCHITECTURE_CONTRACT_FIELDS) {
      const value = fieldValue(section, field)
      if (value === null) {
        problems.push(`Architecture Contract has no "${field}:" field.`)
      } else if (value === "") {
        problems.push(`Architecture Contract field "${field}:" is empty.`)
      }
    }
  }

  // issue-brief-schema.md: every brief names the sources BUILD reads, as a
  // "## Reference docs" section or a "Reference docs:" field with a value.
  const referenceSection = sectionBody(description ?? "", REFERENCE_DOCS_HEADING)
  const referenceField = fieldValue(description ?? "", "Reference docs")
  if (!referenceSection && !referenceField) {
    problems.push("Missing \"Reference docs\" (a non-empty \"## Reference docs\" section or \"Reference docs:\" field).")
  }

  if (requireRecon && !comments.some((body) => RECON_PACK_COMMENT.test(body.trim()))) {
    problems.push("No \"## Recon Pack\" comment on the issue.")
  }

  return problems
}
