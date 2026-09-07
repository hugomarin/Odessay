/**
 * ODE-225: Desktop bundle — AI proxy routing validation.
 *
 * Verifies that the desktop AI adapter routes all inference through the
 * authenticated web AI proxy (NEXT_PUBLIC_APP_URL) rather than calling
 * provider APIs directly. This satisfies the architecture invariant that
 * provider API keys never ship in the desktop bundle.
 *
 * Runtime validation (AI title suggestions and publication review return
 * responses in ≤10s from the DMG) is covered by the semi-manual checklist:
 * docs/desktop-distribution.md §AI capabilities.
 */
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

const root = resolve(process.cwd())
const desktopAiService = resolve(root, "lib/services/desktop-ai-service.ts")

const PROVIDER_SDK_PATTERNS = [
  /from ['"]openai['"]/,
  /from ['"]@anthropic-ai/,
  /from ['"]@google\/generative-ai['"]/,
  /from ['"]cohere/,
  /OPENAI_API_KEY/,
  /ANTHROPIC_API_KEY/,
  /GOOGLE_API_KEY/,
]

describe("desktop AI proxy — routing contract", () => {
  it("desktop-ai-service.ts exists", () => {
    expect(existsSync(desktopAiService)).toBe(true)
  })

  it("routes requests through NEXT_PUBLIC_APP_URL (web proxy), not a hardcoded URL", () => {
    const src = readFileSync(desktopAiService, "utf8")
    expect(src).toMatch(/NEXT_PUBLIC_APP_URL/)
    // Must not hardcode a specific domain
    expect(src).not.toMatch(/https:\/\/api\.openai\.com/)
    expect(src).not.toMatch(/https:\/\/api\.anthropic\.com/)
  })

  it("does not import any LLM provider SDK", () => {
    const src = readFileSync(desktopAiService, "utf8")
    for (const pattern of PROVIDER_SDK_PATTERNS) {
      expect(src).not.toMatch(pattern)
    }
  })

  it("attaches a Bearer token from the desktop Supabase session on AI requests", () => {
    const src = readFileSync(desktopAiService, "utf8")
    // Must retrieve a bearer token and attach it
    const hasBearerFn = src.includes("getBearerToken") || src.includes("bearerToken") || src.includes("Bearer ")
    const hasAuthHeader =
      src.includes("Authorization") ||
      src.includes("authorization") ||
      src.includes("Bearer ")
    expect(hasBearerFn).toBe(true)
    expect(hasAuthHeader).toBe(true)
  })

  it("uses createDesktopClient to obtain the session (not createBrowserClient)", () => {
    const src = readFileSync(desktopAiService, "utf8")
    expect(src).toMatch(/createDesktopClient/)
    expect(src).not.toMatch(/createBrowserClient/)
  })

  it("covers the AI endpoints: title-suggestions, publication-review, workspace classification, corrections", () => {
    const src = readFileSync(desktopAiService, "utf8")
    expect(src).toMatch(/title-suggestions/)
    expect(src).toMatch(/publication-review/)
    expect(src).toMatch(/workspace-classification/)
    expect(src).toMatch(/corrections/)
  })
})
