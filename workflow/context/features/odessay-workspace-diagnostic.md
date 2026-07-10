# Diagnóstico — Workspace: filesystem, nube y binding documental

- **Estado:** diagnóstico de arquitectura; no autoriza cambios de implementación por sí solo.
- **Fecha:** 2026-07-09
- **Alcance:** Workspace desktop, Desk, Open Document, `DocumentService`, índice `.odessay/`, SQLite, IndexedDB y sincronización cloud.
- **Precedencia:** `workflow/context/core/odessay-adr-identidad.md` gobierna identidad y `workflow/context/features/odessay-desktop-document-catalog.md` gobierna el contrato operacional objetivo de desktop. Este documento registra la brecha contra el código observable; no crea una arquitectura alternativa.

## Conclusión ejecutiva

Workspace tiene una dirección correcta —desktop-first, archivos en su lugar y `.md` como contenido canónico—, pero el sistema aún mezcla dos mecanismos de identidad:

1. el índice de Workspace acuña o recupera un id para un archivo;
2. Writings/Supabase usan el UUID del cliente como id del documento y dueño de la metadata.

Al abrir un archivo, la UI intenta reconciliar ambos de forma local. Eso evita que el editor use la ruta como id, pero no demuestra que el UUID elegido sea el mismo documento cloud. El resultado es un binding frágil entre `path`, UUID de índice, `LocalWriting` y registro cloud; el sistema puede confundir un archivo externo, un writing ya sincronizado y una copia con el mismo contenido.

La prioridad no es añadir más metadata al filesystem. Es sustituir los catálogos/aperturas paralelos por `DocumentCatalog` y `openDocument({ id | path })`, haciendo que cada runtime implemente el contrato sin reinterpretar la identidad.

## Clasificación arquitectónica

### Layer

- Dominante: `Application`.
- Secundarias: `Adapter(desktop)` para scan/watch/index y `Domain` para identidad, estados y semántica de borrado.

### Runtime scope

- Actual: `desktop`, `cloud` y `shared-core` de facto; `web` consume el mismo registro cloud.
- Objetivo: core compartido para el protocolo de binding; adapters separados para filesystem desktop y Supabase/web.

### Ownership

- Owner principal: `architecture-first` hasta aprobar el contrato de binding.
- Frontend: muestra procedencia, estado y decisiones explícitas; nunca decide un UUID por ruta ni reemplaza registros locales.
- Desktop adapter: obtiene ruta, inode, hash y eventos; persiste el ledger `.odessay/index.json` y la proyección operacional SQLite.
- Cloud adapter: busca/crea el registro por UUID y consulta candidatos por `content_hash`; es dueño de metadata.
- Database: indexa/permite consultar `content_hash` activo sin imponer unicidad (dos archivos pueden tener el mismo contenido) y conserva la metadata ligada al UUID.

## Hechos observados

| Área | Evidencia | Lectura |
|---|---|---|
| Índice local | `src-tauri/src/commands/workspace.rs` persiste `id`, `inode`, `content_hash`, `lastSeen` y `size` en `.odessay/index.json`. | El índice ya es un puente de binding, no un almacén de metadata. |
| Identidad de archivos nuevos | El mismo comando acepta `id` de frontmatter y, si no hay entrada previa, usa `Uuid::new_v4()`. | Sigue existiendo una segunda acuñación y una lectura de frontmatter incompatibles con ADR D4/D5. |
| Apertura desde Workspace | `lib/services/desktop/workspace-service.ts` siembra/reemplaza `LocalWriting` por `canonical_path` con el id del índice; al diferir, elimina la cola y el registro local anterior. | La reconciliación es destructiva para caché/cola y no prueba identidad cloud antes de reemplazarla. |
| Catálogo SQLite | `src-tauri/src/commands/index.rs` solo guarda `path`, `title` y timestamps en `writings_index`; Desk, Search y sync siguen leyendo IndexedDB. | SQLite existe, pero aún no implementa `DocumentCatalog`, bindings, presencia local/cloud ni cola durable. |
| Binding cloud | `lib/sync/remote-bootstrap.ts` puede re-vincular un candidato local materializado cuando el `content_hash` es único. | Ya existe una pieza útil, pero no es el único camino de admisión ni queda expresada como contrato único. |
| Huella | Rust calcula BLAKE3 sobre UTF-8 con saltos de línea normalizados; `writings.content_hash` existe en la migración `20260617150000_add_content_hash_to_writings.sql`. | La base técnica de D6/D11 existe; falta convertirla en protocolo consistente y verificar adopción de todos los write paths. |
| Borrado | `detachLocalFile` elimina `canonical_path` sin borrar el writing cloud. | Concuerda con ADR D9, siempre que el archivo realmente haya salido del scope y no solo haya sido excluido por selección. |

## Riesgos que explican la confusión

### P0 — Dos acuñadores y frontmatter como fallback

El índice puede generar un UUID en Rust y puede adoptar `frontmatter.id`. El contrato objetivo exige un solo UUID acuñado por cliente y prohíbe tratar el frontmatter como metadata Odessay. Mientras ambos caminos existan, un archivo puede llegar con tres identidades posibles: id histórico en frontmatter, id del índice y writing cloud.

**Invariante violada:** un documento tiene un UUID único cliente = nube = binding local (ADR D5).

### P0 — Rebinding por ruta reemplaza estado sin admisión

`openFileInEditor(path, workspaceFileId)` toma el id del índice como verdad y, si IndexedDB contiene otro id para la misma ruta, borra sus mutaciones pendientes y reemplaza el registro. La ruta es una pista primaria para conservar un binding existente, pero no autoriza a sustituir identidad; debe detectarse y resolverse como conflicto de binding.

**Impacto:** pérdida de cola local, apertura del archivo bajo el writing equivocado o creación de duplicados cloud en el siguiente sync.

### P1 — El binding y el catálogo viven en proyecciones paralelas sin reconciliador global

`.odessay/index.json`, `writings_index`, `LocalWriting.canonical_path` y `writings` en nube representan partes de la relación archivo↔UUID. Falta el reconciliador global que proyecta el ledger y el filesystem a SQLite y decide entre: binding local válido, hash cloud único, archivo externo nuevo, hash ambiguo y conflicto id↔ruta.

**Impacto:** cada punto de entrada (scan, watcher, abrir, pull) puede tomar una decisión diferente.

### P1 — Selección de paths y borrado físico necesitan señales distintas

El snapshot de Workspace solo contiene los `selectedPaths`; su reconciliación interpreta una entrada ausente como archivo retirado y llama a `detachLocalFile`. Cambiar el scope de selección no equivale a borrar o mover el archivo. El protocolo debe distinguir `fuera-de-scope`, `no-observable` y `ausente-confirmado` antes de retirar un binding local.

### P2 — Estado documental desactualizado en los docs

Algunos textos aún describen `content_hash` como pendiente o inexistente en cloud. El código y la migración ya contienen parte de esa infraestructura. No debe marcarse D11 como cerrado: falta probar que todos los caminos de alta, guardado, pull y rebind usen exactamente el hash canónico y que los casos ambiguos no creen bindings arbitrarios.

## Contrato aceptado que falta implementar

El detalle normativo vive en `odessay-desktop-document-catalog.md`. El mínimo operativo es:

1. **Entrada:** `{ path, inode?, contentHash, existingBinding?, cloudCandidates }`.
2. **Salida:** una resolución explícita `bound(id)`, `unbound`, `ambiguous`, `identity-conflict` u `out-of-scope`; nunca un UUID elegido solo por ruta.
3. **Precedencia:** conservar el binding existente por ruta; usar inode/hash solo para mover/renombrar y rebind. Un hash solo re-vincula si hay un único candidato activo; una coincidencia ambigua requiere decisión, no minting.
4. **Alta:** un documento creado por Odessay recibe el UUID antes de escribir el manifest. Un archivo externo se reconcilia dentro de un BindingRoot y solo acuña UUID después de agotar ruta/inode/hash; adoptar/sincronizar con nube sigue siendo una acción separada.
5. **Conflicto:** si manifest, SQLite, IndexedDB transicional o nube discrepan, no borrar cola ni sobrescribir estado; registrar el conflicto y exigir resolución determinista.
6. **Borrado y scope:** únicamente una ausencia confirmada dentro de un path observado hace `detachLocalFile`. Excluir una carpeta, perder permisos o desmontar el volumen no son borrados.
7. **Metadata:** nunca entra al `.md` ni al manifest. Se consulta y modifica por UUID en nube y se cachea en SQLite; IndexedDB queda como adapter web y compatibilidad transitoria desktop.

## Orden recomendado de corrección

1. Introducir `DocumentCatalog`/`DocumentBindingStore`, schema SQLite v2 y dual-write reversible.
2. Montar el reconciliador global en `DesktopAppShell`, migrar manifest v2 y separar ausencia física de scope/no-observabilidad.
3. Reemplazar las aperturas paralelas por `openDocument({ id | path })` y eliminar seed manual de IndexedDB.
4. Migrar Desk y Workspace al mismo catálogo y luego cosechar todos los scopes/cola de IndexedDB desktop.
5. Cerrar materialización cloud-only, hash/backfill y migraciones históricas; retirar compatibilidad solo tras verificar datos.
6. Completar la matriz de pruebas del spec, incluida reconstrucción SQLite, DMG y operación offline/restart.

## Boundaries e invariantes para implementación

- Dependencias permitidas: el resolver depende de un puerto de índice local, un puerto de registros locales y un puerto de lookup cloud por hash; los adapters dependen de sus APIs concretas.
- Dependencias prohibidas: UI→Tauri/SQLite/manifest/Supabase para decidir identidad; Rust→frontmatter como identidad normal; watcher→borrado cloud; `canonical_path`→elección de UUID.
- El `.md` gobierna contenido, el manifest gobierna binding local, SQLite gobierna el catálogo operacional desktop, Supabase gobierna metadata/existencia cloud e IndexedDB gobierna el adapter web.
- La ruta conserva un binding existente; no es identidad por sí sola.
- Todo write path calcula la misma huella del markdown canónico y solo re-vincula con coincidencia única.

## Referencias obligatorias para un issue de corrección

- `workflow/context/core/odessay-adr-identidad.md`
- `workflow/context/core/odessay-watched-folders.md`
- `workflow/context/features/odessay-desktop-document-catalog.md`
- `workflow/context/features/odessay-workspace.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`
