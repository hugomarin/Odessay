# Schema y acceso de datos de Odessay

Este recurso conserva fuentes, formatos y escenarios concretos del proyecto. AGENTS.md y los contratos aceptados mantienen la precedencia normativa; el SKILL.md del directorio contiene el método reusable.

## 1. Objetivo

Database guía los cambios de schema, migraciones, RLS, triggers y consultas de Odessay con evidencia del schema real y de sus contratos documentales.

Consultar este recurso al trabajar con migraciones, queries, RLS o triggers de Odessay; [Database](../SKILL.md) define el método y su activación.
**Usa Supabase MCP para consultar el schema vivo y validar contra el estado real de la DB.**
Si el cambio puede modificar la forma de carga, el fan-out de queries, la paginación, la hidratación, el trabajo bulk o el costo al crecer, consulta también `.agents/skills/skill-performance/SKILL.md`. Database define schema, índices, RLS y consultas; `skill-performance` define la forma sostenible de ejecutarlas.

## 2. Ámbito y activación

Activar al modificar datos, migraciones, políticas de acceso, triggers, índices o consultas. Identificar además si el cambio altera persistencia documental o el costo de lectura al crecer.

## 3. Entradas y fuentes de autoridad

### Principio rector

La base de datos remota gobierna la **metadata** y la existencia cloud del documento y guarda una **copia** del contenido. En desktop, el `.md` materializado gobierna los bytes de contenido; en web, `body_json` persiste mediante el adapter local-first bajo el contrato de representación del ADR (ver `workflow/context/core/odessay-adr-identidad.md`, D1/D10). El schema en `odessay-modelo-datos.md` es la referencia para la capa remota y colaborativa. Cualquier cambio al schema pasa por una migración versionada.

Matiz arquitectónico (resuelto por el ADR, ya no "ahora vs dirección"):

- IndexedDB (`LocalWriting`) es el adapter local-first de web: guarda trabajo local y mutaciones pendientes; en desktop es compatibilidad transitoria hasta completar la migración a SQLite (D10). La metadata cloud puede tener un reflejo local sin cambiar su autoridad.
- el `.md` materializado es el documento canónico de desktop; `body_json` es la copia de trabajo de TipTap y el substrato persistido en web según D1.
- el registro de nube debe sumar `content_hash` (sobre el markdown canónico) para reconciliar archivos desnudos cross-máquina (D11), y la identidad es un solo UUID cliente=nube (D5).

Regla general:

- no diseñar cambios de schema que bloqueen o contradigan la estrategia de documento canónico compartido
- si un issue toca `writings.body_json`, serializer/parser, sync documental o el rol futuro de la persistencia remota, cargar también:
  - `.agents/skills/skill-architecture/SKILL.md`
  - el ADR de identidad y, cuando afecta operación desktop del catálogo, apertura o save/sync, el spec del catálogo según `AGENTS.md`;
  - documentos de dirección, diagnóstico, target architecture o migration plan solo si la pregunta depende de esas dimensiones.
- si falta `Layer`, `Runtime scope`, `Owner`, `Contracts touched` o `Invariants`, no diseñar el cambio de schema desde Supabase por inercia. Marcar `Context Gap`.

---

### Schema de referencia

Antes de cualquier operación, lee `workflow/context/core/odessay-modelo-datos.md`. Las entidades principales son:

- `profiles` — Extiende auth.users. Username, display_name, bio.
- `writings` — La unidad fundamental. Body en JSON (TipTap) + texto plano. Estado (draft/finished) y visibilidad (private/shared/public) como dimensiones independientes.
  - `body_json` es la copia de trabajo de TipTap y el substrato persistido en web. D1 fija Markdown como representación canónica; en desktop, el `.md` materializado gobierna los bytes de contenido. La nube guarda una **copia** del contenido y la metadata autoritativa (D10).
- `correspondences` — Identidad del diálogo. Se crea cuando un writing recibe su primera respuesta.
- `collections` — Agrupaciones del autor. Un writing puede estar en múltiples collections.
- `writing_collections` — Join table.
- `writing_shares` — Quién puede ver un writing compartido.
- `ai_observations` — Señalamientos del AI editor.
- `invitations` — Invitaciones epistolares.

## 4. Método y criterios

### Migraciones

- Viven en `/supabase/migrations/`.
- Nombre: `{timestamp}_{descripcion}.sql`. Ejemplo: `20260314120000_create_writings.sql`.
- Cada migración es una transacción. Si algo falla, se revierte todo.
- Siempre incluye el rollback como comentario al final del archivo.
- Nunca edites una migración ya aplicada. Crea una nueva.
- Testea la migración en staging antes de aplicar en producción.

### RLS (Row Level Security)

- RLS activo en todas las tablas. Sin excepciones.
- Las directrices de RLS están en `odessay-modelo-datos.md`.
- Patrones principales:
  - `auth.uid() = author_id` para acceso propio.
  - Subquery a `writing_shares` para acceso compartido.
  - `visibility = 'public'` para acceso abierto.
- Testea RLS con diferentes usuarios en staging. Un fallo de RLS es un bug de seguridad crítico.

### Triggers

- `on_auth_user_created` — Crea profile al registrarse.
- Trigger para crear `correspondence` cuando un writing con `parent_id` se comparte/publica y no existe correspondencia para ese árbol.
- Trigger para actualizar `correspondences.updated_at` cuando se agrega un writing al árbol.
- Trigger para generar `slug` automáticamente del título en writings.
- Trigger para extraer `body_text` de `body_json` en cada update de writings (o hacerlo application-side).

### Queries

- Usa el cliente tipado de Supabase. No SQL raw desde la aplicación excepto en migraciones.
- Queries frecuentes que deben ser eficientes:
  - Mis writings filtrados por estado/visibilidad.
  - Writings de una collection.
  - Writings compartidos conmigo.
  - Árbol de una correspondencia (recursive query por `parent_id`).
  - Lookup de writing por `author_id + slug` (URL pública).
- Para listas, árboles o sincronizaciones que puedan crecer, el brief debe declarar el patrón de carga, el límite de fan-out, el owner de paginación/batching y cómo se evita una query por elemento. Si se activa `skill-performance`, ese contrato prevalece sobre cualquier checklist local de este skill.

### Seed data

- Vive en `/supabase/seed/`.
- Incluye: usuarios de prueba, writings de ejemplo en diferentes estados y visibilidades, collections, correspondencias con árbol de respuestas, invitaciones.
- Se aplica solo en staging. Nunca en producción.

---

## 5. Resultado y evidencia

### Checklist antes de entregar

Este checklist cubre lo específico de base de datos durante la implementación. Antes de abrir el PR, usar `.agents/skills/skill-code-review/SKILL.md` para la revisión técnica completa.

- [ ] ¿La migración tiene rollback documentado?
- [ ] ¿RLS cubre todos los casos (private/shared/public)?
- [ ] ¿Los triggers funcionan en staging?
- [ ] ¿Los índices necesarios están creados?
- [ ] Si la consulta cambia la forma de carga o puede crecer, ¿existe el `Performance Architecture Contract` y la evidencia proporcional requerida?
- [ ] ¿El schema en `odessay-modelo-datos.md` está actualizado si hubo cambios?
- [ ] ¿No se modificó producción directamente?

## 6. Manejo de fallos e incertidumbre

Ante discrepancias entre schema vivo, migraciones y contrato documental, registrar la diferencia y resolver su autoridad antes de aplicar la migración.

## 7. Relaciones y ownership

Architecture resuelve autoridad documental y boundaries; Performance modela costo de consultas; Database concreta el schema y su verificación.

## 8. Recursos asociados

### Supabase MCP

- Usa Supabase MCP para:
  - Consultar el schema actual de la DB.
  - Verificar que las migraciones se aplicaron correctamente.
  - Inspeccionar RLS policies activas.
  - Validar datos en staging.
- Nunca uses Supabase MCP contra producción para modificar datos.
