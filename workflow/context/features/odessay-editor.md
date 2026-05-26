# ODESSAY — Editor

**Documento de referencia para agentes de desarrollo.**
Lee `odessay-fundacional.md` para la visión, `odessay-stack.md` para el stack, `odessay-ai-editor.md` para el agente AI residente, `odessay-ai-writing-assist.md` para corrector/sugerencia de título, `odessay-prosemirror-tiptap.md` para el backbone técnico del editor, y `skill-design.md` para el sistema visual.

Este documento define el comportamiento técnico y de UX del editor de Odessay. Es el componente más crítico del producto — donde ocurre todo.

**Ámbito normativo:** este documento describe el comportamiento del editor y el runtime web actual, pero no debe leerse aislado de la estrategia desktop. Para decisiones sobre documento canónico, extracción de servicios o boundaries de runtime, usar además:

- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`

---

## Modelo de edición: Rich Text con paridad Markdown

Odessay usa Rich Text como formato principal. El usuario nunca lee ni escribe Markdown crudo para componer — la experiencia es visual, directa, sin fricción.

Sin embargo, el editor rico está deliberadamente restringido al subconjunto de formato que Markdown puede representar sin pérdida. Esto no es una limitación técnica sino una decisión de diseño: una carta no necesita 47 opciones de formato.

### Subconjunto de formato soportado

✓ Negrita, itálica, tachado, highlight, enlace, listas ordenadas y no ordenadas, blockquotes, encabezados (H1/H2/H3), bloques de código.

✗ Colores de texto, tamaños de fuente arbitrarios, alineación, tablas complejas, subrayado, y cualquier formato que Markdown no pueda serializar fielmente en el parser markdown elegido por el proyecto.

**Por qué no subrayado:** Markdown estándar no tiene subrayado. Incluirlo rompería la conversión bidireccional. La cursiva es el equivalente epistolar correcto.

### Fuente de verdad y conversión

**Runtime web actual:** la fuente de verdad interna del editor es el JSON del editor (modelo ProseMirror/TipTap). Markdown actúa como formato de entrada/salida y como modo source de edición.

**Dirección desktop / multi-runtime:** el editor no debe inferir por sí mismo el contrato documental global del producto. En desktop, el contrato canónico converge a `.md`; la representación rica del editor pasa a ser derivada de ese documento y no una fuente paralela.

```
Markdown entrante → parsea a JSON → el usuario edita en modo rico → JSON se serializa a Markdown cuando se necesita
```

El usuario puede cambiar al modo "source" (Markdown crudo) para editar directamente. Al volver a modo rico, el Markdown se re-parsea a JSON. Como el formato rico está limitado al subconjunto Markdown soportado por el parser del proyecto, no hay pérdida en ninguna dirección del ciclo.

### Markdown que excede el subconjunto

Si se importa Markdown con features no soportadas (HTML inline, footnotes extendidos, definiciones de referencia), el parser las trata como texto plano — no se pierden, no se corrompen, simplemente no se renderizan como formato rico. Esto se controla directamente desde las extensiones de TipTap cargadas: lo que no tiene extensión, no se interpreta.

### Stack de conversión

`tiptap-markdown` maneja la serialización y el parseo del round-trip. La conversión es confiable dentro del subconjunto definido. No implementar conversión propia — usar exclusivamente este paquete.

---

## Modo Markdown — vista de fuente

El toggle **Rich / Markdown** en la topbar (zona izquierda, junto a los botones de formato) permite ver y editar el Markdown crudo del writing.

### Visual

- **Fuente:** Geist Mono, mismo size que el cuerpo en modo rico (18px). Sin syntax highlighting — texto plano monocromático.
- **Color:** `--ink-1` sobre el mismo fondo del editor (sin cambio de fondo).
- **Layout:** Mismo max-width (860px) y padding (64px 56px 80px) que el modo rico. No es un panel separado ni una vista modal — ocupa exactamente el mismo espacio.
- **Scroll:** Texto fluye verticalmente. Sin números de línea. Sin wrap forzado a columna estrecha.

### Comportamiento del toggle

- El toggle es un segmented control de dos estados: **Rich** y **Markdown**. El estado activo tiene fondo `--ink-5` o equivalente (ver referencia en imagen — borde con fondo tenue).
- Al activar Markdown: el JSON del editor se serializa a Markdown con `tiptap-markdown` y se muestra en un `<textarea>` controlado.
- Al activar Rich: el contenido del textarea se pasa al parser de `tiptap-markdown` y se re-hidrata el editor TipTap. La selección y posición del cursor se pierden — comportamiento esperado y aceptable.
- El switch es instantáneo — sin animación, sin loading state.

### Botones de formato en modo Markdown

Los botones de la topbar (Bold, Italic, etc.) permanecen visibles pero con `opacity: 0.35` y `pointer-events: none`. No se ocultan — el toggle no cambia el layout de la topbar. El usuario ve que están inactivos, no que desaparecieron.

### Auto-save en modo Markdown

El auto-save continúa funcionando. En modo Markdown el guardado local ocurre en cada `onChange` del textarea con debounce de 800ms (no inmediato como en modo rico, porque el JSON no está disponible hasta el re-parse). El status bar muestra "Saving..." / "Saved" igual que en modo rico.

**Nota de implementación (runtime web actual):** Al guardar en modo Markdown, se hace un re-parse silencioso a JSON para mantener `body_json` actualizado como persistencia rica actual del runtime web. El textarea edita el Markdown — no el JSON directamente.

---

## Motor: TipTap

TipTap es el editor headless que corre sobre ProseMirror. Se usa en modo completamente headless — sin estilos ni toolbar propios. Todo el diseño y comportamiento es custom de Odessay.

### Extensiones requeridas

**Extensiones nativas de TipTap a instalar:**

| Extensión | Paquete | Propósito |
|-----------|---------|-----------|
| Document | `@tiptap/extension-document` | Nodo raíz |
| Paragraph | `@tiptap/extension-paragraph` | Párrafos |
| Text | `@tiptap/extension-text` | Nodo de texto base |
| Heading | `@tiptap/extension-heading` | H1, H2, H3 |
| Bold | `@tiptap/extension-bold` | Negrita |
| Italic | `@tiptap/extension-italic` | Cursiva |
| Strike | `@tiptap/extension-strike` | Tachado inline |
| Highlight | `@tiptap/extension-highlight` | Resaltado inline |
| Link | `@tiptap/extension-link` | Enlaces |
| Blockquote | `@tiptap/extension-blockquote` | Citas |
| BulletList | `@tiptap/extension-bullet-list` | Listas sin orden |
| OrderedList | `@tiptap/extension-ordered-list` | Listas numeradas |
| ListItem | `@tiptap/extension-list-item` | Items de lista |
| Code | `@tiptap/extension-code` | Código inline |
| CodeBlock | `@tiptap/extension-code-block` | Bloques de código |
| History | `@tiptap/extension-history` | Undo/Redo |
| Placeholder | `@tiptap/extension-placeholder` | Placeholder en título y cuerpo |
| CharacterCount | `@tiptap/extension-character-count` | Conteo de palabras para status bar |
| Markdown | `tiptap-markdown` | Serialización y parseo Markdown ↔ JSON. Fuente de verdad del round-trip. |

**Extensiones excluidas intencionalmente:** `Underline` (Markdown no lo soporta — rompería el round-trip), `Table` (Markdown no lo serializa fielmente en el parser objetivo). No agregar sin revisar paridad con el subconjunto definido.

**Extensiones custom a desarrollar:**

| Extensión | Propósito |
|-----------|---------|
| `FootnoteExtension` | Superíndices numerados con sección de notas al pie |
| `AIObservationExtension` | Renderiza observaciones del agente AI al margen del párrafo relevante |

### Configuración base

```ts
const editor = useEditor({
  extensions: [
    Document,
    Paragraph,
    Text,
    Heading.configure({ levels: [1, 2, 3] }),
    Bold,
    Italic,
    Strike,
    Highlight,
    Link.configure({ openOnClick: false, autolink: true }),
    Blockquote,
    BulletList,
    OrderedList,
    ListItem,
    Code,
    CodeBlock,
    Markdown,           // tiptap-markdown — maneja round-trip JSON ↔ Markdown
    History,
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading...'
        return ''
      }
    }),
    CharacterCount,
    FootnoteExtension,
    AIObservationExtension,
  ],
  editorProps: {
    attributes: {
      class: 'writing-body',
      spellcheck: 'false',
    },
  },
  onUpdate: ({ editor }) => {
    handleAutoSave(editor.getJSON(), editor.getText())
  },
})
```

---

## Shortcuts de teclado

El editor no muestra toolbar flotante al seleccionar texto — decisión deliberada de diseño. Los shortcuts son el mecanismo primario de formato. Todos son estándar del sistema y no requieren aprendizaje.

### Formato de texto

| Acción | Mac | Windows/Linux |
|--------|-----|---------------|
| Negrita | `⌘B` | `Ctrl+B` |
| Cursiva | `⌘I` | `Ctrl+I` |
| Tachado | `⌥⌘U` | `Alt+Ctrl+U` |
| Highlight | `⇧⌘U` | `Shift+Ctrl+U` |
| Código inline | `⌘J` | `Ctrl+J` |
| Bloque de código | `⇧⌘J` | `Shift+Ctrl+J` |
| Enlace | `⌘K` | `Ctrl+K` |
| Footnote | `⌃⌘K` | `Ctrl+Alt+K` |

### Estructura

| Acción | Mac | Windows/Linux |
|--------|-----|---------------|
| Párrafo normal | `⌘⌥0` | `Ctrl+Alt+0` |
| Título H1 | `⌘⌥1` | `Ctrl+Alt+1` |
| Título H2 | `⌘⌥2` | `Ctrl+Alt+2` |
| Título H3 | `⌘⌥3` | `Ctrl+Alt+3` |
| Cita (blockquote) | `⌘⇧B` | `Ctrl+Shift+B` |
| Lista sin orden | `⌘⇧8` | `Ctrl+Shift+8` |
| Lista numerada | `⌘⇧7` | `Ctrl+Shift+7` |

### Historial

| Acción | Mac | Windows/Linux |
|--------|-----|---------------|
| Deshacer | `⌘Z` | `Ctrl+Z` |
| Rehacer | `⌘⇧Z` | `Ctrl+Shift+Z` |

### App-level (no TipTap)

| Acción | Mac | Windows/Linux |
|--------|-----|---------------|
| Focus mode | `⌘⇧F` | `Ctrl+Shift+F` |
| Salir de focus mode | `Escape` | `Escape` |

### Markdown shortcuts (TipTap nativo)

TipTap reconoce estos patrones automáticamente al escribir:

| Escribir | Resultado |
|----------|-----------|
| `# ` + espacio | H1 |
| `## ` + espacio | H2 |
| `### ` + espacio | H3 |
| `> ` + espacio | Blockquote |
| `- ` + espacio | Lista sin orden |
| `1. ` + espacio | Lista numerada |
| `**texto**` | Negrita |
| `*texto*` | Cursiva |

---

## Modales de formato

Tres acciones abren un modal en lugar de ejecutarse directamente. El modal aparece sobre un overlay crema con blur suave (`backdrop-filter: blur(4px)`). El agente guarda la selección antes de abrir el modal y la restaura al confirmar.

### Modal de rename (topbar, título del writing)
- Campo: nombre del writing (input de una línea)
- Confirmar: actualiza `title` del writing
- Atajo de confirmación: `Enter`
- Cancelar: `Escape` o click fuera

### Modal de enlace (`⌘K`)
- Campo: texto del enlace (opcional — si hay selección, la usa)
- Campo: URL (requerido)
- Confirmar: convierte selección en enlace o inserta texto+enlace
- Cancelar: cierra sin cambios

### Modal de cita (botón Blockquote o `⌘⇧B`)
- Campo: texto de la cita (Lora italic, textarea)
- Campo: atribución — autor o fuente (opcional)
- Confirmar: inserta `<blockquote>` con `<cite>` si hay atribución
- Cancelar: cierra sin cambios

### Modal de footnote (botón Footnote)
- Campo: texto de la nota al pie (textarea)
- Confirmar: inserta superíndice `[n]` en el cursor + agrega entrada a la sección de notas al pie al final del documento
- La numeración es automática y secuencial
- Cancelar: cierra sin cambios

**Comportamiento de los modales:**
- `Escape` cierra cualquier modal abierto
- Click fuera del modal lo cierra
- Enter en campo de texto de una sola línea confirma
- La animación de entrada es `translateY(8px) scale(0.99) → translateY(0) scale(1)` en 220ms

---

## Resumen de texto (panel derecho)

El panel derecho de Properties muestra métricas de lectura/escritura en tiempo real para orientar ritmo y longitud del writing.

Métricas mínimas obligatorias:
- `Words`
- `Characters`
- `Sentences`
- `Reading time` (estimación)
- `Pages` (estimación)

Reglas de cálculo (v1):
- `Words`: conteo por separación de espacios sobre `body_text`.
- `Characters`: longitud total de `body_text` incluyendo espacios.
- `Sentences`: conteo aproximado por cierre de oración (`.`, `!`, `?`) con fallback mínimo de 0.
- `Reading time`: `words / 200`, redondeado al minuto superior, mínimo 1 min si hay texto.
- `Pages`: `words / 250`, redondeado a un decimal.

Las métricas se recalculan localmente y no bloquean el flujo de escritura.

---

## Auto-save

**Ámbito:** esta sección describe el comportamiento del editor en el runtime web actual. No redefine por sí sola el contrato documental canónico multi-runtime.

El editor guarda automáticamente. No hay botón de guardar. La experiencia debe sentirse como escribir en papel.

### Mecanismo (local-first, runtime web actual)

El auto-save es en dos pasos. La UI siempre refleja el estado local — nunca espera a Supabase.

**Paso 1 — Local (inmediato, sin debounce):**
1. TipTap emite `onUpdate` en cada cambio.
2. Se escribe `body_json` y `body_text` directamente en la base local (SQLite/IndexedDB).
3. El status bar muestra "Saved" — el texto ya está seguro.

**Paso 2 — Remoto (background, con debounce):**
1. Después de 1.5 segundos sin actividad, el sync worker encola la mutación.
2. Se hace PATCH a `/api/writings/[id]` con `body_json`, `body_text`, `updated_at` y `version`.
3. Si falla: retry con backoff exponencial, silencioso. El status bar no interrumpe al usuario.

**Nota de transición:** en desktop objetivo, el write-path principal deja de ser `body_json -> base local -> PATCH remoto` y pasa a `archivo .md local -> índice/caché derivado -> sync remoto secundario`. Ver la secuencia `odessay-desktop-*`.

### Primer guardado
Si el writing no tiene ID (es nuevo), el save local genera un UUID en el cliente. El primer sync remoto hace POST con ese UUID como ID. La URL cambia de `/write` a `/write/[id]` sin recargar (`router.replace`).

### Indicador visual
- Status bar abajo a la izquierda.
- "Saved" en `--ink-4` (casi invisible) cuando está guardado.
- "Saving..." en `--ink-3` cuando está guardando.
- Sin iconos, sin animaciones llamativas. La escritura no debe interrumpirse.

---

## Estructura del layout del editor

El editor tiene tres capas visuales que coexisten:

```
┌─────────────────────────────────────────────────────┐
│ Topbar (46px, fija)                                 │
│ [Formato] ──── [Título editable] ──── [Focus][Props]│
├─────────────────────────────────────────────────────┤
│ Writing area (flex-1, scrollable)                   │
│                                                     │
│         max-width: 860px, margin: auto              │
│         padding: 64px 56px 80px                     │
│                                                     │
│   [Título — Lora 36px/500]                         │
│                                                     │
│   [Cuerpo — Geist Sans 18px/400]                   │
│   H1: Lora 30px/500                                 │
│   H2: Lora 24px/500                                 │
│   H3: Lora 20px/500                                 │
│   Blockquote: Lora 22px/400 italic                  │
│   Footnotes: Geist Sans 13px/400                    │
│                                                     │
├─────────────────────────────────────────────────────┤
│ Status bar (fija, borde superior)                   │
│ [Saved] ──────────────────── [N words] [AI active] │
└─────────────────────────────────────────────────────┘
```

### Topbar — tres columnas

```
[Herramientas de formato] | [Título del writing] | [Focus] [Props]
```

El título del writing en la topbar es editable. Al hacer click abre un dropdown con un campo de texto. Enter confirma, Escape cancela. Refleja el mismo título que el `<textarea>` del área de escritura — son el mismo campo sincronizado.

### Properties panel

Se abre desde el icono de equalizer en la topbar. Ancho 248px, transición suave de width. Contiene:
- Estado: Draft / Done (pills)
- Visibilidad: Private (v1 obligatorio) + opciones futuras (Shared/Public) detrás de feature flag
- Compartir para testing: generación de link privado para evaluación cerrada (sin flujo completo de sharing de Fase 2)
- Colección: pills con las colecciones existentes
- Info: fecha creación, última modificación, palabras, caracteres, oraciones, tiempo de lectura, páginas estimadas, respuestas

### Notes panel (sidebar derecho)

Panel lateral derecho dedicado a notas al pie, independiente de Properties.

Comportamiento mínimo:
- Lista todas las notas en orden secuencial `[1]`, `[2]`, ...
- Muestra preview del fragmento anclado y contenido de la nota
- Permite editar nota existente
- Permite eliminar nota existente
- Acción `Add note` al final del panel
- Cerrar panel con `Escape` o botón de cierre

Regla de consistencia:
- Cualquier alta/edición/baja desde Notes panel actualiza los nodos de `FootnoteExtension` y renumera referencias en el documento cuando aplica.

### Focus mode

`⌘⇧F` activa focus mode. Oculta con `opacity: 0` y `pointer-events: none`:
- Sidebar de navegación
- Topbar
- Status bar
- Properties panel

El texto queda solo en pantalla. `Escape` para salir. La transición es `opacity 350ms cubic-bezier(0.4,0,0.15,1)`.

---

## Responsive

El área de escritura se adapta al ancho disponible:

| Ancho ventana | font-size body | font-size título | padding |
|---------------|----------------|------------------|---------|
| > 1000px | 18px | 36px | 0 56px |
| 700-1000px | 17px | 30px | 0 40px |
| < 700px | 16px / lh 1.75 | 24px | 0 24px |

Mobile no tiene editor — muestra mensaje indicando que la escritura es en desktop.

---

## Notas de implementación para el agente

El título del writing es un `<textarea>` con `autoResize` — no un input de una línea. Esto permite títulos largos que se wrappean en múltiples líneas con la misma tipografía Lora.

El `body` es un `contenteditable` gestionado por TipTap. No interactuar con el DOM directamente — usar siempre la API de TipTap (`editor.commands`, `editor.getJSON()`, etc.).

El conteo de palabras se calcula desde `editor.storage.characterCount.words()` (extensión CharacterCount). Se actualiza en cada `onUpdate`.

Las notas al pie son una sección especial al final del documento. El agente debe asegurarse de que existe exactamente una sección `.footnotes` por documento y de que los números son secuenciales y consistentes entre los superíndices y las entradas de la sección.

---

## FootnoteExtension — Spec técnica

Extensión custom de TipTap. No existe en el ecosistema oficial — se implementa desde cero como una extensión de nodo.

### Nodos ProseMirror que define

```
footnote-ref     — nodo inline, atómico. Renderiza como superíndice "[n]" en el cuerpo del writing.
footnote-section — nodo de bloque, al final del documento. Contiene los footnote-item.
footnote-item    — nodo de bloque, dentro de footnote-section. Renderiza como "n. texto de la nota".
```

`footnote-ref` y `footnote-item` comparten un atributo `id` (número entero, empieza en 1). La consistencia entre superíndices y entradas de la sección se mantiene siempre — si se elimina un `footnote-ref`, su `footnote-item` correspondiente se elimina también, y todos los números posteriores se reordenan.

### Comandos que expone

```ts
editor.commands.addFootnote(text: string)
// Inserta un footnote-ref en la posición actual del cursor.
// Crea o localiza el footnote-section al final del documento.
// Agrega un footnote-item con el texto dado.
// Asigna el número secuencial correcto a ambos nodos.

editor.commands.removeFootnote(id: number)
// Elimina el footnote-ref con ese id y su footnote-item.
// Reordena todos los ids posteriores.
```

### Serialización Markdown

`tiptap-markdown` requiere un serializer custom para estos nodos. El formato de salida es compatible con Markdown extendido (estilo Pandoc/MultiMarkdown):

```markdown
Texto del cuerpo con una nota.[^1]

[^1]: Texto de la nota al pie.
```

Al importar Markdown con `[^n]`: si `FootnoteExtension` está cargada, los parsea como `footnote-ref` y `footnote-item`. Si no está cargada, `tiptap-markdown` los trata como texto plano (comportamiento documentado en §Markdown que excede el subconjunto).

### Renderizado visual

**`footnote-ref` en el cuerpo:**
- Geist Sans 11px, `vertical-align: super`
- Color `--ink-3`
- No es un link clickeable — es texto decorativo. El número es el vínculo visual.

**`footnote-section`:**
- Separada del cuerpo por un borde `0.5px --border` de 48px de ancho (no full-width — evoca el separador tipográfico clásico de notas al pie).
- `margin-top: 48px`, `padding-top: 16px`

**`footnote-item`:**
- Geist Sans 13px, `--ink-3`, `line-height: 1.6`
- Formato: `1. Texto de la nota.`
- El número no es editable directamente — se gestiona por la extensión.

### Integración con el modal

El modal de footnote (ver §Modales de formato) llama a `editor.commands.addFootnote(text)` al confirmar. No hay interacción directa del usuario con los nodos de ProseMirror — todo pasa por el comando.

Al hacer click en un `footnote-item` existente, se abre el mismo modal prellenado con el texto actual para editar. El id no cambia — solo el texto.
