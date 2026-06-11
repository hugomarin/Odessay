/**
 * ODE-225: Desktop bundle — auth token persistence validation.
 *
 * Verifies that the desktop auth stack is configured to persist session
 * tokens correctly using tauri-plugin-store (not macOS Keychain, which
 * is incompatible with ad-hoc signing — see odessay-desktop-target-architecture.md
 * §Storage de tokens en desktop).
 *
 * Runtime validation (sign-in → close → reopen → session restored) is
 * covered by the semi-manual checklist: docs/desktop-distribution.md §Auth & session persistence.
 */
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

const root = resolve(process.cwd())
const cargoToml = resolve(root, "src-tauri/Cargo.toml")
const desktopAuthService = resolve(root, "lib/services/desktop-auth-service.ts")
const desktopClient = resolve(root, "lib/supabase/desktop-client.ts")

describe("desktop auth persistence — storage configuration", () => {
  it("tauri-plugin-store is present in Cargo.toml", () => {
    expect(existsSync(cargoToml)).toBe(true)
    const cargo = readFileSync(cargoToml, "utf8")
    expect(cargo).toMatch(/tauri-plugin-store/)
  })

  it("desktop-auth-service.ts exists", () => {
    expect(existsSync(desktopAuthService)).toBe(true)
  })

  it("desktop-auth-service.ts uses keychainStorage (tauri-plugin-store adapter)", () => {
    const src = readFileSync(desktopAuthService, "utf8")
    expect(src).toMatch(/keychainStorage/)
  })

  it("desktop-auth-service.ts does NOT import @supabase/ssr", () => {
    const src = readFileSync(desktopAuthService, "utf8")
    expect(src).not.toMatch(/@supabase\/ssr/)
  })

  it("desktop-auth-service.ts uses createDesktopClient (not createBrowserClient)", () => {
    const src = readFileSync(desktopAuthService, "utf8")
    expect(src).toMatch(/createDesktopClient/)
    expect(src).not.toMatch(/createBrowserClient/)
  })

  it("desktop-client.ts exists (Supabase singleton for desktop)", () => {
    expect(existsSync(desktopClient)).toBe(true)
  })

  it("desktop-client.ts imports from @supabase/supabase-js (not @supabase/ssr)", () => {
    const src = readFileSync(desktopClient, "utf8")
    // Must import from supabase-js
    expect(src).toMatch(/from ['"]@supabase\/supabase-js['"]/)
    // Must not have an import statement from @supabase/ssr
    expect(src).not.toMatch(/import .* from ['"]@supabase\/ssr['"]/)
  })

  it("desktop-client.ts sets detectSessionInUrl: false (email callbacks are web-only)", () => {
    const src = readFileSync(desktopClient, "utf8")
    expect(src).toMatch(/detectSessionInUrl\s*:\s*false/)
  })
})
