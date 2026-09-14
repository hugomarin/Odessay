import { describe, expect, it } from "vitest"
import { sanitizeAuthRedirectPath } from "@/lib/auth/redirect"

const appOrigin = "https://app.odessay.com"

describe("sanitizeAuthRedirectPath", () => {
  it.each([
    ["/desk", "/desk"],
    ["/reset-password", "/reset-password"],
    ["/settings/account", "/settings/account"],
    ["/write?id=abc-123", "/write?id=abc-123"],
    ["/write?id=abc-123#top", "/write?id=abc-123#top"],
    ["/", "/"],
  ])("preserves the valid internal destination %s", (candidate, expected) => {
    expect(sanitizeAuthRedirectPath(candidate, appOrigin)).toBe(expected)
  })

  it.each([
    [null, "null candidate"],
    [undefined, "undefined candidate"],
    ["", "empty string"],
  ])("falls back to the default for %s (%s)", (candidate: string | null | undefined, _description: string) => {
    expect(sanitizeAuthRedirectPath(candidate, appOrigin)).toBe("/desk")
    expect(sanitizeAuthRedirectPath(candidate, appOrigin, "/custom-fallback")).toBe("/custom-fallback")
  })

  describe("adversarial parser-bypass cases (permanent regressions)", () => {
    const cases: Array<[string, string]> = [
      ["/\\attacker.invalid", "single backslash — WHATWG parser treats it as a path separator"],
      ["/\\\\attacker.invalid", "double backslash"],
      ["/\\/attacker.invalid", "mixed slash/backslash"],
      ["//attacker.invalid", "protocol-relative form"],
      ["///attacker.invalid", "triple-slash protocol-relative form"],
      ["https://attacker.invalid/steal", "absolute external URL"],
      ["http://attacker.invalid/steal", "absolute external URL, http"],
      ["https://user:pass@app.odessay.com/desk", "embedded credentials on the real host"],
      ["https://app.odessay.com:9443/desk", "alternate port on the real host"],
      ["https://app.odessay.com.attacker.invalid/desk", "subdomain confusion"],
      ["https://app.odessay.com@attacker.invalid/desk", "userinfo confusion"],
      ["javascript:alert(document.domain)", "javascript: scheme"],
      ["data:text/html,<script>alert(1)</script>", "data: scheme"],
      ["desk", "missing leading slash"],
      ["/desk\x00.evil", "embedded null byte"],
      ["/desk\t.evil", "embedded tab"],
      ["/desk\n.evil", "embedded newline"],
      ["/desk\r.evil", "embedded carriage return"],
    ]

    it.each(cases)("rejects: %s (%s)", (candidate) => {
      expect(sanitizeAuthRedirectPath(candidate, appOrigin)).toBe("/desk")
    })
  })

  it("rejects an encoded backslash the same as a literal one, matching what URLSearchParams.get() hands the validator", () => {
    // A raw query string of "next=%2F%5Cattacker.invalid" decodes, via
    // URLSearchParams.get(), to the literal string below — this is the form
    // that actually reaches the validator in every real call site.
    const decodedOnceFromQueryString = decodeURIComponent("%2F%5Cattacker.invalid")
    expect(decodedOnceFromQueryString).toBe("/\\attacker.invalid")
    expect(sanitizeAuthRedirectPath(decodedOnceFromQueryString, appOrigin)).toBe("/desk")
  })

  it("keeps a double-encoded backslash on-origin as a literal (harmless) path segment rather than resolving off-origin", () => {
    // A raw query string of "next=%2F%255Cattacker.invalid" decodes once to
    // "/%5Cattacker.invalid" — the percent sign is now a literal character,
    // not a backslash, so the WHATWG URL parser never treats it as a path
    // separator. The origin-equality check (the real security boundary)
    // correctly accepts this as same-origin, unlike the single-decoded case.
    const decodedOnceFromQueryString = decodeURIComponent("%2F%255Cattacker.invalid")
    expect(decodedOnceFromQueryString).toBe("/%5Cattacker.invalid")
    const result = sanitizeAuthRedirectPath(decodedOnceFromQueryString, appOrigin)
    expect(result.startsWith("/")).toBe(true)
    expect(new URL(result, appOrigin).origin).toBe(appOrigin)
  })

  it("uses the provided fallback, never the rejected candidate, when rejecting", () => {
    const result = sanitizeAuthRedirectPath("/\\attacker.invalid", appOrigin, "/settings/account")
    expect(result).toBe("/settings/account")
    expect(result).not.toContain("attacker")
  })

  it("requires an exact origin match — a different scheme on the same host is rejected", () => {
    expect(sanitizeAuthRedirectPath("http://app.odessay.com/desk", "https://app.odessay.com")).toBe("/desk")
  })

  it("normalizes appOrigin (trailing slash) before comparing", () => {
    expect(sanitizeAuthRedirectPath("/desk", "https://app.odessay.com/")).toBe("/desk")
  })

  it("falls back when appOrigin itself is not a valid absolute URL", () => {
    expect(sanitizeAuthRedirectPath("/desk", "not-a-url")).toBe("/desk")
    expect(sanitizeAuthRedirectPath("/desk", "not-a-url", "/fallback")).toBe("/fallback")
  })
})
