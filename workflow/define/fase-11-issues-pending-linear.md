# Fase 11 — Issues pendientes de Linear (staging provisional)

**Este archivo es provisional.** Linear cayó (`https://linear.app` respondió con su propia página "Linear is down") a mitad de la descomposición táctica de `/wf-define fase-11`, tanto por MCP como por el fallback de API key documentado en `workflow/workflow.md` — no es un problema de credenciales ni de conector, es una caída real del servicio. Este documento existe solo para no perder el trabajo de brief mientras Linear vuelve. **No es un output válido de DEFINE por sí solo** (`.agents/skills/skill-product-manager/SKILL.md` §Cómo usar este skill: "No es un output válido de DEFINE: dejar un breakdown táctico solo en markdown dentro del repo sin persistirlo en Linear") — en cuanto Linear responda, cada bloque de abajo se crea como issue vía `save_issue` y este archivo se borra.

Proyecto Linear: `Fase 11 — Artifact Studio: Agente de Workspace` (team **Artifact Studio**, key `ODE`) — https://linear.app/hugo-marin/project/fase-11-artifact-studio-agente-de-workspace-57df6e291df8

---

## Ya creados en Linear

| # | Issue | Estado |
|---|---|---|
| M0 | [ODE-479 — Add authorized read/write/move/edit/delete tool layer for the Workspace agent](https://linear.app/hugo-marin/issue/ODE-479/add-authorized-readwritemoveeditdelete-tool-layer-for-the-workspace) | Todo |
| M1 | [ODE-480 — Generate and update workflow.md from existing workspace context](https://linear.app/hugo-marin/issue/ODE-480/generate-and-update-workflowmd-from-existing-workspace-context) | Todo |
| M2 | [ODE-481 — Detect broken internal document references](https://linear.app/hugo-marin/issue/ODE-481/detect-broken-internal-document-references) | Todo |
| M3 | [ODE-482 — Suggest artifact type and status against the user's vocabulary](https://linear.app/hugo-marin/issue/ODE-482/suggest-artifact-type-and-status-against-the-users-vocabulary) | Todo |

No hace falta recrearlos. Los cito abajo como referencia de dependencias para M4-M7.

---

## Pendientes de crear — en cuanto Linear vuelva

### M4 — Surface archive candidates with cited evidence

**Team:** Artifact Studio · **Project:** Fase 11 — Artifact Studio: Agente de Workspace · **State:** Todo
**Labels:** `ai-editor`, `backend`
**Blocked by:** ODE-479, ODE-482

```markdown
## Context

Señala documentos candidatos a archivar (duplicados, estancados) combinando señales determinísticas del catálogo con juicio, siempre con razón explícita citada antes de que el usuario pueda aprobar. Nunca ejecuta el archivado por sí sola.

## Dependencies

Blocked by: ODE-479 (capa de herramientas — archivar usa su operación `edit`/`move`), ODE-482 (reutiliza el mismo pipeline de clasificación contra el catálogo de vocabulary).

## Architecture Contract

- **Layer:** Dominant `Application` (combina señales del catálogo — `stale`, sin excerpt, similitud — con la clasificación de ODE-482).
- **Runtime scope:** `desktop`.
- **Ownership:** Primary owner `backend` — Needs architectural contract first: **no**.
- **Contracts touched:** lectura de `document-catalog.ts` (fecha de modificación, `DocumentState`, excerpt); `edit`/`move` de ODE-479 para archivar tras aprobación.
- **Invariants:** ningún candidato se ofrece sin razón explícita citada (fecha, similitud, o ambas); `DocumentState` (metadata operacional de sync) nunca se usa como señal de intención por sí sola.
- **Required docs for the issue:** `lib/queries/document-catalog.ts`, `lib/writings/document-state.ts`.

## Requirements

- Un documento se ofrece como candidato solo con razón citada visible (última modificación, % de similitud con otro documento, o ambas).
- Archivar solo ocurre tras aprobación explícita del usuario sobre ese candidato específico, vía el contrato de ODE-479.
- No confundir `DocumentState` (`local-only`/`synced`/`conflict`/etc., señal de sync) con señal de intención del usuario — se usa solo metadata de catálogo (fecha, excerpt) y la clasificación de ODE-482 para el juicio de "candidato".

## Reference docs

- `lib/queries/document-catalog.ts`
- `lib/writings/document-state.ts`
- `workflow/define/dod-fase-11.md` §4

## Delivery / Validation

- `npm run typecheck && npm run lint && npm test`
- `npm run ops:delivery:gate`
- Prueba manual: dos documentos con nombres/contenido muy similares y fechas distintas → el más viejo se ofrece como candidato citando la razón; archivar requiere aprobación explícita.

## Definition of Done

Cada candidato a archivar llega con razón explícita citada (fecha, similitud, o ambas) antes de que el usuario pueda aprobarlo, y el archivado en sí solo ocurre tras esa aprobación explícita vía el contrato de ODE-479.

## Notes

Comparte señales de catálogo con ODE-481 (enlaces rotos) y la clasificación de ODE-482 — no reimplementa su propia lectura del catálogo desde cero.
```

---

### M5 — Compare document content and surface contradictions in a resolution queue

**Team:** Artifact Studio · **Project:** Fase 11 — Artifact Studio: Agente de Workspace · **State:** Todo
**Labels:** `ai-editor`, `architecture`, `desktop`
**Blocked by:** ODE-479

```markdown
## Context

La acción de mayor costo de afinar: compara contenido real (no solo metadata) entre dos o más documentos y cita el fragmento de cada uno antes de ofrecer una resolución. Se apoya en anotaciones existentes para acotar qué comparar, en vez de comparar todo el texto a ciegas. Soporta más de un hallazgo en la misma corrida — el mockup validado el 2026-09-05 demuestra el patrón de cola (nav "1 of N", resolver uno avanza solo al siguiente sin resolver, el estado sobrevive a cerrar/reabrir).

## Dependencies

Blocked by: ODE-479 (capa de herramientas — la lectura acotada de body real pasa por su operación `read`).

## Architecture Contract

- **Layer:** Dominant `Application` (orquesta qué documentos comparar y arma la cola) — Secondary `Domain` (define qué cuenta como "contradicción" citable).
- **Runtime scope:** `desktop`.
- **Ownership:** Primary owner `architecture-first` para la política de fetch acotado (qué documentos traer, cuánto contenido, cuándo) — luego `backend`/`frontend` implementan dentro de esos límites. Needs architectural contract first: **yes**.
- **Contracts touched:** `lib/services/document-service-factory.ts` (lectura acotada de body real, nunca precarga de todo el workspace); lectura de `lib/margins/margins.ts` para anotaciones como evidencia de qué comparar.
- **Invariants:** el body real de un documento solo se trae para los documentos que esta acción concretamente necesita comparar; cada hallazgo cita el fragmento exacto de cada documento en conflicto, nunca un veredicto sin evidencia.
- **Boundaries:** Allowed dependencies: `document-service-factory.ts`, `margins.ts`, catálogo ya cargado. Forbidden dependencies: precargar body de documentos no señalados por el usuario o por una acción previa (M2/M3/M4).
- **Required docs for the issue:** `lib/services/document-service-factory.ts`, `lib/margins/margins.ts`.

## Requirements

- La comparación trae solo el body de los documentos flagged por esta acción — nunca precarga el workspace completo.
- Cada candidato de resolución cita: documento origen, fecha, y el fragmento exacto en conflicto.
- Soporta N hallazgos simultáneos en una cola: navegación "i of N", resolver uno registra de inmediato y avanza solo al siguiente sin resolver.
- El estado de resueltos sobrevive a cerrar y reabrir la revisión sin perder progreso.
- Una tarjeta de candidato puede llevar la sugerencia del agente marcada (badge), sin forzar esa elección — el usuario puede elegir cualquiera de las versiones o descartar la contradicción entera.

## Reference docs

- `lib/services/document-service-factory.ts`
- `lib/margins/margins.ts`
- `workflow/define/dod-fase-11.md` §4

## Delivery / Validation

- `npm run typecheck && npm run lint && npm test`
- `npm run ops:delivery:gate`
- Prueba manual: workspace con ≥2 documentos que declaran algo distinto sobre el mismo tema → la acción cita ambos fragmentos; con ≥2 contradicciones a la vez, resolver una avanza sola a la siguiente y el progreso sobrevive a cerrar/reabrir.

## Definition of Done

Cada hallazgo cita el fragmento real de al menos dos documentos, nunca solo metadata. Con múltiples hallazgos, resolver uno lo registra de inmediato y avanza automáticamente al siguiente sin resolver; el estado de resueltos persiste a través de cerrar y reabrir la revisión.

## Notes

Esta es la acción que más iteración de prompt/criterio va a pedir después de la primera implementación — no tratar el primer pase como definitivo.
```

---

### M6 — Mount the Workspace agent panel in Studio and Workspace with drag-and-drop context

**Team:** Artifact Studio · **Project:** Fase 11 — Artifact Studio: Agente de Workspace · **State:** Todo
**Labels:** `frontend`, `design-ux`, `desktop`
**Blocked by:** ODE-480, ODE-481, ODE-482, (M4 y M5 una vez creados)

```markdown
## Context

Monta el mismo panel de agente en dos anfitriones — Studio (tab de `editor-right-panel-tabs.tsx`) y Workspace (chrome nuevo en `workspace-detail.tsx`) — diferenciado solo por un prop de scope, nunca por dos implementaciones paralelas. Revisar un hallazgo ensancha el panel en el propio lugar y reemplaza su contenido interno — nunca aparece un modal o sheet que cubra Desk/Studio/Workspace detrás (corregido explícitamente sobre el mockup el 2026-09-05). Soporta arrastrar un documento de la lista O una carpeta del árbol de Workspace hacia cualquier parte del panel, no solo el composer.

## Dependencies

Blocked by: ODE-480, ODE-481, ODE-482 (y M4/M5 una vez creados en Linear) — necesita acciones reales que montar y mostrar, no solo el shell vacío.

## Architecture Contract

- **Layer:** Dominant `UI` — Secondary `Application` (el prop de scope decide qué fuente de contexto usa cada host).
- **Runtime scope:** `desktop`.
- **Ownership:** Primary owner `frontend` — Needs architectural contract first: **no** (consume los contratos ya definidos en ODE-479 y siguientes, no define ninguno nuevo).
- **Contracts touched:** ninguno nuevo — consume `AgentToolsService`/`DocumentService` de ODE-479 y las acciones de M1-M5.
- **Invariants (skill-frontend):** estado de UI (panel abierto/cerrado, ancho, review-pane abierto/cerrado, chips adjuntos) vive en `useState` local del componente — no se introduce un tercer slice de Zustand (los únicos dos existentes son `sync` y `AI`; si el estado necesitara cruzar hacia el editor, evaluar reutilizar `store/ai.ts` antes de crear uno nuevo, nunca por default). Cada transición nueva (abrir/cerrar panel, abrir/cerrar review-pane, expandir/contraer ancho, thinking→resuelto) pasa el checklist de cinco puntos de `skill-frontend §Consistencia transicional` antes de mergear.
- **Required docs for the issue:** `.agents/skills/skill-frontend/SKILL.md` §Estado segmentado, §Consistencia transicional, §Nomenclatura semántica de componentes.

## Requirements

- Un solo componente montado en ambos hosts, con `scope: { kind: 'document', id } | { kind: 'workspace', rootId }` como único diferenciador.
- IDs/`data-section`/`data-testid`/clase BEM siguiendo la convención ya usada (`editor-panel-ai` es el precedente directo en el mapa de IDs del editor) — nuevo bloque análogo en Studio y su equivalente en Workspace.
- Iconografía en Lucide React, `strokeWidth={1.5}` — el wireframe usó Material Symbols solo como referencia de interacción, se descarta en la implementación real.
- Revisar un hallazgo ensancha el panel en su propio lugar y reemplaza su contenido interno — nunca un modal/backdrop sobre el resto de la vista.
- Arrastrar un documento de la lista o una carpeta del árbol hacia cualquier parte del panel (no solo el composer) lo acumula como chip de contexto removible antes de enviar.
- Cerrar el panel deja una pestaña angosta para reabrir sin perder el estado de la sesión de chat.

## Reference docs

- `components/editor/panels/editor-right-panel-tabs.tsx`
- `components/workspace/workspace-detail.tsx`
- `components/workspace/workspace-tree.tsx`
- `.agents/skills/skill-frontend/SKILL.md`
- `workflow/define/dod-fase-11.md` §5

## Delivery / Validation

- `npm run typecheck && npm run lint && npm test`
- `npm run ops:delivery:gate`
- Checklist de cinco puntos (`skill-frontend §Consistencia transicional`) documentado para cada transición nueva.
- Captura de cada estado de interacción del wireframe junto a su equivalente construido, para la comparación que exige M7.

## Definition of Done

El mismo componente vive en Studio y en Workspace, diferenciado solo por scope. Revisar un hallazgo ensancha el panel en el lugar — nunca aparece un modal/sheet sobre el contenido detrás. Arrastrar un archivo o una carpeta hacia cualquier parte del panel lo acumula como contexto adjunto. El estado de UI es local (`useState`), sin store nuevo.

## Notes

No arranca hasta que existan acciones reales (M1-M5) que mostrar — montar el shell vacío primero y rellenarlo después invierte el orden de riesgo que la fase ya decidió.
```

---

### M7 — Validate Fase 11 against its DoD and translate the wireframe to Artifact Studio's design system

**Team:** Artifact Studio · **Project:** Fase 11 — Artifact Studio: Agente de Workspace · **State:** Todo
**Labels:** `design-ux`, `qa`
**Blocked by:** ODE-479, ODE-480, ODE-481, ODE-482, (M4, M5, M6 una vez creados)

```markdown
## Context

Gate de cierre de la fase. Traduce cada estado de interacción del wireframe (aprobado como referencia de interacción, nunca de visual final, el 2026-09-05) a los tokens, tipografía e iconografía reales de `skill-design` / `app/globals.css`, y arma la matriz de evidencia que exige `dod-fase-11.md`.

## Dependencies

Blocked by: todos los issues anteriores de la fase (ODE-479, ODE-480, ODE-481, ODE-482, y M4/M5/M6 una vez creados). No hay trabajo de código propio de este issue más allá de la traducción visual y la validación.

## Architecture Contract

No aplica — issue de validación/diseño puro, sin cambio de capa, runtime ni contrato de servicio (`skill-product-manager §Si el issue es de infra, configuración o documentación: no se requiere Architecture Contract`).

## Requirements

- Comparación explícita, por estado de interacción (no por pantalla completa), entre el wireframe y lo construido — cada divergencia de estilo queda registrada como intencional.
- Ningún color/fuente/ícono del wireframe se copia literalmente; todo pasa por token real de `skill-design`.
- Matriz de evidencia: cada bloque de `workflow/define/dod-fase-11.md` enlazado a un test automatizado, una prueba manual reproducible, o la aceptación explícita del dueño.
- Confirmar que ningún invariante de Fase 9 (catálogo, binding, apertura, sync) ni de Fase 10 (vocabulario, shell visual) se rompió.

## Reference docs

- `workflow/define/dod-fase-11.md` (completo)
- `docs/design/system-app.md`
- `.agents/skills/skill-design/SKILL.md`
- `workflow/define/roadmap.md` §Fase 11

## Delivery / Validation

- `npm run typecheck && npm run lint && npm test`
- `npm run ops:delivery:gate`
- Matriz de evidencia adjunta en el PR/issue.
- Aceptación explícita del dueño sobre el outcome completo, no solo proof of work en verde.

## Definition of Done

Coincide con el "Gate de cierre de fase" de `dod-fase-11.md`: los siete bloques del DoD están evidenciados, no quedan issues bloqueantes abiertos en el proyecto de Fase 11, y el comportamiento construido coincide con lo que el wireframe interactivo demuestra, aunque su piel visual no sea la misma.

## Notes

Es el único issue de la fase sin Architecture Contract — es intencional, no un descuido.
```

---

## Al recuperarse Linear

1. Crear M4-M7 vía `save_issue` con el `team`/`project`/`labels`/`blockedBy`/`description` de cada bloque de arriba (copiar el contenido dentro de los ```markdown``` tal cual al campo `description`).
2. Confirmar los 8 issues (ODE-479..ODE-48X) listados en el proyecto `Fase 11 — Artifact Studio: Agente de Workspace`.
3. Entregar la `Execution Trace` de `/wf-define` (Planning role, Skills loaded, Specialist consults, Audit run, Artifacts created, Why) y confirmar al humano la lista final con dependencias y orden sugerido.
4. Borrar este archivo — ya cumplió su propósito de staging.
