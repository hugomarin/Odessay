# ODESSAY — AI Writing Assist (Corrections + Title Suggestion)

**Documento de referencia para agentes de desarrollo.**
Lee `workflow/context/features/odessay-editor.md`, `workflow/context/features/odessay-sync.md`, `workflow/context/core/odessay-modelo-datos.md` y `workflow/context/core/odessay-stack.md` antes de implementar.

Última actualización: 2026-07-08.

---

## Propósito

Este documento define el contrato operativo de dos funcionalidades AI del editor:

1. **Mechanical corrections** (corrección ortográfica/gramatical conservadora).
2. **Title suggestion** (sugerencia de nombre de writing).

No reemplaza `odessay-ai-editor.md` (editor residente de observaciones). Esta spec cubre el AI assist orientado a micro-correcciones y naming.

---

## Alcance y no-alcance

### Alcance
- Detectar errores mecánicos (ortografía, acentos, typos, concordancia básica, puntuación, spacing, duplicaciones).
- Mostrar correcciones inline por bloque con aceptar/rechazar.
- Toggle global de activación/desactivación de correcciones automáticas.
- Toggle de visibilidad de decoraciones inline.
- Sugerir un título en flujo explícito de renombre.

### No-alcance
- Reescritura editorial extensa.
- Cambios de voz/tono del autor.
- Traducción del texto.
- Aplicación automática de cambios sin confirmación del autor.

---

## Principios de construcción

### 1. Persistir para no reprocesar

El trabajo del modelo es caro y lento. Una vez que un bloque fue analizado y su hash no cambió, no debe volver a pasar por la API.

- Las correcciones de cada bloque se almacenan localmente (IndexedDB) y remotamente (Supabase) indexadas por la identidad activa del bloque: `writingId`, `blockId` y `blockHash`.
- Al cargar un writing, el sistema restaura sugerencias de bloques cuyo hash coincida sin llamar al modelo.
- Solo los bloques modificados (hash divergente) o nuevos se encolan para corrección.
- Esto elimina el reprocesamiento completo al recargar la página o cambiar de pestaña.
- Si un Accept/Reject o una edición manual cambia el `blockHash` del mismo párrafo lógico, la persistencia debe **remapear** la fila existente al nuevo `blockId`/`blockHash` y borrar la fila stale anterior para que IndexedDB y Supabase converjan sobre una sola versión activa.

### 2. Velocidad mediante paralelismo y batching

Un documento de 400 palabras distribuido en ~12 párrafos no debe generar 12 llamadas API secuenciales.

- Los bloques se agrupan en lotes (batch) de hasta N unidades por llamada API.
- El batching reduce overhead de HTTP, serialización y espera de respuesta.
- El frontend agrupa bloques dirty adyacentes; el backend recibe un array de `correctionBlocks` y genera un prompt con múltiples bloques etiquetados.
- El presupuesto de tokens escala proporcionalmente al tamaño del batch: `768 × N` con tope razonable.

### 3. Separar "qué analizar" de "cuándo analizarlo"

El trigger de activación no debe depender de la longitud del texto.

- **Qué:** todo bloque con texto válido (`paragraph`, `heading`, `listItem`, `taskItem`, excluyendo `codeBlock`) es candidato a corrección.
- **Cuándo:** se controla por debounce de inactividad de 2s. El debounce extendido de 5s para paste masivo fue retirado del spec en ODE-351; batching absorbe el volumen sin introducir una segunda ventana temporal.
- No hay umbral mínimo de palabras. Un párrafo de 3 palabras con un typo mecánico se corrige igual que uno de 30.

### 4. Smart invalidation

Las sugerencias no se destruyen preventivamente.

- Cuando un bloque se edita, el sistema compara el hash nuevo vs el hash de la sugerencia pendiente.
- Si el texto editado todavía contiene `originalText` como match válido de límites de token, esta se mantiene visible como "pendiente" hasta que llegue la nueva respuesta del modelo.
- Solo se invalidan sugerencias cuyo `originalText` ya no existe como rango limpio seleccionable con límites de token.
- Esto evita el parpadeo de decoraciones mientras el usuario escribe.
- Enforced by: `tests/corrections-matching.test.ts`.
- A nivel de cache persistido, la invalidación ya no depende solo de posición exacta. El sistema invalida por **identidad lógica del bloque** y usa una **ventana posicional pequeña** como fallback para filas legacy que aún no tienen identidad lógica estable.
- Invariante persistido: Supabase e IndexedDB deben converger al **cache activo actual** del writing; versiones lógicas stale del mismo párrafo no se conservan como historial activo cuando cambia `source_hash`.
- Cuando el párrafo lógico sigue existiendo pero su hash cambia, el write-through de persistencia debe reconstruir la fila con el `blockId`/`blockHash` actuales, reescribir `suggestions[*].source_hash`, y enviar `deletedBlockIds` para retirar la fila stale remota.
- Las sugerencias en estado `pending-stale` llevan `staleSince` y expiran tras 10 s si el re-análisis no las resuelve; error de análisis, cache-hit y ventana de supresión post-hidratación deben tener salida explícita. Enforced by: `tests/corrections-lifecycle.test.ts`.

### 5. Observabilidad integrada

Cada corrección lleva métricas para poder optimizar costos y detectar degradación.

- Tokens de prompt y de completion se leen de la respuesta del modelo y se almacenan junto con el bloque.
- Latencia (tiempo desde request hasta respuesta válida) se registra por bloque.
- Estas métricas permiten: ajustar presupuestos de tokens, detectar si un proveedor se volvió lento, y estimar costos por usuario/documento.

---

## Arquitectura actual (contexto)

### Sistema batch de `block`

El endpoint `/api/ai/publication-review` opera en modo `block-batch`.

| Modo | Cómo se activa | Estado |
|------|----------------|--------|
| `block-batch` | Frontend envía `correctionBlocks: [{id, text, hash}]` con máximo 5 bloques | **Activo — contrato válido** |
| `block` legacy | Consumidores externos pueden enviar `correctionBlock: {id, text, hash}` durante transición | **Tolerado — se normaliza internamente a batch de 1** |

El `PublicationPanel` legacy fue eliminado. El botón del topbar dice "Corrections" y abre `CorrectionsPanel` (`components/editor/panels/corrections-panel.tsx`), que consume el estado de correcciones automáticas por bloque.

**Decisión:** no reintroducir modo `document`. Si se necesita revisión completa del documento, implementarla como batch de bloques sobre el contrato `block-batch` existente.

### Flujo de corrección automática

```
[Usuario escribe] → [ProseMirror plugin detecta dirty blocks] → [Debounce 2s]
→ [Enviar bloque(s) a /api/ai/publication-review] → [Modelo responde]
→ [Decoraciones inline + panel Ortografía] → [Usuario acepta/rechaza]
```

**Componentes activos:**
- `correction-trigger-plugin.ts` — detecta nodos modificados en transacciones ProseMirror.
- `publication-suggestion-extension.ts` — pinta decoraciones inline y burbujas de acción.
- `CorrectionsPanel` — lista de sugerencias pendientes con toggles de activación/visibilidad.
- `editor-shell.tsx` — orquesta el flujo completo: recibe dirty blocks, maneja debounce, encola requests, aplica sugerencias, controla toggles.

### Mapeo frontend ↔ backend

El backend no conoce ProseMirror. El contrato usa `blockId` como string opaco:

```ts
// Frontend envía
correctionBlocks: [
  {
    id: "correction-block:${logicalId}:${hash}:${pos}",  // opaco para el backend
    text: "...",
    hash: "blk-..."
  }
]

// Backend responde
corrections: [
  { blockId: "correction-block:${logicalId}:${hash}:${pos}", originalText: "...", replacementText: "..." }
]
```

`logicalId` se deriva de la ruta estructural del bloque en el documento ProseMirror (índices por profundidad) y permanece estable ante pequeños shifts de posición causados por ediciones manuales dentro del mismo bloque lógico.

El frontend usa `block_id` + `source_hash` para invalidar sugerencias cuando el texto cambia y para calcular el rango de la decoración inline. Para persistencia, la invalidación stale sigue esta jerarquía:

1. match por `logicalId` cuando existe en ambos lados;
2. fallback por ventana posicional corta para filas legacy;
3. exclusión por `blockHash` actual para no borrar la versión vigente.

Guardrails del mapper:
- El sufijo posicional de `blockId` identifica la posición del nodo bloque en ProseMirror, no el primer carácter del bloque.
- Al convertir offsets locales del bloque a posiciones del documento, el frontend debe sumar también el content offset interno del nodo (`blockPos + 1`), no usar `blockPos` crudo.
- Antes de aplicar Accept/Replace, el texto actual del documento en el rango resuelto debe seguir siendo exactamente `originalText`; si no coincide, la sugerencia se marca como stale/conflict y no se aplica.
- En hidratación, cualquier bloque persistido cuyo `block_hash` ya no exista en el documento actual debe eliminarse del cache local y remoto antes de reexponer sugerencias.

### Harness de regresión canónico

ODE-330 introduce un harness determinista para la familia de bugs de ortografía y persistencia:

- Ruta: `/perf/orthography-harness`
- Cliente: `app/perf/orthography-harness/orthography-harness-client.tsx`
- Fixture: `lib/testing/orthography-regression-fixture.ts`
- Writing seeded: `13192f3a-d68e-4ff9-bcf8-fe02cce6b8aa`
- Test de aceptación: `tests/playwright/orthography-regression-harness.e2e.ts`

Propósito operativo:

- reproducir sin llamadas live al modelo el flujo de apply/reject/manual edit/reload
- verificar que párrafos cortos sigan siendo elegibles para corrección
- verificar que la persistencia remueva bloques stale cuando cambia el `blockHash` del mismo bloque lógico
- verificar que panel, decoraciones inline e hidratación recargada converjan al mismo set de sugerencias activas

Escenario canónico del fixture:

- el panel inicial debe exponer `funcioando`, `aplicació`, `paralabras`, `aprrafo`, `mejro`, `Solo asi`, `Tendremos una buen producto` y la sugerencia de puntuación `escritorio creo -> escritorio. Creo`
- aceptar `funcioando` no debe activar ni aplicar sugerencias no relacionadas
- aceptar `escritorio creo -> escritorio. Creo` no debe corromper el texto (`deescritorio. Creoo`)
- editar manualmente `mejro -> mejor` debe invalidar la sugerencia stale y persistir el estado corregido tras recarga

---

## Contrato de proveedor/modelo (obligatorio)

- Nunca hardcodear IDs de modelo en rutas de negocio.
- Resolver proveedor/modelo por configuración de entorno.
- Si falta configuración requerida, responder error explícito de configuración (no 404 opaco de proveedor).

Variables mínimas para flujo Fireworks:
- `FIREWORKS_API_KEY`
- `FIREWORKS_MODEL`
- `FIREWORKS_MAX_TOKENS` (opcional — override del presupuesto; default 4096 en `provider-config.ts`)

Política:
- Cambios de modelo son operativos (env), no cambios de código.
- Los docs y briefs deben tratar el modelo como variable temporal, no como constante funcional.

### Presupuesto de tokens

**El output del modelo no es el texto completo del bloque — son solo los fragmentos a corregir.** El costo de output escala con la densidad de errores, no con la longitud del texto.

**El overhead de estructura JSON domina.** Cada corrección lleva campos (`blockId`, `type`, `originalText`, `replacementText`). El schema simplificado en ODE-502 eliminó `summary`, `severity`/`confidence` obligatorios, y el array `uncertain`, reduciendo el overhead por corrección.

Cálculo de referencia para llamadas por bloque (post-ODE-502):
- 5 correcciones × ~40 tokens = ~200 tokens
- 10 correcciones = ~400 tokens
- 15 correcciones = ~600 tokens
- **Budget por bloque: 768 tokens.**
- **Budget para batch de 4 bloques: ~3072 tokens.**

**Síntoma de presupuesto insuficiente:** JSON truncado → parse falla → retry → latencia alta. El fix es el token budget, no el retry path.

### Documentación del proveedor — consulta obligatoria

Antes de implementar cualquier cambio en el modo de salida del proveedor (structured output, streaming, tool use), verificar en la documentación oficial de Fireworks:

- ¿El modo `json_schema` es compatible con `stream: true` para este modelo?
- ¿El proveedor puede devolver prose aunque se pida JSON mode? (Fireworks puede.)
- ¿Los chunks de streaming incluyen `delta.content` o solo el objeto final?

Registrar en el `Context Report` del BUILD qué docs se leyeron y qué comportamiento se verificó.

---

## Feature A — Mechanical Corrections

### Objetivo funcional

Corregir errores mecánicos con alta confianza y reemplazos mínimos, preservando voz e intención.

### Trigger

- **Automático:** debounce por inactividad de escritura (2s). El plugin ProseMirror identifica bloques dirty tras cada transacción.
- **Manual:** no existe actualmente en la UI. El botón "Reanalyze" del panel legacy fue eliminado.

### Estado actual de elegibilidad e invalidación

- No existe umbral mínimo de palabras para correcciones automáticas; párrafos cortos como `Solo asi` siguen siendo elegibles.
- Las coincidencias parciales de token no deben subrayarse ni aceptarse como reemplazos válidos.
- Las sugerencias persistidas se reconcilian por bloque lógico primero y por ventana posicional legacy solo como fallback.
- Si una sugerencia aceptada cambia el hash del mismo párrafo lógico, el cache persistido debe remapearse a la nueva identidad antes de exponer la siguiente hidratación.

### Publication-review response mode

- El flujo vigente de correcciones mecánicas es request/response JSON: `POST /api/ai/publication-review` devuelve el envelope estándar `{ data, error }`.
- Los consumidores activos (`editor-shell`, `web-ai-service`, `desktop-ai-service`) usan `stream: false` o no envían `stream`.
- El endpoint conserva el campo `stream` como input legacy tolerado, pero ya no expone NDJSON ni eventos parciales; la route mantiene una sola normalización canónica para la respuesta del modelo.

### Learned words

El motor admite una tercera acción por sugerencia ortográfica — **Learn word** — además de Accept/Reject. Al usarla:

- La sugerencia actual se descarta visualmente (mismo efecto que Reject).
- La palabra se registra en un diccionario por usuario (`public.learned_words`).
- Futuras correcciones no deben volver a marcar esa palabra para el mismo usuario.

**Persistencia.** La tabla `learned_words` vive en Supabase con RLS owner-only (`user_id = auth.uid()`), FK a `profiles(id) on delete cascade`, y un índice único sobre `(user_id, language, word)`.

**Normalización.** Las palabras se normalizan case-insensitive y accent-insensitive antes de guardar y antes de filtrar, de modo que aprender "Odéssay" también proteja "odessay" y "ODESSAY".

**Exclusión en tres capas.** Para no depender solo de que el modelo obedezca la instrucción:

1. El prompt (`buildMechanicalCorrectionsPrompt`) incluye una lista de "User learned words to always preserve".
2. La normalización canónica (`normalizeCanonicalCorrections`) descarta cualquier corrección cuyo `originalText` normalizado coincida con una palabra aprendida.
3. La admisión del cliente (`admitSuggestions`) filtra toda sugerencia antes de hacerla visible, venga del análisis, cache hidratado o re-admisión tras cambios en learned words.

Enforced by: `tests/corrections-admission.test.ts`.

**Relación con `correction-memory-client.ts`.** La memoria de Reject existente guarda un fingerprint por instancia de corrección y coexiste con el diccionario de palabras. Learn word generaliza por palabra; Reject sigue siendo por ocurrencia específica.

**UI.** Learn word aparece en la burbuja inline y en el panel de correcciones para sugerencias de tipo `spelling`/`accent`. El panel también expone una lista mínima de palabras aprendidas con acción de remover.

**Performance.** La lista de palabras aprendidas se carga una sola vez por sesión de documento (`useEffect` en `EditorShell` con guarda `learnedWordsLoadedRef`), no por bloque. El endpoint de lista usa paginación cursor-based con límite configurable; el cliente solicita páginas de `limit=100` y pagina en background hasta agotar `nextCursor`, difiriendo las páginas adicionales fuera de los primeros 3 s del bootstrap y sin estados visibles intermedios.

---

## Feature B — Title Suggestion

### Objetivo funcional

Sugerir un único título útil, corto y coherente con el contenido, bajo invocación explícita de usuario.

### Reglas de UX

- No auto-renombrar el writing.
- Mostrar sugerencia como opción "Use suggestion".
- Si el usuario escribe título manual, la decisión manual prevalece.

### Reglas de robustez

- Si contenido insuficiente: devolver error de dominio claro.
- Si falla proveedor: fallback de error de UX sin romper el modal.

---

## Decisiones arquitectónicas y deuda técnica

### Modo `document` — eliminado

La API ya no mantiene una rama `document` ni helpers de partición de texto como `buildCorrectionBlocks()`. El contrato válido exige `correctionBlocks[]` en cada request; `correctionBlock` singular se tolera solo como compatibilidad de transición.

**Decisión:** mantener la API acotada a modo `block-batch`. Si en el futuro se necesita revisión completa del documento, diseñarla como batch de bloques sobre modo `block-batch`.

### Estado actual vs principios

El sistema actual no cumple aún todos los principios de construcción. Estos son los gaps conocidos:

| Principio | Estado actual | Gap |
|-----------|--------------|-----|
| Persistir para no reprocesar | Persistencia IndexedDB + Supabase con write-through | Completado en ODE-165 |
| Velocidad mediante batching | `correctionBlocks[]` de hasta 5 bloques por llamada | Completado en ODE-351; fallback legacy singular tolerado durante transición |
| Separar qué/cuándo | Todo bloque válido con texto es elegible; debounce controla cuándo se analiza | Completado en ODE-327 |
| Smart invalidation | Stale invalidation con keep/drop/replace | Mejorado en ODE-163 |
| Observabilidad | `logCorrectionEvent` con discriminated union de 8 eventos | Completado en ODE-161 |
| Control de usuario | Toggles de activación y visibilidad de correcciones | Completado en ODE-167 |

Estos gaps están documentados como trabajo pendiente. Cada cambio debe avanzar hacia los principios sin romper el flujo existente.

---

## Contratos de datos

### Corrections (canónico — post-ODE-502)

```json
{
  "language": "es",
  "corrections": [
    {
      "blockId": "correction-block:0.3:abc123:456",
      "type": "spelling",
      "originalText": "hhacia",
      "replacementText": "hacia"
    }
  ]
}
```

Nota: ODE-502 eliminó `summary`, `severity`/`confidence` obligatorios, y el array `uncertain` del contrato mecánico. El adapter (`corrections-contract-adapter.ts`) mantiene compatibilidad hacia atrás.

#### Invariante de selección de rangos

- `originalText` debe coincidir con un rango seleccionable limpio dentro del bloque.
- `spelling`, `accent`, `grammar`, `agreement`, `duplication` y `basic_redaction` solo se aceptan cuando `originalText` cae sobre límites completos de palabra o frase; un substring parcial dentro de un token mayor se rechaza.
- `spacing` y `punctuation` también deben mapear a un rango limpio seleccionable. No se aceptan substrings parciales dentro de una palabra solo por coincidir textualmente.
- Si el modelo devuelve un match parcial ambiguo, el sistema lo descarta durante la normalización canónica. No se expande silenciosamente al token completo.

### Memoria de decisiones

- **Reject:** fingerprint estable se guarda en `localStorage` (`correction-memory-client.ts`) para no re-sugerir equivalentes.
  - Formato canónico: `type|originalText|replacementText`, con partes normalizadas (`trim`, lowercase, whitespace colapsado).
  - La identidad nunca incluye `blockId`, hash de texto ni posición. `blockId` sigue siendo ubicación opaca para invalidación/decoraciones.
  - Compatibilidad legacy: entradas antiguas `blockId|type|originalText|replacementText` siguen filtrando por su cola estable `type|originalText|replacementText`.
- **Accept:** se aplica al markdown y se marca como `accepted`.
- **Learn word:** registra la palabra en el diccionario por usuario (`learned_words`) y la descarta del set visible.
- **Edición manual:** invalida sugerencias del bloque afectado.

---

## Criterios de aceptación transversales

- No regresión en `title suggestions` al cambiar flujo de corrections.
- No regresión en endpoints AI no relacionados.
- Logs suficientes para depurar: blockId/sourceHash, descarte de chunk stale, parse/retry de JSON.
- E2E/manual QA obligatorio con:
  - texto corto con 3-5 typos;
  - texto largo de al menos 300 palabras;
  - correcciones repetidas en el mismo texto;
  - aceptar una corrección sin reanálisis automático;
  - recargar la página y verificar comportamiento de persistencia (si aplica).

---

## Referencias de implementación

### Activos
- `app/api/ai/publication-review/route.ts` — endpoint de correcciones (modo `block-batch`)
- `app/api/corrections/learned-words/route.ts` — diccionario de palabras aprendidas (list/create/delete)
- `lib/ai/corrections.ts` — schema, prompt builder, normalización
- `lib/ai/corrections-contract-adapter.ts` — adaptador de contrato legacy
- `lib/corrections/learned-words.ts` — normalización y helpers del diccionario
- `lib/editor/correction-trigger-plugin.ts` — detección de dirty blocks
- `lib/editor/publication-suggestion-extension.ts` — decoraciones inline
- `components/editor/panels/corrections-panel.tsx` — panel lateral con toggles y lista de learned words
- `components/editor/editor-shell.tsx` — orquestación del flujo
- `lib/corrections/persistence.ts` — persistencia remota e IndexedDB de correction blocks
- `lib/services/contracts/ai-service.ts` — contrato `AIService` con operaciones de learned words

### Legacy / no usados
- `components/editor/panels/publication-panel.tsx` — panel legacy; no se renderiza
