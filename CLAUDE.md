# ODESSAY — Instrucciones para agentes de código

Este repositorio contiene la documentación completa de Odessay — una plataforma de escritura epistolar. Esta documentación **es la especificación del producto**. Los agentes de código construyen Odessay leyendo estos documentos y siguiendo los skills.

---

## Leer en este orden

1. **`docs/odessay-fundacional.md`** — Qué es Odessay, por qué existe, para quién, los tres modos (Escribir / Leer / Organizar), principios de diseño. Leer siempre primero, antes de cualquier otra cosa.
2. **`docs/odessay-arquitectura.md`** — Arquitectura técnica, stack, navegación de tres columnas, rutas, vistas principales. Leer segundo.
3. **Skill según el tipo de tarea** — Ver tabla de skills abajo.

---

## Documentación completa

| Documento | Propósito |
|-----------|-----------|
| `docs/odessay-fundacional.md` | Visión, por qué, para quién, principios. Leer primero. |
| `docs/odessay-arquitectura.md` | Arquitectura técnica y navegación. Prevalece sobre versiones anteriores. |
| `docs/odessay-stack.md` | Stack tecnológico confirmado y convenciones |
| `docs/odessay-flujos.md` | Flujos de usuario detallados (secciones 1–11) |
| `docs/odessay-paginas.md` | Descripción de cada ruta/página |
| `docs/odessay-modelo-datos.md` | Schema completo de Supabase |
| `docs/odessay-editor.md` | Editor TipTap: extensiones, shortcuts, auto-save, modales, layout. Referencia técnica del componente más crítico. |
| `docs/odessay-ai-editor.md` | Spec del AI editor residente |
| `docs/odessay-margenes.md` | Sistema de márgenes (highlight y anotación en lectura) |
| `skills/skill-design-vistas.md` | Especificación visual por vista: valores exactos de Sidebar, Desk, Collections, Correspondences, Reading, Editor + checklists de validación |
| `docs/odessay-roadmap.md` | Fases y prioridades. Fuente de verdad del qué y el cuándo. |

---

## Skills — cuándo usar cada uno

| Skill | Cuándo usarlo |
|-------|---------------|
| `skills/skill-design.md` | **Siempre antes de construir UI.** Tokens de color, tipografía, ShadCN, iconos, transiciones, reglas invariables. |
| `skills/skill-design-vistas.md` | **Leer antes de implementar cada vista.** Valores exactos de padding, tamaños y comportamiento por pantalla + checklists de validación. Companion de skill-design. |
| `skills/skill-frontend.md` | Arquitectura React, estructura de archivos, naming BEM, TipTap, Server/Client components, performance, accesibilidad. Leer después de skill-design. |
| `skills/skill-backend.md` | API routes, Supabase, local-first, Claude API, Resend, manejo de errores. |
| `skills/skill-database.md` | Supabase, RLS policies, migraciones, índices. |
| `skills/skill-code-review.md` | **Siempre antes de abrir un PR.** Checklist completo de calidad, velocidad y seguridad. |
| `skills/skill-product-manager.md` | Criterios de producto, creación y ejecución de issues. |
| `skills/skill-ux-testing.md` | Testing de UX, flujos E2E con Playwright. |

---

## Prototipos visuales de referencia

La carpeta `reference/` contiene los prototipos HTML canónicos. Son la fuente visual más fiable:

| Archivo | Vista |
|---------|-------|
| `odessay-editor-v6_26.html` | Editor — prototipo canónico actual |
| `odessay-workspace-v3_4.html` | Desk |
| `odessay-collections_1.html` | Collections |
| `odessay-correspondence-v2_5.html` | Correspondences |
| `odessay-reading-margins_2.html` | Reading view + Márgenes |

**Cuando hay conflicto entre un prototipo HTML y un documento de texto, el documento de texto prevalece.**

**Excepción conocida:** Los valores de ink-3/ink-4 en el editor (`odessay-editor-v6_26.html`) son más claros que en el resto. Usar los valores más oscuros documentados en `skill-design.md` — mayor contraste, mejor legibilidad.

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
6. Implementar contra el prototipo `odessay-workspace-v3_4.html`
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
