# ODESSAY — Correspondencias

**Feature spec para agentes de desarrollo.**
Lee `workflow/context/core/odessay-fundacional.md` para la visión epistolar y `workflow/context/core/odessay-modelo-datos.md` para el schema de `correspondences` y `writings`.

---

## Qué es una correspondencia

Una correspondencia es un árbol de writings conectados por respuestas. Se crea automáticamente cuando un writing recibe su primera respuesta. No es un chat ni un hilo de mensajes — es un intercambio de documentos de igual peso, donde cada writing merece el mismo espacio y dignidad que los demás.

No hay jerarquía entre el writing "original" y las "respuestas". Todos son writings. Todos se leen en el mismo espacio sagrado.

---

## Creación automática

Una correspondencia no se crea manualmente. Emerge:

1. El autor A escribe un writing (`visibility: shared | public`).
2. El autor B responde desde `/write?reply_to={id_writing_A}`.
3. Al guardar la respuesta, el sistema crea una entrada en `correspondences` si no existe.
4. Tanto el writing raíz (A) como la respuesta (B) reciben `correspondence_id`.
5. Respuestas subsiguientes heredan el mismo `correspondence_id`.

**Trigger en base de datos:** al insertar un writing con `parent_id`, verificar si existe `correspondence_id`. Si no existe, crear la correspondencia y asignar el ID al writing raíz y a la respuesta.

**Invariante:** un writing solo puede pertenecer a una correspondencia. Un `writing_id` no puede tener dos `correspondence_id` distintos.

---

## Árbol de writings

La estructura es un árbol, no una cadena lineal. Cualquier writing en el árbol puede recibir respuestas:

```
Writing A (raíz)
├── Writing B (responde a A)
│   └── Writing D (responde a B)
└── Writing C (responde a A)
    └── Writing E (responde a C)
```

En la Fase 3 (MVP), la vista de correspondencia muestra la secuencia lineal ordenada por fecha — el árbol completo se construye en data pero la UI muestra los writings en orden cronológico. La navegación por ramas del árbol es una feature futura.

---

## Vistas de correspondencias

### `/correspondences` — Lista

Todas las correspondencias donde el usuario participa (como autor del raíz o como autor de cualquier respuesta en el árbol). Ordenadas por última actividad.

**Layout:** topbar + área de contenido con `max-width: 860px`. Sin sidebar secundario.

**Topbar:** título "Correspondences" en Geist Sans 15px `--ink-2`.

**Tabla — una fila por correspondencia:**

| Columna | Contenido |
|---------|-----------|
| Título | Título del writing raíz. Lora 15px `--ink`. Truncado si excede el ancho. |
| Con | Avatares apilados de participantes. Máximo 3 visibles + contador "+N". |
| Writings | Número de writings en el árbol. Geist Sans 13px `--ink-3`. |
| Última actividad | Fecha relativa (Today, Yesterday, 12 Mar). Geist Sans 13px `--ink-4`. |
| Estado | Badge "Your turn" en terracota claro si hay algo sin leer. Sin badge si está al día. |

Cada fila es clickeable → navega a `/correspondences/{id}`.

**Estado vacío:** "No tienes correspondencias todavía. Cuando alguien responda a uno de tus writings, aparecerá aquí." Texto Lora italic `--ink-3`, centrado. Sin botón de acción — las correspondencias se inician desde el editor, no desde esta vista.

---

### `/correspondences/{id}` — Thread view

Vista principal del feature. La más compleja visualmente. Dos capas: la vista de secuencia (siempre visible) y la vista de lectura (se abre encima al seleccionar un writing).

#### Participants bar

Barra horizontal fija en la parte superior. Muestra:
- Avatares apilados de todos los participantes (overlap de 8px, borde `--bg` 2px)
- Nombres de los participantes separados por "·"
- Total de writings en el árbol
- Total de palabras acumuladas en todos los writings
- Desde cuándo existe la correspondencia (fecha del writing raíz)
- Badge de turno: **"Your turn"** en terracota si el último writing no es del usuario autenticado; **"Waiting"** en `--ink-4` si el último writing es suyo

#### Secuencia de mini-documentos

Lista vertical de todos los writings del árbol, ordenados cronológicamente.

Cada mini-documento muestra:
- Avatar + nombre del autor (badge "you" si es el usuario autenticado, badge "New" si no fue leído)
- Título en Lora 22px `--ink`
- Extracto de las primeras 2-3 líneas en Geist Sans 14px `--ink-3`
- Palabras + fecha en Geist Sans 12px `--ink-4`

Una línea vertical sutil (`1px`, `--muted-h`) conecta los mini-documentos de arriba a abajo. No una línea de tiempo — es un hilo visual que une los documentos como pensamiento continuo.

#### Reply prompt

Al fondo de la secuencia, siempre visible:
- Texto "Continue the correspondence with [nombre del último autor]"
- Botón "Write a response" en terracota (`--terracota`, Geist Sans 14px)
- Click → `/write?reply_to={id_del_último_writing}`

---

### Vista de lectura (dentro de `/correspondences/{id}`)

Se abre al hacer click en cualquier mini-documento. Pantalla completa. Sin sidebar. Fondo `--bg`.

**Topbar (46px):**
- Flecha ← para volver a la secuencia
- Navegación Previous / Next entre writings del hilo
- Botón "Write a response" en terracota

**Cuerpo:**
- Autor con avatar y fecha
- Título en Lora 30px `--ink`
- Cuerpo en Geist Sans 17px / line-height 1.85 `--ink-2`

**Teclado:**
- `←` / `→` navega entre writings del hilo
- `ESC` vuelve a la vista de secuencia

**Inmutabilidad:** los writings en correspondencia son de solo lectura una vez compartidos. Esta decisión protege los anclajes de los márgenes (`anchor_start`, `anchor_end` basados en offsets de `body_text`). Si el texto cambiara, los highlights quedarían anclados a posiciones incorrectas. El icono de edición no aparece en la topbar cuando el writing está en correspondencia.

Ver `workflow/context/features/odessay-margenes.md` para la spec del sistema de highlights y anotaciones disponible en esta vista.

---

## Modelo de datos (referencia)

Schema completo en `workflow/context/core/odessay-modelo-datos.md`. Las tablas relevantes:

**`correspondences`**
- `id` — UUID
- `created_at` — fecha del primer writing
- `updated_at` — se actualiza al agregar cualquier writing al árbol
- `participant_ids` — array de profile IDs (se actualiza al agregar participantes)

**`writings`** — campos relevantes para correspondencias:
- `correspondence_id` — FK a correspondences (null si no pertenece a ninguna)
- `parent_id` — FK al writing que responde (null si es el writing raíz)
- `visibility` — debe ser `shared` o `public` para ser respondible por otros
- `body_text` — texto plano extraído de body_json, fuente de verdad para anclajes de márgenes

---

## Estados del turno

| Condición | Badge |
|-----------|-------|
| El último writing en el árbol NO es del usuario autenticado | "Your turn" (terracota) |
| El último writing en el árbol SÍ es del usuario autenticado | "Waiting" (`--ink-4`) |
| El usuario no participó todavía (solo observador) | Sin badge |

---

## Escritura inmutable en correspondencia

Una vez que un writing es compartido como respuesta en una correspondencia, no puede ser editado. Razones:

1. **Integridad de márgenes:** los highlights se anclan a offsets de texto plano. Si el texto cambia, los anclajes quedan rotos.
2. **Dignidad epistolar:** una carta enviada no se corrige. La correspondencia es un registro del diálogo tal como ocurrió.

El editor muestra el writing como solo lectura si `correspondence_id` no es null y `visibility` no es `private`. El autor puede ver su propio writing pero no editarlo.

---

## Lo que este doc NO cubre

- Sistema de márgenes (highlights y anotaciones) → `workflow/context/features/odessay-margenes.md`
- Mecanismo de respuesta (`/write?reply_to`) → `workflow/context/core/odessay-flujos.md` §Leer y Responder
- Schema completo de tablas → `workflow/context/core/odessay-modelo-datos.md`
- Visibilidad compartida → `workflow/context/core/odessay-paginas.md` §/shared
