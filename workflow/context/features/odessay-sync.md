# ODESSAY — Local-first sync

**Feature spec para agentes de desarrollo.**
Lee `workflow/context/core/odessay-arquitectura.md` §Arquitectura de datos y `workflow/context/core/odessay-stack.md` §Arquitectura local-first antes de implementar cualquier parte de esta capa.

---

## El principio que define todo

El usuario nunca espera a Supabase. Nunca. Ni al escribir, ni al guardar, ni al cargar. La base local es la fuente de verdad operativa. Supabase es la copia remota sincronizada.

Esto no es una optimización de performance — es una decisión de arquitectura que afecta todo el producto. Un producto epistolar que "guarda" con latencia no es un santuario: es una herramienta más. La escritura debe ser fluida, sin fricción de red.

---

## Arquitectura de la capa local-first

```
Usuario escribe
      ↓
  Base local (inmediato, sin latencia)
      ↓
  Sync queue (background worker)
      ↓
  Supabase (cuando hay red, confirma y respalda)
```

### En web (MVP)

**Base local:** IndexedDB, accedida a través de una interfaz `localDB` que abstrae el storage. Los componentes no saben con qué hablan — usan `localDB.writings.save()`, nunca `indexedDB.open()` directamente.

**Por qué IndexedDB y no localStorage:** capacidad ilimitada, soporte de objetos complejos (el body_json de TipTap puede ser grande), transacciones atómicas, soporte en todos los navegadores modernos.

### En desktop (Fase 7, Tauri)

**Base local:** SQLite nativo vía el runtime de Tauri. La interfaz `localDB` se reimplementa sobre SQLite — los componentes no cambian.

**Por qué SQLite en desktop:** acceso nativo más rápido que IndexedDB, SQL completo para queries complejas, soporte de full-text search si se necesita en el futuro.

---

## Interfaz `localDB`

La interfaz unifica el acceso al storage local independientemente del motor subyacente. Debe implementarse como módulo singleton.

```ts
interface LocalDB {
  writings: {
    save(writing: LocalWriting): Promise<void>      // upsert por id
    get(id: string): Promise<LocalWriting | null>
    getAll(): Promise<LocalWriting[]>
    delete(id: string): Promise<void>               // soft delete: sync_status = 'deleted'
  }
  syncQueue: {
    enqueue(mutation: SyncMutation): Promise<void>
    getPending(): Promise<SyncMutation[]>
    markSynced(id: string): Promise<void>
    markFailed(id: string, error: string): Promise<void>
  }
}
```

**`LocalWriting`** incluye todos los campos de la tabla `writings` más:
- `sync_status`: `'synced' | 'pending' | 'failed' | 'deleted'`
- `local_updated_at`: timestamp de la última modificación local (distinto de `updated_at` de Supabase)

**`SyncMutation`**:
```ts
interface SyncMutation {
  id: string               // UUID de la mutación
  writing_id: string
  operation: 'upsert' | 'delete'
  payload: Partial<Writing>
  created_at: number       // timestamp local
  attempts: number         // reintentos realizados
  last_error?: string
}
```

---

## Flujo de auto-save

### Paso 1 — Guardar local (inmediato)

El evento `onUpdate` de TipTap dispara en cada cambio. Sin debounce. Sin delay. La escritura en IndexedDB/SQLite es síncrona desde la perspectiva del usuario.

```ts
editor.on('update', ({ editor }) => {
  const writing = {
    id: writingId,
    body_json: editor.getJSON(),
    body_text: editor.getText(),
    updated_at: new Date().toISOString(),
    version: currentVersion + 1,
    sync_status: 'pending'
  }
  await localDB.writings.save(writing)    // inmediato
  syncQueue.enqueue(writing)              // encola para sync remoto
})
```

### Paso 2 — Sync remoto (background)

Un **sync worker** corre en background. Lee la cola de mutaciones pendientes y las envía a la API.

**Debounce:** 1.5 segundos desde la última mutación encolada. Esto evita bombardear la API con cada keystroke.

**Idempotencia:** el endpoint `PATCH /api/writings/{id}` es idempotente. El campo `version` se incrementa pero no bloquea escrituras — last-write-wins.

**Campos que se envían al servidor:** `body_json`, `body_text`, `updated_at`, `version`. Nunca el `id` (ya está en la URL), nunca `sync_status` (es campo local).

---

## Indicador visual en statusbar

El statusbar del editor muestra el estado del sync **remoto**, no del save local (que ya ocurrió):

| Estado | Texto | Color |
|--------|-------|-------|
| Sync remoto exitoso | "Saved" | `--ink-4` |
| Sync en curso | "Saving..." | `--ink-3` |
| Sync fallido (reintentando) | "Saving..." | `--ink-3` |
| Sin red (guardar local OK) | "Saved locally" | `--ink-4` |

El usuario nunca ve "Error saving" — los fallos del sync remoto son silenciosos y se reintentan. El writing nunca se pierde porque siempre está en la base local.

---

## Reintentos con backoff exponencial

Si el sync falla, el worker reintenta con backoff exponencial:

```
Intento 1: inmediato
Intento 2: 2 segundos
Intento 3: 4 segundos
Intento 4: 8 segundos
Intento 5: 16 segundos
Intento N: min(2^n segundos, 5 minutos)
```

**Máximo de reintentos activos:** 10. Después de 10 intentos fallidos, la mutación se marca `status: 'failed'` y se loguea el error con contexto. No se notifica al usuario.

**Al recuperar la red:** el worker retoma automáticamente. `navigator.onLine` y el evento `online` disparan una pasada del sync worker.

---

## Conflictos de sincronización

**Estrategia: last-write-wins silencioso.**

No se bloquean escrituras por conflicto de versión. La última escritura que llega al servidor gana, sin notificar al usuario.

**Por qué esta estrategia:**
- Los conflictos reales (mismo writing, dos dispositivos, edición simultánea) son estadísticamente infrecuentes en un producto epistolar — los writings se trabajan en sesiones largas en un dispositivo, no en tiempo real colaborativo.
- Interrumpir al usuario con un diálogo de resolución de conflictos sería más disruptivo que la pérdida ocasional de unos pocos caracteres.
- La copia local siempre existe — el usuario nunca pierde su versión del dispositivo activo.

**Uso del campo `version`:** se incrementa en cada PATCH como campo de auditoría. No se usa para rechazar escrituras en esta fase. Puede habilitarse en el futuro para historial de versiones.

**Lo que NO se implementa:** no hay UI de resolución de conflictos, no hay toast de aviso, no hay merge automático de versiones.

---

## Carga inicial — hydration

Al cargar el editor (`/write/{id}`):

1. **Primero: base local.** El writing se renderiza desde IndexedDB. Si existe localmente, el usuario ve su contenido en < 50ms.
2. **Segundo: Supabase (background).** Se consulta la versión remota. Si `remote.version > local.version`, se actualiza la base local y se re-renderiza el editor.

```ts
async function loadWriting(id: string) {
  // 1. Render local inmediato
  const local = await localDB.writings.get(id)
  if (local) renderEditor(local)

  // 2. Sync remoto en background
  const remote = await supabase.from('writings').select('*').eq('id', id).single()
  if (remote.version > (local?.version ?? 0)) {
    await localDB.writings.save({ ...remote, sync_status: 'synced' })
    if (!hasUnsyncedChanges()) renderEditor(remote)  // no pisar cambios locales no guardados
  }
}
```

---

## Observabilidad del sync

Todos los errores del sync worker se loguean con contexto estructurado:

```ts
console.error('[sync:remote]', {
  userId,
  writingId,
  operation: 'PATCH',
  attempt: mutation.attempts,
  error: error.message
})
```

Sentry captura estos errores automáticamente. Ver `.agents/skills/skill-backend/SKILL.md` para instrumentación.

---

## Principio de navegación interna

El principio local-first — *la base local es la fuente de verdad operativa* — aplica también a la **navegación interna dentro de una vista funcional**.

Cuando el usuario interactúa con elementos de una misma vista (pestañas, filtros, paneles, selección de items en una lista), eso es un **cambio de estado interno**, no una navegación de página. Si los datos ya están en `localDB`, no debe haber roundtrip al servidor.

**Regla:**

- **NO** usar `router.push()` para cambios de estado dentro de una vista. Eso dispara un RSC fetch completo, un re-render del shell, y una re-hidratación desde cero.
- **SÍ** usar estado local + lectura directa de `localDB`. La URL se actualiza solo como espejo (`history.replaceState` o `router.replace` sin navegación).

**Ejemplos:**

| Contexto | Estado interno (correcto) | Navegación de página (incorrecto) |
|----------|--------------------------|-----------------------------------|
| Pestañas del editor | `setActiveWritingId(id)` + `localDB.get(id)` | `router.push(/write/${id})` |
| Filtros del desk | `setActiveFilter(filter)` + estado local | `router.replace(/desk?tab=...)` |
| Panel de colecciones | `setSelectedCollection(id)` + estado local | `router.push(/collections/${id})` |

**Costo medido:** El patrón incorrecto cuesta 750-1350ms. El patrón correcto cuesta < 200ms.

---

## Caso de estudio: cambio de pestañas en el editor

> Evidencia: `artifacts/perf/Trace-20260424T084909.json` (48,944 eventos)

Este caso ilustra por qué el principio de navegación interna es crítico. El usuario reportó lentitud (1-2 segundos) al cambiar de pestaña en el editor, incluso en páginas ya visitadas.

### Evolución del diagnóstico

**Fase 1 — Hipótesis dispersas (sin evidencia):**
Se sospecharon múltiples causas simultáneas: re-fetch agresivo en Desk, store global sin selectores atómicos, hidratación TipTap pesada, fetch sin caché en Collections. Este enfoque fue incorrecto: sin evidencia objetiva, no se puede priorizar.

**Fase 2 — Análisis del trace:**
El trace reveló que el problema no era ni la red ni el scripting pesado, sino el **uso de `router.push()` para cambiar de pestaña**.

| Métrica | Click 1 | Click 2 |
|---------|---------|---------|
| Network RSC fetch | 458ms | 302ms |
| Gap post-respuesta (React procesando) | **1,160ms** | **574ms** |
| Scripting (TipTap + localDB) | ~150ms | ~150ms |
| **Total percibido** | **~1,350ms** | **~750ms** |

Hallazgos clave:
- Next.js App Router dispara requests `?_rsc=` en cada cambio de tab
- El gap de 600-1,100ms ocurre **después** de que el servidor responde — es procesamiento del cliente
- El scripting de TipTap (`editor.commands.setContent()`) y localDB (`localDB.writings.get()`) suman solo ~150ms

**Fase 3 — Causa raíz confirmada:**
En `components/editor/editor-shell.tsx`, el handler de selección de pestaña ejecuta `router.push(/write/${id})`. Esto dispara:
1. RSC fetch al servidor
2. Re-render completo del shell con nuevo `routeWritingId`
3. Re-hidratación desde localDB (a pesar de que los datos ya estaban allí)
4. Re-inyección en TipTap

Todo para mostrar un texto que **ya estaba en el navegador**.

**Fase 4 — Corrección del razonamiento:**
Se propusieron inicialmente "atajos" (prefetch, cachear RSC, no usar router). El usuario correctamente identificó estos como parches sintomáticos. La solución real es cambiar la arquitectura: estado local primero, URL como espejo.

### Lecciones

1. **No diagnosticar sin evidencia.** Si existe un trace, analizarlo antes de hipotetizar.
2. **No proponer atajos para problemas arquitectónicos.** Prefetch y cache son parches cuando la causa es una mala decisión de implementación.
3. **No externalizar responsabilidad al framework.** Next.js no es un actor externo — es una herramienta que el equipo usa. `router.push()` es una API que se eligió usar de forma incorrecta.
4. **Entender la arquitectura antes de proponer cambios.** Validar local-first, IndexedDB, y sync antes de sugerir fixes de performance.

### Regresión a evitar

- [ ] No usar `router.push()` para cambios de estado interno dentro de una vista funcional
- [ ] No confundir "URL debe reflejar el estado" con "URL debe controlar el estado"
- [ ] No implementar tabs, filtros, o paneles como rutas navegables si son estado de UI
- [ ] No permitir que Next.js RSC fetch bloquee la carga de datos que ya están en `localDB`

---

## Lo que este doc NO cubre

- Implementación del endpoint `PATCH /api/writings/{id}` → `.agents/skills/skill-backend/SKILL.md`
- Schema de la tabla `writings` (campos `version`, `sync_status`, `deleted_at`) → `workflow/context/core/odessay-modelo-datos.md`
- Implementación de SQLite en desktop (Tauri) → `workflow/context/core/odessay-stack.md` §Desktop
