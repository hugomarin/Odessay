# ODESSAY — ProseMirror / TipTap Backbone

**Documento técnico de referencia para agentes de desarrollo.**
Lee `workflow/context/features/odessay-editor.md` y `workflow/context/features/odessay-sync.md` junto con este documento antes de tocar el editor.

Este documento describe el backbone actual de ProseMirror/TipTap y su integración en el runtime web.

> **En contrato documental canónico, prevalece `workflow/context/core/odessay-adr-identidad.md` (ADR):** `body_json`/ProseMirror JSON es **copia de trabajo**, no la verdad persistida (D1). El round-trip `.md ⇄ body_json` debe ser lossless, incluido el `id` estable de las anotaciones (D3).

Para decisiones sobre contrato documental canónico y arquitectura multi-runtime, usar además:

- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`

---

## Objetivo

Documentar de forma explícita:

1. Qué extensiones de TipTap/ProseMirror usamos hoy.
2. Cómo se integran en Odessay.
3. Cómo funciona nuestro backbone Markdown (no nativo de ProseMirror).
4. Guardrails para evitar regresiones de round-trip y decorations.

---

## Fuente de verdad del editor

**Regla de lectura:** esta sección distingue estado vivo de edición, persistencia remota web actual e interoperabilidad documental. No debe leerse como una afirmación universal de que `body_json` gobierna todos los runtimes del producto.

- En runtime de edición: `EditorState` de ProseMirror.
- En persistencia web/cloud actual: `body_json` (documento completo, no por bloques).
- En interoperabilidad humana/export/import y dirección desktop: Markdown materializado, con convergencia futura a `.md` como contrato documental compartido.

Contrato:
- ProseMirror es el motor de edición.
- Markdown no es el estado vivo del editor.
- La relación exacta entre `body_json`, Markdown y persistencia depende del runtime y está gobernada por la secuencia desktop, no solo por este documento.

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
- `AnnotationHighlight` (extiende Highlight y conserva `data-annotation-type`)
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
- `CorrectionTriggerExtension` (`lib/editor/correction-trigger-plugin.ts`) — expone bloques del documento para correcciones AI; ya no encola automáticamente, `useManualCorrections` lo consulta bajo demanda
- `PublicationSuggestionExtension` (`lib/editor/publication-suggestion-extension.ts`)
- `AnnotationReferenceNode` (`lib/editor/footnote-node.ts`) — antes `FootnoteReferenceNode`; el schema acepta ambos nombres de nodo por compatibilidad
- `FootnoteExtension` (`lib/editor/footnote-extension.ts`)
- `FrontmatterNode` (`lib/editor/frontmatter-node.ts`)
- `TableOfContents` (opcional, solo si el shell pasa `onTableOfContentsUpdate`)

---

## Implementación custom relevante

## 1) Footnotes

Archivos:
- `lib/editor/footnote-node.ts`
- `lib/editor/footnote-extension.ts`

Diseño:
- Node inline atómico (`annotationReference`, antes `footnoteReference` — el código acepta ambos nombres) con attrs `{ id, type, index, text }`; `type` cubre `footnote | personal | ai | highlight`.
- NodeView renderiza `<sup>` clickable y emite evento `footnote:click`.
- Serialización markdown inline: `[^n|id: nota]`, `[@n|id: nota]`, `[@pn|id: nota]` o `[@hn|id: nota]` según tipo.
- `]` y `\` dentro de la nota se serializan como `\]` y `\\`; el primer `]` no escapado cierra el marcador.
- Una selección multibloque conserva varios fragments de mark y un único `annotationReference`; el panel Notes enumera el reference, no los fragments.

Regla:
- Las definiciones legacy no viven como bloque visible de ProseMirror; al guardar/exportar se normalizan al marcador inline canónico.
- En tablas, el reference se mantiene en la misma celda que el último fragmento seleccionado y antes del delimitador `|`.

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
- Las decorations existentes se mapean incrementalmente por `tr.mapping` en cada transacción; el recálculo completo ocurre solo al recibir una nueva lista por `setMeta`.
- ODE-143 agregó mini-bubbles inline, pero la QA real mostró que no deben estar siempre desplegadas. El estado esperado es: texto subrayado/decorado por defecto; bubble/popover solo al click/focus de la decoración.
- Las decorations no deben depender de que el panel lateral `Ready to publish` esté abierto. Cerrar el panel puede ocultar la lista de sugerencias, pero si el modo de corrección sigue activo, los marks inline deben permanecer visibles.
- Aceptar/rechazar desde bubble o panel debe actualizar solo esa sugerencia y preservar el resto. No debe recrear ids visibles ni reanalizar automáticamente.
- Cada suggestion necesita key estable por `correction_fingerprint`/`blockId`/rango. Evitar ids derivados solo de índice (`spelling-1`) porque React puede renderizar listas duplicadas y producir warnings de keys repetidas.

Implicación:
- Funciona para casos básicos, pero es frágil con texto repetido, streaming concurrido, cierre del panel y acciones Accept/Reject si no se separan estado de decorations y estado de panel.
- Cuando una sugerencia usa `blockId` con posición de bloque, el mapper de decorations/rangos debe traducir offsets locales del bloque a posiciones del documento con el content offset interno del nodo (`blockPos + 1`). Aplicar un replacement con `blockPos` crudo desplaza el rango una posición a la izquierda y puede consumir espacios o duplicar caracteres adyacentes.
- El path de Accept debe revalidar el texto actual del documento en el rango resuelto antes de mutar; si ya no coincide con `original_text`, la sugerencia no se aplica.

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
- UI default: decoration visible, controls ocultos. Mostrar controls solo en click/focus/hover intencional y cerrar al aceptar, rechazar, Escape o blur seguro.
- Las decorations deben poder existir en el editor aunque el panel lateral esté cerrado, siempre que el usuario no haya desactivado el modo de corrección.
- Los widgets inline no deben cambiar el layout de párrafos largos de forma permanente ni romper typing/selection/undo.

## D. Persistencia

- En runtime web actual, `body_json` sigue siendo la persistencia remota principal del editor rico.
- En dirección desktop, `.md` es el contrato documental canónico y `body_json` debe tratarse como representación rica/derivada o persistencia transitoria según el adapter.
- Markdown y representación rica no deben competir como dos verdades independientes; su relación debe estar explícitamente definida por runtime.

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
## Imágenes locales y respaldo online en desktop

El nodo `image` conserva siempre en `src` la referencia canónica escrita en el
Markdown. En desktop, una ruta relativa, absoluta o `file://` se resuelve contra
el `.md` materializado y se presenta mediante un object URL temporal; ese URL de
presentación nunca se serializa.

El respaldo online es una transición explícita y de un solo owner:

1. leer y validar los bytes locales;
2. crear el asset cloud;
3. reemplazar temporalmente el `src` por la referencia durable
   `{NEXT_PUBLIC_APP_URL}/api/writing-assets/{assetId}`;
4. esperar el guardado atómico del `.md`;
5. confirmar éxito solo cuando el archivo local quedó persistido.

Si el nodo cambió o el guardado falla, el editor restaura la ruta local y muestra
un error recuperable. Los signed URLs de Storage son efímeros y se resuelven al
renderizar; nunca se guardan como contenido canónico.
