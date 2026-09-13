# Performance instruments

Este inventario pertenece a `skill-performance`. Los instrumentos viven en sus
rutas operativas actuales para que package scripts, CI y los comandos existentes
no pierdan compatibilidad; el skill decide cuándo invocarlos.

## Regla de uso

No ejecutar todos los instrumentos por defecto. Primero completar el
`Performance Architecture Contract` y elegir evidencia proporcional al riesgo:

- **Diseño / escala:** no requiere script; revisar forma de carga, ownership,
  consumidores y crecimiento en el brief, fixture o test relevante.
- **Editor / interacción:** usar el trace y gate del editor cuando el cambio
  toca el hot path, input, render o long tasks.
- **Bootstrap / navegación / sync / listeners:** usar el gate de red/runtime
  cuando el contrato identifica requests, payload, duplicados o churn de
  listeners como riesgo.
- **Tauri / capability nativa:** añadir evidencia del bundle instalado; un HAR
  de `tauri dev` no sustituye la validación de distribución.

## Instrumentos activos

| Instrumento | Ruta | Invocación | Se usa para |
|---|---|---|---|
| Captura de trace del editor | `scripts/capture-editor-trace.mjs` | `npm run ops:perf:capture` | Generar trace reproducible del escenario editor. |
| Análisis de trace | `scripts/analyze-editor-trace.mjs` | Consumido por el gate | Derivar métricas del trace sin duplicar lógica en cada skill. |
| Gate del editor | `scripts/check-performance-gate.mjs` | `npm run ops:perf:gate` | Comparar un trace del editor contra `workflow/perf-budgets.json`. |
| Gate de red/runtime | `scripts/check-network-budget.mjs` | `npm run ops:network:gate` | Evaluar HAR o Resource Timing cuando el riesgo es bootstrap, waterfall, payload, duplicados o listener churn. |
| Presupuesto del editor | `workflow/perf-budgets.json` | Input del gate | Instrumento de regresión para superficies editoriales; no es una política universal. |
| Presupuesto de red/runtime | `workflow/perf-budgets-network.json` | Input del gate | Instrumento de auditoría para escenarios de red/runtime; no se exige a todo PR. |
| Escenario del harness | `tests/perf/editor-harness-scenario.md` | Referencia del capture | Define el escenario que hace reproducible el trace del editor. |

## Auditoría periódica

`/wf-audit-runtime` es una auditoría de milestone o regresión acumulativa. No
debe convertirse en un paso obligatorio de cada BUILD o REVIEW. Su uso está
justificado cuando el contrato indica que el comportamiento solo puede
observarse al combinar rutas, consumidores o runtimes.

## Instrumentos retirados

Se retiraron en esta consolidación los captures por superficie sin callers, los
scripts de evidencia ligados a issues históricos, los budgets sin gate
consumidor y el baseline editorial que duplicaba el harness/analyzer/gate
activos. No deben reaparecer como referencias en nuevos briefs; si se necesita
una superficie nueva, primero se justifica el escenario y se integra al routing
canónico.

## Documentos que no son instrumentos de performance

- `workflow/define/context-hygiene-prompt.md` sigue siendo la fuente del
  comando `/wf-health`; audita consistencia documental y no debe cargar ni
  duplicar esta política de performance.
- `workflow/context/core/odessay-stack.md` conserva el principio general de
  velocidad y local-first, pero no define budgets.
- Los documentos de `workflow/context/features/` conservan contratos de
  dominio. Solo deben mencionar el patrón o riesgo específico de su feature,
  no repetir dimensiones, thresholds o gates transversales.
- `.agents/skills/skill-performance/references/desktop-runtime-evidence.md`
  contiene la versión generalizable de las reglas de captura desktop; no debe
  crecer con casos de un issue particular.

## Ownership

Los scripts ejecutables y budgets no se copian dentro del skill. El skill es su
owner conceptual y documenta su routing; las rutas operativas permanecen en
`scripts/`, `tests/` y `workflow/` mientras package scripts o CI las consuman.
Moverlas físicamente exige actualizar todos esos callers en el mismo cambio.
