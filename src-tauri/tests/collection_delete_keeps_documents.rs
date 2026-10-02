//! ODE-618 (COL-06 desktop) — borrar una colección no borra ni corrompe sus
//! documentos.
//!
//! Entra por el comando real `catalog_delete_collection` (`index.rs`) sobre un
//! catálogo SQLite temporal real y `.md` reales en disco, sembrados por los
//! comandos de producción `catalog_dual_write`, `catalog_save_collection` y
//! `catalog_replace_writing_collections` — la secuencia real que arma una
//! colección con documentos en desktop. Afirma el resultado canónico después de
//! que el comando completa: los documentos y sus bindings sobreviven con la
//! misma ruta y hash, y los bytes de cada `.md` no cambian; la colección queda
//! soft-deleted y su mutación de metadata encolada.
//!
//! F6 (las filas de `writing_collections` de la colección borrada sobreviven,
//! así que un documento cuya única colección se borró desaparece de la vista
//! Collections) se caracteriza en el lado TS como `it.fails` y lo arregla
//! ODE-618 PR1b. Esta prueba no lo afirma: queda verde con el comportamiento
//! actual y con el arreglo.
//!
//! La costura TS → `invoke()` real → Rust/SQLite sigue siendo el gap nativo
//! declarado en `integration-harness-catalog.md`; aquí los `pub fn` reales se
//! llaman directo, que es la verdad de SQLite que el doble TS no puede dar.

use odessay_lib::commands::index as catalog;
use odessay_lib::commands::workspace;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

const ROOT_ID: &str = "root-ode-618";
const DOC_ONE: &str = "doc-ode-618-one";
const DOC_TWO: &str = "doc-ode-618-two";
const COLLECTION_ONE: &str = "collection-ode-618-one";
const COLLECTION_TWO: &str = "collection-ode-618-two";
const DELETE_MUTATION: &str = "mutation-ode-618-delete-one";

fn temp_base() -> PathBuf {
    std::env::temp_dir().join(format!("odessay-ode-618-{}", uuid::Uuid::new_v4()))
}

fn write_markdown(root: &Path, relative_path: &str, body: &str) -> String {
    let path = root.join(relative_path);
    fs::create_dir_all(path.parent().expect("markdown path has a parent"))
        .expect("create markdown parent dir");
    fs::write(&path, body).expect("write markdown file");
    path.to_string_lossy().into_owned()
}

fn document(id: &str) -> catalog::CatalogDocumentInput {
    catalog::CatalogDocumentInput {
        id: id.into(),
        local_present: true,
        cloud_present: false,
        cloud_account_id: None,
        sync_status: "pending".into(),
        title: Some(format!("Title {id}")),
        slug: None,
        status: Some("draft".into()),
        artifact_type: Some("general".into()),
        visibility: Some("private".into()),
        version: Some(1),
        deleted_at: None,
        created_at: Some(1),
        modified_at: Some(2),
    }
}

fn binding(
    root_path: &str,
    relative_path: &str,
    canonical_path: &str,
    content_hash: &str,
    size: u64,
) -> catalog::CatalogBindingInput {
    catalog::CatalogBindingInput {
        binding_root_id: ROOT_ID.into(),
        root_path: root_path.into(),
        manifest_version: 1,
        visible_as_workspace: false,
        relative_path: relative_path.into(),
        canonical_path: canonical_path.into(),
        inode: None,
        content_hash: Some(content_hash.into()),
        size: Some(size as i64),
        last_seen_at: Some(2),
    }
}

fn collection(id: &str, name: &str) -> catalog::CatalogCollectionInput {
    catalog::CatalogCollectionInput {
        id: id.into(),
        owner_id: Some("user-ode-618".into()),
        name: name.into(),
        description: None,
        visibility: "private".into(),
        sync_status: "pending".into(),
        lifecycle: "local-only".into(),
        deleted_at: None,
        created_at: "2026-10-01T12:00:00.000Z".into(),
        updated_at: "2026-10-01T12:00:00.000Z".into(),
        local_updated_at: 1,
    }
}

/// Lee documentos, bindings y filas de metadata con una conexión nueva: lo
/// durable, no la respuesta del comando.
fn read_rows(db_path: &str) -> Vec<(String, bool, Option<String>, Option<String>)> {
    let connection = Connection::open(db_path).expect("open catalog for reading");
    let mut statement = connection
        .prepare(
            "SELECT d.id, d.local_present, b.canonical_path, b.content_hash
             FROM documents d LEFT JOIN document_bindings b ON b.document_id = d.id
             WHERE d.id IN (?1, ?2)
             ORDER BY d.id",
        )
        .expect("prepare document read");
    statement
        .query_map([DOC_ONE, DOC_TWO], |row| {
            Ok((
                row.get(0)?,
                row.get::<_, i64>(1)? != 0,
                row.get(2)?,
                row.get(3)?,
            ))
        })
        .expect("query documents")
        .collect::<Result<_, _>>()
        .expect("collect documents")
}

#[test]
fn deleting_a_collection_keeps_its_documents_bindings_and_markdown() {
    let base = temp_base();
    let root = base.join("root");
    fs::create_dir_all(&root).expect("create temp root");
    let db = base.join("desktop-index.sqlite3");
    let db_path = db.to_string_lossy().into_owned();

    let one_body = "# One\n\nFirst document body.\n";
    let two_body = "# Two\n\nSecond document body.\n";
    let one_path = write_markdown(&root, "one.md", one_body);
    let two_path = write_markdown(&root, "two.md", two_body);
    let one_bytes = fs::read(&one_path).expect("read one.md before delete");
    let two_bytes = fs::read(&two_path).expect("read two.md before delete");
    let one_hash =
        workspace::workspace_compute_content_hash(one_body.to_string()).expect("hash one.md");
    let two_hash =
        workspace::workspace_compute_content_hash(two_body.to_string()).expect("hash two.md");

    // Secuencia real de producción: dual-write de cada documento con su binding
    // al `.md` en disco, alta de las dos colecciones y asignación de cada
    // documento a sus colecciones.
    for (id, path, hash, size) in [
        (DOC_ONE, &one_path, &one_hash, one_bytes.len()),
        (DOC_TWO, &two_path, &two_hash, two_bytes.len()),
    ] {
        let document_binding = binding(
            &root.to_string_lossy(),
            Path::new(path)
                .file_name()
                .expect("markdown file name")
                .to_string_lossy()
                .as_ref(),
            path,
            hash,
            size as u64,
        );
        catalog::catalog_dual_write(
            db_path.clone(),
            catalog::CatalogDualWriteInput {
                document: document(id),
                binding: Some(document_binding),
                mutation: None,
            },
        )
        .unwrap_or_else(|error| panic!("catalog_dual_write({id}): {error}"));
    }
    catalog::catalog_save_collection(
        db_path.clone(),
        collection(COLLECTION_ONE, "Collection One"),
        None,
    )
    .expect("save collection one");
    catalog::catalog_save_collection(
        db_path.clone(),
        collection(COLLECTION_TWO, "Collection Two"),
        None,
    )
    .expect("save collection two");
    catalog::catalog_replace_writing_collections(
        db_path.clone(),
        DOC_ONE.into(),
        vec![COLLECTION_ONE.into(), COLLECTION_TWO.into()],
        "2026-10-01T12:00:00.000Z".into(),
        2,
        None,
    )
    .expect("assign one to both collections");
    catalog::catalog_replace_writing_collections(
        db_path.clone(),
        DOC_TWO.into(),
        vec![COLLECTION_ONE.into()],
        "2026-10-01T12:00:00.000Z".into(),
        3,
        None,
    )
    .expect("assign two to the deleted collection");

    // Control positivo de alcanzabilidad: antes del borrado los dos documentos,
    // sus bindings y los archivos existen de verdad (la ausencia que se afirma
    // después es falsificable).
    let before = read_rows(&db_path);
    assert_eq!(before.len(), 2, "los dos documentos están sembrados");
    for (id, local_present, canonical_path, content_hash) in &before {
        assert!(*local_present, "{id} es local_present antes del borrado");
        assert!(
            canonical_path.as_deref().is_some_and(|path| Path::new(path).is_file()),
            "{id} apunta a un .md real antes del borrado"
        );
        assert!(content_hash.is_some(), "{id} tiene hash antes del borrado");
    }
    assert!(fs::read(&one_path).is_ok() && fs::read(&two_path).is_ok());

    let deleted_at = "2026-10-01T13:00:00.000Z";
    catalog::catalog_delete_collection(
        db_path.clone(),
        COLLECTION_ONE.into(),
        deleted_at.into(),
        4,
        catalog::CatalogMetadataMutationInput {
            id: DELETE_MUTATION.into(),
            entity_kind: "collection".into(),
            entity_id: COLLECTION_ONE.into(),
            operation: "delete".into(),
            payload_json: "{\"name\":\"Collection One\"}".into(),
            status: "pending".into(),
            attempt_count: 0,
            next_retry_at: None,
            created_at: 4,
            last_error: None,
        },
    )
    .expect("delete collection one");

    // Resultado canónico 1: los documentos y sus bindings sobreviven intactos.
    let after = read_rows(&db_path);
    assert_eq!(
        after.len(),
        2,
        "borrar la colección no borra filas de documents"
    );
    for (id, local_present, canonical_path, content_hash) in &after {
        assert!(*local_present, "{id} sigue local_present tras el borrado");
        let before_row = before
            .iter()
            .find(|(before_id, ..)| before_id == id)
            .expect("documento presente antes del borrado");
        assert_eq!(
            canonical_path, &before_row.2,
            "{id} conserva su binding tras el borrado"
        );
        assert_eq!(
            content_hash, &before_row.3,
            "{id} conserva su content_hash tras el borrado"
        );
    }

    // Resultado canónico 2: los bytes de cada `.md` no se tocan.
    assert_eq!(
        fs::read(&one_path).expect("read one.md after delete"),
        one_bytes,
        "one.md conserva sus bytes"
    );
    assert_eq!(
        fs::read(&two_path).expect("read two.md after delete"),
        two_bytes,
        "two.md conserva sus bytes"
    );

    // El comando hizo su trabajo: la colección queda soft-deleted y su mutación
    // de metadata encolada, sin tocar `writing_collections` (F6, ODE-618 PR1b).
    let snapshot = catalog::catalog_list_collection_snapshot(db_path.clone())
        .expect("list collection snapshot");
    assert!(
        snapshot
            .collections
            .iter()
            .any(|row| row.id == COLLECTION_TWO),
        "la colección viva sigue listada"
    );
    assert!(
        !snapshot
            .collections
            .iter()
            .any(|row| row.id == COLLECTION_ONE),
        "la colección borrada sale del snapshot de colecciones"
    );

    let connection = Connection::open(&db_path).expect("open catalog for durable checks");
    let deleted: Option<String> = connection
        .query_row(
            "SELECT deleted_at FROM collections WHERE id=?1",
            [COLLECTION_ONE],
            |row| row.get(0),
        )
        .expect("read deleted collection");
    assert_eq!(
        deleted.as_deref(),
        Some(deleted_at),
        "la colección borrada conserva su deleted_at"
    );
    let queued: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM metadata_sync_mutations
             WHERE id=?1 AND entity_kind='collection' AND entity_id=?2
               AND operation='delete' AND status='pending'",
            [DELETE_MUTATION, COLLECTION_ONE],
            |row| row.get(0),
        )
        .expect("read queued metadata mutation");
    assert_eq!(queued, 1, "la mutación de delete quedó encolada");

    let _ = fs::remove_dir_all(&base);
}
