import type { WorkspaceRelationVerdict } from "@/lib/ai/workspace-document-relations"

export type WorkspaceSemanticRelationFixture = {
  id: string
  left: { markdown: string; evidenceNeedle: string; updatedAt: string }
  right: { markdown: string; evidenceNeedle: string; updatedAt: string }
  expectedVerdict: WorkspaceRelationVerdict
  expectedActionable: boolean
  rationale: string
}

const sameRecency = "2026-09-01T00:00:00.000Z"

/**
 * Policy fixtures for ODE-512. Expected labels describe product semantics;
 * they are independent of deterministic recall candidates and source recency.
 */
export const WORKSPACE_SEMANTIC_RELATION_FIXTURES: WorkspaceSemanticRelationFixture[] = [
  {
    id: "identical-content",
    left: { markdown: "# Storage\n\nSQLite is the local catalog.", evidenceNeedle: "SQLite is the local catalog.", updatedAt: sameRecency },
    right: { markdown: "# Storage\n\nSQLite is the local catalog.", evidenceNeedle: "SQLite is the local catalog.", updatedAt: sameRecency },
    expectedVerdict: "equivalent",
    expectedActionable: false,
    rationale: "The two claims are identical.",
  },
  {
    id: "markdown-punctuation-only",
    left: { markdown: "## Save path\n\nWrite the file, then update the catalog.", evidenceNeedle: "Write the file, then update the catalog.", updatedAt: sameRecency },
    right: { markdown: "# Save path\n\nWrite the file; then update the catalog!", evidenceNeedle: "Write the file; then update the catalog!", updatedAt: sameRecency },
    expectedVerdict: "style_only",
    expectedActionable: false,
    rationale: "Heading level and punctuation change, but the policy does not.",
  },
  {
    id: "stylistic-paraphrase",
    left: { markdown: "The workspace ledger records the current execution state.", evidenceNeedle: "The workspace ledger records the current execution state.", updatedAt: sameRecency },
    right: { markdown: "Current execution state is tracked in the workspace ledger.", evidenceNeedle: "Current execution state is tracked in the workspace ledger.", updatedAt: sameRecency },
    expectedVerdict: "equivalent",
    expectedActionable: false,
    rationale: "The wording changes while the asserted authority remains the same.",
  },
  {
    id: "complementary-claims",
    left: { markdown: "The release begins in May.", evidenceNeedle: "The release begins in May.", updatedAt: sameRecency },
    right: { markdown: "The release owner is the desktop team.", evidenceNeedle: "The release owner is the desktop team.", updatedAt: sameRecency },
    expectedVerdict: "complementary",
    expectedActionable: false,
    rationale: "The claims cover compatible schedule and ownership dimensions.",
  },
  {
    id: "explicit-polarity",
    left: { markdown: "Cloud authentication is required to view local files.", evidenceNeedle: "Cloud authentication is required to view local files.", updatedAt: sameRecency },
    right: { markdown: "Cloud authentication is not required to view local files.", evidenceNeedle: "Cloud authentication is not required to view local files.", updatedAt: sameRecency },
    expectedVerdict: "contradictory",
    expectedActionable: true,
    rationale: "The same capability is asserted and denied.",
  },
  {
    id: "numeric-date",
    left: { markdown: "The migration deadline is 15 September 2026.", evidenceNeedle: "The migration deadline is 15 September 2026.", updatedAt: sameRecency },
    right: { markdown: "The migration deadline is 30 September 2026.", evidenceNeedle: "The migration deadline is 30 September 2026.", updatedAt: sameRecency },
    expectedVerdict: "contradictory",
    expectedActionable: true,
    rationale: "The same deadline has two incompatible dates.",
  },
  {
    id: "scope-temporal",
    left: { markdown: "During beta, every workspace supports offline editing.", evidenceNeedle: "During beta, every workspace supports offline editing.", updatedAt: sameRecency },
    right: { markdown: "During beta, no shared workspace supports offline editing.", evidenceNeedle: "During beta, no shared workspace supports offline editing.", updatedAt: sameRecency },
    expectedVerdict: "contradictory",
    expectedActionable: true,
    rationale: "The beta-period scope overlaps and the capability claims are incompatible.",
  },
  {
    id: "unrelated-sections",
    left: { markdown: "The editor autosaves Markdown locally.", evidenceNeedle: "The editor autosaves Markdown locally.", updatedAt: sameRecency },
    right: { markdown: "The marketing site uses a serif display font.", evidenceNeedle: "The marketing site uses a serif display font.", updatedAt: sameRecency },
    expectedVerdict: "unrelated",
    expectedActionable: false,
    rationale: "The claims address different product surfaces and propositions.",
  },
  {
    id: "reordered-headings",
    left: { markdown: "# Scope\n\nDesktop only.\n\n# Owner\n\nPlatform team.", evidenceNeedle: "Desktop only.", updatedAt: sameRecency },
    right: { markdown: "# Owner\n\nPlatform team.\n\n# Scope\n\nDesktop only.", evidenceNeedle: "Desktop only.", updatedAt: sameRecency },
    expectedVerdict: "equivalent",
    expectedActionable: false,
    rationale: "Section order changes without changing either claim.",
  },
  {
    id: "recency-does-not-pick-truth",
    left: { markdown: "The catalog authority is SQLite.", evidenceNeedle: "The catalog authority is SQLite.", updatedAt: "2026-01-01T00:00:00.000Z" },
    right: { markdown: "The catalog authority is IndexedDB.", evidenceNeedle: "The catalog authority is IndexedDB.", updatedAt: "2026-09-13T00:00:00.000Z" },
    expectedVerdict: "contradictory",
    expectedActionable: true,
    rationale: "The authority claims conflict; the newer timestamp does not decide which is true.",
  },
]
