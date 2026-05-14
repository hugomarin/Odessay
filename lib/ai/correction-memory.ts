import type { CanonicalCorrection } from "@/lib/ai/corrections";

export type CorrectionDecision = "accepted" | "rejected";

export type CorrectionMemoryEntry = {
  fingerprint: string;
  decision: CorrectionDecision;
  decidedAt: string;
};

export type CorrectionMemory = {
  entries: CorrectionMemoryEntry[];
};

const normalizeFingerprintPart = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export const createCorrectionFingerprint = (
  correction: Pick<CanonicalCorrection, "blockId" | "originalText" | "replacementText" | "type">,
) =>
  [
    normalizeFingerprintPart(correction.blockId),
    correction.type,
    normalizeFingerprintPart(correction.originalText),
    normalizeFingerprintPart(correction.replacementText),
  ].join("|");

export const filterCorrectionsByMemory = (
  corrections: CanonicalCorrection[],
  memory: CorrectionMemory | null | undefined,
) => {
  const rejected = new Set(
    (memory?.entries ?? [])
      .filter((entry) => entry.decision === "rejected")
      .map((entry) => entry.fingerprint),
  );

  if (rejected.size === 0) {
    return corrections;
  }

  return corrections.filter((correction) => !rejected.has(createCorrectionFingerprint(correction)));
};
