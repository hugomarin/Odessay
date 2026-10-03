//! ODE-613 — the TS → invoke() → Rust → SQLite seam, replayed; ODE-644 PR2
//! extends it to the sync-mutation queue; ODE-670 extends it to the SYNC-08
//! metadata path (`catalog_list` + `catalog_bulk_dual_write` from the real
//! Settings producer, and the bound/first-upload metadata producers).
//!
//! `tests/fixtures/catalog-seam/catalog-seam-v4.json` is recorded by
//! `tests/support/catalog-seam-recorder.ts` (driven from
//! `tests/catalog-seam-fixture.test.ts`) executing the REAL TS production code —
//! `SqliteDocumentCatalog` and the `WorkspaceReconciler` wired like
//! `desktop-workspace-reconciler.ts`; and, for SYNC-05,
//! `DesktopDocumentService.saveWriting` + `desktopCatalogSyncService
//! .flushPending`, with only Supabase doubled — against a recording
//! `@tauri-apps/api/core` invoke. This test replays that exact `{cmd, args}`
//! sequence over the real `pub fn` commands (no AppHandle) and a real temporary
//! SQLite catalog and filesystem, and asserts the canonical outcome: the
//! catalog rows must match the durable disk state and every UUID must resolve
//! to the same document.
//!
//! The loop is CLOSED on responses too: every recorded invoke carries a
//! projection of the double's response, and this test projects the real
//! command's response the same way and asserts equality step by step. The
//! recorded arguments are only trustworthy while Rust returns the same
//! identity/presence/content fields the double returned — the ids and hashes
//! per path and `unboundPaths` of `workspace_sync`, `changed` of
//! `catalog_apply_reconcile`, the read rows, the mutation listings, the
//! touched binding and the reopened `.md` body. `folderCount` and the
//! machine-dependent fields of `workspace_touch_file` are excluded on purpose;
//! see `project_workspace_sync` and `project_touch`.
//!
//! The SYNC-05 scenarios add CONTROL steps (Req 5): after each flush boundary,
//! the canonical state the double believes — `documents.sync_status`,
//! `documents.cloud_present` and every `sync_mutations` row of the document —
//! is asserted against a brand-new SQLite connection, so a green response loop
//! cannot hide a wrong durable queue.
//!
//! The only thing still outside this proof is the Tauri IPC transport itself
//! (JSON serialization/deserialization across the real webview bridge), which
//! stays RUNTIME (ODE-622).

use odessay_lib::commands::{document, index as catalog, settings, workspace};
use rusqlite::{params, Connection};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const FIXTURE: &str = include_str!("../../tests/fixtures/catalog-seam/catalog-seam-v4.json");

#[derive(Deserialize)]
struct Fixture {
    version: u32,
    scenarios: Vec<Scenario>,
}

#[derive(Deserialize)]
struct Scenario {
    name: String,
    #[allow(dead_code)]
    description: String,
    /// `filesystem`: the scenario registers documents through the real
    /// reconciler, so the end state is asserted against disk + catalog.
    /// `queue`: the scenario enters through producers that do not commit a
    /// `catalog_apply_reconcile` (first-upload draft); its canonical state is
    /// asserted by the control steps against a fresh SQLite connection.
    #[serde(default)]
    profile: ScenarioProfile,
    steps: Vec<Step>,
}

#[derive(Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
enum ScenarioProfile {
    #[default]
    Filesystem,
    Queue,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Step {
    Fs(FsStep),
    Invoke(InvokeStep),
    Control(ControlStep),
}

/// Req 5: canonical durable state the recorder asserted against the queue
/// double. `assert_control` reads it back from a fresh SQLite connection.
/// `document.metadata` and `mutations[].payload` are optional: only the
/// SYNC-08 scenarios declare them, and they are only compared when present.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlStep {
    name: String,
    document_id: String,
    document: ControlDocument,
    mutations: Vec<ControlMutation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlDocument {
    sync_status: String,
    cloud_present: bool,
    #[serde(default)]
    metadata: Option<ControlMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlMetadata {
    status: Option<String>,
    artifact_type: Option<String>,
    version: Option<i64>,
    title: Option<String>,
    slug: Option<String>,
    visibility: Option<String>,
    cloud_account_id: Option<String>,
    content_hash: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlMutation {
    id: String,
    status: String,
    attempt_count: i64,
    next_retry_at: Option<i64>,
    last_error: Option<String>,
    #[serde(default)]
    payload: Option<ControlMutationPayload>,
}

/// The payload fields that distinguish a real metadata mutation
/// (`mutationKind:"metadata"`) from a body mutation (no `mutationKind`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlMutationPayload {
    mutation_kind: Option<String>,
    version: Option<i64>,
    updated_at: Option<String>,
    status: Option<String>,
    artifact_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsStep {
    op: String,
    root: String,
    #[serde(default)]
    relative_path: Option<String>,
    #[serde(default)]
    new_relative_path: Option<String>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    binding_root_id: Option<String>,
}

#[derive(Deserialize)]
struct InvokeStep {
    cmd: String,
    args: Value,
    /// Response projection recorded by the TS double; mirrored here by
    /// `project_*` and asserted against the real command's response.
    response: Value,
}

struct PlaceholderPaths {
    root_a: PathBuf,
    root_b: PathBuf,
    db: PathBuf,
    config: PathBuf,
}

impl PlaceholderPaths {
    fn root_dir(&self, root: &str) -> PathBuf {
        match root {
            "rootA" => self.root_a.clone(),
            "rootB" => self.root_b.clone(),
            other => panic!("catalog_seam: unknown fixture root {other}"),
        }
    }
}

/// The fixture uses placeholders ($DB, $ROOT_A, $ROOT_B, $CONFIG) so it is
/// machine independent. Rewrite every string before dispatching it to the real
/// command.
fn rewrite(value: &Value, paths: &PlaceholderPaths) -> Value {
    match value {
        Value::String(text) => Value::String(rewrite_str(text, paths)),
        Value::Array(items) => Value::Array(items.iter().map(|item| rewrite(item, paths)).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, entry)| (key.clone(), rewrite(entry, paths)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn rewrite_str(text: &str, paths: &PlaceholderPaths) -> String {
    if text == "$DB" {
        return paths.db.to_string_lossy().into_owned();
    }
    if text == "$CONFIG" {
        return paths.config.to_string_lossy().into_owned();
    }
    if let Some(rest) = text.strip_prefix("$ROOT_A") {
        return format!("{}{rest}", paths.root_a.display());
    }
    if let Some(rest) = text.strip_prefix("$ROOT_B") {
        return format!("{}{rest}", paths.root_b.display());
    }
    text.to_string()
}

fn string_arg(args: &Value, key: &str) -> String {
    typed_arg(args, key)
}

/// Real identity of a replayed file, for the ODE-635 identity guard: the
/// fixture's inodes are synthetic (model fs), so the replay maps any recorded
/// guard to the file the real command will actually see.
fn real_file_inode(path: &str) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(path).ok().map(|metadata| metadata.ino())
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

/// Deserializes any recorded arg (i64/usize/bool/Option/struct) with the same
/// missing-key diagnostics as `string_arg`.
fn typed_arg<T: DeserializeOwned>(args: &Value, key: &str) -> T {
    serde_json::from_value(
        args.get(key)
            .cloned()
            .unwrap_or_else(|| panic!("catalog_seam: invoke args missing {key}")),
    )
    .unwrap_or_else(|error| panic!("catalog_seam: invoke args {key} has the wrong shape: {error}"))
}

/// The read fields that determine identity/presence/content for SYS-01/SYS-05/WATCH-07. Mirrors
/// `projectCatalogRow` in `tests/support/catalog-seam-recorder.ts`.
fn project_row(row: &catalog::CatalogRow) -> Value {
    json!({
        "id": row.id,
        "relativePath": row.relative_path,
        "localPresent": row.local_present,
        "bindingRootId": row.binding_root_id,
        "contentHash": row.content_hash,
    })
}

fn project_row_option(row: Option<&catalog::CatalogRow>) -> Value {
    match row {
        Some(row) => project_row(row),
        None => Value::Null,
    }
}

/// Mirrors `projectWorkspaceSync` in the recorder: the `relativePath` → `id`
/// map, content hashes, and `unboundPaths`, sorted by path on both sides (the
/// identities and hashes are the signal, not the order).
///
/// `folderCount` is deliberately NOT compared, exactly as in the recorder: no
/// consumer of the recorded sequence reads it, and the two sides count
/// different things — the double counts folders of the bound manifest, Rust
/// counts the scanned scope — so they diverge only on passes that still have
/// unbound paths, with no SYS-01/SYS-05/WATCH-07 signal. Comparing it would encode
/// double-only semantics into the recording.
fn project_workspace_sync(snapshot: &workspace::WorkspaceSnapshot) -> Value {
    let mut files: Vec<(String, String, String)> = snapshot
        .files
        .iter()
        .map(|file| (file.relative_path.clone(), file.id.clone(), file.content_hash.clone()))
        .collect();
    files.sort();
    let mut unbound_paths = snapshot.unbound_paths.clone();
    unbound_paths.sort();
    // Mirrors the recorder: inode is deliberately excluded (synthetic in the
    // double, real in the replay), so the compared evidence is path + hash +
    // size, sorted by path on both sides.
    let mut unbound_files: Vec<(String, String, u64)> = snapshot
        .unbound_files
        .iter()
        .map(|file| {
            (
                file.relative_path.clone(),
                file.content_hash.clone(),
                file.size,
            )
        })
        .collect();
    unbound_files.sort();
    json!({
        "files": files
            .into_iter()
            .map(|(relative_path, id, content_hash)| {
                json!({ "relativePath": relative_path, "id": id, "contentHash": content_hash })
            })
            .collect::<Vec<Value>>(),
        "unboundPaths": unbound_paths,
        "unboundFiles": unbound_files
            .into_iter()
            .map(|(relative_path, content_hash, size)| {
                json!({ "relativePath": relative_path, "contentHash": content_hash, "size": size })
            })
            .collect::<Vec<Value>>(),
    })
}

/// Mirrors `projectReconcile` in the recorder.
fn project_reconcile_result(result: &catalog::CatalogReconcileResult) -> Value {
    json!({ "applied": result.applied, "changed": result.changed })
}

/// Mirrors the recorder's `workspace_touch_file` projection. `file.path` is
/// excluded because the real command canonicalizes the root (`/var` →
/// `/private/var` on macOS) and the canonical path already travels in the
/// recorded `catalog_dual_write` args; inode/modifiedAt/device are excluded for
/// the same reason as `unboundFiles.inode` (real fs in the replay, synthetic in
/// the recording). What is compared is the binding identity and content
/// evidence the save path consumes: id, relative path, name, size, hash.
fn project_touch(result: &workspace::WorkspaceFileTouchResult) -> Value {
    match result {
        workspace::WorkspaceFileTouchResult::Updated {
            root_path,
            binding_root_id,
            file,
        } => json!({
            "status": "updated",
            "rootPath": root_path,
            "bindingRootId": binding_root_id,
            "file": {
                "id": file.id,
                "relativePath": file.relative_path,
                "name": file.name,
                "size": file.size,
                "contentHash": file.content_hash,
            },
        }),
        workspace::WorkspaceFileTouchResult::NeedsReconcile { reason } => {
            json!({ "status": "needsReconcile", "reason": reason })
        }
    }
}

/// Mirrors the recorder's mutation listing projection. `payloadJson` is
/// deliberately excluded: it is a byte-for-byte echo of the
/// `catalog_dual_write` argument already in the fixture.
fn project_mutation_row(row: &catalog::CatalogMutationRow) -> Value {
    json!({
        "id": row.id,
        "documentId": row.document_id,
        "operation": row.operation,
        "status": row.status,
        "attemptCount": row.attempt_count,
        "nextRetryAt": row.next_retry_at,
        "createdAt": row.created_at,
        "lastError": row.last_error,
    })
}

/// Mirrors the recorder's metadata listing projection (same `payloadJson`
/// exclusion).
fn project_metadata_mutation_row(row: &catalog::CatalogMetadataMutationRow) -> Value {
    json!({
        "id": row.id,
        "entityKind": row.entity_kind,
        "entityId": row.entity_id,
        "operation": row.operation,
        "status": row.status,
        "attemptCount": row.attempt_count,
        "nextRetryAt": row.next_retry_at,
        "createdAt": row.created_at,
        "lastError": row.last_error,
    })
}

/// Mirrors `projectMetadataRow` in the recorder: the fields the SYNC-08
/// Settings producer reads from `catalog_list` and the metadata caches the
/// controls assert. Machine-dependent fields (inode, size, lastSeenAt,
/// excerpt) are excluded exactly as on the TS side.
fn project_metadata_row(row: &catalog::CatalogRow) -> Value {
    json!({
        "id": row.id,
        "localPresent": row.local_present,
        "cloudPresent": row.cloud_present,
        "cloudAccountId": row.cloud_account_id,
        "syncStatus": row.sync_status,
        "title": row.title,
        "slug": row.slug,
        "status": row.status,
        "artifactType": row.artifact_type,
        "visibility": row.visibility,
        "version": row.version,
        "deletedAt": row.deleted_at,
        "createdAt": row.created_at,
        "modifiedAt": row.modified_at,
        "bindingRootId": row.binding_root_id,
        "relativePath": row.relative_path,
        "canonicalPath": row.canonical_path,
        "contentHash": row.content_hash,
    })
}

/// Mirrors the recorder's mutation payload projection: only the fields that
/// distinguish a metadata mutation from a body one, never the whole
/// `payload_json` echo.
fn project_control_payload(payload_json: &str) -> Result<Value, String> {
    let payload: Value = serde_json::from_str(payload_json)
        .map_err(|error| format!("control payload is not JSON: {error}"))?;
    let text = |key: &str| match payload.get(key) {
        Some(Value::String(value)) => Value::String(value.clone()),
        _ => Value::Null,
    };
    let number = |key: &str| match payload.get(key) {
        Some(Value::Number(value)) => Value::Number(value.clone()),
        _ => Value::Null,
    };
    Ok(json!({
        "mutationKind": text("mutationKind"),
        "version": number("version"),
        "updatedAt": text("updatedAt"),
        "status": text("status"),
        "artifactType": text("artifactType"),
    }))
}

/// Dispatch one recorded `invoke` to the real command and project its response
/// with the same shape the recorder recorded. The caller asserts the projected
/// response equals the recording: the recorded args are only valid while the
/// real command still returns the identity/presence/content fields the TS double
/// returned (P2-1, ODE-613 review).
fn dispatch(cmd: &str, args: &Value) -> Result<Value, String> {
    match cmd {
        "workspace_sync" => {
            let root_path = string_arg(args, "rootPath");
            let selected_paths: Option<Vec<String>> = serde_json::from_value(
                args.get("selectedPaths").cloned().unwrap_or(Value::Null),
            )
            .map_err(|error| format!("workspace_sync selectedPaths: {error}"))?;
            let document_ids: Option<HashMap<String, String>> = serde_json::from_value(
                args.get("documentIds").cloned().unwrap_or(Value::Null),
            )
            .map_err(|error| format!("workspace_sync documentIds: {error}"))?;
            workspace::workspace_sync(root_path, selected_paths, document_ids)
                .map(|snapshot| project_workspace_sync(&snapshot))
        }
        "catalog_list_binding_root_documents" => catalog::catalog_list_binding_root_documents(
            string_arg(args, "dbPath"),
            string_arg(args, "bindingRootId"),
        )
        .map(|rows| Value::Array(rows.iter().map(project_row).collect())),
        "catalog_get_by_id" => catalog::catalog_get_by_id(
            string_arg(args, "dbPath"),
            string_arg(args, "id"),
        )
        .map(|row| project_row_option(row.as_ref())),
        "catalog_resolve_path" => catalog::catalog_resolve_path(
            string_arg(args, "dbPath"),
            string_arg(args, "path"),
        )
        .map(|row| project_row_option(row.as_ref())),
        "catalog_apply_reconcile" => {
            let input: catalog::CatalogReconcileInput =
                serde_json::from_value(args.get("input").cloned().unwrap_or(Value::Null))
                    .map_err(|error| format!("catalog_apply_reconcile input: {error}"))?;
            catalog::catalog_apply_reconcile(string_arg(args, "dbPath"), input)
                .map(|result| project_reconcile_result(&result))
        }
        // ── SYNC-05: la cadena de guardado y la cola de mutaciones ────────────
        "write_file" => {
            let expected: Option<String> = typed_arg(args, "expectedContentHash");
            let path = string_arg(args, "path");
            // ODE-635: the optional identity guard. The recording carries the
            // model fs's synthetic inode (machine-dependent values are excluded
            // from projections for the same reason — see
            // `project_workspace_sync`); the replayed file lives on the real
            // fs, so any recorded `Some` is re-pointed at the real file's
            // inode: the guard stays engaged instead of comparing synthetic
            // identity against real identity. An absent key (recordings made
            // before the guard) stays `None`.
            let expected_inode = match args.get("expectedInode").and_then(Value::as_u64) {
                Some(_) => real_file_inode(&path),
                None => None,
            };
            document::write_file(path, string_arg(args, "content"), expected, expected_inode)
                .map(|()| Value::Null)
        }
        "open_file" => document::open_file(string_arg(args, "path")).map(Value::String),
        "workspace_touch_file" => workspace::workspace_touch_file(
            string_arg(args, "rootPath"),
            string_arg(args, "relativePath"),
            string_arg(args, "documentId"),
        )
        .map(|result| project_touch(&result)),
        "catalog_dual_write" => {
            let input: catalog::CatalogDualWriteInput = typed_arg(args, "input");
            catalog::catalog_dual_write(string_arg(args, "dbPath"), input).map(|()| Value::Null)
        }
        "catalog_list_pending_mutations" => catalog::catalog_list_pending_mutations(
            string_arg(args, "dbPath"),
            typed_arg(args, "now"),
            typed_arg(args, "limit"),
            typed_arg(args, "includeFailed"),
        )
        .map(|rows| Value::Array(rows.iter().map(project_mutation_row).collect())),
        "catalog_update_mutation_status" => catalog::catalog_update_mutation_status(
            string_arg(args, "dbPath"),
            string_arg(args, "mutationId"),
            string_arg(args, "status"),
            typed_arg(args, "attemptCount"),
            typed_arg(args, "nextRetryAt"),
            typed_arg(args, "lastError"),
        )
        .map(|()| Value::Null),
        "catalog_list_pending_metadata_mutations" => {
            catalog::catalog_list_pending_metadata_mutations(
                string_arg(args, "dbPath"),
                typed_arg(args, "now"),
                typed_arg(args, "limit"),
                typed_arg(args, "includeFailed"),
            )
            .map(|rows| {
                Value::Array(rows.iter().map(project_metadata_mutation_row).collect())
            })
        }
        "catalog_apply_cloud_snapshots" => {
            let snapshots: Vec<catalog::CatalogCloudSnapshotInput> = typed_arg(args, "snapshots");
            catalog::catalog_apply_cloud_snapshots(string_arg(args, "dbPath"), snapshots)
                .map(|()| Value::Null)
        }
        // ── SYNC-08: la ruta de metadata de Settings (ODE-670) ────────────────
        "catalog_list" => catalog::catalog_list(
            string_arg(args, "dbPath"),
            typed_arg(args, "cloudAccountId"),
            typed_arg(args, "includeDeleted"),
            typed_arg(args, "localOnly"),
            typed_arg(args, "limit"),
        )
        .map(|rows| Value::Array(rows.iter().map(project_metadata_row).collect())),
        "catalog_bulk_dual_write" => {
            let inputs: Vec<catalog::CatalogDualWriteInput> = typed_arg(args, "inputs");
            catalog::catalog_bulk_dual_write(string_arg(args, "dbPath"), inputs).map(|ids| {
                Value::Array(ids.into_iter().map(Value::String).collect())
            })
        }
        "settings_read" => settings::settings_read(
            string_arg(args, "configDir"),
            string_arg(args, "key"),
        )
        .and_then(|raw| {
            serde_json::from_str(&raw).map_err(|error| format!("settings_read decode: {error}"))
        }),
        "settings_write" => settings::settings_write(
            string_arg(args, "configDir"),
            string_arg(args, "key"),
            string_arg(args, "valueJson"),
        )
        .map(|()| Value::Null),
        "settings_delete" => settings::settings_delete(
            string_arg(args, "configDir"),
            string_arg(args, "key"),
        )
        .map(|()| Value::Null),
        other => Err(format!(
            "catalog_seam: unhandled command {other} — extend the Rust dispatch to cover it"
        )),
    }
}

/// Req 5: contrast the recorded control state with a brand-new SQLite
/// connection — `documents.sync_status`/`cloud_present` and every
/// `sync_mutations` row of the document, ordered like the real listing
/// (`created_at ASC`) with `id` as the deterministic tiebreak the recorder uses.
/// When the scenario declares `document.metadata` (SYNC-08), the metadata
/// caches and the binding content hash are compared field by field; when it
/// declares a mutation payload, the projection that distinguishes a metadata
/// mutation from a body one is compared too.
fn assert_control(step: &ControlStep, paths: &PlaceholderPaths, scenario: &Scenario) {
    let connection =
        Connection::open(&paths.db).expect("catalog_seam: open catalog for the control step");
    let (
        sync_status,
        cloud_present,
        status_cache,
        artifact_type_cache,
        version_cache,
        title_cache,
        slug_cache,
        visibility_cache,
        cloud_account_id,
        binding_content_hash,
    ): (
        String,
        i64,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = connection
        .query_row(
            "SELECT d.sync_status, d.cloud_present, d.status_cache, d.artifact_type_cache,
                    d.version_cache, d.title_cache, d.slug_cache, d.visibility_cache,
                    d.cloud_account_id, b.content_hash
             FROM documents d LEFT JOIN document_bindings b ON b.document_id=d.id
             WHERE d.id=?1",
            params![step.document_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                ))
            },
        )
        .unwrap_or_else(|error| {
            panic!(
                "scenario {}: control {}: documents row {} unreadable: {error}",
                scenario.name, step.name, step.document_id
            )
        });
    assert_eq!(
        sync_status, step.document.sync_status,
        "scenario {}: control {}: documents.sync_status diverged",
        scenario.name, step.name
    );
    assert_eq!(
        cloud_present != 0,
        step.document.cloud_present,
        "scenario {}: control {}: documents.cloud_present diverged",
        scenario.name, step.name
    );
    if let Some(metadata) = &step.document.metadata {
        assert_eq!(
            status_cache, metadata.status,
            "scenario {}: control {}: documents.status_cache diverged",
            scenario.name, step.name
        );
        assert_eq!(
            artifact_type_cache, metadata.artifact_type,
            "scenario {}: control {}: documents.artifact_type_cache diverged",
            scenario.name, step.name
        );
        assert_eq!(
            version_cache, metadata.version,
            "scenario {}: control {}: documents.version_cache diverged",
            scenario.name, step.name
        );
        assert_eq!(
            title_cache, metadata.title,
            "scenario {}: control {}: documents.title_cache diverged",
            scenario.name, step.name
        );
        assert_eq!(
            slug_cache, metadata.slug,
            "scenario {}: control {}: documents.slug_cache diverged",
            scenario.name, step.name
        );
        assert_eq!(
            visibility_cache, metadata.visibility,
            "scenario {}: control {}: documents.visibility_cache diverged",
            scenario.name, step.name
        );
        assert_eq!(
            cloud_account_id, metadata.cloud_account_id,
            "scenario {}: control {}: documents.cloud_account_id diverged",
            scenario.name, step.name
        );
        assert_eq!(
            binding_content_hash, metadata.content_hash,
            "scenario {}: control {}: document_bindings.content_hash diverged",
            scenario.name, step.name
        );
    }

    let wants_payload = step.mutations.iter().any(|mutation| mutation.payload.is_some());
    let mut statement = connection
        .prepare(
            "SELECT id,status,attempt_count,next_retry_at,last_error,payload_json FROM sync_mutations
             WHERE document_id=?1 ORDER BY created_at ASC, id ASC",
        )
        .expect("catalog_seam: prepare control mutations");
    let raw_mutations: Vec<(String, String, i64, Option<i64>, Option<String>, String)> = statement
        .query_map(params![step.document_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .expect("catalog_seam: query control mutations")
        .collect::<Result<_, _>>()
        .expect("catalog_seam: collect control mutations");
    let actual_mutations: Vec<Value> = raw_mutations
        .iter()
        .map(|(id, status, attempt_count, next_retry_at, last_error, payload_json)| {
            let mut value = json!({
                "id": id,
                "status": status,
                "attemptCount": attempt_count,
                "nextRetryAt": next_retry_at,
                "lastError": last_error,
            });
            if wants_payload {
                value["payload"] = project_control_payload(payload_json).unwrap_or_else(|error| {
                    panic!(
                        "scenario {}: control {}: mutation {id} payload unreadable: {error}",
                        scenario.name, step.name
                    )
                });
            }
            value
        })
        .collect();
    let expected_mutations: Vec<Value> = step
        .mutations
        .iter()
        .map(|mutation| {
            let mut value = json!({
                "id": mutation.id,
                "status": mutation.status,
                "attemptCount": mutation.attempt_count,
                "nextRetryAt": mutation.next_retry_at,
                "lastError": mutation.last_error,
            });
            if let Some(payload) = &mutation.payload {
                value["payload"] = json!({
                    "mutationKind": payload.mutation_kind,
                    "version": payload.version,
                    "updatedAt": payload.updated_at,
                    "status": payload.status,
                    "artifactType": payload.artifact_type,
                });
            }
            value
        })
        .collect();
    assert_eq!(
        actual_mutations, expected_mutations,
        "scenario {}: control {}: sync_mutations diverged from the recording",
        scenario.name, step.name
    );
}

fn apply_fs_step(step: &FsStep, paths: &PlaceholderPaths) {
    let root = paths.root_dir(&step.root);
    match step.op.as_str() {
        "seed-manifest" => {
            let manifest_dir = root.join(".odessay");
            fs::create_dir_all(&manifest_dir).expect("catalog_seam: create .odessay dir");
            let binding_root_id = step
                .binding_root_id
                .as_deref()
                .expect("catalog_seam: seed-manifest needs bindingRootId");
            let index = format!(
                "{}",
                serde_json::json!({
                    "version": 2,
                    "bindingRootId": binding_root_id,
                    "selectedPaths": [],
                    "files": {}
                })
            );
            fs::write(manifest_dir.join("index.json"), index)
                .expect("catalog_seam: write manifest");
        }
        "write" => {
            let relative = step
                .relative_path
                .as_deref()
                .expect("catalog_seam: fs write needs relativePath");
            let target = root.join(relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).expect("catalog_seam: create parent dir");
            }
            fs::write(&target, step.content.as_deref().unwrap_or_default())
                .expect("catalog_seam: write file");
        }
        "rename" => {
            let from = root.join(
                step.relative_path
                    .as_deref()
                    .expect("catalog_seam: fs rename needs relativePath"),
            );
            let to = root.join(
                step.new_relative_path
                    .as_deref()
                    .expect("catalog_seam: fs rename needs newRelativePath"),
            );
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).expect("catalog_seam: create rename parent dir");
            }
            fs::rename(&from, &to).expect("catalog_seam: rename file");
        }
        "delete" => {
            let target = root.join(
                step.relative_path
                    .as_deref()
                    .expect("catalog_seam: fs delete needs relativePath"),
            );
            fs::remove_file(&target).expect("catalog_seam: delete file");
        }
        other => panic!("catalog_seam: unknown fs op {other}"),
    }
}

fn resolve(db_path: &str, path: &str) -> Option<catalog::CatalogRow> {
    catalog::catalog_resolve_path(db_path.to_string(), path.to_string())
        .unwrap_or_else(|error| panic!("catalog_resolve_path({path}): {error}"))
}

fn get_by_id(db_path: &str, id: &str) -> Option<catalog::CatalogRow> {
    catalog::catalog_get_by_id(db_path.to_string(), id.to_string())
        .unwrap_or_else(|error| panic!("catalog_get_by_id({id}): {error}"))
}

struct ExpectedDocument {
    final_path: Option<String>,
    earlier_paths: Vec<String>,
    relative_path: String,
}

/// Derive the sequence's declared end state from the recorded reconcile
/// commits: every upsert binds an id to a path, every detach clears it.
fn expected_documents(scenario: &Scenario, paths: &PlaceholderPaths) -> HashMap<String, ExpectedDocument> {
    let mut expected: HashMap<String, ExpectedDocument> = HashMap::new();
    for step in &scenario.steps {
        let Step::Invoke(invoke) = step else { continue };
        if invoke.cmd != "catalog_apply_reconcile" {
            continue;
        }
        let input = &invoke.args["input"];
        let upserts = input["upserts"]
            .as_array()
            .unwrap_or_else(|| panic!("scenario {}: reconcile upserts missing", scenario.name));
        for upsert in upserts {
            let document_id = upsert["documentId"].as_str().unwrap().to_string();
            let canonical_path = rewrite_str(upsert["canonicalPath"].as_str().unwrap(), paths);
            let relative_path = upsert["relativePath"].as_str().unwrap().to_string();
            let entry = expected.entry(document_id).or_insert_with(|| ExpectedDocument {
                final_path: None,
                earlier_paths: Vec::new(),
                relative_path: relative_path.clone(),
            });
            if entry.final_path.as_deref() != Some(canonical_path.as_str()) {
                if let Some(previous) = entry.final_path.take() {
                    entry.earlier_paths.push(previous);
                }
                entry.final_path = Some(canonical_path);
            }
            entry.relative_path = relative_path;
        }
        let detached = input["detached"]
            .as_array()
            .unwrap_or_else(|| panic!("scenario {}: reconcile detached missing", scenario.name));
        for id in detached {
            let document_id = id.as_str().unwrap().to_string();
            let entry = expected.entry(document_id).or_insert_with(|| ExpectedDocument {
                final_path: None,
                earlier_paths: Vec::new(),
                relative_path: String::new(),
            });
            if let Some(previous) = entry.final_path.take() {
                entry.earlier_paths.push(previous);
            }
        }
    }
    expected
}

fn markdown_files_under(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            markdown_files_under(&path, out);
        } else if path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            out.push(path);
        }
    }
}

fn assert_scenario(scenario: &Scenario, paths: &PlaceholderPaths) {
    let db_path = paths.db.to_string_lossy().into_owned();
    let expected = expected_documents(scenario, paths);
    assert!(
        !expected.is_empty(),
        "scenario {} recorded no reconcile commits",
        scenario.name
    );

    for (id, document) in &expected {
        match &document.final_path {
            Some(final_path) => {
                // SYS-01 — the same UUID resolves to the same document after the
                // whole sequence, including the catalog restart (every command
                // above opened its own connection; this is a fresh read).
                let resolved = resolve(&db_path, final_path).unwrap_or_else(|| {
                    panic!(
                        "scenario {}: final path {final_path} did not resolve to a catalog row",
                        scenario.name
                    )
                });
                assert_eq!(
                    resolved.id, *id,
                    "scenario {}: resolve_path({final_path}) returned the wrong document",
                    scenario.name
                );
                let by_id = get_by_id(&db_path, id).unwrap_or_else(|| {
                    panic!("scenario {}: getById({id}) returned nothing", scenario.name)
                });
                assert_eq!(
                    by_id.canonical_path.as_deref(),
                    Some(final_path.as_str()),
                    "scenario {}: UUID {id} lost its binding",
                    scenario.name
                );
                assert!(
                    by_id.local_present,
                    "scenario {}: UUID {id} should be local_present at {final_path}",
                    scenario.name
                );
                // SYS-05 — canonical state: the row exists because the file
                // does, at that exact path.
                assert!(
                    Path::new(final_path).is_file(),
                    "scenario {}: catalog row {id} points at {final_path} but the file is gone",
                    scenario.name
                );
                for earlier in &document.earlier_paths {
                    if earlier == final_path {
                        continue;
                    }
                    let earlier_resolution = resolve(&db_path, earlier);
                    assert_ne!(
                        earlier_resolution.map(|row| row.id),
                        Some(id.clone()),
                        "scenario {}: UUID {id} still resolves through its old path {earlier}",
                        scenario.name
                    );
                }
            }
            None => {
                // Confirmed-external absence: the row survives (cloud metadata
                // is never deleted here) but it is detached from disk.
                let by_id = get_by_id(&db_path, id).unwrap_or_else(|| {
                    panic!("scenario {}: detached UUID {id} lost its row", scenario.name)
                });
                assert!(
                    !by_id.local_present,
                    "scenario {}: detached UUID {id} is still local_present",
                    scenario.name
                );
                assert_eq!(
                    by_id.canonical_path, None,
                    "scenario {}: detached UUID {id} kept a binding",
                    scenario.name
                );
                for earlier in &document.earlier_paths {
                    assert!(
                        !Path::new(earlier).exists(),
                        "scenario {}: detached UUID {id} path {earlier} still exists on disk",
                        scenario.name
                    );
                    assert!(
                        resolve(&db_path, earlier).is_none(),
                        "scenario {}: detached path {earlier} still resolves",
                        scenario.name
                    );
                }
            }
        }
        if !document.relative_path.is_empty() && document.final_path.is_some() {
            // The recorded binding's relative path must match the real path.
            let final_path = document.final_path.as_deref().unwrap();
            assert!(
                final_path.ends_with(&document.relative_path),
                "scenario {}: binding {final_path} does not end with {}",
                scenario.name,
                document.relative_path
            );
        }
    }

    // Homonyms never collide: two documents whose recorded relative paths are
    // equal must sit at different canonical paths with different UUIDs.
    let mut by_relative_path: HashMap<&str, Vec<(&String, &str)>> = HashMap::new();
    for (id, document) in &expected {
        if let Some(final_path) = document.final_path.as_deref() {
            by_relative_path
                .entry(document.relative_path.as_str())
                .or_default()
                .push((id, final_path));
        }
    }
    for (relative_path, documents) in by_relative_path {
        for (index, (id, canonical_path)) in documents.iter().enumerate() {
            for (other_index, (other_id, other_canonical)) in documents.iter().enumerate() {
                if index == other_index {
                    continue;
                }
                assert_ne!(id, other_id, "scenario {}: homonyms share UUID", scenario.name);
                assert_ne!(
                    canonical_path, other_canonical,
                    "scenario {}: homonym {relative_path} at the same canonical path",
                    scenario.name
                );
                let resolved = resolve(&db_path, canonical_path).unwrap();
                assert_eq!(
                    resolved.id, **id,
                    "scenario {}: homonym {relative_path} resolved across roots",
                    scenario.name
                );
            }
        }
    }

    // SYS-05 — canonical rows vs. files: every markdown file on disk has a
    // local_present row bound at exactly that path, and every binding points at
    // a real file (no orphan rows, no unbound files, deleted ones excluded).
    let mut files = Vec::new();
    for root in [&paths.root_a, &paths.root_b] {
        markdown_files_under(root, &mut files);
    }
    assert!(
        !files.is_empty(),
        "scenario {}: no markdown files on disk to compare",
        scenario.name
    );
    for file in &files {
        let file_path = file.to_string_lossy().into_owned();
        let row = resolve(&db_path, &file_path).unwrap_or_else(|| {
            panic!(
                "scenario {}: file {file_path} has no catalog row",
                scenario.name
            )
        });
        assert!(
            row.local_present,
            "scenario {}: row for {file_path} is not local_present",
            scenario.name
        );
    }

    // Direct SQLite read on a brand-new connection: the durable rows (not just
    // the command responses) carry the invariant.
    let connection = Connection::open(&paths.db).expect("catalog_seam: open catalog for reading");
    let mut statement = connection
        .prepare(
            "SELECT d.id, d.local_present, b.canonical_path, b.content_hash
             FROM documents d LEFT JOIN document_bindings b ON b.document_id = d.id",
        )
        .expect("catalog_seam: prepare join");
    let rows: Vec<(String, bool, Option<String>, Option<String>)> = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get::<_, i64>(1)? != 0, row.get(2)?, row.get(3)?))
        })
        .expect("catalog_seam: query join")
        .collect::<Result<_, _>>()
        .expect("catalog_seam: collect join");
    for (id, local_present, canonical_path, content_hash) in &rows {
        let expected_row = expected.get(id).unwrap_or_else(|| {
            panic!("scenario {}: SQLite has an unexpected document {id}", scenario.name)
        });
        assert_eq!(
            *local_present,
            expected_row.final_path.is_some(),
            "scenario {}: documents.local_present disagrees for {id}",
            scenario.name
        );
        assert_eq!(
            canonical_path.as_deref(),
            expected_row.final_path.as_deref(),
            "scenario {}: binding disagrees for {id}",
            scenario.name
        );
        let disk_hash = canonical_path.as_ref().map(|file_path| {
            let markdown = fs::read_to_string(file_path).unwrap_or_else(|error| {
                panic!("scenario {}: read {file_path} for content hash: {error}", scenario.name)
            });
            workspace::workspace_compute_content_hash(markdown).unwrap_or_else(|error| {
                panic!("scenario {}: hash {file_path}: {error}", scenario.name)
            })
        });
        assert_eq!(
            content_hash.as_deref(),
            disk_hash.as_deref(),
            "scenario {}: fresh SQLite content_hash disagrees with disk for {id}",
            scenario.name
        );
    }
    for id in expected.keys() {
        assert!(
            rows.iter().any(|(row_id, _, _, _)| row_id == id),
            "scenario {}: SQLite is missing document {id}",
            scenario.name
        );
    }
}

#[test]
fn catalog_seam_replays_the_recorded_ts_sequence_over_real_sqlite() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("catalog_seam: parse fixture");
    assert_eq!(fixture.version, 4, "catalog_seam: unexpected fixture version");
    assert!(!fixture.scenarios.is_empty());

    let base = std::env::temp_dir().join(format!("odessay-catalog-seam-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&base).expect("catalog_seam: create temp base");

    for scenario in &fixture.scenarios {
        let scenario_base = base.join(&scenario.name);
        let paths = PlaceholderPaths {
            root_a: scenario_base.join("root-a"),
            root_b: scenario_base.join("root-b"),
            db: scenario_base.join("desktop-index.sqlite3"),
            config: scenario_base.join("config"),
        };
        fs::create_dir_all(&paths.root_a).expect("catalog_seam: create root A");
        fs::create_dir_all(&paths.root_b).expect("catalog_seam: create root B");

        for (index, step) in scenario.steps.iter().enumerate() {
            match step {
                Step::Fs(fs_step) => apply_fs_step(fs_step, &paths),
                Step::Control(control) => assert_control(control, &paths, scenario),
                Step::Invoke(invoke) => {
                    let args = rewrite(&invoke.args, &paths);
                    let actual = dispatch(&invoke.cmd, &args).unwrap_or_else(|error| {
                        panic!(
                            "scenario {}: step {index}: {} failed: {error}",
                            scenario.name, invoke.cmd
                        )
                    });
                    let expected = rewrite(&invoke.response, &paths);
                    assert_eq!(
                        actual, expected,
                        "scenario {}: step {index}: {} response diverged from the recording — the \
                         real command no longer returns the identity/presence/content fields the TS \
                         wrapper recorded. If the change is intentional, regenerate the fixture \
                         (UPDATE_CATALOG_SEAM_FIXTURE=1 npx vitest run tests/catalog-seam-fixture.test.ts) \
                         and review the TS consumers of the changed shape.",
                        scenario.name, invoke.cmd
                    );
                }
            }
        }

        // `queue` scenarios do not register documents through the reconciler;
        // their canonical state is asserted by the control steps above.
        if scenario.profile == ScenarioProfile::Filesystem {
            assert_scenario(scenario, &paths);
        }
    }

    let _ = fs::remove_dir_all(&base);
}
