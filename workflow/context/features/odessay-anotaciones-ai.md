# ODESSAY — Anotaciones expandidas: lectura, AI y síntesis

**Documento de referencia para agentes de desarrollo y diseño.**
Lee `odessay-margenes.md` antes de implementar — este documento extiende esa visión, no la reemplaza. Lee también `odessay-ai-editor.md` y `odessay-editor.md`.

Issue de implementación: ODE-169.

---

## Visión

El trabajo con AI no es solo escribir — es leer críticamente lo que la AI produce, evaluarlo, cuestionarlo, y devolver instrucciones precisas. La escritura colaborativa con AI crea un ciclo continuo:

> **leer → anotar → la AI responde → leer de nuevo → anotar de nuevo**

Las anotaciones son el puente entre ambos modos. No son herramienta de escritura ni de revisión — son herramienta de **pensamiento activo** sobre cualquier texto, propio, ajeno o generado por AI.

Este documento define cómo expandir el sistema de márgenes existente para cubrir ese ciclo completo.

---

## Principio rector

Las anotaciones son el filtro del usuario sobre el texto — no el filtro de la AI.

Cuando el usuario anota, no está corrigiendo ni editando. Está dejando constancia de su perspectiva: lo que le resonó, lo que rechaza, lo que quiere profundizar, lo que quiere que la AI atienda. Ese filtro es lo más valioso del sistema porque es irreproducible por la AI.

---

## Tipos de anotación reales

El sistema actual usa un único nodo TipTap `annotationReference` con cuatro valores reales de `type`.
`collaborative` ya no es un tipo de producto vigente; entradas legacy con prefijo `@c` se tratan como
`personal` para compatibilidad. Ese mapping ocurre explícitamente en el parser Markdown compartido y
se conserva al re-serializar como el sigil vigente `@p`.

| Tipo        | Audiencia        | Significado                                                         |
| ----------- | ---------------- | ------------------------------------------------------------------- |
| `footnote`  | Cualquier lector | Aclaración o referencia contextual                                  |
| `personal`  | El autor         | "Esto es relevante para mí" — para mi propia referencia y reflexión |
| `ai`        | La AI            | Instrucciones inline para la próxima consulta AI sobre ese pasaje   |
| `highlight` | El autor         | Pasaje marcado sin obligación de nota textual                       |

### Sobre `personal`

`personal` no significa privado ni secreto. Significa que la anotación es para el beneficio propio del autor — sus dudas, conexiones, ideas que surgieron al leer. En v1 no hay distinción de control de acceso por tipo. La distinción es semántica: define para quién es relevante la nota, no quién puede verla técnicamente.

### Anotaciones `ai`

Son el tipo más relevante para el flujo de trabajo con AI. El usuario selecciona un pasaje y escribe una instrucción directa:

> "Claude: esta frase no me convence, propón alternativas"
> "Claude: valida si esto es técnicamente correcto"
> "Claude: me gusta este tono, mantenerlo en el resto"

Estas anotaciones no modifican el texto — son instrucciones pendientes que viajan como contexto cuando el usuario decide consultarle a la AI.

### Anotaciones `highlight`

Son marcas de lectura sin texto obligatorio. Usan el mismo anclaje inline que las demás anotaciones para que el pasaje marcado viaje con el documento, pero su `text` puede estar vacío.

---

## Arquitectura de almacenamiento

> **Reconciliado con `workflow/context/core/odessay-adr-identidad.md` (D1/D3).** La fuente de verdad es el **documento canónico** (el `.md` con las anotaciones inline). `body_json` es la **copia de trabajo** del editor, no la verdad. En el runtime web el substrato persistido sigue siendo `body_json`, pero el contrato de contenido es el mismo: la representación canónica es el markdown anotado.

### Las anotaciones viven inline en el documento canónico

Todas las anotaciones viven como **notación inline dentro del documento** (`==texto==[@n|id: comentario]`): la marca Highlight (`==..==`) define el rango y el marcador lleva el comentario. No son una capa aparte ni dependen de `body_json` como verdad. Al editar, se materializan como nodos `annotationReference` en la copia de trabajo `body_json`; al guardar, se re-serializan al `.md`/`body_text`.

```
Usuario anota en reading view
              ↓
Se inserta la notación inline en el documento (copia de trabajo body_json)
              ↓
Guardar → serializa al .md canónico (+ body_text derivado)
        → upsert del payload en margins (índice en la NUBE, atado al id estable)
```

**Por qué inline y no una capa aparte:**

1. **Versionamiento**: una sola fuente de verdad (el documento). `margins` se reconstruye del documento; restaurar una versión no deja anotaciones huérfanas.
2. **Portabilidad**: la anotación viaja con el texto en el propio `.md`, sin sidecar ni metadata de sistema.
3. **Copy semantics**: las anotaciones viajan con el texto en cualquier Cmd+C — el usuario copia su writing anotado directamente a Claude sin un paso de exportación separado.

> **Contrato vigente (D3):** el `id` estable de la anotación se codifica inline en el marcador canónico (`|id`) y debe preservarse en todo round-trip `.md → body_json → .md`. `margins` se reconstruye por ese mismo `id`; si el parser o serializer lo pierde, rompe el estado de colaboración (`resolved/shared/shared_at`).

### Nodo unificado annotationReference

Un único tipo de nodo TipTap `annotationReference` cubre todos los tipos (incluyendo footnotes). Attrs:

```ts
{
  id: string; // UUID estable, generado en creación, nunca cambia
  type: "footnote" | "personal" | "ai" | "highlight";
  index: number; // índice de display, recalculado al serializar por tipo
  text: string; // contenido de la anotación
}
```

### body_text: markdown derivado

`body_text` es **derivado**, nunca fuente de verdad (la verdad es el `.md` canónico; `body_json` es la copia de trabajo de la que se recalcula en el runtime web). El markdown resultante es legible por humanos y AIs sin metadata de sistema.

### margins: índice materializado

La tabla `margins` recibe datos extraídos de `body_json` en cada save. Su `id` referencia el nodo en `body_json`:

```sql
id          uuid PRIMARY KEY  -- mismo UUID que el nodo en body_json
writing_id  uuid
author_id   uuid
type        text CHECK (type IN ('footnote', 'personal', 'ai', 'highlight'))
text        text
archived    boolean DEFAULT false
resolved    boolean DEFAULT false
created_at  timestamptz
-- futuro: mentions[], thread_id, reactions
```

`margins` puede tener metadata rica de colaboración (archivado, menciones, threads) sin contaminar el documento. Si se borra una anotación del documento, el servidor elimina el row correspondiente por `id`.

---

## Sintaxis markdown

Cada tipo de anotación tiene un sigil distinto en `body_text`:

| Tipo      | Sigil | Ejemplo     |
| --------- | ----- | ----------- |
| footnote  | `[^n  | id: texto]` | `[^1  | ann-1: Ver referencia p.42]`      |
| ai        | `[@n  | id: texto]` | `[@1  | ann-2: Claude: simplificar esto]` |
| personal  | `[@pn | id: texto]` | `[@p1 | ann-3: revisar después]`          |
| highlight | `[@hn | id: texto]` | `[@h1 | ann-4: guardar este pasaje]`      |

Patrón de anclaje sobre texto resaltado:

```md
Cuando quitas el gluten de una torta ==no solo cambias el sabor==[@1|ann-2: esta
explicación es demasiado técnica para el lector objetivo, simplificar],
cambias la física de la masa.

El resultado inevitable[^1|ann-1: Ver Bread Science, p. 42] son texturas gomosas.

==Las versiones sin gluten quedan apretadas==[@p1|ann-3: revisar si aplica también
sin azúcar — pendiente confirmar]
```

En una selección contenida en un bloque, el mark `==highlight==` y el nodo de anotación son hermanos en el párrafo TipTap. Si la selección cruza bloques, TipTap la representa como varios fragmentos de mark locales al bloque y un solo nodo de anotación al final. El serializer emite un `==...==` por fragmento y un único marcador con el mismo `id`; el parser debe reconstruir todos los fragmentos contiguos como una sola ancla semántica.

El panel de notas enumera el nodo de anotación, no sus fragmentos de mark. Una anotación multibloque produce una sola entrada. Solo un mark sin `annotationType` y sin `annotationReference` asociado puede aparecer como highlight standalone.

En tablas, el `annotationReference` pertenece a la misma celda que contiene el último fragmento seleccionado y se serializa antes del delimitador `|`. El parser repara la forma legacy desplazada `==texto== | [@…]celda siguiente` a `==texto==[@…] | celda siguiente` sin cambiar el contenido de las celdas.

El texto de una anotación escapa `]` como `\]` y una barra invertida literal como `\\`. El primer `]` no escapado cierra el marcador; cualquier link, corchete o prosa posterior permanece en el cuerpo visible del documento. El parser desescapa esos dos caracteres al reconstruir el nodo y el serializer siempre emite la forma canónica escapada.

---

## Flujo de exportación a AI

1. El usuario lee y crea anotaciones `ai` sobre los pasajes que quiere atender
2. Usa **"Copiar para AI → Texto completo"** — genera el markdown con solo las anotaciones `ai` incluidas
3. Pega ese markdown en Claude, ChatGPT, o cualquier cliente externo
4. Las anotaciones `personal` nunca aparecen en ningún formato de exportación

El markdown exportado:

```md
Cuando quitas el gluten de una torta ==no solo cambias el sabor==[@1|ann-2: esta
explicación es demasiado técnica para el lector objetivo, simplificar],
cambias la física de la masa.
```

Es legible y parseable por cualquier AI sin instrucciones especiales. El `[@n|id: instrucción]` mantiene identidad estable y sigue siendo suficientemente descriptivo como para que el modelo entienda que es una instrucción sobre el texto anterior.

### Etiquetas rápidas

En el input de anotación AI, chips preset que no requieren escribir:

- `eliminar`
- `modificar`
- `expandir`
- `valida esto`
- `simplifica`
- `mantén tono`

Son shortcuts de texto — insertan texto libre en el campo de anotación.

---

## Síntesis multi-texto

Este es el caso de uso más ambicioso a largo plazo.

### Flujo

1. El usuario crea un **proyecto de lectura** — agrupa varios writings o textos importados
2. Lee cada texto y anota los pasajes relevantes
3. Al terminar, la AI toma **todas las anotaciones del proyecto** — no los textos completos — y genera un texto unificado con los conceptos clave del usuario
4. Ese texto unificado es un writing nuevo en Odessay, propiedad del usuario

### Por qué las anotaciones y no los textos

El resumen que genera la AI está filtrado por **la perspectiva del usuario**, no por lo que la AI cree que es importante. Las anotaciones son el filtro.

Un resumen sin anotaciones es genérico. Un resumen construido sobre anotaciones del usuario es una síntesis del pensamiento de esa persona sobre ese conjunto de textos.

---

## Lectura de texto generado por AI

Cuando el texto fue generado por AI dentro de Odessay, el usuario necesita herramientas para:

- marcar lo que sí funciona (`me gusta esto`)
- marcar lo que no convence sin saber aún por qué
- dejar instrucciones precisas para la siguiente iteración
- registrar su criterio editorial aunque no lo pueda articular todavía

El ciclo de escritura colaborativa con AI no termina cuando la AI produce el texto — termina cuando el usuario ha leído, anotado y dado su veredicto.

---

## Interfaz

### Popup de selección

Al seleccionar texto en la vista de lectura, el popup muestra cuatro opciones:

- **Personal** — nota para mí
- **AI** — instrucción para la AI
- **Highlight** — marcar pasaje
- **Footnote** — referencia o aclaración

### Indicador de tipo en el margen

Cada anotación en el sidebar muestra un indicador visual:

- `personal` — tono neutro (`#999990`)
- `ai` — indigo (`#5B5BD6`)
- `highlight` — amber (`#C07B2A`)
- `footnote` — tono neutro (`#999990`)

El usuario puede cambiar el tipo desde la anotación antes de guardar.

### Color del anclaje inline

El color del subrayado/fondo se decide por marca, no por heurística de párrafo:

- El mark `highlight` que ancla una anotación puede portar `data-annotation-type`.
- `mark[data-annotation-type="ai"]` se renderiza lila (`#5B5BD6`).
- `mark[data-annotation-type="highlight"]` se renderiza ámbar (`#C07B2A`), igual que el superíndice.
- `mark[data-annotation-type="personal"]` y `mark[data-annotation-type="footnote"]` usan neutro (`#999990`).
- Marks sin `data-annotation-type` son highlights manuales y conservan el estilo default ámbar.

La sintaxis markdown canónica incluye `|id`: `==texto==[@tipo...|id: ...]`. Al parsear markdown, el rich parser re-deriva `data-annotation-type` desde el `annotationReference` que cierra el ancla. En selecciones multibloque, el tipo se aplica a cada fragmento `==...==` contiguo que precede ese único reference.

### Panel de anotaciones filtrado

Tabs de filtro: Todas / Personal / AI / Highlight / Footnote.

### "Copiar para AI"

Footer section en el sidebar cuando hay al menos una anotación `ai`. Dos acciones:

- **Anotaciones**: copia solo las AI con su texto citado
- **Texto completo**: copia el `body_text` con solo las anotaciones `ai` incluidas

---

## Alcance v1

### Sí entra

- nodo TipTap `annotationReference` unificado con `{ id, type, index, text }`
- parser y serializer para los cuatro sigils de markdown
- UI para seleccionar tipo al crear la anotación
- indicador visual por tipo en el sidebar
- tabs de filtro por tipo
- "Copiar para AI" con dos acciones (anotaciones / texto completo)
- etiquetas rápidas preset para tipo `ai`
- sync de `body_json` → `margins` en cada save
- migración de schema en `margins` (agregar `id uuid`, `type`, `archived`, `resolved`)

### No entra

- síntesis multi-texto automatizada
- proyectos de lectura como entidad propia
- envío directo a la API de Claude desde el panel (el flujo es copiar/pegar)
- colaboración en tiempo real sobre anotaciones
- control de acceso diferenciado por tipo (v1: distinción semántica, no de seguridad)
- MCP server para acceso externo

---

## Schema

### Migración margins

```sql
-- Agregar id estable (referencia al nodo en body_json)
ALTER TABLE margins ADD COLUMN id uuid DEFAULT gen_random_uuid();
UPDATE margins SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE margins ALTER COLUMN id SET NOT NULL;

-- Agregar type
ALTER TABLE margins
  ADD COLUMN type text NOT NULL DEFAULT 'personal'
    CHECK (type IN ('footnote', 'personal', 'ai', 'highlight'));

-- Agregar campos de estado para colaboración futura
ALTER TABLE margins
  ADD COLUMN archived boolean NOT NULL DEFAULT false,
  ADD COLUMN resolved boolean NOT NULL DEFAULT false;
```

### Nodo TipTap (body_json)

```ts
// annotationReference node attrs
{
  id: string; // UUID, estable, fuente de verdad de identidad
  type: "footnote" | "personal" | "ai" | "highlight";
  index: number; // solo para display en markdown
  text: string;
}
```

---

## Decisiones explícitas

1. `personal` **no implica privacidad técnica** en v1 — es una etiqueta de audiencia semántica. Control de acceso diferenciado es trabajo futuro.
2. El flujo de exportación es **copiar/pegar** en v1 — no integración directa con la API de Claude.
3. El formato de embedding en markdown usa **sigils inline** (`[@n|id: texto]`) — no comentarios HTML. Es más compacto, legible y compatible con el modelo TipTap.
4. La síntesis multi-texto no entra en v1 — el valor en v1 es el filtro de perspectiva por anotación, no la automatización del resumen.
5. Las etiquetas rápidas son shortcuts de texto, no tipos especiales — insertan texto libre en el campo de anotación.
6. **El documento canónico (`.md` anotado inline) es la fuente de verdad** (ADR D1/D3); `body_json` es la copia de trabajo y `margins` es el payload/índice en la nube, atado al `id` estable de cada anotación y reconstruible desde el documento.
7. El parser acepta el formato split antiguo de footnotes (`[^1]` + `[^1]: content` al fondo) para backwards compatibility, pero el serializer siempre emite formato inline.

---

## Criterio de éxito

La implementación es correcta si el usuario puede:

1. seleccionar un pasaje de cualquier texto,
2. crear una anotación de tipo AI con instrucción libre o desde chips,
3. al terminar la lectura, copiar el writing con las anotaciones AI embebidas en un solo gesto,
4. pegar ese markdown en Claude o ChatGPT y obtener una respuesta que atiende exactamente los pasajes anotados,
5. y también copiar el texto con Cmd+C y verificar que las anotaciones AI viajan con él.
