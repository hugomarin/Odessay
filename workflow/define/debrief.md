# Odessay — Debrief

Registro de observaciones post-entrega organizadas por fase. Se alimenta con `/wf-debrief` después de cada issue mergeado. Las entradas aprobadas por el humano se convierten en issues en Linear (bug, mejora, ux-friction, deuda-tecnica).

**Política:** la entrega se acepta como está. Este archivo no reabre issues cerrados — captura lo que quedó pendiente para el siguiente ciclo de planificación.

**Formato de entrada:**
```
- ID | tipo | descripción | prioridad | linear-issue (si fue creado)
```
Tipos: `bug` / `mejora` / `ux-friction` / `deuda-tecnica`
Prioridades: `next-sprint` / `backlog` / `won't-do`

---

## Fase 0 — Cimientos

_(sin entradas aún)_

---

## Fase 1 — Escribir

- IMP-2026-03-19-01 | mejora | Editor + Sidebar visual parity polish | next-sprint | pendiente
  - **Scope**:
    - Iconografía exacta en sidebar/editor (PanelLeftClose, LibraryBig, Mails, FileText, etc.).
    - Eliminar item del sidebar con `aria-label="Continue writing"`.
    - `editor-statusbar` flotante y oculto en focus mode.
    - `editor-panel-notes` y `editor-panel-properties` flotantes, altura completa de viewport, proporcionales.
    - Mover switch `Rich/Markdown` de topbar a statusbar.
    - Título centrado respecto a pantalla, más pequeño, como referencia. Eliminar `textarea` de título en el cuerpo del editor.
    - Auto-title: primeros 48 caracteres + fallback `Untitled — {YYYY-MM-DD}`.
    - En modo Markdown, el textarea ocupa mismo espacio útil que Rich.
  - **Visuals**: `workflow/context/reference/improvements/editor-polish-*`

---

## Fase 2 — Compartir y leer

_(sin entradas aún)_

---

## Fase 3 — Corresponder

_(sin entradas aún)_

---

## Fase 4 — Organizar

_(sin entradas aún)_

---

## Fase 5 — Invitar

_(sin entradas aún)_

---

## Fase 6 — AI Editor

_(sin entradas aún)_

---

## Fase 7 — Desktop

_(sin entradas aún)_
