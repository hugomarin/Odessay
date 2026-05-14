# Scoring Guide — Code Review Odessay

Guía de scoring para el agente revisor. Este documento es referencia — el scoring se aplica desde `SKILL.md`.

---

## Modelo de scoring (separado)

El review debe reportar tres resultados distintos:

1. `GateResult` (PASS/FAIL): contratos y gates operativos.
2. `QualityScore` (0-10): calidad técnica del diff.
3. `ProcessInsights`: aprendizaje del ciclo (fallos de primera ronda, churn y gaps de contexto).

`GateResult` decide merge/no-merge. `QualityScore` no reemplaza gates.

---

## QualityScore (código/solución)

```
quality_score = max(0, 10 - (P0_count * 3 + P1_count * 2 + P2_count * 0.5 + P3_count * 0.25))
```

Redondear a 1 decimal. Cap en 10.

### Cálculo obligatorio — escribir paso a paso

Antes de emitir el veredicto final, el revisor debe escribir EXPLÍCITAMENTE este bloque. No omitir. No resumir. No redondear antes del último paso.

```
Findings contabilizados:
- P0 (CRITICAL) = __
- P1 (HIGH)     = __
- P2 (MEDIUM)   = __
- P3 (LOW)      = __

Penalización:
  P0 × 3.0 = __
  P1 × 2.0 = __
  P2 × 0.5 = __
  P3 × 0.25 = __
  ─────────────
  Total     = __

QualityScore = max(0, 10 - __) = __
Redondeado a 1 decimal = __/10
```

**Regla de oro:** Si el bloque de cálculo no aparece, el review está incompleto. El score del veredicto DEBE coincidir exactamente con el resultado de este cálculo.

### Umbrales de calidad (no de gate)

| QualityScore | Lectura | Acción sugerida |
|-------|-----------|--------|
| 9.0 – 10.0 | Sólido | Merge si `GateResult=PASS` |
| 7.0 – 8.9 | Bueno con deuda menor | Merge si `GateResult=PASS` + follow-up |
| 5.0 – 6.9 | Inestable | Pedir cambios |
| < 5.0 | Débil | Rechazar |

### Overrides de gate (se reportan fuera de QualityScore)

- Si hay **algún P0 activo**: `GateResult=FAIL`.
- Si `required_failures > 0` en performance gate requerido: `GateResult=FAIL`.
- Si falta proof of work (typecheck/lint/tests): `GateResult=FAIL`.
- Si PR no está OPEN/CI requerido en rojo/evidencia contractual faltante: `GateResult=FAIL`.
- **Findings investigados y descartados:** Si durante el review se investiga un finding y se determina que es un falso positivo (ej. se revisa el diff y el cambio es legítimo), ese finding NO se cuenta en el score. Eliminarlo del bloque de cálculo. Solo contar findings que el revisor considera válidos al momento del veredicto.

El `QualityScore` puede ser alto y aun así rechazarse por `GateResult=FAIL`.

---

## ProcessInsights (aprendizaje del ciclo)

Obligatorio en cada review final:

1. `FirstReviewFailures`: lista de fallos detectados en primera ronda.
2. `ResolvedInLaterRounds`: cuáles se corrigieron después.
3. `ContextGaps`: ambigüedades o faltas de contexto que causaron retrabajo.
4. `BuildInstructionChurn`: instrucciones adicionales pedidas durante BUILD.
5. `Recommendations`: cambios concretos a brief/docs/skills para reducir churn.

Si el primer rechazo fue por contexto/proceso (no por lógica), se debe declarar explícitamente.

---

## Confidence Calibration

Todo finding debe incluir `(confidence: N/10)`. Sin excepciones. Un finding sin confidence es inválido y no cuenta para el score.

| Score | Significado | Display |
|-------|-------------|---------|
| 9-10 | Verificado leyendo código específico. Bug o exploit demostrable. | Mostrar normal |
| 7-8 | Match de patrón de alta confianza. Muy probable. | Mostrar normal |
| 5-6 | Moderado. Puede ser falso positivo. | Mostrar con caveat |
| 3-4 | Baja confianza. Sospechoso pero puede estar bien. | Apéndice |
| 1-2 | Especulación. | Suprimir |

### Regla de caveat para 5-6
Agregar después del finding:
> *(Medium confidence — verificar que esto sea realmente un issue en este contexto)*

---

## Formato de findings

Cada finding debe seguir ESTRICTAMENTE este formato:

```
[Px] (confidence: N/10) path/to/file.ts:NNN — category: descripción breve y específica
```

### Ejemplos correctos

**P2 (MEDIUM):**
```
[P2] (confidence: 9/10) editor-shell.tsx:648 — performance: setHydrationWritingId(null) dispara re-render no declarado en la PR note
```

**P3 (LOW):**
```
[P3] (confidence: 7/10) editor-hydration-session.test.ts:8 — test-gap: createRouteHydrationSessionState(null) sin test de ruta /write sin ID
[P3] (confidence: 6/10) editor-shell.tsx — debt-technical: tres sitios de actualización para currentWritingIdRef.current, consolidar en efecto de sync
[P3] (confidence: 5/10) app/api/writings/route.ts — missing-edge-case: resolveExternalWritingLoad(null, 'writing-1') no cubierto en tests
```

**Prohibido:** bullets sueltos, findings sin confidence, sin path, o sin categoría.

---

## Fingerprint

Para deduplicar findings entre múltiples revisores o especialistas:

```
{archivo}:{linea}:{categoria}
```

Ejemplo: `app/api/writings/route.ts:42:sql-injection`

Si dos findings comparten fingerprint, es más probable que sea real. En modo Claude Enhancement, esto activa `MULTI-SPECIALIST CONFIRMED`.

---

## Categories de findings

Usar estas categorías para mantener consistencia:

- `sql-injection` — interpolación de strings en queries
- `rls-bypass` — acceso a datos sin verificar RLS
- `auth-missing` — endpoint sin autenticación
- `secret-exposure` — API key o secret expuesto al cliente
- `race-condition` — estado compartido sin sincronización
- `performance-critical-path` — degradación en editor/auto-save/sync
- `typescript-strict` — `any`, `@ts-ignore`, tipos incorrectos
- `design-inconsistency` — desviación de `skill-design.md`
- `test-gap` — funcionalidad nueva sin test
- `missing-edge-case` — happy path testeado, error path no
- `scope-creep` — archivos modificados fuera del scope del issue
- `debt-technical` — código duplicado, abstracción incorrecta
