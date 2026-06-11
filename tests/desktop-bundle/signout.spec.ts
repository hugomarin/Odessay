/**
 * ODE-225: Desktop bundle — sign-out implementation validation.
 *
 * Verifies that the desktop sign-out path:
 *   1. Has a timeout to prevent hanging (ODE-238 root cause).
 *   2. Explicitly removes stored tokens after Supabase signOut.
 *   3. Does not leave dangling auth listeners.
 *
 * Runtime validation (sign-out does not hang, app returns to auth screen)
 * is covered by the semi-manual checklist: docs/desktop-distribution.md §Auth & session persistence.
 */
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

const root = resolve(process.cwd())
const desktopAuthService = resolve(root, "lib/services/desktop-auth-service.ts")

describe("desktop sign-out — implementation contract", () => {
  it("desktop-auth-service.ts implements a signOut method", () => {
    expect(existsSync(desktopAuthService)).toBe(true)
    const src = readFileSync(desktopAuthService, "utf8")
    expect(src).toMatch(/signOut\s*\(/)
  })

  it("signOut has a timeout guard to prevent hanging (ODE-238)", () => {
    const src = readFileSync(desktopAuthService, "utf8")
    // Checks for either a numeric timeout value ≥ 5000ms or a named constant
    const hasTimeout =
      src.includes("signOut timeout") ||
      /setTimeout[^)]+[5-9]\d{3,}/.test(src) ||
      /signOut.*timeout|timeout.*signOut/i.test(src)
    expect(hasTimeout).toBe(true)
  })

  it("signOut removes stored tokens via keychainStorage.removeItem", () => {
    const src = readFileSync(desktopAuthService, "utf8")
    expect(src).toMatch(/keychainStorage\.removeItem/)
  })

  it("signOut cleans up the code-verifier key in addition to the main token", () => {
    const src = readFileSync(desktopAuthService, "utf8")
    expect(src).toMatch(/code-verifier/)
  })

  it("desktop-auth-service.ts does not leak auth state listeners (unsubscribes on cleanup)", () => {
    const src = readFileSync(desktopAuthService, "utf8")
    // onAuthStateChange must be paired with an unsubscribe call
    const listenerCount = (src.match(/onAuthStateChange/g) ?? []).length
    const unsubCount = (src.match(/unsubscribe\s*\(\)|\.subscription\.unsubscribe\(\)/g) ?? []).length
    expect(listenerCount).toBeGreaterThan(0)
    expect(unsubCount).toBeGreaterThanOrEqual(listenerCount)
  })
})
