---
name: review-correctness
description: Lente de review para regresiones lógicas y failure modes concretos — estado transicional, updates optimistas, colecciones sobre output de LLM, filtros de negocio con múltiples entry points. Usar en /wf-review cuando el diff toca transiciones críticas, estado async o lógica de negocio.
---

# Skill: Review Correctness

## Pregunta

¿Qué comportamiento de producción concreto puede volverse incorrecto por este diff?

## Cuándo activar

- el diff toca transiciones críticas (cambio de documento activo, tabs, navegación interna)
- el diff introduce o modifica estado async (fetch, sync, AI streaming, optimistic update)
- el diff toca un filtro/validación de negocio (learned words, permisos, dedupe) que puede tener más de un entry point
- el diff procesa output de un LLM o de una fuente externa no confiable

No activar para cambios de estilo, copy o refactors que no alteran comportamiento observable.

## Método

Para cada comportamiento cambiado:

1. identificar inputs y estado antes del cambio;
2. trazar los paths de éxito, falla, interrupción y retry;
3. inspeccionar los consumers que observan el estado resultante;
4. verificar ownership de cada transición — ¿hay un único mecanismo que decide, o compiten varios?;
5. comparar con una implementación análoga existente cuando exista una.

## Buscar específicamente

- **Transición co-owned:** dos o más mecanismos (router, estado local, Zustand, refs) deciden el resultado de la misma transición crítica.
- **Estado intermedio no modelado:** la UI pasa por un estado inválido entre inicio y fin que no está representado explícitamente (ej. contenido de tab A mostrándose mientras el título ya es tab B).
- **Identidad creada en hot path:** `crypto.randomUUID()`, `localDB.save()`, o cualquier efecto secundario de persistencia dentro del handler síncrono de `input`, `paste` o `click`.
- **Múltiples fuentes de verdad para una dimensión:** el mismo dato vive simultáneamente en params, estado local, Zustand y refs sin un owner claro.
- **Estado transitorio sin salida garantizada:** un estado intermedio (stale, recalculando, pendiente) tiene transición de entrada pero ningún camino de salida en fallo o timeout — el happy path lo resuelve, el error lo deja colgado para siempre.
- **Filtro de negocio en un solo entry point:** una regla de filtrado/validación se aplica en un punto de entrada del dato pero no en los demás (cache, hidratación, streaming). Verificar todos los caminos por los que el dato llega a la UI.
- **Update optimista sin rollback:** el diff escribe estado local antes de confirmar el servidor y el `catch` solo loguea — en fallo, la UI queda mintiendo.
- **Colapso de colección sobre output de LLM:** `.catch([])`, `catch` silencioso o parse all-or-nothing sobre una respuesta de modelo — un item malformado descarta el lote completo sin log.
- **Doble implementación de búsqueda/matching de texto** (cliente vs servidor, texto plano vs markdown) sin test de paridad entre ambas.
- **Error swallowed con éxito reportado:** el `catch` no relanza ni marca fallo, pero la UI o el caller asumen éxito.
- **Contrato AI violado por scope:** AI editor residente (`observe/discuss`) genera texto autoral cuando debía ser silencio; AI writing assist (`corrections/title`) auto-aplica una sugerencia en vez de devolver estructura para aceptar/rechazar.

## Velocidad percibida como invariante de producto

Odessay trata la inmediatez como comportamiento de producto, no como optimización opcional — una regresión aquí es tan "incorrecta" como un bug lógico:

- el editor deja de estar aislado: un keystroke re-renderiza sidebar o paneles externos
- el auto-save deja de guardar local primero y pasa a depender de un round-trip remoto antes de confirmar
- una operación de AI bloquea o congela el flujo de escritura
- la app deja de poder abrir/editar documentos sin conexión a red
- un panel secundario nuevo se carga sin lazy load, empujando el bundle inicial
- **Tests que solo cubren estado final:** no hay assertions sobre estados intermedios ni simulación de interrupciones (tab switch durante carga, rehidratación concurrente, sync tardío) — esto es un gap de `review-testing`, pero si el propio comportamiento correcto depende de ese estado intermedio, repórtalo aquí como riesgo de corrección, no solo como falta de cobertura.

## Output

Findings con el formato de `.agents/skills/skill-code-review/scoring.md`: `[Px] (confidence: N/10) archivo:línea — categoría: descripción` + fix.

## No hacer

- reportar problemas genéricos de estilo
- repetir hallazgos de lint
- inferir un bug sin un path de ejecución concreto que lo produzca
