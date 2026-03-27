export type EditorSpellcheckPreference = "system" | "off"

export type EditorSpellcheckConfig = {
  enabled: boolean
  autoCorrect: "on" | "off"
  autoCapitalize: "on" | "off"
  language: string
}

export const DEFAULT_EDITOR_SPELLCHECK_LANGUAGE = "es-MX"
const EDITOR_SPELLCHECK_STORAGE_KEY = "odessay-editor-spellcheck"

const normalizeLanguageTag = (value: string) => value.trim().toLowerCase().replace(/_/g, "-")

export const resolveSpellcheckLanguage = (languageCandidates?: readonly string[]) => {
  const candidates = languageCandidates?.length
    ? languageCandidates
    : typeof navigator !== "undefined"
      ? navigator.languages.length
        ? navigator.languages
        : [navigator.language]
      : []

  const normalizedCandidates = candidates.map(normalizeLanguageTag)

  if (normalizedCandidates.some((candidate) => candidate === "es-mx" || candidate.startsWith("es-mx-"))) {
    return "es-MX"
  }

  if (normalizedCandidates.some((candidate) => candidate.startsWith("es"))) {
    return "es"
  }

  if (normalizedCandidates.some((candidate) => candidate.startsWith("en"))) {
    return "en"
  }

  return DEFAULT_EDITOR_SPELLCHECK_LANGUAGE
}

const getStorageKey = (scope: string) => `${EDITOR_SPELLCHECK_STORAGE_KEY}:${scope}`

export const readEditorSpellcheckPreference = (scope: string): EditorSpellcheckPreference => {
  if (typeof window === "undefined") {
    return "system"
  }

  const persistedValue = window.localStorage.getItem(getStorageKey(scope))

  return persistedValue === "off" ? "off" : "system"
}

export const persistEditorSpellcheckPreference = (scope: string, preference: EditorSpellcheckPreference) => {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(getStorageKey(scope), preference)
}

export const buildEditorSpellcheckConfig = (
  preference: EditorSpellcheckPreference,
  languageCandidates?: readonly string[],
): EditorSpellcheckConfig => {
  const enabled = preference === "system"

  return {
    enabled,
    autoCorrect: enabled ? "on" : "off",
    autoCapitalize: enabled ? "on" : "off",
    language: resolveSpellcheckLanguage(languageCandidates),
  }
}
