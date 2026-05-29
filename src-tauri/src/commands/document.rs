use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileMetadata {
    pub path: String,
    pub name: String,
    #[serde(rename = "modifiedAt")]
    pub modified_at: u64,
    pub size: u64,
}

/// Read and return the full text content of a .md file.
#[tauri::command]
pub fn open_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("open_file: {e}"))
}

/// Create a new empty .md file in `dir/filename`. Creates parent dirs if missing.
/// Returns the absolute path of the newly created file.
#[tauri::command]
pub fn create_file(dir: String, filename: String) -> Result<String, String> {
    let dir_path = Path::new(&dir);
    if !dir_path.exists() {
        fs::create_dir_all(dir_path).map_err(|e| format!("create_dir_all: {e}"))?;
    }
    let file_path = dir_path.join(&filename);
    if file_path.exists() {
        return Err(format!("file already exists: {}", file_path.display()));
    }
    fs::write(&file_path, "").map_err(|e| format!("create_file write: {e}"))?;
    Ok(file_path.to_string_lossy().to_string())
}

/// Atomically write `content` to `path` by writing a .tmp sibling then renaming.
/// Creates parent directories if they don't exist.
/// The promise resolves only after the file is fully persisted.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
        }
    }
    let tmp_path = format!("{}.tmp", path);
    fs::write(&tmp_path, &content).map_err(|e| format!("write_file tmp: {e}"))?;
    fs::rename(&tmp_path, target).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("write_file rename: {e}")
    })
}

/// Rename a file from `old_path` to `new_path`. Returns `new_path` on success.
#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<String, String> {
    let new = Path::new(&new_path);
    if let Some(parent) = new.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
        }
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("rename_file: {e}"))?;
    Ok(new_path)
}

/// List .md files in `dir`, sorted by modification time descending.
/// Returns at most `limit` entries. Returns empty vec if `dir` does not exist.
#[tauri::command]
pub fn list_recent_files(dir: String, limit: usize) -> Result<Vec<FileMetadata>, String> {
    let dir_path = Path::new(&dir);
    if !dir_path.exists() {
        return Ok(vec![]);
    }

    let mut files: Vec<FileMetadata> = fs::read_dir(dir_path)
        .map_err(|e| format!("list_recent_files read_dir: {e}"))?
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
            let name = path.file_stem()?.to_string_lossy().to_string();
            Some(FileMetadata {
                path: path.to_string_lossy().to_string(),
                name,
                modified_at,
                size: metadata.len(),
            })
        })
        .collect();

    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    files.truncate(limit);
    Ok(files)
}
