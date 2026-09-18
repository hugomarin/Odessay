---
name: skill-code-review
description: |
  Orquesta la investigación técnica de un PR: qué evidencia leer, cuándo activar cada review-*
  y cómo se ve un finding válido. No repite protocolo de Linear/merge/ledgers (workflow.md),
  ni la fórmula de score (scoring.md), ni el checklist de dominio (review-*, specialists/*).
---

# Skill: Code Review (orquestación)

## Principio rector

Un PR debe ser mergeable por alguien que no escribió el código. CI en verde es evidencia de que las reglas mecánicas pasaron — no evidencia de corrección lógica. El review no reejecuta lo que CI ya prueba; investiga lo que CI no puede probar.

---

## Evidencia a leer

Antes de buscar findings:

1. El diff completo — no un resumen ni solo los archivos con más líneas cambiadas.
2. Suficiente código circundante para entender cada path cambiado, no solo las líneas con `+`/`-`.
3. El owner, siblings relevantes y call sites cuando la corrección del cambio dependa de ellos.

No es necesario releer toda la documentación de producto — solo lo que el `Architecture Contract` o `Performance Architecture Contract` del brief ya citó como `Required docs`.

---

## Dispatch — cuándo activar cada lente

| Lente | Activar cuando | Pregunta |
|---|---|---|
| `review-correctness` | el diff toca transiciones críticas, estado async, filtros de negocio o procesa output de LLM | ¿qué comportamiento de producción puede volverse incorrecto? |
| `review-architecture` | el diff toca desktop/multi-runtime, shared core, adapters, contratos de servicio, o trae `Architecture Contract` | ¿extiende el owner canónico o crea uno paralelo? |
| `review-testing` | casi siempre que el diff introduce o modifica comportamiento observable | ¿los tests demuestran el comportamiento, no solo que no explota? |
| `review-change-size` | el diff mezcla dominios no relacionados o supera ~150–200 líneas sin razón estructural | ¿sigue siendo una unidad coherente y revisable? |

No cargar una lente por defecto en diffs triviales o de una línea. Cargar solo las que el scope real del diff activa.

**Dispatch automatizado a subagentes (opcional):** si el agente ejecutor soporta `Agent` (subagentes), `.agents/skills/skill-code-review/claude-enhancements.md` define umbrales de líneas y scope para despachar en paralelo los especialistas de `specialists/security.md`, `specialists/performance.md`, `specialists/data-migration.md`, `specialists/testing.md` — output JSON estricto, mergeado por fingerprint. Es un mecanismo de paralelización, no un sustituto del review base: el review debe ser completo sin él.

---

## Qué es un finding válido

Debe identificar comportamiento/riesgo concreto, `archivo:línea`, causa, condición de falla y dirección de fix.

No es válido: preferencia de estilo, hallazgo hipotético sin path de ejecución concreto, o repetición de algo que lint/typecheck ya cubre.

El formato exacto, las severidades, la calibración de confidence y el fingerprint viven en `.agents/skills/skill-code-review/scoring.md` — no se repiten aquí.

---

## Prioridad de búsqueda

Buscar defectos sistémicos antes que defectos locales:

1. segundo owner de la misma responsabilidad
2. contrato roto (`Architecture Contract`, `Performance Architecture Contract`)
3. consumer olvidado
4. transición incompleta
5. abstracción canónica ignorada
6. comportamiento que solo cubre el happy path

Un finding sistémico cambia cómo se debe corregir el PR entero, no solo una línea — vale más que varios findings locales y debe aparecer primero en el reporte.

---

## Baseline mecánico (no requiere lente dedicada)

Verificación rápida, no investigación profunda:

- [ ] TypeScript estricto: sin `any` nuevo, sin `@ts-ignore` sin justificar
- [ ] Sin `console.log` residual (solo `console.error` intencional)
- [ ] Sin código comentado — si no se usa, se borra
- [ ] Dependencias nuevas justificadas en el PR
- [ ] Nombres descriptivos en inglés, componentes con una sola responsabilidad
- [ ] Nomenclatura semántica: `id`, `data-page`, `data-section`, `data-testid` en módulos nuevos; clases BEM en PascalCase
- [ ] No se operó contra producción durante el desarrollo/testing del cambio

Esta lista es candidata a convertirse en lint/CI (Fase 3 del quality harness); mientras eso no exista, el review la verifica manualmente.

## Consistencia con Odessay (checklist declarativo)

- [ ] Respeta la simplicidad radical — no agrega UI que el issue no pidió
- [ ] No introduce métricas visibles para el usuario
- [ ] Tipografía y spacing consistentes con `.agents/skills/skill-design/SKILL.md`; si toca presentación textual, cumple `.agents/skills/skill-design/tipografia.md` (paridad `.odessay-editor-content` / `.prose-odessay`)
- [ ] Se preserva overflow de tablas grandes (`tableWrapper`, `width:max-content`, scroll horizontal interno)
- [ ] ShadCN customizado para la marca, no defaults sin tocar
- [ ] Bordes `0.5px`, iconos con `strokeWidth={1.5}`

Seguridad, performance, migraciones, arquitectura, correctness, testing y tamaño del cambio tienen su propia lente dedicada (ver `Dispatch`) — no repetir esos checklists aquí.

---

## Resultado obligatorio del review

Todo review debe cerrar con las tres capas que exige `workflow/workflow.md`:

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

Si `GateResult=FAIL`, el veredicto es rechazo aunque `QualityScore` sea alto. El cálculo de `QualityScore` (fórmula, ejemplo paso a paso, overrides de gate) vive en `scoring.md`.

**Señal de contexto insuficiente:** marcar `context_risk=true` cuando se pidieron instrucciones adicionales durante BUILD, el brief era ambiguo en schema/endpoint/dependencia/evidencia, la documentación de referencia estaba desactualizada, o el criterio de aceptación cambió a mitad de BUILD. Con `context_risk=true`, incluir recomendaciones concretas de mejora de contexto (brief/docs/skills) en `ProcessInsights`.

---

## Relación con otras capas

Este skill es la orquestación técnica, no el protocolo completo. Quien busque otra pieza del review, la encuentra aquí:

| Qué necesitas | Dónde vive |
|---|---|
| Rol que conduce `/wf-review`, secuencia de investigación | `.agents/agents/review-agent.md` |
| Formato de PR, proof of work, gates de CI/Vercel/delivery, merge, ledgers, estados de Linear | `workflow/workflow.md` (`/wf-review`) |
| Fórmula de `QualityScore`, formato de finding, confidence, categorías | `scoring.md` |
| Checklist de correctness (transiciones, estado, AI por scope, velocidad percibida) | `review-correctness/SKILL.md` |
| Checklist de arquitectura, `Architecture Contract`, bundle desktop/Tauri, docs por scope | `review-architecture/SKILL.md` |
| Checklist de testing (cobertura, anti-patterns, E2E) | `review-testing/SKILL.md` |
| Si el PR debió dividirse en stages más pequeños | `review-change-size/SKILL.md` |
| Dispatch automatizado a subagentes especialistas | `claude-enhancements.md` + `specialists/*.md` |
| Seguridad (OWASP, RLS, AI/LLM security) | `specialists/security.md` |
| Performance (aplica `skill-performance`, no define política paralela) | `specialists/performance.md` |
| Migraciones de base de datos | `specialists/data-migration.md` |

`/wf-review` en `workflow/workflow.md` es el único protocolo operativo para revisar y cerrar un PR — no existe una ruta alterna. Si encuentras un documento o script que describe otro flujo de merge/ledger para review, es legacy y debe alinearse a `workflow.md`, no seguirse en paralelo.
