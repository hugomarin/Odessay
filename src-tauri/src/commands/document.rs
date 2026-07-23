use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use uuid::Uuid;

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

/// Atomically write binary content to `path` by writing a .tmp sibling then renaming.
/// Used by native export delivery so desktop PDF/DOCX exports do not go through browser downloads.
#[tauri::command]
pub fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
        }
    }
    let tmp_path = format!("{}.tmp", path);
    fs::write(&tmp_path, &bytes).map_err(|e| format!("write_binary_file tmp: {e}"))?;
    fs::rename(&tmp_path, target).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("write_binary_file rename: {e}")
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

/// Physically relocate a document file to a destination path (ODE-402):
///
/// - never overwrites: an occupied destination resolves to `Name 2.md`,
///   `Name 3.md`, … (same collision convention as `resolveUniqueFilename`);
/// - a same-volume move is a plain `rename` — no copy, inode preserved;
/// - a cross-device move degrades to copy + verify + atomic swap +
///   delete-original; if verification or the original's removal fails, the
///   original stays intact and a recoverable error is returned.
///
/// Returns the final destination path (which may carry a collision suffix).
#[tauri::command]
pub fn relocate_file(old_path: String, new_path: String) -> Result<String, String> {
    let source = Path::new(&old_path);
    if !source.is_file() {
        return Err(format!("relocate_file: source not found: {old_path}"));
    }
    let requested = Path::new(&new_path);
    if let Some(parent) = requested.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("relocate_file create_dir_all: {e}"))?;
        }
    }

    // Saving onto the file's current location is a no-op move, not a collision.
    if let (Ok(canonical_source), Ok(canonical_requested)) =
        (source.canonicalize(), requested.canonicalize())
    {
        if canonical_source == canonical_requested {
            return Ok(new_path);
        }
    }

    let target = resolve_collision_free_target(requested)?;
    match fs::rename(source, &target) {
        Ok(()) => Ok(target.to_string_lossy().to_string()),
        Err(error) if is_cross_device_error(&error) => {
            relocate_via_copy(source, &target, files_have_identical_content)
                .map(|path| path.to_string_lossy().to_string())
        }
        Err(error) => Err(format!("relocate_file rename: {error}")),
    }
}

/// Resolve a destination that never overwrites an existing file: `Name.md` →
/// `Name 2.md` → `Name 3.md`, … A collision with the requested path always
/// yields a free name; the user is never blocked (ADR D10 naming rule).
fn resolve_collision_free_target(requested: &Path) -> Result<PathBuf, String> {
    if !requested.exists() {
        return Ok(requested.to_path_buf());
    }

    let parent = requested.parent().unwrap_or(Path::new(".")).to_path_buf();
    let stem = requested
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled");
    let extension = requested
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();

    for counter in 2..10_000u32 {
        let candidate = parent.join(format!("{stem} {counter}{extension}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "relocate_file: could not resolve a free destination name for {}",
        requested.display()
    ))
}

fn is_cross_device_error(error: &std::io::Error) -> bool {
    #[cfg(unix)]
    const CROSS_DEVICE: i32 = 18; // EXDEV
    #[cfg(windows)]
    const CROSS_DEVICE: i32 = 17; // ERROR_NOT_SAME_DEVICE
    error.raw_os_error() == Some(CROSS_DEVICE)
}

fn files_have_identical_content(left: &Path, right: &Path) -> Result<bool, String> {
    let left_bytes = fs::read(left).map_err(|e| format!("relocate_file verify read: {e}"))?;
    let right_bytes = fs::read(right).map_err(|e| format!("relocate_file verify read: {e}"))?;
    Ok(left_bytes == right_bytes)
}

/// Cross-device fallback: copy to a hidden `.tmp` sibling (ignored by workspace
/// scans), verify the copied bytes, atomically swap it into place, then remove
/// the original. Any failure rolls back so the original file is never lost and
/// no partial copy is left behind.
fn relocate_via_copy(
    source: &Path,
    target: &Path,
    verify: impl Fn(&Path, &Path) -> Result<bool, String>,
) -> Result<PathBuf, String> {
    let target_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("relocate");
    let tmp_path = target
        .parent()
        .unwrap_or(Path::new("."))
        .join(format!(".{target_name}.{}.tmp", Uuid::new_v4()));

    if let Err(error) = fs::copy(source, &tmp_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("relocate_file copy: {error}"));
    }

    match verify(source, &tmp_path) {
        Ok(true) => {}
        Ok(false) => {
            let _ = fs::remove_file(&tmp_path);
            return Err(
                "relocate_file verify: copied content mismatch; original preserved".to_string(),
            );
        }
        Err(error) => {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("{error}; original preserved"));
        }
    }

    if let Err(error) = fs::rename(&tmp_path, target) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("relocate_file swap: {error}; original preserved"));
    }

    if let Err(error) = fs::remove_file(source) {
        // Two copies would violate the single-canonical-path invariant. Roll the
        // move back so the original remains the only canonical file.
        let _ = fs::remove_file(target);
        return Err(format!(
            "relocate_file remove original: {error}; move rolled back"
        ));
    }

    Ok(target.to_path_buf())
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

/// Resolve a relative asset path against the document's directory.
/// Returns the absolute path if the file exists, or an error if it does not.
#[tauri::command]
pub fn resolve_asset_path(doc_path: String, relative_path: String) -> Result<String, String> {
    let doc = Path::new(&doc_path);
    let dir = doc.parent().unwrap_or(Path::new("."));
    let resolved = dir.join(&relative_path);
    let canonical = resolved.canonicalize().map_err(|e| {
        format!(
            "resolve_asset_path: {} (resolved: {})",
            e,
            resolved.display()
        )
    })?;
    if !canonical.is_file() {
        return Err(format!(
            "resolve_asset_path: not a file: {}",
            canonical.display()
        ));
    }
    Ok(canonical.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(test_name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("odessay-relocate-{test_name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp dir");
        root
    }

    #[test]
    fn relocate_file_moves_without_copy_and_creates_parents() {
        let root = temp_dir("plain-move");
        let source = root.join("Letter.md");
        fs::write(&source, "Body\n").expect("write source");
        let target = root.join("Dest").join("Letter.md");

        let resolved = relocate_file(
            source.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
        )
        .expect("relocate should succeed");

        assert_eq!(resolved, target.to_string_lossy().to_string());
        assert!(!source.exists(), "source must not remain (no residue)");
        assert_eq!(fs::read_to_string(&target).expect("read target"), "Body\n");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn relocate_file_suffixes_on_collision_and_never_overwrites() {
        let root = temp_dir("collision");
        let source = root.join("Letter.md");
        fs::write(&source, "Moved\n").expect("write source");
        let occupied = root.join("Dest");
        fs::create_dir_all(&occupied).expect("create dest");
        fs::write(occupied.join("Letter.md"), "Existing\n").expect("write occupied");
        fs::write(occupied.join("Letter 2.md"), "Existing 2\n").expect("write occupied 2");

        let resolved = relocate_file(
            source.to_string_lossy().to_string(),
            occupied.join("Letter.md").to_string_lossy().to_string(),
        )
        .expect("relocate should succeed with suffix");

        assert_eq!(
            resolved,
            occupied.join("Letter 3.md").to_string_lossy().to_string()
        );
        assert_eq!(
            fs::read_to_string(occupied.join("Letter.md")).expect("read occupied"),
            "Existing\n",
            "existing destination must never be overwritten"
        );
        assert_eq!(
            fs::read_to_string(occupied.join("Letter 3.md")).expect("read suffixed"),
            "Moved\n"
        );
        assert!(!source.exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn relocate_file_to_current_path_is_a_noop() {
        let root = temp_dir("same-path");
        let source = root.join("Letter.md");
        fs::write(&source, "Body\n").expect("write source");

        let resolved = relocate_file(
            source.to_string_lossy().to_string(),
            source.to_string_lossy().to_string(),
        )
        .expect("same-path relocate should succeed");

        assert_eq!(resolved, source.to_string_lossy().to_string());
        assert_eq!(fs::read_to_string(&source).expect("read source"), "Body\n");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn relocate_file_missing_source_is_a_recoverable_error() {
        let root = temp_dir("missing-source");
        let result = relocate_file(
            root.join("Ghost.md").to_string_lossy().to_string(),
            root.join("Dest.md").to_string_lossy().to_string(),
        );

        assert!(result.is_err());
        assert!(!root.join("Dest.md").exists(), "no partial state on failure");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn relocate_via_copy_verifies_then_removes_original() {
        let root = temp_dir("copy-verify");
        let source = root.join("Letter.md");
        fs::write(&source, "Cross device body\n").expect("write source");
        let target = root.join("Dest").join("Letter.md");
        fs::create_dir_all(target.parent().unwrap()).expect("create dest");

        let resolved = relocate_via_copy(&source, &target, files_have_identical_content)
            .expect("copy fallback should succeed");

        assert_eq!(resolved, target);
        assert!(!source.exists(), "original removed only after verify");
        assert_eq!(
            fs::read_to_string(&target).expect("read target"),
            "Cross device body\n"
        );
        let leftovers: Vec<_> = fs::read_dir(target.parent().unwrap())
            .expect("read dest dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "no temp residue: {leftovers:?}");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn relocate_via_copy_failed_verify_keeps_original_intact() {
        let root = temp_dir("copy-verify-fail");
        let source = root.join("Letter.md");
        fs::write(&source, "Body\n").expect("write source");
        let target = root.join("Dest").join("Letter.md");
        fs::create_dir_all(target.parent().unwrap()).expect("create dest");

        let result = relocate_via_copy(&source, &target, |_, _| Ok(false));

        assert!(result.is_err(), "failed verification must be an error");
        assert_eq!(
            fs::read_to_string(&source).expect("read source"),
            "Body\n",
            "original must stay intact"
        );
        assert!(!target.exists(), "no partial copy at destination");
        let leftovers: Vec<_> = fs::read_dir(target.parent().unwrap())
            .expect("read dest dir")
            .filter_map(|entry| entry.ok())
            .collect();
        assert!(leftovers.is_empty(), "no temp residue: {leftovers:?}");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_binary_file_persists_exact_bytes() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("odessay-binary-export-{unique}"));
        let target = root.join("exports").join("letter.pdf");
        let bytes = vec![0x25, 0x50, 0x44, 0x46, 0x00, 0xff];

        write_binary_file(target.to_string_lossy().to_string(), bytes.clone())
            .expect("binary export should be written");

        let persisted = fs::read(&target).expect("binary export should be readable");
        assert_eq!(persisted, bytes);

        let _ = fs::remove_dir_all(root);
    }
}
