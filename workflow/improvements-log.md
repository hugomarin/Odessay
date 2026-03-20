# ODESSAY — Improvements Log

Registro vivo de mejoras no bloqueantes detectadas durante implementación y review.

## Cómo usar este documento

1. Captura primero aquí cada mejora detectada con un ID estable `IMP-YYYY-MM-DD-NN`.
2. Cuando una mejora pase a ejecución, crea issue en Linear y enlázalo en el campo `Linear`.
3. Mantén `Status` actualizado: `Captured`, `Triaged`, `Scheduled`, `Done`, `Won't do`.
4. No borrar historial; este documento funciona como memoria operativa.

---

## IMP-2026-03-19-01 — Editor + Sidebar visual parity polish

- Date: 2026-03-19
- Area: `frontend` / `editor` / `navigation`
- Type: Non-blocking improvement
- Priority suggestion: High (phase polish)
- Status: Scheduled
- Linear: Pending (to be created later)

### Scope

1. Iconografía exacta en sidebar/editor:
   - Sidebar expanded toggle: `PanelLeftClose`
   - Sidebar collapsed toggle: `PanelLeftOpen`
   - Collections: `LibraryBig`
   - Correspondence: `Mails`
   - Documents: `FileText`
   - Focus: `Fullscreen`
   - Footnotes: `Superscript`
   - Link: `Link`
   - Highlighter: `Highlighter`
   - Pilcrow: `Pilcrow`
   - Quote: `MessageSquareQuote`
2. Eliminar item del sidebar con `aria-label="Continue writing"`.
3. `editor-statusbar` flotante (no pegado al fondo del contenedor).
4. `editor-panel-notes` y `editor-panel-properties` flotantes, altura completa de viewport, proporcional al layout actual.
5. Mover switch `Rich/Markdown` de topbar a statusbar y mantener estilo visual de botones del sistema.
6. Título centrado respecto a pantalla, más pequeño, como referencia.
7. Eliminar `textarea` de título en el cuerpo del editor.
   - Auto-title por contenido: primeros 48 caracteres.
   - Fallback sin contenido suficiente: `Untitled — {YYYY-MM-DD}`.
   - En futuras fases, reemplazo por generación AI.
8. En modo Markdown, el textarea debe ocupar el mismo espacio útil que Rich (sin caja reducida).

### Notes

- Confirmado por owner:
  - Auto-title: 48 chars + fallback `Untitled — {YYYY-MM-DD}`.
  - `editor-statusbar` debe ocultarse en focus mode.
  - Width de side panels: mantener proporcional al layout actual.

### Visual references

- `workflow/reference/improvements/editor-polish-rich-view.png`
- `workflow/reference/improvements/editor-polish-rich-overlay.png`
- `workflow/reference/improvements/editor-polish-markdown-size.png`
- `workflow/reference/improvements/editor-polish-toolbar-reference.png`
