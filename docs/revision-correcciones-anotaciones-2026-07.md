# Revisión: Correcciones de ortografía y Anotaciones

**Fecha:** 2026-07-03
**Alcance:** subsistema de correcciones mecánicas (AI), diccionario de palabras aprendidas (ODE-338), resaltado de anotaciones, y revisión de los skills de dominio en `.agents/`.

---

## 0. Cómo usar este documento (protocolo para agentes)

Este documento lo ejecutarán agentes LLM. Reglas obligatorias para no alucinar:

1. **Los números de línea son del 2026-07-03 y van a estar desactualizados.** Nunca editar por número de línea: localizar siempre por símbolo (`grep` del nombre de función/const citado). Si el símbolo no existe, detenerse y reportar — no buscar "algo parecido".
2. **Verificar el hallazgo antes de arreglarlo.** Cada fix del §6 empieza reproduciendo el hallazgo en el código actual (leer el archivo, confirmar que el comportamiento descrito sigue ahí). Si el código ya no coincide con la descripción, el fix no aplica: reportar, no improvisar.
3. **Test primero.** Cada fix define sus criterios de aceptación como tests. Escribir el test que falla, luego el fix, luego verificar con `npx vitest run <archivo>`. Un fix sin test que falló antes no cuenta como hecho.
4. **No inventar dependencias ni APIs.** El engine se construye con TypeScript plano (discriminated unions + funciones puras). No instalar XState ni ninguna librería nueva. Las firmas del §6 son el contrato: si algo no está especificado, elegir lo mínimo y dejarlo anotado en el PR, no diseñar por cuenta propia.
5. **No borrar el camino viejo hasta que el nuevo pase paridad.** Cada extracción al engine mantiene el comportamiento observable; los tests de paridad del fix son la puerta para eliminar el código original en el mismo PR.
6. **Los hallazgos tienen dos niveles de certeza:**
   - `[verificado]` — el comportamiento está confirmado leyendo el código; se puede arreglar directo (tras la regla 2).
   - `[hipótesis]` — el mecanismo existe en el código pero el impacto en runtime es inferido (carreras, timing). Antes de arreglar, confirmar con un test que lo reproduzca o con logs; si no se puede reproducir, documentar y pasar al siguiente.
7. **Un fix por rama/PR según el flujo `/wf-build`** (leer `workflow/agents.md` antes de tocar código). No mezclar pasos del plan.

Certeza por hallazgo: **C1-C5, C7, C8, C11, C12, C14-C19, A1, A2 = [verificado]** (lógica confirmada en código). **C6, C9, C10, C13 = [hipótesis]** (código confirmado, impacto dependiente de timing/contenido — requieren test de reproducción primero).

---

## 1. Hallazgos — Correcciones

### Resumen

| # | Hallazgo | Severidad | Archivos |
|---|----------|-----------|----------|
| C1 | Matching cliente sin límites de palabra: aceptar puede corromper texto dentro de otra palabra | Alta | `lib/editor/suggestion-engine.ts:131` |
| C2 | Fingerprint incluye hash+pos del bloque: los rechazos dejan de valer tras cualquier edición | Alta | `lib/ai/correction-memory.ts:17-25` |
| C3 | Sugerencias cacheadas no se filtran contra learned words al hidratar | Alta | `components/editor/editor-shell.tsx:1480` |
| C4 | Estado `pending-stale` sin salida garantizada: sugerencias "bloqueadas" para siempre | Alta | `editor-shell.tsx:3389-3393`, `3524-3531` |
| C5 | `z.array(...).catch([])`: un item malformado del modelo descarta todas las correcciones del bloque | Media | `lib/ai/corrections.ts:42` |
| C6 | Race: el análisis puede correr antes de que cargue la lista de learned words | Media | `editor-shell.tsx:3235` vs `3381` |
| C7 | `learnWord` sin rollback del entry optimista si el POST falla | Media | `editor-shell.tsx:2024-2026` |
| C8 | Carga de learned words no se reintenta si falla; tope de 100 sin paginación real | Media | `editor-shell.tsx:3228-3246` |
| C9 | Contextos de desambiguación derivados del documento completo, no del bloque analizado | Media | `editor-shell.tsx:3330` + `suggestion-engine.ts:412` |
| C10 | Edits en los primeros 1.2 s tras abrir el doc se descartan (ventana de supresión) | Media | `editor-shell.tsx:3583-3589` |
| C11 | Spellcheck nativo del navegador activo en paralelo (es-MX): segundo sistema de subrayado que ignora learned words | Media | `editor-shell.tsx:1029`, `lib/editor/spellcheck.ts` |
| C12 | Contador del toast se duplica (increment + finally) | Baja | `editor-shell.tsx:3494`, `3554-3555` |
| C13 | Decoraciones (texto rich) y apply (markdown) usan representaciones distintas: pueden divergir | Baja | `suggestion-engine.ts:229`, `lib/editor/ai-correction-decorations.ts` |
| C14 | La cola no se limpia al cambiar de documento | Baja | `editor-shell.tsx:1142` |
| C15 | Decoraciones solapadas se omiten en silencio: sugerencia en panel sin subrayado | Baja | `ai-correction-decorations.ts:124` |
| C16 | Memoria de decisiones: localStorage, cap 200 incluyendo `accepted` (que el filtro nunca usa), sin sync entre dispositivos | Diseño | `lib/editor/correction-memory-client.ts` |
| C17 | Una llamada LLM por párrafo, en serie; el prompt ya soporta `blocks[]` | Diseño | `lib/ai/corrections.ts:145`, cola en `editor-shell.tsx` |
| C18 | Ruta streaming duplica toda la lógica del path no-streaming | Deuda | `app/api/ai/publication-review/route.ts:563-662` |
| C19 | `normalizeLearnedWord` quita acentos: aprender un typo con acento silencia correcciones de acento del término correcto | Decisión | `lib/corrections/learned-words.ts:14` |

### Detalle de los hallazgos altos

**C1 — Matching sin límites de palabra.** El servidor valida que `originalText` exista como token completo (`hasTokenBoundaryMatch`, `lib/ai/corrections.ts:54-81`), pero el cliente localiza la sugerencia con `indexOf` plano (`findContextAwareMatch`). Corrección "como→cómo" con "comodidad" antes en el bloque: la decoración cae dentro de "comodidad" y aceptar reemplaza esa subcadena. Esto viola el invariante declarado en `workflow/context/features/odessay-ai-writing-assist.md §Invariante de selección de rangos` y el guardrail de `skill-frontend §ProseMirror/Decorations` ("evitar lógica final basada solo en primer match de string").

**C2 — Identidad contaminada con ubicación.** El fingerprint de memoria es `blockId|type|original|replacement`, y el `blockId` incrusta el hash del texto y la posición (`correction-block:<logical>:<hash>:<pos>`). Cualquier edición del párrafo cambia el hash → nuevo fingerprint → el rechazo previo no se reconoce y la sugerencia reaparece. Los rechazos solo sobreviven mientras el párrafo esté byte-idéntico, que es exactamente cuando el cache evita re-analizar.

**C3 — El filtro de learned words solo existe en un punto de entrada.** Se aplica en el análisis del servidor (`normalizeCanonicalCorrections`), pero las sugerencias que entran por hidratación de cache (IndexedDB/Supabase) se muestran sin filtrar. Aprender una palabra en el documento A no limpia las sugerencias cacheadas del documento B.

**C4 — `pending-stale` no tiene salida garantizada.** Al editar un bloque sus sugerencias pasan a `pending-stale` (opacity 0.5, accept deshabilitado con "Recalculando…"). Si el re-análisis falla (`continue` sin limpiar) o si hay cache hit al re-encolar (return sin restaurar a `pending`), quedan atenuadas y bloqueadas indefinidamente.

## 2. Hallazgos — Anotaciones

**A1 — El color del resaltado se decide por párrafo, no por anotación.** El mark `highlight` que ancla la anotación es genérico, sin tipo ni id (`lib/editor/annotation-document.ts:137`), así que el CSS adivina con `p:has(sup.annotation-ref-ai) mark` (`app/globals.css:474-486`). Consecuencias:

- Párrafo con anotación AI + anotación highlight → ambas reglas matchean el párrafo y gana la última: todo se pinta ámbar, incluido el texto anotado por AI.
- Un highlight manual dentro de un párrafo con anotación AI se vuelve lila.
- El mismo tipo de anotación cambia de color según sus vecinos de párrafo.

**Fix:** el mark debe llevar `data-annotation-type` (y opcionalmente `data-annotation-id`), y el CSS colorear por marca. Elimina los selectores `p:has()`.

**A2 — Paleta inconsistente:** el superíndice de highlight usa `#C07B2A` pero su subrayado usa `#e7af02`.

---

## 3. Recomendación arquitectónica

### El problema de fondo

Los 19 hallazgos de correcciones son casi todos de la misma familia. No son bugs aislados: son el costo de que **la orquestación completa del subsistema viva dentro de `editor-shell.tsx` (~5.000 líneas)** como estado mutable distribuido — más de una docena de `useRef` (cola, cache, memoria, learned words, timers, flags de supresión) coordinados por callbacks. En esa forma:

- No hay un ciclo de vida formal: `pending-stale` puede no tener salida (C4) porque ninguna estructura obliga a que todo estado tenga transición de salida.
- No hay un punto único de admisión: cada entrada de sugerencias (análisis, hidratación, streaming) aplica un subconjunto distinto de filtros (C3, C6).
- No hay un modelo de identidad: "qué es esta corrección" y "dónde está ahora" se mezclan en un solo string (C2).
- La lógica es intesteable en unidad: los bugs de timing (C6, C10, C14) solo se manifiestan con carreras reales.

Esto contradice la propia taxonomía de `skill-architecture`: el ciclo de vida de una sugerencia es **Domain**, la orquestación de cola/cache es **Application**, y `editor-shell` debería ser solo **UI + adapter**. Hoy las tres capas viven en el componente.

### Recomendación: extraer un `CorrectionsEngine`

Un módulo puro en `lib/corrections/engine/` sin dependencia de React ni de TipTap, siguiendo el mismo patrón ports & adapters que ya usan los servicios (`AIService`, `DocumentService`):

```
lib/corrections/
  engine/
    state.ts        ← estado + reducer (discriminated unions, cero refs)
    lifecycle.ts    ← máquina de estados de la sugerencia
    admission.ts    ← admitSuggestions(): EL punto único de entrada
    matching.ts     ← matching con límites de token, compartido cliente/servidor
    identity.ts     ← fingerprint (qué es) separado de location (dónde está)
  ports.ts          ← AnalysisPort, CachePort, LearnedWordsPort, MemoryPort
```

Los cinco compromisos de diseño:

1. **Un solo punto de admisión.** Toda sugerencia — venga del análisis, del cache hidratado o del streaming — pasa por `admitSuggestions()`, que aplica en orden: filtro de learned words, filtro de memoria de rechazos, validación de límites de token, dedupe. Arregla C3 y C6 estructuralmente (aprender una palabra = re-ejecutar admisión sobre el estado actual), no con parches por callsite.

2. **Ciclo de vida como máquina de estados con salidas totales.** `pending → stale → (refreshed | dropped)` con timeout: si el re-análisis no llega en N segundos, la sugerencia se dropea, nunca se queda atenuada. La regla es mecánica: *ningún estado sin transición de salida*. Elimina C4 como clase de bug.

3. **Identidad ≠ ubicación.** Fingerprint = `type + originalText + replacementText` (+ id lógico del bloque si se quiere scope). Hash y posición son solo datos de render que se recalculan. Los rechazos y learned words sobreviven ediciones (C2).

4. **Un solo módulo de matching, compartido cliente/servidor.** `matching.ts` con límites de token es la única respuesta a "¿dónde está esta corrección en este texto?" — lo importan la ruta API, las decoraciones y el apply. Arregla C1 y reduce C13 (misma lógica sobre ambas representaciones, con test de paridad).

5. **El shell se vuelve adapter delgado.** `editor-shell` traduce eventos (dirty blocks del plugin, clicks de burbuja) a comandos del engine y suscribe el DecorationSet al estado. La lógica se prueba con tests de unidad y property-based sin montar React; las carreras se simulan con ports fake.

**Cómo migrar sin big bang:** en el orden del plan de fixes (§6). Cada fix de severidad alta se implementa *creando* la pieza del engine que lo arregla (C1 → `matching.ts`, C2 → `identity.ts`, C3/C6 → `admission.ts`, C4 → `lifecycle.ts`) y haciendo que el shell delegue. Al terminar los fixes altos, el engine ya existe; queda mover la cola y el cache (C14, C17) como segunda fase.

---

## 4. Patrones y habilidades a desarrollar

Para producir mejor diseño en sistemas como este, en orden de retorno:

1. **Máquinas de estados / statecharts.** El patrón que falta en todo el subsistema. Estudiar statecharts de David Harel; en TypeScript: discriminated unions + reducer (suficiente aquí) o XState si crece. Regla operativa que previene la familia de bugs C4: *al dibujar los estados, todo estado debe tener flechas de salida para éxito, fallo y timeout*.

2. **Pipes and filters.** El flujo de una corrección es una tubería: detectar → encolar → analizar → **admitir/filtrar** → resolver rango → decorar. Cuando los filtros viven en la tubería, ningún caller puede olvidarlos (C3). Cuando viven en los callers, cada nuevo punto de entrada es un bug latente.

3. **Ports & adapters (hexagonal).** Ya lo aplican en los contratos de servicio multi-runtime; el paso siguiente es aplicarlo *dentro* del cliente: la lógica de dominio no importa React, TipTap ni fetch — recibe ports. El beneficio inmediato es testabilidad de las carreras (C6, C10, C14) con ports fake y clocks controlados.

4. **Single writer / flujo unidireccional.** Una sola función muta el estado de sugerencias (el reducer). Los ~15 refs mutables del shell son escritores concurrentes sin coordinación — cada uno es una carrera potencial. Estudiar el modelo reducer (Redux/Elm architecture) no como librería sino como disciplina: *acción → transición → nuevo estado*, todo trazable.

5. **UI optimista con compensación.** Toda mutación optimista se escribe en pareja: acción + rollback en fallo (`handleRemoveLearnedWord` lo hace bien; `handleLearnWord` no — C7). Patrón saga-lite: si el servidor rechaza, el estado local revierte y el usuario se entera.

6. **"Parse, don't validate" con degradación parcial.** `z.array(schema).catch([])` convierte un item malo en pérdida total silenciosa (C5). Parsear item por item con `safeParse`, descartar solo lo inválido, loguear lo descartado. Aplica a toda respuesta de LLM: el modelo *va* a devolver basura ocasional; el contrato debe degradar, no colapsar.

7. **Property-based testing.** Para matching, normalización e identidad, los tests de ejemplo no bastan. Con `fast-check`: "para todo texto T y corrección C admitida, el rango resuelto cae en límites de token", "aplicar y des-aplicar es round-trip". Es la forma de convertir los invariantes en prosa de los skills en verificación ejecutable — el gap central encontrado en §5.

8. **Idempotencia en sistemas con cache multi-capa.** Con tres capas (memoria, IndexedDB, Supabase), cada operación debe poder ejecutarse dos veces sin daño y cada capa debe poder invalidarse desde las reglas de negocio (learned words debe invalidar cache — C3). Leer sobre cache invalidation como problema de diseño, no como detalle.

---

## 5. Revisión de skills de dominio (`.agents/`)

### Lo que está bien

El sistema es maduro: separación clara workflow (qué) / agents (quién) / skills (cómo), frontmatter con triggers de activación, `skill-architecture` con output obligatorio y taxonomía de tres ejes, contrato de performance multidimensional con comandos ejecutables, y un feature doc de corrections (`odessay-ai-writing-assist.md`) que ya reconoce deuda (sin batching) honestamente.

### Qué mejorar

> **Estado (2026-07-03):** S1 parcialmente resuelto (convención `enforced by:` aplicada a `skill-frontend §ProseMirror guardrails` y a `skill-corrections`; los tests referidos llegan con los fixes del §6). S2 resuelto (`.agents/skills/skill-corrections/SKILL.md` creado). S4 resuelto en planeación (sección `Failure modes` obligatoria en `skill-product-manager §Estructura de un issue`). S5 resuelto (red flags añadidos a `skill-code-review`). Además se añadió el gate `§Revisión por skills de dominio` a `skill-product-manager`: la consulta de skills técnicos en DEFINE pasó de consultiva a obligatoria con veredicto en la Execution Trace. Pendientes: S3 (dieta de skill-frontend), S6 (rol review en agents/), S7 (actualizar ai-writing-assist al corregir C3).

**S1 — Invariantes en prosa sin enforcement ejecutable (el gap más importante).** La prueba: `skill-frontend §ProseMirror guardrails` prohíbe "lógica final basada solo en primer match de string" y el feature doc declara el invariante de límites de palabra — y el código en producción viola ambos (C1) habiendo pasado por review. Un invariante que ningún test verifica es una esperanza, no una regla. Acción: cada invariante bloqueante en un skill debe cerrar con `enforced by: <test o comando>`; si no existe, el skill debe decir explícitamente `no enforcement — verificar manualmente en review` para que el revisor sepa que la carga es suya. El harness de ortografía (`lib/testing/orthography-regression-*`) existe pero ningún skill obliga a correrlo o extenderlo cuando se toca corrections.

**S2 — Nadie es dueño del subsistema de correcciones.** El conocimiento está repartido: guardrails en `skill-frontend`, reglas de ruta en `skill-backend`, contrato en el feature doc. Corrections es el subsistema hecho en casa más complejo del producto y no tiene skill propio con triggers de activación. Crear `skill-corrections` (o sección canónica equivalente) con: modelo de identidad (fingerprint ≠ ubicación), diagrama del ciclo de vida con salidas totales, y la regla de admisión única ("todo punto de entrada de sugerencias pasa por el filtro común"). Los hallazgos C1-C10 de este documento son su semilla.

**S3 — Presupuesto de atención: `skill-frontend` tiene 953 líneas.** Y además exige leer `vistas.md`, `tipografia.md` y `skill-design`. Un agente que debe cargar ~2.000 líneas de reglas "siempre" adhiere peor que uno con 300 líneas de reglas duras + referencias bajo demanda. El patrón `specialists/` de `skill-code-review` es el correcto: aplicarlo aquí — mover mapas de IDs por vista, mensajes de empty-state y detalles de validación de formularios a archivos de referencia, dejando en SKILL.md solo principios, anti-patterns bloqueantes y checklist.

**S4 — Los skills documentan el happy path; faltan modos de fallo.** Ninguna sección de ningún skill pregunta "¿qué pasa si este fetch falla, si hay carrera, si el modelo devuelve basura?". Los bugs C4, C6, C7, C8 y C10 son todos de esa clase y ningún checklist los habría atrapado. Acción: sección `Failure modes` obligatoria en feature docs (por operación: fallo de red, respuesta inválida, carrera con otra operación, interrupción a mitad), y en `skill-code-review` la pregunta correspondiente.

**S5 — `skill-code-review`: red flags nuevos a partir de esta revisión.** Añadir a la lista de rechazo: (a) estado con transición de entrada pero sin salida garantizada; (b) filtro de negocio aplicado en un solo entry point cuando el dato tiene varios; (c) update optimista sin rollback; (d) `.catch([])`/`catch` silencioso a nivel de colección sobre output de LLM; (e) misma búsqueda de texto implementada dos veces (cliente/servidor o texto/markdown) sin test de paridad.

**S6 — `agents/` está incompleto respecto a su propia convención.** El README promete roles de planning/build/review/operations; solo existe `product-manager.md`. El rol que más habría ayudado aquí es **review**: ODE-338 pasó build y review con C3, C6, C7 y C8 dentro. Definir `review-agent.md` con carga obligatoria del feature doc del área tocada y verificación explícita de sus invariantes (con S1 resuelto, eso se vuelve ejecutable).

**S7 — Drift menor en el feature doc.** `odessay-ai-writing-assist.md §Learned words` describe "exclusión en dos capas" (prompt + normalización canónica); falta la tercera capa que este documento demuestra necesaria: filtrado en hidratación/admisión (C3). Actualizar al corregir, y registrar la relación issue↔doc como ya exige la regla de `skill-frontend`.

---

## 6. Plan de fixes sugerido

| Orden | Qué | Cubre | Esfuerzo |
|-------|-----|-------|----------|
| 1 | `matching.ts` con límites de token compartido; decoraciones y apply lo usan | C1, C13, C15 | M |
| 2 | Fingerprint sin hash/pos (`identity.ts`) + migración de memoria existente | C2 | S |
| 3 | `admission.ts`: filtro único (learned words + memoria + boundaries) aplicado en análisis, hidratación y al aprender palabra | C3, C6 | M |
| 4 | `lifecycle.ts`: salidas garantizadas de `pending-stale` (timeout + drop en error/cache-hit) | C4, C10 | M |
| 5 | Rollback en `learnWord`; retry de carga; paginación >100 | C7, C8 | S |
| 6 | `safeParse` por item en la ruta; unificar path streaming/no-streaming | C5, C18 | S |
| 7 | Mark de anotación con `data-annotation-type`; CSS por marca; unificar paleta | A1, A2 | S |
| 8 | Decisión de producto: spellcheck nativo off por defecto o señal visual unificada | C11 | S |
| 9 | Batching de bloques por request; limpiar cola en cambio de doc; fix contador toast | C17, C14, C12 | M |
| 10 | Decisión: normalización de acentos en learned words; memoria de rechazos a Supabase | C19, C16 | S/M |

Los pasos 1-4 construyen el `CorrectionsEngine` de §3 de forma incremental — cada fix crea la pieza que lo arregla.

### Especificación por fix

Cada fix sigue el protocolo del §0: localizar por símbolo, reproducir, test primero, paridad antes de borrar.

#### Fix 1 — Matching con límites de token (C1, C13, C15)

- **Crear:** `lib/corrections/engine/matching.ts`.
- **Contrato:**
  ```ts
  export type TokenMatch = { start: number; end: number }
  // Única respuesta a "¿dónde está esta corrección en este texto?".
  // Reimplementa findContextAwareMatch (lib/editor/suggestion-engine.ts) añadiendo
  // la validación de límites de token que hoy solo existe en el servidor
  // (hasTokenBoundaryMatch, lib/ai/corrections.ts). Reusar TOKEN_CHAR_PATTERN.
  export const findTokenBoundaryMatch = (
    source: string,
    originalText: string,
    replacementText: string,
    contextBefore?: string | null,
    contextAfter?: string | null,
    occurrence?: number | null,
  ): TokenMatch | null
  ```
- **Migrar consumidores:** `findSuggestionMatch` (suggestion-engine.ts) delega en la nueva función; `hasTokenBoundaryMatch` del servidor se reimplementa sobre el mismo módulo. No dejar dos implementaciones.
- **Aceptación (tests nuevos en `tests/corrections-matching.test.ts`):**
  - Corrección `como→cómo` sobre `"la comodidad de como escribo"` matchea el `como` aislado, nunca dentro de `comodidad` (hoy falla — es C1).
  - Ninguna coincidencia parcial dentro de un token con `'`, `’`, `-` o marcas diacríticas.
  - Los tests existentes de `suggestion-engine` siguen pasando (paridad).
- **No hacer:** no tocar el flujo de decoraciones ni el apply más allá de la delegación; no "mejorar" la lógica de occurrence en este paso.

#### Fix 2 — Identidad sin ubicación (C2)

- **Crear:** `lib/corrections/engine/identity.ts`.
- **Contrato:**
  ```ts
  // Identidad = QUÉ es la corrección. Nunca incluye hash de texto ni posición.
  // (blockId actual = "correction-block:<logical>:<hash>:<pos>" — por eso C2.)
  export const createStableFingerprint = (c: {
    type: string; originalText: string; replacementText: string
  }): string // formato: `${type}|${norm(originalText)}|${norm(replacementText)}`
  ```
- **Migración de memoria existente:** las entradas viejas de localStorage (`odessay-correction-memory`) tienen el formato `blockId|type|original|replacement` y **no pueden recomputarse**. Estrategia: al leer, derivar la cola estable (`type|original|replacement`, últimos 3 segmentos tras normalizar) y comparar por cola. No pedir al usuario re-rechazar; no borrar la memoria vieja.
- **Aceptación:** rechazar una sugerencia, simular edición del bloque (nuevo hash/pos), verificar que `filterCorrectionsByMemory` sigue filtrándola. Entrada vieja de localStorage sigue filtrando su corrección equivalente.
- **No hacer:** no cambiar el formato de `blockId` (otros sistemas lo parsean: `block-invalidation.ts`, decoraciones); solo el fingerprint deja de usarlo.

#### Fix 3 — Admisión única (C3, C6)

- **Crear:** `lib/corrections/engine/admission.ts`.
- **Contrato:**
  ```ts
  export type AdmissionContext = {
    learnedWords: ReadonlySet<string>   // ya normalizadas (createLearnedWordSet)
    rejectedFingerprints: ReadonlySet<string>
    blockText: (blockId: string) => string | null
  }
  // TODA sugerencia pasa por aquí antes de ser visible, venga de donde venga.
  // Orden de filtros: learned words → memoria de rechazos → límites de token (Fix 1) → dedupe.
  export const admitSuggestions = (
    candidates: PublicationSuggestion[],
    ctx: AdmissionContext,
  ): PublicationSuggestion[]
  ```
- **Puntos de integración (los tres, no menos):**
  1. Resultado de análisis en `processCorrectionQueue` (editor-shell, símbolo `normalizeAutomaticSuggestion`).
  2. Hidratación de cache — hoy `flattenPersistedSuggestions` entrega sin filtrar (es C3).
  3. `handleLearnWord` y la carga tardía de learned words re-ejecutan admisión sobre el estado actual (cierra C6 sin resolver la carrera: si el análisis ganó, la llegada de la lista limpia después).
- **Aceptación:** (a) sugerencia cacheada para palabra aprendida después del cacheo no aparece al hidratar; (b) si la lista de learned words llega después del primer análisis, las sugerencias de esas palabras desaparecen al llegar; (c) aprender una palabra elimina todas sus sugerencias visibles en el doc actual (comportamiento actual preservado).
- **No hacer:** no bloquear el primer análisis esperando la lista (decisión de producto: análisis rápido + limpieza retroactiva).

#### Fix 4 — Ciclo de vida con salidas totales (C4, C10)

- **Crear:** `lib/corrections/engine/lifecycle.ts` con las transiciones como funciones puras sobre `PublicationSuggestionStatus`.
- **Reglas nuevas (las únicas — el resto ya existe):**
  - `pending-stale` lleva `staleSince: number`. Si el re-análisis del bloque no la resolvió en **10 s**, se dropea (nunca queda atenuada con accept deshabilitado — es C4).
  - Error de análisis (`result.error` en `processCorrectionQueue`) → dropear las stale de ese bloque, no `continue` silencioso.
  - Cache-hit al re-encolar (símbolo `enqueueCorrectionBlock`, rama `cachedBlock`) → re-admitir las sugerencias del cache vía Fix 3 y volverlas `pending`, no retornar dejando stale.
  - Ventana de supresión post-hidratación (símbolo `suppressCorrectionAnalysisUntilRef`): los dirty blocks descartados durante la ventana se **difieren** (re-encolar al expirar), no se pierden. `[hipótesis]` — reproducir primero con test: editar dentro del primer 1.2 s y verificar que hoy nunca se analiza.
- **Aceptación:** ninguna sugerencia permanece `pending-stale` > 10 s en ningún camino (error, cache-hit, supresión); test por cada camino.
- **No hacer:** no introducir un scheduler nuevo — usar los timers existentes del shell; no cambiar el UX de "Recalculando…" mientras la stale es legítima (< 10 s).

#### Fix 5 — Learned words robustos (C7, C8)

- Rollback en `handleLearnWord`: en el `catch` del `learnWord()`, quitar el entry optimista (espejo exacto de cómo `handleRemoveLearnedWord` ya revierte) y mostrar toast de error según `skill-frontend §Errores`.
- Retry de carga: `learnedWordsLoadedRef` se marca `true` solo en éxito; en fallo, reintentar con backoff simple (1 reintento a los 5 s basta).
- Paginación: si `nextCursor` existe, seguir paginando en background hasta agotar (el endpoint ya es cursor-based); eliminar el estado `learnedWordsDeferred` y su copy en el panel.
- **Aceptación:** mock de `learnWord` que falla → la palabra no queda en la lista y la sugerencia reaparece; mock con 150 palabras → las 150 llegan al request de análisis.

#### Fix 6 — Parseo con degradación parcial (C5, C18)

- En `lib/ai/corrections.ts`, reemplazar `corrections: z.array(canonicalCorrectionSchema).catch([])` por parseo por item: `z.array(z.unknown())` + `safeParse` de cada elemento, descartando solo los inválidos y logueando `{ dropped: n }`.
- Unificar streaming/no-streaming de `publication-review/route.ts` extrayendo la normalización compartida a una función; los dos paths la llaman.
- **Aceptación:** respuesta con 3 correcciones válidas + 1 con `type` inventado produce 3 sugerencias (hoy produce 0).

#### Fix 7 — Anotaciones por marca (A1, A2)

- En `applyAnnotationToBody` (`lib/editor/annotation-document.ts`, símbolo `highlightMark.create()`): crear el mark con attr `annotationType`. Requiere extender el mark `Highlight` en `lib/editor/extensions.ts` con `addAttributes` que renderice `data-annotation-type`.
- CSS: reemplazar los selectores `p:has(sup.annotation-ref-*) mark` de `globals.css` por `mark[data-annotation-type="ai"]`, etc. Los marks sin attr conservan el estilo default ámbar (highlights manuales del usuario).
- Unificar la paleta: un solo naranja para highlight (decidir entre `#C07B2A` y `#e7af02`) aplicado a superíndice y subrayado.
- **Riesgo a verificar primero:** round-trip markdown — confirmar que el attr sobrevive `serializeDocumentToMarkdown` → re-parse, o documentar que se re-deriva. Si el subrayado de anotaciones se re-deriva de otra forma en `/shared` y `/preview`, sincronizar las cuatro superficies (contrato de `skill-frontend §presentación textual`).
- **Aceptación:** párrafo con anotación AI + anotación highlight muestra cada resaltado de su color; highlight manual junto a anotación AI permanece ámbar.

#### Fixes 8-10 — Decisiones de producto primero

Los pasos 8 (spellcheck nativo), 9 (batching/cola) y 10 (acentos en learned words, memoria a Supabase) **requieren decisión humana antes de implementar** — no ejecutar por agente sin confirmación explícita del owner. Para el 9, la referencia de batching es `buildMechanicalCorrectionsPrompt(blocks[])` que ya acepta múltiples bloques; el cambio es agrupar la cola por tanda (3-5 bloques) manteniendo la invalidación por bloque individual.

**Decisiones registradas en ODE-352 (2026-07-07):**

- **Fix 8 — Spellcheck nativo (C11):** dejarlo como está. El usuario puede desactivarlo con el toggle existente (`lib/editor/spellcheck.ts`); no se apaga por defecto ni se unifica la señal visual.
- **Fix 10a — Acentos en learned words (C19):** conservar acentos en la normalización. `normalizeLearnedWord` deja de quitar diacríticos (ODE-352). Aprender "probabilídad" ya no silencia correcciones sobre "probabilidad". Las palabras aprendidas antes del cambio siguen vigentes bajo su forma guardada.
- **Fix 10b — Memoria de rechazos (C16):** mantener en `localStorage`. No se migra a Supabase en esta etapa; el fingerprint estable sigue viviendo en `correction-memory-client.ts`.

---

## 7. Auditoría de documentación (`workflow/`) — sesgos, contradicciones y context rot

Auditado 2026-07-03: `odessay-ai-writing-assist.md`, `odessay-ai-writing-assist-mejoras.md`, `odessay-anotaciones-ai.md`, `odessay-prosemirror-tiptap.md`, `workflow/docs.json`, contra el código actual. Mismo protocolo del §0: cada ítem indica certeza.

### Contradicciones (docs ↔ docs ↔ código)

**D1 — Batching existe y no existe en el mismo documento.** `[verificado]` `odessay-ai-writing-assist.md §Principio 2` lo describe en presente ("el backend recibe un array de `correctionBlocks`"); el mismo doc en §Contratos declara `correctionBlock` singular como único contrato válido, y su tabla de gaps admite "1 bloque = 1 llamada, sin batching". El código confirma singular. Además `-mejoras.md §Mejora 2` tiene la spec completa del batch sin marcar como pendiente. Cuatro afirmaciones, una sola verdad (no hay batching). Al implementar Fix 9, usar Mejora 2 como spec y reconciliar las cuatro menciones.

**D2 — Strike: el skill lo prohíbe, el código lo tiene.** `[verificado]` `skill-frontend §Editor TipTap` decía "Extensiones excluidas intencionalmente: Underline, Strike"; `odessay-prosemirror-tiptap.md` lo lista activo y `lib/editor/extensions.ts:76` lo confirma. Además, al aplicar el fix se encontró el mismo rot en `odessay-editor.md:114`, que declaraba `Table` excluida cuando está activa (extensions.ts la registra y `markdown-format.ts` la normaliza). Ambos corregidos: la única exclusión real es `Underline`, y ambos docs ahora nombran `lib/editor/extensions.ts` como inventario canónico.

**D3 — El doc de anotaciones describe un sistema de tipos que ya no existe.** `[verificado]` `odessay-anotaciones-ai.md` define `footnote|personal|ai|collaborative` con sigil `[@cn]` y ámbar para collaborative. El código (`footnote-node.ts:5`) tiene `footnote|personal|ai|highlight`, mapea el prefijo `c` a **personal** y `h` a highlight, y el CSS da el ámbar a highlight. El doc nunca menciona el tipo `highlight` que causó el hallazgo A1. Coincide con la nota de memoria del proyecto: ODE-169 pendiente de reescritura — pero el doc no declara su propia obsolescencia.

**D4 — Los docs prescriben el matching por substring que los guardrails prohíben.** `[verificado]` `§Principio 4` ("si el texto editado todavía contiene `originalText`") y `-mejoras.md §Mejora 4` (código de ejemplo con `block.text.includes(...)`) especifican substring matching; `odessay-prosemirror-tiptap.md §Guardrail C` y `skill-frontend` lo prohíben como mecanismo final. El bug C1 no es una desviación del spec: **es el spec**. Al hacer Fix 1, reescribir Principio 4 y Mejora 4 para exigir límites de token.

**D5 — Streaming documentado como flujo vigente; el flujo real no lo usa.** `[verificado el lado cliente; hipótesis el lado muerto]` `§Streaming` ("Backend emite NDJSON… frontend consume eventos parciales") y la descripción en `docs.json` ("correcciones mecánicas en streaming") lo presentan como actual; el flujo automático llama con `stream: false` (editor-shell) y no se encontró consumidor activo del path streaming. Confirmar que nada lo usa antes de eliminarlo en Fix 6/C18 — y corregir doc + docs.json.

### Context rot

**D6 — Dos docs huérfanos del inventario canónico.** `[verificado]` `odessay-anotaciones-ai.md` y `odessay-ai-writing-assist-mejoras.md` no existen en `workflow/docs.json` — invisibles para la ruta de descubrimiento que `skill-product-manager` exige (`prompt → docs.json → doc`). Viola la regla del propio skill ("no dejar documentos huérfanos"). Registrarlos o archivarlos.

**D7 — El doc de mejoras no distingue lo hecho de lo pendiente.** `[verificado]` Solo Mejora 3 declara "completado (ODE-327)". Las Mejoras 0, 1, 4, 5, 6 y 7 ya están implementadas (observabilidad, persistencia, smart invalidation, métricas, limpieza legacy, panel sin filtro) pero se leen como pendientes; la única realmente pendiente es la 2 (batching). Un agente que lo lea puede re-implementar trabajo hecho. Convertirlo en changelog con estado por mejora, o fusionar el remanente al doc principal y archivarlo.

**D8 — Debounce de 5 s para paste masivo: especificado dos veces, implementado cero.** `[verificado]` `§Principio 3` y `-mejoras.md §Mejora 3` lo afirman; el código solo tiene el debounce de 2 s. Aspiración en presente indicativo.

**D9 — `prosemirror-tiptap.md` desactualizado en tres puntos.** `[verificado]` (a) "No usa todavía mapping incremental por `tr.mapping`" — el extension actual sí mapea decoraciones por transaction mapping; (b) la lista de custom extensions omite `CorrectionTriggerExtension` y `FrontmatterNode`; (c) nombra `FootnoteReferenceNode` cuando el export actual es `AnnotationReferenceNode`.

**D10 — "Sin usuarios en producción" como autorización vigente de migraciones destructivas.** `[requiere confirmación del dueño]` `-mejoras.md §Decisiones` autoriza migraciones destructivas sin backfill sobre esa premisa, sin fecha. Si hoy hay usuarios, es una autorización peligrosa que sobrevive por rot. Confirmar y fechar o retirar.

**D11 — Menores.** `[verificado]` Panel nombrado `OrthographyPanel` y `CorrectionsPanel` en secciones distintas del doc principal (el archivo real es `corrections-panel.tsx`); evento `reason: "paste"` en el spec de observabilidad que el código no emite (`edit | hydrate-miss`); BATCH_SIZE justificado citando "Claude Sonnet 4.6, GPT-4o" cuando el proveedor del contrato es Fireworks y la política del propio doc exige tratar el modelo como variable de entorno.

### Sesgos estructurales

**D12 — Presente aspiracional.** Los "Principios de construcción" describen en presente lo que el sistema *debería* hacer, con la tabla de gaps como único desmentido, secciones más abajo. Un lector (humano o LLM) que no llegue a la tabla toma la aspiración por estado. Regla propuesta para feature docs: toda afirmación no implementada se marca `[objetivo — gap abierto]` en el punto donde se afirma, no solo en una tabla aparte.

**D13 — Happy-path bias en las specs.** Mejora 4 define `pending-stale` sin camino de error ni timeout (→ C4 fue implementación fiel de un spec sesgado); Mejora 1 define retry del push pero ningún doc define qué pasa cuando el análisis falla. La sección `Failure modes` añadida a `skill-product-manager` previene esto hacia adelante; los docs existentes de corrections deben retro-llenarla cuando se ejecute el plan del §6.

### Acciones documentales (adjuntas al plan del §6)

| Con el fix | Actualizar |
|---|---|
| Fix 1 | Reescribir `§Principio 4` y `Mejora 4` exigiendo límites de token (D4) |
| Fix 3 | `§Learned words`: tercera capa de exclusión (S7) |
| Fix 6 | Resolver D5 (streaming): confirmar consumidores, borrar path muerto, corregir doc + docs.json |
| Fix 7 | Reescribir `odessay-anotaciones-ai.md` con el sistema de tipos real (D3) y registrarlo en docs.json (D6) |
| Fix 9 | Reconciliar batching (D1), estado de mejoras (D7), debounce paste (D8) |
| ~~Ahora (sin código)~~ **Aplicado 2026-07-03** | D2 ✔ (Strike/Table en skill-frontend y odessay-editor.md), D9 ✔ (prosemirror-tiptap: tr.mapping, inventario de extensions, AnnotationReferenceNode), D11 ✔ (botón "Corrections"/CorrectionsPanel, evento paste, modelos → env var), D6 ✔ (huérfanos registrados en docs.json con `state` de advertencia; descripción "en streaming" corregida). D10: la autorización "sin usuarios en producción" quedó marcada como **caducada** en el doc de mejoras — toda migración destructiva requiere confirmación explícita del dueño hasta que él responda si ya hay usuarios reales. |

---

## Referencias

- `workflow/context/features/odessay-ai-writing-assist.md` — contrato del subsistema
- `.agents/skills/skill-architecture/SKILL.md` — taxonomía Layer/Runtime/Owner
- `memoria: project_annotations_architecture` — arquitectura de tipos de anotación
- Tests existentes: `tests/shared-reading-service.test.ts`, `lib/testing/orthography-regression-*`
