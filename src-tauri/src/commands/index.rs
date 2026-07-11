use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize, Deserialize)]
pub struct IndexEntry {
    pub path: String,
    pub title: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "modifiedAt")]
    pub modified_at: u64,
}

fn ensure_table(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS writings_index (
            path TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            modified_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("init_index: {e}"))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_writings_modified ON writings_index(modified_at DESC)",
        [],
    )
    .map_err(|e| format!("init_index idx: {e}"))?;

    Ok(())
}

fn open_db(db_path: &str) -> Result<Connection, String> {
    let path = Path::new(db_path);
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
        }
    }
    let conn = Connection::open(db_path).map_err(|e| format!("open_db: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("open_db foreign_keys: {e}"))?;
    ensure_table(&conn)?;
    ensure_catalog_v2(&conn)?;
    Ok(conn)
}

fn ensure_catalog_v2(conn: &Connection) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("catalog migration begin: {e}"))?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS catalog_schema (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            version INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS binding_roots (
            id TEXT PRIMARY KEY,
            root_path TEXT UNIQUE NOT NULL,
            manifest_version INTEGER NOT NULL,
            visible_as_workspace INTEGER NOT NULL DEFAULT 0 CHECK (visible_as_workspace IN (0, 1)),
            last_scanned_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            local_present INTEGER NOT NULL DEFAULT 0 CHECK (local_present IN (0, 1)),
            cloud_present INTEGER NOT NULL DEFAULT 0 CHECK (cloud_present IN (0, 1)),
            cloud_account_id TEXT,
            sync_status TEXT NOT NULL CHECK (sync_status IN ('local-only','pending','synced','conflict','failed','deleted')),
            title_cache TEXT,
            slug_cache TEXT,
            status_cache TEXT,
            artifact_type_cache TEXT,
            visibility_cache TEXT,
            version_cache INTEGER,
            created_at INTEGER,
            modified_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS document_bindings (
            document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
            binding_root_id TEXT NOT NULL REFERENCES binding_roots(id) ON DELETE RESTRICT,
            relative_path TEXT NOT NULL,
            canonical_path TEXT UNIQUE NOT NULL,
            inode INTEGER,
            content_hash TEXT,
            size INTEGER,
            last_seen_at INTEGER,
            UNIQUE(binding_root_id, relative_path)
        );
        CREATE TABLE IF NOT EXISTS sync_mutations (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            operation TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending','processing','synced','failed')),
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_retry_at INTEGER,
            created_at INTEGER NOT NULL,
            last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_catalog_modified ON documents(modified_at DESC);
        CREATE INDEX IF NOT EXISTS idx_catalog_cloud_account ON documents(cloud_account_id, cloud_present);
        CREATE INDEX IF NOT EXISTS idx_catalog_mutations_pending ON sync_mutations(status, next_retry_at);
        INSERT INTO catalog_schema(singleton, version) VALUES (1, 2)
          ON CONFLICT(singleton) DO UPDATE SET version = MAX(version, excluded.version);",
    ).map_err(|e| format!("catalog migration v2: {e}"))?;
    tx.commit()
        .map_err(|e| format!("catalog migration commit: {e}"))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDocumentInput {
    pub id: String,
    pub local_present: bool,
    pub cloud_present: bool,
    pub cloud_account_id: Option<String>,
    pub sync_status: String,
    pub title: Option<String>,
    pub slug: Option<String>,
    pub status: Option<String>,
    pub artifact_type: Option<String>,
    pub visibility: Option<String>,
    pub version: Option<i64>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogBindingInput {
    pub binding_root_id: String,
    pub root_path: String,
    pub manifest_version: i64,
    pub visible_as_workspace: bool,
    pub relative_path: String,
    pub canonical_path: String,
    pub inode: Option<i64>,
    pub content_hash: Option<String>,
    pub size: Option<i64>,
    pub last_seen_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMutationInput {
    pub id: String,
    pub operation: String,
    pub payload_json: String,
    pub status: String,
    pub attempt_count: i64,
    pub next_retry_at: Option<i64>,
    pub created_at: i64,
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDualWriteInput {
    pub document: CatalogDocumentInput,
    pub binding: Option<CatalogBindingInput>,
    pub mutation: Option<CatalogMutationInput>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRow {
    pub id: String,
    pub local_present: bool,
    pub cloud_present: bool,
    pub cloud_account_id: Option<String>,
    pub sync_status: String,
    pub title: Option<String>,
    pub slug: Option<String>,
    pub status: Option<String>,
    pub artifact_type: Option<String>,
    pub visibility: Option<String>,
    pub version: Option<i64>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub binding_root_id: Option<String>,
    pub relative_path: Option<String>,
    pub canonical_path: Option<String>,
    pub inode: Option<i64>,
    pub content_hash: Option<String>,
    pub size: Option<i64>,
    pub last_seen_at: Option<i64>,
}

fn map_catalog_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CatalogRow> {
    Ok(CatalogRow {
        id: row.get(0)?,
        local_present: row.get::<_, i64>(1)? != 0,
        cloud_present: row.get::<_, i64>(2)? != 0,
        cloud_account_id: row.get(3)?,
        sync_status: row.get(4)?,
        title: row.get(5)?,
        slug: row.get(6)?,
        status: row.get(7)?,
        artifact_type: row.get(8)?,
        visibility: row.get(9)?,
        version: row.get(10)?,
        created_at: row.get(11)?,
        modified_at: row.get(12)?,
        binding_root_id: row.get(13)?,
        relative_path: row.get(14)?,
        canonical_path: row.get(15)?,
        inode: row.get(16)?,
        content_hash: row.get(17)?,
        size: row.get(18)?,
        last_seen_at: row.get(19)?,
    })
}

const CATALOG_SELECT: &str = "SELECT d.id,d.local_present,d.cloud_present,d.cloud_account_id,d.sync_status,
 d.title_cache,d.slug_cache,d.status_cache,d.artifact_type_cache,d.visibility_cache,d.version_cache,
 d.created_at,d.modified_at,b.binding_root_id,b.relative_path,b.canonical_path,b.inode,b.content_hash,b.size,b.last_seen_at
 FROM documents d LEFT JOIN document_bindings b ON b.document_id=d.id";

#[tauri::command]
pub fn catalog_schema_version(db_path: String) -> Result<i64, String> {
    let conn = open_db(&db_path)?;
    conn.query_row(
        "SELECT version FROM catalog_schema WHERE singleton=1",
        [],
        |row| row.get(0),
    )
    .map_err(|e| format!("catalog_schema_version: {e}"))
}

#[tauri::command]
pub fn catalog_dual_write(db_path: String, input: CatalogDualWriteInput) -> Result<(), String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog dual-write begin: {e}"))?;
    let d = &input.document;
    tx.execute("INSERT INTO documents(id,local_present,cloud_present,cloud_account_id,sync_status,title_cache,slug_cache,status_cache,artifact_type_cache,visibility_cache,version_cache,created_at,modified_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
      ON CONFLICT(id) DO UPDATE SET local_present=excluded.local_present,cloud_present=excluded.cloud_present,
      cloud_account_id=excluded.cloud_account_id,sync_status=excluded.sync_status,title_cache=excluded.title_cache,
      slug_cache=excluded.slug_cache,status_cache=excluded.status_cache,artifact_type_cache=excluded.artifact_type_cache,
      visibility_cache=excluded.visibility_cache,version_cache=excluded.version_cache,modified_at=excluded.modified_at",
      params![d.id,d.local_present as i64,d.cloud_present as i64,d.cloud_account_id,d.sync_status,d.title,d.slug,d.status,d.artifact_type,d.visibility,d.version,d.created_at,d.modified_at])
      .map_err(|e| format!("catalog dual-write document: {e}"))?;
    if let Some(b) = &input.binding {
        tx.execute("INSERT INTO binding_roots(id,root_path,manifest_version,visible_as_workspace) VALUES(?1,?2,?3,?4)
          ON CONFLICT(id) DO UPDATE SET root_path=excluded.root_path,manifest_version=excluded.manifest_version,visible_as_workspace=excluded.visible_as_workspace",
          params![b.binding_root_id,b.root_path,b.manifest_version,b.visible_as_workspace as i64])
          .map_err(|e| format!("catalog dual-write root: {e}"))?;
        tx.execute("INSERT INTO document_bindings(document_id,binding_root_id,relative_path,canonical_path,inode,content_hash,size,last_seen_at)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
          ON CONFLICT(document_id) DO UPDATE SET binding_root_id=excluded.binding_root_id,relative_path=excluded.relative_path,
          canonical_path=excluded.canonical_path,inode=excluded.inode,content_hash=excluded.content_hash,size=excluded.size,last_seen_at=excluded.last_seen_at",
          params![d.id,b.binding_root_id,b.relative_path,b.canonical_path,b.inode,b.content_hash,b.size,b.last_seen_at])
          .map_err(|e| format!("catalog dual-write binding: {e}"))?;
    }
    if let Some(m) = &input.mutation {
        tx.execute("INSERT INTO sync_mutations(id,document_id,operation,payload_json,status,attempt_count,next_retry_at,created_at,last_error)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
          ON CONFLICT(id) DO UPDATE SET status=excluded.status,attempt_count=excluded.attempt_count,next_retry_at=excluded.next_retry_at,last_error=excluded.last_error",
          params![m.id,d.id,m.operation,m.payload_json,m.status,m.attempt_count,m.next_retry_at,m.created_at,m.last_error])
          .map_err(|e| format!("catalog dual-write mutation: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("catalog dual-write commit: {e}"))
}

#[tauri::command]
pub fn catalog_get_by_id(db_path: String, id: String) -> Result<Option<CatalogRow>, String> {
    let conn = open_db(&db_path)?;
    conn.query_row(
        &format!("{CATALOG_SELECT} WHERE d.id=?1"),
        params![id],
        map_catalog_row,
    )
    .optional()
    .map_err(|e| format!("catalog_get_by_id: {e}"))
}

#[tauri::command]
pub fn catalog_resolve_path(db_path: String, path: String) -> Result<Option<CatalogRow>, String> {
    let conn = open_db(&db_path)?;
    conn.query_row(
        &format!("{CATALOG_SELECT} WHERE b.canonical_path=?1"),
        params![path],
        map_catalog_row,
    )
    .optional()
    .map_err(|e| format!("catalog_resolve_path: {e}"))
}

#[tauri::command]
pub fn catalog_list(
    db_path: String,
    cloud_account_id: Option<String>,
    include_deleted: bool,
    local_only: bool,
    limit: i64,
) -> Result<Vec<CatalogRow>, String> {
    let conn = open_db(&db_path)?;
    let sql = format!("{CATALOG_SELECT} WHERE (?1 OR d.sync_status != 'deleted') AND (?2=0 OR d.local_present=1)
      AND (d.local_present=1 OR d.cloud_account_id IS NULL OR d.cloud_account_id=?3) ORDER BY d.modified_at DESC LIMIT ?4");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("catalog_list prepare: {e}"))?;
    let rows = stmt
        .query_map(
            params![include_deleted, local_only as i64, cloud_account_id, limit],
            map_catalog_row,
        )
        .map_err(|e| format!("catalog_list query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("catalog_list row: {e}"))
}

/// A single local binding projected by the WorkspaceReconciler (ODE-370).
///
/// Unlike `catalog_dual_write`, this NEVER writes cloud metadata: the reconciler
/// owns local existence and the binding, while Supabase owns cloud presence and
/// the metadata caches. On an existing document only `local_present`/`modified_at`
/// move; `cloud_present`, `cloud_account_id`, `sync_status` and every `*_cache`
/// column are preserved untouched.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogLocalBindingInput {
    pub binding_root_id: String,
    pub root_path: String,
    pub manifest_version: i64,
    pub visible_as_workspace: bool,
    pub document_id: String,
    pub relative_path: String,
    pub canonical_path: String,
    pub inode: Option<i64>,
    pub content_hash: Option<String>,
    pub size: Option<i64>,
    pub last_seen_at: Option<i64>,
    pub title: String,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogReconcileInput {
    pub upserts: Vec<CatalogLocalBindingInput>,
    pub detached: Vec<String>,
}

/// Apply one reconciliation burst as a single SQLite transaction. Every observed
/// upsert and every confirmed-absent detach for the burst commit atomically, so
/// the TS catalog can emit exactly one CatalogChange (Performance Contract:
/// reactive fan-out — one logical update per affected transaction).
#[tauri::command]
pub fn catalog_apply_reconcile(
    db_path: String,
    input: CatalogReconcileInput,
) -> Result<(), String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog reconcile begin: {e}"))?;

    for b in &input.upserts {
        tx.execute(
            "INSERT INTO binding_roots(id,root_path,manifest_version,visible_as_workspace) VALUES(?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET root_path=excluded.root_path,manifest_version=excluded.manifest_version,visible_as_workspace=excluded.visible_as_workspace",
            params![b.binding_root_id, b.root_path, b.manifest_version, b.visible_as_workspace as i64],
        )
        .map_err(|e| format!("catalog reconcile root: {e}"))?;

        // Preserve cloud metadata on conflict: only local presence/mtime move.
        tx.execute(
            "INSERT INTO documents(id,local_present,cloud_present,cloud_account_id,sync_status,title_cache,created_at,modified_at)
             VALUES(?1,1,0,NULL,'local-only',?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET local_present=1,modified_at=excluded.modified_at,
             title_cache=CASE WHEN documents.cloud_present=0 THEN excluded.title_cache
                              ELSE COALESCE(documents.title_cache,excluded.title_cache) END",
            params![b.document_id, b.title, b.created_at, b.modified_at],
        )
        .map_err(|e| format!("catalog reconcile document: {e}"))?;

        tx.execute(
            "INSERT INTO document_bindings(document_id,binding_root_id,relative_path,canonical_path,inode,content_hash,size,last_seen_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(document_id) DO UPDATE SET binding_root_id=excluded.binding_root_id,relative_path=excluded.relative_path,
             canonical_path=excluded.canonical_path,inode=excluded.inode,content_hash=excluded.content_hash,size=excluded.size,last_seen_at=excluded.last_seen_at",
            params![b.document_id, b.binding_root_id, b.relative_path, b.canonical_path, b.inode, b.content_hash, b.size, b.last_seen_at],
        )
        .map_err(|e| format!("catalog reconcile binding: {e}"))?;
    }

    for id in &input.detached {
        tx.execute(
            "DELETE FROM document_bindings WHERE document_id=?1",
            params![id],
        )
        .map_err(|e| format!("catalog reconcile detach binding: {e}"))?;
        // Confirmed physical absence never deletes cloud metadata (spec §Fallas).
        tx.execute(
            "UPDATE documents SET local_present=0 WHERE id=?1",
            params![id],
        )
        .map_err(|e| format!("catalog reconcile detach document: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("catalog reconcile commit: {e}"))
}

#[tauri::command]
pub fn catalog_detach_local_file(db_path: String, id: String) -> Result<(), String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog detach begin: {e}"))?;
    tx.execute(
        "DELETE FROM document_bindings WHERE document_id=?1",
        params![id],
    )
    .map_err(|e| format!("catalog detach binding: {e}"))?;
    tx.execute(
        "UPDATE documents SET local_present=0 WHERE id=?1",
        params![id],
    )
    .map_err(|e| format!("catalog detach document: {e}"))?;
    tx.commit()
        .map_err(|e| format!("catalog detach commit: {e}"))
}

#[tauri::command]
pub fn catalog_update_mutation_status(
    db_path: String,
    mutation_id: String,
    status: String,
    attempt_count: i64,
    next_retry_at: Option<i64>,
    last_error: Option<String>,
) -> Result<(), String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog mutation status begin: {e}"))?;
    tx.execute("UPDATE sync_mutations SET status=?2,attempt_count=?3,next_retry_at=?4,last_error=?5 WHERE id=?1",
      params![mutation_id,status,attempt_count,next_retry_at,last_error])
      .map_err(|e| format!("catalog_update_mutation_status: {e}"))?;
    tx.execute(
        "UPDATE documents SET
          sync_status = CASE
            WHEN ?2='failed' THEN 'failed'
            WHEN ?2='pending' THEN 'pending'
            WHEN (SELECT operation FROM sync_mutations WHERE id=?1)='delete' AND local_present=1 THEN 'local-only'
            WHEN (SELECT operation FROM sync_mutations WHERE id=?1)='delete' THEN 'deleted'
            ELSE 'synced' END,
          cloud_present = CASE
            WHEN ?2='synced' AND (SELECT operation FROM sync_mutations WHERE id=?1)='delete' THEN 0
            WHEN ?2='synced' THEN 1
            ELSE cloud_present END
         WHERE id=(SELECT document_id FROM sync_mutations WHERE id=?1)",
        params![mutation_id, status],
    )
    .map_err(|e| format!("catalog_update_document_status: {e}"))?;
    tx.commit()
        .map_err(|e| format!("catalog mutation status commit: {e}"))
}

// Rollback for M1 (manual, only while the dual-write flag is disabled):
// DROP TABLE sync_mutations; DROP TABLE document_bindings; DROP TABLE documents;
// DROP TABLE binding_roots; DROP TABLE catalog_schema;
// The legacy writings_index table is intentionally untouched through M6.

#[cfg(test)]
mod catalog_tests {
    use super::*;
    use uuid::Uuid;

    fn temp_db() -> String {
        std::env::temp_dir()
            .join(format!("odessay-catalog-{}.sqlite3", Uuid::new_v4()))
            .to_string_lossy()
            .to_string()
    }

    fn input(id: &str, canonical_path: &str, mutation_id: &str) -> CatalogDualWriteInput {
        CatalogDualWriteInput {
            document: CatalogDocumentInput {
                id: id.into(),
                local_present: true,
                cloud_present: false,
                cloud_account_id: None,
                sync_status: "pending".into(),
                title: Some("Doc".into()),
                slug: None,
                status: Some("draft".into()),
                artifact_type: Some("general".into()),
                visibility: Some("private".into()),
                version: Some(1),
                created_at: Some(1),
                modified_at: Some(2),
            },
            binding: Some(CatalogBindingInput {
                binding_root_id: "root-1".into(),
                root_path: "/tmp/root".into(),
                manifest_version: 1,
                visible_as_workspace: false,
                relative_path: canonical_path.rsplit('/').next().unwrap().into(),
                canonical_path: canonical_path.into(),
                inode: None,
                content_hash: None,
                size: None,
                last_seen_at: Some(2),
            }),
            mutation: Some(CatalogMutationInput {
                id: mutation_id.into(),
                operation: "upsert".into(),
                payload_json: "{}".into(),
                status: "pending".into(),
                attempt_count: 0,
                next_retry_at: None,
                created_at: 2,
                last_error: None,
            }),
        }
    }

    #[test]
    fn v2_migration_is_additive_and_versioned() {
        let path = temp_db();
        let started_at = std::time::Instant::now();
        let conn = open_db(&path).unwrap();
        let startup_ms = started_at.elapsed().as_secs_f64() * 1000.0;
        let version: i64 = conn
            .query_row("SELECT version FROM catalog_schema", [], |row| row.get(0))
            .unwrap();
        let legacy: String = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='writings_index'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 2);
        assert_eq!(legacy, "writings_index");
        eprintln!("catalog_startup_ms={startup_ms:.3}");
        assert!(startup_ms < 1000.0, "catalog startup exceeded 1s budget");
        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn uuid_and_path_collisions_do_not_overwrite_another_document() {
        let path = temp_db();
        let started_at = std::time::Instant::now();
        catalog_dual_write(
            path.clone(),
            input("doc-1", "/tmp/root/doc.md", "mutation-1"),
        )
        .unwrap();
        let dual_write_ms = started_at.elapsed().as_secs_f64() * 1000.0;
        eprintln!("catalog_dual_write_ms={dual_write_ms:.3}");
        assert!(dual_write_ms < 1000.0, "catalog dual-write exceeded 1s safety budget");
        let error = catalog_dual_write(
            path.clone(),
            input("doc-2", "/tmp/root/doc.md", "mutation-2"),
        )
        .unwrap_err();
        assert!(error.contains("UNIQUE constraint failed"));
        assert!(catalog_get_by_id(path.clone(), "doc-2".into())
            .unwrap()
            .is_none());
        let first = catalog_get_by_id(path.clone(), "doc-1".into())
            .unwrap()
            .unwrap();
        assert_eq!(first.canonical_path.as_deref(), Some("/tmp/root/doc.md"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn transaction_failure_rolls_back_document_binding_and_queue_together() {
        let path = temp_db();
        let mut invalid = input("doc-invalid", "/tmp/root/invalid.md", "mutation-invalid");
        invalid.mutation.as_mut().unwrap().operation = "unsupported".into();
        assert!(catalog_dual_write(path.clone(), invalid).is_err());
        let conn = open_db(&path).unwrap();
        for table in ["documents", "document_bindings", "sync_mutations"] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} must roll back");
        }
        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn cloud_delete_confirmation_preserves_a_local_document() {
        let path = temp_db();
        let mut delete_input = input("doc-local", "/tmp/root/local.md", "mutation-delete");
        delete_input.mutation.as_mut().unwrap().operation = "delete".into();
        catalog_dual_write(path.clone(), delete_input).unwrap();
        catalog_update_mutation_status(
            path.clone(), "mutation-delete".into(), "synced".into(), 0, None, None,
        ).unwrap();
        let record = catalog_get_by_id(path.clone(), "doc-local".into()).unwrap().unwrap();
        assert!(record.local_present);
        assert!(!record.cloud_present);
        assert_eq!(record.sync_status, "local-only");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn catalog_apply_reconcile_backfills_missing_filename_title_for_local_document() {
        let path = temp_db();

        // Reproduce a record created by the pre-ODE-373 reconciler: identity and
        // binding exist, but the derived title cache is null.
        let mut seed = input(
            "doc-local-new",
            "/tmp/local/My Local Note.md",
            "mutation-local-new",
        );
        seed.document.title = None;
        seed.document.cloud_present = false;
        seed.document.sync_status = "local-only".into();
        catalog_dual_write(path.clone(), seed).unwrap();

        catalog_apply_reconcile(
            path.clone(),
            CatalogReconcileInput {
                upserts: vec![CatalogLocalBindingInput {
                    binding_root_id: "root-local".into(),
                    root_path: "/tmp/local".into(),
                    manifest_version: 2,
                    visible_as_workspace: true,
                    document_id: "doc-local-new".into(),
                    relative_path: "My Local Note.md".into(),
                    canonical_path: "/tmp/local/My Local Note.md".into(),
                    inode: Some(7),
                    content_hash: Some("blake3:local".into()),
                    size: Some(12),
                    last_seen_at: Some(10),
                    title: "My Local Note".into(),
                    created_at: Some(10),
                    modified_at: Some(10),
                }],
                detached: vec![],
            },
        )
        .unwrap();

        let row = catalog_get_by_id(path.clone(), "doc-local-new".into())
            .unwrap()
            .unwrap();
        assert_eq!(row.title.as_deref(), Some("My Local Note"));
        assert!(row.local_present);
        assert!(!row.cloud_present);

        catalog_apply_reconcile(
            path.clone(),
            CatalogReconcileInput {
                upserts: vec![CatalogLocalBindingInput {
                    binding_root_id: "root-local".into(),
                    root_path: "/tmp/local".into(),
                    manifest_version: 2,
                    visible_as_workspace: true,
                    document_id: "doc-local-new".into(),
                    relative_path: "Renamed Local Note.md".into(),
                    canonical_path: "/tmp/local/Renamed Local Note.md".into(),
                    inode: Some(7),
                    content_hash: Some("blake3:local".into()),
                    size: Some(12),
                    last_seen_at: Some(11),
                    title: "Renamed Local Note".into(),
                    created_at: Some(10),
                    modified_at: Some(11),
                }],
                detached: vec![],
            },
        )
        .unwrap();

        let renamed = catalog_get_by_id(path.clone(), "doc-local-new".into())
            .unwrap()
            .unwrap();
        assert_eq!(renamed.title.as_deref(), Some("Renamed Local Note"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn catalog_apply_reconcile_preserves_cloud_metadata_and_detaches_without_cloud_delete() {
        let path = temp_db();

        // Seed a synced cloud document with cloud metadata.
        let mut seed = input("doc-a", "/tmp/root/a.md", "mut-a");
        seed.document.cloud_present = true;
        seed.document.cloud_account_id = Some("acct-1".into());
        seed.document.sync_status = "synced".into();
        seed.document.title = Some("Cloud Title".into());
        catalog_dual_write(path.clone(), seed).unwrap();

        // Reconciler re-projects the local binding: cloud metadata is untouched.
        catalog_apply_reconcile(
            path.clone(),
            CatalogReconcileInput {
                upserts: vec![CatalogLocalBindingInput {
                    binding_root_id: "root-1".into(),
                    root_path: "/tmp/root".into(),
                    manifest_version: 2,
                    visible_as_workspace: false,
                    document_id: "doc-a".into(),
                    relative_path: "a.md".into(),
                    canonical_path: "/tmp/root/a.md".into(),
                    inode: Some(42),
                    content_hash: Some("blake3:xyz".into()),
                    size: Some(10),
                    last_seen_at: Some(99),
                    title: "a".into(),
                    created_at: Some(1),
                    modified_at: Some(99),
                }],
                detached: vec![],
            },
        )
        .unwrap();

        let row = catalog_get_by_id(path.clone(), "doc-a".into())
            .unwrap()
            .unwrap();
        assert!(row.local_present);
        assert!(row.cloud_present, "cloud presence must be preserved");
        assert_eq!(row.cloud_account_id.as_deref(), Some("acct-1"));
        assert_eq!(row.title.as_deref(), Some("Cloud Title"));
        assert_eq!(row.sync_status, "synced");
        assert_eq!(row.inode, Some(42));

        // Confirmed absence detaches locally but never deletes cloud metadata.
        catalog_apply_reconcile(
            path.clone(),
            CatalogReconcileInput {
                upserts: vec![],
                detached: vec!["doc-a".into()],
            },
        )
        .unwrap();

        let row = catalog_get_by_id(path.clone(), "doc-a".into())
            .unwrap()
            .unwrap();
        assert!(!row.local_present, "local presence cleared on detach");
        assert!(row.binding_root_id.is_none(), "binding removed on detach");
        assert!(row.cloud_present, "cloud metadata survives a local detach");
        assert_eq!(row.title.as_deref(), Some("Cloud Title"));

        let _ = fs::remove_file(path);
    }
}

/// Upsert a writing entry into the local SQLite index.
#[tauri::command]
pub fn index_upsert(
    db_path: String,
    path: String,
    title: String,
    created_at: u64,
    modified_at: u64,
) -> Result<(), String> {
    let conn = open_db(&db_path)?;
    conn.execute(
        "INSERT INTO writings_index (path, title, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO UPDATE SET
           title = excluded.title,
           modified_at = excluded.modified_at",
        params![path, title, created_at as i64, modified_at as i64],
    )
    .map_err(|e| format!("index_upsert: {e}"))?;
    Ok(())
}

/// List recent writings from the index, ordered by modified_at descending.
#[tauri::command]
pub fn index_list(db_path: String, limit: usize) -> Result<Vec<IndexEntry>, String> {
    let conn = open_db(&db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT path, title, created_at, modified_at
             FROM writings_index
             ORDER BY modified_at DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("index_list prepare: {e}"))?;

    let rows = stmt
        .query_map(params![limit as i64], |row| {
            Ok(IndexEntry {
                path: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get::<_, i64>(2)? as u64,
                modified_at: row.get::<_, i64>(3)? as u64,
            })
        })
        .map_err(|e| format!("index_list query: {e}"))?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| format!("index_list row: {e}"))?);
    }
    Ok(entries)
}

/// Delete a writing entry from the index.
#[tauri::command]
pub fn index_delete(db_path: String, path: String) -> Result<(), String> {
    let conn = open_db(&db_path)?;
    conn.execute("DELETE FROM writings_index WHERE path = ?1", params![path])
        .map_err(|e| format!("index_delete: {e}"))?;
    Ok(())
}

/// Rebuild the index by scanning all .md files in `dir`.
/// Clears existing entries and re-inserts from filesystem metadata.
/// Returns the number of entries indexed.
#[tauri::command]
pub fn index_rebuild(db_path: String, dir: String) -> Result<usize, String> {
    let conn = open_db(&db_path)?;

    // Clear existing entries
    conn.execute("DELETE FROM writings_index", [])
        .map_err(|e| format!("index_rebuild clear: {e}"))?;

    let dir_path = Path::new(&dir);
    if !dir_path.exists() {
        return Ok(0);
    }

    let mut count = 0usize;
    let entries: Vec<(String, String, u64, u64)> = fs::read_dir(dir_path)
        .map_err(|e| format!("index_rebuild read_dir: {e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let modified_at = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            let created_at = metadata
                .created()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            let name = path.file_stem()?.to_string_lossy().to_string();
            let path_str = path.to_string_lossy().to_string();
            Some((path_str, name, created_at, modified_at))
        })
        .collect();

    for (path, title, created_at, modified_at) in entries {
        conn.execute(
            "INSERT INTO writings_index (path, title, created_at, modified_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET
               title = excluded.title,
               created_at = excluded.created_at,
               modified_at = excluded.modified_at",
            params![path, title, created_at as i64, modified_at as i64],
        )
        .map_err(|e| format!("index_rebuild insert: {e}"))?;
        count += 1;
    }

    Ok(count)
}
