import type { CorrectionLanguage } from "@/lib/ai/language-detection";

export type LearnedWordLanguage = CorrectionLanguage | "unknown";

export type LearnedWordRecord = {
  id: string;
  word: string;
  language: LearnedWordLanguage;
  createdAt: string;
};

const LEARNED_WORD_DIACRITICS_PATTERN = /[\u0300-\u036f]/g;

export const normalizeLearnedWord = (value: string) =>
  value
    .normalize("NFD")
    .replace(LEARNED_WORD_DIACRITICS_PATTERN, "")
    .replace(/[’']/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

export const createLearnedWordSet = (words: Iterable<string>) =>
  new Set(
    [...words]
      .map((word) => normalizeLearnedWord(word))
      .filter((word) => word.length > 0),
  );
