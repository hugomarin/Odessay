# ODESSAY — Modelo de datos

**Documento de referencia para agentes de desarrollo.**
Lee `odessay-fundacional.md` para la visión y `odessay-stack.md` para las tecnologías.

---

## Entidades y relaciones

```
auth.users (Supabase Auth)
    │
    └── extends ── profiles (datos Odessay)
                      │
                      ├── writes ──── writings ──┬── belongs to ── correspondences
                      │                          │
                      │                          ├── responds to ── writings (árbol)
                      │                          │
                      │                          ├── tagged ── collections (vía join)
                      │                          │
                      │                          ├── shared with ── profiles (vía join)
                      │                          │
                      │                          └── has ── ai_observations
                      │
                      ├── owns ──── collections
                      │
                      └── invited via ── invitations
```

---

## Dos dimensiones de un writing

Un writing tiene **estado** y **visibilidad** como dimensiones independientes.

**Estado** (fase para el autor):
- `new` — Writing recién creado, todavía sin dirección clara.
- `exploring` — Etapa temprana de búsqueda o tanteo.
- `draft` — Writing ya encaminado y en desarrollo activo.
- `done` — Lo que ya terminé. Simbólico: el autor considera el texto completo. No impide edición futura (versionamiento vendrá después).

**Visibilidad** (quién puede verlo):
- `private` — Solo el autor.
- `shared` — El autor + personas específicas listadas en `writing_shares`.
- `public` — Abierto. Cualquiera con el link.

Todas las combinaciones son válidas. Un draft puede ser shared (trabajo en progreso que comparto). Un done puede ser private (terminé pero es para mí).

---

## Correspondencias

La correspondencia es una entidad con identidad propia. Es el corazón de Odessay: donde ocurre el conocimiento horizontal.

Una correspondencia se crea cuando el primer writing recibe su primera respuesta. Tiene su propio ID, lo que permite narrar su historia: qué llegó primero, qué vino después, qué se modificó, cómo evolucionaron las ideas. La AI editor usa la correspondencia completa como contexto.

El writing raíz inicia la correspondencia. Cada respuesta (y respuesta a respuesta) se une a la misma correspondencia. El `parent_id` en writings mantiene la estructura del árbol; el `correspondence_id` agrupa todo el árbol bajo una identidad compartida.

---

## Schema

### profiles

Extiende `auth.users` de Supabase. Se crea automáticamente al registrarse vía trigger.

| Campo | Tipo | Constraints | Nota |
|-------|------|-------------|------|
| id | uuid | PK, FK → auth.users.id | Mismo ID que Supabase Auth |
| username | text | unique, not null | URL del espacio público: odessay.com/{username} |
| display_name | text | not null | Nombre o pseudónimo visible en writings |
| bio | text | nullable | Descripción breve para el espacio público |
| invited_by_id | uuid | FK → profiles, nullable | Genealogía epistolar |
| created_at | timestamptz | default now() | |
| updated_at | timestamptz | default now() | |

**Auth:** Supabase Auth maneja email, contraseña y sesiones en `auth.users`. No duplicamos esos campos. El registro pide: email, contraseña, username, display_name. Un database trigger crea el profile al insertarse en `auth.users`.

### correspondences

| Campo | Tipo | Constraints | Nota |
|-------|------|-------------|------|
| id | uuid | PK, default gen_random_uuid() | |
| root_writing_id | uuid | FK → writings, unique, not null | El writing que inició esta correspondencia |
| title | text | nullable | Puede heredar del writing raíz o definirse aparte |
| created_at | timestamptz | default now() | |
| updated_at | timestamptz | default now() | Se actualiza con cada nuevo writing en el árbol |

**Nota:** Se crea automáticamente cuando un writing recibe su primera respuesta. El `root_writing_id` apunta al writing raíz. Todos los writings del árbol apuntan a esta correspondencia vía `correspondence_id`.

### writings

| Campo | Tipo | Constraints | Nota |
|-------|------|-------------|------|
| id | uuid | PK, default gen_random_uuid() | UUID generado en cliente, no en servidor |
| author_id | uuid | FK → profiles, not null | Quien escribe |
| title | text | nullable | Opcional |
| body_json | jsonb | not null, default '{}' | **Fuente de verdad.** Contenido TipTap (ProseMirror JSON). No existe `body_markdown` — el Markdown se genera on-demand desde este campo vía `tiptap-markdown` |
| body_text | text | not null, default '' | Texto plano derivado de `body_json`. Para búsqueda full-text y contexto AI. Nunca editado directamente |
| slug | text | nullable, unique por author_id | Generado del título. Usado solo en la URL pública `/{username}/{slug}`. Internamente se opera con `id` |
| status | text | not null, default 'draft' | `new`, `exploring`, `draft`, `done` |
| visibility | text | not null, default 'private' | `private`, `shared`, `public` |
| parent_id | uuid | FK → writings, nullable | El writing al que responde. Null = raíz |
| correspondence_id | uuid | FK → correspondences, nullable | La correspondencia a la que pertenece. Null si no tiene respuestas aún |
| version | integer | not null, default 1 | Incrementa en cada save. Detecta conflictos en sync local-first |
| sync_status | text | not null, default 'synced' | `synced`, `pending`, `conflict`. Estado del sync local → remoto |
| deleted_at | timestamptz | nullable | Soft delete |
| created_at | timestamptz | default now() | |
| updated_at | timestamptz | default now() | |

**Árbol de respuestas:** `parent_id` crea la jerarquía. `correspondence_id` agrupa todo el árbol bajo una identidad. Cuando alguien responde a un writing que no tiene correspondencia, se crea una automáticamente y se asigna al writing raíz y a la respuesta. Respuestas subsiguientes heredan el `correspondence_id`.

**Slug:** Se genera automáticamente del título al publicar (visibility → public o shared). Nullable — los drafts no lo necesitan. El slug es único por autor, no global. Internamente todo opera con `id`; el slug solo existe para URLs públicas.

**Edición:** Todos los estados (`new`, `exploring`, `draft`, `done`) son editables. El versionamiento se implementará a futuro para rastrear cambios post-publicación.

**Auto-save (local-first):** No hay botón de guardar. El save ocurre en dos pasos desacoplados:
1. **Local (inmediato, sin debounce):** TipTap emite `onUpdate` → se escribe `body_json` y `body_text` en la base local (SQLite/IndexedDB). El status bar muestra "Saved" — el texto ya está seguro.
2. **Remoto (background, debounce 1.5s):** El sync worker encola un PATCH a `/api/writings/[id]` con `body_json`, `body_text`, `updated_at` y `version`. Si falla, retry con backoff exponencial — silencioso para el usuario.

La UI nunca espera a Supabase. El indicador de guardado es mínimo (statusbar, sin animaciones agresivas). La experiencia debe sentirse como escribir en papel.

### collections

| Campo | Tipo | Constraints | Nota |
|-------|------|-------------|------|
| id | uuid | PK, default gen_random_uuid() | |
| owner_id | uuid | FK → profiles, not null | Quien creó la collection |
| name | text | not null | |
| description | text | nullable | |
| visibility | text | not null, default 'private' | `private`, `public` |
| created_at | timestamptz | default now() | |
| updated_at | timestamptz | default now() | |

**Nota:** Las collections son creadas por el usuario para organizar sus propios writings. Son su estructura personal. Una collection `public` es visible en el espacio público del usuario.

### writing_collections

| Campo | Tipo | Constraints | Nota |
|-------|------|-------------|------|
| writing_id | uuid | FK → writings, not null | |
| collection_id | uuid | FK → collections, not null | |
| | | PK (writing_id, collection_id) | Compuesta |
| added_at | timestamptz | default now() | |

### writing_shares

| Campo | Tipo | Constraints | Nota |
|-------|------|-------------|------|
| id | uuid | PK, default gen_random_uuid() | |
| writing_id | uuid | FK → writings, not null | |
| shared_with_id | uuid | FK → profiles, not null | |
| can_respond | boolean | default true | Si puede responder |
| created_at | timestamptz | default now() | |
| | | unique (writing_id, shared_with_id) | Sin duplicados |

**Nota:** Solo relevante cuando `writings.visibility = 'shared'`. Define quién puede ver (y opcionalmente responder) el writing además del autor.

### ai_observations

| Campo | Tipo | Constraints | Nota |
|-------|------|-------------|------|
| id | uuid | PK, default gen_random_uuid() | |
| writing_id | uuid | FK → writings, not null | |
| observation | text | not null | Lo que el agente señaló |
| paragraph_index | int | not null | Posición del párrafo |
| status | text | not null, default 'active' | `active`, `dismissed`, `addressed` |
| created_at | timestamptz | default now() | |

### correction_blocks

Persistencia de correcciones mecánicas por bloque. Supabase es la fuente de verdad; IndexedDB actúa como cache local de tránsito.

| Campo | Tipo | Constraints | Nota |
|-------|------|-------------|------|
| id | text | PK | `auto-correction:writingId:blockHash` |
| writing_id | uuid | FK → writings, not null | Writing dueño del bloque corregido |
| block_id | text | not null | Identificador opaco del bloque en el editor |
| block_hash | text | not null | Hash del texto del bloque |
| suggestions | jsonb | not null | Array de sugerencias persistidas para ese bloque |
| model | text | not null | Modelo que generó la corrección |
| created_at | timestamptz | default now() | Momento de la corrección persistida |
| latency_ms | integer | nullable | Latencia de la request al proveedor AI |
| prompt_tokens | integer | nullable | Tokens de prompt consumidos |
| completion_tokens | integer | nullable | Tokens de completion consumidos |
| | | unique (writing_id, block_hash) | Un snapshot persistido por hash dentro del writing |

**Índices:** índice en `writing_id` para hidratación rápida por writing.

### margins

Índice materializado de anotaciones embebidas en `writings.body_json`. La fuente de verdad vive en nodos TipTap `annotationReference`; esta tabla existe para listar, filtrar y compartir anotaciones sin reparsear el documento completo en cada request.

| Campo | Tipo | Constraints | Nota |
|-------|------|-------------|------|
| id | uuid | PK | Mismo UUID estable que el nodo `annotationReference` en `body_json` |
| reader_id | uuid | FK → profiles, not null | Usuario que mantiene este índice materializado |
| writing_id | uuid | FK → writings, not null | Writing anotado |
| anchor_start | integer | not null | Offset de inicio del highlight en el texto renderizado |
| anchor_end | integer | not null | Offset de fin del highlight en el texto renderizado |
| anchor_text | text | not null | Copia del pasaje resaltado |
| type | text | not null, check in (`personal`, `ai`, `collaborative`) | Footnotes no se materializan en `margins` |
| text | text | not null | Contenido de la anotación |
| note | text | nullable | Alias legacy mantenido durante la transición; replica `text` |
| shared | boolean | not null, default false | Si el lector comparte la anotación con el autor |
| shared_at | timestamptz | nullable | Cuándo se compartió |
| archived | boolean | not null, default false | Metadata reservada para colaboración futura |
| resolved | boolean | not null, default false | Metadata reservada para colaboración futura |
| created_at | timestamptz | default now() | |
| updated_at | timestamptz | default now() | |

**Regla de sincronización:** cada save del writing vuelve a extraer nodos `annotationReference` desde `body_json`, hace upsert por `id` en `margins` y elimina las filas cuyo `id` ya no existe en el documento.

**Privados por defecto:** `shared = false` hasta que el lector decida compartirlos con el autor. Compartir márgenes sigue siendo un gesto explícito.

### invitations

| Campo | Tipo | Constraints | Nota |
|-------|------|-------------|------|
| id | uuid | PK, default gen_random_uuid() | |
| inviter_id | uuid | FK → profiles, not null | |
| email | text | not null | Email del invitado |
| writing_id | uuid | FK → writings, nullable | La carta-invitación si existe |
| token | text | unique, not null | Para el link de invitación |
| status | text | not null, default 'pending' | `pending`, `accepted`, `expired` |
| created_at | timestamptz | default now() | |
| accepted_at | timestamptz | nullable | |

---

## Supabase Auth — Integración

### Registro
1. Usuario se registra con email + contraseña vía Supabase Auth.
2. Database trigger `on_auth_user_created` inserta fila en `profiles` con el mismo `id`.
3. Username y display_name se capturan en el formulario de registro y se pasan como metadata al trigger.

### Login
Supabase Auth maneja sesiones. El cliente usa `supabase.auth.signInWithPassword()`.

### Sesión
El `id` del usuario autenticado (`auth.uid()`) se usa en todas las RLS policies para controlar acceso.

---

## RLS — Directrices

| Tabla | Select | Insert | Update | Delete |
|-------|--------|--------|--------|--------|
| profiles | username, display_name, bio: público. Resto: solo propio (`auth.uid() = id`) | Vía trigger | Solo propio | No permitido |
| correspondences | Visible para todos los participantes (autores de writings en la correspondencia) | Automático vía trigger | Solo updated_at vía trigger | No permitido |
| writings | `private`: solo author. `shared`: author + en writing_shares. `public`: todos | Solo autenticados (`author_id = auth.uid()`) | Solo author | Solo author, solo draft |
| collections | `private`: solo owner. `public`: todos | Solo autenticados (`owner_id = auth.uid()`) | Solo owner | Solo owner |
| writing_collections | Hereda visibilidad del writing y collection | Solo owner de la collection | No (borrar y recrear) | Solo owner |
| writing_shares | Author del writing + shared_with_id | Solo author del writing | Solo author del writing | Solo author del writing |
| ai_observations | Solo author del writing | Solo vía API (server-side) | Solo status (dismiss/address) | No permitido |
| correction_blocks | Solo author del writing | Solo author del writing | Solo author del writing | Solo author del writing |
| margins | reader_id = auth.uid() (propios) + shared=true para el author del writing | Solo autenticados (`reader_id = auth.uid()`) | Solo reader_id (cambiar `note`, `shared`) | Solo reader_id |
| invitations | Solo inviter | Solo autenticados | Solo status (accept) | No permitido |

---

## Índices

- `profiles.username` — unique, lookup por URL
- `writings.author_id` — Mis writings
- `writings.parent_id` — Respuestas a un writing
- `writings.correspondence_id` — Writings de una correspondencia
- `writings.visibility` — Filtro por visibilidad
- `writing_collections.collection_id` — Writings de una collection
- `writing_shares.shared_with_id` — Writings compartidos conmigo
- `correction_blocks.writing_id` — Hidratación de correcciones persistidas por writing
- `invitations.token` — Lookup por token
- `invitations.email` — Invitaciones pendientes al registrarse
- `invitations(inviter_id, writing_id, email)` parcial (`status='pending'` + `ux-eval` marker) — Garantiza un único link de preview UX activo por writing
- `margins.writing_id` — Márgenes de un writing
- `margins.reader_id` — Márgenes propios del lector
- `writings.sync_status` — Queue de sync pendiente
- `writings.slug` — Lookup por URL pública (parcial, filtrado por author_id)
