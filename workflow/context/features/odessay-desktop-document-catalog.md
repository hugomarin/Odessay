# ODESSAY — Desktop Document Catalog and Identity Reconciliation

- **Estado:** Aceptado — contrato objetivo por implementar
- **Fecha:** 2026-07-09
- **Decide:** Hugo
- **Scope:** desktop + shared core + cloud
- **Subordinado a:** `workflow/context/core/odessay-adr-identidad.md`
- **Reemplaza para desktop:** el modelo operacional donde Desk consulta IndexedDB, Workspace consulta `.odessay/index.json` y Open Document importa por ruta acuñando identidad antes de reconciliar.

## Propósito

Este spec define una sola personalidad documental para Odessay desktop.

Hoy existen tres caminos de apertura con fuentes operativas diferentes:

| Entrada | Identidad inicial | Catálogo consultado | Apertura actual |
|---|---|---|---|
| Desk | UUID | IndexedDB por scope | UUID → `canonical_path` → `.md` o copia cacheada |
| Workspace | ruta + UUID de `.odessay/index.json` | índice del workspace | ruta/UUID → seed IndexedDB → `.md` |
| Open Document | ruta absoluta | ninguno antes de leer | ruta → leer `.md` → acuñar UUID → registrar después |

Esta diferencia no representa estados legítimos del documento. Es complejidad accidental de implementación. Los estados legítimos son:

- solo local
- sincronizado local+nube
- solo nube
- pendiente de sync/materialización
- conflicto

Desk, Workspace, Search, Recent y Open Document deben converger en el mismo catálogo y en el mismo caso de uso de apertura.

## Decisión resumida

1. El `.md` continúa siendo la autoridad del contenido cuando está materializado.
2. Cada carpeta vigilada es un `BindingRoot` y conserva un `.odessay/index.json` como ledger durable del binding `ruta relativa ↔ UUID ↔ inode ↔ content_hash`.
3. SQLite pasa de índice mínimo de recientes a **catálogo operacional único de desktop**.
4. Un watcher/reconciliador global mantiene filesystem, `.odessay/index.json` y SQLite alineados.
5. Desk y Workspace consultan el mismo contrato `DocumentCatalog`; solo difieren en filtro, agrupación y presentación.
6. Open Document registra primero un `BindingRoot`, reconcilia identidad y solo entonces abre el UUID resuelto.
7. IndexedDB deja de ser el catálogo de writings en desktop. Permanece como adapter del runtime web durante y después de la migración.
8. La existencia local y la existencia cloud son señales independientes, derivadas después de resolver la identidad.
9. Ninguna falla de apertura crea un draft como fallback.

## Clasificación arquitectónica

### Layer

- Dominante: `Application`
- Secundarias: `Domain` + `Adapter`

### Runtime scope

- Actual afectado: `desktop + web + cloud`
- Objetivo: `shared-core + desktop + cloud`; web mantiene su adapter IndexedDB

### Ownership

- Primary owner: `architecture-first`
- Frontend owns: Desk/Workspace como vistas del catálogo, estados y errores visibles
- Backend owns: contratos cloud de UUID, metadata y `content_hash`
- Database owns: schema cloud y migraciones necesarias para reconciliación por hash
- Desktop adapter owns: SQLite, manifests `.odessay`, watcher y filesystem

### Contracts touched

- `DocumentCatalog`
- `DocumentBindingStore`
- `WorkspaceReconciler`
- `DocumentService`
- `SyncService`
- `AuthService` como contexto cloud, nunca como scope de existencia local

### Boundaries

- Application puede depender de contratos y tipos de dominio.
- Desktop adapters pueden depender de Tauri, filesystem, SQLite y `.odessay/index.json`.
- Cloud adapters pueden depender de Supabase y red.
- UI no puede depender directamente de IndexedDB, SQLite, `.odessay/index.json`, Supabase ni rutas de filesystem.
- Domain no puede depender de runtime.

## Terminología

### Documento

Entidad de producto con un UUID estable. Puede tener o no materialización local y puede tener o no registro cloud.

### Binding

Relación durable entre un UUID y un archivo local concreto mediante:

- `binding_root_id`
- ruta relativa
- ruta absoluta derivada/cacheada
- inode
- `content_hash`

### BindingRoot

Carpeta vigilada por Odessay que contiene `.odessay/index.json`. Es infraestructura local, no una categoría de producto.

Existen dos clases operativas con el mismo contrato:

- **managed:** root privado administrado por Artifact Studio para drafts nuevos y materialización cloud-only; siempre existe y no aparece como Workspace;
- **external:** carpeta del usuario registrada con consentimiento. Al abrir un archivo suelto, `selectedPaths` incluye inicialmente solo ese archivo para no indexar todo `Documents`, `Downloads` u otra carpeta amplia.

### Workspace

Vista/organización de producto sobre documentos y BindingRoots. Un BindingRoot puede no exponerse como Workspace. Workspace no posee un pipeline documental diferente.

### Archivo desnudo / unbound file

Archivo `.md` presente en disco para el cual todavía no se resolvió un binding. No es aún `local-only`; primero debe reconciliarse o recibir un UUID.

### Catálogo operacional

Proyección SQLite consultable que reúne identidad, presencia local, presencia cloud, binding y metadata cacheada. No sustituye al `.md`, al ledger de binding ni a Supabase como autoridades de sus respectivos hechos.

## Autoridad por hecho

No existe una única base que sea autoridad de todos los campos. Cada hecho tiene un solo owner:

| Hecho | Autoridad | Copias/proyecciones permitidas |
|---|---|---|
| Contenido local materializado | `.md` | SQLite/IndexedDB/cloud pueden guardar derivados o copia sincronizada |
| Binding local dentro de un BindingRoot | `.odessay/index.json` | SQLite proyecta el binding para consulta |
| Catálogo operacional desktop | SQLite | Se reconstruye desde manifests, filesystem y nube |
| Metadata cloud (`slug/status/visibility/version`) | Supabase | SQLite cachea; web IndexedDB refleja |
| Existencia local | Filesystem observado por reconciliador | SQLite guarda `local_present` |
| Existencia cloud | Supabase para el UUID | SQLite guarda `cloud_present` por cuenta |
| Mutaciones desktop no sincronizadas | Cola SQLite durable | No se descartan al reconstruir vistas |
| Estado de pestañas | Store de sesión | Nunca prueba existencia documental |

### Precisión sobre reconstrucción

SQLite es reconstruible. `.odessay/index.json` no es una caché equivalente:

- su estructura puede regenerarse escaneando archivos;
- el UUID original de un documento local-only no puede recuperarse si no vive en el archivo ni en la nube;
- por ello el manifest es evidencia durable del binding local y debe escribirse atómicamente.

## Modelo de estados

La identidad se resuelve antes del estado.

```text
identityResolved = UUID conocido
localPresent     = archivo local confirmado
cloudPresent     = registro cloud confirmado para ese UUID/cuenta
```

| `localPresent` | `cloudPresent` | Estado derivado |
|---:|---:|---|
| sí | no | `local-only` |
| sí | sí, hashes alineados | `synced` |
| sí | sí, push pendiente | `pending` |
| sí | sí, divergencia no resoluble automáticamente | `conflict` |
| no | sí | `cloud-only` |
| no | no | binding huérfano; no es un documento abrible |

`unbound` es un estado de admisión de archivo, no un lifecycle persistido del documento.

## `.odessay/index.json` — ledger durable del binding

### Rol

El manifest viaja con la carpeta y conserva identidad independientemente de:

- sesión o logout
- scope `anonymous`
- almacenamiento del WebView
- pérdida o corrupción de SQLite
- reinstalación con la carpeta todavía disponible
- renombres y movimientos dentro del BindingRoot

No guarda metadata de Odessay ni contenido.

### Schema objetivo v2

```json
{
  "version": 2,
  "bindingRootId": "uuid-del-root",
  "selectedPaths": [],
  "files": {
    "Cartas/Carta.md": {
      "id": "uuid-del-documento",
      "inode": 12345678,
      "content_hash": "blake3:abcdef",
      "lastSeen": 1783640000000,
      "size": 4200
    }
  }
}
```

La ruta relativa es la clave primaria del manifest. `canonical_path` y filename se derivan de `rootPath + relativePath`; no se duplican dentro del JSON.

### Reglas de escritura

- escribir a un sibling temporal;
- hacer rename atómico sobre `index.json`;
- ignorar el evento generado por la propia app;
- no actualizar SQLite como confirmado hasta que el manifest haya quedado persistido;
- migrar `.odyssey/index.json` legacy antes de reconciliar;
- nunca escribir metadata de producto ni modificar frontmatter.

## SQLite — catálogo operacional único de desktop

### Rol

SQLite sirve todas las consultas desktop:

- Desk
- Workspace
- Search
- Recent
- editor/open
- status badges
- sync queue

Ninguna UI consulta manifests o IndexedDB directamente.

### Schema lógico mínimo

```text
binding_roots
  id TEXT PRIMARY KEY
  root_path TEXT UNIQUE NOT NULL
  manifest_version INTEGER NOT NULL
  visible_as_workspace INTEGER NOT NULL DEFAULT 0
  last_scanned_at INTEGER

documents
  id TEXT PRIMARY KEY
  local_present INTEGER NOT NULL DEFAULT 0
  cloud_present INTEGER NOT NULL DEFAULT 0
  cloud_account_id TEXT NULL
  sync_status TEXT NOT NULL
  title_cache TEXT NULL
  slug_cache TEXT NULL
  status_cache TEXT NULL
  artifact_type_cache TEXT NULL
  visibility_cache TEXT NULL
  version_cache INTEGER NULL
  created_at INTEGER
  modified_at INTEGER

document_bindings
  document_id TEXT PRIMARY KEY REFERENCES documents(id)
  binding_root_id TEXT NOT NULL REFERENCES binding_roots(id)
  relative_path TEXT NOT NULL
  canonical_path TEXT UNIQUE NOT NULL
  inode INTEGER
  content_hash TEXT
  size INTEGER
  last_seen_at INTEGER
  UNIQUE(binding_root_id, relative_path)

sync_mutations
  id TEXT PRIMARY KEY
  document_id TEXT NOT NULL REFERENCES documents(id)
  operation TEXT NOT NULL
  payload_json TEXT NOT NULL
  status TEXT NOT NULL
  attempt_count INTEGER NOT NULL
  next_retry_at INTEGER NULL
```

El schema físico puede variar, pero debe preservar UUID único, ruta única, cola durable y separación binding/metadata.

### Scope de autenticación

- el catálogo SQLite no se particiona por usuario;
- los archivos locales permanecen visibles sin sesión;
- `cloud_account_id` limita qué filas cloud-only se muestran para la sesión activa;
- logout no elimina ni oculta documentos con archivo local;
- auth controla capacidades cloud, no existencia local.

## IndexedDB

### Web

IndexedDB continúa como implementación de `DocumentCatalog` y sync queue del runtime web.

### Desktop

IndexedDB es transicional. La migración debe:

1. cosechar writings, bindings y mutaciones pendientes por todos los scopes conocidos;
2. deduplicar por UUID, ruta y hash;
3. persistir catálogo y cola en SQLite;
4. conservar IndexedDB en read-only compatibility durante una versión;
5. retirar lecturas/escrituras desktop después del gate de migración.

No se crea un nuevo scope desktop `anonymous` para documentos.

## `DocumentCatalog` compartido

Contrato conceptual:

```ts
type DocumentCatalog = {
  getById(id: string): Promise<DocumentCatalogRecord | null>
  resolvePath(path: string): Promise<PathResolution>
  list(query?: DocumentCatalogQuery): Promise<DocumentCatalogRecord[]>
  registerBinding(input: RegisterBindingInput): Promise<DocumentCatalogRecord>
  detachLocalFile(id: string): Promise<void>
  applyCloudSnapshot(snapshot: CloudDocumentSnapshot): Promise<void>
  subscribe(listener: (change: CatalogChange) => void): () => void
}
```

Implementaciones:

- web: IndexedDB
- desktop: SQLite

La UI depende del contrato, no de la implementación.

## `WorkspaceReconciler` global

### Ownership

El watcher detecta eventos. El reconciliador decide identidad y actualiza stores. El JSON no escucha por sí mismo.

```text
filesystem event
  → WorkspaceReconciler
  → leer snapshot anterior + manifest
  → resolver ruta/inode/hash
  → escribir manifest atómico
  → transacción SQLite
  → emitir CatalogChange
```

### Lifetime

Debe montarse a nivel de `DesktopAppShell`, no dentro de Desk o Workspace. Sigue activo en todas las rutas mientras la app desktop está abierta.

### Startup

```text
1. cargar BindingRoots registrados
2. migrar `.odyssey` → `.odessay`
3. escanear roots y leer manifests
4. reconciliar y reconstruir/proyectar SQLite
5. reanudar sync queue
6. hidratar cloud si hay sesión
7. emitir catálogo listo
```

El catálogo puede renderizar local en cuanto termina el paso 4; no espera red.

### Prioridad de reconciliación

1. misma ruta relativa en el mismo BindingRoot;
2. mismo inode dentro del root o movimiento correlacionado entre roots vigilados;
3. `content_hash` único en bindings locales conocidos;
4. `content_hash` único en nube;
5. si hay múltiples matches, estado `ambiguous` y decisión explícita;
6. solo sin matches se acuña un UUID nuevo.

Un save atómico conserva UUID por prioridad de ruta aunque cambien inode y hash.

## Apertura unificada

### Contrato

```ts
type OpenDocumentInput =
  | { kind: "id"; id: string }
  | { kind: "path"; path: string }

openDocument(input): Promise<OpenDocumentResult>
```

Ambas entradas convergen a UUID antes de hidratar el editor.

### Desk

```text
row UUID
  → DocumentCatalog.getById
  → OpenDocument(UUID)
```

### Workspace

```text
row UUID del mismo catálogo
  → OpenDocument(UUID)
```

Workspace no hace seed manual de IndexedDB ni usa otro DocumentService.

### Open Document

```text
file picker path
  → identificar BindingRoot
  → DocumentCatalog.resolvePath
  → reutilizar UUID o acuñar tras reconciliación
  → OpenDocument(UUID)
```

### Archivo fuera de un BindingRoot

El flujo pide confirmación para registrar la carpeta padre como BindingRoot. El mensaje debe explicar que Artifact Studio creará `.odessay/index.json` para conservar identidad y seguir movimientos.

- aceptar: registrar root, crear manifest con `selectedPaths` limitado inicialmente al archivo elegido, reconciliar y abrir;
- cancelar: no acuñar UUID, no crear record parcial y no abrir como documento editable;
- registrar un BindingRoot no lo convierte automáticamente en Workspace visible.

Un modo read-only efímero sin identidad queda fuera de alcance de este spec.

### Drafts nuevos y cloud-only

Artifact Studio mantiene un BindingRoot `managed` por defecto. Los drafts nuevos nacen allí y los documentos cloud-only se materializan allí salvo que el usuario elija explícitamente otro BindingRoot. La ubicación administrada usa el mismo manifest, catálogo y apertura que cualquier carpeta externa; no es una cuarta personalidad documental.

### Resultado según presencia

| Estado | Apertura |
|---|---|
| local-only | leer `.md` |
| synced/pending | leer `.md`; sync no bloquea |
| cloud-only | materializar `.md` dentro de un BindingRoot y abrir |
| conflict | abrir copia local con estado visible; no sobreescribir silenciosamente |
| binding huérfano | error recuperable; nunca crear draft |

## Guardado

Orden normativo desktop:

```text
1. escribir `.md` atómicamente
2. actualizar `.odessay/index.json` atómicamente
3. actualizar SQLite en transacción y encolar sync
4. emitir estado saved-local
5. sincronizar Supabase en background
```

Si el `.md` se confirmó, fallas posteriores no pueden reportar pérdida de contenido. Deben dejar trabajo de reconciliación/retry.

## Desk y Workspace como vistas

| Superficie | Query sobre `DocumentCatalog` | Diferencia permitida |
|---|---|---|
| Desk | todos los documentos accesibles | actividad, estado, colecciones, cloud-only |
| Workspace | mismos documentos filtrados/agrupados por Workspace o BindingRoot | jerarquía de carpetas y ubicación |
| Search | mismos documentos filtrados por índice textual | ranking |
| Recent | mismos documentos ordenados por `modified_at` | límite y recencia |

No se permite que una superficie descubra documentos mediante una fuente que las demás no proyectan al catálogo.

## Fallas y recuperación

| Falla | Estado permitido | Recuperación |
|---|---|---|
| watcher no inicia | catálogo existente visible como stale | reintentar; rescan al focus/startup |
| manifest corrupto | no acuñar UUIDs masivamente | restaurar backup temporal; intentar hash cloud; pedir intervención si local-only |
| escritura de manifest falla | `.md` preservado, binding pendiente | no confirmar transacción SQLite como final; retry |
| SQLite corrupto | UI entra en rebuilding | recrear desde manifests/filesystem/cloud; preservar cola antes de reemplazo cuando sea posible |
| Supabase offline | local funciona | mantener `local-only`/`pending`; retry |
| hash ambiguo | no elegir automáticamente | presentar candidatos o registrar decisión explícita |
| archivo borrado | `local_present=false` | no borrar cloud; conservar UUID |
| archivo movido fuera de roots | detach local | rebind futuro por hash/Open Document |
| logout durante apertura | local no cambia | cancelar solo operaciones cloud; no cambiar scope de catálogo |

## Observabilidad

Eventos mínimos estructurados:

- `catalog.rebuild.started/completed/failed`
- `binding.resolved` con estrategia `path|inode|local_hash|cloud_hash|minted`
- `binding.ambiguous`
- `binding.detached`
- `manifest.write.failed`
- `catalog.transaction.failed`
- `open.local|open.cloud_materialized|open.failed`

Nunca registrar contenido del documento, tokens ni rutas completas en telemetría remota. Las rutas pueden mostrarse solo en logs locales de diagnóstico con consentimiento.

## Migración por slices

### M1 — Contratos y SQLite v2

- introducir `DocumentCatalog` y `DocumentBindingStore`;
- crear schema SQLite nuevo sin eliminar stores existentes;
- adapter desktop dual-write detrás de feature flag;
- pruebas de unicidad UUID/ruta.

### M2 — Reconciliador global

- mover watcher a `DesktopAppShell`;
- migrar manifest a v2 con `bindingRootId`;
- proyectar manifests a SQLite;
- cubrir rename, move, delete, save atómico y roots no disponibles.

### M3 — Apertura única

- implementar `openDocument({id|path})`;
- migrar Desk, Workspace, sidebar, Search y Open Document;
- eliminar seed manual de IndexedDB desde Workspace;
- bloquear UUID nuevo antes de reconciliación.

### M4 — Catálogo único en UI

- Desk y Workspace consumen `DocumentCatalog`;
- estados local/cloud derivados del mismo record;
- pruebas de paridad: un documento aparece con el mismo UUID/estado desde ambas vistas.

### M5 — Migración de IndexedDB desktop

- cosechar todos los scopes;
- migrar writings, bindings y cola pendiente;
- read-only compatibility por una versión;
- retirar uso desktop de IndexedDB tras verificación.

### M6 — Cloud reconciliation y cleanup

- verificar `content_hash` cloud/backfill;
- materialización cloud-only;
- eliminar `writings_index` legacy y rutas alternativas;
- retirar feature flag y telemetría temporal.

## Gates de BUILD

1. Ningún slice mezcla UI con llamadas directas a SQLite/JSON/Tauri.
2. Migraciones son aditivas y reversibles hasta M6.
3. Cada slice preserva apertura/guardado offline.
4. El DMG de producción se valida; `tauri dev` no basta.
5. No se elimina IndexedDB desktop mientras existan mutaciones pendientes no cosechadas.
6. No se elimina `.odessay/index.json` ni se reclasifica como caché reconstruible de UUID local-only.
7. Performance Contract requerido para watcher fan-out, arranque y consultas del catálogo.
8. UX Contract requerido para confirmación de BindingRoot, estados rebuilding/ambiguous/conflict y paridad Desk/Workspace.

## Criterios de aceptación

### Identidad

- abrir el mismo archivo desde Desk, Workspace y Open Document produce el mismo UUID;
- rename y move conservan UUID;
- abrir dos veces la misma ruta no crea duplicados;
- hash ambiguo nunca elige silenciosamente;
- un documento local-only conserva UUID después de borrar y reconstruir SQLite.

### Catálogo

- Desk y Workspace reflejan el mismo conjunto base y los mismos estados;
- SQLite se reconstruye desde BindingRoots sin red;
- un archivo detectado por watcher aparece en ambas vistas sin visitar Workspace;
- logout no mueve documentos locales a otro scope ni los oculta.
- registrar un archivo externo no indexa automáticamente los demás archivos de su carpeta.

### Estados

- local-only, synced, cloud-only, pending y conflict se derivan de señales explícitas;
- archivo ausente no equivale a borrado cloud;
- cloud-only se materializa antes de edición;
- ningún `NOT_FOUND` crea un draft.

### Resiliencia

- manifest y `.md` se escriben atómicamente;
- corrupción SQLite inicia rebuild sin pérdida de UUID local-only;
- falla de red no bloquea open/save local;
- watcher global funciona desde Desk, Write y cualquier ruta desktop.

## Tests mínimos

- unit: prioridad path → inode → local hash → cloud hash → mint;
- unit: manifest v1/legacy `.odyssey` → v2;
- unit: constraints UUID/ruta y transacciones SQLite;
- integration: watcher event → manifest → SQLite → subscriber único;
- integration: Desk/Workspace/Open Document comparten UUID;
- integration: local-only sobrevive rebuild SQLite;
- integration: cloud-only materializa archivo y binding;
- integration: cloud-only usa el BindingRoot managed por defecto;
- integration: archivo externo registra `selectedPaths` solo para el archivo elegido;
- integration: cambio de auth no cambia catálogo local;
- E2E DMG: rename/move en Finder mientras app está en Desk;
- E2E DMG: Open Document fuera de root → confirmación → mismo documento en Desk/Workspace;
- E2E DMG: offline open/save/restart/sync posterior.

## No objetivos

- colaboración en tiempo real;
- merge automático de conflictos de contenido;
- metadata de Odessay dentro del `.md` o frontmatter;
- convertir todo BindingRoot en Workspace visible;
- usar SQLite como autoridad del contenido;
- mantener pipelines distintos por superficie.

## Invariantes finales

1. Un documento tiene un UUID estable en todos los runtimes.
2. Ningún archivo obtiene UUID nuevo antes de agotar reconciliación.
3. `.md` gobierna contenido local materializado.
4. `.odessay/index.json` gobierna el binding durable dentro de un BindingRoot.
5. SQLite es el único catálogo consultable por la aplicación desktop.
6. Supabase gobierna metadata y existencia cloud.
7. Desk y Workspace son vistas del mismo catálogo.
8. Open Document es otra entrada al mismo `OpenDocument`, no un importador paralelo.
9. Auth nunca decide si un archivo local existe.
10. Una falla de apertura nunca crea estado durable nuevo.
