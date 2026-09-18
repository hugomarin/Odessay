---
name: review-change-size
description: Lente de review para el tamaño y coherencia del cambio — si el diff sigue siendo una unidad revisable o debió dividirse en stages. Usar en /wf-review cuando el diff mezcla dominios distintos o supera ~150-200 líneas sin una razón estructural clara.
---

# Skill: Review Change Size

## Pregunta

¿El diff sigue siendo una unidad coherente y revisable, o mezcla varias decisiones que deberían haberse separado?

Esta lente no mide líneas como defecto en sí — mide si el tamaño refleja **una** decisión bien delimitada o **varias** decisiones concatenadas.

## Cuándo activar

- el diff toca más de un dominio no relacionado (ej. UI + migración + refactor de servicio en el mismo PR)
- el diff supera ~150–200 líneas cambiadas sin que el brief declare explícitamente por qué es una sola unidad
- el diff mezcla un cambio de comportamiento con un rename/refactor mecánico masivo, dificultando ver cuál es cuál

No activar en diffs pequeños, ni en PRs cuyo tamaño está justificado por naturaleza (ej. una migración de datos que necesariamente toca muchos call sites del mismo rename).

## Método

1. Separar mentalmente el diff en "unidades de decisión": ¿cuántas decisiones arquitectónicas o de comportamiento distintas contiene?
2. Para cada unidad, preguntar: ¿podría haberse revisado y mergeado sola, sin las demás?
3. Si la respuesta es sí para más de una unidad, el PR debería haberse dividido.
4. Revisar si el PR mezcla un cambio de comportamiento con un refactor/rename mecánico — el segundo esconde al primero en el diff y dificulta detectar regresiones reales.
5. Verificar dependencias entre archivos tocados: si el 80% del diff es mecánico (renombrar un import en 40 archivos) y el 20% es la decisión real, señalar cuál es cuál explícitamente en el finding, no tratar todo el diff con el mismo peso de atención.

## Señales de que el PR debió dividirse

- contiene commits que ya son coherentes por sí solos y podrían haber sido PRs separados
- el PR body necesita una sección "Parte 1 / Parte 2" para explicarse
- revertir el PR completo revertiría dos features/fixes no relacionados
- un reviewer necesita cargar mentalmente dos dominios distintos (ej. `skill-architecture` + `skill-corrections`) para poder aprobar una sola unidad de cambio

## Qué no es un problema de tamaño

- un PR grande pero mecánico (rename masivo, regeneración de tipos) donde el riesgo real está concentrado en 1-2 archivos — señalar dónde está el riesgo real, no pedir dividir lo mecánico
- un PR que toca muchos archivos porque extrae una responsabilidad de un hotspot hacia un owner (ver `Construction order` en `.agents/agents/build-agent.md`) — es una sola decisión, aunque el diff sea grande

## Relación con `claude-enhancements.md`

`claude-enhancements.md` usa umbrales de líneas (`DIFF_LINES`) para decidir si vale la pena despachar especialistas en paralelo — esa es una decisión de **costo de dispatch**, no de revisabilidad. Esta lente responde una pregunta distinta: si el PR, tal como está, debería haberse dividido antes de llegar a review. Ambas pueden coincidir en el mismo PR grande sin ser lo mismo.

## Output

Si el cambio debería haberse dividido, declarar explícitamente el "smallest coherent stage" recomendado:

```text
Change Size — recomendación de división
- Unidad 1: <descripción, archivos>
- Unidad 2: <descripción, archivos>
- Por qué no son una sola unidad: <razón concreta>
- Riesgo de mantenerlas juntas: <qué se pierde en revisabilidad>
```

Esto no bloquea automáticamente el PR — es un finding `[P2]` o `[P3]` salvo que el tamaño esconda genuinamente un riesgo no revisado (en ese caso, súbelo a `[P1]` y dilo explícitamente).
