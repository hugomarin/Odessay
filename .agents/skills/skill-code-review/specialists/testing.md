# Specialist: Testing Review

Este especialista aplica `.agents/skills/review-testing/SKILL.md`; no define un checklist paralelo de cobertura, calidad de tests o anti-patterns.

## Revisión del diff

Para cada función/componente nuevo o modificado en el diff, verificar contra el criterio de `review-testing`:

- happy path, error paths (input inválido, red, DB, auth) y edge cases (colección vacía, límite, condición de carrera) cubiertos;
- el estado intermedio está cubierto cuando el comportamiento correcto depende de él, no solo el resultado final;
- flujos críticos (auto-save, apertura de documento, sync) tienen cobertura E2E, no solo unitaria;
- los tests usan mocks/fixtures (nunca staging o producción), son independientes entre sí, y no caen en los anti-patterns listados en `review-testing` (`toBeDefined()` sin verificar comportamiento, `setTimeout` en vez de `waitFor`, render mount sin interacción real).

Los detalles del criterio — qué cuenta como edge case, qué anti-pattern rechazar, cuándo exigir E2E — viven en `review-testing/SKILL.md`. Este archivo solo adapta ese criterio al formato de dispatch.

## Output esperado

Output: SOLO líneas JSON. Nada de texto libre, markdown, headers o comentarios.

Para cada gap encontrado:
```json
{"severity":"CRITICAL|HIGH|MEDIUM|LOW","confidence":N,"path":"file","line":N,"category":"test-gap","summary":"{función} no tiene test para {escenario}","fix":"Agregar test en {archivo-test} que cubra {escenario}","specialist":"testing"}
```

Si no hay findings: output `NO FINDINGS` y nada más.
Do not output anything else — no preamble, no summary, no commentary, no markdown blocks.
Output ONLY raw JSON lines. No prose.
