const MIN_TITLE_SOURCE_WORDS = 12;
const MAX_TITLE_SOURCE_CHARS = 6000;

export type TitleSuggestionResponse = {
  title: string;
};

const parseTitleSuggestionResponse = (value: unknown): TitleSuggestionResponse => {
  if (!value || typeof value !== "object" || !("title" in value)) {
    throw new Error("Missing title in AI title response.");
  }

  const title = String((value as { title: unknown }).title).trim();

  if (!title || title.length > 120) {
    throw new Error("Invalid title in AI title response.");
  }

  return { title };
};

export const titleSuggestionResponseSchema = {
  parse: parseTitleSuggestionResponse,
  safeParse: (value: unknown) => {
    try {
      return { success: true as const, data: parseTitleSuggestionResponse(value) };
    } catch (error) {
      return { success: false as const, error };
    }
  },
};

export const hasEnoughTitleSuggestionContent = (bodyText: string) =>
  bodyText.trim().split(/\s+/).filter(Boolean).length >= MIN_TITLE_SOURCE_WORDS;

export const buildTitleSuggestionSystemPrompt = () =>
  [
    "You suggest concise writing titles for Odessay.",
    "Return only valid JSON matching {\"title\":\"...\"}.",
    "Do not include markdown fences, explanations, subtitles, or alternatives.",
    "The title must be faithful to the text and suitable for a personal writing draft.",
  ].join(" ");

export const buildTitleSuggestionUserPrompt = ({
  currentTitle,
  bodyText,
}: {
  currentTitle: string;
  bodyText: string;
}) => {
  const source = bodyText.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE_SOURCE_CHARS);

  return [
    `Current title: ${currentTitle.trim() || "Untitled writing"}`,
    "",
    "Writing content:",
    source,
    "",
    "Suggest one improved title. Keep it under 12 words.",
  ].join("\n");
};

export const extractTitleSuggestionJson = (value: string) => {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return value;
  }

  return value.slice(firstBrace, lastBrace + 1);
};
