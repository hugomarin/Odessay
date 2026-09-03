# El vocabulario configurable de artifacts

Describe el modelo del vocabulario de tipos y estados que `ODE-472`–`ODE-477`
hacen durable, configurable y consistente entre web y desktop. Sucesor de
`ODE-432` (que entregó la superficie de Settings sin conexión).

## Qué es

Antes de este bloque, "tipo de artifact" y "estado" eran dos uniones cerradas
de TypeScript (`lib/writings/artifact-type.ts`, `lib/writings/status.ts`) con
un CHECK constraint espejo en Postgres. Un usuario no podía crear un tipo o
estado propio: la base de datos lo rechazaba.

El vocabulario es ahora una tabla `public.vocabulary_items`, propiedad del
usuario, con seis tipos y siete estados **base** (`is_base = true`) más
cualquier item personalizado que el usuario cree. El `key` de un item base es
exactamente el valor que hoy vive en `writings.artifact_type` / `writings.status`
— este bloque es un cambio de dónde vive la definición, no un cambio de los
valores existentes.

## Modelo de datos

`public.vocabulary_items`: `id`, `user_id`, `kind` (`type` | `status`), `key`
(estable, viaja en `writings.artifact_type` / `writings.status`), `name`,
`description`, `icon`, `color`, `hidden`, `is_base`, `is_required`, `position`.

- **`key` nunca cambia** una vez creado. `name`, `description`, `icon` y
  `color` sí — incluso en items base.
- **Icono y color vienen de un conjunto cerrado.** Los iconos admisibles son
  exactamente `ARTIFACT_TYPE_ICON_NAMES` / `WRITING_STATUS_ICON_NAMES` (según
  `kind`) y los colores son exactamente los seis `VOCABULARY_COLORS`
  (`lib/settings/vocabulary.ts`). Un valor fuera de esos conjuntos es
  `INVALID_INPUT`. Esto es lo que impide que el vocabulario se vuelva un
  vector de CSS arbitrario.
- **La base de datos ya no valida pertenencia al vocabulario.** Los CHECK
  constraints (`writings_artifact_type_check`, `writings_status_check`)
  fueron reemplazados por una restricción de forma (no vacío, ≤ 64
  caracteres). La validación de que un valor pertenece al vocabulario del
  usuario ocurre en la aplicación, en las rutas de escritura de writings.
- **Siembra perezosa.** Un usuario sin filas en `vocabulary_items` recibe los
  items base como respuesta sin backfill previo — la lectura nunca escribe.
  La primera escritura del usuario (crear, editar u ocultar cualquier item)
  materializa todas sus filas base de una vez, para que ediciones futuras
  sobre un item base siempre encuentren una fila real.

## Ocultar ≠ borrar

Decisión del dueño, 2026-08-30, vinculante para todo el paquete:

- **Ocultar** (`hidden = true`) es reversible y no toca ningún artifact
  existente. Solo saca el item de menús, selectores y filtros. Un artifact que
  ya llevaba ese valor lo conserva y lo sigue mostrando.
- **Borrar** es exclusivo de items personalizados (nunca de un item base) y es
  destructivo: reescribe, en la misma operación, todos los `writings` del
  usuario que llevaban ese `key` al valor base (`general` para tipos, `draft`
  para estados). La UI lo antecede de una confirmación que nombra cuántos
  artifacts se van a reescribir (`[ODE-475]`). La atomicidad la garantiza
  `public.delete_vocabulary_item(uuid)`, una función Postgres `security
  invoker` que reescribe y borra en una sola transacción implícita.
- `draft` tiene `is_required = true`: no puede ocultarse ni borrarse, ni por
  servicio ni por política.

## Precedencia local/nube (desktop)

El vocabulario es **local-first en desktop**: existe y es editable sin sesión
iniciada, con los 6 tipos y 7 estados base como default offline — invariante
de `workflow/agents.md` ("auth habilita capacidades cloud, no existencia
local"). `[ODE-472]` dejó el adapter desktop (`DesktopSettingsService`) en un
estado `UNAVAILABLE` explícito para las cuatro operaciones de vocabulario;
`[ODE-473]` lo implementa.

**Persistencia local.** `DesktopSettingsService` guarda los items
personalizados y cualquier item base editado en `desktop_settings_v1` bajo la
clave `vocabularyItems` (JSON, vía `tauri-plugin-store`), junto a
`workspaces` y `bindingRoots` — sin store durable nuevo. Un item base sin fila
propia se sintetiza en memoria desde `lib/vocabulary/base-items.ts` con
`updatedAt` en epoch (`1970-01-01T00:00:00.000Z`), el mismo convenio que usa
el adapter web (`ODE-472`) para un item base no materializado — eso es lo que
permite que la regla de merge trate "nunca tocado en ningún lado" como
"idéntico" sin round trip a la base de datos.

**Borrar con reescritura en desktop.** Borrar un item personalizado consulta
el catálogo SQLite (`tauriCatalogList`), filtra los documentos cuyo
`status_cache` / `artifact_type_cache` coincide con el `key` borrado, y
reescribe cada uno al valor base más su mutación de sync (`mutationKind:
"metadata"`) **en una sola transacción SQLite** vía
`tauriCatalogBulkDualWrite` — el catálogo y el encolado de la mutación
comparten la misma transacción de Rust (`apply_dual_write`), así que no
pueden desincronizarse entre sí. El envío real a la nube ocurre después, en
el drenado en background que ya existe (`desktopCatalogSyncService`). Nunca
toca el `.md`: el `key` solo vive en el caché del catálogo y en la fila de la
nube.

**Regla de merge (`lib/vocabulary/merge.ts`).** Unión por `(kind, key)`,
función pura:

- Mismo `(kind, key)` en ambos lados: gana el que tiene `updatedAt` mayor; el
  perdedor se sobrescribe con el ganador en su lado. `updatedAt` igual
  (incluido el epoch de dos items base nunca tocados) → no hay escritura.
- Solo en local → se sube a la nube. Solo en la nube → se baja a local.
- Los items base nunca se duplican: comparten `key` en ambos lados, así que
  siempre caen en la rama "mismo key".
- Dos items personalizados con el mismo nombre visible pero `key` distinto
  nunca se fusionan — la unión es por `key`, nunca por `name`.
- Idempotente: si el estado ya convergió (local y nube tienen el mismo
  `updatedAt` por item), una segunda corrida no produce escrituras.

**Orquestación (`lib/services/desktop/vocabulary-reconciler.ts`).** Se
dispara al iniciar sesión desde `SyncBootstrap`
(`components/sync/sync-bootstrap.tsx`), como parte del mismo
`hydrateFromRemote` que ya hidrata writings y collections. Lee ambos lados,
corre el merge, aplica `localWrites` a `desktop_settings_v1` en una sola
escritura (`applyVocabularyMergeLocally`) y `cloudWrites` a
`vocabulary_items` en un solo upsert por lote (`upsertVocabularyItemRows`,
reexportado desde `lib/vocabulary/server.ts` porque ese módulo solo depende
de un `SupabaseClient` genérico, no de Next.js). Si la lectura de la nube
falla, no toca nada local y reporta `pending` — se reintenta en la próxima
sesión con sesión iniciada. Si una edición del usuario ocurre mientras se
reconcilia, esa edición gana: el reconciler toma una foto del estado local al
empezar y, si detecta que cambió justo antes de escribir, reintenta una vez
contra el estado nuevo; una segunda colisión aborta dejando lo local intacto.

## `disabledStatuses` (deprecado)

`profiles.disabled_statuses` fue, hasta este bloque, la única preferencia
durable del vocabulario (`ODE-432`). Sobrevive por compatibilidad — no se
borra — pero deja de ser la fuente: `/api/user/settings` sigue respondiendo
`disabledStatuses`, ahora **derivado** de los items de estado con
`hidden = true`. Su contenido se sembró una sola vez (migración
`20260903190200_seed_vocabulary_from_disabled_statuses.sql`) en las filas de
estado del usuario. La columna queda marcada `deprecated` por comentario SQL
para que un rollback no pierda la preferencia de nadie.

## Boundaries

- El vocabulario es metadata de catálogo y nube — igual que `artifact_type`
  lo era antes de este bloque. Ninguna operación de creación, edición,
  ocultamiento o borrado escribe en el frontmatter ni en el cuerpo de un
  `.md`. El `.md` materializado sigue siendo la única autoridad de contenido
  (`odessay-adr-identidad.md`).
- SQLite sigue siendo el único `DocumentCatalog` consultable en desktop; sus
  columnas `status_cache` / `artifact_type_cache` ya eran `TEXT` libre y no
  requirieron migración.
- La UI nunca aprende de Supabase, Postgrest o Tauri directamente: todo pasa
  por `SettingsService` (`lib/services/contracts/settings-service.ts`) y su
  envelope `ServiceResponse`.

## Estado del bloque

| Issue | Qué entrega | Estado |
|---|---|---|
| `ODE-472` | Schema, contrato de servicio, adapter web | hecho |
| `ODE-473` | Persistencia desktop + reconciliación al iniciar sesión | en curso |
| `ODE-474` | Catálogo único de cliente; fin de la coerción silenciosa | pendiente |
| `ODE-475` | Settings › Artifact types / Status conectados | pendiente |
| `ODE-476` | Repintado de los 22 consumidores | pendiente |
| `ODE-477` | Evidencia end-to-end del contrato completo | pendiente |

Este documento se actualiza en cada issue del bloque; no se reescribe desde
cero.
