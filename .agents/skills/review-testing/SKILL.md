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
5. para flujos críticos (auto-save, apertura de documento, sync), verificar que existe cobertura E2E, no solo unitaria.

## Calidad de los tests, no solo su existencia

- usan mocks para Supabase y fixtures para datos — nunca conectan a staging o producción
- son independientes entre sí (ninguno depende del estado que dejó otro)
- el nombre describe qué comportamiento verifican, no qué función llaman
- los tests E2E con Playwright corren separados de los unitarios (`npm run test:e2e`)

## Anti-patterns — reportar si aparecen

- `expect(x).toBeDefined()` sin verificar comportamiento real
- test que solo confirma que no lanza error, sin assertions de resultado
- `setTimeout`/`sleep` en vez de `waitFor` de testing-library
- test de componente que solo hace render mount, sin simular interacción real del usuario

## Checklist operativo adicional

- [ ] Auto-save verificado con reload real, no solo con el estado en memoria.
- [ ] Mobile: lectura funciona, escritura bloqueada (si el flujo toca mobile).
- [ ] Los flujos críticos afectados por este diff específico tienen test E2E, no solo los que ya existían antes.

## Relación con `specialists/testing.md`

Este skill es el **canonical owner** del criterio de testing review. `.agents/skills/skill-code-review/specialists/testing.md` es solo el adapter de ejecución: aplica este mismo criterio con output JSON estricto para dispatch a subagente (modo Claude Enhancement, ver `claude-enhancements.md`) — no vuelve a declarar el checklist. Si agregas o cambias un criterio, hazlo aquí; el adapter no necesita actualizarse salvo que cambie el formato de output JSON.

## Output

Findings con el formato de `.agents/skills/skill-code-review/scoring.md`. Categoría típica: `test-gap` (funcionalidad sin cobertura) o `missing-edge-case` (happy path cubierto, error path no).
