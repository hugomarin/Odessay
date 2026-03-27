import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildEditorSpellcheckConfig,
  persistEditorSpellcheckPreference,
  readEditorSpellcheckPreference,
  resolveSpellcheckLanguage,
} from "@/lib/editor/spellcheck"

type MemoryStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const createMemoryStorage = (): MemoryStorage => {
  const store = new Map<string, string>()

  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
  }
}

describe("editor spellcheck helpers", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage(),
    })
  })

  it("uses es-MX as default language when no browser hints exist", () => {
    expect(resolveSpellcheckLanguage([])).toBe("es-MX")
  })

  it("falls back to generic Spanish when es-MX is not present", () => {
    expect(resolveSpellcheckLanguage(["fr-FR", "es-AR"])).toBe("es")
  })

  it("falls back to English when Spanish hints are unavailable", () => {
    expect(resolveSpellcheckLanguage(["de-DE", "en-US"])).toBe("en")
  })

  it("prioritizes es-MX over other language hints", () => {
    expect(resolveSpellcheckLanguage(["en-US", "es-MX", "es-ES"])).toBe("es-MX")
  })

  it("persists and restores preference scoped by user scope", () => {
    expect(readEditorSpellcheckPreference("user-a")).toBe("system")

    persistEditorSpellcheckPreference("user-a", "off")

    expect(readEditorSpellcheckPreference("user-a")).toBe("off")
    expect(readEditorSpellcheckPreference("user-b")).toBe("system")
  })

  it("builds a disabled config when preference is off", () => {
    const config = buildEditorSpellcheckConfig("off", ["es-MX"])

    expect(config.enabled).toBe(false)
    expect(config.autoCorrect).toBe("off")
    expect(config.autoCapitalize).toBe("off")
    expect(config.language).toBe("es-MX")
  })
})
