use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

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
            last_scanned_at INTEGER,
            retired_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            local_present INTEGER NOT NULL DEFAULT 0 CHECK (local_present IN (0, 1)),
            cloud_present INTEGER NOT NULL DEFAULT 0 CHECK (cloud_present IN (0, 1)),
            cloud_account_id TEXT,
            cloud_content_hash TEXT,
            sync_status TEXT NOT NULL CHECK (sync_status IN ('local-only','pending','synced','conflict','failed','deleted')),
            title_cache TEXT,
            slug_cache TEXT,
            status_cache TEXT,
            artifact_type_cache TEXT,
            visibility_cache TEXT,
            version_cache INTEGER,
            deleted_at_cache TEXT,
            created_at INTEGER,
            modified_at INTEGER,
            excerpt_cache TEXT,
            excerpt_content_hash TEXT
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
        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            owner_id TEXT,
            name TEXT NOT NULL,
            description TEXT,
            visibility TEXT NOT NULL CHECK (visibility IN ('private','public')),
            sync_status TEXT NOT NULL,
            lifecycle TEXT NOT NULL,
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            local_updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS writing_collections (
            writing_id TEXT NOT NULL,
            collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            added_at TEXT NOT NULL,
            local_updated_at INTEGER NOT NULL,
            PRIMARY KEY(writing_id, collection_id)
        );
        CREATE TABLE IF NOT EXISTS metadata_sync_mutations (
            id TEXT PRIMARY KEY,
            entity_kind TEXT NOT NULL CHECK (entity_kind IN ('collection','writing-collections')),
            entity_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK (operation IN ('upsert','delete','set')),
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
        CREATE INDEX IF NOT EXISTS idx_metadata_mutations_pending ON metadata_sync_mutations(status, next_retry_at);
        INSERT INTO catalog_schema(singleton, version) VALUES (1, 2)
          ON CONFLICT(singleton) DO UPDATE SET version = MAX(version, excluded.version);",
    ).map_err(|e| format!("catalog migration v2: {e}"))?;
    tx.commit()
        .map_err(|e| format!("catalog migration commit: {e}"))?;

    let has_cloud_hash = {
        let mut stmt = conn
            .prepare("PRAGMA table_info(documents)")
            .map_err(|e| format!("catalog migration inspect documents: {e}"))?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("catalog migration list columns: {e}"))?;
        let found = columns
            .filter_map(Result::ok)
            .any(|name| name == "cloud_content_hash");
        found
    };
    if !has_cloud_hash {
        conn.execute(
            "ALTER TABLE documents ADD COLUMN cloud_content_hash TEXT",
            [],
        )
        .map_err(|e| format!("catalog migration add cloud_content_hash: {e}"))?;
    }
    let has_deleted_at_cache = {
        let mut stmt = conn
            .prepare("PRAGMA table_info(documents)")
            .map_err(|e| format!("catalog migration inspect deleted marker: {e}"))?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("catalog migration list deleted marker: {e}"))?;
        let found = columns
            .filter_map(Result::ok)
            .any(|name| name == "deleted_at_cache");
        found
    };
    if !has_deleted_at_cache {
        conn.execute("ALTER TABLE documents ADD COLUMN deleted_at_cache TEXT", [])
            .map_err(|e| format!("catalog migration add deleted_at_cache: {e}"))?;
    }
    let (has_excerpt_cache, has_excerpt_content_hash) = {
        let mut stmt = conn
            .prepare("PRAGMA table_info(documents)")
            .map_err(|e| format!("catalog migration inspect excerpt cache: {e}"))?;
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("catalog migration list excerpt cache: {e}"))?
            .filter_map(Result::ok)
            .collect();
        (
            columns.iter().any(|name| name == "excerpt_cache"),
            columns.iter().any(|name| name == "excerpt_content_hash"),
        )
    };
    if !has_excerpt_cache {
        conn.execute("ALTER TABLE documents ADD COLUMN excerpt_cache TEXT", [])
            .map_err(|e| format!("catalog migration add excerpt_cache: {e}"))?;
    }
    if !has_excerpt_content_hash {
        conn.execute(
            "ALTER TABLE documents ADD COLUMN excerpt_content_hash TEXT",
            [],
        )
        .map_err(|e| format!("catalog migration add excerpt_content_hash: {e}"))?;
    }
    let has_retired_at = {
        let mut stmt = conn
            .prepare("PRAGMA table_info(binding_roots)")
            .map_err(|e| format!("catalog migration inspect retired root: {e}"))?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("catalog migration list root columns: {e}"))?;
        let found = columns
            .filter_map(Result::ok)
            .any(|name| name == "retired_at");
        found
    };
    if !has_retired_at {
        conn.execute(
            "ALTER TABLE binding_roots ADD COLUMN retired_at INTEGER",
            [],
        )
        .map_err(|e| format!("catalog migration add retired_at: {e}"))?;
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_catalog_cloud_hash ON documents(cloud_content_hash) WHERE cloud_present=1 AND cloud_content_hash IS NOT NULL;
         DROP TABLE IF EXISTS writings_index;
         UPDATE sync_mutations AS older
           SET status='synced', last_error='superseded by later snapshot mutation'
         WHERE status IN ('pending','failed')
           AND EXISTS (
             SELECT 1 FROM sync_mutations AS newer
             WHERE newer.document_id=older.document_id
               AND newer.status IN ('pending','failed')
               AND (newer.created_at>older.created_at OR (newer.created_at=older.created_at AND newer.id>older.id))
           );
         -- `deleted_at_cache` is a CLOUD tombstone: it is what Settings > Archived
         -- writings lists. Only a document with a cloud row can carry one. A
         -- local-only document retired from the active catalog (ODE-408 workspace
         -- removal) is `sync_status='deleted'` with no tombstone by design, and
         -- stamping it here would fabricate a cloud archive it never had.
         UPDATE documents SET deleted_at_cache='legacy'
           WHERE sync_status='deleted' AND deleted_at_cache IS NULL AND cloud_present=1;
         -- Self-heal installs where the unscoped backfill above already stamped
         -- local-only rows before that guard existed.
         UPDATE documents SET deleted_at_cache=NULL
           WHERE deleted_at_cache='legacy' AND cloud_present=0;
         INSERT INTO catalog_schema(singleton, version) VALUES (1, 3)
           ON CONFLICT(singleton) DO UPDATE SET version = MAX(version, excluded.version);
         UPDATE catalog_schema SET version=8 WHERE singleton=1;"
    ).map_err(|e| format!("catalog migration v3: {e}"))?;
    Ok(())
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
    pub deleted_at: Option<String>,
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
pub struct CatalogMutationRow {
    pub id: String,
    pub document_id: String,
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
pub struct CatalogCollectionInput {
    pub id: String,
    pub owner_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub visibility: String,
    pub sync_status: String,
    pub lifecycle: String,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub local_updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogWritingCollectionInput {
    pub writing_id: String,
    pub collection_id: String,
    pub added_at: String,
    pub local_updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMetadataMutationInput {
    pub id: String,
    pub entity_kind: String,
    pub entity_id: String,
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
pub struct CatalogMetadataMutationRow {
    pub id: String,
    pub entity_kind: String,
    pub entity_id: String,
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
pub struct CatalogCollectionSnapshot {
    pub collections: Vec<CatalogCollectionInput>,
    pub writing_collections: Vec<CatalogWritingCollectionInput>,
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
pub struct CatalogCloudSnapshotInput {
    pub id: String,
    pub cloud_present: bool,
    pub cloud_account_id: Option<String>,
    pub content_hash: Option<String>,
    pub title: Option<String>,
    pub slug: Option<String>,
    pub status: Option<String>,
    pub artifact_type: Option<String>,
    pub visibility: Option<String>,
    pub version: Option<i64>,
    pub deleted_at: Option<String>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
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
    pub deleted_at: Option<String>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub excerpt: Option<String>,
    pub excerpt_content_hash: Option<String>,
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
        deleted_at: row.get(11)?,
        created_at: row.get(12)?,
        modified_at: row.get(13)?,
        excerpt: row.get(14)?,
        excerpt_content_hash: row.get(15)?,
        binding_root_id: row.get(16)?,
        relative_path: row.get(17)?,
        canonical_path: row.get(18)?,
        inode: row.get(19)?,
        content_hash: row.get(20)?,
        size: row.get(21)?,
        last_seen_at: row.get(22)?,
    })
}

const CATALOG_SELECT: &str =
    "SELECT d.id,d.local_present,d.cloud_present,d.cloud_account_id,d.sync_status,
 d.title_cache,d.slug_cache,d.status_cache,d.artifact_type_cache,d.visibility_cache,d.version_cache,
 d.deleted_at_cache,d.created_at,d.modified_at,d.excerpt_cache,d.excerpt_content_hash,
 b.binding_root_id,b.relative_path,b.canonical_path,b.inode,b.content_hash,b.size,b.last_seen_at
 FROM documents d LEFT JOIN document_bindings b ON b.document_id=d.id";

const MAX_EXCERPT_CHARS: usize = 120;

fn markdown_excerpt(markdown: &str) -> Option<String> {
    let normalized = markdown.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines = normalized.lines().peekable();
    if lines.peek().is_some_and(|line| line.trim() == "---") {
        lines.next();
        for line in lines.by_ref() {
            if matches!(line.trim(), "---" | "...") {
                break;
            }
        }
    }

    let mut text = String::new();
    for line in lines {
        let mut value = line.trim();
        if value.starts_with("```") || value.starts_with("~~~") {
            continue;
        }
        value = value.trim_start_matches(|character: char| {
            matches!(character, '#' | '>' | '-' | '+' | '*' | ' ' | '\t')
        });
        let mut chars = value.chars().peekable();
        let mut in_html_tag = false;
        while let Some(character) = chars.next() {
            if in_html_tag {
                if character == '>' {
                    in_html_tag = false;
                }
                continue;
            }
            if character == '<' {
                in_html_tag = true;
                continue;
            }
            if character == ']' && chars.peek() == Some(&'(') {
                chars.next();
                for target_character in chars.by_ref() {
                    if target_character == ')' {
                        break;
                    }
                }
                continue;
            }
            if matches!(character, '[' | ']' | '`' | '_' | '~') {
                continue;
            }
            if character == '!' && chars.peek() == Some(&'[') {
                continue;
            }
            text.push(character);
        }
        text.push(' ');
    }

    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        None
    } else {
        Some(compact.chars().take(MAX_EXCERPT_CHARS).collect())
    }
}

/// Rebuild stale/missing excerpts away from React. Reads execute sequentially
/// in this background command (bounded concurrency = 1), then every valid result
/// commits in one SQLite transaction. The content-hash predicate prevents a
/// watcher result from overwriting a newer save.
#[tauri::command]
pub fn catalog_hydrate_excerpts(db_path: String) -> Result<Vec<String>, String> {
    let mut conn = open_db(&db_path)?;
    let candidates: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT d.id,b.canonical_path,b.content_hash
                 FROM documents d JOIN document_bindings b ON b.document_id=d.id
                 WHERE d.local_present=1 AND b.content_hash IS NOT NULL
                   AND (d.excerpt_content_hash IS NULL OR d.excerpt_content_hash != b.content_hash)
                 ORDER BY d.modified_at DESC",
            )
            .map_err(|e| format!("catalog excerpt candidates prepare: {e}"))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| format!("catalog excerpt candidates query: {e}"))?
            .filter_map(Result::ok)
            .collect();
        rows
    };

    let prepared: Vec<(String, Option<String>, String)> = candidates
        .into_iter()
        .filter_map(|(id, path, content_hash)| {
            let markdown = fs::read_to_string(path).ok()?;
            Some((id, markdown_excerpt(&markdown), content_hash))
        })
        .collect();
    if prepared.is_empty() {
        return Ok(Vec::new());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog excerpt batch begin: {e}"))?;
    let mut updated = Vec::new();
    for (id, excerpt, content_hash) in prepared {
        let changed = tx
            .execute(
                "UPDATE documents SET excerpt_cache=?1,excerpt_content_hash=?2
                 WHERE id=?3 AND EXISTS (
                   SELECT 1 FROM document_bindings b
                   WHERE b.document_id=?3 AND b.content_hash=?2
                 )",
                params![excerpt, content_hash, id],
            )
            .map_err(|e| format!("catalog excerpt batch update: {e}"))?;
        if changed > 0 {
            updated.push(id);
        }
    }
    tx.commit()
        .map_err(|e| format!("catalog excerpt batch commit: {e}"))?;
    Ok(updated)
}

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
    apply_dual_write(&tx, &input)?;
    tx.commit()
        .map_err(|e| format!("catalog dual-write commit: {e}"))
}

/// The dual-write body, shared by the single-document command and the batch one
/// so both paths can never drift apart. Caller owns the transaction.
fn apply_dual_write(
    tx: &rusqlite::Transaction,
    input: &CatalogDualWriteInput,
) -> Result<(), String> {
    let d = &input.document;
    tx.execute("INSERT INTO documents(id,local_present,cloud_present,cloud_account_id,sync_status,title_cache,slug_cache,status_cache,artifact_type_cache,visibility_cache,version_cache,deleted_at_cache,created_at,modified_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
      ON CONFLICT(id) DO UPDATE SET local_present=excluded.local_present,cloud_present=excluded.cloud_present,
      cloud_account_id=excluded.cloud_account_id,sync_status=excluded.sync_status,title_cache=excluded.title_cache,
      slug_cache=excluded.slug_cache,status_cache=excluded.status_cache,artifact_type_cache=excluded.artifact_type_cache,
      visibility_cache=excluded.visibility_cache,version_cache=excluded.version_cache,deleted_at_cache=excluded.deleted_at_cache,
      modified_at=excluded.modified_at",
      params![d.id,d.local_present as i64,d.cloud_present as i64,d.cloud_account_id,d.sync_status,d.title,d.slug,d.status,d.artifact_type,d.visibility,d.version,d.deleted_at,d.created_at,d.modified_at])
      .map_err(|e| format!("catalog dual-write document: {e}"))?;
    if let Some(b) = &input.binding {
        // Resolve the binding root by its physical path. A directory has ONE
        // identity, but the reconciler (manifest root ids) and legacy dual-write /
        // M5 migration (`legacy-root:<path>` ids) can name the same dir; keying the
        // upsert only on `id` would then hit UNIQUE(root_path). Reuse an existing
        // root id for this path instead of inserting a second row for it, and bind
        // the document to that resolved id.
        let existing_root: Option<(String, Option<i64>)> = tx
            .query_row(
                "SELECT id,retired_at FROM binding_roots WHERE root_path=?1",
                params![b.root_path],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("catalog dual-write root lookup: {e}"))?;
        let root_id = match existing_root {
            Some((_, Some(_))) => {
                return Err("catalog dual-write rejected retired binding root".into())
            }
            Some((id, None)) => id,
            None => {
                tx.execute(
                    "INSERT INTO binding_roots(id,root_path,manifest_version,visible_as_workspace) VALUES(?1,?2,?3,?4)",
                    params![b.binding_root_id, b.root_path, b.manifest_version, b.visible_as_workspace as i64],
                )
                .map_err(|e| format!("catalog dual-write root: {e}"))?;
                b.binding_root_id.clone()
            }
        };
        tx.execute("INSERT INTO document_bindings(document_id,binding_root_id,relative_path,canonical_path,inode,content_hash,size,last_seen_at)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
          ON CONFLICT(document_id) DO UPDATE SET binding_root_id=excluded.binding_root_id,relative_path=excluded.relative_path,
          canonical_path=excluded.canonical_path,inode=excluded.inode,content_hash=excluded.content_hash,size=excluded.size,last_seen_at=excluded.last_seen_at",
          params![d.id,root_id,b.relative_path,b.canonical_path,b.inode,b.content_hash,b.size,b.last_seen_at])
          .map_err(|e| format!("catalog dual-write binding: {e}"))?;
    }
    if d.deleted_at.is_some() {
        tx.execute(
            "DELETE FROM document_bindings WHERE document_id=?1",
            params![d.id],
        )
        .map_err(|e| format!("catalog dual-write delete binding: {e}"))?;
    }
    if let Some(m) = &input.mutation {
        tx.execute("INSERT INTO sync_mutations(id,document_id,operation,payload_json,status,attempt_count,next_retry_at,created_at,last_error)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
          ON CONFLICT(id) DO UPDATE SET status=excluded.status,attempt_count=excluded.attempt_count,next_retry_at=excluded.next_retry_at,last_error=excluded.last_error",
          params![m.id,d.id,m.operation,m.payload_json,m.status,m.attempt_count,m.next_retry_at,m.created_at,m.last_error])
          .map_err(|e| format!("catalog dual-write mutation: {e}"))?;
    }
    Ok(())
}

/// Atomic batch dual-write. Every input commits in one SQLite transaction so the TS
/// catalog can emit a single CatalogChange for the whole batch (ODE-408).
#[tauri::command]
pub fn catalog_bulk_dual_write(
    db_path: String,
    inputs: Vec<CatalogDualWriteInput>,
) -> Result<Vec<String>, String> {
    if inputs.is_empty() {
        return Ok(Vec::new());
    }
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog bulk dual-write begin: {e}"))?;
    for input in &inputs {
        apply_dual_write(&tx, input)?;
    }
    tx.commit()
        .map_err(|e| format!("catalog bulk dual-write commit: {e}"))?;
    Ok(inputs.into_iter().map(|input| input.document.id).collect())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingRootDocumentCount {
    pub total: i64,
    pub cloud: i64,
}

/// Count documents tied to a BindingRoot for the workspace-removal preview dialog.
#[tauri::command]
pub fn catalog_count_binding_root_documents(
    db_path: String,
    binding_root_id: String,
) -> Result<BindingRootDocumentCount, String> {
    let conn = open_db(&db_path)?;
    let (total, cloud): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(d.id), COALESCE(SUM(CASE WHEN d.cloud_present=1 THEN 1 ELSE 0 END), 0)
             FROM documents d JOIN document_bindings b ON b.document_id=d.id
             WHERE b.binding_root_id=?1",
            params![binding_root_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("catalog count binding root documents: {e}"))?;
    Ok(BindingRootDocumentCount { total, cloud })
}

/// Return every document currently bound to one root without a client-side
/// LIMIT. Used only for manifest recovery before a root is retired.
#[tauri::command]
pub fn catalog_list_binding_root_documents(
    db_path: String,
    binding_root_id: String,
) -> Result<Vec<CatalogRow>, String> {
    let conn = open_db(&db_path)?;
    let mut stmt = conn
        .prepare(&format!(
            "{CATALOG_SELECT} WHERE b.binding_root_id=?1 ORDER BY b.relative_path"
        ))
        .map_err(|e| format!("catalog list binding root documents prepare: {e}"))?;
    let rows = stmt
        .query_map(params![binding_root_id], map_catalog_row)
        .map_err(|e| format!("catalog list binding root documents query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("catalog list binding root documents row: {e}"))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRemovalDocumentRow {
    pub id: String,
    pub cloud_present: bool,
    pub cloud_account_id: Option<String>,
    pub version: Option<i64>,
    pub title: Option<String>,
    pub slug: Option<String>,
    pub status: Option<String>,
    pub artifact_type: Option<String>,
    pub visibility: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetiredBindingRootRow {
    pub id: String,
    pub root_path: String,
    pub retired_at: i64,
}

/// Durable recovery record for a cross-store workspace removal. Settings is an
/// organizational projection and may still contain this root if the process
/// stopped after SQLite committed. Startup uses this list to finish that write.
#[tauri::command]
pub fn catalog_list_retired_binding_roots(
    db_path: String,
) -> Result<Vec<RetiredBindingRootRow>, String> {
    let conn = open_db(&db_path)?;
    let mut stmt = conn
        .prepare("SELECT id,root_path,retired_at FROM binding_roots WHERE retired_at IS NOT NULL")
        .map_err(|e| format!("catalog retired roots prepare: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RetiredBindingRootRow {
                id: row.get(0)?,
                root_path: row.get(1)?,
                retired_at: row.get(2)?,
            })
        })
        .map_err(|e| format!("catalog retired roots query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("catalog retired roots row: {e}"))
}

/// Explicit user consent to add/re-add a folder is the only operation allowed
/// to lift the durable retirement fence. Reconciliation itself never does so.
#[tauri::command]
pub fn catalog_activate_binding_root(
    db_path: String,
    binding_root_id: String,
    root_path: String,
) -> Result<(), String> {
    let conn = open_db(&db_path)?;
    conn.execute(
        "UPDATE binding_roots SET retired_at=NULL WHERE id=?1 OR root_path=?2",
        params![binding_root_id, root_path],
    )
    .map_err(|e| format!("catalog activate binding root: {e}"))?;
    Ok(())
}

/// Remove a workspace's BindingRoot from the active catalog.
/// - Local-only documents: detach binding, set local_present=0, sync_status='deleted'.
///   `deleted_at_cache` stays NULL on purpose — that column is a CLOUD tombstone
///   and a document with no cloud row must never be listed in Archived writings.
/// - Cloud documents: detach binding, set local_present=0, keep cloud_present=1,
///   set deleted_at_cache, enqueue a durable soft-delete mutation.
/// Returns affected document ids so the TS catalog can emit one CatalogChange.
#[tauri::command]
pub fn catalog_apply_workspace_removal(
    db_path: String,
    binding_root_id: String,
    root_path: String,
    deleted_at: String,
    updated_at: String,
    now_millis: i64,
) -> Result<Vec<String>, String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog workspace removal begin: {e}"))?;

    // This is the durable commit point for the cross-store operation. It fences
    // callbacks that were queued by the watcher before Settings is updated and
    // makes retries idempotent (no duplicate cloud-delete mutation).
    let root_state: Option<(String, Option<i64>)> = tx
        .query_row(
            "SELECT id,retired_at FROM binding_roots
             WHERE id=?1 OR root_path=?2
             ORDER BY CASE WHEN id=?1 THEN 0 ELSE 1 END
             LIMIT 1",
            params![binding_root_id, root_path],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| format!("catalog workspace removal inspect root: {e}"))?;
    let effective_root_id = match root_state {
        Some((_, Some(_))) => {
            tx.commit()
                .map_err(|e| format!("catalog workspace removal idempotent commit: {e}"))?;
            return Ok(Vec::new());
        }
        Some((existing_id, None)) => {
            tx.execute(
                "UPDATE binding_roots SET retired_at=?1 WHERE id=?2",
                params![now_millis, existing_id],
            )
            .map_err(|e| format!("catalog workspace removal retire root: {e}"))?;
            existing_id
        }
        None => {
            // Removal may race the root's first projection. Persist a tombstone
            // anyway so the already-queued watcher callback cannot create it.
            tx.execute(
                "INSERT INTO binding_roots(id,root_path,manifest_version,visible_as_workspace,retired_at)
                 VALUES(?1,?2,2,1,?3)",
                params![binding_root_id, root_path, now_millis],
            )
            .map_err(|e| format!("catalog workspace removal create fence: {e}"))?;
            binding_root_id.clone()
        }
    };

    let mut stmt = tx
        .prepare(
            "SELECT d.id, d.cloud_present, d.cloud_account_id, d.version_cache,
                    d.title_cache, d.slug_cache, d.status_cache, d.artifact_type_cache, d.visibility_cache
             FROM documents d JOIN document_bindings b ON b.document_id=d.id
             WHERE b.binding_root_id=?1",
        )
        .map_err(|e| format!("catalog workspace removal prepare: {e}"))?;
    let rows: Vec<WorkspaceRemovalDocumentRow> = stmt
        .query_map(params![effective_root_id], |row| {
            Ok(WorkspaceRemovalDocumentRow {
                id: row.get(0)?,
                cloud_present: row.get::<_, i64>(1)? != 0,
                cloud_account_id: row.get(2)?,
                version: row.get(3)?,
                title: row.get(4)?,
                slug: row.get(5)?,
                status: row.get(6)?,
                artifact_type: row.get(7)?,
                visibility: row.get(8)?,
            })
        })
        .map_err(|e| format!("catalog workspace removal query: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("catalog workspace removal row: {e}"))?;
    drop(stmt);

    let mut affected_ids = Vec::with_capacity(rows.len());
    for row in rows {
        affected_ids.push(row.id.clone());
        tx.execute(
            "DELETE FROM document_bindings WHERE document_id=?1",
            params![row.id],
        )
        .map_err(|e| format!("catalog workspace removal detach binding: {e}"))?;

        if row.cloud_present {
            let version = row.version.unwrap_or(1);
            let mutation_id = uuid::Uuid::new_v4().to_string();
            let payload = serde_json::json!({
                "version": version,
                "deletedAt": deleted_at,
                "updatedAt": updated_at,
            })
            .to_string();
            tx.execute(
                "INSERT INTO sync_mutations(id,document_id,operation,payload_json,status,attempt_count,next_retry_at,created_at,last_error)
                 VALUES(?1,?2,'delete',?3,'pending',0,NULL,?4,NULL)",
                params![mutation_id, row.id, payload, now_millis],
            )
            .map_err(|e| format!("catalog workspace removal mutation: {e}"))?;
            tx.execute(
                "UPDATE documents SET local_present=0, sync_status='pending', deleted_at_cache=?1,
                 excerpt_cache=NULL, excerpt_content_hash=NULL, modified_at=?2
                 WHERE id=?3",
                params![deleted_at, now_millis, row.id],
            )
            .map_err(|e| format!("catalog workspace removal cloud document: {e}"))?;
        } else {
            tx.execute(
                "UPDATE documents SET local_present=0, sync_status='deleted', deleted_at_cache=NULL,
                 excerpt_cache=NULL, excerpt_content_hash=NULL
                 WHERE id=?1",
                params![row.id],
            )
            .map_err(|e| format!("catalog workspace removal local document: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("catalog workspace removal commit: {e}"))?;
    Ok(affected_ids)
}

/// Reactivate a BindingRoot after the same folder is re-added (ODE-408).
///
/// Runs as one transaction over the rows the reconciler has just re-bound:
/// - Local-only documents retired by `catalog_apply_workspace_removal` return to
///   the active catalog (`sync_status='local-only'`). They never had a cloud row,
///   so nothing is enqueued and nothing is uploaded.
/// - Cloud-archived documents are RETURNED, not mutated. The caller reads the
///   current `.md` and applies the "local wins" upsert through the normal
///   dual-write path, which is where content and versioning belong.
///
/// Telling the two classes apart is `cloud_account_id`, NOT `cloud_present`.
/// Cloud hydration projects an archived row as `cloud_present=0` (see
/// `cloudSnapshotFromRow`: `cloudPresent: !row.deleted_at`), so after any app
/// restart an archived document has a cloud record and `cloud_present=0` at the
/// same time. `cloud_account_id` survives archival and is NULL for a document
/// that never reached the cloud, which is exactly the distinction needed here.
#[tauri::command]
pub fn catalog_reactivate_binding_root(
    db_path: String,
    binding_root_id: String,
) -> Result<Vec<CatalogRow>, String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog reactivate root begin: {e}"))?;

    // `deleted_at_cache IS NULL` is what keeps this off cloud-archived rows: a
    // hydrated archived document also sits at cloud_present=0 + local_present=1,
    // and reclassifying it as local-only would strand it — hidden from Desk,
    // still tombstoned in Archived writings, and invisible to the SELECT below.
    tx.execute(
        "UPDATE documents SET sync_status='local-only'
         WHERE sync_status='deleted' AND cloud_present=0 AND local_present=1
           AND deleted_at_cache IS NULL AND cloud_account_id IS NULL
           AND id IN (SELECT document_id FROM document_bindings WHERE binding_root_id=?1)",
        params![binding_root_id],
    )
    .map_err(|e| format!("catalog reactivate local-only: {e}"))?;

    let mut stmt = tx
        .prepare(&format!(
            "{CATALOG_SELECT} WHERE b.binding_root_id=?1 AND d.local_present=1
             AND d.deleted_at_cache IS NOT NULL
             AND (d.cloud_present=1 OR d.cloud_account_id IS NOT NULL)"
        ))
        .map_err(|e| format!("catalog reactivate prepare: {e}"))?;
    let rows: Vec<CatalogRow> = stmt
        .query_map(params![binding_root_id], map_catalog_row)
        .map_err(|e| format!("catalog reactivate query: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("catalog reactivate row: {e}"))?;
    drop(stmt);

    tx.commit()
        .map_err(|e| format!("catalog reactivate commit: {e}"))?;
    Ok(rows)
}

/// Project a complete cloud metadata burst without changing filesystem facts.
/// Cloud hydration owns cloud presence/account/metadata only; an existing local
/// binding and `local_present` always survive this transaction.
#[tauri::command]
pub fn catalog_apply_cloud_snapshots(
    db_path: String,
    snapshots: Vec<CatalogCloudSnapshotInput>,
) -> Result<(), String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog cloud snapshot begin: {e}"))?;

    for d in &snapshots {
        tx.execute(
            "INSERT INTO documents(id,local_present,cloud_present,cloud_account_id,cloud_content_hash,sync_status,title_cache,slug_cache,status_cache,artifact_type_cache,visibility_cache,version_cache,deleted_at_cache,created_at,modified_at)
             VALUES(?1,0,?2,?3,?4,CASE WHEN ?2=1 THEN 'synced' ELSE 'deleted' END,?5,?6,?7,?8,?9,?10,?11,?12,?13)
             ON CONFLICT(id) DO UPDATE SET
               cloud_present=excluded.cloud_present,
               cloud_account_id=excluded.cloud_account_id,
               cloud_content_hash=excluded.cloud_content_hash,
               title_cache=excluded.title_cache,
               slug_cache=excluded.slug_cache,
               status_cache=excluded.status_cache,
               artifact_type_cache=excluded.artifact_type_cache,
               visibility_cache=excluded.visibility_cache,
               version_cache=excluded.version_cache,
               deleted_at_cache=CASE
                 WHEN documents.deleted_at_cache IS NOT NULL
                   AND documents.sync_status IN ('pending','failed','conflict')
                 THEN documents.deleted_at_cache
                 ELSE excluded.deleted_at_cache END,
               created_at=COALESCE(documents.created_at,excluded.created_at),
               modified_at=excluded.modified_at,
               sync_status=CASE
                 WHEN documents.sync_status IN ('pending','failed','conflict') THEN documents.sync_status
                 WHEN excluded.cloud_present=1 THEN 'synced'
                 WHEN documents.local_present=1 THEN 'local-only'
                 ELSE 'deleted' END",
            params![d.id,d.cloud_present as i64,d.cloud_account_id,d.content_hash,d.title,d.slug,d.status,d.artifact_type,d.visibility,d.version,d.deleted_at,d.created_at,d.modified_at],
        )
        .map_err(|e| format!("catalog cloud snapshot document: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("catalog cloud snapshot commit: {e}"))
}

#[tauri::command]
pub fn catalog_find_eligible_cloud_hash(
    db_path: String,
    content_hash: String,
    cloud_account_id: String,
) -> Result<Vec<String>, String> {
    let conn = open_db(&db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id FROM documents
         WHERE cloud_present=1 AND local_present=0 AND cloud_content_hash=?1
           AND cloud_account_id=?2 AND sync_status='synced' ORDER BY id LIMIT 2",
        )
        .map_err(|e| format!("catalog cloud hash prepare: {e}"))?;
    let rows = stmt
        .query_map(params![content_hash, cloud_account_id], |row| row.get(0))
        .map_err(|e| format!("catalog cloud hash query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("catalog cloud hash row: {e}"))
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
    let sql = format!("{CATALOG_SELECT} WHERE (?1 OR (d.deleted_at_cache IS NULL AND d.sync_status != 'deleted')) AND (?2=0 OR d.local_present=1)
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
) -> Result<bool, String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog reconcile begin: {e}"))?;

    // A callback may already be scanning when removal starts. The SQLite fence
    // is checked in the same transaction as projection, so that stale callback
    // cannot recreate bindings even if it captured the old in-memory root.
    if let Some(binding) = input.upserts.first() {
        let retired: bool = tx
            .query_row(
                "SELECT retired_at IS NOT NULL FROM binding_roots
                 WHERE id=?1 OR root_path=?2
                 ORDER BY CASE WHEN id=?1 THEN 0 ELSE 1 END
                 LIMIT 1",
                params![binding.binding_root_id, binding.root_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("catalog reconcile retirement fence: {e}"))?
            .unwrap_or(false);
        if retired {
            tx.commit()
                .map_err(|e| format!("catalog reconcile fenced commit: {e}"))?;
            return Ok(false);
        }
    }

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
            "UPDATE documents SET local_present=0,excerpt_cache=NULL,excerpt_content_hash=NULL WHERE id=?1",
            params![id],
        )
        .map_err(|e| format!("catalog reconcile detach document: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("catalog reconcile commit: {e}"))?;
    Ok(true)
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
        "UPDATE documents SET local_present=0,excerpt_cache=NULL,excerpt_content_hash=NULL WHERE id=?1",
        params![id],
    )
    .map_err(|e| format!("catalog detach document: {e}"))?;
    tx.commit()
        .map_err(|e| format!("catalog detach commit: {e}"))
}

#[tauri::command]
pub fn catalog_purge_document(db_path: String, id: String) -> Result<(), String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog purge begin: {e}"))?;
    tx.execute(
        "DELETE FROM writing_collections WHERE writing_id=?1",
        params![id],
    )
    .map_err(|e| format!("catalog purge memberships: {e}"))?;
    tx.execute("DELETE FROM documents WHERE id=?1", params![id])
        .map_err(|e| format!("catalog purge document: {e}"))?;
    tx.commit()
        .map_err(|e| format!("catalog purge commit: {e}"))
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

#[tauri::command]
pub fn catalog_enqueue_mutation(
    db_path: String,
    document_id: String,
    mutation: CatalogMutationInput,
) -> Result<(), String> {
    let conn = open_db(&db_path)?;
    conn.execute(
        "INSERT INTO sync_mutations(id,document_id,operation,payload_json,status,attempt_count,next_retry_at,created_at,last_error)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO NOTHING",
        params![mutation.id, document_id, mutation.operation, mutation.payload_json,
            mutation.status, mutation.attempt_count, mutation.next_retry_at,
            mutation.created_at, mutation.last_error],
    )
    .map_err(|e| format!("catalog enqueue mutation: {e}"))?;
    conn.execute(
        "UPDATE documents SET sync_status='pending' WHERE id=?1",
        params![document_id],
    )
    .map_err(|e| format!("catalog enqueue document status: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn catalog_list_pending_mutations(
    db_path: String,
    now: i64,
    limit: usize,
) -> Result<Vec<CatalogMutationRow>, String> {
    let conn = open_db(&db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id,document_id,operation,payload_json,status,attempt_count,next_retry_at,created_at,last_error
             FROM sync_mutations
             WHERE status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at<=?1)
             ORDER BY created_at ASC LIMIT ?2",
        )
        .map_err(|e| format!("catalog list pending prepare: {e}"))?;
    let rows = stmt
        .query_map(params![now, limit as i64], |row| {
            Ok(CatalogMutationRow {
                id: row.get(0)?,
                document_id: row.get(1)?,
                operation: row.get(2)?,
                payload_json: row.get(3)?,
                status: row.get(4)?,
                attempt_count: row.get(5)?,
                next_retry_at: row.get(6)?,
                created_at: row.get(7)?,
                last_error: row.get(8)?,
            })
        })
        .map_err(|e| format!("catalog list pending query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("catalog list pending row: {e}"))
}

fn upsert_collection(conn: &Connection, collection: &CatalogCollectionInput) -> Result<(), String> {
    conn.execute(
        "INSERT INTO collections(id,owner_id,name,description,visibility,sync_status,lifecycle,deleted_at,created_at,updated_at,local_updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,name=excluded.name,
           description=excluded.description,visibility=excluded.visibility,sync_status=excluded.sync_status,
           lifecycle=excluded.lifecycle,deleted_at=excluded.deleted_at,created_at=excluded.created_at,
           updated_at=excluded.updated_at,local_updated_at=excluded.local_updated_at",
        params![collection.id, collection.owner_id, collection.name, collection.description,
            collection.visibility, collection.sync_status, collection.lifecycle, collection.deleted_at,
            collection.created_at, collection.updated_at, collection.local_updated_at],
    )
    .map_err(|e| format!("catalog upsert collection: {e}"))?;
    Ok(())
}

fn enqueue_metadata_mutation(
    conn: &Connection,
    mutation: &CatalogMetadataMutationInput,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO metadata_sync_mutations(id,entity_kind,entity_id,operation,payload_json,status,attempt_count,next_retry_at,created_at,last_error)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO NOTHING",
        params![mutation.id, mutation.entity_kind, mutation.entity_id, mutation.operation,
            mutation.payload_json, mutation.status, mutation.attempt_count, mutation.next_retry_at,
            mutation.created_at, mutation.last_error],
    )
    .map_err(|e| format!("catalog enqueue metadata mutation: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn catalog_apply_collection_snapshot(
    db_path: String,
    snapshot: CatalogCollectionSnapshot,
) -> Result<(), String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("collection snapshot begin: {e}"))?;
    for collection in &snapshot.collections {
        upsert_collection(&tx, collection)?;
    }
    for relation in &snapshot.writing_collections {
        tx.execute(
            "INSERT INTO writing_collections(writing_id,collection_id,added_at,local_updated_at)
             VALUES(?1,?2,?3,?4) ON CONFLICT(writing_id,collection_id) DO UPDATE SET
             added_at=excluded.added_at,local_updated_at=excluded.local_updated_at",
            params![
                relation.writing_id,
                relation.collection_id,
                relation.added_at,
                relation.local_updated_at
            ],
        )
        .map_err(|e| format!("collection snapshot relation: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("collection snapshot commit: {e}"))
}

#[tauri::command]
pub fn catalog_list_collection_snapshot(
    db_path: String,
) -> Result<CatalogCollectionSnapshot, String> {
    let conn = open_db(&db_path)?;
    let mut collection_stmt = conn.prepare(
        "SELECT id,owner_id,name,description,visibility,sync_status,lifecycle,deleted_at,created_at,updated_at,local_updated_at
         FROM collections WHERE deleted_at IS NULL ORDER BY local_updated_at DESC",
    ).map_err(|e| format!("catalog list collections prepare: {e}"))?;
    let collections = collection_stmt
        .query_map([], |row| {
            Ok(CatalogCollectionInput {
                id: row.get(0)?,
                owner_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                visibility: row.get(4)?,
                sync_status: row.get(5)?,
                lifecycle: row.get(6)?,
                deleted_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                local_updated_at: row.get(10)?,
            })
        })
        .map_err(|e| format!("catalog list collections query: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("catalog list collections row: {e}"))?;
    let mut relation_stmt = conn.prepare(
        "SELECT writing_id,collection_id,added_at,local_updated_at FROM writing_collections ORDER BY writing_id,collection_id",
    ).map_err(|e| format!("catalog list relations prepare: {e}"))?;
    let writing_collections = relation_stmt
        .query_map([], |row| {
            Ok(CatalogWritingCollectionInput {
                writing_id: row.get(0)?,
                collection_id: row.get(1)?,
                added_at: row.get(2)?,
                local_updated_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("catalog list relations query: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("catalog list relations row: {e}"))?;
    Ok(CatalogCollectionSnapshot {
        collections,
        writing_collections,
    })
}

#[tauri::command]
pub fn catalog_save_collection(
    db_path: String,
    collection: CatalogCollectionInput,
    mutation: Option<CatalogMetadataMutationInput>,
) -> Result<(), String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog save collection begin: {e}"))?;
    upsert_collection(&tx, &collection)?;
    if let Some(value) = mutation.as_ref() {
        enqueue_metadata_mutation(&tx, value)?;
    }
    tx.commit()
        .map_err(|e| format!("catalog save collection commit: {e}"))
}

#[tauri::command]
pub fn catalog_delete_collection(
    db_path: String,
    collection_id: String,
    deleted_at: String,
    local_updated_at: i64,
    mutation: CatalogMetadataMutationInput,
) -> Result<(), String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog delete collection begin: {e}"))?;
    tx.execute("UPDATE collections SET deleted_at=?2,sync_status='deleted',local_updated_at=?3 WHERE id=?1",
        params![collection_id, deleted_at, local_updated_at])
      .map_err(|e| format!("catalog delete collection: {e}"))?;
    enqueue_metadata_mutation(&tx, &mutation)?;
    tx.commit()
        .map_err(|e| format!("catalog delete collection commit: {e}"))
}

#[tauri::command]
pub fn catalog_replace_writing_collections(
    db_path: String,
    writing_id: String,
    collection_ids: Vec<String>,
    added_at: String,
    local_updated_at: i64,
    mutation: Option<CatalogMetadataMutationInput>,
) -> Result<(), String> {
    let mut conn = open_db(&db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("catalog replace relations begin: {e}"))?;
    tx.execute(
        "DELETE FROM writing_collections WHERE writing_id=?1",
        params![writing_id],
    )
    .map_err(|e| format!("catalog replace relations clear: {e}"))?;
    for collection_id in collection_ids {
        tx.execute("INSERT INTO writing_collections(writing_id,collection_id,added_at,local_updated_at) VALUES(?1,?2,?3,?4)",
            params![writing_id, collection_id, added_at, local_updated_at])
          .map_err(|e| format!("catalog replace relations insert: {e}"))?;
    }
    if let Some(value) = mutation.as_ref() {
        enqueue_metadata_mutation(&tx, value)?;
    }
    tx.commit()
        .map_err(|e| format!("catalog replace relations commit: {e}"))
}

#[tauri::command]
pub fn catalog_list_pending_metadata_mutations(
    db_path: String,
    now: i64,
    limit: usize,
) -> Result<Vec<CatalogMetadataMutationRow>, String> {
    let conn = open_db(&db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id,entity_kind,entity_id,operation,payload_json,status,attempt_count,next_retry_at,created_at,last_error
         FROM metadata_sync_mutations WHERE status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at<=?1)
         ORDER BY created_at ASC LIMIT ?2",
    ).map_err(|e| format!("catalog list metadata mutations prepare: {e}"))?;
    let rows = stmt
        .query_map(params![now, limit as i64], |row| {
            Ok(CatalogMetadataMutationRow {
                id: row.get(0)?,
                entity_kind: row.get(1)?,
                entity_id: row.get(2)?,
                operation: row.get(3)?,
                payload_json: row.get(4)?,
                status: row.get(5)?,
                attempt_count: row.get(6)?,
                next_retry_at: row.get(7)?,
                created_at: row.get(8)?,
                last_error: row.get(9)?,
            })
        })
        .map_err(|e| format!("catalog list metadata mutations query: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("catalog list metadata mutations row: {e}"))?;
    Ok(rows)
}

#[tauri::command]
pub fn catalog_update_metadata_mutation_status(
    db_path: String,
    mutation_id: String,
    status: String,
    attempt_count: i64,
    next_retry_at: Option<i64>,
    last_error: Option<String>,
) -> Result<(), String> {
    let conn = open_db(&db_path)?;
    conn.execute("UPDATE metadata_sync_mutations SET status=?2,attempt_count=?3,next_retry_at=?4,last_error=?5 WHERE id=?1",
        params![mutation_id, status, attempt_count, next_retry_at, last_error])
      .map_err(|e| format!("catalog update metadata mutation: {e}"))?;
    Ok(())
}

// Rollback for M1 (manual, only while the dual-write flag is disabled):
// DROP TABLE sync_mutations; DROP TABLE document_bindings; DROP TABLE documents;
// DROP TABLE binding_roots; DROP TABLE catalog_schema;
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
                deleted_at: None,
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
    fn catalog_migration_is_additive_and_versioned() {
        let path = temp_db();
        let started_at = std::time::Instant::now();
        let conn = open_db(&path).unwrap();
        let startup_ms = started_at.elapsed().as_secs_f64() * 1000.0;
        let version: i64 = conn
            .query_row("SELECT version FROM catalog_schema", [], |row| row.get(0))
            .unwrap();
        let cloud_hash_column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('documents') WHERE name='cloud_content_hash'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let deleted_at_column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('documents') WHERE name='deleted_at_cache'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let excerpt_columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('documents') WHERE name IN ('excerpt_cache','excerpt_content_hash')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let retired_root_column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('binding_roots') WHERE name='retired_at'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 8);
        assert_eq!(cloud_hash_column, 1);
        assert_eq!(deleted_at_column, 1);
        assert_eq!(excerpt_columns, 2);
        assert_eq!(retired_root_column, 1);
        eprintln!("catalog_startup_ms={startup_ms:.3}");
        assert!(startup_ms < 1000.0, "catalog startup exceeded 1s budget");
        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn markdown_excerpt_ignores_frontmatter_and_bounds_unicode_text() {
        let markdown = format!(
            "---\ntitle: Metadata only\ntags: [test]\n---\n# Guide CMP\n\n{}",
            "contenido ".repeat(30)
        );
        let excerpt = markdown_excerpt(&markdown).unwrap();
        assert!(excerpt.starts_with("Guide CMP contenido"));
        assert!(!excerpt.contains("Metadata only"));
        assert!(excerpt.chars().count() <= MAX_EXCERPT_CHARS);
        assert_eq!(markdown_excerpt("---\ntitle: Empty\n---\n"), None);
    }

    #[test]
    fn catalog_hydrates_excerpt_as_one_rebuildable_batch() {
        let path = temp_db();
        let root = std::env::temp_dir().join(format!("odessay-excerpt-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let document_path = root.join("guide.md");
        fs::write(
            &document_path,
            "---\ntitle: Guide\n---\n# Guide CMP\n\nSame content",
        )
        .unwrap();

        let mut catalog_input = input("doc-1", &document_path.to_string_lossy(), "mutation-1");
        let binding = catalog_input.binding.as_mut().unwrap();
        binding.root_path = root.to_string_lossy().to_string();
        binding.content_hash = Some("blake3:current".into());
        catalog_dual_write(path.clone(), catalog_input).unwrap();

        let updated = catalog_hydrate_excerpts(path.clone()).unwrap();
        assert_eq!(updated, vec!["doc-1"]);
        let row = catalog_get_by_id(path.clone(), "doc-1".into())
            .unwrap()
            .unwrap();
        assert_eq!(row.excerpt.as_deref(), Some("Guide CMP Same content"));
        assert_eq!(row.excerpt_content_hash.as_deref(), Some("blake3:current"));
        assert!(catalog_hydrate_excerpts(path.clone()).unwrap().is_empty());

        let _ = fs::remove_file(path);
        let _ = fs::remove_dir_all(root);
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
        assert!(
            dual_write_ms < 1000.0,
            "catalog dual-write exceeded 1s safety budget"
        );
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
    fn dual_write_reuses_existing_binding_root_for_the_same_path() {
        let path = temp_db();

        // First document registers the directory under a manifest root id (as the
        // reconciler would).
        let mut first = input("doc-a", "/tmp/shared/a.md", "mut-a");
        {
            let binding = first.binding.as_mut().unwrap();
            binding.binding_root_id = "manifest-root".into();
            binding.root_path = "/tmp/shared".into();
        }
        catalog_dual_write(path.clone(), first).unwrap();

        // A second document (e.g. the M5 migration) names the SAME directory with a
        // different `legacy-root:` id. This must NOT fail on UNIQUE(root_path).
        let mut second = input("doc-b", "/tmp/shared/b.md", "mut-b");
        {
            let binding = second.binding.as_mut().unwrap();
            binding.binding_root_id = "legacy-root:/tmp/shared".into();
            binding.root_path = "/tmp/shared".into();
        }
        catalog_dual_write(path.clone(), second).unwrap();

        let conn = open_db(&path).unwrap();
        let root_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM binding_roots WHERE root_path='/tmp/shared'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            root_count, 1,
            "one physical directory keeps one binding root"
        );

        // The second document is bound to the pre-existing root id, not a new one.
        let row = catalog_get_by_id(path.clone(), "doc-b".into())
            .unwrap()
            .unwrap();
        assert_eq!(row.binding_root_id.as_deref(), Some("manifest-root"));
        assert_eq!(row.canonical_path.as_deref(), Some("/tmp/shared/b.md"));

        drop(conn);
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
            path.clone(),
            "mutation-delete".into(),
            "synced".into(),
            0,
            None,
            None,
        )
        .unwrap();
        let record = catalog_get_by_id(path.clone(), "doc-local".into())
            .unwrap()
            .unwrap();
        assert!(record.local_present);
        assert!(!record.cloud_present);
        assert_eq!(record.sync_status, "local-only");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn permanent_delete_ack_purges_catalog_and_durable_queue_atomically() {
        let path = temp_db();
        let mut archived = input("doc-purge", "/tmp/root/purge.md", "mutation-purge");
        archived.document.local_present = false;
        archived.document.cloud_present = true;
        archived.document.deleted_at = Some("2026-07-29T00:00:00Z".into());
        archived.binding = None;
        archived.mutation.as_mut().unwrap().operation = "delete".into();
        catalog_dual_write(path.clone(), archived).unwrap();

        catalog_purge_document(path.clone(), "doc-purge".into()).unwrap();

        assert!(catalog_get_by_id(path.clone(), "doc-purge".into())
            .unwrap()
            .is_none());
        let conn = open_db(&path).unwrap();
        let mutations: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_mutations WHERE document_id='doc-purge'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(mutations, 0);
        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn confirmed_delete_stays_out_of_active_views_when_sync_fails() {
        let path = temp_db();
        let mut delete_input = input("doc-deleted", "/tmp/root/deleted.md", "mutation-delete");
        delete_input.document.local_present = false;
        delete_input.document.cloud_present = true;
        delete_input.document.cloud_account_id = Some("acct-1".into());
        delete_input.document.sync_status = "deleted".into();
        delete_input.document.deleted_at = Some("2026-07-18T00:00:00.000Z".into());
        delete_input.binding = None;
        delete_input.mutation.as_mut().unwrap().operation = "delete".into();
        catalog_dual_write(path.clone(), delete_input).unwrap();

        assert!(
            catalog_list(path.clone(), Some("acct-1".into()), false, false, 20)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            catalog_list(path.clone(), Some("acct-1".into()), true, false, 20)
                .unwrap()
                .len(),
            1
        );

        catalog_update_mutation_status(
            path.clone(),
            "mutation-delete".into(),
            "failed".into(),
            1,
            None,
            Some("offline".into()),
        )
        .unwrap();

        let record = catalog_get_by_id(path.clone(), "doc-deleted".into())
            .unwrap()
            .unwrap();
        assert_eq!(record.sync_status, "failed");
        assert!(record.deleted_at.is_some());
        assert!(
            catalog_list(path.clone(), Some("acct-1".into()), false, false, 20)
                .unwrap()
                .is_empty()
        );

        // A stale cloud hydration can still report the row as active while the
        // delete mutation is offline. It must not clear the durable local marker.
        catalog_apply_cloud_snapshots(
            path.clone(),
            vec![CatalogCloudSnapshotInput {
                id: "doc-deleted".into(),
                cloud_present: true,
                cloud_account_id: Some("acct-1".into()),
                content_hash: Some("hash-before-delete".into()),
                title: Some("Deleted doc".into()),
                slug: None,
                status: Some("draft".into()),
                artifact_type: Some("general".into()),
                visibility: Some("private".into()),
                version: Some(1),
                deleted_at: None,
                created_at: Some(1),
                modified_at: Some(2),
            }],
        )
        .unwrap();

        let after_hydration = catalog_get_by_id(path.clone(), "doc-deleted".into())
            .unwrap()
            .unwrap();
        assert!(after_hydration.deleted_at.is_some());
        assert!(
            catalog_list(path.clone(), Some("acct-1".into()), false, false, 20)
                .unwrap()
                .is_empty()
        );
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

    #[test]
    fn cloud_snapshot_batch_preserves_local_presence_and_pending_mutations() {
        let path = temp_db();
        let local = input("doc-local", "/tmp/root/local.md", "mut-local");
        catalog_dual_write(path.clone(), local).unwrap();

        catalog_apply_cloud_snapshots(
            path.clone(),
            vec![
                CatalogCloudSnapshotInput {
                    id: "doc-local".into(),
                    cloud_present: true,
                    cloud_account_id: Some("acct-1".into()),
                    content_hash: Some("hash-local".into()),
                    title: Some("Cloud metadata".into()),
                    slug: Some("cloud".into()),
                    status: Some("draft".into()),
                    artifact_type: Some("general".into()),
                    visibility: Some("private".into()),
                    version: Some(2),
                    deleted_at: None,
                    created_at: Some(1),
                    modified_at: Some(2),
                },
                CatalogCloudSnapshotInput {
                    id: "doc-cloud".into(),
                    cloud_present: true,
                    cloud_account_id: Some("acct-1".into()),
                    content_hash: Some("hash-cloud".into()),
                    title: Some("Cloud only".into()),
                    slug: None,
                    status: Some("draft".into()),
                    artifact_type: Some("general".into()),
                    visibility: Some("private".into()),
                    version: Some(1),
                    deleted_at: None,
                    created_at: Some(1),
                    modified_at: Some(1),
                },
            ],
        )
        .unwrap();

        let local = catalog_get_by_id(path.clone(), "doc-local".into())
            .unwrap()
            .unwrap();
        assert!(
            local.local_present,
            "cloud hydration cannot clear local presence"
        );
        assert!(local.cloud_present);
        assert_eq!(local.sync_status, "pending", "pending local work wins");
        assert_eq!(local.title.as_deref(), Some("Cloud metadata"));

        let cloud = catalog_get_by_id(path.clone(), "doc-cloud".into())
            .unwrap()
            .unwrap();
        assert!(!cloud.local_present);
        assert!(cloud.cloud_present);
        assert_eq!(cloud.cloud_account_id.as_deref(), Some("acct-1"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn catalog_account_filter_hides_only_cloud_only_rows_on_logout() {
        let path = temp_db();
        catalog_dual_write(
            path.clone(),
            input("local", "/tmp/root/local.md", "mut-local"),
        )
        .unwrap();
        let snapshot = |id: &str, account: &str| CatalogCloudSnapshotInput {
            id: id.into(),
            cloud_present: true,
            cloud_account_id: Some(account.into()),
            content_hash: Some(format!("hash-{id}")),
            title: Some(id.into()),
            slug: None,
            status: Some("draft".into()),
            artifact_type: Some("general".into()),
            visibility: Some("private".into()),
            version: Some(1),
            deleted_at: None,
            created_at: Some(1),
            modified_at: Some(1),
        };
        catalog_apply_cloud_snapshots(
            path.clone(),
            vec![snapshot("cloud-a", "acct-a"), snapshot("cloud-b", "acct-b")],
        )
        .unwrap();

        let signed_in =
            catalog_list(path.clone(), Some("acct-a".into()), false, false, 20).unwrap();
        assert!(signed_in.iter().any(|row| row.id == "local"));
        assert!(signed_in.iter().any(|row| row.id == "cloud-a"));
        assert!(!signed_in.iter().any(|row| row.id == "cloud-b"));

        let signed_out = catalog_list(path.clone(), None, false, false, 20).unwrap();
        assert!(signed_out.iter().any(|row| row.id == "local"));
        assert!(!signed_out
            .iter()
            .any(|row| row.id == "cloud-a" || row.id == "cloud-b"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn cloud_hash_lookup_returns_only_eligible_candidates() {
        let path = temp_db();
        let snapshot = |id: &str| CatalogCloudSnapshotInput {
            id: id.into(),
            cloud_present: true,
            cloud_account_id: Some("acct".into()),
            content_hash: Some("same-hash".into()),
            title: Some(id.into()),
            slug: None,
            status: Some("draft".into()),
            artifact_type: Some("general".into()),
            visibility: Some("private".into()),
            version: Some(1),
            deleted_at: None,
            created_at: Some(1),
            modified_at: Some(1),
        };
        catalog_apply_cloud_snapshots(path.clone(), vec![snapshot("cloud-a"), snapshot("cloud-b")])
            .unwrap();

        let candidates =
            catalog_find_eligible_cloud_hash(path.clone(), "same-hash".into(), "acct".into())
                .unwrap();
        assert_eq!(
            candidates,
            vec!["cloud-a", "cloud-b"],
            "two candidates are ambiguous"
        );

        let local = input("local", "/tmp/root/local.md", "mut-local");
        catalog_dual_write(path.clone(), local).unwrap();
        catalog_apply_cloud_snapshots(path.clone(), vec![snapshot("local")]).unwrap();
        let candidates =
            catalog_find_eligible_cloud_hash(path.clone(), "same-hash".into(), "acct".into())
                .unwrap();
        assert_eq!(
            candidates,
            vec!["cloud-a", "cloud-b"],
            "local and pending rows are ineligible"
        );
        let other_account =
            catalog_find_eligible_cloud_hash(path.clone(), "same-hash".into(), "other".into())
                .unwrap();
        assert!(
            other_account.is_empty(),
            "hash candidates are account-scoped"
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn collection_snapshot_roundtrips_without_indexeddb() {
        let path = temp_db();
        catalog_apply_collection_snapshot(
            path.clone(),
            CatalogCollectionSnapshot {
                collections: vec![CatalogCollectionInput {
                    id: "collection-1".into(),
                    owner_id: Some("acct".into()),
                    name: "Research".into(),
                    description: None,
                    visibility: "private".into(),
                    sync_status: "synced".into(),
                    lifecycle: "server-confirmed".into(),
                    deleted_at: None,
                    created_at: "2026-01-01T00:00:00Z".into(),
                    updated_at: "2026-01-02T00:00:00Z".into(),
                    local_updated_at: 2,
                }],
                writing_collections: vec![CatalogWritingCollectionInput {
                    writing_id: "doc-1".into(),
                    collection_id: "collection-1".into(),
                    added_at: "2026-01-02T00:00:00Z".into(),
                    local_updated_at: 2,
                }],
            },
        )
        .unwrap();

        let snapshot = catalog_list_collection_snapshot(path.clone()).unwrap();
        assert_eq!(snapshot.collections.len(), 1);
        assert_eq!(snapshot.collections[0].name, "Research");
        assert_eq!(snapshot.writing_collections.len(), 1);
        assert_eq!(snapshot.writing_collections[0].writing_id, "doc-1");
        assert_eq!(catalog_schema_version(path.clone()).unwrap(), 8);
        let _ = fs::remove_file(path);
    }

    /// Seed one document bound to `root-1` with the requested cloud presence.
    fn seed_bound_document(path: &str, id: &str, cloud_present: bool) {
        let mut seed = input(id, &format!("/tmp/root/{id}.md"), &format!("m-{id}"));
        seed.document.cloud_present = cloud_present;
        seed.document.cloud_account_id = cloud_present.then(|| "user-1".to_string());
        seed.document.sync_status = if cloud_present {
            "synced"
        } else {
            "local-only"
        }
        .into();
        seed.mutation = None;
        catalog_dual_write(path.to_string(), seed).unwrap();
    }

    fn deleted_at_cache_of(path: &str, id: &str) -> Option<String> {
        open_db(path)
            .unwrap()
            .query_row(
                "SELECT deleted_at_cache FROM documents WHERE id=?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap()
    }

    #[test]
    fn lists_every_document_bound_to_a_root_for_manifest_recovery() {
        let path = temp_db();
        seed_bound_document(&path, "document-b", false);
        seed_bound_document(&path, "document-a", true);

        let rows = catalog_list_binding_root_documents(path.clone(), "root-1".into()).unwrap();

        assert_eq!(
            rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            vec!["document-a", "document-b"]
        );
        assert!(rows
            .iter()
            .all(|row| row.binding_root_id.as_deref() == Some("root-1")));

        let _ = fs::remove_file(path);
    }

    /// ODE-408: `deleted_at_cache` is a CLOUD tombstone and drives Settings >
    /// Archived writings. A local-only document has no cloud row, so removing its
    /// workspace must never stamp one — not even through the schema normalizer
    /// that `open_db` runs on every connection.
    #[test]
    fn workspace_removal_never_fabricates_a_cloud_tombstone_for_local_only() {
        let path = temp_db();
        seed_bound_document(&path, "local-doc", false);

        catalog_apply_workspace_removal(
            path.clone(),
            "root-1".into(),
            "/tmp/root".into(),
            "2026-07-30T00:00:00Z".into(),
            "2026-07-30T00:00:00Z".into(),
            10,
        )
        .unwrap();

        // Every `open_db` re-runs the normalizer; this is the call that used to
        // convert the local-only row into a fake archived one.
        assert_eq!(deleted_at_cache_of(&path, "local-doc"), None);

        let pending: i64 = open_db(&path)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM sync_mutations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            pending, 0,
            "a local-only document must not queue cloud work"
        );

        // Gone from the active catalog, and absent from Archived writings, which
        // lists rows carrying a tombstone.
        let active = catalog_list(path.clone(), None, false, false, 100).unwrap();
        assert!(active.iter().all(|row| row.id != "local-doc"));
        let archived = catalog_list(path.clone(), None, true, false, 100).unwrap();
        assert!(archived
            .iter()
            .filter(|row| row.deleted_at.is_some())
            .all(|row| row.id != "local-doc"));

        let _ = fs::remove_file(path);
    }

    /// The normalizer self-heals installs that were stamped before it was scoped
    /// to cloud-backed rows.
    #[test]
    fn schema_normalizer_clears_legacy_tombstones_from_local_only_rows() {
        let path = temp_db();
        seed_bound_document(&path, "local-doc", false);
        open_db(&path)
            .unwrap()
            .execute(
                "UPDATE documents SET sync_status='deleted', deleted_at_cache='legacy' WHERE id=?1",
                params!["local-doc"],
            )
            .unwrap();

        // Reopening runs the normalizer.
        assert_eq!(deleted_at_cache_of(&path, "local-doc"), None);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn workspace_removal_soft_deletes_cloud_documents_and_queues_one_mutation() {
        let path = temp_db();
        seed_bound_document(&path, "cloud-doc", true);

        let affected = catalog_apply_workspace_removal(
            path.clone(),
            "root-1".into(),
            "/tmp/root".into(),
            "2026-07-30T00:00:00Z".into(),
            "2026-07-30T00:00:00Z".into(),
            10,
        )
        .unwrap();
        assert_eq!(affected, vec!["cloud-doc".to_string()]);

        assert_eq!(
            deleted_at_cache_of(&path, "cloud-doc"),
            Some("2026-07-30T00:00:00Z".into())
        );

        let conn = open_db(&path).unwrap();
        let (count, operation): (i64, String) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(MAX(operation),'') FROM sync_mutations WHERE document_id=?1",
                params!["cloud-doc"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 1, "one durable soft-delete, never N per view");
        assert_eq!(operation, "delete");

        // Soft delete: the cloud row is still ours, so it stays listed as archived.
        let archived = catalog_list(path.clone(), Some("user-1".into()), true, false, 100).unwrap();
        assert!(archived
            .iter()
            .any(|row| row.id == "cloud-doc" && row.deleted_at.is_some()));

        drop(conn);
        let _ = fs::remove_file(path);
    }

    /// Simulates a process stop after SQLite commits but before Settings is
    /// cleaned. Reopening the database retains the fence, and retrying removal
    /// cannot enqueue a second cloud delete.
    #[test]
    fn workspace_removal_fence_survives_restart_and_is_idempotent() {
        let path = temp_db();
        seed_bound_document(&path, "cloud-doc", true);

        catalog_apply_workspace_removal(
            path.clone(),
            "root-1".into(),
            "/tmp/root".into(),
            "2026-08-02T00:00:00Z".into(),
            "2026-08-02T00:00:00Z".into(),
            20,
        )
        .unwrap();

        let retired = catalog_list_retired_binding_roots(path.clone()).unwrap();
        assert_eq!(retired.len(), 1);
        assert_eq!(retired[0].id, "root-1");

        let retry = catalog_apply_workspace_removal(
            path.clone(),
            "root-1".into(),
            "/tmp/root".into(),
            "2026-08-02T00:00:01Z".into(),
            "2026-08-02T00:00:01Z".into(),
            21,
        )
        .unwrap();
        assert!(retry.is_empty());

        let conn = open_db(&path).unwrap();
        let mutations: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_mutations WHERE document_id='cloud-doc' AND operation='delete'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(mutations, 1);
        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn workspace_removal_resolves_an_existing_root_by_path() {
        let path = temp_db();
        seed_bound_document(&path, "local-doc", false);

        let affected = catalog_apply_workspace_removal(
            path.clone(),
            "settings-root".into(),
            "/tmp/root".into(),
            "2026-08-02T00:00:00Z".into(),
            "2026-08-02T00:00:00Z".into(),
            20,
        )
        .unwrap();
        assert_eq!(affected, vec!["local-doc".to_string()]);

        let retired = catalog_list_retired_binding_roots(path.clone()).unwrap();
        assert_eq!(retired.len(), 1);
        assert_eq!(retired[0].id, "root-1");

        let conn = open_db(&path).unwrap();
        let stale_settings_root: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM binding_roots WHERE id='settings-root'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stale_settings_root, 0);
        drop(conn);
        let _ = fs::remove_file(path);
    }

    /// Models the watcher callback already queued before removal. Its stale
    /// snapshot reaches SQLite after the fence and must be ignored atomically.
    #[test]
    fn retired_root_rejects_late_watcher_reprojection() {
        let path = temp_db();
        seed_bound_document(&path, "local-doc", false);
        catalog_apply_workspace_removal(
            path.clone(),
            "root-1".into(),
            "/tmp/root".into(),
            "2026-08-02T00:00:00Z".into(),
            "2026-08-02T00:00:00Z".into(),
            20,
        )
        .unwrap();

        let applied = catalog_apply_reconcile(
            path.clone(),
            CatalogReconcileInput {
                upserts: vec![CatalogLocalBindingInput {
                    binding_root_id: "stale-watcher-root".into(),
                    root_path: "/tmp/root".into(),
                    manifest_version: 2,
                    visible_as_workspace: true,
                    document_id: "local-doc".into(),
                    relative_path: "local-doc.md".into(),
                    canonical_path: "/tmp/root/local-doc.md".into(),
                    inode: Some(1),
                    content_hash: Some("blake3:late".into()),
                    size: Some(10),
                    last_seen_at: Some(30),
                    title: "local-doc".into(),
                    created_at: Some(1),
                    modified_at: Some(30),
                }],
                detached: vec![],
            },
        )
        .unwrap();
        assert!(!applied);

        let conn = open_db(&path).unwrap();
        let bindings: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM document_bindings WHERE binding_root_id='root-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let local_present: i64 = conn
            .query_row(
                "SELECT local_present FROM documents WHERE id='local-doc'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(bindings, 0);
        assert_eq!(local_present, 0);
        drop(conn);
        let _ = fs::remove_file(path);
    }

    /// Re-adding the folder: local-only documents come back on their own, and only
    /// cloud-archived ones are handed to the caller for the "local wins" upsert.
    #[test]
    fn reactivate_binding_root_restores_local_only_and_returns_only_cloud_archived() {
        let path = temp_db();
        seed_bound_document(&path, "local-doc", false);
        seed_bound_document(&path, "cloud-doc", true);

        catalog_apply_workspace_removal(
            path.clone(),
            "root-1".into(),
            "/tmp/root".into(),
            "2026-07-30T00:00:00Z".into(),
            "2026-07-30T00:00:00Z".into(),
            10,
        )
        .unwrap();

        catalog_activate_binding_root(path.clone(), "root-1".into(), "/tmp/root".into()).unwrap();

        // The reconciler re-binds both files from the surviving manifest. It only
        // moves local presence and the binding — unlike dual-write, it never
        // clears the cloud tombstone, which is why reactivation has work to do.
        let conn = open_db(&path).unwrap();
        for id in ["local-doc", "cloud-doc"] {
            conn.execute(
                "INSERT INTO document_bindings(document_id,binding_root_id,relative_path,canonical_path,inode,content_hash,size,last_seen_at)
                 VALUES(?1,'root-1',?2,?3,NULL,NULL,NULL,3)",
                params![id, format!("{id}.md"), format!("/tmp/root/{id}.md")],
            )
            .unwrap();
            conn.execute(
                "UPDATE documents SET local_present=1 WHERE id=?1",
                params![id],
            )
            .unwrap();
        }
        drop(conn);

        let returned = catalog_reactivate_binding_root(path.clone(), "root-1".into()).unwrap();

        assert_eq!(
            returned
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            vec!["cloud-doc"],
            "a local-only document must never enter the cloud upsert batch"
        );

        // The local-only one is back in the active catalog without any cloud work.
        let active = catalog_list(path.clone(), None, false, false, 100).unwrap();
        assert!(active.iter().any(|row| row.id == "local-doc"));

        let _ = fs::remove_file(path);
    }

    /// Regression, found on the packaged DMG 2026-08-04.
    ///
    /// Cloud hydration projects an archived document as `cloud_present=0`
    /// (`cloudPresent: !row.deleted_at`), so after any app restart an archived row
    /// has a cloud record AND `cloud_present=0`. Reactivation used to require
    /// `cloud_present=1`, a condition that becomes unsatisfiable at that point:
    /// the document was reclassified as local-only and stranded — hidden from
    /// Desk, still tombstoned in Archived writings, never restored.
    #[test]
    fn reactivate_binding_root_restores_a_cloud_document_archived_across_a_restart() {
        let path = temp_db();
        seed_bound_document(&path, "cloud-doc", true);

        catalog_apply_workspace_removal(
            path.clone(),
            "root-1".into(),
            "/tmp/root".into(),
            "2026-08-04T00:00:00Z".into(),
            "2026-08-04T00:00:00Z".into(),
            10,
        )
        .unwrap();

        // Startup hydration of the tombstoned cloud row: presence drops to 0 while
        // the account and the tombstone survive. This is the state the old filter
        // could never match.
        let conn = open_db(&path).unwrap();
        conn.execute(
            "UPDATE documents SET cloud_present=0, sync_status='deleted' WHERE id='cloud-doc'",
            [],
        )
        .unwrap();
        // The reconciler re-binds the surviving `.md` after the folder is re-added.
        conn.execute(
            "INSERT INTO document_bindings(document_id,binding_root_id,relative_path,canonical_path,inode,content_hash,size,last_seen_at)
             VALUES('cloud-doc','root-1','cloud-doc.md','/tmp/root/cloud-doc.md',NULL,NULL,NULL,3)",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE documents SET local_present=1 WHERE id='cloud-doc'",
            [],
        )
        .unwrap();
        drop(conn);

        let returned = catalog_reactivate_binding_root(path.clone(), "root-1".into()).unwrap();

        assert_eq!(
            returned
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            vec!["cloud-doc"],
            "an archived cloud document must still be reactivatable after hydration"
        );

        // And it must not have been silently reclassified as local-only on the way.
        let sync_status: String = open_db(&path)
            .unwrap()
            .query_row(
                "SELECT sync_status FROM documents WHERE id='cloud-doc'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(
            sync_status, "local-only",
            "a cloud-archived document is not a local-only document"
        );

        let _ = fs::remove_file(path);
    }

    /// The companion guard: a genuine local-only document — no cloud account, no
    /// tombstone — still returns to the active catalog and still stays out of the
    /// cloud batch.
    #[test]
    fn reactivate_binding_root_still_excludes_a_genuine_local_only_document() {
        let path = temp_db();
        seed_bound_document(&path, "local-doc", false);

        catalog_apply_workspace_removal(
            path.clone(),
            "root-1".into(),
            "/tmp/root".into(),
            "2026-08-04T00:00:00Z".into(),
            "2026-08-04T00:00:00Z".into(),
            10,
        )
        .unwrap();

        let conn = open_db(&path).unwrap();
        conn.execute(
            "INSERT INTO document_bindings(document_id,binding_root_id,relative_path,canonical_path,inode,content_hash,size,last_seen_at)
             VALUES('local-doc','root-1','local-doc.md','/tmp/root/local-doc.md',NULL,NULL,NULL,3)",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE documents SET local_present=1 WHERE id='local-doc'",
            [],
        )
        .unwrap();
        drop(conn);

        let returned = catalog_reactivate_binding_root(path.clone(), "root-1".into()).unwrap();

        assert!(
            returned.is_empty(),
            "a local-only document must never enter the cloud upsert batch"
        );
        let active = catalog_list(path.clone(), None, false, false, 100).unwrap();
        assert!(active.iter().any(|row| row.id == "local-doc"));

        let _ = fs::remove_file(path);
    }
}
