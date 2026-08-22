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

- IMP-2026-05-12-01 | bug | Export PDF/DOCX produces weak document styling and DOCX tables are not rendered as tables; table content degrades into pipe/list-like text instead of a formatted grid. Improve exported document styles for headings, body, spacing, code/inline marks, and especially table rendering with visible rows, columns, headers, padding, and borders. | next-sprint | ODE-134
  - **Visuals**: `/Users/hugomarin/Desktop/Screenshot 2026-05-12 at 9.16.35 a.m..png`, `/Users/hugomarin/Desktop/Screenshot 2026-05-12 at 9.16.49 a.m..png`

---

## Fase 3 — Corresponder

- IMP-2026-04-23-01 | ux-friction | Editor tab bar lacks clear tab hierarchy: active tab is hard to identify, contrast against the rail is too flat, hover applies to text instead of the full tab, tabs can overgrow the available width, `Saving...` adds noise, and the `+` action feels detached from the tab group. Direction validated in mockup: warm active surface instead of pure white, sans serif for tabs, explicit max width, full-tab hover, `+` aligned to the tab cluster, and reevaluate whether any dirty indicator is necessary. | next-sprint | ODE-110
  - **Reference**: `workflow/context/reference/improvements/editor-tabs-odyssey-mockup.html`
  - **Origin**: follow-up debrief for `ODE-109`

- IMP-2026-04-24-01 | bug | ODE-113 introdujo corrupción del session store: `pendingTabTitle` se inyectó en `displayTitle`, que es dependencia del efecto `publishTabState`. Al cambiar de tab, `displayTitle` cambia inmediatamente (con el título de la nueva tab) pero `routeWritingId` sigue apuntando a la escritura anterior (RSC aún en vuelo). `publishTabState` encuentra el tab anterior por `routeWritingId` y lo sobreescribe con los datos del nuevo → dos entries con el mismo `writing_id` en el store → tabs duplicados. Corregido por revert de ODE-113. | next-sprint | pendiente

- IMP-2026-04-24-02 | ux-friction | Fix correcto al parpadeo de título durante cambio de tabs (objetivo original de ODE-113, no logrado): la causa raíz es que `publishTabState` se dispara con `displayTitle` derivado del `bodyText`/`createdAt` de la escritura anterior mientras `currentWritingId` ya avanzó a la nueva. Fix mínimo: no publicar `title` en `publishTabState` mientras `hydrationWritingId !== null` (hidratación en curso), o usar el estado `title` raw en lugar de `displayTitle` (el raw solo cambia tras completar la hidratación). | next-sprint | ODE-114

- IMP-2026-05-12-02 | mejora | Desk writing list needs a stronger management surface: refine filters/table layout, expose useful text previews, support grouping/selection workflows, and make status changes possible directly from the list so the author does not need to open a writing just to move it from Draft to Exploring. | next-sprint | ODE-135

- IMP-2026-05-12-03 | mejora | Writing titles are not directly editable from the current workflow. Add title editing from the editor tab/title surface and from the Desk list, plus AI title suggestions after enough content exists and on demand when editing a title. | next-sprint | ODE-136

- IMP-2026-05-12-04 | ux-friction | Editor toolbar needs a structure and shortcut pass: group related tools, reduce clutter, and re-audit shortcuts against the shortcut table so commands do not conflict with browser/system shortcuts and remain discoverable. | next-sprint | ODE-137
  - **Visuals**: `/Users/hugomarin/Desktop/Screenshot 2026-05-12 at 9.16.35 a.m..png`

- IMP-2026-05-12-05 | mejora | Import `.md` and `.txt` documents as new writings. Import should create a new writing instead of inserting into the current document, preserve basic Markdown structure, and land in a stable saved/syncable state. | next-sprint | ODE-138

- IMP-2026-05-12-06 | bug | Closing the last editor tab leaves an inconsistent state: the tab closes but the previous writing content can remain visible. The empty editor state should not show stale text; it should either show a clear empty message/action or create/open a valid new writing. | next-sprint | ODE-139
  - **Visuals**: `/Users/hugomarin/Desktop/Screenshot 2026-05-12 at 9.11.21 a.m..png`

- IMP-2026-05-12-07 | bug | Creating a new writing and leaving it empty can leave the editor in a limbo state with `Saving...` / `Writing not found`. Define the empty-new-writing lifecycle so a newly created blank writing is either intentionally local-only/unsaved or persisted with a clear server-confirmed state, without false not-found errors. | next-sprint | ODE-140
  - **Visuals**: `/Users/hugomarin/Desktop/Screenshot 2026-05-12 at 9.11.21 a.m..png`

---

## Fase 4 — Organizar

- IMP-2026-04-23-02 | ux-friction | Collections navigation and interaction model redesign: current implementation has multiple creation entry points with inconsistent behavior, sidebar nesting that conflicts with the label/tag mental model, full document text shown inside collection cards, double-action on sidebar click (opens panel AND navigates), and a broken "Create" button. Design decision: collections are labels (a writing can belong to many), not folders. Direction validated in HTML prototype: Option B — single Collections entry point in sidebar leading to a dedicated /collections page. | next-sprint | ODE-111
  - **Reference**: `/tmp/odessay-collections-v2.html`
  - **Origin**: product design session 2026-04-23

- IMP-2026-05-12-08 | ux-friction | Collection chips in the editor Properties panel are visually disconnected from the Add to collections control: existing chips appear on the left while the add action sits on the right. Align assigned collection chips with the add control on the right and add an explicit `X` remove action per chip. | next-sprint | ODE-141

---

## Fase 5 — Invitar

_(sin entradas aún)_

---

## Fase 6 — AI Editor

- IMP-2026-05-12-09 | mejora | AI writing corrections are working but too limited to behave like a reliable autocorrect/editor. Improve the correction prompt, constrain scope, improve language detection, preserve memory/context of prior corrections, and make correction generation stream instead of waiting for a full response. | next-sprint | ODE-142

- IMP-2026-05-12-10 | mejora | AI correction decorations should be interactive suggestions. Show clear text-level decorations for proposed corrections and let the author accept or reject each correction instead of applying opaque changes. | next-sprint | ODE-143

- IMP-2026-05-15-01 | bug/mejora | QA real de ODE-143 muestra que la integración de corrections no está estable para uso de escritura: textos largos (>300 palabras) pueden truncar JSON o fallar con `AI did not return valid correction JSON after retry`; mini-bubbles aparecen siempre desplegadas en vez de abrir solo al click; cerrar `Ready to publish` borra decorations; Accept/Reject dispara reanálisis; y hay warnings de React por keys duplicadas (`spelling-1`). Dirección: estabilizar provider structured outputs/token budget/bounded block analysis, separar estado de panel vs decorations, colapsar controls por defecto, impedir reanálisis automático al aceptar/rechazar, y usar identidades estables de corrección. | next-sprint | ODE-155

---

## Fase 7 — Desktop

_(sin entradas aún)_

---

## Fase 8 — Biblioteca, Preview y Calidad de Producto

- IMP-2026-06-18-01 | deuda-tecnica | content_hash: falta el test de paridad Rust↔TS (ODE-297 P1, audit-blocking) y el re-bind por content_hash no es atómico — si falla el `retire` puede quedar `canonical_path` duplicado (ODE-306 P2); scan de pull O(N×M) (ODE-306 P3). Toca integridad de datos del re-bind, que ya está en producción. | next-sprint | ODE-311
  - **Origin**: wf-debrief Fase 8 — consolida ODE-297 + ODE-306

- IMP-2026-06-18-02 | bug | D9: divergencia de contrato de borrado web/desktop — el default "cloud scope" del delete-writing-dialog arrastra semántica desktop al web (ODE-309 P2); `DesktopDocumentService.deleteWriting` difiere de la semántica web sin contrato (ODE-309 P2); `detachLocalFile` escribe aun con `canonical_path` ya null (ODE-309 P3). | next-sprint | ODE-312
  - **Origin**: wf-debrief Fase 8 — consolida ODE-309

- IMP-2026-06-18-03 | deuda-tecnica | Identidad — endurecer política de migración: aceptar `frontmatter.id` sin validar UUID y filas cloud placeholder con body vacío (ODE-301 P2×2); parseArgs laxo y backup-restore `select *` (ODE-301 P3); sin cobertura automatizada de `--cloud` y validación de flags con valor (ODE-308 P2/P3). | backlog | ODE-313
  - **Origin**: wf-debrief Fase 8 — consolida ODE-301 + ODE-308

- IMP-2026-06-18-04 | deuda-tecnica | Docs + testability cleanup: documentar sintaxis inline canónica `|id` en odessay-anotaciones-ai.md (ODE-299 P3); unificar TooltipProvider + data-testid en document-state-badge + comentar import dinámico de localDB (ODE-307 P3); parámetro legacy ignorado en serializeDocumentFile y título vacío en buildInitialWorkspaceMarkdown (ODE-303 P3). | backlog | ODE-314
  - **Origin**: wf-debrief Fase 8 — consolida ODE-299 + ODE-307 + ODE-303

- IMP-2026-07-07-05 | deuda-tecnica | Consolidate `parseBlockPosition` logic: function exists in 4 places (lib/corrections/engine/lifecycle.ts, lib/corrections/block-invalidation.ts, lib/editor/suggestion-engine.ts, lib/editor/ai-correction-decorations.ts) with no shared test of parity. Maintenance burden and source of subtle bugs if logic needs to change. Pattern identical to ODE-344 (token-boundary consolidation). Fix: lifecycle.ts should import and reuse `parseCorrectionBlockPosition` from block-invalidation.ts (already imported). | backlog | ODE-362
  - **Origin**: wf-review-ships ODE-343-347, code-review finding #2 (non-blocking architectural debt)

---

## Fase 9 — Workspace: Filesystem y Nube

- IMP-2026-08-22-01 | bug | QA manual combinado de ODE-453/ODE-454 confirma ambos contratos técnicos en verde (same-hash y content-change sincronizan sin `bodyJson`/`bodyText`; recuperación de sesión desktop tras permisos `000` en el `.md` restaura el mismo tab/UUID hidratado), pero el statusbar del editor queda congelado en "Saving..." después de que SQLite marca la mutación `synced` y el archivo ya está persistido — liveness desacoplada del sync real, probablemente el listener/selector que deriva el estado visual del statusbar no reacciona al `CatalogChange`/mutation-status más reciente. | next-sprint | ODE-460
  - **Origin**: QA manual post-ship de ODE-453 (wf-ship), reportado por el humano tras verificar PR #400 en local.
