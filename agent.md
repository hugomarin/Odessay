# ODESSAY — Agent Operating Guide

Este archivo resume cómo debe trabajar un agente de código en este repositorio.
Está basado en `CLAUDE.md`. Si hay conflicto, **gana `CLAUDE.md`**.

---

## 1) Orden de lectura obligatorio

1. `config.json` — manifiesto del framework. Verifica que todos los documentos declarados existen (pre-flight en `docs/SETUP.md`). Si hay gaps, no empezar.
2. `docs/SETUP.md` — entorno, tools, permisos, Git. Si falta algo, no empezar.
3. `docs/STATUS.md` — qué existe hoy en el codebase, qué no.
3. `docs/odessay-fundacional.md` — visión y principios del producto.
4. `docs/odessay-arquitectura.md` — arquitectura técnica.
5. Skill según tipo de tarea (ver sección 3)

---

## 2) Fuente de verdad documental

- Entorno y operación del agente: `docs/SETUP.md`
- Estado actual del codebase: `docs/STATUS.md`
- Producto/visión: `docs/odessay-fundacional.md`
- Arquitectura técnica: `docs/odessay-arquitectura.md`
- Stack y convenciones: `docs/odessay-stack.md`
- Flujos: `docs/odessay-flujos.md`
- Páginas/rutas: `docs/odessay-paginas.md`
- Modelo de datos: `docs/odessay-modelo-datos.md`
- Editor (TipTap): `docs/odessay-editor.md`
- AI editor: `docs/odessay-ai-editor.md`
- Márgenes/lectura: `docs/odessay-margenes.md`
- Plan de ejecución: `docs/odessay-roadmap.md`

---

## 3) Selección de skills

- UI visual/tokens: `skills/skill-design/SKILL.md`
- Valores exactos por vista: `skills/skill-design-vistas/SKILL.md`
- Frontend/arquitectura React: `skills/skill-frontend/SKILL.md`
- Backend/API/server logic: `skills/skill-backend/SKILL.md`
- Base de datos/migraciones/RLS: `skills/skill-database/SKILL.md`
- Revisión de calidad pre-PR: `skills/skill-code-review/SKILL.md`
- Gestión de issues/Linear: `skills/skill-product-manager/SKILL.md`
- UX testing/E2E: `skills/skill-ux-testing/SKILL.md`

Regla práctica:
- Toda tarea con UI debe pasar por `skill-design` + `skill-design-vistas` + `skill-frontend`.
- Todo PR debe pasar por `skill-code-review`.

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
- `docs/odessay-arquitectura.md` prevalece sobre versiones anteriores.
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
1. Fundacional
2. Arquitectura
3. Skill design
4. Skill design-vistas
5. Skill frontend
6. Implementar contra `reference/*.html`
7. Revisar con skill code-review

Implementar endpoint:
1. Arquitectura
2. Modelo de datos
3. Skill backend
4. Skill database
5. Revisar con skill code-review

Modificar schema:
1. Modelo de datos
2. Skill database
3. Actualizar `docs/odessay-modelo-datos.md`

---

## 8) WORKFLOW.md — instrucciones específicas por issue

Si el issue requiere contexto o restricciones adicionales más allá de los docs estándar, crear un `WORKFLOW.md` en la raíz de la rama. Sobreescribe `agent.md` para esa rama únicamente. Se borra al mergear. Ver `docs/SETUP.md` §WORKFLOW.md para el formato.

---

## 9) Criterio de entrega

Un cambio está listo cuando:
- Respeta los documentos y skills aplicables.
- No rompe decisiones no negociables.
- `npm run typecheck` y `npm run lint` pasan sin errores — output pegado en el PR.
- Tests relevantes corren y pasan con `npm test` sin dependencias externas.
- Está listo para PR bajo `skills/skill-code-review/SKILL.md`.
