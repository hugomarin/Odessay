use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use uuid::Uuid;

const WORKSPACE_DIR_NAME: &str = ".odessay";
const LEGACY_WORKSPACE_DIR_NAME: &str = concat!(".ody", "ssey");
const WORKSPACE_INDEX_FILE_NAME: &str = "index.json";
const CONTENT_HASH_PREFIX: &str = "blake3";

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
    #[serde(rename = "contentHash")]
    pub content_hash: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceSnapshot {
    #[serde(rename = "rootPath")]
    pub root_path: String,
    #[serde(rename = "bindingRootId")]
    pub binding_root_id: String,
    pub name: String,
    #[serde(rename = "fileCount")]
    pub file_count: usize,
    #[serde(rename = "folderCount")]
    pub folder_count: usize,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<u64>,
    #[serde(rename = "selectedPaths")]
    pub selected_paths: Vec<String>,
    pub files: Vec<WorkspaceFileSnapshot>,
}

const WORKSPACE_INDEX_VERSION: u8 = 2;

#[derive(Debug, Serialize, Deserialize, Default)]
struct WorkspaceIndexDocument {
    version: u8,
    /// Manifest v2 durable BindingRoot identity. Absent in v1 manifests; a fresh
    /// id is minted the first time a v1 manifest is written back as v2.
    #[serde(
        rename = "bindingRootId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    binding_root_id: Option<String>,
    #[serde(rename = "selectedPaths", default)]
    selected_paths: Vec<String>,
    files: HashMap<String, WorkspaceIndexEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct WorkspaceIndexEntry {
    id: String,
    inode: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content_hash: Option<String>,
    #[serde(rename = "lastSeen")]
    last_seen: u64,
    size: u64,
}

/// Return true if any path component is exactly "..".
fn has_path_traversal(path: &str) -> bool {
    path.split(|c: char| c == '/' || c == '\\')
        .any(|component| component == "..")
}

fn normalize_selected_paths(selected_paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();

    for selected_path in selected_paths {
        let trimmed = selected_path.trim().replace('\\', "/");
        let cleaned = trimmed.trim_matches('/').to_string();

        if cleaned.is_empty() {
            continue;
        }

        if has_path_traversal(&cleaned) {
            return Err(format!(
                "workspace_sync: selectedPaths contains invalid path component '..': {}",
                selected_path
            ));
        }

        if !normalized.iter().any(|existing| existing == &cleaned) {
            normalized.push(cleaned);
        }
    }

    normalized.sort();
    Ok(normalized)
}

fn should_ignore_entry(name: &str, is_dir: bool) -> bool {
    // Internal/system directories are always skipped, regardless of dot-prefix.
    if name == WORKSPACE_DIR_NAME
        || name == LEGACY_WORKSPACE_DIR_NAME
        || name == ".git"
        || name == "node_modules"
    {
        return true;
    }

    if is_dir {
        // Hidden directories (e.g. ".agents") are kept: they often hold markdown
        // the user wants to track. Only the explicit denylist above is excluded.
        return false;
    }

    // Files: skip hidden dotfiles (e.g. ".DS_Store") and temp files.
    if name.starts_with('.') {
        return true;
    }

    if name.ends_with(".tmp") {
        return true;
    }

    false
}

fn is_markdown_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("mdx")
    )
}

fn matches_selected_paths(relative_path: &str, selected_paths: &[String]) -> bool {
    if selected_paths.is_empty() {
        return true;
    }

    selected_paths.iter().any(|selected_path| {
        relative_path == selected_path || relative_path.starts_with(&format!("{selected_path}/"))
    })
}

fn count_included_folders(files: &[WorkspaceFileSnapshot]) -> usize {
    let mut folders = HashSet::new();

    for file in files {
        let mut current = String::new();
        let mut segments = file.relative_path.split('/').collect::<Vec<_>>();
        segments.pop();

        for segment in segments {
            current = if current.is_empty() {
                segment.to_string()
            } else {
                format!("{current}/{}", segment)
            };
            folders.insert(current.clone());
        }
    }

    folders.len()
}

#[tauri::command]
pub fn workspace_create(parent_path: String, name: String) -> Result<String, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("workspace_create: name is required".to_string());
    }

    // Reject path traversal in parent_path
    if has_path_traversal(&parent_path) {
        return Err(
            "workspace_create: parent_path contains invalid path component '..'".to_string(),
        );
    }

    // Reject path traversal or separator characters in name
    if has_path_traversal(trimmed_name) || trimmed_name.contains('/') || trimmed_name.contains('\\')
    {
        return Err("workspace_create: name contains invalid characters".to_string());
    }

    let parent = Path::new(&parent_path);
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("workspace_create: invalid parent_path: {e}"))?;

    let target = canonical_parent.join(trimmed_name);

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
pub fn workspace_sync(
    root_path: String,
    selected_paths: Option<Vec<String>>,
) -> Result<WorkspaceSnapshot, String> {
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

    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("workspace_sync: failed to canonicalize root_path: {e}"))?;

    let workspace_dir = prepare_workspace_index_dir(&canonical_root)?;

    let index_path = workspace_dir.join(WORKSPACE_INDEX_FILE_NAME);
    let existing_index = read_workspace_index(&index_path)?;
    let mut effective_selected_paths = match selected_paths {
        Some(selected_paths) => normalize_selected_paths(selected_paths)?,
        None => normalize_selected_paths(existing_index.selected_paths.clone())?,
    };

    let mut files = Vec::new();
    let mut folder_count = 0usize;
    visit_workspace(
        &canonical_root,
        &canonical_root,
        &mut files,
        &mut folder_count,
    )?;

    // An exact-file selection follows a Finder rename by inode. Update the scope
    // before filtering so the renamed file remains visible and the manifest
    // persists the new relative path. Folder selections do not follow files that
    // move outside their selected subtree.
    let exact_selected_by_inode: HashMap<u64, String> = existing_index
        .files
        .iter()
        .filter(|(path, entry)| {
            entry.inode > 0 && effective_selected_paths.iter().any(|selected| selected == *path)
        })
        .map(|(path, entry)| (entry.inode, path.clone()))
        .collect();
    for file in &files {
        if matches_selected_paths(&file.relative_path, &effective_selected_paths) {
            continue;
        }
        if let Some(previous_path) = exact_selected_by_inode.get(&file.inode) {
            for selected in &mut effective_selected_paths {
                if selected == previous_path {
                    *selected = file.relative_path.clone();
                }
            }
        }
    }
    files.retain(|file| matches_selected_paths(&file.relative_path, &effective_selected_paths));
    folder_count = count_included_folders(&files);

    // Manifest v2: the BindingRoot id is durable evidence and survives v1→v2
    // migration. Reuse the existing id, else mint one now (first write-back).
    let binding_root_id = existing_index
        .binding_root_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut files_with_ids = Vec::new();
    let mut next_index = WorkspaceIndexDocument {
        version: WORKSPACE_INDEX_VERSION,
        binding_root_id: Some(binding_root_id.clone()),
        selected_paths: effective_selected_paths.clone(),
        files: HashMap::new(),
    };
    let mut existing_by_inode = HashMap::new();
    let mut existing_hash_counts = HashMap::new();
    let mut existing_by_content_hash = HashMap::new();

    for (relative_path, entry) in &existing_index.files {
        if entry.inode > 0 {
            existing_by_inode.insert(entry.inode, (relative_path.clone(), entry.clone()));
        }

        if let Some(content_hash) = entry.content_hash.as_ref() {
            *existing_hash_counts
                .entry(content_hash.clone())
                .or_insert(0usize) += 1;
            existing_by_content_hash
                .insert(content_hash.clone(), (relative_path.clone(), entry.clone()));
        }
    }

    for mut file in files {
        let existing_at_path = existing_index.files.get(&file.relative_path).cloned();
        let can_reuse_hash = existing_at_path.as_ref().is_some_and(|entry| {
            entry.inode == file.inode
                && entry.size == file.size
                && entry.last_seen == file.modified_at
                && entry.content_hash.is_some()
        });
        let content_hash = if can_reuse_hash {
            existing_at_path
                .as_ref()
                .and_then(|entry| entry.content_hash.clone())
                .unwrap_or_default()
        } else {
            content_hash_for_markdown_file(Path::new(&file.path))?
        };
        let existing_entry = existing_at_path
            .or_else(|| {
                existing_by_inode
                    .get(&file.inode)
                    .map(|(_, entry)| entry.clone())
            })
            .or_else(|| {
                if existing_hash_counts.get(&content_hash).copied() == Some(1) {
                    existing_by_content_hash
                        .get(&content_hash)
                        .map(|(_, entry)| entry.clone())
                } else {
                    None
                }
            });

        let id = existing_entry
            .map(|entry| entry.id)
            .or_else(|| extract_writing_id_from_frontmatter(Path::new(&file.path)))
            .unwrap_or_else(|| {
                // Transitional fallback: files that were not created through
                // Odessay and carry no front-matter ID still need an identifier
                // for the workspace UI. This path will be removed once external
                // files are imported (minted in the client) before indexing.
                Uuid::new_v4().to_string()
            });

        file.id = id.clone();
        file.content_hash = content_hash.clone();
        next_index.files.insert(
            file.relative_path.clone(),
            WorkspaceIndexEntry {
                id,
                inode: file.inode,
                content_hash: Some(content_hash),
                last_seen: file.modified_at,
                size: file.size,
            },
        );
        files_with_ids.push(file);
    }

    write_workspace_index_atomic(&workspace_dir, &next_index)?;

    files_with_ids.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    let updated_at = files_with_ids.first().map(|file| file.modified_at);
    let name = canonical_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Workspace")
        .to_string();

    Ok(WorkspaceSnapshot {
        root_path: root_path.clone(),
        binding_root_id,
        name,
        file_count: files_with_ids.len(),
        folder_count,
        updated_at,
        selected_paths: effective_selected_paths,
        files: files_with_ids,
    })
}

fn canonical_markdown_hash_bytes(markdown: &str) -> Vec<u8> {
    markdown
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .into_bytes()
}

/// Read the first portion of a markdown file and extract the `id` field from
/// its YAML front-matter, if present and non-empty. This lets the workspace
/// index adopt the writing UUID minted by the client instead of generating a
/// second identifier in Rust.
fn extract_writing_id_from_frontmatter(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    // Only the start of the file is needed for front-matter; cap to avoid
    // loading large files into memory just for an ID lookup.
    let prefix = String::from_utf8(bytes.into_iter().take(4096).collect()).ok()?;
    let normalized = prefix.replace("\r\n", "\n").replace('\r', "\n");

    if !normalized.starts_with("---\n") {
        return None;
    }

    let end = normalized.find("\n---\n")?;
    let frontmatter = &normalized[4..end];

    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("id:") {
            let id = value.trim().trim_matches('"').trim_matches('\'').trim();
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }

    None
}

#[tauri::command]
pub fn workspace_compute_content_hash(markdown: String) -> Result<String, String> {
    let canonical_bytes = canonical_markdown_hash_bytes(&markdown);
    let digest = blake3::hash(&canonical_bytes);
    Ok(format!("{CONTENT_HASH_PREFIX}:{}", digest.to_hex()))
}

fn content_hash_for_markdown_file(path: &Path) -> Result<String, String> {
    let bytes =
        fs::read(path).map_err(|e| format!("workspace_sync read markdown for hash: {e}"))?;
    let markdown =
        String::from_utf8(bytes).map_err(|e| format!("workspace_sync hash invalid utf-8: {e}"))?;
    let canonical_bytes = canonical_markdown_hash_bytes(&markdown);
    let digest = blake3::hash(&canonical_bytes);

    Ok(format!("{CONTENT_HASH_PREFIX}:{}", digest.to_hex()))
}

fn prepare_workspace_index_dir(canonical_root: &Path) -> Result<PathBuf, String> {
    let workspace_dir = canonical_root.join(WORKSPACE_DIR_NAME);
    let legacy_dir = canonical_root.join(LEGACY_WORKSPACE_DIR_NAME);

    if legacy_dir.exists() && !workspace_dir.exists() {
        fs::rename(&legacy_dir, &workspace_dir)
            .map_err(|e| format!("workspace_sync migrate index dir: {e}"))?;
        return Ok(workspace_dir);
    }

    fs::create_dir_all(&workspace_dir)
        .map_err(|e| format!("workspace_sync create index dir: {e}"))?;

    if legacy_dir.exists() {
        let legacy_index_path = legacy_dir.join(WORKSPACE_INDEX_FILE_NAME);
        let index_path = workspace_dir.join(WORKSPACE_INDEX_FILE_NAME);

        if legacy_index_path.exists() && !index_path.exists() {
            fs::copy(&legacy_index_path, &index_path)
                .map_err(|e| format!("workspace_sync preserve legacy index: {e}"))?;
        }
    }

    Ok(workspace_dir)
}

/// Persist the manifest with crash-safe semantics: serialize to a sibling
/// temp file inside `.odessay/`, then atomically rename it over `index.json`.
/// If the temp write fails the previous manifest is left intact (spec §Reglas de
/// escritura + §Fallas: manifest write failure preserves the previous manifest).
/// The temp file is a dotfile ending in `.tmp` inside the ignored `.odessay`
/// directory, so it never triggers a watcher self-write loop.
fn write_workspace_index_atomic(
    workspace_dir: &Path,
    index: &WorkspaceIndexDocument,
) -> Result<(), String> {
    let index_path = workspace_dir.join(WORKSPACE_INDEX_FILE_NAME);
    let tmp_path = workspace_dir.join(format!(
        ".{}.{}.tmp",
        WORKSPACE_INDEX_FILE_NAME,
        Uuid::new_v4()
    ));

    let index_json = serde_json::to_string_pretty(index)
        .map_err(|e| format!("workspace_sync serialize index: {e}"))?;

    if let Err(e) = fs::write(&tmp_path, index_json) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("workspace_sync write temp index: {e}"));
    }

    if let Err(e) = fs::rename(&tmp_path, &index_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("workspace_sync atomic rename index: {e}"));
    }

    Ok(())
}

fn read_workspace_index(index_path: &Path) -> Result<WorkspaceIndexDocument, String> {
    if !index_path.exists() {
        return Ok(WorkspaceIndexDocument {
            version: 1,
            binding_root_id: None,
            selected_paths: Vec::new(),
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
        let metadata = entry
            .metadata()
            .map_err(|e| format!("workspace_sync metadata: {e}"))?;

        if should_ignore_entry(&name, metadata.is_dir()) {
            continue;
        }

        if metadata.is_dir() {
            *folder_count += 1;
            visit_workspace(root, &path, files, folder_count)?;
            continue;
        }

        if !is_markdown_file(&path) {
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
            content_hash: String::new(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace_root(test_name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "odessay-workspace-test-{test_name}-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp workspace root");
        root
    }

    fn cleanup(path: &Path) {
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn workspace_sync_migrates_legacy_index_dir() {
        let root = temp_workspace_root("migrate-legacy-index-dir");
        let legacy_dir = root.join(LEGACY_WORKSPACE_DIR_NAME);
        fs::create_dir_all(&legacy_dir).expect("create legacy index dir");
        fs::write(root.join("letter.md"), "Hello").expect("write markdown file");
        fs::write(
            legacy_dir.join(WORKSPACE_INDEX_FILE_NAME),
            r#"{
  "version": 1,
  "selectedPaths": [],
  "files": {
    "letter.md": {
      "id": "existing-id",
      "inode": 0,
      "lastSeen": 0,
      "size": 5
    }
  }
}"#,
        )
        .expect("write legacy index");

        let snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("sync workspace with legacy index");

        assert!(root.join(WORKSPACE_DIR_NAME).exists());
        assert!(!root.join(LEGACY_WORKSPACE_DIR_NAME).exists());
        assert_eq!(snapshot.files.len(), 1);
        assert_eq!(snapshot.files[0].id, "existing-id");

        cleanup(&root);
    }

    #[test]
    fn workspace_sync_ignores_internal_workspace_dir() {
        let root = temp_workspace_root("ignore-internal-workspace-dir");
        fs::create_dir_all(root.join(WORKSPACE_DIR_NAME)).expect("create workspace dir");
        fs::write(root.join(WORKSPACE_DIR_NAME).join("ignored.md"), "ignored")
            .expect("write internal markdown file");
        fs::write(root.join("visible.md"), "visible").expect("write visible markdown file");

        let snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("sync workspace with internal markdown file");

        assert_eq!(snapshot.files.len(), 1);
        assert_eq!(snapshot.files[0].relative_path, "visible.md");

        cleanup(&root);
    }

    #[test]
    fn workspace_sync_writes_blake3_content_hash_to_index() {
        let root = temp_workspace_root("writes-content-hash");
        fs::write(root.join("letter.md"), "Hello\r\nworld\r\n").expect("write markdown file");

        let snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("sync workspace with markdown file");
        let expected_hash = format!(
            "{CONTENT_HASH_PREFIX}:{}",
            blake3::hash(b"Hello\nworld\n").to_hex()
        );
        let index_json = fs::read_to_string(
            root.join(WORKSPACE_DIR_NAME)
                .join(WORKSPACE_INDEX_FILE_NAME),
        )
        .expect("read index");

        assert_eq!(snapshot.files.len(), 1);
        assert_eq!(snapshot.files[0].content_hash, expected_hash);
        assert!(index_json.contains(&format!(r#""content_hash": "{}""#, expected_hash)));

        cleanup(&root);
    }

    #[test]
    fn workspace_sync_keeps_binding_by_path_after_atomic_save() {
        let root = temp_workspace_root("path-first-atomic-save");
        let file_path = root.join("letter.md");
        fs::write(&file_path, "Before\n").expect("write markdown file");

        let initial_snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("initial sync workspace");
        let initial_file = initial_snapshot.files[0].clone();

        let temp_path = root.join(".letter.md.tmp");
        fs::write(&temp_path, "After\n").expect("write temp markdown file");
        fs::rename(&temp_path, &file_path).expect("replace markdown file");

        let next_snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("sync workspace after atomic save");
        let next_file = &next_snapshot.files[0];

        assert_eq!(next_file.relative_path, "letter.md");
        assert_eq!(next_file.id, initial_file.id);
        assert_ne!(next_file.content_hash, initial_file.content_hash);

        cleanup(&root);
    }

    #[test]
    fn workspace_sync_follows_exact_selected_file_rename_by_inode() {
        let root = temp_workspace_root("selected-file-rename");
        let original_path = root.join("before.md");
        let renamed_path = root.join("after.md");
        fs::write(&original_path, "Unique rename content\n").expect("write selected file");

        let initial_snapshot = workspace_sync(
            root.to_string_lossy().to_string(),
            Some(vec!["before.md".into()]),
        )
        .expect("initial selected sync");
        let initial_id = initial_snapshot.files[0].id.clone();

        fs::rename(&original_path, &renamed_path).expect("rename selected file");

        let next_snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("sync after selected-file rename");

        assert_eq!(next_snapshot.files.len(), 1);
        assert_eq!(next_snapshot.files[0].relative_path, "after.md");
        assert_eq!(next_snapshot.files[0].id, initial_id);
        assert_eq!(next_snapshot.selected_paths, vec!["after.md"]);

        cleanup(&root);
    }

    #[test]
    fn workspace_sync_adopts_writing_id_from_frontmatter_for_new_files() {
        let root = temp_workspace_root("adopt-frontmatter-id");
        let file_path = root.join("letter.md");
        fs::write(
            &file_path,
            "---\nid: writing-uuid-from-frontmatter\nversion: 1\ncreated_at: 2026-06-17T00:00:00.000Z\nupdated_at: 2026-06-17T00:00:00.000Z\n---\n\nHello\n",
        )
        .expect("write markdown file with frontmatter");

        let snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("sync workspace with frontmatter file");

        assert_eq!(snapshot.files.len(), 1);
        assert_eq!(snapshot.files[0].id, "writing-uuid-from-frontmatter");

        let index_json = fs::read_to_string(
            root.join(WORKSPACE_DIR_NAME)
                .join(WORKSPACE_INDEX_FILE_NAME),
        )
        .expect("read index");
        assert!(index_json.contains("writing-uuid-from-frontmatter"));

        cleanup(&root);
    }

    #[test]
    fn workspace_sync_existing_index_entry_takes_precedence_over_frontmatter() {
        let root = temp_workspace_root("existing-entry-precedence");
        let workspace_dir = root.join(WORKSPACE_DIR_NAME);
        fs::create_dir_all(&workspace_dir).expect("create workspace dir");
        fs::write(
            workspace_dir.join(WORKSPACE_INDEX_FILE_NAME),
            r#"{
  "version": 1,
  "selectedPaths": [],
  "files": {
    "letter.md": {
      "id": "existing-index-id",
      "inode": 0,
      "lastSeen": 0,
      "size": 0
    }
  }
}"#,
        )
        .expect("write existing index");
        fs::write(
            root.join("letter.md"),
            "---\nid: frontmatter-id\nversion: 1\ncreated_at: 2026-06-17T00:00:00.000Z\nupdated_at: 2026-06-17T00:00:00.000Z\n---\n\nHello\n",
        )
        .expect("write markdown file");

        let snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("sync workspace with existing entry");

        assert_eq!(snapshot.files.len(), 1);
        assert_eq!(snapshot.files[0].id, "existing-index-id");

        cleanup(&root);
    }

    #[test]
    fn workspace_compute_content_hash_matches_ts_vectors() {
        let cases = [
            (
                "# Title\n\nBody\n",
                "blake3:1d214c1dbb2fa2352037849f6940df8d404c107b13e0215d3ccc87ffc13d6d43",
            ),
            (
                "# Title\r\n\r\nBody\r\n",
                "blake3:1d214c1dbb2fa2352037849f6940df8d404c107b13e0215d3ccc87ffc13d6d43",
            ),
            (
                "---\nid: test\n---\n\nContent\r\n",
                "blake3:cbc79e12c09e950b1cc84e9d751bfa1c3f3d2d3ff65fdc15ccd7cbcc7460d0b8",
            ),
            (
                "Hello\rworld\r\n",
                "blake3:d1181dae26b0e3028befceb503c34f7b917ac51fe27f84dc501f1d4799d35860",
            ),
        ];

        for (markdown, expected) in cases {
            assert_eq!(
                workspace_compute_content_hash(markdown.to_string()).unwrap(),
                *expected,
                "hash mismatch for {markdown:?}",
            );
        }
    }

    #[test]
    fn workspace_sync_writes_manifest_v2_with_binding_root_id() {
        let root = temp_workspace_root("manifest-v2-shape");
        fs::write(root.join("letter.md"), "Hello\n").expect("write markdown file");

        let snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("sync workspace");

        assert!(!snapshot.binding_root_id.is_empty());

        let index_path = root.join(WORKSPACE_DIR_NAME).join(WORKSPACE_INDEX_FILE_NAME);
        let index_json = fs::read_to_string(&index_path).expect("read index");
        assert!(index_json.contains("\"version\": 2"));
        assert!(index_json.contains(&format!("\"bindingRootId\": \"{}\"", snapshot.binding_root_id)));

        // No leftover temp files after a successful atomic write.
        let leftovers: Vec<_> = fs::read_dir(root.join(WORKSPACE_DIR_NAME))
            .expect("read workspace dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp file left behind: {leftovers:?}");

        cleanup(&root);
    }

    #[test]
    fn workspace_sync_migrates_v1_manifest_to_v2_preserving_ids() {
        let root = temp_workspace_root("migrate-v1-to-v2");
        let workspace_dir = root.join(WORKSPACE_DIR_NAME);
        fs::create_dir_all(&workspace_dir).expect("create workspace dir");
        // A legacy v1 manifest: no version bump, no bindingRootId.
        fs::write(
            workspace_dir.join(WORKSPACE_INDEX_FILE_NAME),
            r#"{
  "version": 1,
  "selectedPaths": [],
  "files": {
    "letter.md": { "id": "v1-doc-id", "inode": 0, "lastSeen": 0, "size": 0 }
  }
}"#,
        )
        .expect("write v1 index");
        fs::write(root.join("letter.md"), "Hello\n").expect("write markdown file");

        let snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("sync migrates v1 manifest");

        assert_eq!(snapshot.files.len(), 1);
        assert_eq!(snapshot.files[0].id, "v1-doc-id");
        assert!(!snapshot.binding_root_id.is_empty());

        let index_json = fs::read_to_string(workspace_dir.join(WORKSPACE_INDEX_FILE_NAME))
            .expect("read migrated index");
        assert!(index_json.contains("\"version\": 2"));
        assert!(index_json.contains("v1-doc-id"));

        cleanup(&root);
    }

    #[test]
    fn workspace_sync_binding_root_id_is_stable_across_syncs() {
        let root = temp_workspace_root("stable-binding-root-id");
        fs::write(root.join("letter.md"), "Hello\n").expect("write markdown file");

        let first = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("first sync");
        let second = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("second sync");

        assert_eq!(first.binding_root_id, second.binding_root_id);

        cleanup(&root);
    }

    #[test]
    fn workspace_sync_uses_unique_content_hash_for_rename_binding() {
        let root = temp_workspace_root("rename-by-content-hash");
        let old_path = root.join("old.md");
        let new_path = root.join("nested").join("new.md");
        fs::write(&old_path, "Stable content\n").expect("write markdown file");

        let initial_snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("initial sync workspace");
        let initial_file = initial_snapshot.files[0].clone();

        fs::create_dir_all(root.join("nested")).expect("create nested dir");
        fs::copy(&old_path, &new_path).expect("copy markdown to new path");
        fs::remove_file(&old_path).expect("remove old markdown path");

        let next_snapshot = workspace_sync(root.to_string_lossy().to_string(), None)
            .expect("sync workspace after remove-create rename");
        let next_file = &next_snapshot.files[0];

        assert_eq!(next_file.relative_path, "nested/new.md");
        assert_eq!(next_file.id, initial_file.id);
        assert_eq!(next_file.content_hash, initial_file.content_hash);

        cleanup(&root);
    }
}
