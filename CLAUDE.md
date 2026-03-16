# ODESSAY — Instrucciones para agentes de código

Este repositorio contiene la documentación completa de Odessay — una plataforma de escritura epistolar. Esta documentación **es la especificación del producto**. Los agentes de código construyen Odessay leyendo estos documentos y siguiendo los skills.

---

## Leer en este orden

1. **`config.json`** — Manifiesto del framework. Lista las 10 preguntas MECE y qué documento responde cada una. Verificar que todos los archivos declarados existen antes de empezar (ver pre-flight en `docs/SETUP.md`).
2. **`docs/SETUP.md`** — Entorno, variables, tools requeridos, permisos, estrategia de Git. Leer antes de cualquier otra cosa. Si falta algo de lo que ahí se pide, no empezar.
3. **`docs/STATUS.md`** — Qué está construido hoy, qué no existe todavía, decisiones tomadas. Leer segundo para entender el contexto del codebase.
3. **`docs/odessay-fundacional.md`** — Qué es Odessay, por qué existe, para quién, los tres modos (Escribir / Leer / Organizar), principios de diseño.
4. **`docs/odessay-arquitectura.md`** — Arquitectura técnica, stack, navegación de tres columnas, rutas, vistas principales.
5. **Skill según el tipo de tarea** — Ver tabla de skills abajo.

---

## Documentación completa

| Documento | Propósito |
|-----------|-----------|
| `docs/SETUP.md` | **Leer primero.** Entorno, variables, tools, permisos, Git. |
| `docs/STATUS.md` | **Leer segundo.** Qué está construido, qué no existe, decisiones tomadas. |
| `docs/odessay-fundacional.md` | Visión, por qué, para quién, principios. |
| `docs/odessay-arquitectura.md` | Arquitectura técnica y navegación. Prevalece sobre versiones anteriores. |
| `docs/odessay-stack.md` | Stack tecnológico confirmado y convenciones |
| `docs/odessay-flujos.md` | Flujos de usuario detallados (secciones 1–11) |
| `docs/odessay-paginas.md` | Descripción de cada ruta/página |
| `docs/odessay-modelo-datos.md` | Schema completo de Supabase |
| `docs/odessay-editor.md` | Editor TipTap: extensiones, shortcuts, auto-save, modales, layout. Referencia técnica del componente más crítico. |
| `docs/odessay-ai-editor.md` | Spec del AI editor residente |
| `docs/odessay-margenes.md` | Sistema de márgenes (highlight y anotación en lectura) |
| `skills/skill-design-vistas/SKILL.md` | Especificación visual por vista: valores exactos de Sidebar, Desk, Collections, Correspondences, Reading, Editor + checklists de validación |
| `docs/odessay-roadmap.md` | Fases y prioridades. Fuente de verdad del qué y el cuándo. |

---

## Skills — cuándo usar cada uno

| Skill | Cuándo usarlo |
|-------|---------------|
| `skills/skill-design/SKILL.md` | **Siempre antes de construir UI.** Tokens de color, tipografía, ShadCN, iconos, transiciones, reglas invariables. |
| `skills/skill-design-vistas/SKILL.md` | **Leer antes de implementar cada vista.** Valores exactos de padding, tamaños y comportamiento por pantalla + checklists de validación. Companion de skill-design. |
| `skills/skill-frontend/SKILL.md` | Arquitectura React, estructura de archivos, naming BEM, TipTap, Server/Client components, performance, accesibilidad. Leer después de skill-design. |
| `skills/skill-backend/SKILL.md` | API routes, Supabase, local-first, Claude API, Resend, manejo de errores. |
| `skills/skill-database/SKILL.md` | Supabase, RLS policies, migraciones, índices. |
| `skills/skill-code-review/SKILL.md` | **Siempre antes de abrir un PR.** Checklist completo de calidad, velocidad y seguridad. |
| `skills/skill-product-manager/SKILL.md` | Criterios de producto, creación y ejecución de issues. |
| `skills/skill-ux-testing/SKILL.md` | Testing de UX, flujos E2E con Playwright. |

---

## Prototipos visuales de referencia

La carpeta `reference/` contiene los prototipos HTML interactivos y sus screenshots. Son la fuente visual más fiable para entender layout, comportamiento y valores de componentes.

**Regla general:** Cuando hay conflicto entre un prototipo y un documento de texto, el documento de texto prevalece. Los prototipos pueden tener diferencias menores respecto al diseño final — siempre validar contra `skill-design.md` y `skill-design-vistas.md`.

**Excepción conocida:** El editor (`editor.html`) usa ink-3/ink-4 más claros que el resto. Usar los valores de `skill-design.md` en toda la implementación.

### Módulos compartidos — reutilizar, nunca recrear

El Sidebar y el Topbar son componentes globales compartidos entre todas las vistas. **No se crea un sidebar nuevo por vista ni un topbar nuevo por vista.** Se implementan una vez y se reutilizan. Los prototipos muestran el mismo sidebar en todas las vistas porque es el mismo componente.

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
- `odessay-arquitectura.md` prevalece sobre cualquier versión anterior.
- **Terminología correcta:** `writings` (no `letters`), `finished` (no `sealed`), `/desk` (no `/home`).
- Si hay conflicto entre dos documentos de texto, el más específico al tema aplica.

---

## Decisiones no negociables

**Local-first:** El usuario nunca espera a Supabase. SQLite local (o IndexedDB en web) es la fuente de verdad operativa. Supabase es la copia remota sincronizada. Ver `skill-backend.md`.

**Editor aislado:** Un keystroke en el editor no debe re-renderizar el sidebar, paneles de AI, ni ningún componente externo. Ver `skill-frontend.md`.

**AI no genera texto:** El AI editor observa, señala, pregunta. Nunca escribe por el autor. Si la respuesta es "SILENCIO", no se envía nada al cliente. Ver `odessay-ai-editor.md`.

**Simplicidad radical:** Si el issue no lo pidió, no se agrega UI. Cada píxel existe por una razón.

**Bordes y tipografía:** Bordes siempre `0.5px`. Iconos siempre `strokeWidth={1.5}`. Lora para lo epistolar, Geist Sans para lo funcional. Nunca mezclar en el mismo elemento.

---

## Cómo navegar los documentos para una tarea típica

**Para implementar una vista nueva (ej. el Desk):**
1. Leer `odessay-fundacional.md` → entender el modo "Organizar"
2. Leer `odessay-arquitectura.md` → entender la estructura de navegación
3. Leer `skill-design.md` → tokens visuales
4. Leer `skill-design-vistas.md` → valores exactos del Desk
5. Leer `skill-frontend.md` → arquitectura de componentes, naming
6. Implementar contra el prototipo `reference/desk.html`
7. Antes de PR: leer `skill-code-review.md`

**Para implementar un endpoint de API:**
1. Leer `odessay-arquitectura.md` → contexto
2. Leer `odessay-modelo-datos.md` → schema
3. Leer `skill-backend.md` → estándares de API routes
4. Leer `skill-database.md` → RLS y migraciones
5. Antes de PR: leer `skill-code-review.md`

**Para implementar el AI editor:**
1. Leer `odessay-ai-editor.md` → spec completa
2. Leer `skill-backend.md` → sección Claude API
3. Leer `skill-frontend.md` → sección Editor TipTap

**Para modificar el schema de base de datos:**
1. Leer `odessay-modelo-datos.md` → schema actual
2. Leer `skill-database.md` → convenciones de migración y RLS
3. Actualizar `odessay-modelo-datos.md` con los cambios

---

## Documentos con versiones previas

Algunos documentos fueron iterados a lo largo del desarrollo. La versión más reciente del archivo en `/docs/` o `/skills/` es siempre la que aplica. Si hay contenido obsoleto en un documento, el contenido más específico y reciente gana. En caso de duda: `odessay-arquitectura.md` es la referencia de arquitectura.
