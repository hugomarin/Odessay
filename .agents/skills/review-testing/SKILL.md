---
name: review-testing
description: Lente de review para cobertura de testing — si los tests demuestran el comportamiento modificado y sus failure modes relevantes, no solo si "hay tests". Usar en /wf-review para cualquier diff que introduzca o modifique comportamiento.
---

# Skill: Review Testing

## Pregunta

¿Los tests demuestran el comportamiento modificado y sus fallos relevantes — o solo confirman que el happy path no explota?

## Cuándo activar

Prácticamente siempre que el diff introduce o modifica comportamiento observable. Es la lente que más frecuentemente se activa junto a `review-correctness`, porque los gaps de testing y los failure modes reales suelen ser la misma superficie vista desde dos ángulos.

## Método

Para cada función/componente nuevo o modificado:

1. verificar que existe un test de happy path con input válido;
2. verificar error paths: input inválido (Zod rejection, null, undefined), error de red/timeout, error de base de datos, auth fallida;
3. verificar edge cases: colección vacía, un solo elemento, límite de longitud, condición de carrera (doble submit, operación concurrente);
4. verificar que el test cubre el estado intermedio cuando el comportamiento correcto depende de él (ver `review-correctness` — un test que solo asserta "al final está bien" no detecta flicker transitorio);
5. para flujos críticos (auto-save, apertura de documento, sync), verificar que existe cobertura al **nivel mínimo que pueda falsificar el failure mode real** — contract o integration con servicios reales suele demostrarlo sin browser. Ver `workflow/testing/critical-capabilities-testing.md` (canonical owner del principio "test at the lowest-cost boundary" y de cuándo Playwright sí/no es la primera opción). Un test E2E no es más válido por sí solo que un integration test que demuestra el mismo contrato — exigirlo por defecto es el anti-pattern que ese documento corrige.
6. si el diff produce o modifica evidencia de una fila del `workflow/quality/capability-integration-map.md`, verificar además dos cosas que el nivel de test por sí solo no garantiza: **fidelidad al camino de producción** (¿el estado inicial se alcanza por las transiciones que producción ejecuta, o se siembra? ¿entry point, ids y selectores existen en el producto? ¿los doubles aceptan todas las call shapes que la cadena les pasa? ¿algún error se lo tragó un `catch {}` de producción durante la corrida?) y **semántica de completion** (¿la assertion corre tras el evento que *establece* el invariante, o tras el que solo lo *agenda*? ¿el trabajo diferido lleva generación/identidad y se descarta si está stale?). Las reglas son propiedad de `workflow/quality/capability-proof-contract.md` — esta lente las verifica y corre su checklist de pre-upgrade antes de aceptar cualquier subida de `coverage_status`; no las redefine.
7. si el diff monta un escenario de prueba nuevo (dobles propios, andamiaje, helpers de montaje), verificar contra `workflow/testing/integration-harness-catalog.md` que no reinventa un andamiaje que ya existe y que los dobles declarados son boundaries externos. Un archivo con decenas de `vi.mock` propios es la señal de arranque — el veredicto sale de leer **qué** dobla y qué dice ser el test, no de contarlos.

## Calidad de los tests, no solo su existencia

- usan mocks para Supabase y fixtures para datos — nunca conectan a staging o producción
- son independientes entre sí (ninguno depende del estado que dejó otro)
- el nombre describe qué comportamiento verifican, no qué función llaman
- los tests E2E con Playwright corren separados de los unitarios (`npm run test:e2e`)

## Anti-patterns — reportar si aparecen

- estado interno/terminal sembrado a mano cuando producción llega ahí por transiciones que tocan la propiedad bajo prueba (`NON_PRODUCTION_PATH`)
- assertion sobre el evento que agenda el trabajo, no sobre el que lo completa
- double que solo soporta la happy semantics que el test necesita, mientras producción llama con otra forma
- issue/PR cuyo objetivo declarado es "subir X a INTEGRATION" en vez de cerrar un failure mode
- `expect(x).toBeDefined()` sin verificar comportamiento real
- test que solo confirma que no lanza error, sin assertions de resultado
- `setTimeout`/`sleep` en vez de `waitFor` de testing-library
- test de componente que solo hace render mount, sin simular interacción real del usuario

## Checklist operativo adicional

- [ ] Auto-save verificado con reload real, no solo con el estado en memoria.
- [ ] Mobile: lectura funciona, escritura bloqueada (si el flujo toca mobile).
- [ ] Si el diff toca una fila del capability map: checklist de pre-upgrade del `capability-proof-contract.md` corrido, y `coverage_status` derivado de la evidencia (no perseguido como meta).
- [ ] Los flujos críticos afectados por este diff específico tienen evidencia al nivel mínimo suficiente (no necesariamente E2E — ver `workflow/testing/critical-capabilities-testing.md`); si el brief justificó explícitamente por qué el failure mode requiere E2E o performance, esa evidencia existe.

## Relación con `specialists/testing.md`

Este skill es el **canonical owner** del criterio de testing review. `.agents/skills/skill-code-review/specialists/testing.md` es solo el adapter de ejecución: aplica este mismo criterio con output JSON estricto para dispatch a subagente (modo Claude Enhancement, ver `claude-enhancements.md`) — no vuelve a declarar el checklist. Si agregas o cambias un criterio, hazlo aquí; el adapter no necesita actualizarse salvo que cambie el formato de output JSON.

## Output

Findings con el formato de `.agents/skills/skill-code-review/scoring.md`. Categoría típica: `test-gap` (funcionalidad sin cobertura) o `missing-edge-case` (happy path cubierto, error path no).
