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

Decisión del dueño, 2026-08-30, vinculante para todo el paquete: el
vocabulario es **local-first en desktop**: existe y es editable sin sesión
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

## Settings conectado (ODE-475)

`VocabularyList` (`components/settings/vocabulary-list.tsx`) es el único
punto de la superficie de Settings que habla con `SettingsService`, vía
`useUserSettingsContext()`: `createVocabularyItem`, `updateVocabularyItem`,
`deleteVocabularyItem`, `getVocabularyUsage`. `ArtifactTypeSettings` y
`WritingStatusSettings` quedan como presentación pura, suscritas al catálogo
compartido con `useVocabulary()` para repintar sin recarga en cuanto una
edición se confirma.

**Ocultar vs. borrar, corregido.** El campo `locked` de la lista (bloquea
Delete) y el campo `required` (bloquea también el switch de ocultar) eran el
mismo flag en la entrega de `ODE-432` — un bug que hacía a **todos** los
estados base no-ocultables, no solo a `draft`. Ahora son independientes:
`locked = isBase` (ningún item base se borra, personalizado o no), `required`
solo lo lleva `draft`.

**La confirmación de borrado** (`components/settings/vocabulary-delete-dialog.tsx`)
es una capa `absolute inset-0` **dentro** del mismo `FormModal` del editor —
el mismo patrón que `DiscardConfirm` en `components/ui/overlay-core.tsx` —,
no un segundo modal apilado. Nombra el objeto y el valor base
("Delete type «Research»" → reescribe a `General`), y si el conteo de uso no
está disponible lo dice explícitamente en vez de mostrar cero.

**Pie de página corregido.** Settings › Artifact types ya no afirma que el
tipo "se escribe en el frontmatter" — nunca fue cierto y contradecía el
invariante del propio producto. El nuevo texto dice dónde vive realmente: el
catálogo y la nube.

**Asistencia AI, fuera de alcance.** Decisión del dueño, 2026-08-30,
vinculante para todo el paquete: los botones "Recommend to me" e "Improve
with AI" del editor de vocabulario permanecen deshabilitados, con su razón
visible en el propio control — no es un `TODO` implícito, es alcance
explícitamente cerrado para este bloque.

## Repintado de consumidores (ODE-476)

Los consumidores restantes que aún leían `WRITING_STATUS_VALUES`/
`ARTIFACT_TYPE_VALUES` para construir listas de opciones, o un color/switch
local, quedaron migrados a `useVocabulary()` + `listVisibleVocabulary()` /
`getVocabularyLabel|Color|IconName`: `WritingStatusBadge` (dejó de tener su
propia tabla Tailwind de colores por estado), `DeskFilterBar`,
`BulkActionBar`, `DeskArtifactRow`/`DeskArtifactList`/`DeskActivityTable`,
`WritingPreviewModal`, `WritingStatusPicker`, el panel de propiedades del
editor, `WorkspaceDetail`/`WorkspacePrototypeShell`, las tres superficies de
Collections, `artifact-table-columns.tsx` y `PublicWritingList`.

Un grep dirigido (no lectura completa de cada archivo) encontró **tres forks
locales no listados en el brief original**: un tercer array
`STATUS_OPTIONS: WritingStatus[]` hardcodeado en
`components/editor/panels/properties-panel.tsx` (además de los dos ya
corregidos en `ODE-474`), y el ordenamiento "group by status/type" de Desk
(`lib/queries/desk-activity.ts`'s `buildGroups()`), que seguía usando
`WRITING_STATUS_VALUES.filter(status => groups.has(status))` en vez del
orden del catálogo. Este segundo caso motivó el nuevo helper
`orderGroupKeysByCatalog(catalog, kind, keys)` en `lib/vocabulary/resolve.ts`
(ordena por `position`, incluye claves ocultas-pero-en-uso, añade al final
cualquier clave que el catálogo ya no reconozca) — `buildDeskActivitySummary`
ahora acepta un `catalog` opcional para que Desk repinte el orden de sus
grupos sin recargar.

**Bug real encontrado y corregido — id de vocabulario, no key.**
`lib/settings/vocabulary.ts`'s `getWritingStatusVocabulary`/
`getArtifactTypeVocabulary` mapeaban `VocabularyItem.id` (la forma que
consume Settings) al `key` humano del catálogo (`"draft"`) en vez de a su
`id` resoluble (`"base:status:draft"` para un item base sin materializar, o
el UUID real de la fila una vez materializada). Todo lo que escribe contra
ese id — `updateVocabularyItem`/`deleteVocabularyItem` (`resolveRow` en
`lib/vocabulary/server.ts`, y su espejo desktop) y el conteo de uso
(`getVocabularyUsage` indexa por `item.id`) — esperaba la forma resoluble.
El resultado: Guardar, Borrar y el conteo de uso en la confirmación de borrado
**nunca funcionaron para ningún tipo o estado base** (solo custom items ya
materializados con UUID real habrían coincidido por casualidad), y el conteo
de uso del switch "Show in menus" leía silenciosamente 0. Corregido: ambas
funciones ahora usan `item.id`. El switch de estado, de paso, dejó de pasar
por el array legacy `disabledStatuses` (que solo reconocía las siete keys
base y devolvía 400 ante una custom) y ahora llama
`updateVocabularyItem(id, { hidden })` directamente — el mismo CRUD real que
ya usan Guardar/Borrar — leyendo `enabled` del propio flag `hidden` del item
del catálogo en vez de un array separado a mantener sincronizado.

**Gap conocido — requirement 10/12, vacuamente satisfecho.** Las cuatro
superficies del "Presentation Contract" (`/write/[id]`, `/preview/[token]`,
`/shared/[id]`, `/{username}/{slug}`) no renderizan ninguna etiqueta de
estado/tipo hoy — se verificó leyendo cada archivo, no se infirió. No hay
riesgo de fuga autor↔visitante que resolver en este issue porque no hay nada
que mostrar; si una de esas superficies empieza a mostrar vocabulario en el
futuro, ese trabajo deberá decidir explícitamente de qué catálogo lee
(el gap que dejó `ODE-474` documentado arriba).

**No verificado.** No se pudo abrir una sesión autenticada en el navegador
de este entorno (ver limitación general documentada en `ODE-474`/`ODE-475`);
el repintado se verificó por typecheck, lint y la suite completa
(1795/1795), no visualmente contra Desk/Settings reales.

## Evidencia end-to-end (ODE-477)

`tests/vocabulary/end-to-end-contract.test.ts` (nuevo) corre, como un solo
guion contra el mismo cliente Supabase simulado, exactamente la secuencia
que pide el brief — crear tipo, renombrarlo, recolorearlo, ocultar un
estado, borrarlo — y prueba tres cosas que ningún issue individual puede
probar solo: el `.md` queda byte-idéntico y el frontmatter no gana ninguna
clave (requirement 1); ocultar nunca toca la tabla de writings mientras que
el conteo de reescritura de borrar coincide exactamente con el conteo de uso
que la confirmación mostró — ni más, ni menos (requirement 5); y un valor
que el catálogo ya no reconoce sobrevive un ciclo abrir/editar/guardar
(requirement 6). El grep del requirement 4 (cero versiones locales del
catálogo, cero `switch` de vocabulario en `components/`) queda en
`artifacts/ode-477/requirement-4-grep.md`, limpio.

**Matriz de evidencia** en `artifacts/ode-477/evidence-matrix.md`: enlaza
cada afirmación del contrato del dueño (§6-bis de `dod-fase-10.md`) a su
prueba. Automatizado y en verde: no-escritura en frontmatter, ocultar≠borrar
con conteos que coinciden, preservación de valores desconocidos, grep de
versiones locales. **No producido en este entorno** (sin sesión autenticada
en el navegador ni build de escritorio firmado disponibles — mismo límite
documentado en `ODE-474`/`ODE-475`/`ODE-476`): persistencia a través de
reinicio/rehidratación, la matriz de paridad web/desktop ejecutada en vivo
(se argumenta paridad estática por contrato compartido + suites espejadas,
no por una sesión lado a lado), las capturas de aceptación por superficie a
1440/1100/768, y la captura del Performance Contract
(`capture-editor-trace.mjs`, `ops:network:gate`). El archivo de evidencia
detalla los pasos exactos que le faltan a un humano con sesión real.

Las tres decisiones del dueño que este bloque necesitaba por escrito quedan
fechadas en este documento: ocultar≠borrar (§"Ocultar ≠ borrar",
2026-08-30), vocabulario local-first en desktop (§"Precedencia local/nube",
2026-08-30), asistencia AI fuera de alcance (§"Settings conectado",
2026-08-30).

## Estado del bloque

| Issue | Qué entrega | Estado |
|---|---|---|
| `ODE-472` | Schema, contrato de servicio, adapter web | hecho |
| `ODE-473` | Persistencia desktop + reconciliación al iniciar sesión | hecho |
| `ODE-474` | Catálogo único de cliente; fin de la coerción silenciosa | hecho (parcial — ver nota) |
| `ODE-475` | Settings › Artifact types / Status conectados | hecho |
| `ODE-476` | Repintado de los consumidores + fix de id de vocabulario | hecho |
| `ODE-477` | Evidencia end-to-end del contrato completo | hecho (parcial — ver evidence-matrix.md) |

Este documento se actualiza en cada issue del bloque; no se reescribe desde
cero.
