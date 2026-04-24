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

- IMP-2026-04-23-03 | ux-friction | Settings page redesign: implementación ignoró el spec de `vistas.md` (referencia: Claude settings) y produjo layout card-heavy con AI slop patterns. Diseño validado en mockup: nav lateral 180px plana, secciones Profile / Sign in (credential rows colapsables estilo GitHub) / Danger zone aislada, Sign out en footer de nav. | next-sprint | ODE-112
  - **Scope**:
    - `layout.tsx`: eliminar page header (h1 Lora 3.1rem + descripción + notification card). Layout `flex row`. Nav 180px con `border-right` y sin fondo. Título "Settings" Lora 17px. Nav items una línea, 14px. Sign out en footer con `border-top`. Eliminar "Flow" info box.
    - `account-form.tsx`: eliminar `SectionCard` (eyebrow uppercase + Lora title + ícono en círculo terracota). Sección **Profile**: grid 2col (display name + username), un solo Save que aparece solo en dirty state, hint de URL pública bajo el campo. Sección **Sign in**: cred-list con filas colapsables para Email y Password (expand inline al hacer clic en "Change"). Sección **Danger zone**: aislada al fondo sin card, `border-top`, botón destructive solo al hover. Inputs en ShadCN defaults (34px, rounded-8px). Eliminar radial-gradient background.
    - Lógica JS (validación, fetch handlers, dirty state) se conserva intacta.
  - **Visuals**: `/tmp/odessay-settings-redesign.html` (mockup aprobado)

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

- IMP-2026-04-23-01 | ux-friction | Editor tab bar lacks clear tab hierarchy: active tab is hard to identify, contrast against the rail is too flat, hover applies to text instead of the full tab, tabs can overgrow the available width, `Saving...` adds noise, and the `+` action feels detached from the tab group. Direction validated in mockup: warm active surface instead of pure white, sans serif for tabs, explicit max width, full-tab hover, `+` aligned to the tab cluster, and reevaluate whether any dirty indicator is necessary. | next-sprint | ODE-110
  - **Reference**: `workflow/context/reference/improvements/editor-tabs-odyssey-mockup.html`
  - **Origin**: follow-up debrief for `ODE-109`

- IMP-2026-04-24-01 | bug | ODE-113 introdujo corrupción del session store: `pendingTabTitle` se inyectó en `displayTitle`, que es dependencia del efecto `publishTabState`. Al cambiar de tab, `displayTitle` cambia inmediatamente (con el título de la nueva tab) pero `routeWritingId` sigue apuntando a la escritura anterior (RSC aún en vuelo). `publishTabState` encuentra el tab anterior por `routeWritingId` y lo sobreescribe con los datos del nuevo → dos entries con el mismo `writing_id` en el store → tabs duplicados. Corregido por revert de ODE-113. | next-sprint | pendiente

- IMP-2026-04-24-02 | ux-friction | Fix correcto al parpadeo de título durante cambio de tabs (objetivo original de ODE-113, no logrado): la causa raíz es que `publishTabState` se dispara con `displayTitle` derivado del `bodyText`/`createdAt` de la escritura anterior mientras `currentWritingId` ya avanzó a la nueva. Fix mínimo: no publicar `title` en `publishTabState` mientras `hydrationWritingId !== null` (hidratación en curso), o usar el estado `title` raw en lugar de `displayTitle` (el raw solo cambia tras completar la hidratación). | next-sprint | ODE-114

---

## Fase 4 — Organizar

- IMP-2026-04-23-02 | ux-friction | Collections navigation and interaction model redesign: current implementation has multiple creation entry points with inconsistent behavior, sidebar nesting that conflicts with the label/tag mental model, full document text shown inside collection cards, double-action on sidebar click (opens panel AND navigates), and a broken "Create" button. Design decision: collections are labels (a writing can belong to many), not folders. Direction validated in HTML prototype: Option B — single Collections entry point in sidebar leading to a dedicated /collections page. | next-sprint | ODE-111
  - **Reference**: `/tmp/odessay-collections-v2.html`
  - **Origin**: product design session 2026-04-23

---

## Fase 5 — Invitar

_(sin entradas aún)_

---

## Fase 6 — AI Editor

_(sin entradas aún)_

---

## Fase 7 — Desktop

_(sin entradas aún)_
