---
name: skill-corrections
description: "Reglas del subsistema de correcciones AI de Odessay: identidad de sugerencias, ciclo de vida, admisión/filtrado, matching con límites de token, learned words y memoria de decisiones. Usar cuando un issue, brief o diff toque correcciones ortográficas, sugerencias inline, learned words, decoraciones de corrección o el cache de correction blocks."
---

# Skill: Corrections (AI Writing Assist)

El subsistema de correcciones es el módulo hecho en casa más complejo del producto: cola de análisis, cache en tres capas (memoria, IndexedDB, Supabase), decoraciones ProseMirror, diccionario de palabras aprendidas y memoria de decisiones — coordinados con LLM no determinista. Este skill fija las reglas que evitan su clase de bug característica. El contrato funcional completo vive en `workflow/context/features/odessay-ai-writing-assist.md`; este skill no lo duplica — fija las reglas de diseño que ese doc no puede hacer cumplir por sí solo.

Origen: revisión 2026-07 (`docs/revision-correcciones-anotaciones-2026-07.md`) — 19 hallazgos, casi todos de cuatro familias que estas reglas cierran.

---

## Cuándo activar este skill

Actívalo si el prompt, brief o diff toca cualquiera de estas señales:

- correcciones ortográficas / mechanical corrections
- sugerencias inline, burbuja accept/reject/learn
- `learned_words`, learn word, diccionario del usuario
- memoria de decisiones (`correction-memory`)
- decoraciones de corrección (`publication-suggestion-extension`, `ai-correction-decorations`)
- cache de correction blocks (IndexedDB/Supabase), hidratación de sugerencias
- `publication-review` (route), `corrections.ts`, `suggestion-engine.ts`
- trigger de bloques dirty, invalidación stale

## Contexto documental obligatorio

1. `workflow/context/features/odessay-ai-writing-assist.md` — contrato funcional (siempre)
2. `workflow/context/features/odessay-prosemirror-tiptap.md` — si toca decoraciones o extensiones
3. `docs/revision-correcciones-anotaciones-2026-07.md` — hallazgos y plan de fixes vigente

---

## Regla 1 — Identidad ≠ ubicación

**Qué es** una corrección (su identidad) y **dónde está** ahora (su ubicación) son datos distintos con ciclos de vida distintos:

- **Identidad:** `type + originalText + replacementText` (normalizados). Sobrevive ediciones. Es la clave de la memoria de rechazos y de learned words.
- **Ubicación:** hash del bloque, posición, occurrence. Se recalcula en cada render. Nunca entra en un fingerprint.

Anti-patrón que esta regla prohíbe: fingerprint que incluye `blockId` (que incrusta hash+pos) — hace que los rechazos dejen de valer tras cualquier edición (hallazgo C2).

`enforced by: no enforcement — el test llega con Fix 2 del plan (tests de fingerprint estable tras cambio de hash/pos)`

## Regla 2 — Admisión única

Toda sugerencia pasa por **un solo punto de admisión** antes de ser visible, sin importar su origen: análisis nuevo, hidratación de cache, streaming, o re-evaluación tras aprender una palabra. La admisión aplica, en orden: filtro de learned words → filtro de memoria de rechazos → validación de límites de token → dedupe.

Anti-patrón: aplicar los filtros en el punto de análisis y mostrar sin filtrar lo que viene del cache (hallazgo C3 — palabras aprendidas reaparecían al abrir otro documento). Cada punto de entrada nuevo que no pasa por la admisión es un bug latente, no una omisión menor.

Corolario: cuando el estado de los filtros cambia (llega la lista de learned words, el usuario aprende una palabra), la admisión se **re-ejecuta sobre las sugerencias visibles** — no solo sobre las futuras.

`enforced by: no enforcement — el test llega con Fix 3 del plan (sugerencia cacheada de palabra aprendida no sobrevive la hidratación)`

## Regla 3 — Todo estado tiene salida

El ciclo de vida de una sugerencia es una máquina de estados donde **cada estado tiene transición de salida garantizada para éxito, fallo y timeout**. Un estado transitorio (`pending-stale`, "Recalculando…") sin salida en el camino de error es un bug de diseño, aunque el happy path funcione.

Reglas concretas:
- `pending-stale` expira: si el re-análisis no la resolvió en ~10 s, se dropea. Nunca queda atenuada con accept deshabilitado indefinidamente (hallazgo C4).
- Error de análisis → las stale del bloque se dropean, no `continue` silencioso.
- Eventos descartados por ventanas de supresión se **difieren**, no se pierden (hallazgo C10).

`enforced by: no enforcement — el test llega con Fix 4 del plan (ninguna sugerencia permanece stale >10 s por ningún camino)`

## Regla 4 — Matching con límites de token, una sola implementación

La respuesta a "¿dónde está esta corrección en este texto?" vive en **un solo módulo** que respeta límites de token, compartido por servidor (validación), decoraciones (render) y apply (mutación). Prohibido:

- `indexOf` plano como lógica final de matching — puede caer dentro de otra palabra y **corromper texto al aceptar** (hallazgo C1: "como" matcheando dentro de "comodidad").
- Dos implementaciones del matching (cliente/servidor, texto/markdown) sin test de paridad.

Este es el mismo guardrail de `skill-frontend §ProseMirror/Decorations` ("evitar lógica final basada solo en primer match de string"), que existía en prosa y se violó en producción — por eso aquí lleva enforcement.

`enforced by: tests/corrections-matching.test.ts`

## Regla 5 — Output de LLM degrada por item, nunca colapsa

El modelo va a devolver items malformados ocasionalmente. El parseo valida **item por item** (`safeParse`), descarta solo lo inválido y loguea lo descartado. Prohibido `.catch([])` (o equivalente) a nivel de colección: convierte un item malo en pérdida total silenciosa (hallazgo C5).

Igual para mutaciones optimistas: toda escritura optimista (learn word, accept) se implementa en pareja con su rollback en fallo (hallazgo C7 — `handleRemoveLearnedWord` lo hace bien; ese es el patrón).

`enforced by: parcial — harness de regresión en lib/testing/orthography-regression-*; el caso "1 item inválido no vacía el lote" llega con Fix 6`

---

## Failure modes que todo brief de corrections debe responder

Complemento de `skill-product-manager §Failure modes`, instanciado para este subsistema:

1. ¿Qué pasa si el análisis del bloque falla o llega tarde? (¿las stale expiran?)
2. ¿Qué pasa si la lista de learned words no ha cargado cuando corre el primer análisis?
3. ¿Qué pasa si el usuario cambia de documento con la cola a medio procesar?
4. ¿Qué pasa si el modelo devuelve un item malformado dentro de un lote válido?
5. ¿Qué pasa si el guardado remoto (learn word, cache) falla después del update optimista?

Un brief de corrections que no responde estas cinco preguntas no está listo para BUILD.

## Checklist de review para diffs de corrections

- [ ] ¿Toda sugerencia nueva entra por el punto de admisión común (no por un camino paralelo)?
- [ ] ¿Los fingerprints/claves de memoria excluyen hash y posición?
- [ ] ¿Cada estado transitorio nuevo tiene salida en éxito, fallo y timeout?
- [ ] ¿El matching usa el módulo común con límites de token (no `indexOf` local)?
- [ ] ¿El parseo de respuesta LLM degrada por item?
- [ ] ¿Toda mutación optimista tiene rollback?
- [ ] ¿El diff mantiene verde el harness de ortografía y los tests de matching?
- [ ] Si cambió el contrato real: ¿`odessay-ai-writing-assist.md` fue actualizado en el mismo PR?

---

## Relación con otros skills

- `skill-product-manager` invoca este skill en la revisión de briefs que tocan corrections (§Revisión por skills de dominio).
- `skill-frontend` es dueño de los guardrails de decoraciones/ProseMirror; este skill los especializa para correcciones y les añade enforcement.
- `skill-backend` es dueño de las reglas de la route `publication-review` (proveedor/modelo por env, contrato de error); este skill fija qué debe validar esa route (admisión, límites de token, degradación por item).
- `skill-code-review` usa el checklist de arriba como criterio de rechazo en PRs de este scope.
