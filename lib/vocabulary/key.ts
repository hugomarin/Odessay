/**
 * Derives the stable slug portion of a custom vocabulary item's `key` from
 * its display name. Not specified by the ODE-472 brief; both the web adapter
 * (`lib/vocabulary/server.ts`) and the desktop adapter
 * (`lib/services/desktop/desktop-settings-service.ts`) share this so a name
 * like "Research" produces the same key shape on both runtimes.
 */
export function slugifyVocabularyName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return base.length > 0 ? base.slice(0, 48) : "item"
}
