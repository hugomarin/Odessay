# ODESSAY — AI Writing Assist: Plan de Mejoras

**Documento de trabajo para agentes de desarrollo.**
Deriva de `odessay-ai-writing-assist.md`. Lee ese documento antes de implementar cualquier cambio aquí.

---

## Visión

El sistema de correcciones debe ser **persistente, rápido y transparente**. Cada bloque analizado se recuerda. Cada recarga restaura. Cada edición solo re-procesa lo que cambió. El usuario nunca ve parpadeos ni esperas innecesarias.

---

## Decisiones de diseño

Estas decisiones son transversales y aplican a todas las mejoras. Cualquier issue de Linear que las contradiga debe revisarse antes de implementar.

### Modelo de persistencia
- **Supabase es la fuente de verdad**. Cada corrección persistida vive ahí.
- **IndexedDB es cache de tránsito** que acelera la UX y reduce carga sobre Supabase.
- **Sync bidireccional simple:**
  - Al abrir un writing, si IndexedDB no tiene bloques para ese `writingId`, hidratar desde Supabase.
  - Tras cada corrección exitosa, escribir a IndexedDB inmediatamente y disparar push a Supabase (fire-and-forget con reintento al volver online).
  - Si IndexedDB tiene bloques que Supabase no tiene (push falló previamente), reconciliar al detectarlo.

### Batching
- **Tamaño por defecto: `BATCH_SIZE = 5`** bloques por request.
- Justificación: los modelos del proveedor configurado (variable de entorno `FIREWORKS_MODEL` — el modelo es operativo, no constante funcional; ver `odessay-ai-writing-assist.md §Contrato de proveedor/modelo`) tienen contexto amplio; el cuello de botella es **TTFB percibido**, no el budget. Con 5 bloques el primer resultado llega en ~2–3s; con 8+ se degrada la sensación de progreso.
- Parametrizable vía constante para ajustar con las métricas de la Mejora 5.

### Fallo parcial del batch
Si el modelo responde sugerencias para `k` de los `n` `blockId` enviados, **solo se reintentan los `n-k` faltantes** en un nuevo request. Los bloques con respuesta válida se persisten normalmente.

### Sugerencias stale
Una sugerencia cuyo `originalText` sobrevive a un edit se conserva visualmente con estado `pending-stale`, pero **no es aceptable hasta que llegue la nueva respuesta del modelo**. Esto evita aplicar correcciones obsoletas.

### Paste masivo
**No hay techo duro en la cola de correcciones.** El batching colectivo (Mejora 2) absorbe el caso: 30 bloques pendientes se resuelven en 6 requests de 5, no en 30 individuales. El debounce extendido (Mejora 3) evita disparar mientras el usuario aún organiza el texto.

### Estado actual del proyecto
- **"Sin usuarios en producción" — autorización caducada (revisión 2026-07).** Esta premisa databa del inicio del plan y no tiene fecha de verificación. Antes de cualquier migración destructiva de IndexedDB o Supabase, confirmar con el dueño si ya existen usuarios/datos reales; sin esa confirmación explícita, toda migración debe incluir backfill.

---

## Mejora 0: Observabilidad mínima

### Objetivo
Antes de tocar el flujo de correcciones, instrumentar lo suficiente para validar que las mejoras no regresionan métricas hoy invisibles.

### Cambios

**Frontend — logging estructurado**

```ts
// lib/observability/corrections-log.ts
type CorrectionEvent =
  | { type: "queue:enqueue"; blockId: string; reason: "edit" | "hydrate-miss" } // "paste" se especificó pero nunca se implementó como reason distinto
  | { type: "queue:flush"; batchSize: number; blockIds: string[] }
  | { type: "request:start"; batchId: string; blockIds: string[] }
  | { type: "request:end"; batchId: string; latencyMs: number; suggestions: number; missing: string[] }
  | { type: "cache:hit"; blockId: string; source: "idb" | "supabase" }
  | { type: "cache:miss"; blockId: string }
  | { type: "stale:keep"; blockId: string; suggestionId: string }
  | { type: "stale:drop"; blockId: string; suggestionId: string };

export const logCorrectionEvent = (event: CorrectionEvent) => {
  if (process.env.NODE_ENV !== "production") {
    console.debug("[corrections]", event);
  }
  // Hook futuro: enviar a Supabase si se decide acumular telemetría
};
```

**Backend — un log estructurado por request**

`console.info({ batchId, blockCount, model, latencyMs, promptTokens, completionTokens })` al finalizar cada request del endpoint.

### Archivos a modificar
- `lib/observability/corrections-log.ts` — nuevo
- `components/editor/editor-shell.tsx` — insertar llamadas en puntos clave
- `app/api/ai/publication-review/route.ts` — log al cierre del handler

### Criterio de aceptación
- [ ] En DevTools se puede seguir el ciclo completo de una corrección desde enqueue hasta render.
- [ ] El servidor loguea una línea por request con tokens y latencia.
- [ ] Cero costo en producción (los `console.debug` solo se emiten en dev).

---

## Mejora 1: Persistencia de correcciones automáticas (Supabase + IndexedDB)

### Objetivo
Eliminar el reprocesamiento completo al recargar la página, cambiar de pestaña o cambiar de dispositivo. Supabase guarda el origen, IndexedDB acelera la lectura.

### Cambios

**Supabase — nueva tabla `correction_blocks`** (fuente de verdad)

```sql
create table correction_blocks (
  id text primary key,                   -- "auto-correction:writingId:blockHash"
  writing_id uuid not null references writings(id) on delete cascade,
  block_id text not null,                -- "correction-block:logicalId:hash:pos"
  block_hash text not null,              -- "blk-..."
  suggestions jsonb not null,
  model text not null,
  created_at timestamptz not null default now(),
  latency_ms int,
  prompt_tokens int,
  completion_tokens int
);

create index correction_blocks_writing_id_idx on correction_blocks(writing_id);
create unique index correction_blocks_writing_hash_idx on correction_blocks(writing_id, block_hash);

-- RLS: el dueño del writing es el único que puede leer/escribir sus bloques
alter table correction_blocks enable row level security;

create policy "owner can read own correction blocks"
  on correction_blocks for select
  using (writing_id in (select id from writings where user_id = auth.uid()));

create policy "owner can write own correction blocks"
  on correction_blocks for insert
  with check (writing_id in (select id from writings where user_id = auth.uid()));

create policy "owner can delete own correction blocks"
  on correction_blocks for delete
  using (writing_id in (select id from writings where user_id = auth.uid()));
```

**IndexedDB — nueva store `correctionBlocks`** (cache de tránsito)

```ts
type CachedCorrectionBlock = {
  id: string;                    // "auto-correction:writingId:blockHash"
  writingId: string;
  blockId: string;
  blockHash: string;
  suggestions: PublicationSuggestion[];
  model: string;
  createdAt: string;             // ISO
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  syncedAt: string | null;       // ISO si ya está en Supabase, null si pendiente de push
};
```

`syncedAt` permite detectar bloques creados offline que aún no se han propagado.

**Sync — flujo de hidratación al abrir writing**

1. Cargar bloques desde IndexedDB filtrados por `writingId`.
2. Si la cola local **no cubre todos los nodos** del documento (por hash), pedir el complemento a Supabase y popular IndexedDB.
3. Si IndexedDB tiene bloques con `syncedAt === null`, hacer push a Supabase en background y actualizar `syncedAt`.

**Sync — flujo de escritura tras corrección exitosa**

1. Escribir a IndexedDB con `syncedAt: null` (rápido, no bloquea UI).
2. Disparar `POST` a `/api/corrections/persist` que upsert en `correction_blocks`.
3. Al confirmar, actualizar `syncedAt` en IndexedDB.
4. Si el POST falla, el bloque queda con `syncedAt: null` y se reintenta en la próxima hidratación o cuando vuelva la conexión.

**Invalidación**

Cuando un bloque se edita y su hash cambia:
- Eliminar la entrada vieja de IndexedDB.
- Eliminar la entrada vieja de Supabase.
- La selección de filas stale ya no depende solo de `id` o de posición exacta.
- Primero se busca match por **identidad lógica de bloque** (`logicalId`, derivado de la ruta estructural ProseMirror).
- Si la fila persistida es legacy y no tiene identidad lógica compatible, se usa un fallback por **ventana posicional corta**.
- Nunca se conserva como estado activo una versión lógica stale del mismo párrafo cuando cambia `block_hash`, aunque existan sugerencias `accepted` o `suggestions: []`.

**Eviction en IndexedDB**

Como IDB es cache, se aplica LRU agresiva:
- Tope blando por `writingId`: máximo N writings con bloques cacheados (proponer N=20 inicial, ajustable).
- Al exceder, evictar el `writingId` con `createdAt` más antiguo. El usuario no pierde nada porque Supabase tiene los datos.

### Archivos a modificar
- `supabase/migrations/{timestamp}_create_correction_blocks.sql` — nuevo
- `lib/local-db/schema.ts` — agregar store `correctionBlocks` con bump de `db.version`
- `lib/local-db/index.ts` — métodos `saveCorrectionBlock`, `getCorrectionBlocksByWriting`, `deleteCorrectionBlock`, `markBlockSynced`, `evictOldestWriting`
- `app/api/corrections/persist/route.ts` — nuevo endpoint para upsert en Supabase
- `app/api/corrections/hydrate/route.ts` — nuevo endpoint para leer bloques de Supabase por `writingId`
- `components/editor/editor-shell.tsx` — lógica de hidratación, escritura write-through y reconciliación

### Criterio de aceptación
- [ ] Al recargar la página, los bloques sin cambios muestran sus sugerencias inmediatamente sin llamadas al modelo.
- [ ] Al editar un bloque, solo ese bloque se re-procesa.
- [ ] Al abrir el mismo writing en otro dispositivo (otro navegador, mismo usuario), las correcciones aparecen sin reanálisis.
- [ ] Si IndexedDB se borra (modo incógnito, datos limpiados), al abrir un writing las correcciones se hidratan desde Supabase.
- [ ] Si Supabase está caído, las correcciones siguen funcionando localmente y se sincronizan al volver.
- [ ] RLS impide que un usuario lea o modifique bloques de otro.

---

## Mejora 2: Batching de bloques dirty

### Objetivo
Reducir de N llamadas API a ⌈N/BATCH_SIZE⌉, eliminando overhead de HTTP y reduciendo latencia total.

### Cambios

**Constante compartida**

```ts
// lib/ai/corrections-config.ts
export const BATCH_SIZE = 5;
```

Valor inicial justificado en *Decisiones de diseño*. Parametrizable.

**Backend — schema del request**

```ts
// Antes (singular)
correctionBlock: z.object({ id, text, hash }).optional()

// Después (array, máx. BATCH_SIZE)
correctionBlocks: z.array(z.object({ id, text, hash })).max(BATCH_SIZE).optional()
```

Si llega `correctionBlocks`, generar prompt con múltiples bloques etiquetados:

```
Blocks:
[block-id-1]
Texto del bloque 1...

[block-id-2]
Texto del bloque 2...
```

El modelo responde con `blockId` por corrección. El backend reenvía cada `blockId` tal cual lo recibió.

**Backend — `max_tokens` dinámico**

```ts
const getCorrectionsMaxTokens = (blockCount: number) =>
  blockCount === 1 ? BLOCK_CORRECTIONS_MAX_TOKENS : BLOCK_CORRECTIONS_MAX_TOKENS * blockCount;
```

**Frontend — agrupación de dirty blocks**

En `processCorrectionQueue()`, en lugar de consumir de a 1 bloque:
1. Extraer hasta `BATCH_SIZE` bloques de la cola, ordenados por posición en el documento (top → bottom) para que el toast de progreso siga una lectura natural.
2. Enviar un solo request con `correctionBlocks: [...]`.
3. Distribuir las sugerencias de la respuesta a cada bloque por `block_id`.

**Manejo de fallo parcial**

Tras recibir la respuesta, comparar los `blockId` enviados vs. los devueltos:

```ts
const sentIds = new Set(batch.map(b => b.id));
const receivedIds = new Set(response.suggestions.map(s => s.block_id));
const missingIds = [...sentIds].filter(id => !receivedIds.has(id));

if (missingIds.length > 0) {
  // Reencolar solo los faltantes para un nuevo intento
  enqueueForRetry(missingIds, { reason: "partial-batch-miss" });
}
```

Los bloques con respuesta válida se persisten normalmente. Los faltantes se reintentan en el siguiente batch (no se reintenta todo el batch).

### Archivos a modificar
- `lib/ai/corrections-config.ts` — nuevo, exporta `BATCH_SIZE`
- `app/api/ai/publication-review/route.ts` — schema, `resolveCorrectionSource`, prompt builder
- `lib/ai/corrections.ts` — `buildMechanicalCorrectionsPrompt` acepta múltiples bloques
- `components/editor/editor-shell.tsx` — `processCorrectionQueue` consume batches, detecta y reencola faltantes

### Criterio de aceptación
- [ ] Pegar un texto de 15 párrafos genera a lo sumo 3 llamadas API (batch de 5).
- [ ] Cada bloque recibe las sugerencias que le corresponden por `blockId`.
- [ ] Si el modelo omite un `blockId`, ese bloque vuelve a la cola y se reintenta sin afectar los otros.
- [ ] El toast de progreso muestra "X de Y bloques" correctamente, contando bloques individuales, no batches.

---

## Mejora 3: Eliminar umbral de 8 palabras

Estado: completado en ODE-327. Mantener esta sección como contexto histórico del cambio; no reintroducir filtros por longitud en scheduling, hydration ni persistencia de correcciones.

### Objetivo
Todo bloque con texto válido es candidato a corrección, sin importar su longitud.

### Cambios

**Frontend — `editor-shell.tsx`**

```ts
// Antes
if (block.wordCount < 8) { continue; }

// Después
if (block.wordCount === 0 || block.text.trim().length === 0) { continue; }
```

**Ajuste de debounce para paste masivo**

Si se detecta un paste de >10 bloques nuevos, usar debounce extendido de 5s (en lugar de 2s) antes del primer batch. Esto evita que la corrección se dispare mientras el usuario aún está organizando el texto pegado.

**Sin techo duro en la cola**

No se aplica un máximo absoluto de bloques. El batching colectivo (Mejora 2) absorbe el caso de paste masivo: 30 bloques pendientes se resuelven en 6 requests de 5, no en 30 individuales. Ver *Decisiones de diseño* para el racional.

### Archivos a modificar
- `components/editor/editor-shell.tsx` — lógica de dirty blocks y debounce

### Criterio de aceptación
- [ ] Un párrafo de 3 palabras con un typo se corrige.
- [ ] Un texto de 20 palabras en 3 párrafos cortos genera correcciones.
- [ ] Al pegar texto masivo, la primera corrección espera 5s, no 2s.
- [ ] Pegar 30 párrafos genera 6 batches de 5, no 30 requests individuales.

---

## Mejora 4: Smart invalidation

### Objetivo
Las sugerencias no desaparecen inmediatamente al editar. Solo se invalidan si el texto editado ya no contiene `originalText` como rango limpio seleccionable con límites de token.

Enforced by: `tests/corrections-matching.test.ts`.

### Cambios

**Frontend — `editor-shell.tsx`**

Al marcar un bloque como dirty:

```ts
// Antes: borrar todas las sugerencias del bloque
setAutomaticCorrectionSuggestions(current =>
  current.filter(s => s.block_id !== block.id)
);

// Después: mantener las cuyo originalText sigue presente con límites de token
setAutomaticCorrectionSuggestions(current =>
  current.map(s => {
    if (s.block_id !== block.id) return s;
    const stillRelevant = findTokenBoundaryMatch(
      block.text,
      s.original_text,
      s.replacement_text,
    ) !== null;
    return stillRelevant ? s : null;
  }).filter(Boolean)
);
```

Las sugerencias mantenidas se marcan con `status: "pending-stale"` (nuevo estado) para indicar que serán reemplazadas cuando llegue la nueva respuesta.

**Comportamiento UX de `pending-stale`:**
- Se muestran con opacidad reducida (ej. `opacity: 0.5`) para indicar que están en revisión.
- **No son aceptables**: el botón de aplicar la corrección se deshabilita mientras `status === "pending-stale"`. Esto evita aplicar una sugerencia obsoleta sobre texto que ya cambió.
- Al llegar la nueva respuesta del modelo, las stale se reemplazan por las nuevas (o desaparecen si el modelo no genera sugerencia para ese bloque).

### Archivos a modificar
- `components/editor/editor-shell.tsx` — lógica de dirty blocks
- `lib/local-db/schema.ts` — agregar `"pending-stale"` a `PublicationSuggestionStatus` (no opcional: el panel lo necesita para deshabilitar acciones)
- `components/editor/panels/corrections-panel.tsx` — deshabilitar acciones cuando `status === "pending-stale"`
- `app/globals.css` — estilo para sugerencias stale

### Criterio de aceptación
- [ ] Al editar una palabra en un párrafo con 3 sugerencias, las 3 siguen visibles con opacidad reducida.
- [ ] Mientras están stale, el botón de aceptar/aplicar está deshabilitado.
- [ ] Si el edit borra exactamente el texto de una sugerencia, esa desaparece.
- [ ] Cuando llega la nueva respuesta del modelo, las sugerencias stale se reemplazan y vuelven a ser interactivas.

---

## Mejora 5: Métricas de tokens y latencia

### Objetivo
Cada corrección lleva métricas para optimizar costos y detectar degradación del proveedor.

### Cambios

**Backend — leer usage de la respuesta**

```ts
const payload = await response.json();
const usage = payload.usage; // { prompt_tokens, completion_tokens }
```

Incluir `usage` en el response al frontend (ya sea en modo JSON directo o como evento `meta` en NDJSON).

**Frontend — almacenar métricas**

```ts
type CachedCorrectionBlock = {
  // ... campos existentes
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
};
```

Medir `latencyMs = Date.now() - t0` en el frontend (desde fetch hasta respuesta completa parseada).

**IndexedDB** — los campos de métricas se agregan a la tabla `correctionBlocks` de la Mejora 1.

### Archivos a modificar
- `app/api/ai/publication-review/route.ts` — extraer y propagar `usage`
- `components/editor/editor-shell.tsx` — medir y almacenar latencia + tokens
- `lib/local-db/schema.ts` + `index.ts` — agregar campos de métricas

### Criterio de aceptación
- [ ] Cada bloque persistido tiene `latencyMs`, `promptTokens`, `completionTokens`.
- [ ] Al inspeccionar IndexedDB, se pueden ver métricas acumuladas por writing.
- [ ] Si el proveedor no devuelve `usage`, los campos son `undefined` (no falla).

---

## Mejora 6: Limpiar código legacy del modo `document`

### Objetivo
Eliminar código muerto que confunde la lectura y los tests.

### Cambios

**Backend — `app/api/ai/publication-review/route.ts`**

- Eliminar `resolveCorrectionSource()` y reemplazar por lógica directa de modo `block`.
- Eliminar `buildCorrectionBlocks()` de `lib/ai/corrections.ts` si ya no se usa en otro lado.
- Simplificar `requestSchema`: `correctionBlock` (o `correctionBlocks` tras Mejora 2) es obligatorio.
- Eliminar la rama `document` de `getCorrectionsMaxTokens`.

**Frontend**

- Eliminar `components/editor/panels/publication-panel.tsx` (eliminación directa: no hay usuarios en producción, no requiere fase de deprecación).
- Eliminar la store `publicationReviews` de IndexedDB con bump de `db.version` y limpieza en `onupgradeneeded`.
- Eliminar tests asociados (`tests/local-db.test.ts`, `tests/sync-worker.test.ts` — secciones de `publicationReviews`).

**Supabase**

No requiere migración: la store `publicationReviews` solo existía en IndexedDB, no hay tabla `publication_reviews` en Supabase. Confirmado al inspeccionar `supabase/migrations/`.

### Archivos a modificar
- `app/api/ai/publication-review/route.ts`
- `lib/ai/corrections.ts`
- `components/editor/panels/publication-panel.tsx` — eliminar
- `lib/local-db/schema.ts` + `index.ts` — eliminar store `publicationReviews`
- `tests/local-db.test.ts`, `tests/sync-worker.test.ts` — eliminar casos de `publicationReviews`

### Criterio de aceptación
- [ ] No queda rama `document` en el endpoint.
- [ ] No queda `PublicationPanel` en el árbol de componentes.
- [ ] La store `publicationReviews` no aparece al inspeccionar IndexedDB en DevTools.
- [ ] `npm run typecheck` pasa sin errores.
- [ ] `npm test` pasa sin tests de `publicationReviews`.
- [ ] Tests del endpoint solo cubren modo `block`.

---

## Mejora 7: Panel de Ortografía sin filtro `kind`

### Objetivo
Mostrar todas las correcciones pendientes en el panel, no solo ortografía.

### Cambios

**Frontend — `corrections-panel.tsx`** (el archivo se llamaba `orthography-panel.tsx` al escribir este plan)

```tsx
// Antes
const pending = suggestions.filter(
  s => s.status === "pending" && s.kind === "spelling"
);

// Después
const pending = suggestions.filter(
  s => s.status === "pending"
);
```

Opcional: agrupar por tipo (`spelling`, `grammar`, `punctuation`) con secciones colapsables.

### Archivos a modificar
- `components/editor/panels/orthography-panel.tsx`

### Criterio de aceptación
- [ ] Una corrección de `grammar` o `punctuation` aparece en el panel lateral.
- [ ] El orden es por posición en el documento (de arriba hacia abajo).

---

## Orden de implementación recomendado

| Orden | Mejora | Bloqueada por | Impacto visual |
|-------|--------|---------------|----------------|
| 1 | **Observabilidad mínima** (0) | Ninguna | Nulo — base para validar el resto |
| 2 | **Limpiar legacy** (6) | Ninguna | Bajo — limpieza pura |
| 3 | **Persistencia Supabase + IDB** (1) | Observabilidad (para verificar hidratación) | Alto — no más reprocesamiento, cross-device |
| 4 | **Batching** (2) | Persistencia (para no perder métricas) | Alto — menos espera |
| 5 | **Eliminar umbral 8 palabras** (3) | Batching (para no explotar llamadas) | Medio — más correcciones |
| 6 | **Smart invalidation** (4) | Ninguna | Medio — menos parpadeo |
| 7 | **Métricas** (5) | Persistencia (para tener dónde guardar) | Bajo — invisible al usuario |
| 8 | **Panel sin filtro** (7) | Ninguna | Medio — más completo |

---

## Notas de implementación

### Transaccionalidad

Cada mejora debe ser atómica: un PR por mejora, con tests y validación de no-regresión. No mezclar persistencia + batching + UI en el mismo PR.

### Performance contract

Cada mejora que toque el flujo de correcciones debe declarar impacto en las cinco dimensiones de velocidad (ver `odessay-stack.md §Velocidad multidimensional`):
- **Latencia de interacción:** el plugin ProseMirror no debe cambiar; el debounce sí.
- **Tiempo a interactivo:** persistencia reduce tiempo a sugerencias visibles en recarga.
- **Peso transferido:** batching reduce número de requests pero aumenta tamaño de payload.
- **Forma del waterfall:** batching reduce de ~12 requests a ~3.
- **Fan-out reactivo:** persistencia añade lectura/escritura IndexedDB; debe ser async y no bloquear.

### QA obligatorio por mejora

- Texto corto (20 palabras, 3 párrafos) con typos.
- Texto largo (400+ palabras, 12+ párrafos) pegado de golpe.
- Recargar la página y verificar estado de sugerencias.
- Aceptar/rechazar sugerencias sin reanálisis automático.
- Verificar que el panel lateral refleja el estado correcto.
