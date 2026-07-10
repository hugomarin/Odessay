# ODESSAY — Fase 9 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 9 — Workspace: Filesystem y Nube**.
Si un punto no está cumplido, el catálogo documental desktop no se considera una capacidad estable del producto.

Fase 7.1 validó carpetas locales. Fase 9 elimina las tres personalidades documentales que aún sobreviven en desktop: Desk sobre IndexedDB, Workspace sobre `.odessay/index.json` y Open Document como importación directa por ruta. El resultado debe ser un solo catálogo y un solo caso de uso de apertura; las diferencias legítimas pasan a ser los estados `local-only`, `synced`, `pending`, `cloud-only` y `conflict`.

Referencias:

- `workflow/context/features/odessay-desktop-document-catalog.md` — contrato normativo de esta fase.
- `workflow/context/core/odessay-adr-identidad.md`
- `workflow/context/core/odessay-watched-folders.md`
- `workflow/context/features/odessay-workspace.md`
- `workflow/context/features/odessay-workspace-diagnostic.md`
- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-migration-diagnostic.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`
- `workflow/context/features/odessay-sync.md`
- `workflow/define/roadmap.md`

---

## 1) Cada hecho tiene una sola autoridad

- El `.md` materializado es la autoridad del contenido local.
- `.odessay/index.json` v2 es el ledger durable del binding local `ruta relativa ↔ UUID ↔ inode ↔ content_hash`; no guarda contenido ni metadata de producto.
- SQLite es el único catálogo operacional consultable por la aplicación desktop y contiene una cola de sync durable; no sustituye al `.md`, al manifest ni a Supabase.
- Supabase es la autoridad de metadata y existencia cloud y conserva una copia sincronizada del contenido.
- IndexedDB permanece como adapter de catálogo/sync en web, pero no como catálogo de writings en desktop después de la migración.
- El catálogo SQLite no se particiona por usuario. Logout o un fallo de sesión no oculta ni mueve documentos con archivo local.

## 2) BindingRoots, manifest y reconciliador global preservan identidad

- Existe un `BindingRoot managed` para drafts nuevos y materialización cloud-only y `BindingRoots external` para carpetas consentidas por el usuario; registrar un root no lo convierte automáticamente en Workspace visible.
- El manifest v2 contiene `bindingRootId`, `selectedPaths` y bindings por ruta relativa, y se escribe mediante temporal + rename atómico antes de confirmar la proyección SQLite.
- El watcher se monta a nivel de `DesktopAppShell`. Desk, Write y cualquier ruta desktop reciben reconciliación sin necesidad de visitar Workspace.
- La prioridad de resolución es ruta en el mismo root → inode/movimiento correlacionado → hash local único → hash cloud único → `ambiguous`; solo sin matches se acuña UUID.
- Rename, move y save atómico conservan UUID. Scope excluido, permisos perdidos o volumen desmontado no se interpretan como borrado.
- Un archivo abierto fuera de un root requiere confirmar el registro de su carpeta padre; al aceptar, `selectedPaths` incluye inicialmente solo el archivo elegido.

## 3) Existe una sola apertura documental

- `openDocument({ kind: "id", id })` y `openDocument({ kind: "path", path })` convergen a un UUID antes de hidratar el editor.
- Desk, Workspace, Search, Recent, sidebar y Open Document invocan el mismo caso de uso; ninguna superficie hace seed manual de IndexedDB ni usa otro `DocumentService`.
- Abrir el mismo archivo por cualquiera de las entradas produce el mismo UUID y no crea duplicados.
- Un documento `cloud-only` se materializa en un BindingRoot antes de editarse; listar o hidratar metadata no materializa por sí solo.
- `conflict`, `ambiguous`, binding huérfano y errores de filesystem producen resultados recuperables y visibles. Ningún `NOT_FOUND` ni fallo de apertura crea un draft como fallback.

## 4) Desk y Workspace son vistas del mismo catálogo

- Desk y Workspace consultan `DocumentCatalog`; Desk agrupa por actividad/estado y Workspace por carpeta/BindingRoot.
- El mismo documento conserva UUID, estado y metadata básica en ambas superficies.
- Un archivo detectado por watcher aparece en ambas vistas sin entrar primero a Workspace.
- `local-only`, `synced`, `pending`, `cloud-only`, `conflict`, `ambiguous`, `stale` y `rebuilding` tienen estados comprensibles, accesibles y no destructivos.
- Web no finge acceso al filesystem local y comunica el límite desktop cuando corresponde.

## 5) Guardado y sincronización son local-first y durables

- El orden desktop es: escribir `.md` atómicamente → escribir manifest atómicamente → transacción SQLite + enqueue → estado `saved-local` → sync cloud en background.
- Una escritura `.md` confirmada nunca se reporta como pérdida de contenido si falla manifest, SQLite o red; el trabajo posterior queda pendiente/reintentable.
- `content_hash` se calcula sobre el mismo Markdown canónico en Rust, TypeScript, manifest y payload cloud; fixtures compartidos prueban paridad.
- El schema/índice cloud de `content_hash` se valida contra la base viva y el backfill queda cerrado o explícitamente acotado; rebind por hash solo ocurre con un candidato elegible único.
- Borrar o perder un archivo local marca `local_present=false`; no borra metadata ni writing cloud. El borrado cloud sigue siendo una acción explícita separada.

## 6) Migración y retiro de compatibilidad no pierden estado

- El schema SQLite v2 entra de forma aditiva, con dual-write detrás de feature flag y rollback hasta completar el gate.
- La migración cosecha writings, bindings y mutaciones pendientes de todos los scopes IndexedDB conocidos; deduplica por UUID/ruta/hash y conserva la cola.
- IndexedDB desktop queda read-only durante una versión antes de retirar lecturas/escrituras.
- `.odyssey/index.json`, ids históricos de frontmatter, path-as-id y `writings_index` se migran o aíslan mediante caminos explícitos, auditables y recuperables; no se consultan como identidad en runtime normal al cierre.
- No se elimina un store legacy mientras pueda contener una mutación no cosechada o un UUID local-only no preservado en manifest/SQLite.

## 7) Resiliencia, observabilidad y performance son verificables

- SQLite se puede reconstruir desde manifests, filesystem y nube sin red para los documentos locales y sin perder UUIDs local-only.
- Corrupción de manifest no provoca acuñación masiva; falla de watcher muestra catálogo `stale` y reintenta/rescanea.
- Operaciones bulk de scan, migración, hidratación y watcher emiten una actualización lógica, no N refetches visibles.
- Se emiten eventos estructurados de rebuild, binding, manifest, transacción y apertura sin contenido, tokens ni rutas completas en telemetría remota.
- Hay evidencia de arranque, fan-out y consultas de catálogo dentro de los presupuestos definidos; el DMG/release desktop, no solo `tauri dev`, pasa los flujos críticos.

## 8) Evidencia de aceptación

- Matriz trazable desde cada bullet de este DoD a test automatizado, prueba manual reproducible o aceptación explícita del dueño.
- E2E DMG: rename/move en Finder mientras la app está en Desk; watcher reconcilia sin duplicar ni perder UUID.
- E2E DMG: Open Document fuera de root → confirmación → mismo UUID/estado en Desk y Workspace.
- E2E DMG: offline open/save/restart → contenido y binding sobreviven → sync posterior converge.
- E2E DMG: cloud-only se materializa en el root managed antes de editar; conflicto/hash ambiguo no se resuelve en silencio.
- Typecheck, lint, tests, Cargo tests, `validate-workflow-json`, performance/network gates aplicables y `ops:delivery:gate` verdes.
- El dueño acepta el outcome completo antes del cierre de fase.

## Gate de cierre de fase

Fase 9 se marca `Done` solo si los ocho bloques anteriores están evidenciados, no quedan issues bloqueantes abiertos en el proyecto Linear de Fase 9 y roadmap, DoD, spec de catálogo, docs de Workspace y código describen el mismo contrato operativo.
