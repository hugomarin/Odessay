---
name: skill-code-review
description: |
  Investiga un PR mediante lentes de corrección, arquitectura, testing y tamaño de cambio;
  selecciona evidencia y produce findings y un veredicto técnico. El workflow gobierna
  merge y estados; scoring.md gobierna la puntuación.
---

# Code Review

## 1. Objetivo

Code Review organiza la investigación técnica de un diff y produce un veredicto sustentado en comportamiento, contratos y evidencia.

### Principio rector

Un PR debe ser mergeable por alguien que no escribió el código. CI en verde es evidencia de que las reglas mecánicas pasaron — no evidencia de corrección lógica. El review no reejecuta lo que CI ya prueba; investiga lo que CI no puede probar.

---

## 2. Ámbito y activación

Activar para la revisión técnica de un cambio. Seleccionar cada lente por el riesgo real del diff; el protocolo local gobierna la apertura, gates y cierre del PR.

## 3. Entradas y fuentes de autoridad

### Evidencia a leer

Antes de buscar findings:

1. El diff completo — no un resumen ni solo los archivos con más líneas cambiadas.
2. Suficiente código circundante para entender cada path cambiado, no solo las líneas con `+`/`-`.
3. El owner, siblings relevantes y call sites cuando la corrección del cambio dependa de ellos.

No es necesario releer toda la documentación de producto — solo lo que el `Architecture Contract` o `Performance Architecture Contract` del brief ya citó como `Required docs`.

En Odessay, `.agents/skills/skill-code-review/specialties/review-contracts.md` vincula las lentes con los contratos de producto, el bundle desktop y la evidencia de capacidades. Cargar la parte que el diff active.

---

## 4. Método y criterios

### Dispatch — cuándo activar cada lente

| Lente | Activar cuando | Pregunta |
|---|---|---|
| [Corrección](references/correctness.md) | el diff toca transiciones críticas, estado async, filtros de negocio o procesa output de LLM | ¿qué comportamiento de producción puede volverse incorrecto? |
| [Arquitectura](references/architecture.md) | el diff cambia ownership, contratos, fuente de verdad, runtime o boundaries, o trae `Architecture Contract` | ¿extiende el owner canónico o crea uno paralelo? |
| [Testing](references/testing.md) | el diff introduce o modifica comportamiento observable | ¿los tests demuestran el comportamiento, no solo que no explota? |
| [Tamaño del cambio](references/change-size.md) | el diff mezcla dominios no relacionados o supera ~150–200 líneas sin razón estructural | ¿sigue siendo una unidad coherente y revisable? |

La lente de testing se vuelve **obligatoria, no discrecional**, cuando el diff produce o modifica evidencia de una fila del `workflow/quality/capability-integration-map.md` — o sube su `coverage_status`. En ese caso aplica además el contrato de construcción (`workflow/quality/capability-proof-contract.md`): fidelidad al camino de producción, completion vs. scheduling, y checklist de pre-upgrade antes de aceptar la subida.

No cargar una lente por defecto en diffs triviales o de una línea. Cargar solo las que el scope real del diff activa.

**Dispatch automatizado a subagentes (opcional):** si el agente ejecutor soporta `Agent` (subagentes), `.agents/skills/skill-code-review/claude-enhancements.md` define umbrales de líneas y scope para despachar en paralelo los especialistas de `specialists/security.md`, `specialists/performance.md`, `specialists/data-migration.md`, `specialists/testing.md` — output JSON estricto, mergeado por fingerprint. Es un mecanismo de paralelización, no un sustituto del review base: el review debe ser completo sin él.

---

### Prioridad de búsqueda

Buscar defectos sistémicos antes que defectos locales:

1. segundo owner de la misma responsabilidad
2. contrato roto (`Architecture Contract`, `Performance Architecture Contract`)
3. consumer olvidado
4. transición incompleta
5. abstracción canónica ignorada
6. comportamiento que solo cubre el happy path

Un finding sistémico cambia cómo se debe corregir el PR entero, no solo una línea — vale más que varios findings locales y debe aparecer primero en el reporte.

---

## 5. Resultado y evidencia

### Qué es un finding válido

Debe identificar comportamiento/riesgo concreto, `archivo:línea`, causa, condición de falla y dirección de fix.

No es válido: preferencia de estilo, hallazgo hipotético sin path de ejecución concreto, o repetición de algo que lint/typecheck ya cubre.

El formato exacto, las severidades, la calibración de confidence y el fingerprint viven en `.agents/skills/skill-code-review/scoring.md` — no se repiten aquí.

---

### Resultado obligatorio del review

Todo review debe cerrar con lo que este skill produce — no confundir con el `GateResult` final:

```
TechnicalVerdict: PASS|FAIL
QualityScore: X.Y/10
ProcessInsights:
- FirstReviewFailures: [...]
- ResolvedInLaterRounds: [...]
- ContextGaps: [...]
- BuildInstructionChurn: [...]
- Recommendations: [...]
```

`TechnicalVerdict` es el juicio de esta investigación (findings, contratos que las lentes evalúan, seguridad) — un solo owner: el review. `workflow/workflow.md` combina `TechnicalVerdict` con lo que ya verifica mecánicamente (CI, Vercel, `ops:delivery:gate`) para producir el `GateResult` que decide merge/no-merge; no lo recalcules aquí. Si `TechnicalVerdict=FAIL` o cualquiera de los checks mecánicos falla, `GateResult=FAIL` aunque `QualityScore` sea alto. El cálculo de `QualityScore` (fórmula, ejemplo paso a paso, overrides) vive en `scoring.md`.

**Señal de contexto insuficiente:** marcar `context_risk=true` cuando se pidieron instrucciones adicionales durante BUILD, el brief era ambiguo en schema/endpoint/dependencia/evidencia, la documentación de referencia estaba desactualizada, o el criterio de aceptación cambió a mitad de BUILD. Con `context_risk=true`, incluir recomendaciones concretas de mejora de contexto (brief/docs/skills) en `ProcessInsights`.

---

## 6. Manejo de fallos e incertidumbre

Registrar `context_risk` cuando la definición, las fuentes o la aceptación cambian durante BUILD; identificar la fuente de incertidumbre y una corrección de contexto concreta. Rechazar findings sin path de ejecución verificable o ya cubiertos por un check mecánico.

## 7. Relaciones y ownership

### Relación con otras capas

Este skill es la orquestación técnica, no el protocolo completo. Quien busque otra pieza del review, la encuentra aquí:

| Qué necesitas | Dónde vive |
|---|---|
| Rol que conduce `/wf-review`, secuencia de investigación | `.agents/agents/review-agent.md` |
| Formato de PR, proof of work, gates de CI/Vercel/delivery, merge, ledgers, estados de Linear | `workflow/workflow.md` (`/wf-review`) — el check agregado que decide el gate es `CI required` (`.github/workflows/blocking-ci.yml`) |
| Fórmula de `QualityScore`, formato de finding, confidence, categorías | `scoring.md` |
| Criterio de corrección (transiciones, estado, AI por scope, velocidad percibida) | `references/correctness.md` |
| Criterio de arquitectura, `Architecture Contract`, bundle desktop/Tauri, docs por scope | `references/architecture.md` |
| Criterio de testing (nivel mínimo suficiente — unit/contract/integration/E2E) | `references/testing.md`; el principio de nivel de menor costo vive en `workflow/testing/critical-capabilities-testing.md` |
| Si el PR debió dividirse en stages más pequeños | `references/change-size.md` |
| Dispatch automatizado a subagentes especialistas | `claude-enhancements.md` + `specialists/*.md` |
| Seguridad (OWASP, RLS, AI/LLM security) | `specialists/security.md` |
| Performance (aplica `skill-performance`, no define política paralela) | `specialists/performance.md` |
| Migraciones de base de datos | `specialists/data-migration.md` |

`/wf-review` en `workflow/workflow.md` es el único protocolo operativo para revisar y cerrar un PR — no existe una ruta alterna. Si encuentras un documento o script que describe otro flujo de merge/ledger para review, es legacy y debe alinearse a `workflow.md`, no seguirse en paralelo.

## 8. Recursos asociados

- **Lentes:** cargar únicamente las [referencias de corrección, arquitectura, testing o tamaño](references/correctness.md) que active el diff según la tabla de la sección 4; aplicar sus criterios al código, consumers y pruebas para producir findings concretos. Las cuatro rutas individuales están en esa tabla.
- **Contrato local:** al revisar un PR de Odessay, cargar las partes pertinentes de [review-contracts.md](specialties/review-contracts.md) para comprobar reglas de producto, bundle desktop y evidencia de capacidades junto a la lente seleccionada.
- **Puntuación:** al redactar o consolidar un finding, consultar [scoring.md](scoring.md) para usar la severidad, confidence, fingerprint y formato comunes.
- **Ejecución especializada:** solo si el entorno dispone de workers y el dispatch aporta valor, seguir [claude-enhancements.md](claude-enhancements.md) y el `specialists/*.md` del dominio afectado; el especialista adapta el formato de ejecución y aplica la lente existente.
