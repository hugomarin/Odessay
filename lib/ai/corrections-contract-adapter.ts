import { z } from "zod";
import { createCorrectionFingerprint } from "@/lib/ai/correction-memory";
import type {
  PublicationChecklistItem,
  PublicationSuggestion,
  PublicationSuggestionKind,
} from "@/lib/local-db/schema";

const mechanicalCorrectionTypeSchema = z.enum([
  "spelling",
  "accent",
  "grammar",
  "agreement",
  "punctuation",
  "duplication",
  "spacing",
  "basic_redaction",
]);

const mechanicalCorrectionSchema = z.object({
  blockId: z.string().trim().min(1).catch("unknown-block"),
  type: mechanicalCorrectionTypeSchema.catch("spelling"),
  severity: z.enum(["low", "medium", "high"]).optional().default("low"),
  confidence: z.enum(["high", "medium"]).optional().default("medium"),
  originalText: z.string().trim().min(1).catch(""),
  replacementText: z.string().trim().min(1).catch(""),
});

const uncertainCorrectionSchema = z.object({
  blockId: z.string().trim().min(1).catch("unknown-block"),
  text: z.string().trim().min(1).catch(""),
  reason: z.string().trim().min(1).catch(""),
  possibleReplacement: z.string().trim().min(1).nullable().catch(null),
});

export const mechanicalCorrectionsContractSchema = z.object({
  summary: z.string().trim().optional().default(""),
  language: z.enum(["es", "en", "mixed", "unknown"]).catch("unknown"),
  corrections: z.array(mechanicalCorrectionSchema).catch([]),
  uncertain: z.array(uncertainCorrectionSchema).catch([]),
});

const legacySuggestionSchema = z.object({
  title: z.string().trim().min(1).catch(""),
  reason: z.string().trim().min(1).catch(""),
  originalText: z.string().trim().min(1).catch(""),
  replacementText: z.string().trim().min(1).catch(""),
});

const legacyChecklistItemSchema = z.object({
  label: z.string().trim().min(1).catch(""),
  detail: z.string().trim().min(1).catch(""),
  targetText: z.string().trim().max(120).optional().nullable().catch(null),
});

export const legacyPublicationReviewContractSchema = z.object({
  summary: z.string().trim().optional().default(""),
  spelling: z.array(legacySuggestionSchema).catch([]),
  rewriting: z.array(legacySuggestionSchema).catch([]),
  checklist: z.array(legacyChecklistItemSchema).catch([]),
});

export type MechanicalCorrectionsContract = z.infer<typeof mechanicalCorrectionsContractSchema>;

export type LegacyPublicationReviewContract = z.infer<typeof legacyPublicationReviewContractSchema>;

export type LegacyPublicationReviewShape = {
  summary: string | null;
  suggestions: PublicationSuggestion[];
  checklist: PublicationChecklistItem[];
};

export type AdaptedCorrectionsContract = {
  canonical: MechanicalCorrectionsContract;
  legacy: LegacyPublicationReviewShape;
};

const isCanonicalContract = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.corrections) || Array.isArray(candidate.uncertain) || "language" in candidate;
};

const toSuggestionKind = (type: z.infer<typeof mechanicalCorrectionTypeSchema>): PublicationSuggestionKind =>
  type === "basic_redaction"
    ? "rewriting"
    : type === "grammar"
      ? "grammar"
      : type === "punctuation"
        ? "punctuation"
        : "spelling";

const hashCorrectionIdPart = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
};

const correctionTitle = (correction: z.infer<typeof mechanicalCorrectionSchema>) => {
  switch (correction.type) {
    case "accent":
      return "Fix accent";
    case "agreement":
      return "Fix agreement";
    case "punctuation":
      return "Fix punctuation";
    case "duplication":
      return "Remove duplicate";
    case "spacing":
      return "Fix spacing";
    case "grammar":
      return "Fix grammar";
    case "basic_redaction":
      return "Repair phrase";
    case "spelling":
    default:
      return "Fix spelling";
  }
};

const toPublicationSuggestions = (
  kind: PublicationSuggestionKind,
  items: LegacyPublicationReviewContract["spelling"],
): PublicationSuggestion[] =>
  items
    .filter(
      (item) =>
        item.title.trim().length > 0 &&
        item.reason.trim().length > 0 &&
        item.originalText.trim().length > 0 &&
        item.replacementText.trim().length > 0,
    )
    .map((item, index) => ({
      id: `${kind}-${index + 1}`,
      kind,
      title: item.title,
      reason: item.reason,
      original_text: item.originalText,
      replacement_text: item.replacementText,
      context_before: null,
      context_after: null,
      status: "pending",
    }));

const toChecklistItems = (items: LegacyPublicationReviewContract["checklist"]): PublicationChecklistItem[] =>
  items
    .filter((item) => item.label.trim().length > 0 && item.detail.trim().length > 0)
    .map((item, index) => ({
      id: `checklist-${index + 1}`,
      label: item.label,
      detail: item.detail,
      target_text: item.targetText ?? null,
      status: "pending",
    }));

const canonicalToLegacy = (canonical: MechanicalCorrectionsContract): LegacyPublicationReviewShape => {
  const suggestionCounts = new Map<string, number>();

  const suggestions = canonical.corrections
    .filter(
      (correction) =>
        correction.originalText.trim().length > 0 &&
        correction.replacementText.trim().length > 0,
    )
    .map((correction) => {
      const kind = toSuggestionKind(correction.type);
      const correctionFingerprint = createCorrectionFingerprint(correction);
      const occurrence = suggestionCounts.get(correctionFingerprint) ?? 0;
      suggestionCounts.set(correctionFingerprint, occurrence + 1);
      const id = [
        "correction",
        correction.blockId,
        hashCorrectionIdPart(correction.originalText),
        hashCorrectionIdPart(correction.replacementText),
        occurrence,
      ].join(":");

      return {
        id,
        kind,
        mechanical_type: correction.type,
        title: correctionTitle(correction),
        reason: "",
        original_text: correction.originalText,
        replacement_text: correction.replacementText,
        context_before: null,
        context_after: null,
        occurrence,
        block_id: correction.blockId,
        correction_fingerprint: correctionFingerprint,
        status: "pending",
      } satisfies PublicationSuggestion;
    });

  const checklist = canonical.uncertain
    .filter((item) => item.text.trim().length > 0 && item.reason.trim().length > 0)
    .map((item, index) => ({
      id: `uncertain-${index + 1}`,
      label: "Review uncertain text",
      detail: item.reason,
      target_text: item.text,
      status: "pending",
    } satisfies PublicationChecklistItem));

  return {
    summary: canonical.summary || null,
    suggestions,
    checklist,
  };
};

const legacyToCanonical = (legacy: LegacyPublicationReviewContract): MechanicalCorrectionsContract => {
  const corrections = [
    ...legacy.spelling.map((item) => ({ ...item, type: "spelling" as const })),
    ...legacy.rewriting.map((item) => ({ ...item, type: "basic_redaction" as const })),
  ]
    .filter(
      (item) =>
        item.originalText.trim().length > 0 &&
        item.replacementText.trim().length > 0,
    )
    .map((item) => ({
      blockId: "legacy-publication-review",
      type: item.type,
      severity: "low" as const,
      confidence: "medium" as const,
      originalText: item.originalText,
      replacementText: item.replacementText,
      reason: item.reason,
    }));

  const uncertain = legacy.checklist
    .filter((item) => item.targetText?.trim() && item.detail.trim().length > 0)
    .map((item) => ({
      blockId: "legacy-publication-review",
      text: item.targetText ?? "",
      reason: item.detail,
      possibleReplacement: null,
    }));

  return mechanicalCorrectionsContractSchema.parse({
    summary: legacy.summary,
    language: "unknown",
    corrections,
    uncertain,
  });
};

// Temporary migration boundary for ODE-154. Remove this module after every
// publication-review consumer reads MechanicalCorrectionsContract directly.
export const adaptCorrectionsContract = (value: unknown): AdaptedCorrectionsContract => {
  if (isCanonicalContract(value)) {
    const canonical = mechanicalCorrectionsContractSchema.parse(value);
    return {
      canonical,
      legacy: canonicalToLegacy(canonical),
    };
  }

  const legacyContract = legacyPublicationReviewContractSchema.parse(value);
  const canonical = legacyToCanonical(legacyContract);

  return {
    canonical,
    legacy: {
      summary: legacyContract.summary || null,
      suggestions: [
        ...toPublicationSuggestions("spelling", legacyContract.spelling),
        ...toPublicationSuggestions("rewriting", legacyContract.rewriting),
      ],
      checklist: toChecklistItems(legacyContract.checklist),
    },
  };
};

export const adaptCanonicalCorrectionsToPublicationReview = (
  canonical: MechanicalCorrectionsContract,
): LegacyPublicationReviewShape => adaptCorrectionsContract(canonical).legacy;
