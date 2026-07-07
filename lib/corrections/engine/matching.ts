export type TokenMatch = { start: number; end: number }

export const TOKEN_CHAR_PATTERN = /[\p{L}\p{N}\p{M}'’-]/u

const normalizeSearchValue = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .trim()

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const buildLooseContextPattern = (value: string) => {
  const normalized = normalizeSearchValue(value)

  if (!normalized) {
    return null
  }

  const tokens = normalized.split(/\s+/).filter(Boolean)

  if (tokens.length === 0) {
    return null
  }

  return new RegExp(tokens.map((token) => escapeRegex(token)).join("\\s+"), "i")
}

const isTokenChar = (value: string) => TOKEN_CHAR_PATTERN.test(value)

const hasTokenBoundaries = (source: string, start: number, end: number) => {
  const previousChar = start > 0 ? source[start - 1] : ""
  const nextChar = source[end] ?? ""

  return (previousChar.length === 0 || !isTokenChar(previousChar)) && (nextChar.length === 0 || !isTokenChar(nextChar))
}

const isRedundantCorrectionMatch = (
  source: string,
  match: TokenMatch,
  originalText: string,
  replacementText: string,
) => {
  const normalizedOriginal = normalizeSearchValue(originalText)
  const normalizedReplacement = normalizeSearchValue(replacementText)

  if (!normalizedOriginal || !normalizedReplacement) {
    return false
  }

  if (
    normalizedReplacement === normalizedOriginal ||
    normalizedReplacement.length < normalizedOriginal.length
  ) {
    return false
  }

  return source.slice(match.start, match.start + normalizedReplacement.length) === normalizedReplacement
}

const collectTokenBoundaryMatches = (
  source: string,
  originalText: string,
  replacementText: string,
) => {
  const normalizedOriginal = normalizeSearchValue(originalText)

  if (!normalizedOriginal) {
    return []
  }

  const matches: TokenMatch[] = []
  let cursor = 0

  while (cursor <= source.length - normalizedOriginal.length) {
    const index = source.indexOf(normalizedOriginal, cursor)

    if (index === -1) {
      break
    }

    const match = { start: index, end: index + normalizedOriginal.length }

    if (
      hasTokenBoundaries(source, match.start, match.end) &&
      !isRedundantCorrectionMatch(source, match, originalText, replacementText)
    ) {
      matches.push(match)
    }

    cursor = index + normalizedOriginal.length
  }

  return matches
}

export const countTokenBoundaryMatchesBefore = (
  source: string,
  originalText: string,
  endIndex: number,
) => collectTokenBoundaryMatches(source, originalText, originalText).filter((match) => match.start < endIndex).length

export const findTokenBoundaryMatch = (
  source: string,
  originalText: string,
  replacementText: string,
  contextBefore?: string | null,
  contextAfter?: string | null,
  occurrence?: number | null,
): TokenMatch | null => {
  const matches = collectTokenBoundaryMatches(source, originalText, replacementText)

  if (matches.length === 0) {
    return null
  }

  if (typeof occurrence === "number") {
    return occurrence >= 0 && occurrence < matches.length ? matches[occurrence] : null
  }

  if (matches.length === 1) {
    return matches[0]
  }

  const beforePattern = buildLooseContextPattern(contextBefore ?? "")
  const afterPattern = buildLooseContextPattern(contextAfter ?? "")

  if (!beforePattern && !afterPattern) {
    return matches[0]
  }

  return (
    matches.find((match) => {
      const beforeWindow = source.slice(Math.max(0, match.start - 160), match.start)
      const afterWindow = source.slice(match.end, Math.min(source.length, match.end + 160))

      if (beforePattern && !beforePattern.test(beforeWindow)) {
        return false
      }

      if (afterPattern && !afterPattern.test(afterWindow)) {
        return false
      }

      return true
    }) ?? null
  )
}
