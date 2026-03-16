# ODESSAY — Editor

**Documento de referencia para agentes de desarrollo.**
Lee `odessay-fundacional.md` para la visión, `odessay-stack.md` para el stack, `odessay-ai-editor.md` para el agente AI, y `skill-design.md` para el sistema visual.

Este documento define el comportamiento técnico y de UX del editor de Odessay. Es el componente más crítico del producto — donde ocurre todo.

---

## Modelo de edición: Rich Text con paridad Markdown

Odessay usa Rich Text como formato principal. El usuario nunca lee ni escribe Markdown crudo para componer — la experiencia es visual, directa, sin fricción.

Sin embargo, el editor rico está deliberadamente restringido al subconjunto de formato que Markdown puede representar sin pérdida. Esto no es una limitación técnica sino una decisión de diseño: una carta no necesita 47 opciones de formato.

### Subconjunto de formato soportado

✓ Negrita, itálica, enlace, listas ordenadas y no ordenadas, blockquotes, encabezados (H1/H2/H3), bloques de código.

✗ Colores de texto, tamaños de fuente arbitrarios, alineación, tablas complejas, subrayado, y cualquier formato que Markdown no pueda serializar fielmente.

**Por qué no subrayado:** Markdown estándar no tiene subrayado. Incluirlo rompería la conversión bidireccional. La cursiva es el equivalente epistolar correcto.

### Fuente de verdad y conversión

La fuente de verdad interna es siempre el JSON del editor (modelo ProseMirror/TipTap). Markdown es un formato de entrada y salida — nunca el modelo que se persiste.

```
Markdown entrante → parsea a JSON → el usuario edita en modo rico → JSON se serializa a Markdown cuando se necesita
```

El usuario puede cambiar al modo "source" (Markdown crudo) para editar directamente. Al volver a modo rico, el Markdown se re-parsea a JSON. Como el formato rico está limitado al subconjunto Markdown, no hay pérdida en ninguna dirección del ciclo.

### Markdown que excede el subconjunto

Si se importa Markdown con features no soportadas (HTML inline, footnotes extendidos, definiciones de referencia), el parser las trata como texto plano — no se pierden, no se corrompen, simplemente no se renderizan como formato rico. Esto se controla directamente desde las extensiones de TipTap cargadas: lo que no tiene extensión, no se interpreta.

### Stack de conversión

`tiptap-markdown` maneja la serialización y el parseo del round-trip. La conversión es confiable dentro del subconjunto definido. No implementar conversión propia — usar exclusivamente este paquete.

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

**Extensiones excluidas intencionalmente:** `Underline` (Markdown no lo soporta — rompería el round-trip), `Strike` (excluido del subconjunto epistolar), `Table` (Markdown no lo serializa fielmente). No agregar sin revisar paridad con el subconjunto definido.

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
| Enlace | `⌘K` | `Ctrl+K` |

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

## Auto-save

El editor guarda automáticamente. No hay botón de guardar. La experiencia debe sentirse como escribir en papel.

### Mecanismo (local-first)

El auto-save es en dos pasos. La UI siempre refleja el estado local — nunca espera a Supabase.

**Paso 1 — Local (inmediato, sin debounce):**
1. TipTap emite `onUpdate` en cada cambio.
2. Se escribe `body_json` y `body_text` directamente en la base local (SQLite/IndexedDB).
3. El status bar muestra "Saved" — el texto ya está seguro.

**Paso 2 — Remoto (background, con debounce):**
1. Después de 1.5 segundos sin actividad, el sync worker encola la mutación.
2. Se hace PATCH a `/api/writings/[id]` con `body_json`, `body_text`, `updated_at` y `version`.
3. Si falla: retry con backoff exponencial, silencioso. El status bar no interrumpe al usuario.

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
- Visibilidad: Private / Public (pills)
- Compartir con: input de username + botón añadir
- Colección: pills con las colecciones existentes
- Info: fecha creación, última modificación, palabras, respuestas

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
