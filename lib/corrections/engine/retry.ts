import type { ServiceError } from "@/lib/services/contracts/service-types";

export const CORRECTION_REVIEW_MAX_RETRIES = 1;
export const CORRECTION_REVIEW_RETRY_DELAY_MS = 1_500;

export type CorrectionReviewRetryDecision =
  | {
      action: "retry";
      attempt: number;
      delayMs: number;
    }
  | {
      action: "fail";
      attempt: number;
      message: string;
    };

export const buildCorrectionReviewRetryKey = (
  blocks: Array<{ id: string; hash: string }>,
) => blocks.map((block) => `${block.id}:${block.hash}`).join("|");

export function decideCorrectionReviewRetry({
  error,
  previousAttempts,
  maxRetries = CORRECTION_REVIEW_MAX_RETRIES,
  delayMs = CORRECTION_REVIEW_RETRY_DELAY_MS,
}: {
  error: ServiceError | null | undefined;
  previousAttempts: number;
  maxRetries?: number;
  delayMs?: number;
}): CorrectionReviewRetryDecision {
  const nextAttempt = previousAttempts + 1;

  if (error?.retryable && previousAttempts < maxRetries) {
    return {
      action: "retry",
      attempt: nextAttempt,
      delayMs: delayMs * nextAttempt,
    };
  }

  return {
    action: "fail",
    attempt: previousAttempts,
    message: error?.message ?? "Could not review corrections right now.",
  };
}
