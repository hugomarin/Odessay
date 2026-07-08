import { describe, expect, it } from "vitest";
import {
  buildCorrectionReviewRetryKey,
  CORRECTION_REVIEW_RETRY_DELAY_MS,
  decideCorrectionReviewRetry,
} from "@/lib/corrections/engine/retry";

describe("correction review retry policy", () => {
  it("builds a stable retry key from block identity and hash", () => {
    expect(buildCorrectionReviewRetryKey([
      { id: "correction-block:a", hash: "hash-a" },
      { id: "correction-block:b", hash: "hash-b" },
    ])).toBe("correction-block:a:hash-a|correction-block:b:hash-b");
  });

  it("allows one delayed retry for retryable correction failures", () => {
    const decision = decideCorrectionReviewRetry({
      error: {
        code: "UNAVAILABLE",
        message: "Provider unavailable.",
        retryable: true,
      },
      previousAttempts: 0,
    });

    expect(decision).toEqual({
      action: "retry",
      attempt: 1,
      delayMs: CORRECTION_REVIEW_RETRY_DELAY_MS,
    });
  });

  it("fails after the retry bound is exhausted", () => {
    const decision = decideCorrectionReviewRetry({
      error: {
        code: "UNAVAILABLE",
        message: "Provider unavailable.",
        retryable: true,
      },
      previousAttempts: 1,
      maxRetries: 1,
    });

    expect(decision).toEqual({
      action: "fail",
      attempt: 1,
      message: "Provider unavailable.",
    });
  });

  it("does not retry non-retryable contract failures", () => {
    const decision = decideCorrectionReviewRetry({
      error: {
        code: "AI_PROVIDER_CONTRACT_ERROR",
        message: "Provider rejected the contract.",
        retryable: false,
      },
      previousAttempts: 0,
    });

    expect(decision).toEqual({
      action: "fail",
      attempt: 0,
      message: "Provider rejected the contract.",
    });
  });
});
