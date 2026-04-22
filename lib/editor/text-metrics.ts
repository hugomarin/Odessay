export type TextMetrics = {
  words: number;
  characters: number;
  sentences: number;
  readingTimeMinutes: number;
  pages: number;
};

export type SelectionMetrics = {
  words: number;
  characters: number;
};

const SENTENCE_END_REGEX = /[.!?]+(?=\s|$)/g;

export const calculateTextMetrics = (text: string): TextMetrics => {
  const normalized = text.trim();

  if (!normalized) {
    return {
      words: 0,
      characters: 0,
      sentences: 0,
      readingTimeMinutes: 0,
      pages: 0,
    };
  }

  const words = normalized.split(/\s+/).filter(Boolean).length;
  const characters = text.length;
  const sentences = (normalized.match(SENTENCE_END_REGEX) ?? []).length;
  const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));
  const pages = Number((words / 250).toFixed(1));

  return {
    words,
    characters,
    sentences,
    readingTimeMinutes,
    pages,
  };
};

export const calculateSelectionMetrics = (text: string): SelectionMetrics => {
  const normalized = text.trim();

  if (!normalized) {
    return { words: 0, characters: 0 };
  }

  const words = normalized.split(/\s+/).filter(Boolean).length;
  const characters = text.length;

  return { words, characters };
};
