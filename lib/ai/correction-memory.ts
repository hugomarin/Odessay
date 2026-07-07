import type { CanonicalCorrection } from "@/lib/ai/corrections";
import {
  createStableFingerprint,
  stableFingerprintFromStoredFingerprint,
} from "@/lib/corrections/engine/identity";

export type CorrectionDecision = "accepted" | "rejected";

export type CorrectionMemoryEntry = {
  fingerprint: string;
  decision: CorrectionDecision;
  decidedAt: string;
};

export type CorrectionMemory = {
  entries: CorrectionMemoryEntry[];
};

export const createCorrectionFingerprint = (
  correction: Pick<CanonicalCorrection, "blockId" | "originalText" | "replacementText" | "type">,
) => createStableFingerprint(correction);

export const filterCorrectionsByMemory = (
  corrections: CanonicalCorrection[],
  memory: CorrectionMemory | null | undefined,
) => {
  const rejected = new Set(
    (memory?.entries ?? [])
      .filter((entry) => entry.decision === "rejected")
      .map((entry) => stableFingerprintFromStoredFingerprint(entry.fingerprint))
      .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
  );

  if (rejected.size === 0) {
    return corrections;
  }

  return corrections.filter((correction) => !rejected.has(createCorrectionFingerprint(correction)));
};
