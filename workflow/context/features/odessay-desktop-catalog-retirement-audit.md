# ODESSAY — Desktop Catalog Legacy-Path Retirement Audit

- **Estado:** Auditoría de arquitectura (read-only) — no autoriza borrado por sí sola.
- **Fecha:** 2026-07-10
- **Issue:** [ODE-369](https://linear.app/z9ne/issue/ODE-369)
- **Alcance:** desktop + web + cloud + shared-core. Reachability real por callers, no por naming.
- **Precedencia:** `workflow/context/core/odessay-adr-identidad.md` (identidad) → `workflow/context/features/odessay-desktop-document-catalog.md` (contrato operacional objetivo) → target-architecture / migration-plan → código vigente como evidencia.
- **Subordinado a:** ODE-366 (reconciliación documental). Esta auditoría no reescribe docs ni toca código de producto.

## Propósito

El spec del catálogo define el objetivo. El codebase todavía contiene identidad, catálogo, watcher, sync y migración solapados. Esta auditoría determina, **con evidencia de caller y file/line**, qué está vivo y en qué orden puede retirarse sin perder cola de sync ni UUIDs local-only.

Regla de oro aplicada: **no se infiere código muerto por el nombre**. Cada candidato tiene caller (o ausencia demostrada de caller), riesgo de datos, rollback, prerequisito y owner (issue M1–M6).

## Mapa de milestones → issues (owners de retiro)

| Milestone | Issue | Estado | Rol en el retiro |
|---|---|---|---|
| M1 — Contratos + SQLite v2 dual-write | ODE-367 | Done | Fundación aditiva ya construida (flag off) |
| M2 — Reconciliador global + manifest v2 | ODE-370 | Todo | Dueño del watcher global y del retiro de mint/frontmatter en Rust |
| M3 — Apertura única `openDocument({id|path})` | ODE-375 | Todo | Dueño del retiro de las 3 aperturas paralelas |
| M4 — Desk/Workspace como vistas del catálogo | ODE-373 | Todo | Dueño del consumo de `getDocumentCatalog()` y retiro de lectura IndexedDB en Desk |
| M5 — Migración IndexedDB catálogo+cola → SQLite | ODE-376 | Todo | Dueño de la cosecha multi-scope y retiro de lectura/escritura IndexedDB desktop |
| M6 — Cloud reconcile + cleanup | ODE-371 (cloud) + ODE-374 (identidades/compat) | Todo | Dueño del borrado final de `writings_index`, mint/frontmatter y compat IndexedDB |
| Gate final DoD en DMG | ODE-372 | Todo | Evidencia de aceptación |

**Conclusión de routing:** todos los gaps identificados tienen un owner existente. **No se abre issue nuevo** (Requisito 4 de ODE-369).

## Estado de la fundación ODE-367 (crítico para no clasificar mal)

`src-tauri/src/commands/index.rs` contiene **dos** capas coexistiendo:

1. **Legacy** — tabla `writings_index` (path/title/timestamps) + comandos `index_upsert/index_list/index_delete/index_rebuild` (`index.rs:17-51,525-646`).
2. **Catálogo v2** — tablas `catalog_schema/binding_roots/documents/document_bindings/sync_mutations` + comandos `catalog_*` (`index.rs:53-376`). El comentario `index.rs:378-381` documenta el rollback físico y declara que `writings_index` queda intacto hasta M6.

El adapter TS (`SqliteDocumentCatalog`, `web-document-catalog`, factory) y el **dual-write** están cableados pero **dormidos**:

- Flag `NEXT_PUBLIC_DESKTOP_CATALOG_DUAL_WRITE` → **default `false`** (`.env.example:9`, `lib/services/desktop/catalog-feature-flag.ts:2`). El write path (`scheduleDesktopCatalogDualWrite` en `lib/sync/queue.ts:62`, mutation-status en `lib/sync/desktop-sync-service.ts:503,531,537`, detach en `lib/services/document-service-factory.ts:546`) sale del hot path pero no ejecuta en prod.
- **Lado lectura sin consumidores:** `getDocumentCatalog()` (`lib/services/document-catalog-factory.ts:8`) **no tiene ningún caller** fuera de su definición. `SqliteDocumentCatalog.list/getById/resolvePath` sólo se ejercitan en tests de contrato.

⚠️ **Trampa de clasificación:** la fundación de catálogo NO es código muerto retirable. Es infraestructura M1 esperando M3/M4/M5. Clasificarla como "delete" sería el failure mode "un lector de compatibilidad vivo clasificado como muerto".

## Los tres catálogos/aperturas operativos vivos

| Superficie | Fuente de identidad/estado hoy | Caller vivo (evidencia) |
|---|---|---|
| Desk / Write / sync | IndexedDB `localDB` scoped (`odessay-${scope}`) | `document-service-factory.ts:224,239` (`localDB.writings.getAll/get`); `app/(app)/desk/page.tsx:734` |
| Workspace | `.odessay/index.json` vía `workspace_sync` + seed/replace de `LocalWriting` | `workspace-service.ts:178,207,257,311,552,588,624,664` (`tauriWorkspaceSync`), `:341` (`openFileInEditor`) |
| Open Document | ruta absoluta → acuña identidad al abrir | `hooks/useTauriMenuEvents.ts:80`, `hooks/useGlobalOpenFileMenu.ts:24` (ambos `subscribeMenuAction("open-file")`) |

`SQLite writings_index` es una cuarta proyección paralela (recientes) y no gobierna ninguna superficie.

## Fuentes/transiciones de identidad inseguras (Requisito 3)

| # | Fuente/transición insegura | Evidencia file:line | Invariante vulnerado | Owner de retiro |
|---|---|---|---|---|
| U1 | **Mint UUID en Rust** (`Uuid::new_v4()`) para archivos sin binding ni frontmatter | `workspace.rs:302-308` | "ningún archivo obtiene UUID antes de agotar reconciliación"; un solo acuñador cliente | ODE-370 (mueve mint a reconciliador) + ODE-374 (retiro) |
| U2 | **Frontmatter como identidad** (`extract_writing_id_from_frontmatter`) | `workspace.rs:301,359-384` | "metadata nunca dentro del `.md`/frontmatter"; ADR D4/D5 | ODE-374 |
| U3 | **path-as-id** en apertura: `canonicalPath = ... ?? writingId` usa el UUID como ruta | `document-service-factory.ts:258`; import mint `:561`,`:64-70` | "la ruta no es identidad"; boundary UI→filesystem | ODE-375 |
| U4 | **Rebind destructivo por ruta**: si `existingByPath.id !== workspaceFileId` borra cola + record y re-siembra | `workspace-service.ts:349-350,372-385` | "no borrar cola ni sobrescribir estado; registrar conflicto" | ODE-375 (opener único) / ODE-373 |
| U5 | **Seed manual de IndexedDB desde Workspace** | `workspace-service.ts:352-371` | "Workspace no hace seed manual de IndexedDB" | ODE-373 / ODE-375 |
| U6 | **`writings_index` path-only** (sin UUID/binding/presencia) | `index.rs:17-36` | SQLite debe ser catálogo UUID/binding/presencia | ODE-374 (borrado tras M4/M5) |
| U7 | **IndexedDB scoped** (`odessay-${scope}`, conmuta anonymous↔userId) | `local-db/index.ts:75` (`DEFAULT_SCOPE`), `getDatabaseName` `:96`; `components/sync/sync-bootstrap.tsx:40,72,86,112` | cola durable no se descarta; auth no gobierna existencia local | ODE-376 |
| U8 | **Draft fallback al abrir** — mitigado pero presente en dos capas | ver F-DRAFT abajo | "ninguna falla de apertura crea draft" | ODE-375 |
| U9 | **Cloud-only materialización / detach por scope vs ausencia** | `remote-bootstrap.ts` rebind por hash `:206-224`; `markDesktopWritingDeletedByCanonicalPath` `document-service-factory.ts:537-547` | distinguir out-of-scope / no-observable / ausente-confirmado | ODE-371 / ODE-370 |

### Nota sobre draft fallback (F-DRAFT)

El opener desktop **ya defiende** parcialmente contra el draft-fallback: `document-service-factory.ts:254-256` rechaza tratar un UUID sin binding como ruta (`NOT_FOUND` en vez de draft), y `:270-273` cae al cache IndexedDB en vez de `NOT_FOUND` cuando el `.md` no está (ODE-365). Esto es **compatibilidad viva correcta**, no un bug retirable: no debe eliminarse hasta que M3/M5 garanticen que el catálogo resuelve identidad+contenido sin depender del cache IndexedDB. Retirar el fallback a cache antes de M5 reintroduce ODE-365 ("Untitled" vacío al abrir).

## Inventario de retiro por módulo (Requisitos 1, 2, 5)

Leyenda clasificación: **retain** · **adapt** · **migrate** · **isolate-to-tooling** · **delete**. Confianza: file/line verificada.

### R1 — `writings_index` + `LocalIndexService` (recientes legacy)
- **Callers:** escritura viva (`filesystem-document-service.ts:199-211` `localIndex.upsert/delete` en cada save/delete desktop, vía `document-service-factory.ts:138`). **Lectura muerta en la app viva:** `LocalIndexService.listRecent` sólo se consume en `filesystem-document-service.ts:287` dentro de `FilesystemDocumentService.listWritings`, que **no tiene caller vivo** (`.listWritings(` no aparece fuera de tests/contracts/definiciones; el Desk lee `localDB` directamente vía `DesktopDocumentService.listWritings`, `document-service-factory.ts:221-234`).
- **Clasificación:** **delete** (tabla + comandos + servicio), tras M4/M5. Es sink write-only cuya lectura ya está sombreada por IndexedDB. Confianza: alta.
- **Riesgo de datos:** ninguno — es proyección reconstruible desde `.md`; no guarda UUID ni cola.
- **Rollback:** recrear tabla vía `ensure_table` (aditivo).
- **Prerequisito:** M4 (Desk consume `DocumentCatalog`) para que ninguna ruta necesite el índice legacy.
- **Test gate:** `tests/local-index-service.test.ts`, `tests/filesystem-document-service.test.ts`, `tests/fase6-invariants.test.ts` deben migrar/eliminarse junto al servicio.
- **Owner:** ODE-374.

### R2 — `workspace_sync` mint + frontmatter (`workspace.rs`)
- **Callers:** vivo, único acuñador de Workspace (`workspace-service.ts` ×8).
- **Clasificación:** **adapt→migrate** (mover reconciliación al `WorkspaceReconciler` global, retirar `Uuid::new_v4()` y `extract_writing_id_from_frontmatter`), luego **delete** de esos dos caminos.
- **Riesgo de datos:** **alto**. `workspace_sync` escribe SÓLO `.odessay/index.json`, **no** SQLite. El UUID de un archivo local-only vive únicamente en ese manifest (y en frontmatter histórico). Retirar mint/frontmatter antes de cosechar el manifest a SQLite pierde identidad local-only.
- **Rollback:** manifest `.odessay/index.json` es ledger durable; conservar backup antes de migrar a v2.
- **Prerequisito:** ODE-370 (reconciliador + manifest v2 que proyecta a SQLite) y ODE-374 (harvest de identidades históricas).
- **Test gate:** `src-tauri` tests `workspace_sync_*` (mint, frontmatter-precedence, rename-by-hash, atomic-save) — deben re-expresarse contra el reconciliador.
- **Owner:** ODE-370 (adapt) → ODE-374 (delete de mint/frontmatter).

### R3 — Apertura Workspace `openFileInEditor` (rebind destructivo)
- **Callers:** vivo (`workspace-service.ts:341`, invocado desde Workspace shell).
- **Clasificación:** **migrate** a `openDocument({path})`; el borrado de cola/record (`:349-350,372-385`) se **elimina**, reemplazado por resolución de conflicto no destructiva.
- **Riesgo de datos:** **alto** — pérdida de mutaciones pendientes y de identidad previa (P0 del workspace-diagnostic). No retirar el opener actual hasta que el opener único preserve cola.
- **Rollback:** N/A (cambio de comportamiento cubierto por opener único con tests).
- **Prerequisito:** ODE-375 (opener único) + catálogo consultable (M4).
- **Test gate:** `tests/services/workspace-service.test.ts` + nuevo test de "conflicto id↔ruta no borra cola".
- **Owner:** ODE-375.

### R4 — IndexedDB scoped como catálogo/cola desktop (`localDB`)
- **Callers:** vivo y central (Desk, opener, save, sync). Scopes múltiples (`odessay-anonymous`, `odessay-<userId>`).
- **Clasificación:** **migrate** (cosechar todos los scopes a SQLite) → **isolate** (read-only compat una versión) → **delete** lectura/escritura desktop.
- **Riesgo de datos:** **crítico**. La cola durable y los writings local-only viven por-scope; `sync-bootstrap.tsx` conmuta scope en login/logout. Una migración que sólo lea el scope activo (`getDatabaseName()`) **pierde** datos del otro scope → failure mode "removal order drops pending queue data or local-only UUIDs". La migración debe enumerar todos los `odessay-*` (p.ej. `indexedDB.databases()`), no sólo el activo.
- **Rollback:** conservar IndexedDB read-only una versión (gate M5 del spec).
- **Prerequisito:** ODE-367 catálogo (done) + dual-write encendido + verificación de paridad.
- **Test gate:** integration de cosecha multi-scope + "local-only sobrevive rebuild SQLite".
- **Owner:** ODE-376 (migración) → ODE-374 (retiro de lecturas compat).

### R5 — `migrateIndexedDbToFilesystem` (migración actual)
- **Callers:** vivo en arranque desktop (`document-service-factory.ts:151`, `ensureMigrated`).
- **Clasificación:** **adapt**. Hoy materializa `.md` pero **no** migra catálogo ni cola a SQLite, y puede materializar cloud-only al crear draft por cada writing sin `canonical_path` (`indexeddb-to-filesystem.ts:52-88`).
- **Riesgo de datos:** medio — puede crear archivos para filas que debieron quedar cloud-only; no cosecha la cola.
- **Rollback:** idempotente por `canonical_path` (skip si ya existe, `:45-50`).
- **Prerequisito:** debe subsumirse en la migración M5 (una sola pasada catálogo+cola+archivos).
- **Test gate:** `tests/services/desktop-save-path.test.ts`, `document-service-factory.test.ts`.
- **Owner:** ODE-376 (absorbe) — coordinar con ODE-371 (cloud-only no materializa por default).

### R6 — Dual-write catálogo (flag off) + adapter SQLite/web + `getDocumentCatalog`
- **Callers:** write path cableado (queue/sync/detach) gated por flag off; **read path sin callers** (`getDocumentCatalog` 0 consumidores).
- **Clasificación:** **retain**. Fundación M1 correcta. `getDocumentCatalog` se activa en M4 (ODE-373); dual-write se enciende antes de la cosecha M5.
- **Riesgo de datos:** ninguno (dormido).
- **Rollback:** flag off + DROP tablas v2 (documentado `index.rs:378-381`).
- **Prerequisito para activar:** ODE-373 (lectura) / ODE-376 (cosecha).
- **Owner:** ODE-373 / ODE-376.

### R7 — Comandos huérfanos seguros (dead-but-safe)
- **`catalog_schema_version` / `tauriCatalogSchemaVersion`** — 0 callers (`index.rs:225`, `tauri-commands.ts:151`). Útil como diagnóstico de migración.
  - **Clasificación:** **isolate-to-tooling** (mantener para health/migración; no exponer en UI). No borrar: barato y observable.
- **`workspace_compute_content_hash` / `tauriComputeContentHash`** — 0 callers (`workspace.rs:386`, `tauri-commands.ts:123`). El hashing vivo ocurre server-side en Rust (`content_hash_for_markdown_file`, `workspace.rs:393`) y en TS para cloud.
  - **Clasificación:** **isolate-to-tooling / delete** — candidato a borrado si M6 no necesita hashing on-demand desde el cliente; verificar que ODE-371 (backfill/paridad de hash) no lo requiera antes de borrar.
- **Riesgo de datos:** ninguno. **Confianza:** alta (grep whole-repo sin callers).
- **Owner:** ODE-374 (limpieza) / ODE-371 (decidir sobre compute_content_hash).

### R8 — `remote-bootstrap` rebind por `content_hash`
- **Callers:** vivo (`lib/sync/remote-bootstrap.ts` rebind `:206-224`, hidratación cloud).
- **Clasificación:** **adapt** — es una pieza útil de reconciliación por hash, pero es un camino de admisión paralelo. Debe subordinarse al `WorkspaceReconciler`/opener único (prioridad ruta→inode→hash local→hash cloud).
- **Riesgo de datos:** medio — rebind por hash único es correcto; hash ambiguo no debe elegir. Verificar que sólo re-vincula con candidato único activo.
- **Prerequisito:** ODE-370 (reconciliador) + ODE-371 (paridad de hash cloud).
- **Owner:** ODE-370 / ODE-371.

## Secuencia de retiro segura (Definition of Done)

Ninguna eliminación se autoriza sin el prerequisito y su evidencia de migración/rollback:

1. **M1 (ODE-367, done):** fundación aditiva. Nada se borra.
2. **M2 (ODE-370):** reconciliador global + manifest v2 proyecta a SQLite. `workspace_sync` deja de mint/leer-frontmatter *en el camino nuevo*, pero el viejo permanece hasta harvest.
3. **M3 (ODE-375):** `openDocument({id|path})` único. Retira rebind destructivo (U4) y seed IndexedDB (U5); preserva cola. Mantiene el fallback-a-cache (F-DRAFT) hasta M5.
4. **M4 (ODE-373):** Desk/Workspace consumen `getDocumentCatalog()`. Activa lado lectura del catálogo. Habilita borrar `writings_index` **read** (R1) — pero no antes.
5. **M5 (ODE-376):** cosecha **multi-scope** IndexedDB (catálogo + cola) a SQLite; IndexedDB read-only una versión. Recién aquí es seguro retirar `migrateIndexedDbToFilesystem` legacy (R5) y las escrituras a `writings_index` (R1).
6. **M6 (ODE-371 + ODE-374):** cloud reconcile/materialización; **borrado final** de `writings_index` (R1), mint/frontmatter (U1/U2, R2), path-as-id (U3), compat IndexedDB (R4) y comandos huérfanos (R7). Gate de release de compatibilidad previo.
7. **DoD (ODE-372):** validación en DMG de producción (rename/move Finder, offline open/save/restart, paridad Desk/Workspace, local-only sobrevive rebuild SQLite).

## Failure modes vigilados (Requisito / sección "Failure modes" del brief)

- **Lector de compat vivo clasificado muerto:** evitado — R6 (catálogo) y F-DRAFT (fallback a cache) marcados retain pese a "parecer" reemplazables.
- **Orden de retiro pierde cola/UUID local-only:** cubierto por R2 (manifest es única fuente del UUID local-only) y R4/U7 (cosecha multi-scope obligatoria antes de borrar IndexedDB).
- **Auditoría duplica scope de implementación:** evitado — cada acción se enruta a M1–M6 existentes; sin issue nuevo.
- **Búsqueda estática pierde registro dinámico de comandos Tauri:** cubierto — se verificó `invoke_handler![...]` en `src-tauri/src/lib.rs:292-321` (registro explícito de los 23 comandos) además del grep de `invoke("...")` en TS.

## Reconciliación con ODE-366 y roadmap M1–M6

Coherente con ODE-366 (tres catálogos/aperturas) y con el workspace-diagnostic (P0 mint+frontmatter, P0 rebind destructivo, P1 proyecciones paralelas sin reconciliador, P1 scope vs borrado físico). Añade la evidencia de reachability faltante: qué callers existen hoy, cuáles ya están muertos (R1 lectura, R7) y cuál es el orden de dependencia real entre milestones.

## No objetivos

- No refactoriza ni borra código de producto (Requisito 6).
- No redefine el target aceptado.
- No enciende el flag ni ejecuta migraciones.
