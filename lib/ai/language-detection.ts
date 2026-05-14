export type CorrectionLanguage = "es" | "en" | "mixed" | "unknown";

const SPANISH_MARKERS = [
  "á",
  "é",
  "í",
  "ó",
  "ú",
  "ñ",
  "¿",
  "¡",
  " que ",
  " de ",
  " la ",
  " el ",
  " los ",
  " las ",
  " una ",
  " para ",
  " con ",
  " porque ",
  " también ",
  " esta ",
  " carta ",
  " tiene ",
];

const ENGLISH_MARKERS = [
  " the ",
  " and ",
  " that ",
  " this ",
  " with ",
  " for ",
  " because ",
  " writing ",
  " would ",
  " should ",
  " have ",
];

const countMarkers = (normalizedText: string, markers: string[]) =>
  markers.reduce((count, marker) => count + (normalizedText.includes(marker) ? 1 : 0), 0);

export const detectCorrectionLanguage = (text: string): CorrectionLanguage => {
  const compact = text.trim();

  if (!compact) {
    return "unknown";
  }

  const normalized = ` ${compact.toLowerCase()} `;
  const spanishScore = countMarkers(normalized, SPANISH_MARKERS);
  const englishScore = countMarkers(normalized, ENGLISH_MARKERS);

  if (spanishScore >= 2 && englishScore >= 2) {
    return "mixed";
  }

  if (spanishScore >= 2) {
    return "es";
  }

  if (englishScore >= 2) {
    return "en";
  }

  if (/[áéíóúñ¿¡]/i.test(compact)) {
    return "es";
  }

  return "unknown";
};
