# ODESSAY — Desktop Target Architecture

**Documento de diseño objetivo para la arquitectura multi-runtime de Odessay.**
Lee `workflow/context/features/odessay-desktop-app.md` para la dirección de producto, `workflow/context/features/odessay-desktop-migration-diagnostic.md` para el estado actual del codebase y `workflow/context/core/odessay-arquitectura.md` para la arquitectura vigente del producto.

> **Subordinado a `workflow/context/core/odessay-adr-identidad.md` (ADR de identidad)** en fuente de verdad, identidad y metadata del documento (`.md` canónico, `body_json` copia de trabajo, metadata en la nube, un solo UUID cliente=nube). Ante cualquier discrepancia, prevalece el ADR.
>
> Spec de implementación del filesystem-tracking (carpetas vigiladas, índice de binding `.odessay/`, watcher): `workflow/context/core/odessay-watched-folders.md`.

Este documento responde la pregunta: **si Odessay va a vivir en web, desktop y eventualmente mobile, cómo debe partirse el sistema para compartir producto sin compartir infraestructura por la fuerza**.

---

## Rol de este documento

`odessay-desktop-app.md` define la dirección.

`odessay-desktop-migration-diagnostic.md` describe el estado actual.

**Este documento define la arquitectura objetivo**:

- qué vive en el shared core
- qué vive en adapters web
- qué vive en adapters desktop
- qué contratos de servicio deben existir
- qué reglas de dependencia deben gobernar la migración

No describe tareas detalladas ni issue breakdown. Ese siguiente paso debe vivir en un plan de migración o roadmap técnico.

El documento siguiente de esta secuencia es:

- `workflow/context/features/odessay-desktop-migration-plan.md`

---

## Principio rector

Odessay no debe organizarse alrededor de Next, Tauri o Supabase.

Debe organizarse alrededor de:

1. **el documento**
2. **las reglas editoriales del producto**
3. **los casos de uso del autor y del lector**
4. **las capacidades necesarias para operarlo en distintos runtimes**

La idea central es esta:

> El producto se comparte como core. La plataforma se adapta como infraestructura.

---

## Arquitectura objetivo en una vista

```text
Odessay
├─ Shared Core
│  ├─ Domain
│  ├─ Application
│  ├─ Service Contracts
│  └─ Document Engine
├─ Web Adapters
│  ├─ Next route handlers
│  ├─ Supabase auth/session
│  ├─ IndexedDB local cache
│  └─ Browser runtime bindings
├─ Desktop Adapters
│  ├─ Filesystem document store
│  ├─ SQLite local index
│  ├─ Secure credential storage
│  ├─ Native file/asset APIs
│  └─ Desktop runtime bindings
└─ Future Mobile Adapters
   ├─ Mobile local storage
   ├─ Background sync bindings
   └─ Secure auth storage
```

---

## Capas objetivo

### 1. Domain

Contiene las reglas que siguen siendo verdaderas aunque cambie la plataforma.

Debe incluir:

- estados y visibilidad de writings
- reglas de sharing y publicación
- reglas del perfil Markdown soportado
- reglas de correspondencias y márgenes
- transformaciones editoriales puras
- invariantes del documento

Debe vivir en módulos del tipo:

- `lib/writings/*`
- partes de `lib/margins/*`
- partes de `lib/reading/*`
- partes de `lib/editor/*`
- parser/serializer/document profile compartido

No debe depender de:

- Next
- Supabase
- `fetch`
- cookies
- filesystem concreto
- `window`

### 2. Application

Coordina casos de uso del producto. No define el significado de un writing; define cómo ejecutar una operación.

Debe incluir casos de uso como:

- `CreateWriting`
- `OpenWriting`
- `SaveWriting`
- `RenameWriting`
- `RequestTitleSuggestions`
- `RunPublicationReview`
- `ShareWriting`
- `ExportWriting`
- `SyncPendingChanges`

La capa de aplicación puede depender de:

- dominio
- contratos de servicio
- validación

No debe depender de:

- Supabase concreto
- Next route handlers
- IndexedDB directo
- Tauri APIs directas

### 3. Service Contracts

Son los puertos del sistema. Permiten que la aplicación pida capacidades sin conocer la implementación concreta.

Contratos mínimos:

- `DocumentService`
- `SyncService`
- `AIService`
- `AuthService`
- `SharingService`
- `AssetService`
- `SettingsService`

Estos contratos deben definir:

- inputs y outputs
- errores esperables
- tipos compartidos
- qué es síncrono, qué es eventual

### 4. Infrastructure Adapters

Implementan los contratos para cada runtime.

No deben ser tratados como el producto mismo.

Ejemplos:

- adapter web para documents
- adapter desktop para filesystem
- adapter web para auth con Supabase
- adapter desktop para secure credential storage
- adapter cloud para AI

### 5. Presentation

La UI consume casos de uso o servicios de aplicación ya resueltos.

No debería:

- construir payloads HTTP internos
- conocer rutas `/api/...`
- conocer detalles de Supabase
- decidir estrategia de sync

---

## Shared Core

### Qué debe vivir en el core compartido

#### Document Engine

Debe ser el corazón documental del producto.

Incluye:

- perfil Markdown soportado
- parser Markdown -> documento rico derivado
- serializer documento rico -> Markdown
- tests de round-trip
- reglas de degradación aceptable

El principio es:

> el documento canónico no es la UI ni el transporte; es el contrato documental.

#### Domain Rules

Incluye:

- `WritingStatus`
- `WritingVisibility`
- reglas de transición válidas
- reglas de correspondencia
- reglas de sharing
- reglas de márgenes y anotaciones

#### Application Use Cases

Incluye orquestación reusable, por ejemplo:

- guardar local y devolver nuevo estado de save
- pedir AI y normalizar respuesta
- compartir un writing
- exportar documento

#### Shared Types and Validation

Incluye:

- tipos de documento
- envelopes de respuesta internos del producto
- validaciones de inputs
- estructuras de errores del core

---

## Web Adapters

La web no desaparece. Se convierte en un runtime específico.

### Responsabilidades web

- Next pages/layouts
- route handlers HTTP
- auth basada en sesión web
- IndexedDB como caché local operativa
- integración con Supabase remoto

### Qué debe quedar en web-only

- `app/api/*`
- `lib/supabase/server.ts`
- `lib/supabase/middleware.ts`
- SSR/cookies/redirects
- detalles del browser runtime

### Regla

Los adapters web implementan contratos del core. No deben definir por sí mismos la semántica del producto.

---

## Desktop Adapters

Desktop debe tratarse como runtime distinto, no como packaging del runtime web.

### Responsabilidades desktop

- abrir/guardar archivos `.md`
- autosave al filesystem local
- watch de cambios externos
- manejo de carpeta/workspace
- rutas locales de imágenes y assets
- índice local derivado
- secure storage local

### Write-path de desktop

```text
UI
  ↓
SaveWriting use case
  ↓
DocumentService.save()
  ↓
Filesystem adapter
  ↓
archivo .md persistido
```

### Lo local en desktop

- `DocumentService` principal
- `AssetService` local
- `SettingsService`
- `LocalIndexService` o equivalente derivado

### Lo remoto en desktop

- `SyncService`
- `AuthService`
- `SharingService`
- `AIService` por defecto

---

## Mobile Adapters

Aunque no sea prioridad inmediata, la arquitectura objetivo no debe cerrarse a mobile.

Mobile probablemente comparta:

- dominio
- casos de uso
- contrato documental
- servicios lógicos

Pero no compartirá:

- filesystem desktop
- middleware Next
- sesión SSR

Esto es una buena prueba de diseño: si la arquitectura sirve para web y desktop, pero no para mobile, todavía puede estar demasiado acoplada a la shell.

---

## §Auth — Autenticación Web vs Desktop

Esta sección documenta las diferencias concretas entre los dos runtimes de autenticación y los gotchas que han costado tiempo de debug. Es fuente de verdad para cualquier trabajo futuro que toque auth, sync o migración de sesión.

### Tabla comparada

| Dimensión | Web | Desktop |
|-----------|-----|---------|
| **Cliente Supabase** | `createBrowserClient` desde `@supabase/ssr` | `createClient` desde `@supabase/supabase-js` |
| **Storage de sesión** | Cookies HTTP (cookie store de Next.js) | macOS Keychain vía `keychainStorage` (o `tauri-plugin-store` para bundles ad-hoc sin Developer ID) |
| **Mecanismo de escritura** | SSR: middleware refresca tokens en cada request; Server Components leen/escriben cookies vía `createServerClient` | Cliente-directo: singleton mantiene sesión en memoria y persiste a Keychain vía adapter `auth.storage` |
| **API key** | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (o `ANON_KEY` como fallback) | Igual — usa la misma publishable key |
| **Firma de JWT** | Validada por Supabase Auth; refresh automático manejado por `@supabase/ssr` | Validada por Supabase Auth; refresh automático habilitado con `autoRefreshToken: true` en `createClient` |
| **Detección de runtime** | N/A (es el default) | `isTauriRuntime()` lee `window.__TAURI_INTERNALS__` o `NEXT_PUBLIC_TAURI_BUILD` |
| **Email callbacks** | Se completan in-app vía `/auth/confirm` con `token_hash` | Se completan en el navegador web (no in-app); `detectSessionInUrl: false` en el cliente desktop |
| **Routing de auth** | Middleware Next.js redirige `/desk` → `/login` si no hay sesión | No hay middleware; `DesktopAppShell` monta la ruta y el componente decide si redirigir |
| **Bootstrap de sync** | `SyncBootstrap` usa `createClient()` + `onAuthStateChange` para hydration | `SyncBootstrap` usa `createDesktopClient()` + `onAuthStateChange` idéntico pero con Keychain-backed session |

### Gotchas (advertencias operativas)

1. **`process.env.TAURI_BUILD` NO llega al bundle cliente**  
   En `lib/supabase/server.ts` se usa `process.env.TAURI_BUILD` para decidir qué factory devolver en SSR, pero esa variable no está disponible en el bundle del cliente. Para detección de runtime en cliente usar siempre `isTauriRuntime()` (que lee `window.__TAURI_INTERNALS__`) o `NEXT_PUBLIC_TAURI_BUILD`. Ver `lib/runtime/detect.ts`.

2. **`@supabase/ssr` pisa `auth.storage` con cookies**  
   `createBrowserClient` hardcodea un adapter de cookies que sobreescribe silenciosamente cualquier `auth.storage` custom pasado en options (ver `node_modules/@supabase/ssr/dist/module/createBrowserClient.js`). En desktop, donde no hay cookies persistentes, usar obligatoriamente `createClient` de `@supabase/supabase-js` con `storage: keychainStorage`.  
   ```ts
   // ❌ NO — storage custom se ignora silenciosamente
   import { createBrowserClient } from "@supabase/ssr"
   createBrowserClient(url, key, { auth: { storage: myStorage } })

   // ✅ SÍ — storage custom respetado
   import { createClient } from "@supabase/supabase-js"
   createClient(url, key, { auth: { storage: myStorage, persistSession: true, autoRefreshToken: true } })
   ```

3. **Token viejo (llave rotada) da 403 silencioso, no 401**  
   Cuando la API key de Supabase rota o el token expira de forma inesperada, el cliente no siempre emite un error explícito. En su lugar, las queries subsiguientes devuelven `null` como si el usuario fuera anónimo, lo que se manifiesta como 403 en logs de red o comportamiento de "sesión perdida". No confundir con un bug de sync — verificar primero la validez del token en Keychain o cookies.

4. **PostgREST `upsert` / `return=representation` disparan 42501 con la política actual de `writings`**  
   La política RLS de `writings` que usa subconsulta de correspondencia (ver [ODE-237](https://linear.app/z9ne/issue/ODE-237/fix-bug-en-politica-rls-de-writings-subconsulta-de-correspondencia)) rechaza operaciones `upsert` con `return=representation` cuando el usuario no tiene visibilidad previa del registro. Esto afecta tanto a web como desktop, pero en desktop es más difícil de diagnosticar porque no hay middleware que normalice el error. Usar `select` + `insert`/`update` explícitos en lugar de `upsert` cuando la política RLS sea compleja.

5. **Singleton obligatorio en desktop**  
   Cada instancia nueva de `createDesktopClient` nace con sesión vacía en memoria. Si `signIn` y el siguiente `getSession` usan instancias distintas, `getSession` devuelve `null` aunque el `signIn` haya tenido éxito y el Keychain esté escrito correctamente. El factory `createDesktopClient` debe retornar siempre la misma instancia.  
   Ver también: `desktop-auth-service.ts` espera explícitamente el evento `SIGNED_IN` vía `onAuthStateChange` antes de resolver `signIn()`, para evitar que el router navegue a `/desk` antes de que la sesión esté visible en memoria.

### Referencias cruzadas

- [ODE-219](https://linear.app/z9ne/issue/ODE-219/persist-desktop-auth-tokens-in-macos-keychain-via-tauri-plugin) — Persistencia de tokens en Keychain (implementación inicial).
- [ODE-220](https://linear.app/z9ne/issue/ODE-220/keep-desktop-auth-email-callbacks-web-only-for-mvp) — Decisión de mantener callbacks de email en web para MVP desktop.
- [ODE-232](https://linear.app/z9ne/issue/ODE-232/replace-keychain-backend-with-tauri-plugin-store-for-unsigned) — Migración a `tauri-plugin-store` para bundles ad-hoc sin Apple Developer ID.
- [ODE-237](https://linear.app/z9ne/issue/ODE-237/fix-bug-en-politica-rls-de-writings-subconsulta-de-correspondencia) — Fix de política RLS que afecta operaciones `upsert`/`return=representation`.

---

## Contratos de servicio objetivo

### `DocumentService`

Debe cubrir:

- `createDraft`
- `openDocument`
- `saveDocument`
- `renameDocument`
- `listRecentDocuments`
- `exportDocument`

Implementaciones:

- web: `WebDocumentService`
- desktop: `FilesystemDocumentService`

### `SyncService`

Debe cubrir:

- `enqueuePush`
- `flushPending`
- `hydrateRemoteChanges`
- `getSyncStatus`

Implementaciones:

- web: `SupabaseSyncService`
- desktop: `CloudSyncService`

### `AIService`

Debe cubrir:

- `suggestTitle`
- `reviewForPublication`
- `hydrateCorrections`
- `persistCorrections`

Implementaciones:

- web: `CloudAIService`
- desktop: `CloudAIService` por defecto, opcional `LocalAIService` o BYOK

### `AuthService`

Debe cubrir:

- `getSession`
- `login`
- `logout`
- `requestPasswordReset`
- `updateAccount`

Implementaciones:

- web: `SupabaseWebAuthService`
- desktop: `DesktopAuthService`

### Storage de tokens en desktop: restricciones por tipo de firma

**El storage de tokens depende del estado de firma del bundle.**

#### Apps ad-hoc signed (sin Apple Developer ID)

macOS Keychain asocia los ACL de cada entry con la code signature del proceso que lo creó. Las apps ad-hoc no tienen identidad verificable entre ejecuciones: el write funciona y el entry aparece en Keychain Access, pero el read desde el siguiente proceso falla silenciosamente (devuelve `NoEntry`).

**Solución para distribución ad-hoc:** `tauri-plugin-store` — JSON file en el app data dir (`$APPDATA/odessay/secure.dat`). No es secure storage del SO, pero persiste confiablemente sin depender de ACL. Mantiene el mismo contrato de adapter (`getItem/setItem/removeItem`) para que el switch a Keychain sea drop-in cuando llegue el Developer ID.

#### Apps firmadas con Apple Developer ID

Keychain funciona correctamente. La identidad del proceso es verificable y los ACL persisten entre ejecuciones. Migrar a Keychain cuando llegue code signing formal.

#### Regla operativa

Nunca usar `@supabase/ssr.createBrowserClient` en el runtime desktop. Este wrapper hardcodea un adapter de cookies que sobreescribe silenciosamente cualquier `auth.storage` custom pasado en options (ver `node_modules/@supabase/ssr/dist/module/createBrowserClient.js`). Usar `createClient` de `@supabase/supabase-js` directamente, que sí respeta el storage custom:

```ts
// ❌ NO — storage custom se ignora silenciosamente
import { createBrowserClient } from "@supabase/ssr"
createBrowserClient(url, key, { auth: { storage: myStorage } })

// ✅ SÍ — storage custom respetado
import { createClient } from "@supabase/supabase-js"
createClient(url, key, { auth: { storage: myStorage, persistSession: true, autoRefreshToken: true } })
```

#### Singleton obligatorio

El cliente desktop debe ser singleton. Cada instancia nueva nace con sesión vacía en memoria. Si `signIn` y el siguiente `getSession` usan instancias distintas, `getSession` devuelve `null` aunque el signIn haya tenido éxito y el storage esté escrito correctamente.

### `SharingService`

Debe cubrir:

- `shareWriting`
- `revokeShare`
- `listRecipients`
- `createInvitation`

### `AssetService`

Debe cubrir:

- `attachLocalImage`
- `resolveAssetPath`
- `uploadAssetIfNeeded`

### `SettingsService`

Debe cubrir:

- preferencias locales
- estado de UI persistente
- configuraciones no documentales

---

## Reglas de dependencia

Estas reglas son el corazón de la arquitectura objetivo.

### Regla 1

La UI no depende de `/api/...`

### Regla 2

La aplicación no depende de Supabase, Next o Tauri concretos.

### Regla 3

El dominio no depende de runtime.

### Regla 4

Los adapters dependen del core, no al revés.

### Regla 5

El contrato documental se comparte entre runtimes.

### Regla 6

En desktop, el write-path principal no depende de auth ni de sync.

---

## Modelo documental objetivo

### Estado actual

Hoy el sistema persiste principalmente `body_json` y deriva Markdown cuando hace falta.

### Estado objetivo

El contrato documental compartido debe ser:

- `.md` como fuente de verdad canónica en desktop
- representación rica derivada para edición
- índices/caches derivados para búsqueda, recientes, colecciones y previews

### Convergencia web + desktop

La web no necesita guardar `.md` como storage físico principal mañana mismo, pero sí debe converger al mismo contrato documental:

- mismo perfil Markdown
- mismo serializer/parser canónico
- mismas reglas de round-trip

La divergencia permitida está en la infraestructura, no en la semántica del documento.

---

## Flujos objetivo

### Guardar un writing en web

```text
UI
  ↓
SaveWriting use case
  ↓
DocumentService.save()
  ↓
IndexedDB/local cache
  ↓
SyncService.enqueuePush()
  ↓
adapter web remoto
```

### Guardar un writing en desktop

```text
UI
  ↓
SaveWriting use case
  ↓
DocumentService.save()
  ↓
filesystem local (.md)
  ↓
índice derivado opcional
  ↓
SyncService opcional
```

### Pedir AI

```text
UI
  ↓
RequestTitleSuggestions use case
  ↓
AIService
  ↓
adapter cloud o local
```

### Compartir

```text
UI
  ↓
ShareWriting use case
  ↓
SharingService
  ↓
adapter remoto
```

---

## Qué NO debe compartirse

No conviene forzar shared code en estas áreas:

- cookies SSR
- middleware de rutas privadas
- route handlers HTTP
- APIs del sistema operativo
- secure storage concreto
- rutas de assets locales
- session bootstrapping de Next

El criterio no es “compartir más”. El criterio es **compartir lo correcto**.

---

## Orden de extracción recomendado

### Primero

- `DocumentService`
- `SyncService`

Porque son los servicios que más definen el write-path y más acoplan hoy la UI al runtime web.

### Segundo

- `AIService`
- `AuthService`

Porque concentran dependencias fuertes a endpoints internos, Supabase y provider remoto.

### Tercero

- `SharingService`
- `AssetService`
- `SettingsService`

Porque dependen de la estabilidad previa del modelo documental y de auth.

---

## Criterio de validación

La arquitectura objetivo se considera bien definida si puede responder “sí” a estas preguntas:

1. ¿La UI puede guardar un writing sin conocer `/api/writings/...`?
2. ¿La lógica del producto puede correr sobre web y desktop cambiando solo adapters?
3. ¿El dominio puede probarse sin Next, Supabase o Tauri?
4. ¿El documento tiene un contrato compartido independiente del runtime?
5. ¿Desktop puede abrir, editar y guardar sin login?
6. ¿Sync, sharing y AI pueden fallar sin bloquear el write-path local?

---

## Relación con el siguiente paso

El siguiente artefacto de esta secuencia es:

- `workflow/context/features/odessay-desktop-migration-plan.md`

Ese documento ya no redescubre la arquitectura. La traduce en:

- fases
- dependencias
- primeros refactors
- riesgos y gates
