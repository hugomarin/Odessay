//! ODE-617 PR-B — SHARE-05, hipótesis de hidratación en desktop.
//!
//! `catalog_apply_cloud_snapshots` (index.rs) proyecta la metadata de la nube
//! sobre el catálogo local. El caso peligroso es una fila con trabajo local sin
//! subir (`pending`/`failed`/`conflict`): el snapshot trae el valor remoto
//! viejo y, si pisa las cachés de metadata, el próximo guardado encola la
//! visibilidad vieja — exactamente el failure mode de SHARE-05
//! ("la visibilidad cambia en local pero no en la DB, o al revés").
//!
//! Este test corre los comandos reales (`catalog_dual_write` y
//! `catalog_apply_cloud_snapshots`) contra un SQLite temporal real, sin
//! AppHandle. Fija la guarda D-4: mientras la fila tenga trabajo pendiente, el
//! snapshot no mueve **ninguna** caché de metadata (`title_cache`,
//! `slug_cache`, `status_cache`, `artifact_type_cache`, `visibility_cache`,
//! `version_cache`), no solo la visibilidad. El control positivo prueba que una
//! fila sin trabajo pendiente sí recibe la metadata de la nube — la hidratación
//! normal (requisito 3) sigue funcionando.
//!
//! El doble TS `tauriCatalogApplyCloudSnapshotsDouble` espeja este mismo SQL;
//! hasta ODE-617 PR-B usaba `??` y no copiaba visibility/artifactType/version,
//! así que ocultaba la hipótesis (Auditoría ronda 2).

use odessay_lib::commands::index as catalog;
use std::fs;
use std::path::PathBuf;

fn temp_db() -> PathBuf {
    std::env::temp_dir().join(format!(
        "odessay-cloud-snapshot-{}.sqlite3",
        uuid::Uuid::new_v4()
    ))
}

fn document(
    id: &str,
    sync_status: &str,
    title: &str,
    slug: &str,
    status: &str,
    artifact_type: &str,
    visibility: &str,
    version: i64,
) -> catalog::CatalogDocumentInput {
    catalog::CatalogDocumentInput {
        id: id.into(),
        local_present: true,
        cloud_present: false,
        cloud_account_id: None,
        sync_status: sync_status.into(),
        title: Some(title.into()),
        slug: Some(slug.into()),
        status: Some(status.into()),
        artifact_type: Some(artifact_type.into()),
        visibility: Some(visibility.into()),
        version: Some(version),
        deleted_at: None,
        created_at: Some(1),
        modified_at: Some(2),
    }
}

fn cloud_snapshot(id: &str) -> catalog::CatalogCloudSnapshotInput {
    catalog::CatalogCloudSnapshotInput {
        id: id.into(),
        cloud_present: true,
        cloud_account_id: Some("acct-1".into()),
        content_hash: Some("hash-cloud".into()),
        title: Some("Titulo nube".into()),
        slug: Some("slug-nube".into()),
        status: Some("draft".into()),
        artifact_type: Some("general".into()),
        visibility: Some("private".into()),
        version: Some(2),
        deleted_at: None,
        created_at: Some(1),
        modified_at: Some(50),
    }
}

fn assert_metadata_kept(row: &catalog::CatalogRow, id: &str) {
    assert_eq!(row.title.as_deref(), Some("Titulo local"), "{id}: title_cache");
    assert_eq!(row.slug.as_deref(), Some("slug-local"), "{id}: slug_cache");
    assert_eq!(row.status.as_deref(), Some("review"), "{id}: status_cache");
    assert_eq!(
        row.artifact_type.as_deref(),
        Some("letter"),
        "{id}: artifact_type_cache"
    );
    assert_eq!(
        row.visibility.as_deref(),
        Some("shared"),
        "{id}: visibility_cache"
    );
    assert_eq!(row.version, Some(7), "{id}: version_cache");
}

#[test]
fn cloud_snapshot_keeps_pending_metadata() {
    let db = temp_db();
    let db_path = db.to_string_lossy().to_string();

    for (index, state) in ["pending", "failed", "conflict"].iter().enumerate() {
        let id = format!("doc-{state}");
        catalog::catalog_dual_write(
            db_path.clone(),
            catalog::CatalogDualWriteInput {
                document: document(
                    &id,
                    state,
                    "Titulo local",
                    "slug-local",
                    "review",
                    "letter",
                    "shared",
                    7,
                ),
                binding: None,
                mutation: if *state == "pending" {
                    Some(catalog::CatalogMutationInput {
                        id: format!("mut-{index}"),
                        operation: "upsert".into(),
                        payload_json: "{}".into(),
                        status: "pending".into(),
                        attempt_count: 0,
                        next_retry_at: None,
                        created_at: 2,
                        last_error: None,
                    })
                } else {
                    None
                },
            },
        )
        .unwrap();
    }

    catalog::catalog_apply_cloud_snapshots(
        db_path.clone(),
        ["pending", "failed", "conflict"]
            .iter()
            .map(|state| cloud_snapshot(&format!("doc-{state}")))
            .collect(),
    )
    .unwrap();

    for state in ["pending", "failed", "conflict"] {
        let id = format!("doc-{state}");
        let row = catalog::catalog_get_by_id(db_path.clone(), id.clone())
            .unwrap()
            .unwrap();
        assert_eq!(
            row.sync_status, state,
            "{id}: el snapshot no resuelve el trabajo local pendiente"
        );
        assert!(
            row.cloud_present,
            "{id}: la presencia en la nube sí se proyecta"
        );
        assert_metadata_kept(&row, &id);
    }

    let _ = fs::remove_file(db);
}

#[test]
fn cloud_snapshot_applies_metadata_when_no_local_work_is_pending() {
    let db = temp_db();
    let db_path = db.to_string_lossy().to_string();

    catalog::catalog_dual_write(
        db_path.clone(),
        catalog::CatalogDualWriteInput {
            document: document(
                "doc-synced",
                "synced",
                "Titulo local",
                "slug-local",
                "review",
                "letter",
                "shared",
                7,
            ),
            binding: None,
            mutation: None,
        },
    )
    .unwrap();

    catalog::catalog_apply_cloud_snapshots(db_path.clone(), vec![cloud_snapshot("doc-synced")])
        .unwrap();

    let row = catalog::catalog_get_by_id(db_path.clone(), "doc-synced".into())
        .unwrap()
        .unwrap();
    assert_eq!(row.sync_status, "synced");
    assert_eq!(row.title.as_deref(), Some("Titulo nube"), "title_cache");
    assert_eq!(row.slug.as_deref(), Some("slug-nube"), "slug_cache");
    assert_eq!(row.status.as_deref(), Some("draft"), "status_cache");
    assert_eq!(
        row.artifact_type.as_deref(),
        Some("general"),
        "artifact_type_cache"
    );
    assert_eq!(
        row.visibility.as_deref(),
        Some("private"),
        "visibility_cache"
    );
    assert_eq!(row.version, Some(2), "version_cache");

    let _ = fs::remove_file(db);
}
