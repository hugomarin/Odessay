---
name: skill-database
description: Guía de base de datos de Odessay para migraciones, RLS, triggers, índices y validación del schema en Supabase. Usar cuando modifiques el modelo de datos, escribas migraciones SQL, revises políticas de acceso o optimices queries.
---

# Skill: Database

**Consulta este skill antes de cualquier trabajo con migraciones, queries, RLS, o triggers.**
**Usa Supabase MCP para consultar el schema vivo y validar contra el estado real de la DB.**

---

## Principio rector

La base de datos remota es la fuente de verdad del **estado cloud actual** de Odessay. El schema en `odessay-modelo-datos.md` es la referencia para la capa remota y colaborativa. Cualquier cambio al schema pasa por una migración versionada.

Matiz arquitectónico:

- en el runtime web actual, gran parte del producto sigue operando sobre Supabase + local cache
- en la dirección desktop, el documento canónico apunta a filesystem `.md`, no a la fila remota de `writings`

Regla general:

- no diseñar cambios de schema que bloqueen o contradigan la estrategia de documento canónico compartido
- si un issue toca `writings.body_json`, serializer/parser, sync documental o el rol futuro de la persistencia remota, cargar también:
  - `.agents/skills/skill-architecture/SKILL.md`
  - `workflow/context/features/odessay-desktop-app.md`
  - `workflow/context/features/odessay-desktop-migration-diagnostic.md`
  - `workflow/context/features/odessay-desktop-target-architecture.md`
  - `workflow/context/features/odessay-desktop-migration-plan.md`
- si falta `Layer`, `Runtime scope`, `Owner`, `Contracts touched` o `Invariants`, no diseñar el cambio de schema desde Supabase por inercia. Marcar `Context Gap`.

---

## Schema de referencia

Antes de cualquier operación, lee `workflow/context/core/odessay-modelo-datos.md`. Las entidades principales son:

- `profiles` — Extiende auth.users. Username, display_name, bio.
- `writings` — La unidad fundamental. Body en JSON (TipTap) + texto plano. Estado (draft/finished) y visibilidad (private/shared/public) como dimensiones independientes.
  - En runtime web/cloud actual `body_json` sigue siendo persistencia remota operativa.
  - En dirección desktop, eso no equivale al contrato documental canónico del producto.
- `correspondences` — Identidad del diálogo. Se crea cuando un writing recibe su primera respuesta.
- `collections` — Agrupaciones del autor. Un writing puede estar en múltiples collections.
- `writing_collections` — Join table.
- `writing_shares` — Quién puede ver un writing compartido.
- `ai_observations` — Señalamientos del AI editor.
- `invitations` — Invitaciones epistolares.

## Migraciones

- Viven en `/supabase/migrations/`.
- Nombre: `{timestamp}_{descripcion}.sql`. Ejemplo: `20260314120000_create_writings.sql`.
- Cada migración es una transacción. Si algo falla, se revierte todo.
- Siempre incluye el rollback como comentario al final del archivo.
- Nunca edites una migración ya aplicada. Crea una nueva.
- Testea la migración en staging antes de aplicar en producción.

## RLS (Row Level Security)

- RLS activo en todas las tablas. Sin excepciones.
- Las directrices de RLS están en `odessay-modelo-datos.md`.
- Patrones principales:
  - `auth.uid() = author_id` para acceso propio.
  - Subquery a `writing_shares` para acceso compartido.
  - `visibility = 'public'` para acceso abierto.
- Testea RLS con diferentes usuarios en staging. Un fallo de RLS es un bug de seguridad crítico.

## Triggers

- `on_auth_user_created` — Crea profile al registrarse.
- Trigger para crear `correspondence` cuando un writing con `parent_id` se comparte/publica y no existe correspondencia para ese árbol.
- Trigger para actualizar `correspondences.updated_at` cuando se agrega un writing al árbol.
- Trigger para generar `slug` automáticamente del título en writings.
- Trigger para extraer `body_text` de `body_json` en cada update de writings (o hacerlo application-side).

## Queries

- Usa el cliente tipado de Supabase. No SQL raw desde la aplicación excepto en migraciones.
- Queries frecuentes que deben ser eficientes:
  - Mis writings filtrados por estado/visibilidad.
  - Writings de una collection.
  - Writings compartidos conmigo.
  - Árbol de una correspondencia (recursive query por `parent_id`).
  - Lookup de writing por `author_id + slug` (URL pública).

## Supabase MCP

- Usa Supabase MCP para:
  - Consultar el schema actual de la DB.
  - Verificar que las migraciones se aplicaron correctamente.
  - Inspeccionar RLS policies activas.
  - Validar datos en staging.
- Nunca uses Supabase MCP contra producción para modificar datos.

## Seed data

- Vive en `/supabase/seed/`.
- Incluye: usuarios de prueba, writings de ejemplo en diferentes estados y visibilidades, collections, correspondencias con árbol de respuestas, invitaciones.
- Se aplica solo en staging. Nunca en producción.

---

## Checklist antes de entregar

Este checklist cubre lo específico de base de datos durante la implementación. Antes de abrir el PR, usar `skill-code-review.md` para la validación completa.

- [ ] ¿La migración tiene rollback documentado?
- [ ] ¿RLS cubre todos los casos (private/shared/public)?
- [ ] ¿Los triggers funcionan en staging?
- [ ] ¿Los índices necesarios están creados?
- [ ] ¿El schema en `odessay-modelo-datos.md` está actualizado si hubo cambios?
- [ ] ¿No se modificó producción directamente?
