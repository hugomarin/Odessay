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
      // Accepts "* Layer:", "- **Layer:**", "**Layer**:", plain "Layer:" and a
      // qualifier before the colon ("**Invariants (ADR D1/D4):**").
      const pattern = new RegExp(`^\\s*(?:[-*]\\s+)?\\**${escapeRegExp(field)}(?:\\s*\\([^)\\n]*\\))?\\**\\s*:`, "im")
      if (!pattern.test(section)) {
        problems.push(`Architecture Contract has no "${field}:" field.`)
      }
    }
  }

  if (requireRecon && !comments.some((body) => RECON_PACK_COMMENT.test(body.trim()))) {
    problems.push("No \"## Recon Pack\" comment on the issue.")
  }

  return problems
}
