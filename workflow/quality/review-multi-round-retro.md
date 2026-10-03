# Reviews multi-ronda en Odessay — retro y propuesta de ajustes

**Fecha:** 2026-10-03
**Base del análisis:** `workflow/review-history.jsonl` en `main@293938fc`, más las notas de `workflow/built.jsonl` cuando el ledger no registra un ciclo intermedio.
**Origen:** ODE-652 necesitó 7 revisiones independientes y 6 ciclos de fix. Este documento comprueba si el caso es aislado o sistémico, y propone ajustes acotados sobre el sistema `/wf-*`. No cambia contratos ni estados por sí mismo.

## 1. Qué dicen los datos

| Métrica | Valor |
|---|---|
| Eventos de review registrados | 179 |
| Issues con al menos un review | 92 |
| Aprobaciones / rechazos | 108 / 71 |
| Issues con ≥1 rechazo | 43 (28 con 1 · 3 con 2 · 11 con 3 · 1 con 4) |
| Issues con ≥2 eventos de review | 50 |
| Score medio al rechazar / al aprobar | 7.15 / 9.62 |
| Findings por severidad en rechazos | P0=2 · P1=28 · P2=50 · P3=26 |
| Rechazos con componente de seguridad o pérdida de datos | 16, en 13 issues |

**Límite del ledger:** registra el veredicto formal de REVIEW, no cada re-review de un ciclo de fix. ODE-652 aparece con 1 rechazo formal aunque tuvo 7 revisiones y 6 ciclos; ODE-609 tiene 9 eventos porque modeló 9 entregas parciales. Los conteos reales de rondas son, por tanto, un piso.

**Top multi-ronda (rechazos formales):**

| Issue | Rechazos | Scores en el camino | Causa principal |
|---|---|---|---|
| ODE-462 | 4 | 7 → 8.8 → 8.75 → 10 | Carrera de cancelación + acoplamiento de boundary; rondas 3-5 bloqueadas por un fallo de CI fuera del código (`git merge-base` en el runner) |
| ODE-408 | 3 | 2.5 → 5.5 → 9.5 | Alcance amplio: estado real en disco roto, orden durable entre Settings/SQLite, evidencia DMG/perf/contrato |
| ODE-479–486 (8 issues) | 3 cada uno | 5 → 6 → 7.5 | El mismo hallazgo sistémico de seguridad (traversal, symlinks, destinos no-`.md`) repetido en 8 briefs del mismo lote |
| ODE-656 | 3 | 7 → 9 → 9.5 | El propio tooling de review: mutaciones que sobrevivían y `HISTORICAL` con falso negativo |
| ODE-616 | 3 | 7.5 → 9 → 9.5 | Carrera del lock de Supabase local, limpieza de usuarios y un borde de autorización (`author_id <> viewer`) con Note sobredeclarada |
| ODE-609 | 2 | 9.3 → 9 | 9 entregas parciales: tests verdes con el código de `main` y una mutación declarada "no construible" que sí lo era |
| ODE-644 | 2 | 10 → 8 | Promoción de SYNC-05 sin mutación discriminante (R1 verde) y Vercel en rojo |
| ODE-588 | 2 | 7 → 7 | Rename pendiente que sobrevive a la navegación; segundo camino por el lápiz durante hidratación; brief pedía web y desktop, solo había web |
| ODE-652 (este issue) | 1 formal / 6 ciclos | 7.5 → 10 | Invariante de atribución con múltiples vectores de carrera y de ciclo de vida del dueño |

## 2. Patrones recurrentes

Clasificación de los 71 rechazos por las notas y findings (categorías solapables; conteo por mención):

### P1 — La prueba no discrimina la conducta que afirma (38/71)
Mutaciones que quedan verdes, aserciones tautológicas, tests que pasan con el código de `main`, "no construible" sin intento reproducible, fixes que editan el cuerpo del `it.fails`, producción dentro de un commit `test(...)`, o cobertura declarada que el propio test desmiente.

Evidencia: ODE-609 (test verde con main; mutación de suscripción construible a nivel de hook), ODE-613 (M5 verde: el replay descartaba las respuestas de Rust), ODE-614 (F2/F3 verdes y Req. 4 omitido), ODE-616 R2 (guards de release y de URL/status sin falsificar), ODE-618 (la mutación 3 no producía el rojo declarado), ODE-629 (el test esperaba a que el save terminara y no veía la carrera), ODE-636 (el fix editaba el `it.fails`; producción en commit test), ODE-644 (R1 verde por `updated == 0`), ODE-656 (mutaciones del propio precheck sobreviven), ODE-658 (mutación de storage-api verde), ODE-611 (M4 verde y "sin pérdida de datos" falso).

### P2 — Carreras y ciclo de vida del dueño (33/71)
Cancelación stale, rename vs save, orden de peticiones, locks, watchers, y dueños de estado que mueren a mitad de una operación (cierre de panel, focus, cero pestañas, remount). ODE-652 es el caso extremo: las rondas 1-3 fueron orden de peticiones y las 4-6 fueron destrucción del dueño; el diseño final (época de escritura + keep-alive) no se modeló al inicio.

Evidencia: ODE-462 (cancelación), ODE-588 (rename pendiente), ODE-604/629 (rename vs save con ventana entre `rename_file` y el commit del catálogo), ODE-616 (lock), ODE-652 (7 vectores).

### P3 — Gates mecánicos y trazabilidad (40/71)
CI rojo por razones ajenas o del rango de comparación (`merge-base` inexistente en el runner, rama detrás de main, rango `base..head` que incluye commits ya en main, un subject con ODE ajeno, Vercel), drift de status/ledger, y desalineación del nombre de rama Linear ↔ Orca.

Evidencia: ODE-462 rondas 3-5 (merge-base), ODE-648 (subject con ODE-670 → drift), ODE-644 (Vercel), ODE-408 (rama detrás), ODE-601/604 (gitBranchName distinto al de Orca), ODE-618/637/658 (rollups y notas del mapa desincronizados), ODE-652 (rango de traceability bloqueado por commits docs ya en main).

### P4 — La evidencia documental contradice el estado (24/71)
Filas del capability map subidas antes de tener prueba, Notes que dicen "remains PARTIAL" con Status `INTEGRATION`, docs/tests comments stale, o el token `HISTORICAL` del precheck que suprime una contradicción vigente.

Evidencia: ODE-626, ODE-629, ODE-636, ODE-637, ODE-644, ODE-615, ODE-618, ODE-658, ODE-601.

### P5 — Alcance del brief más estrecho que la invariante (25/71)
El brief enumera un escenario y la invariante es multi-vector; requisitos omitidos sin `Context Gap`; tests que entran por un camino que producción no usa (`NON_PRODUCTION_PATH`); preguntas de alcance sin respuesta que terminan en rechazo.

Evidencia: ODE-652 (un escenario vs matriz completa), ODE-588 (web-only con brief web+desktop), ODE-614 (Req. 4 omitido), ODE-657 (preguntas de split sin respuesta, `context_risk=true`), ODE-615 (Status sobredeclarado).

### P6 — Seguridad y pérdida de datos (16 rechazos, 13 issues)
Concentrado en el lote 479–486 (traversal/symlinks/destinos internos) y en carreras con pérdida real (ODE-604, 629). No es el patrón dominante, pero es el de mayor impacto y ya está cubierto por la política de seguridad bloqueante.

## 3. Causas raíz

1. **El brief describe escenarios, no la invariante completa.** Para propiedades del tipo "A nunca visible como B" o "el resultado pertenece al documento que inició la acción", la aceptación enumera un caso y el estado real es una matriz: operaciones × transiciones de vida × éxito/error.
2. **No se modela la vida del dueño del estado.** Quién posee el estado, qué transiciones lo destruyen y qué pasa con el trabajo en vuelo no aparece en el Recon ni en el Architecture Contract; se descubre en REVIEW.
3. **La disciplina de mutación se declara pero no siempre se ejecuta.** El workflow ya exige fase roja y mutaciones; los rechazos muestran casos donde la mutación quedó verde y se entregó igual, o el test no falla sin el fix.
4. **El estado de la fila se trata como objetivo y no como conclusión.** Notas y rollups divergen de la evidencia, o el `HISTORICAL` del tooling tapa contradicciones vivas.
5. **Fricción mecánica repetida:** rango del traceability gate, `merge-base` en CI, harness de shell flaky, y nombres de rama Linear/Orca.
6. **Las decisiones de alcance/ownership se escalan tarde.** ODE-652 llegó a la decisión de producto (mantener vivo el dueño) en la ronda 4; las rondas 4-6 podrían haberse anticipado con una parada temprana.

## 4. Propuesta de ajustes

Cada ajuste es acotado y verificable. Nada de esto sustituye el bucle de review: lo hace más corto y menos dependiente de descubrimientos secuenciales.

### 4.1 Matriz obligatoria para invariantes asíncronas o de identidad
- **Problema:** escenario único en el brief (P5, causa 1).
- **Cambio:** `skill-planning` y la plantilla de Issue Brief exigen, para invariantes asíncronas o de identidad, una matriz mínima:

  | Operación | Cambio de documento | Cierre de panel | Focus | Cerrar todas | Remount | Éxito | Error |
  |---|---|---|---|---|---|---|---|
  | load | | | | | | | |
  | generar/rotar | | | | | | | |
  | revocar | | | | | | | |

  La aceptación exige cubrir cada celda alcanzable o nombrar el límite con su razón (regla 10 del proof contract). La matriz viaja al `Recon Pack` y al PR.
- **Archivos:** `.agents/skills/skill-planning/SKILL.md` (o su template), `.agents/agents/planning-agent.md`.
- **Efecto:** ODE-652 habría nacido con 3-4 de sus 7 vectores en el brief; ODE-588 con desktop.
- **Coste:** bajo (plantilla).

### 4.2 Sección "vida del dueño" en Architecture Recon y Architecture Contract
- **Problema:** dueños que mueren a mitad de operación (P2, causa 2).
- **Cambio:** campo obligatorio cuando el estado vive en un componente/página:
  `Owner:` quién posee el estado · `Transiciones que lo destruyen:` (cierre, focus, cero pestañas, remount, navegación) · `Trabajo en vuelo:` qué pasa con él · `Evidencia requerida:` casos de vida mínimos.
- **Archivos:** `.agents/skills/architecture-recon/SKILL.md`, `.agents/agents/build-agent.md` (checklist del contrato), `.agents/skills/skill-architecture/`.
- **Efecto:** ODE-652 rondas 4-6 se habrían planteado en diseño; ODE-462 y ODE-588 también.
- **Coste:** bajo.

### 4.3 Evidencia de discriminación por guard (BUILD) y re-ejecución (REVIEW)
- **Problema:** la mutación más frecuente (P1, causa 3).
- **Cambio:** en el PR, sección obligatoria "Evidencia de discriminación":

  | Guard | Test | Mutación que lo quita | Salida roja (archivo:línea) | ¿Falla sin el fix? |
  |---|---|---|---|---|

  Reglas: una mutación verde se corrige o se retira con razón escrita (ya existe); el builder corre además el test contra `main`/sin el fix para la fase roja; declarar "no construible" exige el intento reproducible pegado.
- **Archivos:** `workflow/workflow.md` (paso de mutaciones), `.agents/agents/build-agent.md`, plantilla de PR.
- **Efecto:** ataca ~la mitad de los rechazos (38/71) en su origen.
- **Coste:** bajo-medio (disciplina de PR).

### 4.4 Playbook de orden asíncrono (nuevo reference)
- **Problema:** carreras recurrentes (P2, causa 1/2).
- **Cambio:** un único reference con los cuatro patrones ya probados en el repo y cuándo usar cada uno:
  1. generación/época en el dueño (RenameWritingModal, ODE-620; estado keyeado por identidad);
  2. serializar o terminar el trabajo en la transición (`renamesInFlight` ODE-629; `prepareDocumentExit` DOC-05);
  3. versionar en la fuente de verdad (cola ODE-611/644);
  4. mantener vivo al dueño mientras hay trabajo pendiente (keep-alive ODE-652).
  Incluye la matriz de decisión y el contraejemplo: épocas locales que no sobreviven a la muerte del dueño.
- **Archivos:** `.agents/skills/skill-frontend/references/async-ownership.md` (o `skill-architecture`), referenciado desde el Recon y el review.
- **Efecto:** ODE-462, 588, 604, 629, 652 dejan de resolverse por descubrimiento.
- **Coste:** medio (un doc nuevo, corto).

### 4.5 Coherencia Status ↔ Note como paso de review + lint acotado
- **Problema:** evidencia documental contra el estado (P4, causa 4).
- **Cambio:** en `skill-code-review`, paso explícito "Status/Note/Evidence dicen lo mismo"; y ampliar `ops:proof:precheck` con una comprobación de contradicciones gruesas (`remains PARTIAL` vs Status no-PARTIAL; rollups vs filas), corrigiendo antes el falso negativo `HISTORICAL` de ODE-656.
- **Archivos:** `.agents/skills/skill-code-review/SKILL.md`, `scripts/lib/proof-precheck.mjs`.
- **Efecto:** ODE-626/629/637/644/615/658.
- **Coste:** medio (tooling con tests discriminantes — aplicando 4.3).

### 4.6 Endurecer gates mecánicos
- **Problema:** CI/drift/trazabilidad (P3, causa 5).
- **Cambios:**
  - traceability: comparar `merge-base..head` o excluir los commits ya presentes en `main` (bug visto en ODE-648 y ODE-652);
  - `HISTORICAL` del precheck: corregir el falso negativo ya reportado (ODE-656);
  - `ops:status:drift:strict`: contemplar entregas parciales sin exigir el ledger completo;
  - Linear ↔ Orca: alinear `gitBranchName` con la rama real, o documentar el espejo en el pre-check de REVIEW.
- **Archivos:** `scripts/check-traceability-gate.mjs`, `scripts/lib/proof-precheck.mjs`, `scripts/check-status-drift.mjs`, `workflow/workflow.md`.
- **Efecto:** elimina rechazos que no son de producto (ODE-462 3 rondas, ODE-408, ODE-644, ODE-648).
- **Coste:** medio-bajo.

### 4.7 Estabilización del harness de shell
- **Problema:** ruido de harness y flakes (P1/P3; causa 5): panel lazy con re-suspensión, `waitFor` de 2 s por defecto, helpers que comprueban "habilitado" justo tras "existe", aislamiento entre tests (pestañas efímeras), carga transitoria de lifecycle que enmascara bugs.
- **Cambio:** pase de hardening del harness (timeouts explícitos, esperas por estado habilitado, limpieza de pestañas al cerrar cada test, dobles con estado para mutaciones) + actualizar el catálogo de flakes (ODE-639/641, `editor-shell-chrome-toc`, `clickPreviewExport`).
- **Archivos:** `tests/support/editor-shell-*`, `workflow/testing/integration-harness-catalog.md`.
- **Efecto:** menos falsos verdes y menos reruns de CI.
- **Coste:** medio.

### 4.8 Escalado temprano de decisiones de alcance u ownership
- **Problema:** decisiones de producto a mitad del bucle (ODE-652 ronda 4; ODE-657 con preguntas sin respuesta).
- **Cambio:** regla explícita en el rol de review: el **primer** hallazgo que implique cambiar ownership, alcance o vida del dueño se detiene y se pregunta con encuadre de producto (como se hizo con ODE-652), en vez de acumular rondas.
- **Archivos:** `.agents/agents/review-agent.md`, `workflow/workflow.md`.
- **Efecto:** convierte rondas 4-6 de ODE-652 en una conversación temprana.
- **Coste:** nulo (regla).

## 5. Qué no se propone

- No exigir la matriz para cambios triviales, de copy o de estilo aislado.
- No sustituir el bucle REVIEW ni el juicio del reviewer por checklists.
- No crear un segundo sistema de scoring ni usar el ledger para performance individual.
- No convertir el proof contract en un documento más largo: los ajustes son punteros y campos, no secciones nuevas.

## 6. Cómo medir la mejora (6 semanas)

| Métrica | Objetivo | Fuente |
|---|---|---|
| Rechazos por issue | mediana ≤1 y cola ≤3 | `review-history.jsonl` (añadiendo el registro de re-reviews de ciclo) |
| % de rechazos por "prueba no discrimina" | <25% | findings/notas clasificadas |
| Issues con gates mecánicos rojos | <5% de PRs | checks de CI |
| Ciclos de fix por issue | mediana ≤1 | eventos + notas de built |

Nota: para medir de verdad los ciclos hay que empezar a registrar las re-reviews de fix en `review-history.jsonl` (o al menos un contador en `built.jsonl`), porque hoy el ledger solo guarda el veredicto formal.

## Anexo A — reproducir el análisis

```sh
git show origin/main:workflow/review-history.jsonl > .cache/review-history-main.jsonl
node - <<'EOF'
const fs = require('fs');
const events = fs.readFileSync('.cache/review-history-main.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l));
const reviews = events.filter(e=>String(e.type).startsWith('review_'));
const rejects = reviews.filter(e=>e.type==='review_rejected');
const per = {};
for (const r of rejects) per[r.issue] = (per[r.issue]||0)+1;
console.log('reviews', reviews.length, 'rejects', rejects.length);
console.log(Object.entries(per).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]));
EOF
```

## Anexo B — top multi-ronda con causa primaria

| Issue | Rechazos | Causa primaria | Categoría |
|---|---|---|---|
| ODE-462 | 4 | cancelación + boundary + CI merge-base | P2/P3 |
| ODE-408 | 3 | alcance amplio + orden durable + evidencia | P2/P5 |
| ODE-479–486 | 3 c/u | seguridad sistémica del lote | P6 |
| ODE-656 | 3 | tooling de review con mutaciones verdes | P1 |
| ODE-616 | 3 | lock + autorización + Note sobredeclarada | P2/P4/P6 |
| ODE-609 | 2 | entregas parciales con tests no discriminantes | P1 |
| ODE-644 | 2 | status sin mutación + Vercel | P1/P3/P4 |
| ODE-588 | 2 | rename pendiente + alcance web-only | P2/P5 |
| ODE-652 | 1 formal (6 ciclos) | matriz de carreras y vida del dueño | P2/P5 |
| ODE-604 | 1 | rename vs save (ventana no cubierta) | P1/P2 |
| ODE-629 | 1 | data-loss entre rename y catálogo | P2/P6 |
| ODE-611 | 1 | pérdida de metadata + mutación verde | P1/P6 |
| ODE-613 | 1 | replay de lazo abierto (M5 verde) | P1 |
| ODE-614 | 1 | falso positivo del harness + requisitos | P1/P3/P5 |
| ODE-615 | 1 | Status sobredeclarado + aserción débil | P4 |
| ODE-618 | 1 | mutación que no rojea + rollup stale | P1/P4 |
| ODE-626 | 1 | test-gap + comentario stale | P1/P4 |
| ODE-636 | 1 | status + commit test contaminado | P1/P4 |
| ODE-637 | 1 | Note vs Status + fixture huérfano | P4 |
| ODE-644 | 2 | promoción sin prueba + Vercel | P1/P3/P4 |
| ODE-648 | 1 | subject con ODE ajeno → drift | P3 |
| ODE-657 | 1 | colisión de inodo entre volúmenes | P2/P6 |
| ODE-658 | 1 | mutación verde + drift documental | P1/P4 |

## Anexo C — redacciones listas para copiar

**Matriz (brief):** "Para toda invariante asíncrona o de identidad, adjuntar la matriz operaciones × transiciones de vida × éxito/error. Cada celda alcanzable se cubre con prueba o se nombra como límite con su razón."

**Vida del dueño (Architecture Contract):** "Owner: `<componente/servicio>`. Transiciones que lo destruyen: `<cierre de panel | focus | cero pestañas | remount | navegación>`. Trabajo en vuelo: `<descartado | conservado con dueño vivo | revalidado>`. Evidencia requerida: `<casos>`."

**Discriminación (PR):** "Guard `<símbolo>:línea>`; test `<archivo:línea>`; mutación que lo quita `<cambio>`; salida roja `<archivo:línea>`; ¿falla sin el fix? `sí/no`."
