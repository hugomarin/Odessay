const CONTROL_CHAR_CODE_MAX = 0x1f
const DEL_CHAR_CODE = 0x7f

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= CONTROL_CHAR_CODE_MAX || code === DEL_CHAR_CODE) {
      return true
    }
  }
  return false
}

const BACKSLASH_PATTERN = /\\/

function pathnamePortion(candidate: string): string {
  const queryOrHashIndex = candidate.search(/[?#]/)
  return queryOrHashIndex === -1 ? candidate : candidate.slice(0, queryOrHashIndex)
}

/**
 * ODE-525 — the one validator for every post-auth "next" destination in this
 * app: auth confirmation, the malformed-email-link middleware recovery path,
 * the sign-in/sign-up form, and every emailRedirectTo builder. Each of those
 * used to carry its own string-prefix check (starts with "/", not "//", no
 * "://") and all shared the same gap: the WHATWG URL parser treats a
 * backslash as a path separator for http(s) schemes, so a value like
 * "/\attacker.invalid" satisfies that kind of check yet resolves off-origin
 * once handed to `new URL()`.
 *
 * The actual security boundary is requiring the resolved origin to equal
 * the trusted one exactly (requirement 1) — parsing the candidate for real
 * and comparing origins survives backslash, encoded-backslash, and any other
 * parser-normalization technique without needing to enumerate each one. The
 * syntactic checks below reject the specific forbidden forms up front
 * (requirement 2) as defense in depth, before the parser ever sees them.
 */
export function sanitizeAuthRedirectPath(
  candidate: string | null | undefined,
  appOrigin: string,
  fallback = "/desk",
): string {
  if (!candidate) return fallback
  if (hasControlCharacter(candidate)) return fallback
  if (BACKSLASH_PATTERN.test(candidate)) return fallback

  const pathname = pathnamePortion(candidate)
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("://")) {
    return fallback
  }

  let trustedOrigin: string
  try {
    trustedOrigin = new URL(appOrigin).origin
  } catch {
    return fallback
  }

  let resolved: URL
  try {
    resolved = new URL(candidate, trustedOrigin)
  } catch {
    return fallback
  }

  if (resolved.origin !== trustedOrigin) return fallback
  if (resolved.username || resolved.password) return fallback
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return fallback

  // Normalize only now that validation has passed, and keep query/hash
  // explicit rather than trusting the raw candidate string verbatim.
  return `${resolved.pathname}${resolved.search}${resolved.hash}`
}
