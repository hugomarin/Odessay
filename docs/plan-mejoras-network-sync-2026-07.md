# Plan de mejoras — Network, Sync y Sistema de Agentes

**Fecha:** 2026-07-03 (endurecido 2026-07-04 para consumo por `/wf-define`)
**Origen:** Auditoría del waterfall de red en Desktop (Tauri) al abrir la app y cargar writings en Studio. Evidencia: capturas de DevTools Network del 2026-07-03.
**Alcance:** Web y Desktop.
**Hechos verificados contra:** commit `863fef8` (2026-07-04). Los números de línea citados son de ese commit; si BUILD encuentra el archivo movido, buscar por símbolo, no por línea.

> **Cómo usar este documento en `/wf-define`:** cada trabajo de la Parte 3 está escrito como pre-brief con los campos que `skill-product-manager` exige (Files affected, Failure modes, Consumers, trampas, evidencia). `/wf-define` NO debe copiarlos ciegamente: debe correr su propia Verificación de definición (docs↔code↔linear) porque el código puede haber cambiado desde `863fef8`. La sección "Contradicciones y trampas conocidas" es lectura obligatoria antes de crear cualquier issue de este plan.
>
> Al convertir un trabajo en issue: el **Resultado esperado** del trabajo va al `Context` del issue (es lo que el dueño usará para aceptar el outcome); los **gates** van a `Requirements`/`Definition of Done` como criterios bloqueantes; las **proyecciones** se citan como expectativa informada, nunca como criterio de done. La tabla "Línea base medida y objetivos globales" da los números de referencia para el demo de outcome antes/después.

---

## Parte 0 — Contradicciones y trampas conocidas (leer antes que nada)

El codebase es grande y tiene contradicciones documentadas. Un agente que no las conozca va a "corregir" cosas que están así a propósito y romper producción. Estas cinco son las que chocan directamente con este plan:

**T-A · Los writes de sync desktop NO pueden usar upsert ni `return=representation`.**
En `writings`, PostgREST upsert (`on_conflict`) y `RETURNING` disparan un falso 42501 de RLS aunque la fila cumpla la policy (el `WITH CHECK` se auto-referencia y Postgres lo evalúa distinto bajo `ON CONFLICT`/`RETURNING`). Solo funcionan INSERT/UPDATE planos con `return=minimal`. Está documentado en el comentario de `lib/sync/desktop-sync-service.ts:301-311`. **Ningún trabajo de este plan debe "simplificar" ese código a un upsert**, y el trabajo de RLS (M4) debe re-verificar que el falso 42501 sigue igual después de tocar policies.

**T-B · Hay DOS clientes Supabase browser y NO se pueden unificar.**
Web usa `createBrowserClient` de `@supabase/ssr` (`lib/supabase/client.ts` — storage por cookies). Desktop usa `createClient` de `@supabase/supabase-js` (`lib/supabase/desktop-client.ts` — storage Keychain) porque `@supabase/ssr` pisa cualquier storage custom. Un agente que vea "código duplicado" y los unifique rompe la auth de uno de los dos runtimes.

**T-C · Desktop NO puede llamar rutas `/api/*` ni hacer embed de `profiles`.**
El runtime desktop es static export: no hay servidor Next. Web hidrata vía `/api/writings`; desktop vía Supabase directo. Esa asimetría es intencional. Sharing en desktop usa RPC security-definer, no `/api/*`.

**T-D · `can_read_writing()` tiene más consumidores que la policy de SELECT.**
La usan también: policies de INSERT/UPDATE de `writings` (validación de `parent_id`, `20260603175221_fix_writings_correspondence_rls_subquery.sql`), la policy de `writing_collections` (`20260422005000_harden_collections_indexes.sql:27`) y potencialmente RPCs. **M4 reescribe UNA policy; la función no se toca ni se borra.**

**T-E · El single-flight ya existe en web — el patrón a replicar está en el repo.**
`lib/sync/remote-bootstrap.ts:220-249` (`inFlightWritingsHydration`) ya implementa guard de vuelo único para la hidratación web. El servicio desktop (`lib/sync/desktop-sync-service.ts`) no lo tiene. M1 replica ese patrón existente; no inventa un coordinador nuevo.

Trampas generales que aplican a todo el plan: el `.md` es el documento canónico y `body_json` es copia de trabajo (ADR `workflow/context/core/odessay-adr-identidad.md`, D1); `process.env.TAURI_BUILD` no llega al cliente (usar `isTauriRuntime()`); `tauri dev` ≠ `tauri build` — todo cambio desktop se valida también en build.

---

## Parte 1 — Diagnóstico: qué está pasando en la red

### Hallazgo 1 · La hidratación completa de writings corre 3 veces en paralelo (crítico)

Tres requests idénticos a `writings` de 1.8 MB compiten entre sí al arrancar (11.2s / 11.08s / 11.05s). El mismo request corriendo solo tarda 1–2s. Los tres orígenes:

| Origen | Archivo | Detalle |
|---|---|---|
| Mount del bootstrap | `components/sync/sync-bootstrap.tsx:19` | `hydrateFromRemote()` al montar |
| Listener de auth | `components/sync/sync-bootstrap.tsx:82-97` | `onAuthStateChange` re-hidrata en `INITIAL_SESSION`/`SIGNED_IN` aunque el userId no cambió |
| Página Desk | `app/(app)/desk/page.tsx:183` | hidratación propia (y `components/collections/collections-view.tsx:176` también) |

`hydrateWritings` desktop (`lib/sync/desktop-sync-service.ts:504`) no tiene guard de vuelo único. En web el guard existe (`remote-bootstrap.ts:220`) y absorbe los llamadores **concurrentes**, pero no la re-hidratación del listener de auth que llega segundos después. Mismo patrón duplicado en `collections` ×2, `writing_collections` ×3, `writing_shares` ×2.

### Hallazgo 2 · Cada hidratación baja el cuerpo completo de todos los documentos

`WRITING_SELECT` (`lib/sync/desktop-sync-service.ts:55`) incluye `body_json` y `body_text` de todos los writings, sin filtro incremental ni comparación previa por `content_hash`. Resultado: ~5.4 MB por arranque (1.8 MB × 3) para aplicar, en la mayoría de arranques, casi nada (`shouldApplyRemoteWriting` descarta localmente lo que ya está). En web, `/api/writings` tiene el mismo problema de forma (payload completo en cada hidratación).

La columna `content_hash` ya existe (migración 2026-06-17); la infraestructura para sync delta está lista y no se usa.

### Hallazgo 3 · Un IPC `keychain_read_token` por cada request a Supabase (solo Desktop)

El cliente desktop (`lib/supabase/desktop-client.ts:23`) usa `keychainStorage` como storage de supabase-js, y supabase-js llama `storage.getItem()` en cada `getSession()` interno → un round-trip IPC a Rust de 2.6 KB antes de **cada** request REST. La mayoría <5ms, algunos 20–90ms, todos compiten en la cola IPC.

### Hallazgo 4 · ~33 `plugin:event|listen` + 33 `unlisten` por cada mount del editor

`useTauriMenuEvents` (`hooks/useTauriMenuEvents.ts:111`) registra un listener IPC por cada una de las 29 acciones de menú más open/new/save/save-as (~33 `listen` de ~100ms al montar, ~33 `unlisten` al desmontar). Cada navegación Desk ↔ Studio ↔ Write repite el ciclo. `useTauriEditorMenuEvents` y `useGlobalOpenFileMenu` agregan más.

### Hallazgo 5 · La RLS de `writings` evalúa una función por fila (amplificador)

`writings_select_accessible` usa `can_read_writing(id, auth.uid())` (`supabase/migrations/20260317145743_initial_schema.sql:567` y `:482`): función security-definer ejecutada **por cada fila**, con self-join a `writings` + `exists` a `writing_shares`. Para el caso dominante (leer tus propios documentos) es carísimo comparado con un predicado inline sobre el índice de `author_id`.

### No-problemas (para no perseguir fantasmas)

- El JSON de sesión visible en DevTools en `keychain_read_token` es tráfico IPC local, no sale a la red. Esperado mientras DevTools esté habilitado en release (decisión vigente de distribución ad-hoc).
- `list_incoming_shared_writings` (~334ms) y `auth/user` (~100–200ms) están en rango normal.
- El single-flight web (T-E) no es un bug pendiente de "unificar": es el patrón de referencia.

---

## Parte 2 — Mejoras de arquitectura y patrones de diseño

*(Resumen conceptual; la especificación ejecutable por trabajo está en la Parte 3.)*

1. **Single-flight + dueño único de hidratación** (request coalescing). Las vistas leen IndexedDB y se suscriben; solo el bootstrap orquesta hidratación remota.
2. **Hidratación incremental en dos fases** (manifest + fetch selectivo por `content_hash`). Convierte 5.4 MB de arranque en decenas de KB.
3. **Cache write-through sobre `keychainStorage`** (decorator del storage adapter). Elimina ~90% del IPC keychain sin violar el contrato ODE-219.
4. **RLS con predicado inline + initplan** (patrón estándar Supabase). El caso dueño resuelve por índice sin invocar función por fila; la rama shared usa un helper security-definer mínimo para evitar la recursión de RLS (trampa documentada en §M4).
5. **Registro global de eventos de menú** (singleton + registry, o un solo canal `menu:action`).
6. **Presupuesto de red por vista como instrumento verificable**, no como prosa (ya declarado en `skill-backend`; falta el gate).

---

## Parte 3 — Trabajos, en formato pre-brief para `/wf-define`

Prioridad de ejecución: M1 → M2 → M3 → M4 → M5. M6 es trabajo de workflow (Parte 4). M1 y M2 pueden ir en un solo issue si BUILD es disciplinado; en duda, separados.

### Línea base medida y objetivos globales

Línea base medida el 2026-07-03 (DevTools Network, desktop, sesión activa, segunda apertura):

| Métrica | Hoy (medido) | Objetivo tras M1–M5 | Trabajo responsable |
|---|---|---|---|
| Requests totales de arranque | ~355 | sin objetivo duro (baja como consecuencia) | M1, M2, M5 |
| Bytes transferidos en arranque | 6.88 MB | < 1 MB | M1, M3 |
| Fetches de `writings` en arranque | 3 × 1.8 MB | 1 × < 50 KB (manifest) | M1, M3 |
| Tiempo a writings hidratados | 11–15 s | 1–2 s frío, sub-segundo tibio | M1, M3, M4 |
| `keychain_read_token` por flujo Desk→Studio→Write | decenas | ≤ 2 | M2 |
| `plugin:event\|listen`+`unlisten` por navegación | ~33 + ~33 | 0 después del arranque | M5 |
| Query `writings` en servidor (solo) | ~1.9 s | proyección: 100–300 ms (no es gate; el gate es el `explain analyze`) | M4 |

**Regla de interpretación para BUILD/REVIEW:** las cifras marcadas como *gate* en la Evidencia de cada trabajo son bloqueantes; las marcadas como *proyección* son la expectativa informada y NO bloquean el merge — si la medición real queda lejos de la proyección, se reporta el número real en el PR y el dueño decide en la aceptación de outcome. Qué NO va a cambiar (y no debe reportarse como regresión): la latencia de tecleo del editor (fuera de scope, tiene sus propios budgets), y el peso del primer arranque en máquina limpia (baja todo el archivo por diseño; M3 solo acelera los arranques siguientes).

---

### M1 · Deduplicar la hidratación de arranque (single-flight + dueño único)

**Objetivo:** un arranque produce exactamente **una** hidratación de writings y una de collections, en web y desktop, sin importar cuántas vistas monten.

**Resultado esperado (aceptación del dueño):** el arranque transfiere ~3.6 MB menos y los writings quedan hidratados en ~1–2 s en vez de 11–15 s — los 11 s actuales no son latencia del servidor sino tres descargas idénticas compitiendo entre sí; al quedar una sola, cae a su tiempo real ya observado (~1–2 s en las capturas). *Gate:* 1 request por recurso. *Proyección:* el tiempo resultante.

**Files affected:**
- lib/sync/desktop-sync-service.ts (modifica — guard de vuelo único en `hydrateWritings` y `hydrateCollections`, replicando el patrón de `remote-bootstrap.ts:220-249`, más ventana de frescura por userId)
- components/sync/sync-bootstrap.tsx (modifica — el listener de auth solo re-hidrata si `userId` cambió respecto al último hidratado; guardar el último userId hidratado en un ref)
- app/(app)/desk/page.tsx (modifica — `hydrateRemoteIfNeeded`/`syncRemoteWritings` dejan de disparar un fetch remoto adicional: pasan por el camino deduplicado del servicio)
- components/collections/collections-view.tsx (modifica — ídem con su `Promise.all` de hydrate)

**Nota de mecanismo:** el single-flight solo dedupea llamadores **concurrentes**. Desk monta después de que el bootstrap terminó, así que sin más, dispararía un segundo fetch secuencial. El guard se complementa con una **ventana de frescura** (`lastHydratedAt` por userId; llamadas dentro de la ventana devuelven el resultado local sin request — BUILD decide el valor, sugerido 30–60 s, y lo documenta). `refreshIfStale` no existe en el código: es este mecanismo, hay que crearlo.
- tests/ (nuevo — test del guard: N llamadores concurrentes ⇒ 1 request)
- workflow/status.json (modifica)

**Contratos y trampas:** T-B (no unificar clientes), T-C (desktop no usa `/api/*`), T-E (el patrón ya existe — replicarlo, no inventar). El single-flight debe **invalidarse al cambiar de usuario**: si el guard cachea la promesa y llega un `SIGNED_IN` de otro userId, devolver la promesa vieja filtraría writings del usuario anterior al scope nuevo. La clave del guard incluye el userId (o se limpia en `setLocalDBScope`).

**Failure modes:**
1. *Fallo de red:* la promesa compartida rechaza para todos los llamadores; el guard se limpia en `finally` (como hace `remote-bootstrap.ts:244`) para que el siguiente intento sí dispare request.
2. *Respuesta inválida:* sin cambios respecto a hoy (se degrada por item en el loop de merge).
3. *Carrera:* sign-out durante hidratación en vuelo — el merge escribe sobre scope viejo; verificar que `setLocalDBScope(undefined)` en `SIGNED_OUT` no deja el guard apuntando a una promesa que escribirá en el scope equivocado. Definir: el resultado de una hidratación cuyo userId ya no es el activo se descarta.
4. *Estado intermedio:* el progreso de primera hidratación (`beginHydrationProgress`) no debe dispararse dos veces; con el guard, no puede.

**Consumers:** Desk, Collections, Studio y Workspace leen `localDB.writings` — no cambian. Cualquier vista futura que llamara `hydrateWritings()` directamente recibirá la promesa compartida (comportamiento compatible).

**Evidencia requerida en PR:** captura de Network del arranque desktop y web mostrando **1** request a `writings` y **1** a `collections`/`writing_collections` (hoy: 3/2/3). Test del guard verde.

**DoD:** al abrir la app con sesión activa, el panel Network muestra exactamente una hidratación de cada recurso; navegar a Desk/Collections/Studio no dispara hidrataciones adicionales dentro de la ventana de frescura; los writings del usuario se ven igual que antes.

**Reference docs:** `.agents/skills/skill-architecture/SKILL.md`, `workflow/context/features/odessay-sync.md`, `lib/sync/remote-bootstrap.ts` (patrón), este documento §Parte 0.

---

### M2 · Cache write-through en memoria para `keychainStorage`

**Objetivo:** los requests REST del cliente desktop dejan de pagar un IPC `keychain_read_token` cada uno.

**Resultado esperado (aceptación del dueño):** el panel Network deja de estar inundado de `keychain_read_token` (hoy decenas por flujo; queda el del arranque y el de refresh de token). La ganancia principal no es velocidad cronometrable sino descongestionar la cola IPC de Tauri (saves, watchers y menús dejan de competir con reads redundantes) y un Network legible para depurar. *Gate:* ≤ 2 keychain reads por flujo Desk→Studio→Write. *Proyección:* el efecto en la cola IPC.

**Files affected:**
- lib/auth/secure-storage.ts (modifica — cache en memoria: `getItem` sirve del cache tras el primer read; `setItem`/`removeItem` actualizan cache y store nativo)
- tests/ (nuevo — get tras set devuelve el valor sin tocar el mock nativo; remove invalida)
- workflow/status.json (modifica)

**Contratos y trampas:** contrato ODE-219 (comentario en `secure-storage.ts:26-38`): el token nunca se escribe en localStorage ni disco plano, nunca se loggea — el cache es solo memoria de proceso, y el cliente Supabase ya mantiene el session en memoria de todos modos. `lib/services/desktop-auth-service.ts:229-230` llama `keychainStorage.removeItem` directamente en sign-out — al pasar por el mismo objeto, el cache se invalida solo; verificar que no exista ningún otro camino que escriba el store nativo sin pasar por `keychainStorage` (si existe, el cache necesita invalidación explícita ahí).

**Failure modes:**
1. *Fallo del store nativo en `setItem`:* si el write nativo falla, el cache NO debe quedar con el valor nuevo (sería una sesión que "existe" hasta el próximo restart). Actualizar cache solo tras éxito del write.
2. *Respuesta inválida:* n/a (valores opacos).
3. *Carrera:* `getItem` concurrente con `setItem` — resolver con el valor del cache al momento de leer; no requiere lock (un solo hilo JS).
4. *Estado intermedio:* primer `getItem` (cache frío) mantiene el timeout de 3s existente.

**Consumers:** el cliente Supabase desktop (único consumidor vía `desktop-client.ts`) y `desktop-auth-service.ts`. Ningún contrato externo cambia.

**Evidencia requerida en PR:** captura de Network desktop de un flujo Desk → Studio → Write mostrando ≤ 2 `keychain_read_token` en total (hoy: decenas). Confirmar que sign-out + sign-in de otro usuario funciona (cache no sirve token viejo).

**DoD:** el flujo de auth completo (sign-in, uso, sign-out, sign-in de nuevo) funciona en `tauri dev` **y en build** (T general: dev ≠ build); el panel Network muestra keychain reads solo en el arranque y tras refresh de token.

**Reference docs:** `.agents/skills/skill-backend/SKILL.md`, `lib/auth/secure-storage.ts` (contrato ODE-219 en el header), este documento §Parte 0.

---

### M3 · Hidratación incremental en dos fases (manifest + fetch selectivo)

**Objetivo:** el arranque típico transfiere KBs, no MBs: primero un manifest (`id, updated_at, content_hash, deleted_at, version`), luego cuerpos solo de los ids que difieren del local.

**Resultado esperado (aceptación del dueño):** el segundo arranque en la misma máquina baja decenas de KB en vez de 1.8 MB. Más importante que el número de hoy es la curva: el costo de arranque deja de crecer con el archivo completo de escritura (hoy cada documento escrito encarece todos los arranques futuros) y pasa a ser proporcional a lo que cambió — normalmente cero o un documento. Reduce además el egress facturable de Supabase y mejora el comportamiento en redes lentas. El primer arranque en máquina limpia NO cambia (baja todo por diseño). *Gate:* < 50 KB de `writings` en segundo arranque. *Proyección:* la curva de escalabilidad y el ahorro de egress.

**Files affected:**
- lib/sync/desktop-sync-service.ts (modifica — `hydrateWritings` en dos fases; `WRITING_SELECT` se parte en `MANIFEST_SELECT` + fetch por `.in("id", changedIds)` con select completo)
- app/api/writings/route.ts (modifica — soportar modo manifest para el runtime web, p. ej. `?fields=manifest` + `?ids=`) — verificar path exacto de la ruta en BUILD
- lib/sync/remote-bootstrap.ts (modifica — consumir el modo manifest en web)
- tests/ (nuevo — caso: nada cambió ⇒ 0 fetches de cuerpo; caso: 2 de N cambiaron ⇒ fetch de exactamente esos 2; caso: writing borrado remotamente aparece en manifest con `deleted_at`)
- workflow/status.json (modifica)

**Contratos y trampas:** T-A (**no** convertir ningún write en upsert al pasar por ahí), T-C (la fase manifest desktop va por Supabase directo; la web por `/api/writings`). ADR identidad D1/D11: `content_hash` se calcula sobre el markdown canónico — la comparación local usa el hash ya persistido, no re-serializa. **Watermark:** no filtrar por reloj del cliente; si se usa `updated_at > watermark`, el watermark es el `max(updated_at)` de la respuesta anterior del **servidor** (hoy `lastSyncedAt` en `desktop-sync-service.ts:429` usa `new Date()` del cliente — no reutilizarlo para esto). El manifest completo (sin filtro de watermark) es la opción robusta: detecta deletes y evita clock skew; el watermark es optimización opcional posterior.
La lógica de rebind por hash de web (`remote-bootstrap.ts:204`, `findUniqueHashRebindCandidate`) necesita el manifest con `content_hash` — verificar que sigue funcionando cuando el cuerpo llega en fase 2.

**Failure modes:**
1. *Fallo de red entre fase 1 y fase 2:* el local queda con metadata nueva sin cuerpo — NO aplicar el registro del manifest a localDB hasta tener el cuerpo; el manifest solo decide qué pedir.
2. *Respuesta inválida:* un id pedido que no vuelve en fase 2 (borrado entre fases, RLS) se omite y se loggea; no colapsa el batch.
3. *Carrera:* usuario edita el writing X localmente mientras fase 2 baja X — `shouldApplyRemoteWriting` ya arbitra (pending/failed local gana); el test debe cubrirlo.
4. *Estado intermedio:* la barra de progreso de primera hidratación (`beginHydrationProgress`) pasa a contar sobre los ids que sí se van a bajar.

**Consumers:** `hydrateWriting` (singular) no cambia. El route `/api/writings` gana un modo nuevo sin romper el actual (aditivo). `findUniqueHashRebindCandidate` (workspace rebind) — asunción afectada, verificar explícitamente.

**Evidencia requerida en PR:** Network del segundo arranque (datos ya locales): bytes transferidos de `writings` < 50 KB (hoy 1.8 MB). Tests de los tres casos verdes. `Performance Contract — Payload weight: required`.

**DoD:** primer arranque en máquina limpia baja todo y funciona igual que hoy; segundo arranque baja solo manifest; editar en otra máquina y arrancar baja exactamente ese documento; borrar en otra máquina y arrancar refleja el borrado.

**Reference docs:** `workflow/context/core/odessay-adr-identidad.md` (D1/D5/D11), `workflow/context/features/odessay-sync.md`, `.agents/skills/skill-architecture/SKILL.md`, `.agents/skills/skill-backend/SKILL.md`, este documento §Parte 0 (T-A obligatorio).

---

### M4 · RLS de `writings` con predicado inline (sin función por fila)

**Objetivo:** el SELECT dominante (dueño lee sus writings) resuelve por índice de `author_id` sin invocar `can_read_writing()` N veces.

**Resultado esperado (aceptación del dueño):** el query de hidratación baja de ~1.9 s a la escala de cientos de ms, y todas las lecturas que pasan por la misma policy (shared reading, colecciones) se benefician. **La proyección de 100–300 ms NO es gate** — depende del plan que elija Postgres; si la medición real da otra cosa, se reporta el número y el dueño decide. *Gate:* el `explain analyze` muestra index scan por `author_id` sin llamada a función en el caso dominante, y la matriz de paridad de accesos da idéntico resultado que la policy vieja. Es el trabajo con mejor ratio beneficio/riesgo del lado servidor, pero su validación es lo que no se puede recortar: un error de paridad en RLS es un incidente de acceso a datos, no un bug visual.

**Files affected:**
- supabase/migrations/<timestamp>_inline_writings_select_policy.sql (nuevo — drop + create de `writings_select_accessible` con predicado inline y `(select auth.uid())`; incluir bloque `-- rollback:`)
- tests/ (nuevo o modifica — verificación de paridad de accesos, ver DoD)
- workflow/status.json (modifica)

**Política nueva (referencia):**
```sql
using (
  deleted_at is null and (
    author_id = (select auth.uid())
    or visibility = 'public'
    or (visibility = 'shared' and public.has_writing_share(id))
  )
)
```

**Trampa de recursión (por qué NO un `exists` inline a `writing_shares`):** la policy de SELECT de `writing_shares` (`writing_shares_select_related`, `20260317145743:688`) contiene un `exists` de vuelta a `writings`. Un `exists` inline sobre `writing_shares` dentro de la policy de `writings` crea el ciclo writings→writing_shares→writings y Postgres lo rechaza con `42P17 infinite recursion detected in policy`. Esta recursión es la razón histórica de la función security-definer. La solución que conserva el perf win: un helper mínimo `public.has_writing_share(target_writing_id uuid)` — security definer, stable, que consulta **solo** `writing_shares` (`exists(select 1 from writing_shares where writing_id = $1 and shared_with_id = auth.uid())`), sin tocar `writings`. El executor evalúa el OR de izquierda a derecha, así que para el caso dominante (dueño) la rama `author_id = (select auth.uid())` corta antes de invocar la función; la función solo corre para filas no-propias no-públicas.

**Contratos y trampas:** T-D es EL riesgo de este issue: `can_read_writing()` **no se borra ni se modifica** — la usan las policies de INSERT/UPDATE de writings (parent_id) y la policy de `writing_collections`. Solo se reemplaza el gate de la policy de SELECT. T-A: después de migrar, re-verificar que el INSERT plano del sync desktop sigue pasando y que upsert sigue fallando igual (no "aprovechar" para arreglarlo). Semántica de `deleted_at`: la función actual excluye filas borradas del SELECT; la policy nueva conserva ese comportamiento — verificar que ningún flujo legítimo lee writings con `deleted_at` puesto (el sync desktop marca deletes vía UPDATE, que usa la policy de UPDATE, no la de SELECT — pero si algún flujo re-lee el row tras el soft-delete para confirmación, se rompe; buscar callers antes de migrar).

**Failure modes:** (migración, no runtime)
1. *La migración falla a mitad:* drop+create en una transacción; el bloque rollback restaura la policy original con `can_read_writing`.
2. *Paridad rota:* un caso de acceso que la función permitía y el predicado no (o viceversa) — la matriz de paridad del DoD existe para esto.
3. *Carrera:* n/a.
4. *Estado intermedio:* n/a.

**Consumers (asunciones afectadas):**
- lib/sharing/shared-writings.ts y lib/services/web-sharing-service.ts — leen writings compartidos vía esta policy.
- lib/services/desktop/desktop-sharing-service.ts — su header documenta la semántica de `writings_select_accessible`; actualizar el comentario.
- lib/sharing/test-link-access.ts — acceso público por link.
- Hidrataciones M1/M3 — beneficiarias directas.

**Evidencia requerida en PR:** `explain analyze` (vía Supabase MCP) del query de hidratación antes y después, pegado en el PR. Matriz de paridad ejecutada: dueño ve los suyos; no-dueño no ve drafts ajenos; `public` visible para anon y autenticados; `shared` visible solo para `shared_with_id`; fila con `deleted_at` invisible en SELECT. Confirmación de que INSERT plano del sync pasa y upsert sigue fallando (T-A intacto).

**DoD:** la matriz de paridad completa da idéntico resultado con la policy nueva; el `explain analyze` del caso dueño muestra index scan por `author_id` sin llamada a función; web y desktop hidratan y comparten igual que antes.

**Reference docs:** `.agents/skills/skill-database/SKILL.md`, `workflow/context/core/odessay-modelo-datos.md`, migraciones `20260317145743` (policy y función actuales), `20260603175221` (consumers de la función), este documento §Parte 0 (T-A, T-D obligatorios).

---

### M5 · Registro global de eventos de menú Tauri

**Objetivo:** navegar entre vistas no genera ráfagas de `listen`/`unlisten`; los listeners IPC se registran una vez por proceso.

**Resultado esperado (aceptación del dueño):** cada navegación entre vistas deja de pagar ~66 operaciones IPC (~33 `listen` + ~33 `unlisten` de ~100 ms cada una). No es algo que se cronometre conscientemente; es parte de por qué cambiar de Desk a Write se siente pesado hoy. Los menús nativos funcionan exactamente igual que antes — el refactor es invisible salvo por el Network limpio. *Gate:* 0 `listen`/`unlisten` después del arranque al navegar, y checklist manual de los ~30 items de menú verde en build (no solo dev). *Proyección:* la sensación de navegación más ligera.

**Files affected:**
- lib/services/desktop/menu-event-bus.ts (nuevo — singleton: registra los canales una vez; expone `subscribe(action, handler)` que agrega/quita handlers de un Map sin tocar IPC)
- hooks/useTauriMenuEvents.ts (modifica — consume el bus en vez de `listen` directo)
- hooks/useTauriEditorMenuEvents.ts (modifica — ídem)
- hooks/useGlobalOpenFileMenu.ts (modifica — ídem)
- workflow/status.json (modifica)

Variante preferida si BUILD puede tocar Rust con bajo riesgo: emitir un único evento `menu:action` con payload `{ action }` desde `src-tauri` y un solo `listen` en el bus. Si no, mantener los ~33 canales pero registrados una sola vez a nivel módulo.

**Contratos y trampas:** los handlers de menú son **del componente activo**: con un registry global, dos editores montados (o un editor + un modal) no deben ejecutar ambos el mismo `menu:bold`. Definir semántica: último suscriptor gana (stack) o suscripción única por acción con warning. Hoy la semántica implícita es "cada mount escucha" — documentar la elegida. `tauri dev` ≠ build: probar los menús en build.

**Failure modes:**
1. *Fallo de `listen` inicial:* el bus reintenta en el próximo `subscribe`; los menús no pueden quedar muertos silenciosamente — loggear.
2. *Respuesta inválida:* n/a.
3. *Carrera:* evento de menú llega mientras el componente activo se desmonta — el handler ya se quitó del Map; el evento se ignora (comportamiento actual equivalente).
4. *Estado intermedio:* n/a.

**Consumers:** `components/editor/editor-shell.tsx` y cualquier superficie que use los tres hooks. La firma de los hooks no cambia (el refactor es interno).

**Evidencia requerida en PR:** Network desktop: navegar Desk → Write → Studio → Write produce **0** `plugin:event|listen`/`unlisten` después del arranque (hoy: ~33+33 por ciclo). Los ~30 items del menú nativo siguen funcionando (checklist manual en build, no solo dev).

**DoD:** todos los items de menú (formato, save, save-as, open, new) funcionan en `tauri dev` y en build; el panel Network no muestra churn de listeners al navegar.

**Reference docs:** `.agents/skills/skill-frontend/SKILL.md`, `.agents/skills/skill-architecture/SKILL.md`, `docs/keyboard-shortcuts.md`, este documento §Parte 0.

---

### M6 · Presupuesto de red verificable + auditoría transversal

Es el trabajo de workflow de la Parte 4 (4.6): crear `workflow/perf-budgets-network.json` (máx. requests de arranque, máx. bytes, 0 duplicados idénticos, mismo modelo pass/warn/fail de `perf-budgets.json`) y el comando `/wf-audit-runtime` que lo mide con Playwright/browse y registra en `review-history.jsonl`. Se define DESPUÉS de M1–M3 para fijar el baseline sobre el estado corregido.

---

## Parte 4 — Mejoras al sistema de Skills (.agents) y workflow

### El diagnóstico honesto: por qué el sistema no lo vio

Esto no es falta de estándares — es **falta de enforcement y de mirada transversal**:

1. **El contrato existe pero nada lo mide.** `skill-backend` declara "≤ 6 fetches por vista" y "peso exacto del dato" desde hace meses. El arranque real hace 30+ requests con 5.4 MB. Ningún gate compara contrato contra runtime.
2. **El review es por diff, y estos problemas son acumulativos.** Cada PR que agregó una hidratación se veía correcto en aislamiento. Los 33 listeners se agregaron acción por acción. Ningún diff individual era el bug; el bug es la suma.
3. **Proof of work no incluye evidencia de runtime de red.** Typecheck + screenshots visuales dejan pasar un PR que duplica la hidratación.
4. **`perf-budgets.json` cubre solo latencia de input del editor.** La infraestructura de presupuestos existe; su scope no incluye red, arranque ni payload. (Nota: `skill-product-manager §Performance Contract` ya define las cinco dimensiones con evidencia por dimensión — el gap es que los issues históricos no lo activaron y no existe el instrumento automatizado para waterfall/peso.)
5. **Context rot real:** ningún documento describe la **topología de sync en runtime** — quién dispara hidratación, cuándo, y quién tiene prohibido hacerlo. Sin ese contrato, cada agente que implementó una vista decidió "por seguridad, hidrato yo también".

### 4.1 Nuevo contrato: topología de sync (arquitectura)

Crear `workflow/context/features/odessay-sync-topology.md` (o sección en `odessay-sync.md`): dueño único del ciclo de hidratación y su ciclo de vida; regla explícita de que las vistas no llaman `hydrateWritings`/`hydrateCollections`; presupuesto de arranque. Referenciarlo desde `skill-architecture` (señal "sync / hydration") y `skill-frontend`. **Registrarlo en `workflow/docs.json` y citarlo en los briefs M1/M3** para que no nazca huérfano.

### 4.2 `skill-backend` — de principio a checklist verificable

Sección "Verificación de red (obligatoria si el cambio toca sync, bootstrap o listados)": ¿el request puede dispararse dos veces por la misma causa? ¿el select trae `body_json`/`body_text` en un listado? ¿hay filtro incremental disponible que no se usa? Adjuntar captura de Network como proof of work.

### 4.3 `skill-frontend` — reglas de runtime desktop

Los listeners Tauri se registran una vez a nivel app, nunca por mount. Todo `useEffect` que dispare fetch remoto en una vista debe justificar por qué no basta leer IndexedDB. Si el cambio toca bootstrap/listados, incluir conteo de requests antes/después.

### 4.4 `skill-database` — checklist de RLS performante

`auth.uid()` siempre como `(select auth.uid())`. Prohibida función-por-fila en policies de SELECT de tablas grandes; el caso dominante resuelve inline sobre índice. Toda policy nueva/modificada sobre `writings`/`writing_shares`/`correspondences` exige `explain analyze` del query dominante en el PR. Las funciones `can_read_writing`/`can_access_correspondence` quedan para RPCs y policies no-SELECT, no como gate de SELECT masivo.

### 4.5 `skill-code-review` — dos adiciones

1. **Pregunta de acumulación:** "¿este cambio agrega un trigger de fetch/listener/subscription que ya existe en otra parte del flujo? Buscar llamadores existentes antes de aprobar."
2. **Proof of work de red** para PRs que tocan sync/bootstrap/listados: captura de Network con conteo de requests y bytes.

### 4.6 Nuevo gate periódico: `/wf-audit-runtime` (= M6)

Comando mensual o post-milestone: arranca la app (web y desktop dev), captura el waterfall de arranque + navegación Desk → Studio → Write, compara contra `workflow/perf-budgets-network.json`, registra en `review-history.jsonl` con el modelo pass/warn/fail existente. Es lo que habría detectado los hallazgos 1–4 meses atrás.

### 4.7 Contra el context rot: regla de contrato ↔ instrumento

Para `workflow/agents.md`: **ningún skill puede declarar un presupuesto numérico sin nombrar el instrumento que lo mide** (script, budget JSON, o paso de checklist con evidencia). Si el instrumento no existe, el skill lo marca `Budget sin gate` — igual que hoy se marca `Context Gap`. Un contrato sin instrumento es exactamente lo que se pudre en silencio.

---

## Resumen ejecutivo

- **Código (M1–M5, Parte 3):** deduplicar hidratación, cachear el keychain, sync incremental, RLS inline, event bus de menú — cada uno en formato pre-brief con files, trampas, failure modes, consumers y evidencia.
- **Sistema de agentes (Parte 4 / M6):** topología de sync como contrato, presupuestos con instrumento, pregunta de acumulación en review, auditoría transversal periódica.
- **Para `/wf-define`:** la Parte 0 es lectura obligatoria; los pre-briefs se re-verifican contra el código vigente (Definition check) antes de convertirse en issues; los invariantes citados llevan su anotación `enforced by` / `BUILD debe crear el test` al pasar a Linear.
- **Lección de fondo:** los estándares existían; faltaba el instrumento que los midiera y el paso del workflow que mirara el sistema completo.
