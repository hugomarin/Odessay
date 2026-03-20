# ODESSAY — Local-first sync

**Feature spec para agentes de desarrollo.**
Lee `docs/core/odessay-arquitectura.md` §Arquitectura de datos y `docs/core/odessay-stack.md` §Arquitectura local-first antes de implementar cualquier parte de esta capa.

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

Sentry captura estos errores automáticamente. Ver `workflow/SETUP.md` §Observabilidad.

---

## Lo que este doc NO cubre

- Implementación del endpoint `PATCH /api/writings/{id}` → `.agents/skills/skill-backend/SKILL.md`
- Schema de la tabla `writings` (campos `version`, `sync_status`, `deleted_at`) → `docs/core/odessay-modelo-datos.md`
- Implementación de SQLite en desktop (Tauri) → `docs/core/odessay-stack.md` §Desktop
