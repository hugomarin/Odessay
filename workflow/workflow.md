# Odessay — Protocolo de Comandos

Define qué hace cada comando `/wf-*`, qué contexto carga, qué output produce y qué gate debe pasar antes de continuar.

## Cómo invocar estos comandos

Cada comando `/wf-*` puede usarse de dos formas equivalentes:

- **Slash command** (`/wf-build ODE-XX`): en agentes que soportan comandos personalizados, como Claude Code con `.claude/commands/`.
- **Instrucción natural** (`wf-build ODE-XX`): sin la barra `/`, en agentes que no soportan slash commands, como Codex u otros. El agente lo interpreta como instrucción en lenguaje natural.

El comportamiento esperado es idéntico en ambas formas. Cuando el orquestador (deus) invoca un agente automáticamente, el prompt ya usa la forma correcta para ese agente — el agente no necesita adaptarse.

---

## Interacción con Linear

Todos los comandos `/wf-*` usan **Linear MCP** para leer issues, cambiar estados y dejar comentarios (`get_issue`, `save_issue`, `save_comment`, `list_issue_statuses`).

Si el MCP no está disponible en la sesión, usar la API GraphQL como fallback:
- Endpoint: `https://api.linear.app/graphql` — Header: `Authorization: <LINEAR_API_KEY>`
- Leer issue: `query { issue(id: "...") { title description state { name } } }`
- Obtener IDs de estado: `query { workflowStates { nodes { id name } } }`
- Mover estado: `mutation { issueUpdate(id: "...", input: { stateId: "..." }) { success } }`
- Comentar: `mutation { commentCreate(input: { issueId: "...", body: "..." }) { success } }`

---

## `/wf-define [fase?]` o `wf-define [fase?]` — PLAN

**Objetivo:** descomponer una fase del roadmap en issues ejecutables y cargarlos en Linear.

Si el roadmap de la fase y su DoD ya existen y están alineados, `wf-define` no rediseña la fase: entra directamente a **planeación táctica de issues**.

PLAN no parte de issues existentes — parte de una fase definida en el roadmap. El output es el conjunto de issues que el agente de BUILD va a ejecutar.

**Agente responsable:** `/wf-define` lo conduce el rol definido en `.agents/agents/product-manager.md`.

Ese rol usa `.agents/skills/skill-product-manager/SKILL.md` como marco principal y activa skills especializados según el contexto de la fase. `workflow.md` define el protocolo; el documento del agente define la estrategia de orquestación.

**Resolución de fase:**
- Con argumento (`/wf-define fase-2`): usar la fase indicada.
- Sin argumento (`/wf-define`): leer `workflow/status.json` → tomar `active_phase` como fase a planificar. Si la fase activa ya tiene todos sus issues creados en Linear, confirmar al humano antes de continuar.

**Contexto a cargar:**
1. `workflow/status.json` — fase activa y qué está construido.
2. `workflow/define/roadmap.md` — alcance y dependencias de la fase.
3. El subconjunto estricto de documentos de `workflow/context/` citados en la línea `Referencia` de cada issue del roadmap.
4. `.agents/skills/skill-product-manager/SKILL.md` — cómo estructurar issues ejecutables, jerarquía en Linear y template de Issue Brief.

**No cargar por defecto:** skills técnicos (frontend, backend, database), testing. Solo si un issue de la fase los requiere explícitamente.

**Excepción arquitectónica:**
- Si la fase o los issues implican desktop, shared core, runtime boundaries, save path, sync/hydration, parser/serializer o extracción de servicios, cargar también `.agents/skills/skill-architecture/SKILL.md` antes de redactar briefs.
- En esos casos, cada issue debe salir de DEFINE con un **Architecture Contract** mínimo en el brief:
  - `Layer`
  - `Runtime scope`
  - `Owner`
  - `Contracts touched`
  - `Invariants`
  - `Required docs`

**Secuencia (Diálogo de Alineación y Ejecución):**
1. Resolver la fase (ver lógica de fallback arriba).
2. Leer `workflow/status.json` y localizar la fase en `workflow/define/roadmap.md`.
3. Actualizar `workflow/status.json` definiendo explícitamente la `active_phase` actual.
4. Buscar si existe un documento `workflow/define/dod-[fase].md` (ej. `dod-fase-1.md`) para la fase actual.
5. **Si no existe el DoD:** Pausar y co-crear el DoD iterando con el humano, basándose en el roadmap y los objetivos de experiencia.
6. **Si existe el DoD:** El agente cruza el Roadmap contra el DoD. Si hay asimetrías de alcance, el agente dialoga con el humano para **complementar** el Roadmap y/o el DoD. Nada se borra, se enriquece el contrato.
7. Una vez que ambos documentos están alineados y el humano da luz verde, proceder. Si la fase ya estaba estratégicamente definida, este paso marca el cambio explícito a planeación táctica de issues.
8. Leer `.agents/skills/skill-product-manager/SKILL.md`.
9. Si algún issue de la fase toca arquitectura o runtime boundaries, leer `.agents/skills/skill-architecture/SKILL.md` antes de fijar ownership y `Reference docs`.
10. Descomponer la fase en issues atómicos. **Para cada issue, leer ÚNICAMENTE los documentos de contexto listados en su línea `Referencia:`**.
11. Redactar el Issue Brief estructurándolo según las guías de `.agents/skills/skill-product-manager/SKILL.md`. El agente DEBE inyectar como *Proof of Work/Acceptance Criteria* las pruebas rigurosas exigidas por el DoD para ese alcance.
    - Si el issue toca presentación de texto, incluir explícitamente `Presentation Contract` cross-mode (`/write/[id]`, `/preview/[token]`, `/shared/[id]`, `/{username}/{slug}`) con criterios verificables.
    - Si el issue toca arquitectura, runtime boundaries, desktop/shared-core, save path, sync/hydration, parser/serializer o extracción de servicios, agregar en el brief un `Architecture Contract` obligatorio con: `Layer`, `Runtime scope`, `Owner`, `Contracts touched`, `Invariants`, `Required docs`.
12. Crear los issues en Linear con su brief incluido.
13. Confirmar al humano: lista de issues creados, dependencias entre ellos y orden de ejecución sugerido. Ofrecer un comando `/wf-audit` si el humano quiere revisar la calidad de los issues contra el DoD.
14. Entregar una `Execution Trace` explícita del proceso con:
    - `Planning role`
    - `Skills loaded`
    - `Specialist consults`
    - `Audit run`
    - `Artifacts created`
    - `Why`

**Gate de salida:** los issues definidos en esta ejecución creados en Linear, cada uno con su Issue Brief completo. Sin brief por issue no hay BUILD. Si un issue es arquitectónico y no incluye `Architecture Contract`, DEFINE no está completo.

**No es un output válido de DEFINE:** dejar un breakdown táctico solo en markdown dentro del repo sin persistirlo en Linear.
**No es un output trazable suficiente de DEFINE:** decir que “se usó” un rol o skill sin declararlo en la `Execution Trace`.

**Restricción:** no abrir ramas ni escribir código en esta etapa.

---

## `/wf-build [issue-id?]` o `wf-build [issue-id?]` — BUILD

**Objetivo:** implementar sobre el brief aprobado.

**Estado Linear:** `Todo` o `Backlog` (con brief) → `In Progress` al iniciar → `In Review` al dejar PR listo.

**Resolución de issue:**
- Con argumento (`/wf-build ODE-22`): usar el issue indicado.
- Sin argumento (`/wf-build`): consultar Linear → buscar issues en estado `Todo` o `Backlog` que tengan Issue Brief y pertenezcan a la fase activa en `status.json` → tomar el de mayor prioridad según orden del roadmap → confirmar al humano el issue seleccionado antes de iniciar.

**Contexto a cargar:**
1. El Issue Brief desde Linear.
2. Los documentos listados en la sección `Reference docs` del brief — son los únicos que aplican. No cargar nada adicional por deducción propia.

**Excepción obligatoria por gap de contexto arquitectónico:**
- Si el brief toca desktop, shared core, runtime boundaries, filesystem local, `.md` como contrato documental, extracción de servicios (`DocumentService`, `SyncService`, etc.) o migración web → desktop, y no cita la secuencia desktop en `Reference docs`, el agente debe detener BUILD y marcar `Context Gap` bloqueante.
- En ese caso, no improvisar contexto desde el código. Pedir corrección del brief para incluir, según aplique:
  - `workflow/context/features/odessay-desktop-app.md`
  - `workflow/context/features/odessay-desktop-migration-diagnostic.md`
  - `workflow/context/features/odessay-desktop-target-architecture.md`
  - `workflow/context/features/odessay-desktop-migration-plan.md`
- Si el brief toca esos mismos scopes y además no incluye `Architecture Contract` con `Layer`, `Runtime scope`, `Owner`, `Contracts touched`, `Invariants` y `Required docs`, BUILD también debe detenerse con `Context Gap` bloqueante. No inferir ese contrato desde el diff ni desde el código existente.

**Secuencia:**

**Setup**
1. Leer brief. Declarar Performance Contract y Presentation Contract solo para las dimensiones/superficies que realmente toca el issue. Si una dimensión o superficie no aplica, registrar `not required` con justificación breve en vez de expandir evidencia innecesaria.
   > _Presentation Contract: paridad cross-surface en `/write/[id]`, `/preview/[token]`, `/shared/[id]`, `/{username}/{slug}` — `tables`, `pre/code` y URLs largas con wrap, contención y scroll equivalentes entre superficies._
   > _Architecture Contract: si el brief toca desktop/shared-core/runtime boundaries/save/sync/parser/services, BUILD debe operar dentro de `Layer`, `Runtime scope`, `Owner`, `Contracts touched`, `Invariants` y `Required docs` ya definidos. Si falta uno, detenerse._
2. Mover issue a `In Progress` en Linear. Verificar rama con `git branch --show-current` — si es `main`, crear `codex/{issue-id}-{descripcion}` antes de cualquier edición.
3. Pre-flight: `npm run env:check --if-present` + `npm run ops:status:drift --if-present`.
   - Si aparece un identificador histórico inválido o huérfano, registrarlo en `workflow/status.json.traceability_exceptions.ignored_issue_ids` con razón concreta. No volver a copiar ese falso positivo en notas de `status.json`, PRs o reviews posteriores.

**Ejecución**
4. Implementar según el brief. Commits atómicos: `tipo(scope): descripción [ISSUE-ID]`.

**Validación**
5. `npm run typecheck` + `npm run lint` + `npm test`. Si Performance Contract es `required`, generar la evidencia indicada en el brief. Guardar outputs — van en el body del PR.
6. `npm run ops:delivery:gate` (con `OPS_PERF_TRACE_PATH=...` si Performance Contract es required). Debe terminar en verde.

**Entrega**
7. `git push -u origin {rama}`. Abrir el PR con body completo (link al issue, qué se hizo, cómo testear, outputs del paso 5). Verificar body no vacío: `gh pr view {número} --json body | jq -e '.body | length > 0'`. Si falla, editar con `gh pr edit {n} --body "..."` antes de continuar.
8. Confirmar PR en OPEN: `gh pr view {número} --json state`. Mover issue a `In Review` en Linear. Dejar comentario con Context Report completo:
   - `Context Gaps Detected = yes` si faltó o fue ambiguo al menos uno de: alcance, contrato de datos, evidencia requerida, dependencias, referencias documentales.
   - `Missing or Ambiguous Context`: describir qué faltó exactamente (no frases genéricas).
   - `Additional Instructions Requested`: listar las instrucciones extra pedidas al humano durante BUILD.
   - `Decisions Made During Build`: decisiones tomadas para destrabar ejecución.
   - `Recommended Context Fixes`: cambios concretos en issue brief/docs/skills para prevenir repetición.
9. Emitir `BUILD completado` en la conversación. Si algún paso anterior falló y no se pudo resolver, emitir `HANDOFF REQUERIDO — [motivo exacto]`.

**Restricción de workflow en BUILD:** la rama de feature **no toca** `workflow/review-history.jsonl` ni `workflow/status.json`. Ambos archivos se actualizan únicamente en `main` post-merge durante REVIEW. Esto elimina conflictos de merge cuando múltiples worktrees corren en paralelo.

**Gate de salida:** pasos 5 y 6 en verde + PR abierto con body completo (paso 7) + issue en `In Review` (paso 8). Sin eso, el issue no puede estar en `In Review` ni emitirse `BUILD completado`.

---

## `/wf-review [issue-id?]` o `wf-review [issue-id?]` — REVIEW

**Objetivo:** verificar calidad del PR y cerrar la trazabilidad del issue.

**Estado Linear:** `In Review` → `Done` (si aprobado, el agente hace merge y cierra) o `In Progress` (si rechazado).

**Resolución de issue:**
- Con argumento (`/wf-review ODE-22`): usar el issue indicado.
- Sin argumento (`/wf-review`): consultar Linear → buscar issues en estado `In Review` de la fase activa → si hay uno, tomarlo directamente. Si hay más de uno, listarlos y pedir al humano que confirme cuál revisar.

**Contexto a cargar:**
1. El Issue Brief desde Linear.
2. El diff del PR.
3. `.agents/skills/skill-code-review/SKILL.md`.
4. Si el brief tiene `Performance Contract` requerido: artefactos de performance del PR (trace + report + output de gate).
5. Si el brief tiene `Presentation Contract` requerido: evidencia cross-mode (`write`, `preview`, `shared`, `public`) con foco en tablas, `pre/code`, URLs largas y overflow.
6. Si el brief toca desktop/shared core/runtime boundaries/save path/sync/parser/serializer/servicios: `.agents/skills/skill-architecture/SKILL.md` + el `Architecture Contract` del brief.

**No cargar por defecto:** documentos core, features, roadmap.

**Pre-check obligatorio — antes de cualquier otra acción:**
Ejecutar `gh pr list --head <rama-del-issue>` y verificar que existe exactamente un PR en estado `OPEN`.
- Si no existe PR: emitir HANDOFF al humano indicando que BUILD no completó su gate, mover el issue a `In Progress` y no continuar el review.
- Si existe PR: continuar con la secuencia normal.

**Secuencia — si aprobado:**
1. Verificar gate:
   - `npm run ops:delivery:gate` debe terminar en verde (con `OPS_PERF_TRACE_PATH` cuando el contrato es requerido).
   - CI `Traceability Gates` en SUCCESS.
   - Preview deploy (Vercel) en SUCCESS — un PR que toca código y no compila en preview no puede mergearse aunque el delivery gate local pase.
   - **Excepción perf:** cuando el brief declara `Performance Contract: not required` con justificación válida, los fallos del perf gate por métricas no requeridas o por hardware de CI no bloquean aprobación; en ese caso el perf gate actúa como informativo. Además, para métricas requeridas con `grace_lte` en `workflow/perf-budgets.json`, un overrun pequeño dentro de la banda de gracia cuenta como `WARN`, no como `FAIL`. Lo que sí debe estar verde sin excepción es traceability, Vercel preview y typecheck/lint.
2. Validar `Performance Contract` contra evidencia objetiva (solo si es required):
   - existe trace reproducible;
   - `node scripts/check-performance-gate.mjs --trace <trace>` no reporta `required_failures`;
   - la evidencia está adjunta en PR/issue.
3. Validar `Architecture Contract` cuando aplica:
   - el diff respeta `Layer` declarado;
   - no invade runtimes o adapters fuera de `Runtime scope`;
   - el owner efectivo del cambio coincide con `Owner`;
   - `Contracts touched` e `Invariants` están preservados o actualizados explícitamente;
   - los `Required docs` del brief siguen alineados con la implementación final.
4. Revisar diff contra el brief (scope, calidad, seguridad, performance).
5. Dejar comentario en Linear: resultado de revisión.
   - El comentario de REVIEW debe separar explícitamente:
     - `GateResult` (PASS/FAIL de contratos/checks),
     - `QualityScore` (calidad técnica del diff),
     - `ProcessInsights` (fallos del primer review, correcciones posteriores, gaps de contexto y recomendaciones).
   - Agregar evento en `workflow/review-history.jsonl` (append-only) con tipo:
     - `review_rejected` o `review_approved`,
     - incluyendo `issue`, `pr_url`, `branch`, `commit`, `score`, `gate_result`, `ts`, `reviewer`, `notes`.
6. Hacer merge del PR via CLI: `gh pr merge {número} --merge`.
7. Volver a `main`: `git switch main`.
8. Sincronizar `main` local con remoto: `git pull --ff-only origin main`.
9. En `main`, appendear **ambos** eventos a `workflow/review-history.jsonl` (append-only): primero `build_submitted` con los datos del PR (branch, commit HEAD, PR URL, notas de BUILD), luego `review_approved` con los datos del review (score, gate_result, reviewer, findings). Antes de commitear, validar que `workflow/review-history.jsonl` y `workflow/status.json` sean parseables:
   ```bash
   node scripts/validate-workflow-json.mjs
   git add workflow/review-history.jsonl
   git commit -m "chore(workflow): append build_submitted + review_approved for {ISSUE-ID} [{ISSUE-ID}]"
   git push origin main
   ```
   > El evento `build_submitted` se aplaza a REVIEW para evitar que la rama de feature toque archivos de workflow, eliminando conflictos de merge en worktrees paralelos.
10. Agregar el issue completado a la lista `built` en `workflow/status.json` especificando la fase terminada. Antes de commitear, validar que el JSON resultante es parseable:
   ```bash
   node scripts/validate-workflow-json.mjs
   git add workflow/status.json
   git commit -m "chore(workflow): record {ISSUE-ID} in status.json built [{ISSUE-ID}]"
   git push origin main
   ```
11. Mover issue a `Done` en Linear.

**Nota:** el agente ejecuta el merge directamente. No requiere confirmación del humano salvo que el humano haya indicado explícitamente que quiere aprobar el merge manualmente.

**Secuencia — si rechazado:**
1. Dejar comentario en Linear con hallazgos específicos que bloquean aprobación.
   - Incluso en rechazo, reportar `QualityScore` y `ProcessInsights` por separado para no perder aprendizaje del ciclo.
   - Registrar `review_rejected` en `workflow/review-history.jsonl` (append-only) antes de mover estado.
   - Commitear el entry en `main` y pushear:
     ```bash
     git switch main
     node scripts/validate-workflow-json.mjs
     git add workflow/review-history.jsonl
     git commit -m "chore(workflow): append review_rejected for {ISSUE-ID}"
     git push origin main
     git switch -
     ```
2. Rechazar automáticamente si se cumple cualquiera de estas condiciones:
   - falta evidencia de performance cuando el contrato es requerido;
   - hay `required_failures > 0` o métricas requeridas faltantes en `check-performance-gate`;
   - no existe justificación explícita cuando el brief marcó `Performance Contract: not required`.
   - falta evidencia de paridad cross-mode cuando `Presentation Contract` es requerido.
   - el issue requería `Architecture Contract` y este no existe, está incompleto o el diff lo contradice.
   - existe un **security finding** aplicable al diff sin parche aplicado: open redirect, XSS via `dangerouslySetInnerHTML` sin sanitizar, SSRF en URLs construidas con input externo, secrets en logs/cliente, validación faltante en boundary (route handler, API public, webhook).
   - Vercel preview deploy en FAILURE — no se aprueba un PR que rompe el build/deploy, aunque el delivery gate local pase.
3. Mover issue a `In Progress`.
4. No cerrar ni eliminar el PR — mantener rama activa.

**Restricción:** no agregar alcance nuevo en REVIEW. Solo correcciones derivadas del review.

**Regla anti-conflicto para `workflow/review-history.jsonl`:**
- Es un log append-only; nunca editar ni borrar líneas previas.
- En conflictos de merge/rebase, conservar ambas entradas y mantener orden temporal por append.
- Si dos agentes escriben al mismo tiempo, resolver conservando todas las líneas válidas JSON.

**Política de security findings:** un hallazgo de seguridad — por más leve o no-explotable-trivialmente que parezca — se trata como bloqueante desde el primer review, independientemente del dominio (auth, API pública, ingestión de archivos, queries SQL, secrets, validación de input). No usar frases como "conviene cerrar" o "antes del re-review" en el primer comentario: usar "bloquea aprobación" e incluir el patch sugerido inline.

Categorías que activan esta política, no exhaustivas:
- redirects/router accediendo a input sin validar (open redirect);
- inyección — SQL en queries raw, comandos en `exec`, HTML en `dangerouslySetInnerHTML`, XSS reflejado en query params;
- SSRF — fetch a URLs construidas con input externo sin allowlist;
- IDOR — acceso a recursos por ID sin verificar ownership;
- CSRF en routes que mutan estado sin token o sin SameSite;
- path traversal en file serving o uploads;
- mass assignment / overposting en endpoints de update;
- secrets en logs, en cliente, o en commits;
- validación faltante en boundary (route handler, API pública, webhook, server action);
- desactivación silenciosa de checks (`@ts-ignore` sobre código de seguridad, `eslint-disable` sobre rules de security, `--no-verify` en hooks).

Excepción: si el finding ya existía en `main` antes del PR y es claramente fuera de scope, abrir issue de seguridad separado y referenciarlo; pero seguir bloqueando si el PR amplía la superficie afectada o si el código tocado por el PR queda al lado del finding (no se cierra un PR que pasa por encima de un hueco visible).

El razonamiento detrás de la política: cuando se marca un finding como "no bloqueante para probar", el costo de cerrar el round de review desaparece, pero el finding se queda en la rama y suele postergarse hasta que vuelve como hard reject en el siguiente review — el costo total crece, no baja. Es más barato pedirlo en el primer review.

---

## `/wf-ship [issue-id]` o `wf-ship [issue-id]` — SHIP

**Objetivo:** implementar sobre el brief aprobado, abrir PR y cerrar el issue en Linear sin pasar por wf-review. El PR queda abierto para que el humano decida cuándo mergear.

**Estado Linear:** `Todo` o `Backlog` (con brief) → `In Progress` al iniciar → `Done` al confirmar PR.

**Resolución de issue:**
- Con argumento (`/wf-ship ODE-22`): usar el issue indicado.
- Con `--batch <nombre>` (`/wf-ship ODE-22 --batch fase8-ui`): el issue pertenece a un batch. La rama compartida es `codex/batch-<nombre>`; el PR tiene título `batch(<nombre>): ODE-X` que se actualiza acumulativamente con cada issue del lote.
- Con `--branch <nombre>` (`/wf-ship ODE-22 --branch codex/ode-245-foo`): trabajar sobre esa rama existente en lugar de crear una nueva.

**Contexto a cargar:**
1. El Issue Brief desde Linear.
2. Los documentos listados en la sección `Reference docs` del brief — son los únicos que aplican.

**Excepción obligatoria por gap de contexto arquitectónico:** aplica la misma excepción que wf-build (ver sección BUILD). Si el brief toca desktop, shared core, runtime boundaries o servicios sin citar la secuencia desktop en `Reference docs`, detener SHIP y marcar `Context Gap` bloqueante.

**Secuencia:**

**Setup**
1. Leer brief. Declarar Performance Contract y Presentation Contract solo para las dimensiones que realmente toca el issue.
2. Resolver la rama de trabajo:
   - Si se pasó `--batch <nombre>`: usar `codex/batch-<nombre>`.
     - Si la rama no existe: `git switch -c codex/batch-<nombre>`.
     - Si ya existe: `git switch codex/batch-<nombre>`.
   - Si se pasó `--branch <nombre>`: `git switch <nombre>` — la rama ya existe, no crear nada.
   - Si no se pasó ninguno y la rama actual no es `main`: trabajar en la rama actual.
   - Si no se pasó ninguno y la rama actual es `main`: `git switch -c codex/{issue-id}-{descripcion}` antes de cualquier edición.
3. Mover issue a `In Progress` en Linear.
4. Pre-flight: `npm run env:check --if-present` + `npm run ops:status:drift --if-present`.

**Ejecución**
5. Implementar según el brief. Commits atómicos: `tipo(scope): descripción [ISSUE-ID]`.

**Validación**
6. `npm run typecheck` + `npm run lint` + `npx vitest run`. Si Performance Contract es `required`, generar la evidencia indicada en el brief. Guardar outputs.
7. Ejecutar el delivery gate con el base ref correcto:
   - **Sin `--batch` ni `--branch`** (rama propia del issue): `npm run ops:delivery:gate`
   - **Con `--batch` o `--branch`** (rama compartida con otros issues): `GITHUB_BASE_REF=origin/{rama} npm run ops:delivery:gate`
   El base ref limita el gate a los commits nuevos de este issue, excluyendo commits anteriores de la rama que pertenecen a otros issues. Debe terminar en verde.

**Entrega**
8. `git push -u origin {rama}`. Luego verificar si ya existe un PR abierto para esta rama:
   ```bash
   gh pr list --head {rama} --state open --json number,title,body
   ```
   - **Si ya existe PR (modo `--batch` o rama compartida)**:
     1. Leer título actual: `gh pr view {número} --json title`.
     2. Construir nuevo título agregando el ID: `batch(<nombre>): ODE-X, ODE-Y, {ISSUE-ID}`.
     3. Appendear sección de este issue al body existente (formato abajo).
     4. `gh pr edit {número} --title "<nuevo-título>" --body "<body-acumulado>"`.
   - **Si no existe PR**:
     - Con `--batch`: título inicial `batch(<nombre>): {ISSUE-ID}`.
     - Sin `--batch`: título descriptivo del issue.
     - Body con la sección de este issue (formato abajo).

   **Formato de body (batch):**
   ```markdown
   ## Issues
   - {ISSUE-ID}: [título] — <link Linear>

   ## {ISSUE-ID} — Qué se hizo
   <descripción de los cambios>

   ## {ISSUE-ID} — Cómo testear
   <pasos de verificación>

   ## {ISSUE-ID} — Validación
   <outputs de typecheck, lint, vitest, delivery gate>
   ```
   Cada `wf-ship` appenda su bloque `## {ISSUE-ID}` y agrega una línea al listado `## Issues`.

   Verificar body no vacío: `gh pr view {número} --json body | jq -e '.body | length > 0'`.
9. Confirmar PR en OPEN: `gh pr view {número} --json state`.
10. Actualizar `workflow/status.json` y `workflow/review-history.jsonl` en la **rama de feature** (no en main):
    - Agregar el issue a `built` de la fase activa en `status.json`.
    - Appendear evento `ship_completed` a `review-history.jsonl`.
    ```bash
    node scripts/validate-workflow-json.mjs
    git add workflow/status.json workflow/review-history.jsonl
    git commit -m "chore(workflow): record {ISSUE-ID} ship_completed [{ISSUE-ID}]"
    git push origin {rama}
    ```
11. Dejar comentario en Linear con Context Report completo. **Este paso es obligatorio — no avanzar al paso 12 hasta confirmar que el comentario fue creado** (MCP retorna el ID del comentario; GraphQL retorna `success: true`):
    - `Context Gaps Detected = yes | no`
    - `Missing or Ambiguous Context`: describir qué faltó exactamente (no frases genéricas).
    - `Additional Instructions Requested`: instrucciones extra pedidas al humano durante SHIP.
    - `Decisions Made During Build`: decisiones tomadas para destrabar ejecución.
    - `Recommended Context Fixes`: cambios concretos en issue brief/docs para prevenir repetición.
    - Outputs de validación: typecheck, lint, vitest, delivery gate.
    - Link al PR.
    Si la llamada falla o no retorna confirmación: reintentar una vez. Si sigue fallando: reportar el bloqueo al humano y no mover a Done hasta resolverlo.
12. Mover issue a `Done` en Linear. Solo ejecutar este paso tras haber recibido confirmación del comentario en el paso 11.
13. Emitir `SHIP completado — PR #{número} abierto, listo para merge manual.`

**Restricción:** NO hacer `gh pr merge`. NO hacer `git switch main`. NO tocar `main`. Los archivos `workflow/review-history.jsonl` y `workflow/status.json` se actualizan en la **rama de feature** (no en main), a diferencia del flujo BUILD+REVIEW.

**Gate de salida:** pasos 6 y 7 en verde + PR abierto con body completo (paso 8) + `workflow/status.json` y `review-history.jsonl` actualizados en la rama de feature (paso 10) + comentario Context Report confirmado en Linear con ID retornado (paso 11) + issue en `Done` (paso 12).

---

## `/wf-review-ships [issue-ids]` o `wf-review-ships [issue-ids]` — REVIEW-SHIPS

**Objetivo:** revisar la calidad de varios PRs abiertos por wf-ship en paralelo. No hace merge a main. Solo quality check y comentario en Linear.

**Estado Linear:** sin cambios de estado — solo se deja comentario de revisión en cada issue.

**Resolución de issues:**
- Con argumento (`/wf-review-ships ODE-246,ODE-247`): usar los issues indicados (separados por coma).
- Con `--batch <nombre>` (`/wf-review-ships ODE-246,ODE-247 --batch fase8-ui`): equivale a `--branch codex/batch-<nombre>`. Usar cuando el batch fue creado con `wf-ship --batch`.
- Con `--branch <nombre>`: todos los issues comparten un único PR abierto desde esa rama. El `--branch` debe coincidir con el que se usó en `wf-ship`.

**Contexto a cargar:**
1. El Issue Brief de cada ID desde Linear.
2. El diff del PR correspondiente (`gh pr diff`).
3. `.agents/skills/skill-code-review/SKILL.md`.
4. Si algún brief tiene `Performance Contract` requerido: artefactos de performance del PR.
5. Si algún brief tiene `Architecture Contract`: el contrato del brief.

**Localizar el PR:**

Con `--batch {nombre}`: resolver rama como `codex/batch-{nombre}` y continuar igual que `--branch`.

Con `--batch {nombre}` o `--branch {nombre}`:
```bash
gh pr list --head {rama} --state open --json number,title,url
```
Si no hay PR abierto: error, reportar y detener.

Sin `--batch` ni `--branch` (un PR por issue):
```bash
gh pr list --state open --json number,title,body,headRefName | \
  jq '.[] | select(.body | contains("{ID}"))'
```
Si no hay PR para un issue: marcar `SIN PR — skipped` y continuar con los demás.

**Modos de revisión:**

**Sin `--batch` ni `--branch`** — cada issue tiene su propio PR. El diff de cada PR cubre exclusivamente ese issue. Revisar cada PR de forma independiente.

**Con `--batch` o `--branch`** — todos los issues comparten un único PR y un único diff acumulado. En este caso:
- El diff completo cubre múltiples issues; no se puede aislar por archivo.
- Aislar los commits de cada issue por su etiqueta:
  ```bash
  git log origin/{branch}..HEAD --oneline --grep="\[{ID}\]"
  ```
- Revisar cada issue contra los commits etiquetados con su ID. Si un commit no tiene etiqueta de ningún issue del grupo, marcarlo como `commit sin trazabilidad` en el Context Report.
- Los gates de calidad (`typecheck`, `lint`, `vitest`, `delivery gate` con `GITHUB_BASE_REF=origin/{rama}`) se corren una sola vez para el PR completo y aplican a todos los issues.

**Secuencia:**
1. Obtener briefs y diffs en paralelo (un agente por issue cuando sea posible).
2. Para cada issue, contrastar sus commits (o el diff completo si no hay `--branch`) con su brief:
   - Correctness: ¿los commits del issue implementan lo que el brief pide?
   - Seguridad: aplica la misma política que wf-review — cualquier finding es bloqueante.
   - Performance Contract: si es `required`, verificar que hay evidencia adjunta en el PR.
   - Architecture Contract: verificar que el diff respeta `Layer`, `Runtime scope`, `Owner` e `Invariants`.
3. Emitir resultado por issue:
   - `SHIP REVIEW APROBADO [ODE-XXX]` — sin hallazgos bloqueantes.
   - `SHIP REVIEW CON OBSERVACIONES [ODE-XXX]` — hallazgos no bloqueantes, PR puede mergearse.
   - `SHIP REVIEW RECHAZADO [ODE-XXX]` — hallazgos bloqueantes (listar con patch sugerido inline).
4. Dejar comentario en cada issue de Linear con el resultado:
   ```
   GateResult: PASS | FAIL
     - typecheck / lint / vitest / delivery gate: ✓ | ✗
     - Performance Contract: cumplido | no requerido | falta evidencia
     - Architecture Contract: cumplido | no aplica | violación detectada

   QualityScore: <calidad técnica del diff>

   ProcessInsights:
     - Hallazgos bloqueantes: <lista o "ninguno">
     - Hallazgos no bloqueantes: <lista o "ninguno">
     - Recomendaciones para el brief/docs: <o "ninguna">

   Resultado: SHIP REVIEW APROBADO | CON OBSERVACIONES | RECHAZADO [ODE-XXX]
   ```
5. Emitir resumen consolidado:
   ```
   wf-review-ships completado
   ──────────────────────────────────────────
   ODE-246  APROBADO       — sin hallazgos
   ODE-247  OBSERVACIONES  — 1 finding no bloqueante (ver Linear)
   ODE-248  RECHAZADO      — 2 findings bloqueantes (ver Linear)
   ──────────────────────────────────────────
   Listos para merge manual : ODE-246, ODE-247
   Requieren fix            : ODE-248
   ```

**Restricción:** NO hacer `gh pr merge`. NO hacer `git switch main`. NO tocar `main`.

**Política de security findings:** aplica la misma política que wf-review — cualquier finding de seguridad es bloqueante desde el primer review, independientemente del dominio.

**Gate de salida:** comentario de revisión dejado en cada issue de Linear + resumen consolidado emitido.

---

## `/wf-debrief [issue-id?]` o `wf-debrief [issue-id?]` — POST-ENTREGA

**Objetivo:** capturar observaciones post-entrega y convertir las relevantes en issues de mejora en Linear, sin reabrir ni modificar el issue original.

Este comando existe porque la realidad después de un merge rara vez coincide exactamente con lo planeado. No es un error de planificación — es información nueva que emerge al ver el producto funcionando. La política es: **la entrega se acepta como está**. Lo que no quedó perfecto se captura aquí y entra al ciclo normal de BUILD.

**Resolución de issue:**
- Con argumento (`/wf-debrief ODE-22`): trabajar sobre ese issue específico.
- Sin argumento (`/wf-debrief`): consultar Linear → tomar el issue más recientemente movido a `Done` en la fase activa.

**Contexto a cargar:**
1. El issue original desde Linear (brief + comentarios de BUILD y REVIEW).
2. `workflow/define/debrief.md` — sección de la fase activa, para agregar entradas y consultar el historial.

**No cargar por defecto:** documentos core, features, skills técnicos. Si una observación requiere validar comportamiento esperado, consultar el doc de feature correspondiente usando `workflow/docs.json`.

**Secuencia:**
1. Resolver el issue de referencia (ver fallback arriba).
2. Leer el issue original en Linear: brief, comentarios de BUILD, comentarios de REVIEW.
3. Por cada observación del humano o hallazgo propio: crear una entrada en `workflow/define/debrief.md` bajo la sección de la fase activa, con ID estable (`IMP-YYYY-MM-DD-NN`), descripción, tipo y prioridad sugerida.
4. Clasificar cada entrada por tipo: `bug` / `mejora` / `ux-friction` / `deuda-tecnica`.
5. Clasificar cada entrada por prioridad sugerida: `next-sprint` / `backlog` / `won't-do`.
6. Presentar al humano el resumen de entradas capturadas y proponer cuáles crear como issues en Linear.
7. Para las que el humano aprueba: crear el issue en Linear con el tipo correcto (Bug, Improvement, etc.), referencia al issue original y un brief mínimo.
8. Dejar comentario en el issue original de Linear enlazando los nuevos issues creados.

**Gate de salida:** entradas en `workflow/define/debrief.md` + issues aprobados creados en Linear.

**Restricción:** no modificar el scope ni reabrir el issue original. No cambiar código en esta etapa.

---

## `/wf-health` o `wf-health` — CONTEXT HYGIENE

**Objetivo:** ejecutar un chequeo de salud documental para reducir context rot entre `workflow/` y `.agents/skills/`, especialmente en flujos AI del editor.

**Resolución:**
- Se ejecuta sin argumentos: `/wf-health`.

**Contexto a cargar:**
1. `workflow/define/context-hygiene-prompt.md` (fuente de verdad del ejercicio).
2. `workflow/docs.json`.
3. `workflow/agents.md`.
4. `workflow/decisions.json`.
5. `workflow/status.json`.
6. Documentos/skills que el prompt indique explícitamente como foco.

**No cargar por defecto:** todo `workflow/context/` completo. Solo los documentos mencionados por el prompt o detectados como afectados.

**Secuencia:**
1. Leer `workflow/define/context-hygiene-prompt.md`.
2. Auditar consistencia de rutas, naming y contratos entre skills y workflow.
3. Detectar referencias legacy, rutas rotas y desalineaciones de contrato.
4. Corregir documentación afectada con cambios mínimos y trazables.
5. Si se crea/mueve/elimina documentos, actualizar `workflow/docs.json`.
6. Validar integridad de JSON (`docs.json`, `decisions.json`, `status.json`).
7. Entregar resumen: archivos cambiados, inconsistencias resueltas y riesgos abiertos.

**Gate de salida:** inconsistencias críticas corregidas + `workflow/docs.json` sincronizado + validación de JSON en verde.

**Restricción:** `/wf-health` corrige contexto y documentación; no implementa funcionalidades de producto.

---

## `/wf-update-docs` o `wf-update-docs` — MANTENIMIENTO DE DOCS

**Objetivo:** mantener `workflow/docs.json` sincronizado con el estado real del disco.

**Dos modos de uso:**

**Modo puntual (tras una tarea):** si la tarea creó, movió o eliminó un documento, actualizar solo esa entrada en `docs.json`. No releer todo el disco.

**Modo profundo (mantenimiento explícito):** cuando se invoca `/wf-update-docs` directamente.

**Secuencia modo profundo:**
1. Listar todos los archivos en `workflow/` y `.agents/skills/` que sean documentos de contexto (`.md`, `.json` relevantes).
2. Comparar contra el `registry` en `workflow/docs.json`.
3. Para cada archivo en disco que no está en el registry: agregar entrada con `path`, `type` y `description` basada en el contenido real del archivo.
4. Para cada entrada en el registry que no existe en disco: eliminar la entrada.
5. Para archivos que existen en ambos pero cuya descripción está desactualizada respecto al contenido: actualizar solo la descripción afectada.
6. No tocar entradas que no tienen cambios.

**Restricción:** no leer todos los documentos por defecto — leer solo los que tienen discrepancia entre descripción en `docs.json` y su contenido real.

---

## `/wf-decision` o `wf-decision` — GESTIÓN DE DECISIONES

**Objetivo:** registrar formalmente una decisión técnica o de arquitectura en el historial canónico.

**Resolución de issue:**
- Se ejecuta sin argumentos adicionales: `/wf-decision`.

**Contexto a cargar:**
1. El issue actual y la discusión en Linear.
2. `workflow/decisions.json`.
3. El documento en `workflow/context/` más afín al dominio de la decisión (consultar `workflow/docs.json`).

**Secuencia:**
1. Extraer la decisión tomada, el contexto y a qué documento afecta.
2. Identificar si es una decisión global (para todo el proyecto) o de fase activa (solo para el ciclo actual).
3. Actualizar `workflow/decisions.json` añadiendo la decisión en el bloque correspondiente con su respectiva referencia documental.
4. Si la decisión modifica algo sustancial, sugerir en la respuesta actualizar el documento de contexto relacionado.
5. Imprimir al humano el registro actualizado para confirmar.

**Gate de salida:** JSON actualizado en `workflow/decisions.json`.

---

## Frontera humano / agente

Algunos issues requieren acciones que el agente no puede completar solo — credenciales, configuración de servicios externos, decisiones de negocio. Cuando un issue tiene esta dependencia, debe declararla explícitamente en el Issue Brief bajo una sección `Dependencias humanas`.

**El agente no bloquea silenciosamente.** Cuando encuentra una dependencia humana, emite el protocolo de handoff y pausa.

**Siempre hace el humano:**
- Asignar issues en Linear.
- Proveer credenciales, variables de entorno y accesos externos.
- Aprobar qué entradas de `/wf-debrief` se convierten en issues.
- Indicar explícitamente si quiere hacer el merge manualmente (por defecto lo hace el agente).

**Siempre hace el agente:**
- Ejecutar la secuencia `/wf-*` respetando los gates.
- Hacer merge del PR tras REVIEW APROBADO: `gh pr merge {número} --merge`.
- Tras merge confirmado en REVIEW, volver a `main` y sincronizar (`git switch main` + `git pull --ff-only origin main`) antes de iniciar el siguiente BUILD.
- Mover estados en Linear según este documento.
- Actualizar `workflow/status.json` estableciendo la fase en PLAN y agregando los issues completados a `built` al pasar a `Done` en REVIEW.
- Dejar comentario de trazabilidad en Linear al cerrar cada etapa.

## Protocolo de handoff (bloqueo externo)

Cuando el agente encuentra una dependencia humana y no puede continuar:

```
⏸ HANDOFF REQUERIDO

Etapa actual: [PLAN|BUILD|REVIEW]
Bloquea: [qué no puede avanzar]
Completé: [trabajo ya realizado]
Necesito que tú: [acción concreta y específica]
Evidencia esperada: [qué debe compartir el humano para reanudar]
Reanudación: [acción exacta que hará el agente al recibir evidencia]
```

Durante un handoff en BUILD, el issue permanece en `In Progress`. No mover a `In Review` mientras exista handoff pendiente.
