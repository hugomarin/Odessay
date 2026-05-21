# ODESSAY — AI Writing Assist (Corrections + Title Suggestion)

**Documento de referencia para agentes de desarrollo.**
Lee `workflow/context/features/odessay-editor.md`, `workflow/context/features/odessay-sync.md`, `workflow/context/core/odessay-modelo-datos.md` y `workflow/context/core/odessay-stack.md` antes de implementar.

Última actualización: 2026-05-17.

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

- Las correcciones de cada bloque se almacenan localmente (IndexedDB) y remotamente (Supabase) indexadas por `(writingId, blockId, blockHash)`.
- Al cargar un writing, el sistema restaura sugerencias de bloques cuyo hash coincida sin llamar al modelo.
- Solo los bloques modificados (hash divergente) o nuevos se encolan para corrección.
- Esto elimina el reprocesamiento completo al recargar la página o cambiar de pestaña.

### 2. Velocidad mediante paralelismo y batching

Un documento de 400 palabras distribuido en ~12 párrafos no debe generar 12 llamadas API secuenciales.

- Los bloques se agrupan en lotes (batch) de hasta N unidades por llamada API.
- El batching reduce overhead de HTTP, serialización y espera de respuesta.
- El frontend agrupa bloques dirty adyacentes; el backend recibe un array de `correctionBlocks` y genera un prompt con múltiples bloques etiquetados.
- El presupuesto de tokens escala proporcionalmente al tamaño del batch: `768 × N` con tope razonable.

### 3. Separar "qué analizar" de "cuándo analizarlo"

El trigger de activación no debe depender de la longitud del texto.

- **Qué:** todo bloque con texto válido (`paragraph`, `heading`, `listItem`, `taskItem`, excluyendo `codeBlock`) es candidato a corrección.
- **Cuándo:** se controla por debounce de inactividad (2s para escritura normal, 5s para paste masivo).
- No hay umbral mínimo de palabras. Un párrafo de 3 palabras con un typo mecánico se corrige igual que uno de 30.

### 4. Smart invalidation

Las sugerencias no se destruyen preventivamente.

- Cuando un bloque se edita, el sistema compara el hash nuevo vs el hash de la sugerencia pendiente.
- Si el texto editado todavía contiene `originalText` de la sugerencia, esta se mantiene visible como "pendiente" hasta que llegue la nueva respuesta del modelo.
- Solo se invalidan sugerencias cuyo `originalText` ya no existe en el bloque.
- Esto evita el parpadeo de decoraciones mientras el usuario escribe.

### 5. Observabilidad integrada

Cada corrección lleva métricas para poder optimizar costos y detectar degradación.

- Tokens de prompt y de completion se leen de la respuesta del modelo y se almacenan junto con el bloque.
- Latencia (tiempo desde request hasta respuesta válida) se registra por bloque.
- Estas métricas permiten: ajustar presupuestos de tokens, detectar si un proveedor se volvió lento, y estimar costos por usuario/documento.

---

## Arquitectura actual (contexto)

### Sistema puro `block`

El endpoint `/api/ai/publication-review` opera exclusivamente en modo `block`.

| Modo | Cómo se activa | Estado |
|------|----------------|--------|
| `block` | Frontend envía `correctionBlock: {id, text, hash}` | **Activo — único contrato válido** |

El `PublicationPanel` legacy fue eliminado. El botón del topbar dice "Ortografía" y abre `OrthographyPanel`, que consume el estado de correcciones automáticas por bloque.

**Decisión:** no reintroducir modo `document`. Si se necesita revisión completa del documento, implementarla como batch de bloques sobre el contrato `block` existente.

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
correctionBlock: {
  id: "correction-block:${hash}:${pos}",  // opaco para el backend
  text: "...",
  hash: "blk-..."
}

// Backend responde
corrections: [
  { blockId: "correction-block:${hash}:${pos}", originalText: "...", replacementText: "..." }
]
```

El frontend usa `block_id` + `source_hash` para invalidar sugerencias cuando el texto cambia y para calcular el rango de la decoración inline.

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

### Streaming

- Backend emite NDJSON (`application/x-ndjson`).
- Frontend consume eventos `suggestion` parciales y los acumula en estado.
- Decoraciones inline se actualizan vía TipTap plugin sin bloquear el editor.

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

La API ya no mantiene una rama `document` ni helpers de partición de texto como `buildCorrectionBlocks()`. El contrato válido exige `correctionBlock` en cada request.

**Decisión:** mantener la API acotada a modo `block`. Si en el futuro se necesita revisión completa del documento, diseñarla como batch de bloques sobre modo `block`.

### Estado actual vs principios

El sistema actual no cumple aún todos los principios de construcción. Estos son los gaps conocidos:

| Principio | Estado actual | Gap |
|-----------|--------------|-----|
| Persistir para no reprocesar | Persistencia IndexedDB + Supabase con write-through | Completado en ODE-165 |
| Velocidad mediante batching | 1 bloque = 1 llamada HTTP secuencial | Sin batching ni paralelismo |
| Separar qué/cuándo | Umbral de 8 palabras descarta párrafos cortos | Filtro de longitud mezcla concerns |
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
      "blockId": "correction-block:abc123:456",
      "type": "spelling",
      "originalText": "hhacia",
      "replacementText": "hacia"
    }
  ]
}
```

Nota: ODE-502 eliminó `summary`, `severity`/`confidence` obligatorios, y el array `uncertain` del contrato mecánico. El adapter (`corrections-contract-adapter.ts`) mantiene compatibilidad hacia atrás.

### Memoria de decisiones

- **Reject:** fingerprint se guarda en `localStorage` (`correction-memory-client.ts`) para no re-sugerir equivalentes.
- **Accept:** se aplica al markdown y se marca como `accepted`.
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
- `app/api/ai/publication-review/route.ts` — endpoint de correcciones (modo `block`)
- `lib/ai/corrections.ts` — schema, prompt builder, normalización
- `lib/ai/corrections-contract-adapter.ts` — adaptador de contrato legacy
- `lib/editor/correction-trigger-plugin.ts` — detección de dirty blocks
- `lib/editor/publication-suggestion-extension.ts` — decoraciones inline
- `components/editor/panels/corrections-panel.tsx` — panel lateral con toggles
- `components/editor/editor-shell.tsx` — orquestación del flujo
- `lib/corrections/persistence.ts` — persistencia remota e IndexedDB de correction blocks

### Legacy / no usados
- `components/editor/panels/publication-panel.tsx` — panel legacy; no se renderiza
