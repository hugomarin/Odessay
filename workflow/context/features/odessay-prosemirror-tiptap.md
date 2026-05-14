# ODESSAY — ProseMirror / TipTap Backbone

**Documento técnico de referencia para agentes de desarrollo.**
Lee `workflow/context/features/odessay-editor.md` y `workflow/context/features/odessay-sync.md` junto con este documento antes de tocar el editor.

---

## Objetivo

Documentar de forma explícita:

1. Qué extensiones de TipTap/ProseMirror usamos hoy.
2. Cómo se integran en Odessay.
3. Cómo funciona nuestro backbone Markdown (no nativo de ProseMirror).
4. Guardrails para evitar regresiones de round-trip y decorations.

---

## Fuente de verdad del editor

- En runtime de edición: `EditorState` de ProseMirror.
- En persistencia: `body_json` (documento completo, no por bloques).
- En interoperabilidad humana/export/import: Markdown materializado.

Contrato:
- ProseMirror es el motor de edición.
- Markdown es capa de entrada/salida, no el estado vivo del editor.

---

## Extensiones activas

Definidas en `lib/editor/extensions.ts` con `createEditorExtensions()`.

### Core document model
- `Document`
- `Paragraph`
- `Text`

### Marks / inline formatting
- `Bold`
- `Italic`
- `Strike`
- `Highlight`
- `Link`
- `Code` (inline)

### Block formatting
- `Heading` (levels 1..3)
- `Blockquote`
- `BulletList`
- `OrderedList`
- `ListItem`
- `CodeBlock`

### Rich content extras
- `Image` (base64 disabled, block mode)
- `Table`, `TableRow`, `TableHeader`, `TableCell` (non-resizable)

### Editor infra
- `History`
- `Placeholder`
- `CharacterCount`

### Markdown bridge
- `Markdown` from `tiptap-markdown` with:
  - `transformPastedText: true`
  - `transformCopiedText: true`
  - `breaks: true`
  - `linkify: true`

### Custom Odessay extensions
- `FindReplaceExtension` (`lib/editor/find-replace.ts`)
- `PublicationSuggestionExtension` (`lib/editor/publication-suggestion-extension.ts`)
- `FootnoteReferenceNode` (`lib/editor/footnote-node.ts`)
- `FootnoteExtension` (`lib/editor/footnote-extension.ts`)

---

## Implementación custom relevante

## 1) Footnotes

Archivos:
- `lib/editor/footnote-node.ts`
- `lib/editor/footnote-extension.ts`

Diseño:
- Node inline atómico (`footnoteReference`) con `index` y `text`.
- NodeView renderiza `<sup>` clickable y emite evento `footnote:click`.
- Serialización markdown de referencia: `[^n]`.
- Definiciones se reconstruyen al persistir (`getMarkdownWithFootnoteDefinitions`).

Regla:
- Las definiciones no viven como bloque visible de ProseMirror, se materializan en Markdown al guardar/exportar.

## 2) Find/Replace decorations

Archivo:
- `lib/editor/find-replace.ts`

Diseño:
- Plugin con `PluginKey` + estado derivado de meta de transacción.
- Decorations inline de matches.

## 3) Publication/correction decorations (estado actual)

Archivo:
- `lib/editor/publication-suggestion-extension.ts`

Estado actual:
- Recibe lista de sugerencias por `setMeta`.
- Recalcula decorations buscando texto (`original_text`) en el doc.
- No usa todavía mapping incremental robusto por `tr.mapping`.

Implicación:
- Funciona para casos básicos, pero es frágil con texto repetido y streaming concurrido.

---

## Backbone Markdown (riesgo principal)

ProseMirror no es markdown-native. En Odessay usamos un puente explícito.

Archivos:
- `lib/editor/extensions.ts`
- `lib/editor/markdown-format.ts`

Pipeline operativo:
1. Markdown externo/importado se normaliza (`normalizeMarkdownForRoundTrip`).
2. Para parseo rico, se materializa (`materializeMarkdownForRichParser`), p. ej. marks.
3. TipTap/ProseMirror edita estado JSON.
4. Markdown se obtiene por storage markdown (`getEditorMarkdown()`).
5. Footnotes se reinyectan como definiciones al persistir/exportar.

Normalizaciones actuales:
- Highlights HTML `<mark>` -> `==...==` y vuelta.
- Conversión de tablas HTML a Markdown.
- Sanitización ligera de inline semantics.
- Renumeración y consistencia de footnotes.

---

## Guardrails obligatorios

## A. Round-trip safety

- Todo cambio de extensión/serializer debe validar JSON -> Markdown -> JSON sin pérdida funcional en el subset soportado.
- No introducir formato sin contrato de serialización.

## B. Markdown compatibility

- Cualquier feature nueva debe declarar:
  - cómo se serializa a Markdown,
  - cómo parsea de Markdown,
  - qué pasa si no hay representación 1:1.

## C. Decorations stability

- Correcciones en streaming deben usar identidad estable (`correctionId`) + `blockId/hash`.
- Chunks stale deben descartarse.
- Avoid match-by-first-occurrence como mecanismo final en producción para AI corrections.

## D. Persistencia

- `body_json` sigue siendo la fuente persistida.
- Markdown es derivado y debe mantenerse consistente, no competir como fuente paralela.

---

## Checklist de cambios en editor

Antes de cerrar un issue que toque ProseMirror/TipTap:

1. ¿Se actualizó `createEditorExtensions()` si aplica?
2. ¿Se documentó serialización Markdown del cambio?
3. ¿Se validó round-trip con casos reales (listas, tablas, links, footnotes)?
4. ¿Se validó que no rompe find/replace y decorations existentes?
5. ¿Se validó typing fluido + undo/redo?

---

## Referencias directas en código

- `lib/editor/extensions.ts`
- `lib/editor/markdown-format.ts`
- `lib/editor/footnote-node.ts`
- `lib/editor/footnote-extension.ts`
- `lib/editor/find-replace.ts`
- `lib/editor/publication-suggestion-extension.ts`
