# ODESSAY — Espacio público del autor

**Feature spec para agentes de desarrollo.**
Lee `docs/core/odessay-fundacional.md` para entender la identidad epistolar, `docs/core/odessay-paginas.md` para la arquitectura de rutas, y `docs/core/odessay-modelo-datos.md` para el schema de `profiles` y `writings`.

---

## Por qué el espacio público importa

En Odessay, el espacio público de un autor es su firma en el mundo. No es un feed, no es un perfil de red social — es una vitrina epistolar: lo que el autor eligió dejar visible, sin métricas que distorsionen su significado.

No hay contadores de seguidores, vistas ni likes. Un writing público está ahí porque el autor quiso que estuviera, no para acumular engagement.

---

## `/{username}` — Espacio del autor (dual)

Una misma URL con dos visualizaciones según quién mira. La lógica de distinción ocurre en el Server Component que renderiza la ruta.

### Vista pública (visitante o no autenticado)

**Layout:** Sin sidebar de aplicación. Header mínimo con logo Odessay (link a `/`). Fondo `--bg`. Max-width 720px centrado.

**Secciones:**

**Encabezado del autor:**
- Avatar circular, 64px.
- `display_name` en Lora 22px `--ink`.
- `@username` en Geist Sans 14px `--ink-3`.
- `bio` en Geist Sans 15px `--ink-2`, hasta 280 caracteres. Si no hay bio, no se muestra el espacio vacío.

**Collections públicas (si existen):**
- Se muestran solo las collections con `visibility = 'public'`.
- Cada collection: nombre en Geist Sans 14px `--ink-2`, separador, writings count. Expandible para ver los writings de la colección directamente.
- Si no hay collections públicas, la sección no aparece.

**Writings públicos:**
- Lista de writings con `visibility = 'public'`, ordenados por `published_at` descendente.
- Cada writing: título en Lora 18px `--ink`, extracto de las primeras ~100 palabras en Geist Sans 15px `--ink-2`, fecha relativa (Geist Sans 13px `--ink-4`).
- Click en un writing → `/{username}/{slug}`.
- Si no hay writings públicos, mensaje: "Nada aquí todavía." — Lora italic `--ink-3`, centrado.

**Sin acciones de seguimiento:** No hay botón de follow, subscribe, ni ninguna forma de acción social. La visita es silenciosa.

### Vista propia (el autor autenticado viendo su propio `/{username}`)

El autor ve su espacio como lo verían otros, pero con su contenido completo visible y controles de gestión.

**Secciones adicionales respecto a la vista pública:**

**Toggle de vista:** Botón sutil en la topbar: "Como me ven" / "Todo mi contenido". Por defecto, muestra "Todo mi contenido" cuando el autor visita su propia URL.

**En modo "Todo mi contenido":**
- Se muestran todos los writings independientemente de visibilidad: `private`, `shared`, y `public`.
- Badge de visibilidad en cada writing: pill pequeño (Geist Sans 12px) con fondo `--muted` — "Private" / "Shared" / "Public".
- Badge de estado: "Draft" en `--ink-4`, "Finished" sin badge (es el estado normal).

**En modo "Como me ven":**
- Idéntico a la vista pública. El autor puede verificar exactamente cómo aparece para un visitante.

**Gestión inline:**
- Hover sobre un writing → aparece un menú de tres puntos. Opciones: editar (→ `/write/{id}`), cambiar visibilidad, eliminar.
- No hay botón de "New writing" en esta vista — esa acción vive en el editor y el sidebar.

---

## `/{username}/{slug}` — Writing público

Un writing con `visibility = 'public'`. La URL canónica del writing en el mundo.

### Layout

Pantalla completa de lectura. Sin sidebar de aplicación. Header mínimo (logo Odessay a la izquierda, botón de login/avatar a la derecha si hay sesión). Fondo `--bg`. Max-width 680px centrado.

### Contenido

- Avatar + `display_name` del autor en Geist Sans 14px `--ink-3`, con link a `/{username}`.
- Fecha de creación o publicación (la que el autor prefiera mostrar) — Geist Sans 13px `--ink-4`.
- Título en Lora 30px `--ink`.
- Cuerpo del writing en Geist Sans 17px `--ink`, line-height 1.85. Mismo renderizado que la reading view en correspondencias.
- Footnotes al fondo si existen (separador 60px, numeradas).

### Contexto de correspondencia (si aplica)

Si el writing pertenece a una correspondencia y hay writings anteriores o respuestas, se muestra navegación contextual al final del writing:

- "Parte de una correspondencia con [Nombre]" — Geist Sans 14px `--ink-3`.
- Links a writings anteriores y/o posteriores visibles del árbol (solo los que son públicos).
- El árbol completo no se expone públicamente — solo los nodos con `visibility = 'public'` son navegables desde el exterior.

### Acción de responder

- Si el lector está autenticado: botón "Responder" → `/write?reply_to={id}`. Mismo mecanismo universal que en cualquier otra parte del producto.
- Si el lector no está autenticado: el botón muestra "Responder" pero al hacer click lleva a `/login?next=/write?reply_to={id}` con mensaje contextual: "Inicia sesión para responder este writing."
- Si el writing está en `can_respond = false` en un share específico: el botón no aparece para ese usuario.

### Sin herramientas de lectura para visitantes

Un visitante externo no tiene acceso a highlights ni márgenes — esas herramientas son para usuarios autenticados. La lectura pública es limpia: solo el texto.

Un usuario autenticado que lee un writing público **ajeno** puede usar highlights y márgenes — son anotaciones privadas suyas, no comentarios al autor.

---

## Slug — generación y reglas

El `slug` es el identificador legible en la URL pública. Vive en la tabla `writings` como campo `text, nullable, unique por author_id`.

**Generación automática:** Cuando un writing pasa a `visibility = 'public'` por primera vez, el sistema genera el slug desde el título:
1. Lowercase, sin acentos (normalización Unicode → ASCII).
2. Espacios y caracteres no alfanuméricos → guion `-`.
3. Guiones múltiples → guion simple.
4. Truncado a 80 caracteres.
5. Si hay colisión con otro slug del mismo autor: se agrega sufijo `-2`, `-3`, etc.

**Persistencia:** El slug no cambia cuando el autor edita el título. Cambiar el slug manualmente (feature futura) requiere decisión explícita. Una vez publicado, la URL es estable.

**Writings sin título:** Si el writing no tiene título al publicarse, el slug se genera desde las primeras palabras del cuerpo (mismo proceso). Si el cuerpo también está vacío (edge case), el slug es el `id` corto del writing.

---

## SEO y Open Graph

Las páginas públicas deben generar metadata estática para previews en redes sociales y motores de búsqueda.

**`/{username}`:**
- `<title>`: `{display_name} — Odessay`
- `og:description`: `bio` del autor (truncado a 160 caracteres). Si no hay bio: "Escritura epistolar en Odessay."
- `og:image`: avatar del autor si existe; fallback al logo de Odessay.

**`/{username}/{slug}`:**
- `<title>`: `{título del writing} — {display_name} — Odessay`
- `og:description`: extracto de las primeras ~160 caracteres del cuerpo.
- `og:image`: fallback al avatar del autor si existe; fallback al logo de Odessay.
- `og:type`: `article`
- `og:author`: `display_name`

**Implementación:** usar el `generateMetadata` de Next.js App Router. Los datos se obtienen del Server Component — no hay fetch adicional en el cliente.

---

## Páginas de error y edge cases

**Usuario no encontrado (`/{username}`):**
- `404`. Mensaje: "Este espacio no existe." Link a la landing.

**Writing no encontrado o privado (`/{username}/{slug}`):**
- `404` para cualquier writing que no sea `visibility = 'public'`. No se distingue entre "no existe" y "es privado" — ambos devuelven el mismo 404 para no revelar la existencia de contenido privado.

**Writing sin slug (acceso por slug de writing sin campo slug):**
- No debería ocurrir: el slug se genera al publicar. Si ocurre por error de migración, devolver 404.

---

## Modelo de datos (referencia)

Schema completo en `docs/core/odessay-modelo-datos.md`.

Campos relevantes en `writings`:
- `slug` — text, nullable, unique por `author_id`. Se genera al publicar.
- `visibility` — `'private' | 'shared' | 'public'`
- `published_at` — timestamp, se llena al primer cambio a `public`

Campos relevantes en `profiles`:
- `username` — identificador de URL único
- `display_name`, `bio`, `avatar_url`

---

## Lo que este doc NO cubre

- Márgenes en la reading view → `docs/features/odessay-margenes.md`
- Correspondencias y navegación del árbol → `docs/features/odessay-correspondencias.md`
- Collections públicas (lógica de colección) → `docs/features/odessay-collections.md`
- Mecanismo de responder (reply_to, parent_id) → `docs/core/odessay-paginas.md` §Mecanismo universal de respuesta
- Configuración del perfil (`/settings`) → `docs/core/odessay-paginas.md` §/settings
