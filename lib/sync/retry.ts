const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_ACTIVE_RETRIES = 10;

export const getRetryDelayMs = (attempt: number) => {
  if (attempt <= 0) {
    return 0;
  }

  return Math.min(2 ** attempt * 1000, MAX_RETRY_DELAY_MS);
};

export const getNextRetryAt = (attempt: number) => Date.now() + getRetryDelayMs(attempt);

export const canRetryMutation = (attempt: number) => attempt < MAX_ACTIVE_RETRIES;

export { MAX_ACTIVE_RETRIES };
