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

## Catálogo único de cliente (ODE-474)

`lib/vocabulary/catalog.ts` es un singleton a nivel de módulo (no un React
context): guarda el snapshot actual del vocabulario resuelto y expone
`getVocabularyCatalogSnapshot()` (lectura síncrona) y
`subscribeVocabularyCatalog()` (para `useSyncExternalStore`). Esto permite dos
cosas a la vez: que los helpers síncronos existentes
(`getWritingStatusLabel`, `getWritingStatusOrder`, etc.) sigan leyendo "el
vocabulario actual" sin volverse `async`, y que `useVocabulary()` repinte
reactivamente sin recargar. `VocabularyCatalogBridge`
(`components/vocabulary/vocabulary-provider.tsx`, montado en
`app/(app)/layout.tsx` dentro de `UserSettingsProvider`) es el único
escritor: reenvía `settings.vocabulary` (ya obtenido por
`UserSettingsProvider`) al singleton — cero fetches adicionales por sesión.

`lib/vocabulary/resolve.ts` es el único lugar que resuelve `(kind, key)`
contra un catálogo. Un valor fuera del catálogo (`isUnknown: true`) se pinta
con su `key` crudo como nombre, el gris neutro de la paleta como color, e
icono `null` (el llamador cae a un icono genérico, normalmente `circle`) —
nunca vacío ni "undefined".

`lib/writings/status-color.ts` y `lib/writings/artifact-type-color.ts`
(los mapas `WritingStatus/ArtifactType → var(--token)`) fueron eliminados.
Sus dos consumidores (`DeskStatusDot`, `ArtifactTypeIcon`) y los tres
`switch` sobre valores de vocabulario que quedaban en `components/`
(`WritingStatusIcon`, el dropdown de `ArtifactTypeSelector`, el menú de tipo
de `WritingPreviewModal`) ahora resuelven icono y color vía
`useVocabulary()` + `lib/vocabulary/resolve.ts`, renderizando a través del
registro de iconos ya existente (`components/settings/vocabulary-icon.tsx`).

**Divergencia visual registrada:** el punto de estado de Desk y el icono de
tipo antes resolvían tokens CSS reactivos al tema (`hsl(var(--ink-4))`,
etc.); ahora resuelven el hex literal del vocabulario del usuario, según la
arquitectura que `ODE-472` ya fijó (los colores son dato del usuario, no
tokens — `docs/design/system-app.md` §1). La paridad de píxel en modo oscuro
para esos dos glyphs específicos no se verificó manualmente contra una
sesión real en este cambio.

**`WritingStatus`/`ArtifactType` abiertos.** Dejaron de ser uniones cerradas
(`type WritingStatus = string`); `WRITING_STATUS_VALUES`/`ARTIFACT_TYPE_VALUES`
siguen existiendo como los defaults base, ahora reexportados desde
`lib/vocabulary/base-items.ts` (que se convirtió en la única fuente de las
listas de keys base, para no crear un ciclo de imports con `status.ts` /
`artifact-type.ts`, que ahora dependen del catálogo). Abrir el tipo hizo que
el typechecker encontrara **dos versiones locales adicionales** no listadas
en el brief original: `lib/services/contracts/document-service.ts` declaraba
su propio `ArtifactType` cerrado, y `lib/queries/desk-activity.ts` tenía
`DeskStatusTone` como una tercera unión cerrada duplicada de `WritingStatus`.
Ambas quedaron unificadas (reexportan/alían el tipo abierto) en este mismo
issue.

**Gap conocido — `isOpenWritingStatus()` (requirement 11).** El modelo de
`vocabulary_items` (`ODE-472`) no tiene una propiedad "abierto/cerrado" que
un estado personalizado pueda declarar. `isOpenWritingStatus()` sigue leyendo
la misma lista literal de siempre (`done`/`archived`/`canceled`) en vez de
una propiedad del catálogo; un estado personalizado se trata como abierto
por default. Esto es un `Context Gap` documentado contra `ODE-472`, no una
lista hardcodeada nueva — resolverlo bien requiere un cambio de schema en
`vocabulary_items` fuera del alcance de este issue.

**Gap conocido — superficies públicas (requirement 12).** `ODE-474` no tocó
`components/public/public-writing-list.tsx` ni las rutas `/shared/[id]`,
`/preview/[token]`, `/{username}/{slug}`. Como el catálogo es hoy un
singleton atado a la sesión del visor, esas superficies — si empiezan a leer
del catálogo compartido sin más cambios — resolverían el vocabulario del
**visor**, no el del autor, violando el requirement 12. Esto queda para
`[ODE-476]`, que ya tiene esas cuatro superficies en su propio alcance
("Presentation Contract").

## Estado del bloque

| Issue | Qué entrega | Estado |
|---|---|---|
| `ODE-472` | Schema, contrato de servicio, adapter web | hecho |
| `ODE-473` | Persistencia desktop + reconciliación al iniciar sesión | hecho |
| `ODE-474` | Catálogo único de cliente; fin de la coerción silenciosa | hecho (parcial — ver nota) |
| `ODE-475` | Settings › Artifact types / Status conectados | pendiente |
| `ODE-476` | Repintado de los 22 consumidores | pendiente |
| `ODE-477` | Evidencia end-to-end del contrato completo | pendiente |

Este documento se actualiza en cada issue del bloque; no se reescribe desde
cero.
