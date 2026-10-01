//! ODE-547 — CONFIG-07 (desktop half): the bulk dual-write is all-or-nothing.
//!
//! `DesktopSettingsService.deleteVocabularyItem` rewrites every matching catalog
//! row through one `catalog_bulk_dual_write`. The existing Vitest proof only
//! covers a failure armed *before* the batch starts: its behavioral double
//! applies rows one by one, so it cannot show mid-batch atomicity. This test
//! drives the real command over a real SQLite catalog — a valid row A lands in
//! the transaction, a later row B fails at the last statement of its own dual
//! write (the `sync_mutations` CHECK rejects `operation="unsupported"`), and the
//! whole batch — A's document, binding and queue rows plus the supersede of A's
//! older pending mutation — must roll back together.
//!
//! This file is intentionally separate from `src/commands/index.rs`: the pack
//! decided the new proof lives in its own integration-test binary, with its own
//! helpers (the unit-test module's `temp_db`/`input` are private to it).

use odessay_lib::commands::index as catalog;
use rusqlite::{params, Connection};
use uuid::Uuid;

fn temp_db() -> String {
    std::env::temp_dir()
        .join(format!("odessay-bulk-rollback-{}.sqlite3", Uuid::new_v4()))
        .to_string_lossy()
        .to_string()
}

fn document(id: &str, artifact_type: &str, version: i64) -> catalog::CatalogDocumentInput {
    catalog::CatalogDocumentInput {
        id: id.into(),
        local_present: true,
        cloud_present: true,
        cloud_account_id: Some("account-1".into()),
        sync_status: "pending".into(),
        title: Some(format!("Doc {id}")),
        slug: None,
        status: Some("draft".into()),
        artifact_type: Some(artifact_type.into()),
        visibility: Some("private".into()),
        version: Some(version),
        deleted_at: None,
        created_at: Some(1),
        modified_at: Some(2),
    }
}

fn mutation(id: &str) -> catalog::CatalogMutationInput {
    catalog::CatalogMutationInput {
        id: id.into(),
        operation: "upsert".into(),
        payload_json: "{}".into(),
        status: "pending".into(),
        attempt_count: 0,
        next_retry_at: None,
        created_at: 2,
        last_error: None,
    }
}

/// One `apply_dual_write` row: document + binding + snapshot mutation — the
/// shape `rewriteCatalogToBaseValue` feeds the bulk command for a matching row.
fn dual_write(
    id: &str,
    root: &str,
    relative_path: &str,
    artifact_type: &str,
    version: i64,
    mutation_id: &str,
) -> catalog::CatalogDualWriteInput {
    catalog::CatalogDualWriteInput {
        document: document(id, artifact_type, version),
        binding: Some(catalog::CatalogBindingInput {
            binding_root_id: format!("root-{root}"),
            root_path: format!("/tmp/{root}"),
            manifest_version: 1,
            visible_as_workspace: false,
            relative_path: relative_path.into(),
            canonical_path: format!("/tmp/{root}/{relative_path}"),
            inode: None,
            content_hash: None,
            size: None,
            last_seen_at: Some(2),
        }),
        mutation: Some(mutation(mutation_id)),
    }
}

fn mutation_status(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row(
        "SELECT status FROM sync_mutations WHERE id=?1",
        params![id],
        |row| row.get(0),
    )
    .ok()
}

fn row_count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

#[test]
fn bulk_dual_write_rolls_back_a_valid_row_when_a_later_row_fails() {
    let path = temp_db();
    let valid = dual_write("doc-a", "root-a", "a.md", "custom", 1, "m-a");
    let mut invalid = dual_write("doc-b", "root-b", "b.md", "custom", 1, "m-b");
    invalid.mutation.as_mut().unwrap().operation = "unsupported".into();

    let error = catalog::catalog_bulk_dual_write(path.clone(), vec![valid, invalid])
        .expect_err("the batch must fail on row B");
    assert!(
        error.contains("catalog dual-write mutation"),
        "row B must fail at its mutation statement — after its document and binding already \
         landed in the transaction — not earlier: {error}"
    );

    let conn = Connection::open(&path).unwrap();
    for table in ["documents", "document_bindings", "sync_mutations"] {
        assert_eq!(
            row_count(&conn, &format!("SELECT COUNT(*) FROM {table}")),
            0,
            "{table} must be empty after the rollback: row A was written inside the failed transaction"
        );
    }
    drop(conn);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_mid_batch_failure_keeps_the_committed_catalog_and_its_pending_mutation() {
    let path = temp_db();
    // Committed state production reaches this batch with: two cataloged
    // documents carrying the custom type, each with its own pending snapshot.
    catalog::catalog_bulk_dual_write(
        path.clone(),
        vec![
            dual_write("doc-a", "root-a", "a.md", "custom", 1, "m-a-old"),
            dual_write("doc-b", "root-b", "b.md", "custom", 1, "m-b-old"),
        ],
    )
    .expect("the seed batch must commit");

    // The rewrite batch `deleteVocabularyItem` emits: both rows move to the
    // base type in one transaction. Row A is valid; row B is the fault.
    let rewritten_a = dual_write("doc-a", "root-a", "a.md", "general", 2, "m-a-new");
    let mut invalid_b = dual_write("doc-b", "root-b", "b.md", "general", 2, "m-b-new");
    invalid_b.mutation.as_mut().unwrap().operation = "unsupported".into();

    let error = catalog::catalog_bulk_dual_write(path.clone(), vec![rewritten_a, invalid_b])
        .expect_err("the batch must fail on row B");
    assert!(error.contains("catalog dual-write mutation"), "{error}");

    let row_a = catalog::catalog_get_by_id(path.clone(), "doc-a".into())
        .unwrap()
        .unwrap();
    let row_b = catalog::catalog_get_by_id(path.clone(), "doc-b".into())
        .unwrap()
        .unwrap();
    assert_eq!(
        row_a.artifact_type.as_deref(),
        Some("custom"),
        "A keeps the type it had committed"
    );
    assert_eq!(
        row_b.artifact_type.as_deref(),
        Some("custom"),
        "B keeps the type it had committed"
    );
    assert_eq!(row_a.version, Some(1), "A keeps its committed version");
    assert_eq!(row_b.version, Some(1), "B keeps its committed version");

    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        mutation_status(&conn, "m-a-old").as_deref(),
        Some("pending"),
        "the rollback must restore the pending mutation the failed batch had superseded"
    );
    assert_eq!(
        mutation_status(&conn, "m-b-old").as_deref(),
        Some("pending")
    );
    assert_eq!(
        row_count(
            &conn,
            "SELECT COUNT(*) FROM sync_mutations WHERE id IN ('m-a-new','m-b-new')"
        ),
        0,
        "the failed batch must not leave its own mutations behind"
    );
    drop(conn);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn the_same_row_commits_and_supersedes_when_the_batch_does_not_fail() {
    let path = temp_db();
    catalog::catalog_bulk_dual_write(
        path.clone(),
        vec![dual_write("doc-a", "root-a", "a.md", "custom", 1, "m-a-old")],
    )
    .expect("the seed batch must commit");

    // Positive control for the absences asserted above: with no failing row,
    // the very same rewrite commits and the older mutation stops being pending.
    catalog::catalog_bulk_dual_write(
        path.clone(),
        vec![dual_write("doc-a", "root-a", "a.md", "general", 2, "m-a-new")],
    )
    .expect("the valid batch must commit");

    let row_a = catalog::catalog_get_by_id(path.clone(), "doc-a".into())
        .unwrap()
        .unwrap();
    assert_eq!(row_a.artifact_type.as_deref(), Some("general"));
    assert_eq!(row_a.version, Some(2));

    let conn = Connection::open(&path).unwrap();
    // The exact supersede target is owned by ODE-644; this only pins that the
    // old mutation no longer sits in the actionable state.
    assert_ne!(
        mutation_status(&conn, "m-a-old").as_deref(),
        Some("pending"),
        "a committed snapshot supersedes the older pending mutation"
    );
    assert_eq!(
        mutation_status(&conn, "m-a-new").as_deref(),
        Some("pending")
    );
    drop(conn);
    let _ = std::fs::remove_file(&path);
}
