use rusqlite::{params, Connection};
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
    ensure_table(&conn)?;
    Ok(conn)
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
    conn.execute(
        "DELETE FROM writings_index WHERE path = ?1",
        params![path],
    )
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
