/**
 * M5 cutover flag (ODE-376). Unlike the M4 dual-write flag
 * (`isDesktopCatalogDualWriteEnabled`, which defaults ON), the IndexedDB→SQLite
 * migration is an explicit opt-in: the catalog spec (§IndexedDB · Desktop) allows
 * desktop dual-read and the read-only compatibility latch ONLY behind this
 * explicit flag. It stays OFF by default so this PR ships the migration mechanism
 * without changing the running behavior of web or desktop; turning it on is the
 * release decision, taken once the SQLite read path is proven.
 */
export function isDesktopIndexedDbMigrationEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DESKTOP_INDEXEDDB_MIGRATION === "true"
}
