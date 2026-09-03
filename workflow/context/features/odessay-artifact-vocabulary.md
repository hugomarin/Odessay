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
local"). `[ODE-472]` deja el adapter desktop (`DesktopSettingsService`) en un
estado `UNAVAILABLE` explícito para las cuatro operaciones de vocabulario —
deliberadamente, no un stub silencioso que devolviera los items base sin
error: un stub silencioso ocultaría que `[ODE-473]` todavía no existe.

`[ODE-473]` implementa la persistencia real en `desktop_settings_v1` y la
reconciliación al iniciar sesión. *(Esta sección se completa con la regla de
merge exacta cuando `[ODE-473]` aterriza — no inventarla aquí de antemano.)*

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
| `ODE-472` | Schema, contrato de servicio, adapter web | en curso |
| `ODE-473` | Persistencia desktop + reconciliación al iniciar sesión | pendiente |
| `ODE-474` | Catálogo único de cliente; fin de la coerción silenciosa | pendiente |
| `ODE-475` | Settings › Artifact types / Status conectados | pendiente |
| `ODE-476` | Repintado de los 22 consumidores | pendiente |
| `ODE-477` | Evidencia end-to-end del contrato completo | pendiente |

Este documento se actualiza en cada issue del bloque; no se reescribe desde
cero.
