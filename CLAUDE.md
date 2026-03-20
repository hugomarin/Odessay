# ODESSAY — Instrucciones para agentes de código

Este repositorio contiene la documentación completa de Odessay — una plataforma de escritura epistolar. Esta documentación **es la especificación del producto**. Los agentes de código construyen Odessay leyendo estos documentos y siguiendo los skills.

---

## Estructura de documentación

```
workflow/
  core/       → Verdades estables del producto. Siempre leer.
  features/   → Spec de cada feature. Leer solo si el issue lo toca.
  (root)      → Estado vivo y operación de agentes. Siempre leer (pre-flight).
workflow/framework/    → Framework MECE genérico. No es específico de Odessay.
.agents/skills/       → Instrucciones de implementación. On-demand por trigger.
workflow/reference/    → Prototipos HTML y screenshots. Referencia visual canónica.
```

---

## Protocolo de lectura

### Paso 1 — Pre-flight (siempre, antes de tocar nada)

1. **`workflow/docs.json`** — Verificar que todos los documentos declarados existen (script en `workflow/SETUP.md`). Identificar el `scope` de los docs: cuáles son `always`, cuáles son `conditional` según el issue.
2. **`workflow/SETUP.md`** — Entorno, variables, tools requeridos, permisos, Git. Si falta algo, no empezar.
3. **`workflow/status.json`** — Qué está construido hoy, fase activa, build log con commits.

**Si la tarea involucra crear o modificar la estructura de Linear** (proyectos, issues, milestones): leer `.agents/skills/skill-product-manager/SKILL.md` completo antes de tocar Linear. La estructura correcta está definida ahí — no se infiere del roadmap.

### Paso 2 — Contexto base (siempre, todo issue)

4. **`workflow/core/odessay-fundacional.md`** — Qué es Odessay, por qué existe, para quién, principios de diseño.
5. **`workflow/core/odessay-arquitectura.md`** — Arquitectura técnica, navegación, rutas, vistas.
6. **`workflow/core/odessay-stack.md`** — Stack tecnológico y convenciones.

### Paso 3 — Docs condicionales (solo si el issue activa el trigger)

Consultar `workflow/docs.json → triggers` para saber qué leer según el área del issue:
- `frontend` → core/paginas, core/flujos, skill-design/SKILL.md, skill-design/vistas.md, skill-frontend, workflow/reference/
- `backend` → core/modelo-datos, skill-backend
- `database` → core/modelo-datos, skill-database
- `editor` → features/editor, skill-frontend
- `ai-editor` → features/ai-editor, skill-backend
- `reading-view` → features/margenes (solo al llegar a esa parte del trabajo)

### Paso 4 — Antes de abrir PR (siempre)

- **`.agents/skills/skill-code-review/SKILL.md`** — Checklist completo de calidad, velocidad y seguridad.

---

## Mapa de documentos

### workflow/core/ — Siempre leer

| Documento | Propósito |
|-----------|-----------|
| `odessay-fundacional.md` | Visión, por qué, para quién, principios. |
| `odessay-arquitectura.md` | Arquitectura técnica y navegación. Prevalece sobre versiones anteriores. |
| `odessay-stack.md` | Stack tecnológico confirmado y convenciones. |
| `odessay-modelo-datos.md` | Schema completo de Supabase. Trigger: backend/database. |
| `odessay-paginas.md` | Descripción de cada ruta/página. Trigger: frontend. |
| `odessay-flujos.md` | Flujos de usuario detallados (secciones 1–11). Trigger: frontend. |

### workflow/features/ — Leer solo si el issue toca ese feature

| Documento | Feature | Trigger |
|-----------|---------|---------|
| `odessay-editor.md` | Editor TipTap: extensiones, shortcuts, auto-save, modales, layout. | `editor` |
| `odessay-ai-editor.md` | AI editor residente: spec completa de comportamiento. | `ai-editor` |
| `odessay-margenes.md` | Sistema de highlights y anotación en lectura. | `reading-view` |

**Gaps conocidos** (features sin doc propio):
- `correspondencias` — thread, participants bar, sequence view, reply. Complejidad alta.
- `collections` — AI suggestions, expandable, uncategorized banner. Complejidad media.

### workflow/ — Siempre leer (pre-flight)

| Documento | Propósito |
|-----------|-----------|
| `SETUP.md` | **Leer primero.** Entorno, variables, tools, permisos, Git. |
| `status.json` | **Leer segundo.** Qué está construido, qué no existe, decisiones tomadas. |
| `odessay-roadmap.md` | Fases y prioridades. Fuente de verdad del qué y el cuándo. |

### workflow/framework/ — Referencia del meta-framework

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
| `.agents/skills/skill-backend/SKILL.md` | API routes, Supabase, local-first, Claude API, Resend, manejo de errores. |
| `.agents/skills/skill-database/SKILL.md` | Supabase, RLS policies, migraciones, índices. |
| `.agents/skills/skill-code-review/SKILL.md` | **Siempre antes de abrir un PR.** Checklist completo de calidad, velocidad y seguridad. |
| `.agents/skills/skill-product-manager/SKILL.md` | Criterios de producto, creación y ejecución de issues. |
| `.agents/skills/skill-ux-testing/SKILL.md` | Testing de UX, flujos E2E con Playwright. |

---

## Prototipos visuales de referencia

La carpeta `workflow/reference/` contiene los prototipos HTML interactivos y sus screenshots. Son la fuente visual más fiable para entender layout, comportamiento y valores de componentes.

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
| `workflow/reference/desk.html` | Desk | Hero con draft cards, filter bar, tabla de actividad |
| `workflow/reference/collections.html` | Collections | Banner uncategorized, AI suggestions, collections expandibles |
| `workflow/reference/correspondences.html` | Correspondences | Thread con mini-docs, participants bar, reply prompt |
| `workflow/reference/editor.html` | Editor | Sidebar mini, layout de tres columnas, panels, statusbar |
| `workflow/reference/reading.html` | Reading + Márgenes | Vista de lectura standalone, highlights, panel de márgenes |

**Screenshots** — referencia rápida sin abrir browser:

| Archivo PNG | Qué muestra |
|---|---|
| `workflow/reference/desk.png` | Desk completo: hero (4 cards) + filter bar + tabla agrupada por fecha |
| `workflow/reference/collections.png` | Collections: banner terracota + AI strip + collections expandibles |
| `workflow/reference/correspondences-thread.png` | Hilo: participants bar + 3 mini-docs + reply prompt |
| `workflow/reference/reading-full.png` | Reading view sin sidebar, writing completo, sin márgenes |
| `workflow/reference/reading-margins-panel.png` | Reading view con panel de márgenes abierto (296px) |
| `workflow/reference/reading-selection-popup.png` | Popup de selección activo + márgenes + anotaciones |
| `workflow/reference/editor-default.png` | Editor con sidebar mini, sin panels secundarios |
| `workflow/reference/editor-list-panel.png` | Editor con list panel abierto (colección Reflections) |
| `workflow/reference/editor-properties.png` | Editor con panel Properties (status, visibility, collections, correspondencia) |
| `workflow/reference/editor-link-modal.png` | Modal "Insert link" sobre el editor |
| `workflow/reference/editor-notes.png` | Editor con panel Notes (footnotes del writing) |

---

## Reglas de conflicto entre documentos

- El documento más **específico y reciente** gana.
- `workflow/core/odessay-arquitectura.md` prevalece sobre cualquier versión anterior.
- **Terminología correcta:** `writings` (no `letters`), `finished` (no `sealed`), `/desk` (no `/home`).
- Si hay conflicto entre dos documentos de texto, el más específico al tema aplica.

---

## Decisiones no negociables

**Local-first:** El usuario nunca espera a Supabase. SQLite local (o IndexedDB en web) es la fuente de verdad operativa. Supabase es la copia remota sincronizada. Ver `.agents/skills/skill-backend/SKILL.md`.

**Editor aislado:** Un keystroke en el editor no debe re-renderizar el sidebar, paneles de AI, ni ningún componente externo. Ver `.agents/skills/skill-frontend/SKILL.md`.

**AI no genera texto:** El AI editor observa, señala, pregunta. Nunca escribe por el autor. Si la respuesta es "SILENCIO", no se envía nada al cliente. Ver `workflow/features/odessay-ai-editor.md`.

**Simplicidad radical:** Si el issue no lo pidió, no se agrega UI. Cada píxel existe por una razón.

**Bordes y tipografía:** Bordes siempre `0.5px`. Iconos siempre `strokeWidth={1.5}`. Lora para lo epistolar, Geist Sans para lo funcional. Nunca mezclar en el mismo elemento.

---

## Cómo navegar los documentos para una tarea típica

**Para implementar una vista nueva (ej. el Desk):**
1. Leer `workflow/core/odessay-fundacional.md` → entender el modo "Organizar"
2. Leer `workflow/core/odessay-arquitectura.md` → entender la estructura de navegación
3. Leer `.agents/skills/skill-design/SKILL.md` → tokens visuales
4. Leer `.agents/skills/skill-design/vistas.md` → valores exactos del Desk
5. Leer `.agents/skills/skill-frontend/SKILL.md` → arquitectura de componentes, naming
6. Implementar contra el prototipo `workflow/reference/desk.html`
7. Antes de PR: leer `.agents/skills/skill-code-review/SKILL.md`

**Para implementar un endpoint de API:**
1. Leer `workflow/core/odessay-arquitectura.md` → contexto
2. Leer `workflow/core/odessay-modelo-datos.md` → schema
3. Leer `.agents/skills/skill-backend/SKILL.md` → estándares de API routes
4. Leer `.agents/skills/skill-database/SKILL.md` → RLS y migraciones
5. Antes de PR: leer `.agents/skills/skill-code-review/SKILL.md`

**Para implementar el AI editor:**
1. Leer `workflow/features/odessay-ai-editor.md` → spec completa
2. Leer `.agents/skills/skill-backend/SKILL.md` → sección Claude API
3. Leer `.agents/skills/skill-frontend/SKILL.md` → sección Editor TipTap

**Para modificar el schema de base de datos:**
1. Leer `workflow/core/odessay-modelo-datos.md` → schema actual
2. Leer `.agents/skills/skill-database/SKILL.md` → convenciones de migración y RLS
3. Actualizar `workflow/core/odessay-modelo-datos.md` con los cambios
