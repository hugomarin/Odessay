# ODESSAY — Instrucciones para agentes de código

Este repositorio contiene la documentación completa de Odessay — una plataforma de escritura epistolar. Esta documentación **es la especificación del producto**. Los agentes de código construyen Odessay leyendo estos documentos y siguiendo los skills.

---

## Estructura de documentación

```
docs/
  core/       → Verdades estables del producto. Primario en PLAN.
  features/   → Spec de cada feature. Leer solo si el issue lo toca.
workflow/     → Estado vivo y operación de agentes. Primario en PLAN.
framework/    → Framework MECE genérico. No es específico de Odessay.
.agents/skills/       → Instrucciones de implementación. On-demand por trigger.
reference/    → Prototipos HTML y screenshots. Referencia visual canónica.
```

---

## Protocolo de lectura

Este protocolo es **stage-first** y prevalece sobre cualquier interpretación previa de "always" como lectura repetida en todas las etapas.

### Paso 0 — Resolver etapa del issue (obligatorio)

1. Si el mensaje incluye un comando de etapa, usarlo como override de la sesión:
   - `/wf-define` → `PLAN`
   - `/wf-build` → `BUILD`
   - `/wf-review` → `REVIEW`
2. Si no hay comando, leer la etapa desde Linear: `stage:PLAN`, `stage:BUILD` o `stage:REVIEW`.
3. Si no hay label de etapa, inferir por estado de Linear:
   - `Todo`/`Backlog` → `PLAN`
   - `In Progress` → `BUILD`
   - `In Review`/`Done` → `REVIEW`
4. Aplicar `docs.json -> stage_policies` como allowlist de lectura.

### Precedencia de etapa

1. Comando del usuario (`/wf-define`, `/wf-build`, `/wf-review`)
2. Label de etapa en Linear (`stage:*`)
3. Fallback por estado de Linear

### Paso 1 — PLAN

- Objetivo: entender problema, constraints y estrategia.
- Requerido: `linear:issue` + `registry:scope=always`.
- Permitido adicional: `trigger=planning`, `trigger=<issue-area>`, y referencias puntuales.
- Salida obligatoria: `Issue Brief` atómico (fuente para BUILD/REVIEW).

### Paso 2 — BUILD

- Objetivo: implementar.
- Requerido: `linear:issue` + Issue Brief vigente.
- Fuentes válidas de brief: `linear:issue-brief` o `workflow/issues/<issue-id>.md`.
- Permitido adicional: solo docs/skills del trigger del issue y, si aplica, `status.json`/`SETUP.md`.
- Prohibido por defecto: releer todo `scope=always` o contexto `planning`.
- Gate: si no existe Issue Brief, no se ejecuta `/wf-build` y se vuelve a `/wf-define`.

### Paso 3 — REVIEW

- Objetivo: validar calidad antes de cerrar.
- Requerido: `linear:issue` + Issue Brief vigente + `.agents/skills/skill-code-review/SKILL.md`.
- Foco: diff, evidencia de tests y checklist de calidad.
- Prohibido por defecto: rehidratar contexto completo de producto.

### Nota operativa de Linear

Si la tarea involucra crear o modificar estructura de Linear (proyectos, issues, milestones), leer `.agents/skills/skill-product-manager/SKILL.md` completo antes de tocar Linear.

---

## Mapa de documentos

### docs/core/ — Primario en PLAN

| Documento | Propósito |
|-----------|-----------|
| `odessay-fundacional.md` | Visión, por qué, para quién, principios. |
| `odessay-arquitectura.md` | Arquitectura técnica y navegación. Prevalece sobre versiones anteriores. |
| `odessay-stack.md` | Stack tecnológico confirmado y convenciones. |
| `odessay-modelo-datos.md` | Schema completo de Supabase. Trigger: backend/database. |
| `odessay-paginas.md` | Descripción de cada ruta/página. Trigger: frontend. |
| `odessay-flujos.md` | Flujos de usuario detallados (secciones 1–11). Trigger: frontend. |

### docs/features/ — Leer solo si el issue toca ese feature

| Documento | Feature | Trigger |
|-----------|---------|---------|
| `odessay-editor.md` | Editor TipTap: extensiones, shortcuts, auto-save, modales, layout. | `editor` |
| `odessay-ai-editor.md` | AI editor residente: spec completa de comportamiento. | `ai-editor` |
| `odessay-margenes.md` | Sistema de highlights y anotación en lectura. | `reading-view` |

### workflow/ — Primario en PLAN

| Documento | Propósito |
|-----------|-----------|
| `SETUP.md` | **Leer primero.** Entorno, variables, tools, permisos, Git. |
| `status.json` | **Leer segundo.** Qué está construido, qué no existe, decisiones tomadas. |
| `decisions-archive.md` | Historial de decisiones por fase (consultar en planeación o cuando se necesite contexto histórico). |
| `odessay-roadmap.md` | Fases y prioridades. Fuente de verdad del qué y el cuándo. |

### framework/ — Referencia del meta-framework

| Documento | Propósito |
|-----------|-----------|
| `framework-mece.md` | Framework MECE genérico. Explica el modelo de 10 preguntas. No específico de Odessay. |

---

## Skills — cuándo usar cada uno

| Skill | Cuándo usarlo |
|-------|---------------|
| `.agents/skills/skill-design/SKILL.md` | **Siempre antes de construir UI.** Tokens de color, tipografía, ShadCN, iconos, transiciones, reglas invariables. |
| `.agents/skills/skill-design/vistas.md` | **Companion de skill-design.** Valores exactos de padding, tamaños y comportamiento por vista + checklists de validación. Leer junto al skill principal. |
| `.agents/skills/skill-frontend/SKILL.md` | Arquitectura React, estructura de archivos, naming BEM, TipTap, Server/Client components, performance, accesibilidad. |
| `.agents/skills/skill-backend/SKILL.md` | API routes, Supabase, local-first, Codex API, Resend, manejo de errores. |
| `.agents/skills/skill-database/SKILL.md` | Supabase, RLS policies, migraciones, índices. |
| `.agents/skills/skill-code-review/SKILL.md` | **Siempre antes de abrir un PR.** Checklist completo de calidad, velocidad y seguridad. |
| `.agents/skills/skill-product-manager/SKILL.md` | Criterios de producto, creación y ejecución de issues. |
| `.agents/skills/skill-ux-testing/SKILL.md` | Testing de UX, flujos E2E con Playwright. |

---

## Prototipos visuales de referencia

La carpeta `reference/` contiene los prototipos HTML interactivos y sus screenshots. Son la fuente visual más fiable para entender layout, comportamiento y valores de componentes.

**Regla general:** Cuando hay conflicto entre un prototipo y un documento de texto, el documento de texto prevalece. Los prototipos pueden tener diferencias menores respecto al diseño final — siempre validar contra `.agents/skills/skill-design/SKILL.md` y `.agents/skills/skill-design/vistas.md`.

**Excepción conocida:** El editor (`editor.html`) usa ink-3/ink-4 más claros que el resto. Usar los valores de `skill-design/SKILL.md` en toda la implementación.

### Módulos compartidos — reutilizar, nunca recrear

El Sidebar y el Topbar son componentes globales compartidos entre todas las vistas. **No se crea un sidebar nuevo por vista ni un topbar nuevo por vista.** Se implementan una vez y se reutilizan.

Comportamiento de sidebar por contexto:
- **Desk, Collections, Correspondences, Shared:** sidebar expandido (292px) por defecto.
- **Editor:** sidebar en modo mini (52px) por defecto — el espacio es del texto.
- El usuario puede colapsar/expandir en cualquier vista. El estado persiste en sesión.

### Mapa de archivos de referencia

**Prototipos HTML** — abrir en browser para interactividad completa:

| Archivo HTML | Vista | Qué muestra |
|---|---|---|
| `reference/desk.html` | Desk | Hero con draft cards, filter bar, tabla de actividad |
| `reference/collections.html` | Collections | Banner uncategorized, AI suggestions, collections expandibles |
| `reference/correspondences.html` | Correspondences | Thread con mini-docs, participants bar, reply prompt |
| `reference/editor.html` | Editor | Sidebar mini, layout de tres columnas, panels, statusbar |
| `reference/reading.html` | Reading + Márgenes | Vista de lectura standalone, highlights, panel de márgenes |

**Screenshots** — referencia rápida sin abrir browser:

| Archivo PNG | Qué muestra |
|---|---|
| `reference/desk.png` | Desk completo: hero (4 cards) + filter bar + tabla agrupada por fecha |
| `reference/collections.png` | Collections: banner terracota + AI strip + collections expandibles |
| `reference/correspondences-thread.png` | Hilo: participants bar + 3 mini-docs + reply prompt |
| `reference/reading-full.png` | Reading view sin sidebar, writing completo, sin márgenes |
| `reference/reading-margins-panel.png` | Reading view con panel de márgenes abierto (296px) |
| `reference/reading-selection-popup.png` | Popup de selección activo + márgenes + anotaciones |
| `reference/editor-default.png` | Editor con sidebar mini, sin panels secundarios |
| `reference/editor-list-panel.png` | Editor con list panel abierto (colección Reflections) |
| `reference/editor-properties.png` | Editor con panel Properties (status, visibility, collections, correspondencia) |
| `reference/editor-link-modal.png` | Modal "Insert link" sobre el editor |
| `reference/editor-notes.png` | Editor con panel Notes (footnotes del writing) |

---

## Reglas de conflicto entre documentos

- El documento más **específico y reciente** gana.
- `docs/core/odessay-arquitectura.md` prevalece sobre cualquier versión anterior.
- **Terminología correcta:** `writings` (no `letters`), `finished` (no `sealed`), `/desk` (no `/home`).
- Si hay conflicto entre dos documentos de texto, el más específico al tema aplica.

---

## Decisiones no negociables

**Local-first:** El usuario nunca espera a Supabase. SQLite local (o IndexedDB en web) es la fuente de verdad operativa. Supabase es la copia remota sincronizada. Ver `.agents/skills/skill-backend/SKILL.md`.

**Editor aislado:** Un keystroke en el editor no debe re-renderizar el sidebar, paneles de AI, ni ningún componente externo. Ver `.agents/skills/skill-frontend/SKILL.md`.

**AI no genera texto:** El AI editor observa, señala, pregunta. Nunca escribe por el autor. Si la respuesta es "SILENCIO", no se envía nada al cliente. Ver `docs/features/odessay-ai-editor.md`.

**Simplicidad radical:** Si el issue no lo pidió, no se agrega UI. Cada píxel existe por una razón.

**Bordes y tipografía:** Bordes siempre `0.5px`. Iconos siempre `strokeWidth={1.5}`. Lora para lo epistolar, Geist Sans para lo funcional. Nunca mezclar en el mismo elemento.

---

## Cómo navegar los documentos para una tarea típica

**Para implementar una vista nueva (ej. el Desk):**
1. Leer `docs/core/odessay-fundacional.md` → entender el modo "Organizar"
2. Leer `docs/core/odessay-arquitectura.md` → entender la estructura de navegación
3. Leer `.agents/skills/skill-design/SKILL.md` → tokens visuales
4. Leer `.agents/skills/skill-design/vistas.md` → valores exactos del Desk
5. Leer `.agents/skills/skill-frontend/SKILL.md` → arquitectura de componentes, naming
6. Implementar contra el prototipo `reference/desk.html`
7. Antes de PR: leer `.agents/skills/skill-code-review/SKILL.md`

**Para implementar un endpoint de API:**
1. Leer `docs/core/odessay-arquitectura.md` → contexto
2. Leer `docs/core/odessay-modelo-datos.md` → schema
3. Leer `.agents/skills/skill-backend/SKILL.md` → estándares de API routes
4. Leer `.agents/skills/skill-database/SKILL.md` → RLS y migraciones
5. Antes de PR: leer `.agents/skills/skill-code-review/SKILL.md`

**Para implementar el AI editor:**
1. Leer `docs/features/odessay-ai-editor.md` → spec completa
2. Leer `.agents/skills/skill-backend/SKILL.md` → sección Codex API
3. Leer `.agents/skills/skill-frontend/SKILL.md` → sección Editor TipTap

**Para modificar el schema de base de datos:**
1. Leer `docs/core/odessay-modelo-datos.md` → schema actual
2. Leer `.agents/skills/skill-database/SKILL.md` → convenciones de migración y RLS
3. Actualizar `docs/core/odessay-modelo-datos.md` con los cambios
