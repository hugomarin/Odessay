# ODESSAY — Agent Operating Guide

Este archivo resume cómo debe trabajar un agente de código en este repositorio.
Está basado en `CLAUDE.md`. Si hay conflicto, **gana `CLAUDE.md`**.

---

## 1) Protocolo de lectura

**Pre-flight (siempre, sin excepción):**
1. `config.json` — verificar que todos los docs existen. Leer `always_read` y los `triggers` del issue.
2. `docs/ops/SETUP.md` — entorno, tools, permisos, Git. Si falta algo, no empezar.
3. `docs/ops/STATUS.md` — qué existe hoy en el codebase.

**Contexto base (siempre):**
4. `docs/core/odessay-fundacional.md` — visión y principios.
5. `docs/core/odessay-arquitectura.md` — arquitectura técnica.
6. `docs/core/odessay-stack.md` — stack y convenciones.

**Condicional (según trigger del issue — ver config.json → triggers):**
- `frontend` → core/paginas, core/flujos, skill-design/SKILL.md, skill-design/vistas.md, skill-frontend, reference/
- `backend` → core/modelo-datos, skill-backend
- `database` → core/modelo-datos, skill-database
- `editor` → features/odessay-editor
- `ai-editor` → features/odessay-ai-editor
- `reading-view` → features/odessay-margenes (consultar al llegar, no al inicio)

**Antes de PR (siempre):**
- `skills/skill-product-manager/SKILL.md` y `skills/skill-code-review/SKILL.md`

---

## 2) Fuente de verdad documental

### core/ — siempre leer
- Producto/visión: `docs/core/odessay-fundacional.md`
- Arquitectura técnica: `docs/core/odessay-arquitectura.md`
- Stack y convenciones: `docs/core/odessay-stack.md`
- Flujos: `docs/core/odessay-flujos.md`
- Páginas/rutas: `docs/core/odessay-paginas.md`
- Modelo de datos: `docs/core/odessay-modelo-datos.md`

### features/ — leer solo si el issue toca ese feature
- Editor (TipTap): `docs/features/odessay-editor.md`
- AI editor: `docs/features/odessay-ai-editor.md`
- Márgenes/lectura: `docs/features/odessay-margenes.md`

### ops/ — siempre leer (pre-flight)
- Entorno y operación: `docs/ops/SETUP.md`
- Estado actual del codebase: `docs/ops/STATUS.md`
- Plan de ejecución: `docs/ops/odessay-roadmap.md`

---

## 3) Selección de skills

- UI visual/tokens: `skills/skill-design/SKILL.md`
- Valores exactos por vista: `skills/skill-design/vistas.md` (companion file)
- Frontend/arquitectura React: `skills/skill-frontend/SKILL.md`
- Backend/API/server logic: `skills/skill-backend/SKILL.md`
- Base de datos/migraciones/RLS: `skills/skill-database/SKILL.md`
- Revisión de calidad pre-PR: `skills/skill-code-review/SKILL.md`
- Gestión de issues/Linear: `skills/skill-product-manager/SKILL.md`
- UX testing/E2E: `skills/skill-ux-testing/SKILL.md`

Regla práctica:
- Toda tarea con UI → `skill-design/SKILL.md` + `skill-design/vistas.md` + `skill-frontend`.
- Todo PR → `skill-code-review`.

---

## 4) Prototipos de referencia

Usar `reference/` como referencia visual y de comportamiento:

- `reference/desk.html`
- `reference/collections.html`
- `reference/correspondences.html`
- `reference/editor.html`
- `reference/reading.html`

Reglas:
- Si hay conflicto entre prototipo y documento de texto, gana el documento.
- Excepción conocida: `reference/editor.html` tiene `ink-3`/`ink-4` más claros; usar valores de `skill-design`.
- Sidebar y Topbar son componentes globales reutilizables; no recrearlos por vista.

---

## 5) Reglas de conflicto

- Gana el documento más específico y reciente.
- `docs/core/odessay-arquitectura.md` prevalece sobre versiones anteriores.
- Terminología obligatoria: `writings`, `finished`, `/desk`.

---

## 6) Decisiones no negociables

- Local-first: guardar local inmediato; sync remoto en background.
- Editor aislado: un keystroke no re-renderiza sidebar/paneles externos.
- AI no genera texto del autor; si responde `SILENCIO`, no renderizar salida.
- Simplicidad radical: no agregar UI no pedida.
- Consistencia visual: bordes `0.5px`, iconos `strokeWidth={1.5}`, Lora para epistolar y Geist Sans para UI funcional.

---

## 7) Playbooks de trabajo rápidos

Implementar vista:
1. `docs/core/odessay-fundacional.md`
2. `docs/core/odessay-arquitectura.md`
3. `skills/skill-design/SKILL.md`
4. `skills/skill-design/vistas.md`
5. `skills/skill-frontend/SKILL.md`
6. Implementar contra `reference/*.html`
7. Revisar con `skills/skill-code-review/SKILL.md`

Implementar endpoint:
1. `docs/core/odessay-arquitectura.md`
2. `docs/core/odessay-modelo-datos.md`
3. `skills/skill-backend/SKILL.md`
4. `skills/skill-database/SKILL.md`
5. Revisar con `skills/skill-code-review/SKILL.md`

Modificar schema:
1. `docs/core/odessay-modelo-datos.md`
2. `skills/skill-database/SKILL.md`
3. Actualizar `docs/core/odessay-modelo-datos.md` con los cambios

---

## 8) WORKFLOW.md — instrucciones específicas por issue

Si el issue requiere contexto o restricciones adicionales más allá de los docs estándar, crear un `WORKFLOW.md` en la raíz de la rama. Sobreescribe `agent.md` para esa rama únicamente. Se borra al mergear. Ver `docs/ops/SETUP.md` §WORKFLOW.md para el formato.

---

## 9) Criterio de entrega

Un cambio está listo cuando:
- Respeta los documentos y skills aplicables.
- No rompe decisiones no negociables.
- `npm run typecheck` y `npm run lint` pasan sin errores — output pegado en el PR.
- Tests relevantes corren y pasan con `npm test` sin dependencias externas.
- Está listo para PR bajo `skills/skill-code-review/SKILL.md`.
