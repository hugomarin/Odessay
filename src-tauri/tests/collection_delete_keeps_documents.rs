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
//! ODE-618 PR1b cierra F6 en las dos direcciones: `catalog_delete_collection`
//! borra, en la misma transacción del soft-delete, las filas de
//! `writing_collections` de esa colección (paridad con web), y
//! `catalog_list_collection_snapshot` solo devuelve relaciones de colecciones
//! vivas, así que también repara los huérfanos que dejó el build anterior. Las
//! pruebas de abajo afirman las dos cosas sobre SQLite real; en PR1 el caso TS
//! caracterizó F6 como `it.fails`.
//!
//! ODE-666 extiende el mismo owner con la otra mitad del lifecycle: la
//! hidratación (`hydrateCollections` manda snapshots con `deletedAt:null` porque
//! la nube no tiene `deleted_at` y su delete es físico) no puede revivir una
//! colección cuyo tombstone local sigue vigente —pendiente o confirmado— ni
//! reinsertar sus relaciones. El merge transaccional de
//! `catalog_apply_collection_snapshot` las preserva y omite; los writings y sus
//! `.md` no se tocan y las filas ausentes del snapshot no se podan.
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
const COLLECTION_KEEP: &str = "collection-ode-666-keep";
const COLLECTION_CLOUD: &str = "collection-ode-666-cloud";
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

/// Lee solo las filas de unión (`writing_collections`) con una conexión nueva.
fn read_relations(db_path: &str) -> Vec<(String, String)> {
    let connection = Connection::open(db_path).expect("open catalog for relation reads");
    let mut statement = connection
        .prepare(
            "SELECT writing_id, collection_id FROM writing_collections
             ORDER BY writing_id, collection_id",
        )
        .expect("prepare relation read");
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("query relations")
        .collect::<Result<_, _>>()
        .expect("collect relations")
}

fn delete_mutation() -> catalog::CatalogMetadataMutationInput {
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
    }
}

/// F6 (D4, ODE-618 PR1b): el DELETE de las relaciones va en la MISMA
/// transacción del soft-delete de la colección. Solo desaparecen las relaciones
/// de la colección borrada; la relación con la colección viva y los `.md`
/// quedan intactos.
#[test]
fn deleting_a_collection_removes_its_relation_rows_in_the_same_transaction() {
    let base = temp_base();
    let root = base.join("root");
    fs::create_dir_all(&root).expect("create temp root");
    let db = base.join("desktop-index.sqlite3");
    let db_path = db.to_string_lossy().into_owned();

    let one_body = "# One\n\nFirst document body.\n";
    let two_body = "# Two\n\nSecond document body.\n";
    let one_path = write_markdown(&root, "one.md", one_body);
    let two_path = write_markdown(&root, "two.md", two_body);

    for (id, path, body) in [
        (DOC_ONE, &one_path, one_body),
        (DOC_TWO, &two_path, two_body),
    ] {
        let hash = workspace::workspace_compute_content_hash(body.to_string())
            .expect("compute content hash");
        catalog::catalog_dual_write(
            db_path.clone(),
            catalog::CatalogDualWriteInput {
                document: document(id),
                binding: Some(binding(
                    &root.to_string_lossy(),
                    Path::new(path)
                        .file_name()
                        .expect("markdown file name")
                        .to_string_lossy()
                        .as_ref(),
                    path,
                    &hash,
                    body.len() as u64,
                )),
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

    // Control positivo de alcanzabilidad: las dos relaciones con la colección
    // que se borra existen de verdad antes del DELETE.
    let before = read_relations(&db_path);
    assert_eq!(
        before
            .iter()
            .filter(|(_, collection_id)| collection_id == COLLECTION_ONE)
            .count(),
        2,
        "control positivo: dos relaciones con la colección que se borra"
    );

    catalog::catalog_delete_collection(
        db_path.clone(),
        COLLECTION_ONE.into(),
        "2026-10-01T13:00:00.000Z".into(),
        4,
        delete_mutation(),
    )
    .expect("delete collection one");

    // Resultado canónico: no queda ninguna relación de la colección borrada y
    // solo sobrevive la de la colección viva.
    let after = read_relations(&db_path);
    assert!(
        !after
            .iter()
            .any(|(_, collection_id)| collection_id == COLLECTION_ONE),
        "F6: el borrado elimina las relaciones de la colección borrada"
    );
    assert_eq!(
        after,
        vec![(DOC_ONE.to_string(), COLLECTION_TWO.to_string())],
        "solo sobrevive la relación con la colección viva"
    );

    // La otra mitad del invariante: los documentos y los bytes de su `.md` no
    // se tocan.
    assert_eq!(read_rows(&db_path).len(), 2, "los documentos sobreviven");
    assert_eq!(
        fs::read(&one_path).expect("read one.md after delete"),
        one_body.as_bytes(),
        "one.md conserva sus bytes"
    );
    assert_eq!(
        fs::read(&two_path).expect("read two.md after delete"),
        two_body.as_bytes(),
        "two.md conserva sus bytes"
    );

    let _ = fs::remove_dir_all(&base);
}

/// D-5 (ODE-618 PR1b): los huérfanos que ya existen en instalaciones previas
/// (una relación viva de una colección soft-deleted, el residuo que dejaba el
/// build anterior) no vuelven al snapshot: solo se listan relaciones de
/// colecciones vivas.
#[test]
fn collection_snapshot_omits_relations_of_soft_deleted_collections() {
    let base = temp_base();
    let db = base.join("desktop-index.sqlite3");
    fs::create_dir_all(&base).expect("create temp base");
    let db_path = db.to_string_lossy().into_owned();

    // Estado heredado construido con los comandos reales: el upsert acepta
    // `deleted_at` y el replace de relaciones no filtra por vida, así que
    // reprodujo esta forma el build anterior (soft-delete sin limpiar la unión).
    catalog::catalog_dual_write(
        db_path.clone(),
        catalog::CatalogDualWriteInput {
            document: document(DOC_ONE),
            binding: None,
            mutation: None,
        },
    )
    .expect("dual write one");
    let mut deleted_collection = collection(COLLECTION_ONE, "Collection One");
    deleted_collection.deleted_at = Some("2026-10-01T13:00:00.000Z".into());
    catalog::catalog_save_collection(db_path.clone(), deleted_collection, None)
        .expect("save soft-deleted collection");
    catalog::catalog_save_collection(
        db_path.clone(),
        collection(COLLECTION_TWO, "Collection Two"),
        None,
    )
    .expect("save live collection");
    catalog::catalog_replace_writing_collections(
        db_path.clone(),
        DOC_ONE.into(),
        vec![COLLECTION_ONE.into(), COLLECTION_TWO.into()],
        "2026-10-01T12:00:00.000Z".into(),
        2,
        None,
    )
    .expect("assign one to the dead and the live collection");

    // Control positivo: la fila huérfana existe en SQLite; la ausencia que se
    // afirma después no viene de que nunca se escribió.
    assert!(
        read_relations(&db_path).contains(&(DOC_ONE.to_string(), COLLECTION_ONE.to_string())),
        "control positivo: la relación huérfana existe en el catálogo"
    );

    let snapshot = catalog::catalog_list_collection_snapshot(db_path.clone())
        .expect("list collection snapshot");
    let relations: Vec<(String, String)> = snapshot
        .writing_collections
        .iter()
        .map(|row| (row.writing_id.clone(), row.collection_id.clone()))
        .collect();
    assert_eq!(
        relations,
        vec![(DOC_ONE.to_string(), COLLECTION_TWO.to_string())],
        "D-5: solo las relaciones de colecciones vivas entran al snapshot"
    );

    let _ = fs::remove_dir_all(&base);
}

fn cloud_collection(
    id: &str,
    name: &str,
    local_updated_at: i64,
) -> catalog::CatalogCollectionInput {
    catalog::CatalogCollectionInput {
        id: id.into(),
        owner_id: Some("user-ode-618".into()),
        name: name.into(),
        description: None,
        visibility: "private".into(),
        sync_status: "synced".into(),
        lifecycle: "server-confirmed".into(),
        deleted_at: None,
        created_at: "2026-10-01T12:00:00.000Z".into(),
        updated_at: "2026-10-01T12:30:00.000Z".into(),
        local_updated_at,
    }
}

fn snapshot_relation(
    writing_id: &str,
    collection_id: &str,
    local_updated_at: i64,
) -> catalog::CatalogWritingCollectionInput {
    catalog::CatalogWritingCollectionInput {
        writing_id: writing_id.into(),
        collection_id: collection_id.into(),
        added_at: "2026-10-01T12:00:00.000Z".into(),
        local_updated_at,
    }
}

/// Lee `deleted_at`, `sync_status` y `name` de una colección con una conexión
/// nueva: lo durable, no la respuesta del comando.
fn read_collection_row(db_path: &str, collection_id: &str) -> (Option<String>, String, String) {
    let connection = Connection::open(db_path).expect("open catalog for collection read");
    connection
        .query_row(
            "SELECT deleted_at, sync_status, name FROM collections WHERE id=?1",
            [collection_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("read collection row")
}

/// ODE-666: la hidratación desktop manda snapshots con `deletedAt:null` (la
/// nube no tiene `deleted_at`: su delete es físico), así que el merge
/// transaccional del catálogo preserva el tombstone local —pendiente o ya
/// confirmado— y omite las relaciones de esa colección. Los writings y sus
/// `.md` no se tocan y las filas ausentes del snapshot no se podan.
#[test]
fn stale_live_snapshot_keeps_local_collection_tombstones_and_omits_relations() {
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

    // Secuencia real de producción: dos documentos materializados con sus
    // bindings, tres colecciones locales y sus asignaciones.
    for (id, path, body) in [
        (DOC_ONE, &one_path, one_body),
        (DOC_TWO, &two_path, two_body),
    ] {
        let hash = workspace::workspace_compute_content_hash(body.to_string())
            .expect("compute content hash");
        catalog::catalog_dual_write(
            db_path.clone(),
            catalog::CatalogDualWriteInput {
                document: document(id),
                binding: Some(binding(
                    &root.to_string_lossy(),
                    Path::new(path)
                        .file_name()
                        .expect("markdown file name")
                        .to_string_lossy()
                        .as_ref(),
                    path,
                    &hash,
                    body.len() as u64,
                )),
                mutation: None,
            },
        )
        .unwrap_or_else(|error| panic!("catalog_dual_write({id}): {error}"));
    }
    for (id, name) in [
        (COLLECTION_ONE, "Collection One"),
        (COLLECTION_TWO, "Collection Two"),
        (COLLECTION_KEEP, "Collection Three"),
    ] {
        catalog::catalog_save_collection(db_path.clone(), collection(id, name), None)
            .unwrap_or_else(|error| panic!("catalog_save_collection({id}): {error}"));
    }
    catalog::catalog_replace_writing_collections(
        db_path.clone(),
        DOC_ONE.into(),
        vec![COLLECTION_ONE.into(), COLLECTION_TWO.into()],
        "2026-10-01T12:00:00.000Z".into(),
        2,
        None,
    )
    .expect("assign one to both live collections");
    catalog::catalog_replace_writing_collections(
        db_path.clone(),
        DOC_TWO.into(),
        vec![COLLECTION_ONE.into(), COLLECTION_KEEP.into()],
        "2026-10-01T12:00:00.000Z".into(),
        3,
        None,
    )
    .expect("assign two to the deleted and the untouched collection");

    // Control positivo de alcanzabilidad: las relaciones con la colección que se
    // borra existen de verdad antes del delete.
    let before_relations = read_relations(&db_path);
    assert_eq!(
        before_relations
            .iter()
            .filter(|(_, collection_id)| collection_id == COLLECTION_ONE)
            .count(),
        2,
        "control positivo: dos relaciones con la colección que se borra"
    );

    let deleted_at = "2026-10-01T13:00:00.000Z";
    catalog::catalog_delete_collection(
        db_path.clone(),
        COLLECTION_ONE.into(),
        deleted_at.into(),
        4,
        delete_mutation(),
    )
    .expect("delete collection one");

    // Snapshot cloud atrasado, la forma real de `hydrateCollections`: la
    // colección borrada vuelve a venir viva (`deletedAt:null`) con sus viejas
    // relaciones; `TWO` trae nombre nuevo y una relación nueva (control positivo
    // de que el merge sí aplica), `KEEP` está ausente (no se poda) y `CLOUD` es
    // una colección nueva que solo existe en la nube.
    let stale_snapshot = || catalog::CatalogCollectionSnapshot {
        collections: vec![
            cloud_collection(COLLECTION_ONE, "Collection One", 3),
            cloud_collection(COLLECTION_TWO, "Collection Two (cloud)", 3),
            cloud_collection(COLLECTION_CLOUD, "Collection Cloud", 5),
        ],
        writing_collections: vec![
            snapshot_relation(DOC_ONE, COLLECTION_ONE, 3),
            snapshot_relation(DOC_TWO, COLLECTION_ONE, 3),
            snapshot_relation(DOC_ONE, COLLECTION_TWO, 3),
            snapshot_relation(DOC_TWO, COLLECTION_TWO, 3),
            snapshot_relation(DOC_ONE, COLLECTION_CLOUD, 5),
        ],
    };

    // Fase 1 — tombstone pendiente: el delete local aún no llegó a la nube.
    catalog::catalog_apply_collection_snapshot(db_path.clone(), stale_snapshot())
        .expect("apply stale snapshot with pending tombstone");

    let (deleted, sync_status, _) = read_collection_row(&db_path, COLLECTION_ONE);
    assert_eq!(
        deleted.as_deref(),
        Some(deleted_at),
        "el snapshot vivo atrasado no revivió la colección (pending)"
    );
    assert_eq!(
        sync_status, "deleted",
        "el tombstone pendiente conserva su sync_status"
    );
    assert_eq!(
        read_collection_row(&db_path, COLLECTION_TWO).2,
        "Collection Two (cloud)",
        "control positivo: el merge del snapshot sí aplica a la colección viva"
    );
    assert_eq!(
        read_collection_row(&db_path, COLLECTION_CLOUD).1,
        "synced",
        "control positivo: la colección que solo existe en la nube entra"
    );
    assert_eq!(
        read_collection_row(&db_path, COLLECTION_KEEP).2,
        "Collection Three",
        "no se podan filas ausentes del snapshot"
    );

    let relations = read_relations(&db_path);
    assert!(
        !relations
            .iter()
            .any(|(_, collection_id)| collection_id == COLLECTION_ONE),
        "el snapshot no reinserta relaciones de la colección tombstoned"
    );
    assert_eq!(
        relations,
        vec![
            (DOC_ONE.to_string(), COLLECTION_TWO.to_string()),
            (DOC_ONE.to_string(), COLLECTION_CLOUD.to_string()),
            (DOC_TWO.to_string(), COLLECTION_TWO.to_string()),
            (DOC_TWO.to_string(), COLLECTION_KEEP.to_string()),
        ],
        "solo las relaciones vivas entran; las ajenas al snapshot no se podan"
    );

    assert!(
        !catalog::catalog_list_collection_snapshot(db_path.clone())
            .expect("list collection snapshot")
            .collections
            .iter()
            .any(|row| row.id == COLLECTION_ONE),
        "la colección tombstoned no reaparece en el snapshot de colecciones"
    );

    // Los writings y sus `.md` no se tocan.
    let after = read_rows(&db_path);
    assert_eq!(after.len(), 2, "los documentos sobreviven");
    for (id, local_present, canonical_path, content_hash) in &after {
        assert!(*local_present, "{id} sigue local_present");
        assert!(canonical_path.is_some(), "{id} conserva su binding");
        assert!(content_hash.is_some(), "{id} conserva su content_hash");
    }
    assert_eq!(
        fs::read(&one_path).expect("read one.md after snapshot"),
        one_bytes,
        "one.md conserva sus bytes"
    );
    assert_eq!(
        fs::read(&two_path).expect("read two.md after snapshot"),
        two_bytes,
        "two.md conserva sus bytes"
    );

    // Fase 2 — tombstone confirmado: el flush de metadata confirma el delete en
    // la nube (delete físico) y otro snapshot atrasado vuelve a llegar.
    catalog::catalog_update_metadata_mutation_status(
        db_path.clone(),
        DELETE_MUTATION.into(),
        "synced".into(),
        1,
        None,
        None,
    )
    .expect("confirm delete mutation");
    catalog::catalog_apply_collection_snapshot(db_path.clone(), stale_snapshot())
        .expect("apply stale snapshot with confirmed tombstone");

    let (deleted, sync_status, _) = read_collection_row(&db_path, COLLECTION_ONE);
    assert_eq!(
        deleted.as_deref(),
        Some(deleted_at),
        "el snapshot vivo atrasado no revivió la colección (confirmed)"
    );
    assert_eq!(
        sync_status, "deleted",
        "el tombstone confirmado conserva su sync_status"
    );
    assert!(
        !read_relations(&db_path)
            .iter()
            .any(|(_, collection_id)| collection_id == COLLECTION_ONE),
        "el snapshot confirmado tampoco reinserta relaciones de la colección"
    );
    assert!(
        !catalog::catalog_list_collection_snapshot(db_path.clone())
            .expect("list collection snapshot after confirmation")
            .collections
            .iter()
            .any(|row| row.id == COLLECTION_ONE),
        "la colección confirmada sigue fuera de las superficies de Collections"
    );

    let _ = fs::remove_dir_all(&base);
}
