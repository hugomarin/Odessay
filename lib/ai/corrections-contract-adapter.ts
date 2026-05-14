import type { CanonicalCorrectionsResponse } from "@/lib/ai/corrections";
import { createCorrectionFingerprint } from "@/lib/ai/correction-memory";
import type { PublicationChecklistItem, PublicationSuggestion } from "@/lib/local-db/schema";

const TYPE_LABELS: Record<string, string> = {
  spelling: "Spelling",
  accent: "Accent",
  grammar: "Grammar",
  agreement: "Agreement",
  punctuation: "Punctuation",
  duplication: "Duplication",
  spacing: "Spacing",
  basic_redaction: "Basic correction",
};

const toTitle = (type: string) => TYPE_LABELS[type] ?? "Correction";

/**
 * Temporary transition layer for legacy publication-review consumers.
 * Remove after correction UI consumes the canonical corrections contract directly.
 */
export const adaptCanonicalCorrectionsToPublicationReview = (
  canonical: CanonicalCorrectionsResponse,
): {
  summary: string | null;
  suggestions: PublicationSuggestion[];
  checklist: PublicationChecklistItem[];
} => ({
  summary: canonical.summary || null,
  suggestions: canonical.corrections.map((correction, index) => ({
    id: `correction-${correction.blockId}-${index + 1}`,
    kind: "spelling",
    title: toTitle(correction.type),
    reason: correction.reason,
    original_text: correction.originalText,
    replacement_text: correction.replacementText,
    context_before: null,
    context_after: null,
    block_id: correction.blockId,
    correction_fingerprint: createCorrectionFingerprint(correction),
    status: "pending",
  })),
  checklist: canonical.uncertain.map((item, index) => ({
    id: `uncertain-${item.blockId}-${index + 1}`,
    label: "Needs review",
    detail: item.reason,
    target_text: item.text,
    status: "pending",
  })),
});
