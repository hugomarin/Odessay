use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, State};
use tauri_plugin_fs::FsExt;
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

/// Drains file paths macOS asked us to open (Finder "Open With" / a Dock
/// drop) before the frontend had a `menu:os-open-path` listener registered.
/// Called once at boot so a cold-start open isn't lost to that race.
#[tauri::command]
pub fn take_pending_open_paths(state: State<crate::PendingOpenPaths>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Grant the native fs watcher access to a user-confirmed BindingRoot.
///
/// The dialog's temporary filesystem scope is cleared on restart. BindingRoots
/// are durable user consent, so the desktop adapter must rehydrate that scope
/// before asking `tauri-plugin-fs` to watch an external folder.
#[tauri::command]
pub fn allow_watch_path(app: AppHandle, path: String) -> Result<(), String> {
    let root = Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("allow_watch_path canonicalize: {e}"))?;
    let scope = app.fs_scope();
    if scope.is_allowed(&root) {
        return Ok(());
    }
    scope
        .allow_directory(root, true)
        .map_err(|e| format!("allow_watch_path scope: {e}"))
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
///
/// `expected_content_hash` is the WATCH-07 write-side conflict guard: the
/// watcher/reconciler path (TS side) detects an external edit early and
/// drives the UI, but that path always has a window between "detected" and
/// "the next save actually runs" where a caller could still overwrite an
/// external edit it never saw. This is the final barrier: before the write
/// that makes a save durable, the file's *current* on-disk
/// content hash is recomputed and compared against what the caller expected
/// when it started this save. A mismatch (or the file having disappeared)
/// means the file changed since the caller last knew about it, and the write
/// is refused with a `CONFLICT: ` prefixed error instead of silently
/// clobbering someone else's edit. `None` skips the check entirely — used
/// for a brand-new file with no prior baseline to compare against. The
/// check is made twice: early, before the `.tmp` is written, and again at
/// the commit itself (`commit_if_unchanged`, ODE-578), so a save that lands
/// while the `.tmp` is being written is refused too.
#[tauri::command]
pub fn write_file(
    path: String,
    content: String,
    expected_content_hash: Option<String>,
) -> Result<(), String> {
    write_file_with_stages(&path, &content, expected_content_hash, &mut |_| {})
}

/// Points inside a guarded write where a test can act as an external editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WriteStage {
    /// The `.tmp` sibling is fully written; the next step makes it the target.
    BeforeCommit,
    /// The commit displaced an unexpected version; the next step puts it back.
    BeforeRestore,
}

fn write_file_with_stages(
    path: &str,
    content: &str,
    expected_content_hash: Option<String>,
    at_stage: &mut dyn FnMut(WriteStage),
) -> Result<(), String> {
    let target = Path::new(path);

    if let Some(expected) = &expected_content_hash {
        if !target.exists() {
            return Err(format!(
                "CONFLICT: {} no longer exists on disk (expected content hash {expected})",
                target.display()
            ));
        }
        let actual = crate::commands::workspace::content_hash_for_markdown_file(target)?;
        if &actual != expected {
            return Err(format!(
                "CONFLICT: {} changed on disk since it was last read (expected {expected}, found {actual})",
                target.display()
            ));
        }
    }

    if let Some(parent) = target.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
        }
    }
    let tmp_path = format!("{}.tmp", path);
    fs::write(&tmp_path, content).map_err(|e| format!("write_file tmp: {e}"))?;
    at_stage(WriteStage::BeforeCommit);
    match expected_content_hash {
        Some(expected) => {
            commit_if_unchanged(target, Path::new(&tmp_path), content, &expected, at_stage)
        }
        None => fs::rename(&tmp_path, target).map_err(|e| {
            let _ = fs::remove_file(&tmp_path);
            format!("write_file rename: {e}")
        }),
    }
}

/// The commit boundary of a guarded write (ODE-578). The check above runs
/// before the `.tmp` is written, so an external save can still land between
/// it and the replace. Instead of a blind `rename`, the `.tmp` and the target
/// are exchanged atomically: afterwards the `.tmp` path holds exactly what the
/// target held at that instant, and only if that is the expected version is
/// it discarded. Anything else is an external version that arrived in the
/// window: it is put back with a second exchange and the write is refused
/// with the same `CONFLICT: ` the early check returns, so the caller handles
/// both identically. No version other than the expected baseline and the
/// caller's own content is ever deleted.
fn commit_if_unchanged(
    target: &Path,
    tmp: &Path,
    content: &str,
    expected: &str,
    at_stage: &mut dyn FnMut(WriteStage),
) -> Result<(), String> {
    match exchange_paths(tmp, target) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && tmp.exists() => {
            let _ = fs::remove_file(tmp);
            return Err(format!(
                "CONFLICT: {} was removed from disk while the save was being written",
                target.display()
            ));
        }
        Err(error) if exchange_unsupported(&error) => {
            return commit_by_revalidation(target, tmp, expected);
        }
        Err(error) => {
            let _ = fs::remove_file(tmp);
            return Err(format!("write_file exchange: {error}"));
        }
    }

    let displaced = crate::commands::workspace::content_hash_for_markdown_file(tmp);
    if displaced.as_deref() == Ok(expected) {
        let _ = fs::remove_file(tmp);
        return Ok(());
    }
    let found = displaced.unwrap_or_else(|error| format!("an unreadable version ({error})"));

    at_stage(WriteStage::BeforeRestore);
    if exchange_paths(tmp, target).is_ok() && is_exactly(tmp, content) {
        let _ = fs::remove_file(tmp);
        return Err(format!(
            "CONFLICT: {} changed on disk while the save was being written (expected {expected}, found {found})",
            target.display()
        ));
    }
    // Restoring did not bring our own content back: the `.tmp` path holds a
    // version someone else wrote (a second save during the restore, or the
    // first one if the target vanished). Keep it beside the target.
    let kept = keep_beside(target, tmp)?;
    Err(format!(
        "CONFLICT: {} changed on disk while the save was being written; another version was kept at {}",
        target.display(),
        kept.display()
    ))
}

/// Fallback for volumes without an atomic exchange (some network and FAT
/// volumes): re-check right before the rename. This narrows the window to two
/// syscalls instead of closing it.
fn commit_by_revalidation(target: &Path, tmp: &Path, expected: &str) -> Result<(), String> {
    let current = crate::commands::workspace::content_hash_for_markdown_file(target);
    if current.as_deref() != Ok(expected) {
        let _ = fs::remove_file(tmp);
        return Err(format!(
            "CONFLICT: {} changed on disk while the save was being written",
            target.display()
        ));
    }
    fs::rename(tmp, target).map_err(|e| {
        let _ = fs::remove_file(tmp);
        format!("write_file rename: {e}")
    })
}

fn is_exactly(path: &Path, content: &str) -> bool {
    fs::read(path).map(|bytes| bytes == content.as_bytes()).unwrap_or(false)
}

/// Moves a displaced version out of the `.tmp` path to a sibling that is not
/// a `.md` file, so the workspace never indexes it as a document.
fn keep_beside(target: &Path, displaced: &Path) -> Result<PathBuf, String> {
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.md".to_string());
    let suffix = Uuid::new_v4().simple().to_string();
    let kept = target.with_file_name(format!("{name}.conflict-{}", &suffix[..8]));
    fs::rename(displaced, &kept).map_err(|e| {
        format!(
            "CONFLICT: {} changed on disk while the save was being written, and the version found there could not be kept ({e}); it remains at {}",
            target.display(),
            displaced.display()
        )
    })?;
    Ok(kept)
}

/// Atomically swaps two existing paths.
#[cfg(target_os = "macos")]
fn exchange_paths(a: &Path, b: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let a = CString::new(a.as_os_str().as_bytes())?;
    let b = CString::new(b.as_os_str().as_bytes())?;
    // SAFETY: both pointers are valid NUL-terminated strings for the call.
    let rc = unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_SWAP) };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

/// Atomically swaps two existing paths.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn exchange_paths(a: &Path, b: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let a = CString::new(a.as_os_str().as_bytes())?;
    let b = CString::new(b.as_os_str().as_bytes())?;
    // SAFETY: both pointers are valid NUL-terminated strings for the call.
    let rc = unsafe {
        libc::renameat2(libc::AT_FDCWD, a.as_ptr(), libc::AT_FDCWD, b.as_ptr(), libc::RENAME_EXCHANGE)
    };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "macos", all(target_os = "linux", target_env = "gnu"))))]
fn exchange_paths(_a: &Path, _b: &Path) -> std::io::Result<()> {
    Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
}

fn exchange_unsupported(error: &std::io::Error) -> bool {
    if error.kind() == std::io::ErrorKind::Unsupported {
        return true;
    }
    #[cfg(unix)]
    {
        matches!(
            error.raw_os_error(),
            Some(code) if code == libc::ENOTSUP || code == libc::EOPNOTSUPP || code == libc::ENOSYS
        ) || (cfg!(target_os = "linux") && error.raw_os_error() == Some(libc::EINVAL))
    }
    #[cfg(not(unix))]
    {
        false
    }
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

const MAX_LOCAL_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalImageAsset {
    source_path: String,
    file_name: String,
    mime_type: String,
    size_bytes: u64,
    bytes: Vec<u8>,
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("webp") => Some("image/webp"),
        Some("gif") => Some("image/gif"),
        Some("svg") => Some("image/svg+xml"),
        _ => None,
    }
}

fn decode_local_image_source(source: &str) -> Result<String, String> {
    let path = source.strip_prefix("file://").unwrap_or(source);
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
                .map_err(|_| "read_local_image_asset: invalid percent encoding".to_string())?;
            let value = u8::from_str_radix(hex, 16)
                .map_err(|_| "read_local_image_asset: invalid percent encoding".to_string())?;
            decoded.push(value);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded)
        .map_err(|_| "read_local_image_asset: source is not valid UTF-8".to_string())
}

/// Read one image referenced by a materialized Markdown document. The command
/// resolves both relative and absolute paths without widening the WebView's fs
/// capability or exposing an unrestricted asset protocol.
#[tauri::command]
pub fn read_local_image_asset(
    document_path: String,
    source: String,
) -> Result<LocalImageAsset, String> {
    let decoded_source = decode_local_image_source(&source)?;
    let canonical = Path::new(&document_path)
        .parent()
        .unwrap_or(Path::new("."))
        .join(decoded_source)
        .canonicalize()
        .map_err(|e| format!("read_local_image_asset: {e}"))?;
    let mime_type = image_mime_type(&canonical).ok_or_else(|| {
        format!(
            "read_local_image_asset: unsupported image type: {}",
            canonical.display()
        )
    })?;
    let metadata =
        fs::metadata(&canonical).map_err(|e| format!("read_local_image_asset metadata: {e}"))?;
    if !metadata.is_file() {
        return Err(format!(
            "read_local_image_asset: not a file: {}",
            canonical.display()
        ));
    }
    if metadata.len() > MAX_LOCAL_IMAGE_BYTES {
        return Err(format!(
            "read_local_image_asset: image exceeds 25 MB: {}",
            canonical.display()
        ));
    }
    let bytes = fs::read(&canonical).map_err(|e| format!("read_local_image_asset read: {e}"))?;
    Ok(LocalImageAsset {
        source_path: canonical.to_string_lossy().to_string(),
        file_name: canonical
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("image")
            .to_string(),
        mime_type: mime_type.to_string(),
        size_bytes: metadata.len(),
        bytes,
    })
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
    fn read_local_image_asset_resolves_relative_and_absolute_sources() {
        let root = temp_dir("read-local-image");
        let document_path = root.join("essay.md");
        let image_dir = root.join("images");
        let image_path = image_dir.join("photo.png");
        let svg_path = image_dir.join("diagram.svg");
        fs::create_dir_all(&image_dir).expect("create image dir");
        fs::write(&document_path, "![Photo](images/photo.png)\n").expect("write markdown");
        fs::write(&image_path, [0x89, b'P', b'N', b'G']).expect("write image");
        fs::write(&svg_path, b"<svg xmlns=\"http://www.w3.org/2000/svg\" />").expect("write svg");

        let relative = read_local_image_asset(
            document_path.to_string_lossy().to_string(),
            "images/photo.png".into(),
        )
        .expect("read relative image");
        let absolute = read_local_image_asset(
            document_path.to_string_lossy().to_string(),
            image_path.to_string_lossy().to_string(),
        )
        .expect("read absolute image");
        let file_url = read_local_image_asset(
            document_path.to_string_lossy().to_string(),
            format!("file://{}", image_path.to_string_lossy()).replace("photo.png", "photo%2Epng"),
        )
        .expect("read file URL image");

        assert_eq!(relative.source_path, absolute.source_path);
        assert_eq!(relative.source_path, file_url.source_path);
        assert_eq!(relative.mime_type, "image/png");
        assert_eq!(relative.file_name, "photo.png");
        assert_eq!(relative.bytes, vec![0x89, b'P', b'N', b'G']);
        let svg = read_local_image_asset(
            document_path.to_string_lossy().to_string(),
            "images/diagram.svg".into(),
        )
        .expect("read svg image");
        assert_eq!(svg.mime_type, "image/svg+xml");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_local_image_asset_rejects_non_image_files() {
        let root = temp_dir("reject-local-non-image");
        let document_path = root.join("essay.md");
        let text_path = root.join("notes.txt");
        fs::write(&document_path, "Body\n").expect("write markdown");
        fs::write(&text_path, "not an image\n").expect("write text");

        let result = read_local_image_asset(
            document_path.to_string_lossy().to_string(),
            text_path.to_string_lossy().to_string(),
        );

        assert!(result
            .expect_err("reject unsupported extension")
            .contains("unsupported image type"));
        let _ = fs::remove_dir_all(root);
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

    #[test]
    fn write_file_without_expected_hash_always_succeeds() {
        let root = temp_dir("write-no-precondition");
        let target = root.join("Letter.md");
        fs::write(&target, "Original\n").expect("write original");

        write_file(target.to_string_lossy().to_string(), "Replaced\n".into(), None)
            .expect("write with no baseline should never be refused");

        assert_eq!(fs::read_to_string(&target).expect("read target"), "Replaced\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_file_with_matching_expected_hash_succeeds() {
        let root = temp_dir("write-matching-hash");
        let target = root.join("Letter.md");
        fs::write(&target, "Original\n").expect("write original");
        let baseline = crate::commands::workspace::content_hash_for_markdown_file(&target)
            .expect("compute baseline hash");

        write_file(
            target.to_string_lossy().to_string(),
            "Updated by me\n".into(),
            Some(baseline),
        )
        .expect("write with a correct baseline should succeed");

        assert_eq!(
            fs::read_to_string(&target).expect("read target"),
            "Updated by me\n"
        );
        let _ = fs::remove_dir_all(root);
    }

    /// The WATCH-07 property this test exists to prove: once another process
    /// has changed the file since the caller's baseline was taken, the write
    /// must be refused — never silently applied over the external edit.
    #[test]
    fn write_file_with_stale_expected_hash_is_refused_and_leaves_disk_untouched() {
        let root = temp_dir("write-stale-hash");
        let target = root.join("Letter.md");
        fs::write(&target, "Original\n").expect("write original");
        let stale_baseline = crate::commands::workspace::content_hash_for_markdown_file(&target)
            .expect("compute stale baseline hash");

        // Another process edits the file after the baseline was taken.
        fs::write(&target, "Changed by another app\n").expect("simulate external edit");

        let result = write_file(
            target.to_string_lossy().to_string(),
            "My conflicting edit\n".into(),
            Some(stale_baseline),
        );

        let error = result.expect_err("a stale baseline must refuse the write");
        assert!(
            error.starts_with("CONFLICT:"),
            "error must be identifiable as a conflict, got: {error}"
        );
        assert_eq!(
            fs::read_to_string(&target).expect("read target"),
            "Changed by another app\n",
            "the external edit must remain completely untouched"
        );
        let _ = fs::remove_dir_all(root);
    }

    // ODE-578 — the guard above runs before the `.tmp` is written, so an
    // external save landing between that check and the replace used to be
    // overwritten silently. These tests act as the external editor at the
    // last moment before the commit (and, for the double race, before the
    // restore), through the stage hook `write_file` passes as a no-op.

    fn guarded_write(
        target: &Path,
        content: &str,
        on_stage: impl FnMut(WriteStage),
    ) -> (Result<(), String>, Vec<WriteStage>) {
        let baseline = crate::commands::workspace::content_hash_for_markdown_file(target)
            .expect("compute baseline hash");
        let mut on_stage = on_stage;
        let mut seen = Vec::new();
        let result = write_file_with_stages(
            &target.to_string_lossy(),
            content,
            Some(baseline),
            &mut |stage| {
                seen.push(stage);
                on_stage(stage);
            },
        );
        (result, seen)
    }

    fn entries_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn write_file_commit_with_nothing_in_the_window_replaces_the_target() {
        let root = temp_dir("commit-clean");
        let target = root.join("Letter.md");
        fs::write(&target, "Original\n").expect("write original");

        let (result, seen) = guarded_write(&target, "Mine\n", |_| {});

        result.expect("an unchanged target must be replaced");
        assert_eq!(seen, vec![WriteStage::BeforeCommit], "positive control: the window was reached");
        assert_eq!(fs::read_to_string(&target).expect("read target"), "Mine\n");
        assert_eq!(entries_in(&root), vec!["Letter.md"], "no temp residue");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_file_external_in_place_save_in_the_commit_window_is_a_conflict() {
        let root = temp_dir("commit-in-place");
        let target = root.join("Letter.md");
        fs::write(&target, "Original\n").expect("write original");

        let (result, seen) = guarded_write(&target, "Mine\n", |stage| {
            if stage == WriteStage::BeforeCommit {
                fs::write(&target, "External\n").expect("external in-place save");
            }
        });

        assert!(seen.contains(&WriteStage::BeforeCommit), "positive control: the window was reached");
        let error = result.expect_err("a save that landed in the window must refuse the write");
        assert!(error.starts_with("CONFLICT:"), "got: {error}");
        assert_eq!(fs::read_to_string(&target).expect("read target"), "External\n");
        assert_eq!(entries_in(&root), vec!["Letter.md"], "no temp residue");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_file_external_atomic_save_in_the_commit_window_is_a_conflict() {
        let root = temp_dir("commit-atomic");
        let target = root.join("Letter.md");
        fs::write(&target, "Original\n").expect("write original");

        let (result, seen) = guarded_write(&target, "Mine\n", |stage| {
            if stage == WriteStage::BeforeCommit {
                // How most editors save: write a sibling, rename it over.
                let sibling = target.with_file_name(".Letter.md.sb-external");
                fs::write(&sibling, "External\n").expect("external sibling");
                fs::rename(&sibling, &target).expect("external atomic replace");
            }
        });

        assert!(seen.contains(&WriteStage::BeforeCommit), "positive control: the window was reached");
        let error = result.expect_err("a save that landed in the window must refuse the write");
        assert!(error.starts_with("CONFLICT:"), "got: {error}");
        assert_eq!(fs::read_to_string(&target).expect("read target"), "External\n");
        assert_eq!(entries_in(&root), vec!["Letter.md"], "no temp residue");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_file_external_delete_in_the_commit_window_is_a_conflict() {
        let root = temp_dir("commit-delete");
        let target = root.join("Letter.md");
        fs::write(&target, "Original\n").expect("write original");

        let (result, seen) = guarded_write(&target, "Mine\n", |stage| {
            if stage == WriteStage::BeforeCommit {
                fs::remove_file(&target).expect("external delete");
            }
        });

        assert!(seen.contains(&WriteStage::BeforeCommit), "positive control: the window was reached");
        let error = result.expect_err("a delete in the window must not be undone by the write");
        assert!(error.starts_with("CONFLICT:"), "got: {error}");
        assert!(entries_in(&root).is_empty(), "nothing recreated, no temp residue");
        let _ = fs::remove_dir_all(root);
    }

    /// The double race: a first external save lands in the commit window, and
    /// a second one lands while the first is being put back. Neither may be
    /// lost: the first ends at the target, the second is kept beside it.
    #[test]
    fn write_file_second_external_save_during_restore_is_kept_beside_the_target() {
        let root = temp_dir("commit-double");
        let target = root.join("Letter.md");
        fs::write(&target, "Original\n").expect("write original");

        let (result, seen) = guarded_write(&target, "Mine\n", |stage| match stage {
            WriteStage::BeforeCommit => fs::write(&target, "External 1\n").expect("first external save"),
            WriteStage::BeforeRestore => fs::write(&target, "External 2\n").expect("second external save"),
        });

        assert_eq!(
            seen,
            vec![WriteStage::BeforeCommit, WriteStage::BeforeRestore],
            "positive control: both windows were reached"
        );
        let error = result.expect_err("the write must be refused");
        assert!(error.starts_with("CONFLICT:"), "got: {error}");
        assert_eq!(fs::read_to_string(&target).expect("read target"), "External 1\n");
        let entries = entries_in(&root);
        assert_eq!(entries.len(), 2, "target plus the kept version: {entries:?}");
        let kept = entries.iter().find(|name| name.as_str() != "Letter.md").expect("kept version");
        assert!(error.contains(kept.as_str()), "the error names where it was kept: {error}");
        assert_eq!(fs::read_to_string(root.join(kept)).expect("read kept"), "External 2\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_file_with_expected_hash_but_missing_file_is_a_conflict() {
        let root = temp_dir("write-missing-file");
        let target = root.join("Letter.md");
        // Never created — simulates the file being deleted externally between
        // the caller's baseline read and this save.

        let result = write_file(
            target.to_string_lossy().to_string(),
            "My edit\n".into(),
            Some("blake3:0000000000000000000000000000000000000000000000000000000000000000".into()),
        );

        let error = result.expect_err("a missing file with an expected baseline must conflict, not silently create");
        assert!(error.starts_with("CONFLICT:"), "got: {error}");
        assert!(!target.exists(), "no partial write must happen on conflict");
        let _ = fs::remove_dir_all(root);
    }
}
