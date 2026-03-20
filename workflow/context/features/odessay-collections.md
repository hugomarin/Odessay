# ODESSAY — Collections

**Feature spec para agentes de desarrollo.**
Lee `workflow/context/core/odessay-fundacional.md` para el contexto del modo Organizar y `workflow/context/core/odessay-modelo-datos.md` para el schema de `collections` y `writing_collections`.

---

## Propósito del feature

Collections es la interfaz de organización y gestión del archivo. **No es para leer writings — es para clasificarlos.**

El problema que resuelve: los autores acumulan writings sin clasificar, especialmente al importar desde otros sistemas (iA Writer, archivos .md, .txt). Los archivos llegan con nombres técnicos ("Untitled 47", "notas-reunion-2024.txt") que no dicen nada sobre el contenido. Abrir cada archivo para saber qué es no es práctico.

Collections resuelve esto con tres mecanismos: preview sin apertura, bulk categorization, y AI como propuesta (no como acción automática).

---

## Vistas del feature

### `/collections` — Vista principal

**Layout:** sidebar + topbar + área de contenido. Sidebar expandido (292px) por defecto — esta es una vista de organización, no de escritura.

**Estructura vertical de la página:**

1. **Banner uncategorized** (siempre en la parte superior si hay writings sin clasificar)
2. **Lista de collections existentes** (expandibles)

---

### Banner uncategorized

Siempre visible mientras existan writings sin colección asignada. Nunca se puede ocultar manualmente — desaparece solo cuando todos los writings están clasificados.

**Contenido del banner:**
- Fondo `--terracota` con opacidad suave (no sólido — es una alerta, no una acción urgente)
- Texto: "N writings without a collection"
- Subtexto del AI: "Found X possible groups among your uncategorized writings." Solo aparece si el AI tiene sugerencias. Si no, solo se muestra el contador.
- Botón "Organize" → abre el panel de organización

**Panel de organización (Organize panel):**

Se abre como una sección expandida debajo del banner (no como modal ni drawer). Muestra la lista de writings sin clasificar.

Cada item en la lista:
- Título del writing (Geist Sans 14px `--ink`)
- Extracto de las primeras líneas (Geist Sans 13px `--ink-3`) — el contenido como preview, no el nombre de archivo
- Palabras + fecha (Geist Sans 12px `--ink-4`)
- Checkbox para selección individual
- **AI pill:** "→ [Collection sugerida]" si el AI tiene una sugerencia para ese writing. Click en el pill → acepta la sugerencia y mueve el writing a esa collection

**Acciones disponibles desde el panel:**
- **Click en AI pill** → acepta sugerencia individual. El writing desaparece suavemente de la lista (`opacity 0 → height 0`, 200ms).
- **Checkbox + "Add to collection"** → bulk assignment. Selector de collection existente o campo para crear una nueva.
- **"Create collection"** → crea una nueva collection y puede asignar writings seleccionados directamente.

---

### Collections expandibles

Las collections existentes aparecen como bloques colapsados debajo del banner. Cada collection es expandible con un click — no navega a otra página.

**Estado colapsado:**
- Nombre de la collection en Geist Sans 15px `--ink`
- Cantidad de writings (`--ink-3`)
- Ícono de flecha chevron

**Estado expandido:**
- Lista de writings de la collection
- Cada writing: título, extracto, estado (`draft`/`finished`), fecha
- Acciones por writing: abrir en editor, mover a otra collection, remover de la collection

**Orden de las collections:** por número de writings (mayor a menor). El autor puede reordenar manualmente en una versión futura.

---

### `/collections/{id}` — Collection específica

Vista dedicada para una collection con muchos writings. Accesible desde el sidebar (al hacer click en el nombre de la collection, el list panel se abre con sus writings — ver `workflow/context/core/odessay-flujos.md` §Navegar el editor).

Esta ruta existe para el caso en que la collection tenga demasiados writings para manejarlos cómodamente en el expandible de `/collections`. El contenido y comportamiento es idéntico al estado expandido.

---

## AI suggestions — contrato de comportamiento

El AI sugiere agrupaciones para writings sin clasificar. No categoriza automáticamente — propone, el autor decide.

**Cuándo el AI genera sugerencias:**
- Al entrar a `/collections` cuando hay writings sin clasificar
- Cada vez que se agregan nuevos writings sin clasificar
- A petición explícita del autor ("Analyze again")

**Qué lee el AI:**
- `title` de cada writing sin clasificar
- Extracto de las primeras 200 palabras de `body_text`
- Collections existentes y sus nombres (para sugerir agregar a colecciones ya creadas)

**Formato de la sugerencia (por writing):**
```json
{
  "writing_id": "uuid",
  "suggested_collection": "nombre de collection existente o nombre sugerido nuevo",
  "is_existing": true | false,
  "confidence": "high" | "medium"
}
```

**Solo se muestra si `confidence: "high"`** — sugerencias de baja confianza no generan pills en la UI para evitar ruido.

**El AI no crea collections.** Solo sugiere nombres. El autor confirma y la collection se crea en ese momento si no existe.

**Si el AI no tiene sugerencias claras:** no muestra el subtexto "Found X possible groups". Solo el banner con el contador de writings sin clasificar.

---

## Gestión de collections

### Crear una collection
- Desde el botón "New collection" en la topbar de `/collections`
- Desde el panel Organize al hacer bulk assignment
- Desde el panel Properties del editor (ver `workflow/context/features/odessay-editor.md` §Properties panel)

**Campos:** nombre (requerido, máximo 60 caracteres), visibilidad (`private` | `public`).

### Editar una collection
- Rename inline al hacer click en el nombre
- Cambiar visibilidad desde el menú de opciones de la collection

### Eliminar una collection
- Opción en el menú de la collection
- **Los writings no se eliminan** — se desvinculan de la collection y quedan sin clasificar
- Confirmación requerida: "Delete collection? N writings will become uncategorized."

### Visibilidad de collections

**Private:** solo visible para el autor en `/desk` y `/collections`. Default.

**Public:** aparece en `/{username}` como agrupación visible para visitantes. Solo muestra los writings que también son `public`. Los writings `private` o `shared` dentro de una collection pública no son visibles para visitantes.

---

## Asignación de writings a collections

Un writing puede pertenecer a múltiples collections. La asignación es una relación many-to-many via `writing_collections`.

**Desde dónde se puede asignar:**
- Panel de organización en `/collections` (bulk o individual)
- Panel Properties en el editor (`/write/{id}`)
- Menú contextual en la tabla del Desk

**Sin colección asignada:** el writing queda "uncategorized". Aparece en el banner uncategorized de `/collections` y en la tabla del Desk sin badge de collection.

---

## Modelo de datos (referencia)

Schema completo en `workflow/context/core/odessay-modelo-datos.md`.

**`collections`**
- `id`, `owner_id`, `name`, `visibility` (`private`|`public`)
- `created_at`, `updated_at`

**`writing_collections`** (join table)
- `writing_id`, `collection_id`, `added_at`

---

## Lo que este doc NO cubre

- Panel Properties del editor (donde también se asignan collections) → `workflow/context/features/odessay-editor.md`
- Flujo de navegación por el sidebar hacia collections → `workflow/context/core/odessay-flujos.md` §Navegar el editor
- Schema completo → `workflow/context/core/odessay-modelo-datos.md`
