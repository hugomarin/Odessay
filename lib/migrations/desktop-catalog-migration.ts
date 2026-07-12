import {
  listLocalDBScopes,
  readScopeSnapshot,
  setLocalDBReadOnly,
} from "@/lib/local-db"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import {
  tauriCatalogDualWrite,
  tauriSettingsRead,
  tauriSettingsWrite,
} from "@/lib/services/desktop/tauri-commands"
import {
  identityManifestReconciler,
  migrateIndexedDbToSqlite,
  type CatalogMigrationSink,
  type MigrationCheckpoint,
  type MigrationCheckpointStore,
  type MigrationScopeReader,
  type MigrationSummary,
  type MigrationTelemetryEvent,
} from "@/lib/migrations/indexeddb-to-sqlite"

/**
 * Production wiring for the ODE-376 M5 migration. Assembles the injected ports —
 * scope reader (IndexedDB), SQLite sink (Tauri catalog command), checkpoint store
 * (tauri-plugin-store), single fan-out emitter — and runs the pipeline once. On
 * success it engages the desktop IndexedDB read-only latch so the compatibility
 * window begins (requirement 7). The manifest reconciler default preserves each
 * record's UUID (requirement 4); a richer DocumentBindingStore reconciler is a
 * follow-up (ODE-374) and is not required to preserve local-only identity here.
 */

const CHECKPOINT_KEY = "desktop_indexeddb_sqlite_migration_v1"

let runnerPromise: Promise<MigrationSummary> | null = null

function logTelemetry(event: MigrationTelemetryEvent): void {
  if (process.env.NODE_ENV === "test") return
  // eslint-disable-next-line no-console
  console.info("[migration:indexeddb-sqlite]", event)
}

function buildCheckpointStore(configDir: string): MigrationCheckpointStore {
  return {
    async load() {
      try {
        const raw = await tauriSettingsRead(configDir, CHECKPOINT_KEY)
        return (raw as MigrationCheckpoint | null) ?? null
      } catch {
        return null
      }
    },
    async save(checkpoint) {
      await tauriSettingsWrite(configDir, CHECKPOINT_KEY, checkpoint)
    },
  }
}

export type DesktopCatalogMigrationRuntime = {
  configDir: string
  dbPath: string
}

export async function runDesktopCatalogMigration(
  runtime: DesktopCatalogMigrationRuntime,
): Promise<MigrationSummary> {
  const reader: MigrationScopeReader = {
    listScopes: (seed) => listLocalDBScopes(seed),
    readScope: (scope) => readScopeSnapshot(scope),
  }

  const sink: CatalogMigrationSink = {
    commit: (input) => tauriCatalogDualWrite(runtime.dbPath, input),
  }

  const catalog = new SqliteDocumentCatalog(runtime.dbPath)

  const summary = await migrateIndexedDbToSqlite({
    reader,
    sink,
    reconciler: identityManifestReconciler,
    checkpoint: buildCheckpointStore(runtime.configDir),
    telemetry: logTelemetry,
    onBatchComplete: (documentIds) => catalog.notifyMigration(documentIds),
  })

  // Begin the read-only compatibility window only after a clean, verified run.
  // Old IndexedDB stores are never deleted here (requirement 8/10).
  setLocalDBReadOnly(true)

  return summary
}

/**
 * Single-flight wrapper used by the desktop DocumentService: the migration runs
 * at most once per process and a restart resumes from its checkpoint.
 */
export function runDesktopCatalogMigrationOnce(
  runtime: DesktopCatalogMigrationRuntime,
): Promise<MigrationSummary> {
  if (!runnerPromise) {
    runnerPromise = runDesktopCatalogMigration(runtime).catch((error) => {
      runnerPromise = null
      throw error
    })
  }
  return runnerPromise
}
