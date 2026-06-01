# ODESSAY — Desktop Migration Diagnostic

**Documento de diagnóstico para planear la migración arquitectónica a desktop.**
Lee `workflow/context/features/odessay-desktop-app.md` para la dirección objetivo, `workflow/context/core/odessay-arquitectura.md` para el estado canónico del producto y `workflow/context/features/odessay-sync.md` para la capa local-first vigente.

Después de este diagnóstico, la secuencia continúa con:

- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`

---

## Propósito

Este documento no define la arquitectura objetivo. Define el **estado actual del codebase** desde la perspectiva de la migración a desktop:

- qué responsabilidades ya están razonablemente separadas
- qué partes siguen demasiado acopladas al runtime web
- qué módulos son portables hoy
- qué seams conviene extraer antes de introducir Tauri o Electron

La meta es convertir la conversación sobre desktop en un plan técnico verificable, no en una intuición general.

---

## Resumen ejecutivo

El codebase actual tiene una base reusable importante, pero todavía no está en estado multi-runtime.

### Lo mejor posicionado para desktop

- `lib/editor/*` contiene bastante lógica editorial reusable.
- `lib/import/*` y `lib/export/*` ya encapsulan bien transformaciones documentales.
- `lib/writings/status.ts`, `lib/writings/writing-route.ts`, `lib/margins/margins.ts` y partes de `lib/sharing/*` son buenas candidatas a core compartido.
- `lib/local-db/*` y partes de `lib/sync/*` ya modelan una capa local-first explícita.

### Lo más acoplado al runtime web actual

- el frontend aún depende mucho de `fetch("/api/...")`
- `app/api/*` mezcla transporte HTTP, auth, validación, acceso a Supabase y reglas de negocio
- `lib/supabase/server.ts` y `lib/supabase/middleware.ts` dependen directamente del modelo SSR/cookies de Next
- varias capacidades remotas todavía están modeladas como endpoints internos, no como servicios de producto

### Implicación principal

Desktop no debería empezar por la shell. Debería empezar por extraer un **shared core** con:

- reglas de dominio
- casos de uso
- contratos de servicio
- contrato documental Markdown

y dejar web y desktop como adapters de infraestructura distintos.

---

## Estado actual por responsabilidad

### UI / Presentación

**Buen nivel de separación estructural, pero con componentes grandes que también orquestan casos de uso.**

Módulos principales:

- `app/*`
- `components/editor/*`
- `components/reading/*`
- `components/settings/*`
- `components/navigation/*`

Lectura:

- La UI está claramente identificada como capa.
- El principal problema no es dónde vive la UI, sino que algunos componentes hacen demasiado trabajo no-visual.
- `components/editor/editor-shell.tsx` es el hotspot más claro: mezcla render, estado de interfaz, persistencia local, sync, AI y navegación interna.

### Aplicación / Casos de uso

**Existe, pero está repartida entre componentes, helpers cliente y rutas API.**

Módulos principales:

- `lib/sync/worker.ts`
- `lib/sync/queue.ts`
- `lib/sync/remote-bootstrap.ts`
- `lib/collections/remote-bootstrap.ts`
- `lib/corrections/persistence.ts`
- partes de `components/editor/editor-shell.tsx`

Lectura:

- ya hay coordinación explícita de flujos reales del producto
- pero muchos casos de uso no viven como servicios o use cases reutilizables
- la orquestación aún está demasiado repartida entre browser code y route handlers

### Dominio / Lógica pura

**Hay una base útil, pero todavía incompleta como core aislado.**

Módulos principales:

- `lib/writings/status.ts`
- `lib/writings/writing-route.ts`
- `lib/margins/margins.ts`
- `lib/reading/render-body-html-core.ts`
- `lib/editor/content-sanitizer.ts`
- `lib/import/*`
- `lib/export/*`
- `lib/validation/*`

Lectura:

- varias reglas del producto ya existen fuera de la infraestructura
- editor, lectura y transformaciones textuales tienen buena portabilidad
- todavía faltan seams más claros para que la aplicación dependa del dominio y no de Supabase/Next

### Integraciones externas

**Es la capa con más deuda para desktop.**

Módulos principales:

- `app/api/*`
- `lib/supabase/*`
- `lib/ai/provider-config.ts`
- `components/auth/*`

Lectura:

- Supabase, AI provider y storage están distribuidos en múltiples puntos
- la app depende de integraciones concretas antes de pasar por contratos de servicio
- esta es la zona donde más conviene introducir adapters explícitos

### Runtime

**El producto corre hoy sobre múltiples runtimes, pero el contrato entre ellos aún es implícito.**

Runtimes activos:

- browser: React, TipTap, IndexedDB, `window`, `navigator`, `history`
- Node/Next: route handlers AI, export, CRUD remoto
- Supabase: auth, DB, storage y estado remoto

Lectura:

- el runtime web está bien aprovechado
- el problema no es el uso de varios runtimes, sino que su frontera todavía no está modelada como servicios transport-agnostic

---

## Mapa de runtimes actual

| Área | Runtime dominante | Evidencia en código | Lectura para desktop |
|---|---|---|---|
| Editor interactivo | Browser | `components/editor/editor-shell.tsx`, `lib/local-db/index.ts` | Reusable parcialmente; necesita desacoplar persistencia, AI y sync |
| Sync queue | Browser | `lib/sync/worker.ts`, `lib/sync/queue.ts` | La lógica sirve, el transporte no |
| Hydration remota | Browser + Next API | `lib/sync/remote-bootstrap.ts`, `lib/collections/remote-bootstrap.ts` | Debe convertirse en `SyncService` o `RemoteDocumentService` |
| Auth y sesión | Browser + Next SSR + Supabase | `components/auth/*`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts` | Debe re-modelarse para desktop |
| CRUD de writings y collections | Next API + Supabase | `app/api/writings/*`, `app/api/collections/*` | Hoy es web-only como infraestructura |
| AI server-side | Next API + proveedor externo | `app/api/ai/*`, `lib/ai/*` | Debe exponerse como `AIService` |
| Export | Node runtime + Supabase fetch del writing | `app/api/writings/[id]/export/route.ts`, `lib/export/*` | La transformación es portable; el acceso actual al writing no |
| Settings de cuenta | Browser + Next API + Supabase Auth | `components/settings/account-form.tsx`, `app/api/user/*` | Web adapter claro; no reusable tal cual |

---

## Portability matrix

| Módulo / área | Responsabilidad dominante | Estado actual | Portabilidad | Problema principal | Destino recomendado |
|---|---|---|---|---|---|
| `lib/editor/*` | dominio + lógica editorial | buena separación | alta | dependencias puntuales de persistencia y UI host | shared core |
| `lib/import/*`, `lib/export/*` | transformación documental | buena separación | alta | hoy el write-path canónico sigue centrado en `body_json` | shared core |
| `lib/writings/status.ts`, `lib/writings/writing-route.ts` | dominio | buena separación | alta | ninguna estructural | shared core |
| `lib/margins/margins.ts` | dominio + validación | buena separación | alta | depende de modelo actual de persistencia remota para algunos flujos | shared core |
| `lib/local-db/*` | storage local + caché operativa | razonable | media | hoy está pensado alrededor de IndexedDB como fuente operativa web | adapter local por runtime |
| `lib/sync/worker.ts`, `lib/sync/queue.ts` | aplicación + integración | útil pero acoplado | media | usa `fetch("/api/...")` y `window`/`navigator` | `SyncService` + adapters |
| `lib/sync/remote-bootstrap.ts`, `lib/collections/remote-bootstrap.ts` | bootstrap remoto | acoplado al transporte web | media-baja | hidrata desde endpoints internos de Next | web adapter / remote adapter |
| `lib/corrections/persistence.ts` | persistencia remota AI | acoplado al transporte web | media-baja | POST directo a `/api/corrections/persist` | `AIService` / `CorrectionsService` |
| `components/editor/editor-shell.tsx` | UI + aplicación mezcladas | hotspot mayor | baja | demasiada orquestación dentro del componente | dividir UI y use cases |
| `components/settings/*`, `components/auth/*` | UI + integración de cuenta | web-specific | baja | dependen de Supabase Auth y endpoints internos | web adapter |
| `app/api/*` | transporte HTTP + integración | funcional para web | baja | mezcla auth, validación, DB y respuesta | web adapter |
| `lib/supabase/*` | infraestructura remota | clara pero web-centric | baja | SSR/cookies/service-role acoplados a Next/Supabase | web adapter |

---

## Hotspots de acoplamiento

### 1. `components/editor/editor-shell.tsx`

Acumula responsabilidades de:

- UI
- aplicación
- persistencia local
- sync remoto
- AI de publicación
- navegación interna
- estado de pestañas

Lectura:

- es el mejor candidato para empezar a extraer use cases
- no conviene intentar “reducirlo” de golpe
- conviene sacar primero capacidades completas: save, sync, AI, share/export

### 2. `lib/sync/worker.ts`

Punto fuerte:

- modela bien la existencia de una cola y un worker

Problema:

- el transporte por defecto usa `fetch("/api/...")`
- depende de `window`, `navigator.onLine` y listeners browser

Lectura:

- la lógica de scheduling y retry es reusable
- el transporte debe quedar detrás de un `SyncService` o adapter remoto

### 3. `lib/sync/remote-bootstrap.ts` y `lib/collections/remote-bootstrap.ts`

Problema:

- hacen hydration remota desde el cliente usando endpoints internos de Next

Lectura:

- hoy resuelven bien el runtime web
- no sirven como base directa para desktop ni mobile

### 4. `lib/corrections/persistence.ts`

Problema:

- la persistencia de correction blocks depende de `/api/corrections/*`

Lectura:

- la feature AI ya tiene parte del contrato local modelado
- falta convertir la persistencia remota en un servicio explícito

### 5. `app/api/*`

Problema:

- varias rutas mezclan:
  - auth
  - validación
  - reglas del producto
  - acceso a Supabase
  - respuesta HTTP

Lectura:

- eso no está mal como endpoint web MVP
- pero para desktop esta capa debe quedar tratada como **adapter web**, no como corazón del producto

---

## Tensiones documentales y del modelo actual

### 1. Fuente de verdad documental

`workflow/context/features/odessay-desktop-app.md` define `.md` como fuente de verdad canónica en desktop.

El codebase actual y `workflow/context/core/odessay-modelo-datos.md` siguen tratando `writings.body_json` como fuente de verdad operativa y persistida.

Lectura:

- este es el gap arquitectónico más importante antes de desktop real
- mientras el core siga pensando el documento como `body_json` primero, desktop seguirá siendo un adapter incómodo sobre el runtime web

### 2. Base local en desktop

La documentación ya alineada distingue:

- filesystem `.md` como write-path principal
- índice local derivado opcional

El código actual de local-first todavía está diseñado alrededor de `localDB` como storage operativo principal.

Lectura:

- `localDB` no debe desaparecer
- pero en desktop debe bajar de jerarquía: de fuente operativa principal a índice/caché derivado sobre filesystem

---

## Servicios a extraer primero

Los primeros contratos explícitos deberían ser estos:

### `DocumentService`

Debe cubrir:

- abrir documento
- guardar documento
- listar recientes / listar writings
- renombrar
- exportar

Implementaciones esperadas:

- web: `WebDocumentService`
- desktop: `FilesystemDocumentService`

### `SyncService`

Debe cubrir:

- push de cambios
- pull / hydration
- estado de sync
- retry / backoff

Implementaciones esperadas:

- web actual: `SupabaseSyncService` o equivalente
- desktop: `CloudSyncService` desacoplado del write-path local

### `AIService`

Debe cubrir:

- title suggestions
- publication review
- corrections persistence / hydration

Implementaciones esperadas:

- web actual: route handlers + provider remoto
- desktop futuro: cloud por defecto, local/BYOK opcional

### `AuthService`

Debe cubrir:

- login/logout
- sesión
- recuperación / update de credenciales

Implementaciones esperadas:

- web: Supabase Auth con modelo actual
- desktop: secure local credentials + auth remota opt-in

### `SharingService` y `AssetService`

Deben separar:

- lo colaborativo/remoto
- lo documental/local

Esto es especialmente importante para imágenes y sharing, donde web y desktop divergen mucho.

---

## Secuencia de migración recomendada

### Etapa 1 — Extraer seams sin cambiar comportamiento

- sacar `fetch("/api/...")` del frontend donde hoy es dependencia directa del producto
- mover orquestación de save/sync/AI fuera de componentes grandes
- tratar `app/api/*` como adapters web, no como capa central

### Etapa 2 — Fijar contrato documental compartido

- definir una ruta canónica Markdown
- decidir relación exacta entre `.md`, `body_json` y caches derivadas
- agregar tests de round-trip estrictos

### Etapa 3 — Introducir adapters explícitos por runtime

- web adapters: Next + Supabase + IndexedDB
- desktop adapters: filesystem + índice local + secure storage

### Etapa 4 — Relegar sync y auth a capacidades secundarias en desktop

- guardar local no depende de red
- auth deja de ser gate de arranque
- sync deja de ser write-path principal

---

## Conclusiones

1. El editor y el modelo editorial de Odessay tienen buena base para un core compartido.
2. La mayor deuda no está en TipTap ni en Markdown, sino en la capa de servicios e integraciones.
3. El punto de partida correcto para desktop no es Tauri/Electron, sino la extracción de contratos de servicio.
4. El gap arquitectónico más importante sigue siendo la diferencia entre:
   - documento como `body_json` persistido hoy
   - documento como `.md` canónico en la visión desktop
5. El diagnóstico sugiere una estrategia de migración incremental, no una reescritura total.

---

## Diferencias entre `tauri dev` y `tauri build` (bundle de producción)

**`tauri dev` y el DMG producido por `tauri build` son entornos fundamentalmente distintos.** Probar solo en `tauri dev` es engañoso — varios problemas son invisibles hasta que se prueba el bundle real.

| Dimensión | `tauri dev` | `tauri build` (DMG) |
|---|---|---|
| Carga el frontend desde | `http://localhost:3000` (servidor Next.js real) | `tauri://localhost` (custom protocol, static export) |
| CSP del bundle | No aplica (dev bypassa el CSP del bundle) | Aplica estrictamente — bloquea `ipc:` si no se declara |
| Tauri IPC (`invoke()`) | Funciona sin restricción | Requiere `ipc:` y `http://ipc.localhost` en `connect-src` |
| Server-side auth (cookies, `getUser()`) | Funciona (Next SSR corriendo) | No existe — las páginas se pre-renderizan con cookies vacías |
| `redirect("/login")` server-side | Funciona correctamente | Se bake en el RSC payload — redirige en toda visita aunque haya sesión |
| Supabase storage (`localStorage`, cookies) | Funciona con `document.cookie` normal | Cookies no persisten en custom protocol; storage custom requerido |
| DevTools | Siempre disponible | Requiere `features = ["devtools"]` en `Cargo.toml` (obligatorio en Fase 7) |

### Consecuencias para el desarrollo

**Toda feature que toca auth, storage, sync, Tauri commands o network debe validarse contra el DMG real** (`npm run desktop:release`), no solo contra `tauri dev`. Las pruebas en `tauri dev` no detectan:

- CSP bloqueando Tauri IPC (`invoke()` devuelve `null` silenciosamente)
- Páginas con `redirect("/login")` server-side que se rompen en el static export
- Storage adapters custom ignorados por wrappers SSR (ver `odessay-desktop-target-architecture.md §Storage de tokens`)
- Keyring sin features declarados (mock backend silencioso)
- Rutas dynamic (`/write/[id]`) para UUIDs no declarados en `generateStaticParams`

### Checklist antes de marcar un issue desktop como Done

1. ¿Se corrió `npm run desktop:release` y se instaló el DMG resultante?
2. ¿El CSP del bundle incluye `ipc:` y `http://ipc.localhost` en `connect-src`?
3. ¿Toda página `(app)` nueva con server auth tiene bifurcación `isTauriBuild`?
4. ¿DevTools está habilitado en el bundle (`features = ["devtools"]`) para poder diagnosticar?
5. ¿El flow completo (signin → navegar → cerrar → reabrir) fue probado en el DMG real?

---

## Documento siguiente en la secuencia

El siguiente artefacto de esta serie es:

- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`

Esos documentos fijan:

- qué vive en shared core
- qué vive en web adapters
- qué vive en desktop adapters
- qué servicios se extraen primero
