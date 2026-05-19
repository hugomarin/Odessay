---
name: skill-code-review
description: |
  Estándares de code review y checklist de entrega para Odessay. Consulta este skill antes de abrir un PR.
  Autoevalúa tu trabajo con este checklist. Portable — funciona con cualquier agente. Claude enhancements disponibles.
---

# Skill: Code Review (Odessay)

---

## Principio rector

Un PR debe ser mergeable por alguien que no escribió el código. Debe ser claro, completo, y no romper nada.

**Y cada PR debe responder esta pregunta:**

> ¿Este cambio hace que la app se sienta más rápida e inmediata, o la vuelve más pesada y frágil?

Si no hay una respuesta clara, el PR necesita más trabajo.

---

## PR — Formato

Cada PR debe incluir:

- **Título:** `feat: {descripción corta}` o `fix: {descripción corta}`
- **Issue:** Referencia al issue de Linear que resuelve
- **Qué se hizo:** Descripción breve de los cambios
- **Cómo testear:** Pasos para verificar que funciona
- **Screenshots/grabaciones:** Si hay cambios visuales

---

## Proof of work — obligatorio antes de abrir PR

Pegar en la descripción del PR el output de:
```bash
npm run typecheck
npm run lint
npm test
```

Sin estos tres outputs en el PR, el review no empieza.

---

## Contrato de performance — criterio bloqueante

Todo PR debe declarar el estado del contrato de performance del issue:

- `required`: toca el critical path de interacción (editor/input/click/paste, auto-save, sync o AI en escritura).
- `not required`: no toca runtime de interacción. Debe incluir justificación explícita.

Si el contrato es `required`, el PR debe adjuntar evidencia obligatoria:

```bash
npm run ops:perf:capture -- --output artifacts/perf/editor-trace.json.gz
npm run ops:perf:gate -- --trace artifacts/perf/editor-trace.json.gz
OPS_PERF_TRACE_PATH=artifacts/perf/editor-trace.json.gz npm run ops:delivery:gate
```

Mínimo esperado en la descripción del PR:
- output de `ops:perf:gate` con `required_failures: 0`;
- output de `ops:delivery:gate` usando `OPS_PERF_TRACE_PATH`;
- rutas de artefactos generados en `artifacts/perf/` (trace, metrics, report).

Si el contrato es `not required`, el PR debe incluir una sección corta: "Performance contract: not required — {justificación}".

---

## Checklist de calidad

### Trazabilidad histórica (obligatoria)
- [ ] ¿Se agregó evento append-only en `workflow/review-history.jsonl` para esta ronda?
- [ ] ¿El evento usa tipo correcto (`build_submitted`, `review_rejected`, `review_approved`)?
- [ ] ¿Incluye `issue`, `branch`, `pr_url`, `commit`, `ts`, `notes` (y en review: `score`, `gate_result`)?
- [ ] ¿No se editaron ni borraron entradas previas del archivo?

### Tests — verificar primero
- [ ] `npm test` pasa sin errores y sin dependencias externas (sin Supabase real, sin red).
- [ ] Los nuevos tests usan mocks para Supabase y fixtures para datos. No conectan a staging.
- [ ] Si el issue introduce funcionalidad nueva, existe al menos un test que la cubre.
- [ ] Los tests E2E con Playwright corren separados de los unitarios (`npm run test:e2e`).

### Velocidad — verificar segundo
- [ ] ¿El editor sigue aislado? ¿Un keystroke no re-renderiza el sidebar ni paneles?
- [ ] ¿El auto-save guarda local primero, sync remoto en background?
- [ ] ¿Ninguna operación de AI bloquea el flujo de escritura?
- [ ] ¿No se agregaron dependencias pesadas sin justificación?
- [ ] ¿Los paneles secundarios nuevos se cargan con lazy load?
- [ ] ¿La app puede abrir y editar documentos sin conexión a red?
- [ ] ¿El PR declara `Performance Contract` (`required` o `not required`) con justificación?
- [ ] Si es `required`, ¿hay trace + gate report + delivery gate con `OPS_PERF_TRACE_PATH`?
- [ ] Si es `required`, ¿`required_failures` es `0` y no hay métricas requeridas faltantes?

### Consistencia transicional — verificar tercero (si el PR toca transiciones críticas)
- [ ] ¿Cada transición crítica tiene un único owner? No hay `router.push()` + `setState` simultáneos para el mismo cambio.
- [ ] ¿Hay una sola fuente de verdad por dimensión de estado? No se replica `writingId` en URL, Zustand y ref al mismo tiempo.
- [ ] ¿Los estados intermedios observables están modelados explícitamente? No hay lógica escondida en `if (x && y && !z)`.
- [ ] ¿Ninguna identidad se crea en el hot path de `input`, `paste` o `click`? Los UUIDs y writes a localDB ocurren antes o después, no en el handler síncrono.
- [ ] ¿Los tests cubren el estado intermedio, no solo el final? Un test que solo asserta "al final está bien" no detecta flicker transitorio.
- [ ] ¿Se validaron interrupciones? Tab switch, rehidratación, sync tardío o cambio de scope en medio de la transición.

### Código
- [ ] TypeScript estricto. Sin `any`. Sin `@ts-ignore`.
- [ ] Sin `console.log` residuales (solo `console.error` intencionales).
- [ ] Sin código comentado. Si no se usa, se borra.
- [ ] Sin dependencias nuevas innecesarias. Si se agrega una, justificar en el PR.
- [ ] Funciones y variables con nombres descriptivos en inglés.
- [ ] Componentes pequeños, una sola responsabilidad.

### Nomenclatura semántica
- [ ] Cada módulo nuevo tiene `id`, `data-page`, `data-section`, `data-testid`
- [ ] Clases BEM en PascalCase presentes para identificación
- [ ] Nombres de componentes coinciden con su clase BEM

### Seguridad
- [ ] Sin API keys o secrets expuestos al cliente.
- [ ] RLS cubre los datos que se leen/escriben.
- [ ] Input validado con Zod en API routes.
- [ ] Autenticación verificada en rutas protegidas.
- [ ] No se opera contra producción.

### Consistencia con Odessay
- [ ] ¿Respeta la simplicidad radical? ¿No agrega UI innecesaria?
- [ ] ¿No introduce métricas visibles para el usuario?
- [ ] ¿Tipografía y spacing consistentes con `skill-design.md`?
- [ ] Si toca presentación textual: ¿cumple contrato en `.agents/skills/skill-design/tipografia.md`?
- [ ] Si toca tipografía: ¿paridad entre `.odessay-editor-content` y `.prose-odessay` sin divergencias?
- [ ] ¿Se preserva overflow de tablas grandes (`tableWrapper`, `width:max-content`, scroll horizontal interno)?
- [ ] ¿ShadCN customizado para la marca, no con defaults?
- [ ] ¿El PR respeta el contrato AI por scope?
  - AI editor residente (`observe/discuss`): no genera texto autoral, SILENCIO válido.
  - AI writing assist (`corrections/title`): salida estructurada de sugerencias, sin auto-aplicación.
- [ ] ¿Los bordes son `0.5px`? ¿Los iconos tienen `strokeWidth={1.5}`?

### Base de datos
- [ ] Migraciones versionadas y con rollback documentado.
- [ ] `odessay-modelo-datos.md` actualizado si hubo cambios de schema.
- [ ] RLS policies testeadas.
- [ ] Índices creados para queries nuevas.
- [ ] Los writings tienen `version` y `sync_status` si aplica.

### Testing
- [ ] Flujos críticos afectados tienen test E2E.
- [ ] Tests pasan en staging.
- [ ] Auto-save verificado con reload.
- [ ] Mobile: lectura funciona, escritura bloqueada.

### Documentación
- [ ] Si el cambio afecta la arquitectura, los docs están actualizados.
- [ ] Si se agrega un endpoint nuevo, está documentado.
- [ ] Si se cambia el schema, `odessay-modelo-datos.md` refleja el cambio.

---

## Red flags — Rechazar PR si:

- El editor no está aislado — keystrokes re-renderizan componentes externos.
- Auto-save va directo a Supabase sin base local primero.
- Una llamada de AI bloquea o congela el editor.
- Hay `any` en TypeScript.
- API keys expuestas al cliente.
- No hay RLS en tablas nuevas.
- No hay test para flujo crítico nuevo.
- Se viola el contrato AI por scope (editor residente vs writing assist).
- Se agregó UI que el issue no pedía.
- Se cambió tipografía en una sola superficie sin espejo en la otra.
- Se alteró el contrato tipográfico sin actualizar/verificar `.agents/skills/skill-design/tipografia.md`.
- Se rompió el overflow interno de tablas grandes.
- Se agregaron dependencias pesadas sin justificación.
- El issue exige `Performance Contract: required` y no hay trace/evidencia objetiva.
- `check-performance-gate` reporta `required_failures > 0`.
- Se marcó `Performance Contract: not required` sin justificación explícita.
- No hay descripción del PR o no referencia el issue.
- Se operó contra producción.
- Usar `router.push()` para cambios de estado interno dentro de una vista funcional (tabs, filtros, paneles).
- Disparar navegación RSC (`?_rsc=`) para datos que ya están en `localDB`.
- Implementar tabs, filtros, o paneles como rutas navegables cuando son estado de UI.
- **Transición co-owned:** dos o más mecanismos (router, estado local, Zustand, refs) deciden el resultado de una misma transición crítica.
- **Estado intermedio no modelado:** la UI pasa por un estado inválido entre inicio y fin que no está representado explícitamente (ej. contenido de tab A mostrándose mientras el título ya es tab B).
- **Tests que solo cubren estado final:** no hay assertions sobre estados intermedios ni simulación de interrupciones (tab switch durante carga, rehidratación concurrente, sync tardío).
- **Identidad creada en hot path:** `crypto.randomUUID()`, `localDB.save()`, o cualquier efecto secundario de persistencia dentro del handler síncrono de `input`, `paste` o `click`.
- **Múltiples fuentes de verdad para una dimensión:** `writingId` vive simultáneamente en params, estado local, Zustand y refs sin un owner claro.
- El PR toca AI corrections/title suggestions/ProseMirror y no actualiza o no valida los documentos de referencia correspondientes (`odessay-ai-writing-assist.md`, `odessay-prosemirror-tiptap.md`) cuando cambió el contrato real.

**Referencias para verificación:**
- `workflow/context/features/odessay-sync.md` — principio de navegación interna, arquitectura local-first, caso de estudio del editor
- `workflow/context/core/odessay-arquitectura.md` — decisión de arquitectura sobre navegación interna vs navegación de página
- `workflow/context/features/odessay-ai-writing-assist.md` — contrato operativo de AI corrections + title suggestion
- `workflow/context/features/odessay-prosemirror-tiptap.md` — extensiones activas, backbone Markdown y guardrails de decorations/round-trip

## Documentación mínima por scope (obligatoria en review)

Si el PR toca alguno de estos scopes, el revisor debe verificar coherencia con docs:
- AI corrections / streaming / accept-reject memory:
  - validar contra `workflow/context/features/odessay-ai-writing-assist.md`.
- TipTap / ProseMirror extensions / decorations / parser-serializer:
  - validar contra `workflow/context/features/odessay-prosemirror-tiptap.md`.
- Si el código final contradice el doc y el doc no fue actualizado:
  - rechazo por desalineación de contrato (no merge).

---

## Formato de findings estructurado

Todo finding del review debe usar ESTRICTAMENTE este formato:

```
[SEVERIDAD] (confidence: N/10) archivo:linea — categoria: descripción
  Fix: fix recomendado o "necesita juicio humano"
```

**Ejemplos correctos:**
```
[P2] (confidence: 9/10) editor-shell.tsx:648 — performance: setHydrationWritingId(null) dispara re-render no declarado en la PR note
  Fix: envolver en startTransition(() => setHydrationWritingId(null))

[P3] (confidence: 7/10) editor-hydration-session.test.ts:8 — test-gap: createRouteHydrationSessionState(null) sin test de ruta /write sin ID
  Fix: agregar it() con null como parámetro

[P3] (confidence: 6/10) app/api/writings/route.ts — missing-edge-case: resolveExternalWritingLoad(null, 'writing-1') no cubierto
  Fix: agregar assertion en test existente
```

**Reglas:**
- `categoria:` es obligatoria. Sin ella el finding es inválido.
- `confidence: N/10` es obligatorio para TODO finding, incluso P3.
- `archivo:linea` es obligatorio. Si no aplica línea exacta, usar `archivo —` (con espacio antes del em-dash).
- NO usar bullets sueltos. Cada finding debe ser una línea con el formato completo.

**Severidades:**
- `[P0]` — Bloqueante. Seguridad, corrupción de datos, crash en producción.
- `[P1]` — Crítico. Bug funcional, performance degradation en critical path.
- `[P2]` — Importante. Deuda técnica, edge case no manejado, inconsistencia de diseño.
- `[P3]` — Informativo. Sugerencia de mejora, optimización menor, estilo.

**Confidence (1-10):**
| Score | Significado | Regla de display |
|-------|-------------|------------------|
| 9-10 | Verificado leyendo código concreto. Bug o exploit demostrable. | Mostrar normal |
| 7-8 | Match de patrón de alta confianza. Muy probable que sea correcto. | Mostrar normal |
| 5-6 | Moderado. Puede ser falso positivo. | Mostrar con caveat: "Medium confidence, verificar" |
| 3-4 | Baja confianza. Patrón sospechoso pero puede estar bien. | Apéndice solo |
| 1-2 | Especulación. | Suprimir |

**Fingerprint:** `{archivo}:{linea}:{categoría}` — para deduplicar si múltiples revisores encuentran lo mismo.

---

## PR Quality Score

Al final de todo review, computar:

```
score = max(0, 10 - (P0_count * 3 + P1_count * 2 + P2_count * 0.5 + P3_count * 0.25))
```

Cap en 10. Redondear a 1 decimal.

### Cálculo obligatorio

Escribir EXPLÍCITAMENTE antes del veredicto:

```
Findings contabilizados:
- P0 = __
- P1 = __
- P2 = __
- P3 = __

Penalización: (P0×3) + (P1×2) + (P2×0.5) + (P3×0.25) = __
Score = max(0, 10 - __) = __/10
```

El score del veredicto debe coincidir exactamente con este cálculo. Si no se muestra el paso a paso, el review está incompleto.

| Score | Veredicto |
|-------|-----------|
| 9.0 - 10 | Aprobado sin reservas |
| 7.0 - 8.9 | Aprobado con observaciones menores |
| 5.0 - 6.9 | Requiere cambios antes de merge |
| < 5.0 | Rechazado — necesita trabajo significativo |

**Ajustes especiales:**
- P0 activo → score máximo 4.0 (rechazado).
- P1 en critical path del editor → score máximo 6.9 (cambios requeridos).
- Performance gate con `required_failures > 0` → score máximo 5.0.
- Sin proof of work (typecheck/lint/tests) → score = 0.0.
- Findings investigados y descartados como falso positivo → NO contar en el score.

El score no reemplaza el juicio humano, pero da una medida objetiva de calidad que puede trackearse entre PRs.

## Resultado obligatorio del review (3 capas)

Todo review debe cerrar con:

1. `GateResult`: `PASS` o `FAIL` (contratos y checks operativos).
2. `QualityScore`: cálculo P0-P3 sobre calidad del diff.
3. `ProcessInsights`: aprendizaje del ciclo BUILD→REVIEW.

Formato mínimo:

```
GateResult: PASS|FAIL
QualityScore: X.Y/10
ProcessInsights:
- FirstReviewFailures: [...]
- ResolvedInLaterRounds: [...]
- ContextGaps: [...]
- BuildInstructionChurn: [...]
- Recommendations: [...]
```

Si `GateResult=FAIL`, el veredicto es rechazo aunque `QualityScore` sea alto.

## Señales de contexto insuficiente (obligatorio reportar)

Marcar `context_risk=true` cuando ocurra al menos uno:
- Se pidieron instrucciones adicionales para definir alcance/contrato.
- El brief era ambiguo en schema, endpoint, dependencia o evidencia requerida.
- La documentación de referencia estaba incompleta o desactualizada.
- El criterio de aceptación cambió durante BUILD.

Cuando `context_risk=true`, el review debe incluir recomendaciones específicas de mejora de contexto (issue brief, docs o skills).

---

## Protocolo del agente revisor

Este protocolo aplica cuando un agente es invocado desde Linear usando **"Open in Claude Code"** sobre un issue en estado **In Review**. El agente no es el implementador — es el revisor. Su trabajo es verificar y aprobar, no modificar código.

### Identificar el rol antes de empezar

Antes de hacer cualquier cosa, el agente debe leer el estado del issue en Linear. Si el issue está en **In Review**, este protocolo aplica. Si está en **In Progress** o **Todo**, aplica el protocolo de implementación (`workflow/SETUP.md` + CLAUDE.md).

### Checklist de revisión — en orden

**1. Proof of work presente**
- ¿El PR incluye output de `npm run typecheck`? ¿Sin errores?
- ¿El PR incluye output de `npm run lint`? ¿Sin errores?
- ¿El PR incluye output de `npm test`? ¿Sin errores?

Si falta alguno de los tres → **rechazar**. No hay nada que revisar sin proof of work.

**2. Contrato de performance resuelto**
- ¿El issue/PR declara `Performance Contract` como `required` o `not required`?
- Si es `required`: ¿existe trace reproducible (`artifacts/perf/*.json.gz`)?
- Si es `required`: ¿`npm run ops:perf:gate -- --trace <trace>` pasa sin `required_failures`?
- Si es `required`: ¿`OPS_PERF_TRACE_PATH=<trace> npm run ops:delivery:gate` está en verde?
- Si es `not required`: ¿la justificación está escrita y es coherente con el scope?

Si falla cualquiera de estos puntos → **rechazar**.

**3. Trazabilidad Linear ↔ GitHub**
- ¿El issue en Linear tiene un comentario del agente implementador con: link al PR + commit SHA + resultado de validaciones?
- ¿El PR referencia el issue (ej. `feat(setup): init Next.js baseline [ODE-10]`)?
- Si `ops:status:drift` ya está resuelto o el identificador figura en `workflow/status.json.traceability_exceptions.ignored_issue_ids`, no repetirlo como finding ni como nota de contexto en el review actual.

Si falta el comentario de trazabilidad → **rechazar**. La conexión Linear ↔ GitHub es obligatoria.

**4. Archivos modificados vs. ## Files affected**
- Comparar los archivos tocados en el PR contra la sección `## Files affected` del issue.
- Si hay archivos modificados que no estaban en `## Files affected` → evaluar si el cambio es scope creep o una adición justificada.
- Si hay archivos listados en `## Files affected` que no fueron modificados → verificar si el issue quedó incompleto.

**5. Red flags del checklist**
- Revisar la lista de Red flags de este skill contra los cambios del PR.
- Si se detecta alguno → **rechazar** con descripción del problema específico.

**6. Score y findings estructurados**
- Revisar el diff aplicando el formato de findings estructurado.
- Computar PR Quality Score.
- Si score < 5.0 → **rechazar**.
- Si score < 7.0 → **solicitar cambios**.

**7. status.json actualizado**
- ¿Se agregó una entrada en `workflow/status.json → built` con el issue ID, commit SHA y fecha?
- Si el issue era el último de la fase activa → ¿se actualizó `active_phase`?

### 8. Persistencia del score

Al finalizar cualquier review (aprobado, rechazado o con cambios solicitados), appendear el resultado a `workflow/review-history.jsonl`:

```bash
BRANCH=$(git branch --show-current)
COMMIT=$(git rev-parse --short HEAD)
node -e "
const fs = require('fs');
const entry = JSON.stringify({
  ts: new Date().toISOString(),
  issue: 'ODE-XX',
  branch: process.env.BRANCH,
  score: 8.3,
  P0: 0, P1: 1, P2: 2, P3: 1,
  reviewer: 'kimi',
  commit: process.env.COMMIT,
  verdict: 'approved|changes_requested|rejected'
}) + '\n';
fs.appendFileSync('workflow/review-history.jsonl', entry);
"
```

Si el archivo no existe, crearlo. Este log es la fuente de verdad para tendencias de calidad.

Tras appendear, commitear el entry en `main` y pushear:
```bash
git add workflow/review-history.jsonl
git commit -m "chore(workflow): append review_approved|review_rejected for ODE-XX [ODE-XX]"
git push origin main
```

### Integración con Linear

Usar `scripts/linear-cli.mjs` para sincronizar el estado del review:

```bash
# Obtener contexto del issue
node scripts/linear-cli.mjs get ODE-XX

# Postear resultado
node scripts/linear-cli.mjs comment ODE-XX "Review result..."

# Mover estado si aplica
node scripts/linear-cli.mjs move ODE-XX "In Progress"  # si hay cambios solicitados
node scripts/linear-cli.mjs move ODE-XX "Done"         # si está aprobado
```

### Decisión final

**Si todos los checks pasan y score >= 7.0:**
```
✅ REVIEW APROBADO — Score: X/10

Issue: [ODE-XX]
PR: [link]
Commit: [SHA]
Validaciones: typecheck ✅ | lint ✅ | tests ✅
Trazabilidad: comentario en Linear ✅ | status.json actualizado ✅

Acción: aprobación técnica completa. Ejecutando merge.
```

Con REVIEW APROBADO, ejecutar en este orden:

→ Postear el texto anterior como comentario en Linear (`scripts/linear-cli.mjs comment`).
  **El comentario debe incluir el PR Quality Score en la primera línea.**
→ Hacer merge del PR: `gh pr merge {número} --merge`.
→ Volver a `main`: `git switch main`.
→ Sincronizar `main`: `git pull --ff-only origin main`.
→ Commitear `workflow/review-history.jsonl` y pushear:
  `git add workflow/review-history.jsonl && git commit -m "chore(workflow): append review_approved for {ISSUE-ID} [{ISSUE-ID}]" && git push origin main`
→ Mover el issue a Done en Linear (`scripts/linear-cli.mjs move`).

El agente ejecuta el merge directamente sin esperar confirmación del humano, salvo que el humano haya indicado explícitamente que quiere aprobar el merge manualmente.

**Si algún check falla:**
```
⛔ REVIEW RECHAZADO — Score: X/10

Issue: [ODE-XX]
Problema: [descripción exacta del problema]
Acción requerida: [qué debe corregir el agente implementador]

El issue vuelve a In Progress hasta que se corrija.
```
→ Comentar en Linear con el formato anterior (`scripts/linear-cli.mjs comment`).
→ Commitear `workflow/review-history.jsonl` en `main` y pushear:
  `git switch main && git add workflow/review-history.jsonl && git commit -m "chore(workflow): append review_rejected for {ISSUE-ID} [{ISSUE-ID}]" && git push origin main && git switch -`
→ No hacer merge. Mover issue de `In Review` → `In Progress` (`scripts/linear-cli.mjs move`).
→ No modificar el código — el agente revisor no implementa.

### Lo que el agente revisor NO hace

- No modifica código para corregir errores.
- No hace commits al branch del PR.
- No aprueba PRs que no tienen proof of work completo.
- No hace merge si el review fue rechazado o si el humano indicó explícitamente que quiere hacerlo manualmente.
- No hace merge si hay red flags activos.
- No evalúa si el código "se ve bien" — solo verifica que las condiciones objetivas se cumplan.

---

## Claude Enhancement (opcional — solo si el agente lo soporta)

Si el agente ejecutor tiene acceso a la herramienta `Agent` (subagentes), leer `claude-enhancements.md` y aplicar el modo especialista. Esto multiplica la cobertura del review pero no es obligatorio para que el skill funcione.

Si el agente NO soporta `Agent`, ignorar esta sección. El review base ya es completo.
