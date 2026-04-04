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

- IMP-2026-04-02-01 | mejora | Unify reading typography and content frame across writing, preview, and shared views | next-sprint | ODE-76
  - **Scope**:
    - Unificar la caja de contenido y la escala tipográfica del body en `/write`, `/preview/[token]`, `/shared/[id]`, y `/[username]/[slug]`.
    - Reutilizar la misma base visual para headings, paragraphs, blockquotes, lists, tables, links, code y highlight styles.
    - Mantener distintos los shells y la interacción de cada modo; solo la presentación del contenido debe converger.
    - Extraer un wrapper compartido si hace falta, en vez de duplicar reglas CSS por modo.
  - **Reference**: ODE-74, ODE-75

- IMP-2026-04-04-01 | bug | Editor text area flickers ~1s after paste in new writing (regression post-ODE-79) — a patch added to prevent 404 on new document creation is likely forcing a re-sync between local and server state, triggering a Tiptap re-render. The patch may not be solving the root problem and should be revisited. | next-sprint | ODE-82

- IMP-2026-04-04-02 | bug | Editor topbar: title button overlaps format toolbar icons at medium viewports. Root: w-full max-w-[460px] competes with toolbar space at smaller widths. Direction: constrain title to available space between toolbar groups; explore inline-edit pattern (edit icon + inline input) as cleaner solution. | next-sprint | ODE-83

- IMP-2026-04-04-03 | bug | Keyboard shortcuts broken or conflicting: blockquote opens Perplexity (system conflict), link and collections share the same shortcut, P/H1/H2/H3 commands not responding, no clear exit for footnote and highlight. Include Playwright test suite to validate each shortcut in isolation. | next-sprint | ODE-84

- IMP-2026-04-04-04 | ux-friction | Shortcut system redesign: unify to cmd+shift+[key] or cmd+shift+[1–6] pattern (avoid Chrome reserved combos), drop caret and option-based combos. Add global actions: new writing, focus mode, settings. Define Windows mapping (cmd→ctrl). Playwright as validation layer. | next-sprint | ODE-85

- IMP-2026-04-04-05 | mejora | Bring "anote" (annotation/note) functionality from shared view into write view. Reuse existing implementation — not a rebuild. Replace or extend current highlight with this pattern to give it more purpose. | next-sprint | ODE-86

- IMP-2026-04-04-06 | ux-friction | Format toolbar active state reflects last interaction, not current cursor position. If cursor is on H3, toolbar should highlight H3. If selection spans mixed elements or position is ambiguous, show no active state. Should track cursor/selection in real time via Tiptap editor state. | next-sprint | ODE-87

- IMP-2026-04-04-07 | mejora | Format toolbar visual weight reduction. Goal: toolbar feels invisible at rest, present on interaction. Approach: reduce icon stroke weight, lower opacity on inactive state, tighten spacing. Not a restructure — same actions, lighter presence. Depends on ODE-84 and ODE-87. | backlog | ODE-88

- IMP-2026-04-04-08 | mejora | Sidebar visual polish: (1) logo "Odessay" — switch to sans-serif, slightly larger, warm tone; (2) remove border between logo area and nav menu; (3) remove border above user avatar at bottom. | backlog | ODE-89

- IMP-2026-04-04-09 | bug | Sidebar flicker on page load: sidebar renders expanded then collapses. Should start collapsed by default — initial state should not depend on a client-side toggle that fires after render. | next-sprint | ODE-90

- IMP-2026-04-04-10 | deuda-tecnica | Hydration effect in editor-shell responds to any currentWritingId change, including ones initiated by the editor itself when creating a new writing. selfNavigatedIdRef (introduced in ODE-82) is correct but symptomatic: the "create new writing" path and hydration logic share the same effect without distinguishing origin. Direction: split into two explicit cases — load external writing (navigation from desk or external origin) vs new writing in this session (initiated by persistEditorSnapshot) — eliminating the need for the guard. | backlog | ODE-91

- IMP-2026-04-04-11 | deuda-tecnica | ODE-79 patch tolerates missing remote row when identifier is UUID-like. Works, but reveals there is no explicit readiness contract between local and server state: the editor has no clear signal of when a writing exists remotely, leading to accumulated defensive guards (ODE-79 + ODE-82). Direction: define an explicit lifecycle for new writings — local-only → syncing → server-confirmed — and have hydration and navigation logic observe it directly instead of inferring from route state. | backlog | ODE-92

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
