import type { PublicationSuggestion } from "@/lib/local-db/schema";

type SuggestionUpdater = (current: PublicationSuggestion[]) => PublicationSuggestion[];

export const createCorrectionSuggestionBatcher = (
  commit: (updater: SuggestionUpdater) => void,
  delayMs = 75,
) => {
  let queuedUpdaters: SuggestionUpdater[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (queuedUpdaters.length === 0) {
      return;
    }

    const pending = queuedUpdaters;
    queuedUpdaters = [];

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    commit((current) => pending.reduce((next, updater) => updater(next), current));
  };

  return {
    enqueue(updater: SuggestionUpdater) {
      queuedUpdaters.push(updater);

      if (timer) {
        return;
      }

      timer = setTimeout(() => {
        timer = null;
        flush();
      }, delayMs);
    },
    flush,
    clear() {
      queuedUpdaters = [];

      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
};
