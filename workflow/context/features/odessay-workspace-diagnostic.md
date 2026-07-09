# Diagnóstico — Workspace: filesystem, nube y binding documental

- **Estado:** diagnóstico de arquitectura; no autoriza cambios de implementación por sí solo.
- **Fecha:** 2026-07-09
- **Alcance:** Workspace desktop, `DocumentService`, índice `.odessay/`, IndexedDB y sincronización cloud.
- **Precedencia:** `workflow/context/core/odessay-adr-identidad.md` es la fuente de verdad. Este documento registra la brecha entre ese contrato y el código observable; no crea una arquitectura alternativa.

## Conclusión ejecutiva

Workspace tiene una dirección correcta —desktop-first, archivos en su lugar y `.md` como contenido canónico—, pero el sistema aún mezcla dos mecanismos de identidad:

1. el índice de Workspace acuña o recupera un id para un archivo;
2. Writings/Supabase usan el UUID del cliente como id del documento y dueño de la metadata.

Al abrir un archivo, la UI intenta reconciliar ambos de forma local. Eso evita que el editor use la ruta como id, pero no demuestra que el UUID elegido sea el mismo documento cloud. El resultado es un binding frágil entre `path`, UUID de índice, `LocalWriting` y registro cloud; el sistema puede confundir un archivo externo, un writing ya sincronizado y una copia con el mismo contenido.

La prioridad no es añadir más metadata al filesystem. Es fijar un protocolo único de binding y hacer que cada runtime lo implemente sin reinterpretar la identidad.

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
- Desktop adapter: obtiene ruta, inode, hash y eventos; persiste el índice delgado `.odessay/index.json`.
- Cloud adapter: busca/crea el registro por UUID y consulta candidatos por `content_hash`; es dueño de metadata.
- Database: indexa/permite consultar `content_hash` activo sin imponer unicidad (dos archivos pueden tener el mismo contenido) y conserva la metadata ligada al UUID.

## Hechos observados

| Área | Evidencia | Lectura |
|---|---|---|
| Índice local | `src-tauri/src/commands/workspace.rs` persiste `id`, `inode`, `content_hash`, `lastSeen` y `size` en `.odessay/index.json`. | El índice ya es un puente de binding, no un almacén de metadata. |
| Identidad de archivos nuevos | El mismo comando acepta `id` de frontmatter y, si no hay entrada previa, usa `Uuid::new_v4()`. | Sigue existiendo una segunda acuñación y una lectura de frontmatter incompatibles con ADR D4/D5. |
| Apertura desde Workspace | `lib/services/desktop/workspace-service.ts` siembra/reemplaza `LocalWriting` por `canonical_path` con el id del índice; al diferir, elimina la cola y el registro local anterior. | La reconciliación es destructiva para caché/cola y no prueba identidad cloud antes de reemplazarla. |
| Binding cloud | `lib/sync/remote-bootstrap.ts` puede re-vincular un candidato local materializado cuando el `content_hash` es único. | Ya existe una pieza útil, pero no es el único camino de admisión de Workspace ni queda expresada como contrato único. |
| Huella | Rust calcula BLAKE3 sobre UTF-8 con saltos de línea normalizados; `writings.content_hash` existe en la migración `20260617150000_add_content_hash_to_writings.sql`. | La base técnica de D6/D11 existe; falta convertirla en protocolo consistente y verificar adopción de todos los write paths. |
| Borrado | `detachLocalFile` elimina `canonical_path` sin borrar el writing cloud. | Concuerda con ADR D9, siempre que el archivo realmente haya salido del scope y no solo haya sido excluido por selección. |

## Riesgos que explican la confusión

### P0 — Dos acuñadores y frontmatter como fallback

El índice puede generar un UUID en Rust y puede adoptar `frontmatter.id`. El contrato objetivo exige un solo UUID acuñado por cliente y prohíbe tratar el frontmatter como metadata Odessay. Mientras ambos caminos existan, un archivo puede llegar con tres identidades posibles: id histórico en frontmatter, id del índice y writing cloud.

**Invariante violada:** un documento tiene un UUID único cliente = nube = binding local (ADR D5).

### P0 — Rebinding por ruta reemplaza estado sin admisión

`openFileInEditor(path, workspaceFileId)` toma el id del índice como verdad y, si IndexedDB contiene otro id para la misma ruta, borra sus mutaciones pendientes y reemplaza el registro. La ruta es una pista primaria para conservar un binding existente, pero no autoriza a sustituir identidad; debe detectarse y resolverse como conflicto de binding.

**Impacto:** pérdida de cola local, apertura del archivo bajo el writing equivocado o creación de duplicados cloud en el siguiente sync.

### P1 — El binding vive en tres proyecciones sin fuente de reconciliación explícita

`.odessay/index.json`, `LocalWriting.canonical_path` y `writings` en nube representan la relación archivo↔UUID. El ADR asigna roles, pero falta el algoritmo operativo para decidir entre: binding local válido, hash cloud único, archivo externo nuevo, hash ambiguo y conflicto id↔ruta.

**Impacto:** cada punto de entrada (scan, watcher, abrir, pull) puede tomar una decisión diferente.

### P1 — Selección de paths y borrado físico necesitan señales distintas

El snapshot de Workspace solo contiene los `selectedPaths`; su reconciliación interpreta una entrada ausente como archivo retirado y llama a `detachLocalFile`. Cambiar el scope de selección no equivale a borrar o mover el archivo. El protocolo debe distinguir `fuera-de-scope`, `no-observable` y `ausente-confirmado` antes de retirar un binding local.

### P2 — Estado documental desactualizado en los docs

Algunos textos aún describen `content_hash` como pendiente o inexistente en cloud. El código y la migración ya contienen parte de esa infraestructura. No debe marcarse D11 como cerrado: falta probar que todos los caminos de alta, guardado, pull y rebind usen exactamente el hash canónico y que los casos ambiguos no creen bindings arbitrarios.

## Contrato de binding que falta aprobar

Este es el mínimo que un brief debe fijar antes de modificar Workspace, sync o apertura:

1. **Entrada:** `{ path, inode?, contentHash, existingBinding?, cloudCandidates }`.
2. **Salida:** exactamente una de `bound(id)`, `unbound-local`, `ambiguous-hash`, `identity-conflict` o `out-of-scope`; nunca un UUID implícito por ruta.
3. **Precedencia:** conservar el binding existente por ruta; usar inode/hash solo para mover/renombrar y rebind. Un hash solo re-vincula si hay un único candidato activo; una coincidencia ambigua requiere decisión, no minting.
4. **Alta:** un documento creado por Odessay recibe el UUID del cliente antes de escribir el índice. Un archivo externo queda `unbound-local` hasta que el flujo de importación cree/adopte un writing explícitamente.
5. **Conflicto:** si índice, IndexedDB o nube discrepan, no borrar cola ni sobrescribir `LocalWriting`; registrar el conflicto y pedir/adoptar una resolución determinista.
6. **Borrado y scope:** únicamente una ausencia confirmada dentro de un path observado hace `detachLocalFile`. Excluir una carpeta, perder permisos o desmontar el volumen no son borrados.
7. **Metadata:** nunca entra al `.md` ni al índice. Se consulta y modifica por UUID en nube/IndexedDB después de que el binding sea `bound(id)`.

## Orden recomendado de corrección

1. Definir el tipo/servicio de binding en shared application/domain y sus resultados explícitos.
2. Reemplazar la acuñación Rust y la lectura de `frontmatter.id` por un flujo de importación/adopción desde el cliente; mantener una migración de cosecha separada para documentos históricos.
3. Hacer que scan, watcher, apertura y bootstrap remoto usen el mismo resolver. El adapter desktop solo aporta evidencia del filesystem.
4. Cambiar la apertura para no borrar/reemplazar `LocalWriting` ni la cola ante ids distintos; convertirlo en `identity-conflict` observable.
5. Separar en los snapshots la ausencia física de la exclusión por `selectedPaths` y añadir pruebas de regresión.
6. Completar una matriz de pruebas: rename atómico, copia verbatim, copia divergida, hash duplicado, archivo externo, índice perdido, cambio de scope, archivo borrado y pull en máquina nueva.

## Boundaries e invariantes para implementación

- Dependencias permitidas: el resolver depende de un puerto de índice local, un puerto de registros locales y un puerto de lookup cloud por hash; los adapters dependen de sus APIs concretas.
- Dependencias prohibidas: UI→Tauri/Supabase para decidir identidad; Rust→frontmatter como identidad normal; watcher→borrado cloud; `canonical_path`→elección de UUID.
- El `.md` es contenido; la nube es metadata; IndexedDB es espejo; SQLite/JSON son cache y puente (ADR D10).
- La ruta conserva un binding existente; no es identidad por sí sola.
- Todo write path calcula la misma huella del markdown canónico y solo re-vincula con coincidencia única.

## Referencias obligatorias para un issue de corrección

- `workflow/context/core/odessay-adr-identidad.md`
- `workflow/context/core/odessay-watched-folders.md`
- `workflow/context/features/odessay-workspace.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`
