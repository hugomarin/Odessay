use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceFileSnapshot {
    pub id: String,
    pub path: String,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub name: String,
    #[serde(rename = "modifiedAt")]
    pub modified_at: u64,
    pub size: u64,
    pub inode: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceSnapshot {
    #[serde(rename = "rootPath")]
    pub root_path: String,
    pub name: String,
    #[serde(rename = "fileCount")]
    pub file_count: usize,
    #[serde(rename = "folderCount")]
    pub folder_count: usize,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<u64>,
    pub files: Vec<WorkspaceFileSnapshot>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct WorkspaceIndexDocument {
    version: u8,
    files: HashMap<String, WorkspaceIndexEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct WorkspaceIndexEntry {
    id: String,
    inode: u64,
    #[serde(rename = "lastSeen")]
    last_seen: u64,
    size: u64,
}

#[tauri::command]
pub fn workspace_create(parent_path: String, name: String) -> Result<String, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("workspace_create: name is required".to_string());
    }

    let target = Path::new(&parent_path).join(trimmed_name);
    if target.exists() {
        return Err(format!(
            "workspace_create: folder already exists: {}",
            target.display()
        ));
    }

    fs::create_dir_all(&target).map_err(|e| format!("workspace_create create_dir_all: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_sync(root_path: String) -> Result<WorkspaceSnapshot, String> {
    let root = Path::new(&root_path);
    if !root.exists() {
        return Err(format!(
            "workspace_sync: folder not found: {}",
            root.display()
        ));
    }
    if !root.is_dir() {
        return Err(format!("workspace_sync: not a folder: {}", root.display()));
    }

    let odyssey_dir = root.join(".odyssey");
    fs::create_dir_all(&odyssey_dir).map_err(|e| format!("workspace_sync create_dir_all: {e}"))?;

    let index_path = odyssey_dir.join("index.json");
    let existing_index = read_workspace_index(&index_path)?;

    let mut files = Vec::new();
    let mut folder_count = 0usize;
    visit_workspace(root, root, &mut files, &mut folder_count)?;

    let mut files_with_ids = Vec::new();
    let mut next_index = WorkspaceIndexDocument {
        version: 1,
        files: HashMap::new(),
    };
    let mut existing_by_inode = HashMap::new();

    for (relative_path, entry) in &existing_index.files {
        if entry.inode > 0 {
            existing_by_inode.insert(entry.inode, (relative_path.clone(), entry.clone()));
        }
    }

    for mut file in files {
        let existing_entry = existing_index
            .files
            .get(&file.relative_path)
            .cloned()
            .or_else(|| {
                existing_by_inode
                    .get(&file.inode)
                    .map(|(_, entry)| entry.clone())
            });

        let id = existing_entry
            .map(|entry| entry.id)
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        file.id = id.clone();
        next_index.files.insert(
            file.relative_path.clone(),
            WorkspaceIndexEntry {
                id,
                inode: file.inode,
                last_seen: file.modified_at,
                size: file.size,
            },
        );
        files_with_ids.push(file);
    }

    let index_json = serde_json::to_string_pretty(&next_index)
        .map_err(|e| format!("workspace_sync serialize: {e}"))?;
    fs::write(&index_path, index_json).map_err(|e| format!("workspace_sync write index: {e}"))?;

    files_with_ids.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    let updated_at = files_with_ids.first().map(|file| file.modified_at);
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Workspace")
        .to_string();

    Ok(WorkspaceSnapshot {
        root_path: root_path.clone(),
        name,
        file_count: files_with_ids.len(),
        folder_count,
        updated_at,
        files: files_with_ids,
    })
}

fn read_workspace_index(index_path: &Path) -> Result<WorkspaceIndexDocument, String> {
    if !index_path.exists() {
        return Ok(WorkspaceIndexDocument {
            version: 1,
            files: HashMap::new(),
        });
    }

    let contents =
        fs::read_to_string(index_path).map_err(|e| format!("workspace_sync read index: {e}"))?;

    serde_json::from_str(&contents).map_err(|e| format!("workspace_sync parse index: {e}"))
}

fn visit_workspace(
    root: &Path,
    current: &Path,
    files: &mut Vec<WorkspaceFileSnapshot>,
    folder_count: &mut usize,
) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|e| format!("workspace_sync read_dir: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("workspace_sync dir entry: {e}"))?;
        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        if name == ".odyssey" {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|e| format!("workspace_sync metadata: {e}"))?;

        if metadata.is_dir() {
            *folder_count += 1;
            visit_workspace(root, &path, files, folder_count)?;
            continue;
        }

        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());

        if extension.as_deref() != Some("md") && extension.as_deref() != Some("txt") {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .map_err(|e| format!("workspace_sync relative path: {e}"))?
            .to_string_lossy()
            .replace('\\', "/");
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);

        files.push(WorkspaceFileSnapshot {
            id: String::new(),
            path: path.to_string_lossy().to_string(),
            relative_path,
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            modified_at,
            size: metadata.len(),
            inode: inode_for_path(&path),
        });
    }

    Ok(())
}

#[cfg(unix)]
fn inode_for_path(path: &PathBuf) -> u64 {
    use std::os::unix::fs::MetadataExt;

    fs::metadata(path)
        .map(|metadata| metadata.ino())
        .unwrap_or(0)
}

#[cfg(not(unix))]
fn inode_for_path(_path: &PathBuf) -> u64 {
    0
}
