# Relocate consciente recuperable a través del manifest (ODE-698) — diseño

- **Estado:** propuesta para el gate GD-698 (aprobación de Hugo antes de cualquier BUILD).
- **Base leída:** `origin/codex/ode-528-539-document-components` @ `96d1f105`, 2026-10-09. Las referencias `archivo:línea` son de ese commit salvo que se indique otra cosa.
- **Entradas, por precedencia:** descripción de ODE-698 (Decisiones de Hugo 2026-10-09 y Requisitos) → reanálisis `/private/tmp/claude-501/mut/ode693-reanalysis.md` (verificado aquí, no copiado: §2.4 lista sus correcciones) → código.
- **Etiquetas:** **[V]** verificado en el código o en el fuente de la dependencia con versión fijada en `src-tauri/Cargo.lock`; **[I]** inferencia; **[NV]** no verificado.
- **Dependencias:** ODE-693 reducido (nodo N693r: registro del relocate en vuelo, que se construye en paralelo) y ODE-697 (Source guarda Markdown directo; `createDraft` acepta `initialMarkdown`). Este diseño asume ambos mergeados.
- **Revisión 2 (2026-10-09):** corrige los bloqueantes del primer FAIL de #656. B1: carpetas de destino inexistentes (P2, `Validated`, fila 22). B2: el duplicado de la decisión 3 ya no tiene ganador automático (§2.7, fila 12, fila 9b y D-A).

---

## 1. Resumen de producto (5 líneas)

1. Save As, Move to workspace y el árbol mueven el `.md` de un documento sin cambiar su identidad. Hoy, si algo falla o la app se cae justo después de mover, el documento puede desaparecer de Desk o volver con una identidad nueva.
2. Con este diseño, la carpeta de destino queda registrada y su índice (`.odessay/index.json`) reserva la identidad del documento **antes** de que llegue el archivo, así que cualquier corte deja un estado que el escaneo normal de la app ya sabe reparar.
3. Si después de mover no se puede actualizar el catálogo, el archivo ya está en su sitio nuevo y la pestaña lo sigue. Aparece "Saved to the new location, but the app couldn't update its index. It will retry." y lo repara el siguiente guardado o el siguiente escaneo.
4. No se añade ningún almacén, bloqueo de guardado ni recuperación propia al arrancar. El texto no se pierde y nunca nace una segunda identidad.
5. Queda un límite aceptado: si la app cae entre copiar y borrar el original en un move entre discos, quedan dos copias iguales con la misma identidad. No se pierde nada y la app no elige entre ellas: el documento sigue donde estaba hasta que el usuario abre la otra copia con Open Document. §9 pide a Hugo decidir si además se avisa en Desk.

---

## 2. Representaciones y flujo de escritura

### 2.1 Runtimes

| Runtime | Relocate | Fuente |
|---|---|---|
| Desktop (Tauri, macOS) | Sí: el único runtime con `.md` canónico. | `lib/services/document-service-factory.ts:858-863` [V] |
| Web | No existe: el primitivo devuelve `unsupported` y el diseño no cambia web. | `document-service-factory.ts:863` [V] |

Todo lo que sigue es desktop.

### 2.2 Dónde vive "este UUID está en esta ruta"

| Representación | Rol (ADR D10 / spec) | Dueño de escritura | Fuente |
|---|---|---|---|
| `.md` en disco | Contenido. No guarda identidad: Rust ignora el `id` histórico del front-matter. | `write_file` / `relocate_file` (Rust) | `odessay-adr-identidad.md:54-56` (D4); test `workspace_sync_ignores_historical_frontmatter_identity`, `src-tauri/src/commands/workspace.rs:2075` [V] |
| `.odessay/index.json` (manifest v2) | Ledger durable `ruta relativa → {id, inode, content_hash}` + `bindingRootId` + `selectedPaths`. Clave = ruta relativa. | `workspace_sync`, `workspace_touch_file`, `workspace_repair_manifest_bindings` (Rust) | `workspace.rs:127-152`, `:738-958`, `:622-735`, `:493-559` [V] |
| SQLite `document_bindings` | Proyección operacional: PK `document_id`, `canonical_path UNIQUE`, `UNIQUE(binding_root_id, relative_path)`. | `catalog_dual_write`, `catalog_apply_reconcile` | `src-tauri/src/commands/index.rs:85-95`, `:631-719`, `:1241-1371` [V] |
| Settings `bindingRoots` | Qué raíces observa y escanea el reconciler. | `DesktopSettingsService.upsertBindingRoot` | `lib/services/desktop/desktop-settings-service.ts:559-570`; `desktop-workspace-reconciler.ts:209-214` [V] |
| Memoria de la pestaña | `currentCanonicalPathRef`, `lastSavePathRef` (Save to disk repetido) | `EditorShell`, `useTauriMenuEvents` | `components/editor/editor-shell.tsx:2223-2224`; `hooks/useTauriMenuEvents.ts:183-185, 208-210` [V] |
| Memoria del reconciler | `rootsById` (solo se recarga en `start()` y `rescanAll()`) | `createWorkspaceReconciler` | `lib/services/desktop/workspace-reconciler.ts:860-887` [V] |
| Baseline de guardado | `durableContentHashByWritingId` | `PersistenceCoordinator` | `lib/editor/persistence-coordinator.ts:254, 690-692` [V] |

**Consecuencia clave [V]:** en un escaneo, la identidad de un archivo la decide el manifest. `observedFilesFromSnapshot` toma `manifestId = file.id` (`lib/services/desktop/workspace-reconciler-ports.ts:59-70`), `resolveFile` le da prioridad absoluta (`workspace-reconciler.ts:337-339`) y un archivo sin entrada va a `unbound`. Ahí solo se correlaciona con detaches de **otras** raíces del mismo volumen (device+inode+hash), y si no correlaciona se acuña un UUID (`:434-497`, acuñado en `:465`). La evidencia de SQLite (ruta/inode/hash de `knownBindings`) no rescata un archivo sin entrada en el manifest de su raíz.

### 2.3 Flujo actual (Save As) en la rama de fase

Entrada: `menu:save-as` → `writeDocumentToDisk(true)` → diálogo → `onSaveToDisk(path, payload.content)` (`hooks/useTauriMenuEvents.ts:177-221`) → `handleSaveToDisk` (`editor-shell.tsx:2170-2227`) [V].

| # | Paso | Escribe | Si falla o se corta aquí | Fuente |
|---|---|---|---|---|
| 0a | Borrador sin materializar: `persistEditorSnapshot(editor, {title}, {awaitDurability:true})`. **El booleano se ignora.** | `.md` → manifest → SQLite (camino normal) | Sin `writingId`: `return false` sin aviso. | `editor-shell.tsx:2175-2185` [V] |
| 0b | Materializado: vacía las colas Rich/Markdown y hace un guardado durable. | Igual | Aviso `relocate-failed` y no mueve. | `:2193-2203` [V] |
| 1 | Si 0b no corrió: `tauriWriteFile(sourcePath, content)` **sin hash ni inode**. | `.md` de origen | `failed`. Si llegó a escribir, el hash del manifest y de SQLite queda desfasado. | `document-service-factory.ts:875-880`; `document.rs:162-172` rama `(None, None)` [V] |
| 2 | `tauriRelocateFile` → Rust `relocate_file`: crea las carpetas que falten hasta la carpeta padre del destino (`fs::create_dir_all`), elige un nombre libre y luego hace `fs::rename` (sobrescribe en POSIX; ventana TOCTOU). Entre volúmenes: copia a `.<name>.<uuid>.tmp`, verifica, `fs::rename` sobre el destino, borra el original y hace rollback si el borrado falla. | Carpetas que faltaban; mueve el archivo | Antes del move: `failed` con el original intacto. Las carpetas ya creadas se quedan. | `document-service-factory.ts:884`; `document.rs:635-666` (carpetas en `:641-646`), `:671-698, 718-766` [V] |
| 3 | Resuelve la raíz de destino leyendo settings. | Nada | **Ya es post-move:** `failed` con el archivo movido. | `document-service-factory.ts:889-911` [V] |
| 4 | `tauriWorkspaceSync(dest, selected, {[rel]: id})` con el wrapper por defecto, que **acuña** para cualquier otro archivo sin binding del alcance. Si la ruta tenía una entrada colgante con otro id, esa entrada gana al hint. | Manifest de destino | Post-move: `file.id !== id` lanza error → `failed`. | `:917-944`; `tauri-commands.ts:242-273`; `workspace.rs:867-919` [V] |
| 5 | `commitDualWrite` construido a mano. La mutación lleva `bodyText/bodyJson`, en contra de ODE-453 (`:305-310`, `:366-368`). | SQLite + cola | Post-move: `failed`. | `:946-1008` (cuerpo en `:990-991`) [V] |
| 6 | `tauriWorkspaceSync(sourceRoot)` best effort (también acuña). | Manifest de origen | Se ignora. | `:1010-1020` [V] |
| 7 | Raíz nueva: `upsertBindingRoot` + `await refreshWorkspaceReconcilerRoots()` **dentro del try**. Raíz existente con alcance nuevo: upsert. | Settings, watchers | Post-commit: si el refresh lanza, el resultado es `failed` aunque el move y el commit ya ocurrieron. | `:1022-1049`; `catch` en `:1050-1055` [V] |
| 8 | Shell: con `relocated` adopta título y ruta; con `failed` muestra el aviso y conserva la ruta vieja. | Estado de pestaña | — | `editor-shell.tsx:2211-2226` [V] |

Otros callers del mismo primitivo (el reanálisis listó tres; son cinco puntos de llamada) [V]:

| Caller | Contenido | Resultado visible hoy | Fuente |
|---|---|---|---|
| Save As (shell) | `content` solo si 0b no corrió | Banner `relocate-failed` | `editor-shell.tsx:2210` |
| Move to workspace / quitar de workspace (Desk, Collections, Shared reading) | Ninguno | Lanza error → `console.error` en Desk | `lib/services/desktop/workspace-service.ts:872, 915`; `app/(app)/desk/page.tsx:350-352, 367-369`; `components/collections/collections-view.tsx:148, 160`; `lib/services/shared-reading-service.ts:318` |
| Árbol: Duplicate | **Sí:** lee el `.md` de origen y lo pasa como `content` al draft nuevo | `console.error` | `components/editor/panels/workspace-tree-panel.tsx:433-447` |
| Árbol: Move to | Ninguno | `console.error` | `:450-460` |
| Árbol: New artifact here | Ninguno | Abre si `relocated` | `:487-498` |

### 2.4 Correcciones al reanálisis

| Afirmación del informe | Verificación |
|---|---|
| El relocate marca old/new/final como self-write en `tauri-commands.ts:159-160`. | Esas líneas son de `tauriRenameFile`. El relocate marca en `tauri-commands.ts:172-178`. El hecho es correcto, la cita no. [V] |
| Callers del primitivo: Save As, Move to workspace, árbol. | Son cinco puntos de llamada, y **Duplicate del árbol usa `content`** (`workspace-tree-panel.tsx:440-443`). Quitar `content` (requisito 5) obliga a materializar la copia antes por el camino canónico, con `initialMarkdown` de ODE-697. [V] |
| Resolver con el reconciler un manifest de destino con el UUID "en todos los casos". | Es correcto para el destino. Pero hay dos condiciones que el informe no nombra: (a) la proyección SQLite del destino falla con `UNIQUE(canonical_path)` si otra identidad quedó ligada a esa ruta en SQLite, y `catalog_apply_reconcile` aplica upserts **antes** que detaches (`index.rs:1274-1366`), así que el pase no converge; (b) un pase del reconciler en vuelo puede confirmar datos escaneados antes del move (§6, V-11). [V] |
| Decisión 3: las dos copias "se resuelven por ambigüedad u Open Document". | El reconciler no marca ambiguo un UUID que aparece en dos raíces: cada raíz lo resuelve por `manifestId` y gana el último commit del pase (`workspace-reconciler.ts:800-845`; upsert por `document_id`, `index.rs:1332-1339`) [V]. Eso es un ganador automático, y la decisión 3 lo excluye. El diseño añade la regla de duplicado (§2.7). D-A (§9) solo decide si el duplicado se muestra. |
| Open File ante un `.md` huérfano: "con toda probabilidad acuña" [NV]. | Acuña siempre: el wrapper por defecto acuña dentro de `readFileEvidence` antes de la escalera (§6, V-2). [V] |
| Paso 7 y refresh. | Además de "raíz no registrada", un fallo del refresh tras el commit devuelve hoy `failed` con el documento ya movido y proyectado (`document-service-factory.ts:1035-1038` dentro del `try` de `:864-1055`). [V] |

### 2.5 Flujo propuesto

Un solo dueño, `DesktopDocumentService.relocateWriting` (el método que crea N693r, registrado en `renamesInFlight`). `relocateDesktopWriting` y `getDesktopWritingCanonicalPath` delegan en el singleton. El parámetro `content` desaparece.

| # | Paso | Escribe | Si falla aquí | Si se corta aquí (caída) |
|---|---|---|---|---|
| P0 | **Caller.** Save As: 0a materializa con el título del diálogo y **comprueba el booleano**. 0b hace un guardado durable en el modo activo (Rich: `persistEditorSnapshot`; Source tras ODE-697: su `persistMarkdownSnapshot`) y comprueba el booleano. Duplicate: `createDesktopDraft({ title, initialMarkdown: content })` (ODE-697). Move/árbol: nada (los bytes ya son durables y N693r serializa los guardados). | `.md` → manifest → SQLite (camino normal) | `failed` (`relocate-failed` en el shell). No se mueve nada. | Nada nuevo |
| P1 | **Servicio.** Registra el relocate en `renamesInFlight` (N693r) y resuelve el binding efectivo de origen (`resolveBinding`, ver P6). Si `requestedPath` es la ruta canónica actual, termina con `relocated` sin efectos (Save to disk repetido). Resuelve la raíz de destino con la regla de hoy (raíz de settings más profunda; si no, Workspace; si no, `dirname` como raíz externa nueva) y **rechaza** un destino que sea o esté dentro de una raíz retirada en SQLite (`catalog.listRetiredBindingRoots()` por prefijo de ruta, D-B). Todo esto ocurre antes de que P2 cree ninguna carpeta. | Nada | `failed` antes del move | Nada |
| P2 | **Rust `relocate_prepare_destination(root, rel, expectedRootId?)`.** Primero asegura la carpeta padre del destino: si falta ella o algún ancestro, incluida la propia raíz, la crea con `fs::create_dir_all`, como hoy `relocate_file` (`document.rs:641-646`). Después garantiza que el manifest de destino existe con `bindingRootId`. Si falta: lo crea con id nuevo (o con `expectedRootId` si la raíz ya está en settings), `selectedPaths=[rel]` y sin entradas. Si existe: no lo modifica; si su id difiere de `expectedRootId`, error. No recorre la carpeta ni acuña ids de documento. | Carpetas que faltaban; cabecera del manifest de destino (solo si faltaba) | `failed`, también si no puede crear la carpeta (fila 22). Limpieza best effort del manifest si lo creó este flujo y sigue vacío. Las carpetas creadas no se borran (fila 22). | Residuo inocuo: carpetas vacías y `.odessay/index.json` vacío |
| P3 | **Settings antes del move** (requisito 2): raíz nueva → `upsertBindingRoot({id, rootPath, kind:"external", visibleAsWorkspace:false, selectedPaths:[rel], consentedAt})`; raíz existente cuyo alcance no cubre `rel` → upsert con `rel` añadido. Se comprueba de nuevo el retiro con el id devuelto por P2. | Settings | `failed` + limpieza best effort de P2 | Residuo inocuo: raíz con un `rel` aún inexistente |
| P4 | **Rust `relocate_document`** (§2.6): una sola llamada síncrona que reserva el destino, mueve sin sobrescribir, retira la entrada de origen y registra la evidencia. Antes de invocarlo, TS marca como self-write el origen, el destino pedido y el `.tmp` cuyo nombre fija el `relocationToken`; después marca la ruta final. | Manifest destino → archivo → manifest origen | Error antes de colocar el archivo: Rust deshace la reserva y el `.tmp` → `failed` + limpieza best effort de P2/P3 | Ver §2.6 (matriz de caídas) |
| P5 | **Ruta provisional.** El servicio guarda en memoria `relocationRoutes[UUID] = {canonicalPath, rootPath, relativePath, bindingRootId, inode, device, contentHash}` con lo que devuelve Rust. Desde aquí, el destino es la verdad del servicio. | Memoria | — | Se pierde (no hace falta: el manifest ya tiene el UUID) |
| P6 | **Proyección = el `persist` de siempre.** `persist(toWriting(record), destPath, "upsert", null, { writeContent: false })`, igual que el rename (`document-service-factory.ts:613`). Con la ruta activa: `persist` toma raíz y relativa de `resolveBinding` (no del binding de SQLite) y usa solo `workspace_touch_file` (la entrada existe porque se reservó). `needsReconcile` lanza error en vez de recorrer la raíz y acuñar (requisito 6, sin acuñado en los pasos del relocate). La mutación es solo metadata (ODE-453): `contentUnchanged` porque el hash no cambia. Si falla, se reintenta **una** vez. | Manifest (evidencia) → SQLite + cola en una transacción | Dos fallos → `relocated` + `indexPending: true`. La ruta queda **pendiente**: aviso de la decisión 2 y pase del reconciler pedido para origen y destino. | Igual que "caída entre move y SQLite": converge al arrancar |
| P7 | **Cierre.** Con éxito, se borra la ruta (SQLite ya es la verdad). En ambos casos: raíz nueva → `refreshWorkspaceReconcilerRoots()` (la observa, como hoy); raíces existentes → `notifyRootChanged(origen)` y `notifyRootChanged(destino)`. **Fire-and-forget:** el pase nunca cambia el resultado. Se libera el registro en vuelo en `finally` (N693r). | Settings/watchers | Se registra en log; el resultado no cambia | — |
| P8 | **Caller.** Con `relocated` (con o sin `indexPending`) adopta ruta y título. Con `failed`, el banner `relocate-failed` de hoy. El aviso de `indexPending` lo pinta **una sola superficie** en `DesktopAppShell`, que envuelve todas las rutas `(app)` en desktop (`app/(app)/layout.tsx:13-18`). | — | — | — |

**`resolveBinding(id)` [diseño]:** el binding efectivo es la ruta en memoria si existe, y si no, el binding de SQLite. Lo usan todos los métodos del servicio que hoy leen `catalog.getById(id)` para obtener una ruta: `saveWriting`, `persist` (re-target `:207-209`, rama "moved while in flight" `:232-275` y derivación de raíz/relativa `:276-282`), `persistFollowingRename` (`:456`), `openWriting`, `renameWriting`, `relocateWriting`, `deleteWriting`, `exportWriting`, `downloadWriting` y `getDesktopWritingCanonicalPath`. **Sin esto, el siguiente guardado durante `indexPending` re-apuntaría a la ruta vieja y la rama "moved while in flight" mandaría el `.md` de destino a `.trash`** (el hash coincide, así que se cumple la condición de retiro de `:255-271`) [V en el código, I en la secuencia]. Con baseline `null`, el guard de inode usa el inode de la ruta (en un move entre volúmenes cambia).

**Vida de la ruta pendiente:** nace en P5, se borra en P7 si la proyección funcionó, o cuando un `commitDualWrite` posterior del mismo UUID tiene éxito (el siguiente guardado), o cuando un `CatalogChange` muestra el binding en `canonicalPath` (lo reparó el pase). El servicio solo se suscribe al catálogo mientras haya rutas pendientes. **No sobrevive a un reinicio y no necesita hacerlo:** el manifest de destino tiene el UUID y la raíz está en settings, así que el pase completo de arranque proyecta el destino. Es el único estado nuevo y vive en memoria (decisión 1: sin almacén nuevo).

**Lectores que no cambian:** Desk/Workspace/Search (`lib/queries/*`), el flush de sync (`lib/sync/desktop-catalog-sync-service.ts:374-375, 479-480`), las pestañas y `useExternalDocumentChanges` (`:166-185`) siguen leyendo SQLite. Durante `indexPending` ven la ruta vieja (archivo ausente → `NOT_FOUND` o reintento recuperables) hasta la reparación. Para que reaparezca un `CatalogChange` del UUID en esa ventana hace falta que SQLite vuelva a escribir, y lo primero que escribe tras recuperarse es la reparación (ver §8, R-7).

### 2.6 Comandos Rust

#### `relocate_prepare_destination`

```rust
#[tauri::command]
pub fn relocate_prepare_destination(
    root_path: String,
    relative_path: String,
    expected_binding_root_id: Option<String>,
) -> Result<RelocationDestination, String>
// RelocationDestination { binding_root_id, selected_paths, manifest_created: bool }
```

Crea las carpetas que falten hasta la carpeta padre del destino (`create_dir_all`, idempotente) y escribe solo la cabecera de un manifest que no existía, por el mismo camino atómico (`write_workspace_index_atomic`, `workspace.rs:1005-1029`). Nunca toca entradas ni amplía o estrecha un manifest existente: el alcance se ajusta en la reserva de `relocate_document`, después de los chequeos de TS (retiro, settings).

**Carpetas que no existen (fila 22).** El caso más probable es quitar un documento de un Workspace cuando la carpeta gestionada no existe en disco (por ejemplo, porque se borró desde fuera): `ensureManagedRoot` solo escribe settings (`desktop-settings-service.ts:534-553`) y el destino sale de ahí (`workspace-service.ts:909-915`) [V]. También Move to workspace con la carpeta del Workspace borrada desde fuera (`:867-872`), y Move to o New artifact here del árbol sobre una carpeta borrada después de pintarse (`workspace-tree-panel.tsx:450-458, 487-495`) [V]. En Save As el diálogo elige una carpeta que existe [I]. Hoy `relocate_file` las crea y el resultado es `relocated`; el diseño mantiene ese resultado:

- **Crear falla** (permisos, un archivo con ese nombre en el camino, un volumen desmontado bajo `/Volumes`, que en esta máquina es `root:wheel 755` [V, 2026-10-09]): P2 devuelve `Err` → `failed` antes del move, sin reserva y sin settings (P3 no corre). Lo que `create_dir_all` alcanzó a crear se queda, como hoy.
- **Fallo o caída después de P2:** las carpetas creadas quedan vacías. Es un residuo inocuo (límite 5): el árbol de la app no las muestra, porque solo pinta carpetas que contienen documentos (`workspace-tree-panel.tsx:68-92`) [V]. La limpieza best effort no las borra, igual que hoy `relocate_file`: borrar carpetas del usuario no se puede deshacer, y la carpeta es la que se eligió como destino.
- **Carpeta borrada entre P2 y P4:** `relocate_document` la vuelve a crear en `Validated`, antes de la reserva. Si lo borrado es la raíz, su manifest desapareció con ella y `Validated` falla: `failed` con el origen intacto.
- **Falta la propia raíz registrada** (borrada desde fuera): P2 la re-crea y su manifest nace con el `bindingRootId` de settings (`expectedRootId`). Hasta entonces el reconciler la veía no observable (`workspace_sync` falla con "folder not found", `workspace.rs:744-748`; `scanRoot` devuelve `observed:null`, `workspace-reconciler-ports.ts:113-117`) [V]. El siguiente pase la ve observable y desliga, de forma recuperable, lo que tenía ligado y ya no existe.

#### `relocate_document`

```rust
#[tauri::command]
pub fn relocate_document(
    source_path: String,
    source_root: String,
    requested_path: String,
    destination_root: String,
    binding_root_id: String,
    document_id: String,
    relocation_token: String,
    new_root_scope: bool, // raíz nueva: el alcance del manifest queda en [rel], como hoy (document-service-factory.ts:918-919)
) -> Result<RelocatedDocument, String>
// RelocatedDocument { file: WorkspaceFileSnapshot, displaced_id: Option<String>,
//                     source_retired: bool, evidence_recorded: bool, cross_device: bool }

fn relocate_document_with_stages(
    /* mismos argumentos */,
    at_stage: &mut dyn FnMut(RelocateStage) -> Result<(), String>,
) -> Result<RelocatedDocument, String>
```

Patrón de hooks: el mismo de `write_file_with_stages` (`document.rs:106-121`). El comando de producción pasa `&mut |_| Ok(())`. Un `Err` del hook inyecta un fallo de E/S en esa etapa (corre el manejo de error normal, incluido el rollback). Un `panic!` del hook simula la muerte del proceso: el test lo captura con `std::panic::catch_unwind` y mira el disco. **Regla de construcción:** el rollback es código explícito, nunca un `Drop`, para que un panic modele fielmente una caída. La fuerza "entre volúmenes" se inyecta con un override de test, como `swap_test_volume` (`document.rs:515-555`).

| Etapa (`RelocateStage`) | Qué acaba de pasar |
|---|---|
| `Validated` | Origen existe; `source != requested` (si no, `Ok` no-op); el `bindingRootId` del manifest de destino coincide con `binding_root_id` (si no, error). Por último, la carpeta padre de `requested_path` existe: si se borró entre P2 y P4, la vuelve a crear con `create_dir_all`, como hoy `relocate_file` antes de mover (fila 22). |
| `Resolved` | Nombre libre elegido: no existe archivo y, si el manifest tiene una entrada en esa ruta, es colgante (archivo ausente) o del mismo UUID. Sufijo `Name 2.md`… como `resolve_collision_free_target` (`document.rs:671-698`). |
| `Reserved` | Manifest de destino escrito atómicamente con `rel → {id: UUID, inode: 0, content_hash: None}` (una entrada colgante con otro id se sobrescribe y su id sale en `displaced_id`), con el alcance ampliado si no cubría `rel` o fijado en `[rel]` si es raíz nueva. |
| `CopiedToTmp` | Solo entre volúmenes: copia en `<dir>/.odessay-relocate-<token>.tmp` verificada byte a byte (oculto: los escaneos lo ignoran, `workspace.rs:204-211`). |
| `Placed` | Archivo en la ruta final **sin sobrescribir**. Mismo volumen: `renamex_np(RENAME_EXCL)` en macOS / `renameat2(RENAME_NOREPLACE)` en Linux si el volumen declara `VOL_CAP_INT_RENAME_EXCL` (mismo gating que `RENAME_SWAP`, `document.rs:419-446, 509`; constantes en `libc` 0.2.186 [V]). Si no lo declara, `hard_link` + `remove_file` (el patrón `link_into_place`, `document.rs:260-278`). Entre volúmenes: `link_into_place(tmp, final)`. Si aparece un archivo en la ventana (`EEXIST`), se libera la reserva, se toma el siguiente sufijo y se vuelve a `Reserved` (con tope). |
| `SourceRemoved` | Entre volúmenes, y en el fallback `hard_link` del mismo volumen: original borrado. |
| `SourceRetired` | Entrada `rel_origen` retirada del manifest de origen si su id es el UUID. Si origen y destino son la misma raíz, va en la misma escritura que `EvidenceRecorded`. |
| `EvidenceRecorded` | Entrada de destino actualizada con inode/hash/size/mtime reales. |

Errores y rollback:

| Falla en | Rust hace | Devuelve | TS |
|---|---|---|---|
| `Validated`/`Resolved` o la escritura de la reserva | Nada (escritura atómica). Una carpeta re-creada en `Validated` se queda (fila 22) | `Err` | `failed` + limpieza best effort |
| Entre `Reserved` y `Placed` (copia, verificación, rename/link) | Borra el `.tmp` y libera la reserva (quita la entrada si sigue con el UUID; si había `displaced_id`, la restaura) | `Err` | `failed` |
| Borrado del original (entre volúmenes o fallback `hard_link`) | Borra el destino y, solo si lo consiguió, libera la reserva, como el rollback de hoy (`document.rs:756-763`). Si no puede borrar el destino, **conserva** la reserva: quedan dos copias con el mismo UUID (fila 12). Nunca deja un archivo de destino sin entrada, porque el siguiente pase lo acuñaría | `Err` ("two copies kept" si el rollback también falla) | `failed`: el origen sigue intacto. En el doble fallo queda además la copia de la fila 12 |
| `SourceRetired` / `EvidenceRecorded` | Nada: el move ya es irreversible. La entrada de origen colgante la poda el siguiente `workspace_sync`; la evidencia la completa `persist` (touch) o el escaneo. | `Ok` con `source_retired=false` / `evidence_recorded=false` | Sigue a P5 |

**Serialización [V/I]:** todos los comandos de la app son `pub fn` síncronos (`src-tauri/src/lib.rs:319-372`). tauri-macros 2.6.2 genera para ellos un cuerpo bloqueante que ejecuta la función inline (`src/command/wrapper.rs:249-252, 404-437`). Tauri 2.11.2 registra `ipc://` con `register_uri_scheme_protocol` (`src/manager/webview.rs:280-285`), cuyo handler llama a `webview.on_message` → `run_invoke_handler` sin cambiar de hilo (`src/ipc/protocol.rs:38-75`; `src/webview/mod.rs:1742, 1907-1909`). wry 0.55.1 invoca ese handler dentro de `start_task` (`src/wkwebview/class/url_scheme_handler.rs:42-43, 57, 322-326`) [V]. WebKit llama a `webView:startURLSchemeTask:` en el hilo principal [I: contrato de `WKURLSchemeHandler`; no se ejecutó ninguna prueba en vivo]. Por tanto `relocate_document` corre de principio a fin sin que ningún `workspace_sync`, `write_file` ni `catalog_*` se intercale. **Invariante del contrato:** el comando debe seguir siendo síncrono (sin `async` ni `#[tauri::command(async)]`, que lo mandaría al threadpool, `wrapper.rs:264`). La serialización no cubre una segunda instancia de la app [NV] (no hay plugin single-instance en `src-tauri/Cargo.toml`).

**Matriz de caídas por etapa** (proceso muerto, sin rollback; la convergencia la hace el pase completo de arranque, `workspace-reconciler.ts:860-866`, con la raíz de destino ya en settings por P3):

| Caída tras | Disco | Al arrancar | ¿Texto? | ¿Identidad? | Prueba |
|---|---|---|---|---|---|
| P2/P3 (antes de `relocate_document`) | Origen intacto; quizá carpetas vacías, un manifest vacío y una raíz sin archivo | Nada cambia | Sí | Única | T6 (TS), R18 |
| `Reserved` | Origen intacto; destino con entrada colgante | `workspace_sync(dest)` la poda (el manifest se reconstruye con lo escaneado, `workspace.rs:840-845, 936`); el origen sigue ligado | Sí | Única | R3 |
| `CopiedToTmp` | Como `Reserved` + `.tmp` oculto | Igual; el `.tmp` queda como residuo oculto | Sí | Única | R5 |
| `Placed` (mismo volumen, rename exclusivo) | Archivo solo en destino; ambos manifests nombran el UUID; el de origen apunta a un archivo ausente | Destino: `manifestId` → upsert. Origen: entrada podada; el detach se descarta porque el destino reclamó el id (`workspace-reconciler.ts:830-832`) | Sí | Única | R4 + T4 |
| `Placed` (entre volúmenes, o fallback `hard_link` del mismo volumen) | **Dos copias iguales**, ambos manifests con el UUID | Regla de duplicado (§2.7): el pase ve el UUID en dos archivos presentes, no mueve el binding y lo devuelve `ambiguous`. El binding sigue en el origen, porque el commit no llegó. Open Document sobre la copia de destino lo re-apunta | Sí (dos copias) | Mismo UUID, **duplicado** sin ganador (límite de la decisión 3; D-A decide si se muestra) | R6, T15 |
| `SourceRemoved` / `SourceRetired` | Como `Placed` mismo volumen | Igual | Sí | Única | R4/R7 |
| `EvidenceRecorded` / tras devolver y antes de SQLite | Archivo y manifests correctos; SQLite en origen | Igual; o la reparación en sesión | Sí | Única | T4 |

### 2.7 Regla de duplicado del reconciler (decisión 3)

**Hoy [V]:** ningún pase marca ambiguo un UUID que aparece en dos archivos.
- Cada raíz lo resuelve por `manifestId` (`workspace-reconciler.ts:337-339`).
- Los `knownBindings` de una raíz solo traen los bindings de esa raíz (`workspace-reconciler-ports.ts:126-135`).
- El commit de cada raíz hace upsert por `document_id` (`index.rs:1332-1339`).

Por eso gana el último commit del pase (orden de settings), y un pase parcial de una sola raíz mueve el binding hacia esa raíz: el binding salta de una copia a otra según qué raíz dispare el pase. Dentro de una misma raíz, un segundo archivo con un `manifestId` ya consumido cae a la escalera (`:337`) y puede acuñar.

**Regla del diseño:** un pase solo mueve el binding de un UUID por `manifestId` si confirma que la ruta ligada en SQLite ya no tiene el archivo.

1. **Ampliación.** Un `manifestId` que no está en los `knownBindings` de su raíz (SQLite lo liga a otra raíz) amplía el pase a todas las raíces activas, con el mismo mecanismo y el mismo tope de una ampliación por pase que ODE-661 (`workspace-reconciler.ts:756-773`). Así un pase parcial también ve la otra copia. En estado estable no ocurre: cada `manifestId` está ligado en su propia raíz. La ruta ligada se lee del catálogo por id, así que no depende de que el escaneo de su raíz haya devuelto sus `knownBindings`.
2. **Duplicado observado.** Si el pase ve el UUID en dos archivos presentes (en dos raíces, o en dos entradas del mismo manifest), no mueve el binding: descarta los upserts de ese UUID hacia cualquier ruta distinta de la ligada, no lo desliga y lo devuelve en `ambiguous`. Es la estrategia que ya existe (`:98-119`) y que hoy solo usa el empate de hash. Si una de las copias está en la ruta ligada, su evidencia (inode, hash) se actualiza como siempre. SQLite queda en la última ruta confirmada; en la ventana de la caída es el origen, porque el commit de P6 no llegó.
3. **Ruta ligada ausente.** Se aplica la regla de hoy: upsert en la ruta nueva, y el detach del origen se descarta (`:826-832`). Es el caso de la reparación de `indexPending` (T2) y de las filas 7 y 8.
4. **Ruta ligada no observable** (volumen desmontado o sin permisos): el pase no mueve el binding, porque no puede confirmar que esa copia ya no exista. Es la misma regla por la que nunca desliga nada de una raíz no observable (`:194-206`). Ver fila 9b.
5. **Resolución.** Open Document sobre una copia re-apunta el binding a esa copia (`open-document.ts:293-322` → `registerBinding`, `:198-241`) [V]. Es una acción explícita del usuario y no pasa por esta regla, igual que la proyección del propio relocate (P6). Los pases siguientes no lo devuelven a la otra copia (punto 2). Nada se borra. Si el usuario borra una de las copias, el siguiente pase converge por el punto 3.

Esta regla es la forma de cumplir la decisión 3, así que no es una opción: lo que antes era la opción (b) de D-A pasa a ser parte del diseño. D-A (§9) solo decide si el duplicado se muestra en la interfaz.

---

## 3. Contrato de comportamiento

### 3.1 Decisiones de Hugo (literales, ODE-698, 2026-10-09)

1. **Mecanismo:** se sustituyen los intents por la reserva en el manifest de destino y el registro previo de la raíz, con el reconciler como única recuperación. Los resultados de la opción A se mantienen: roll-forward, la pestaña adopta el destino, aviso no bloqueante y nunca una segunda identidad.
2. **Aviso:** "Saved to the new location, but the app couldn't update its index. It will retry." aparece en **todos** los callers del primitivo (Save As, Move to workspace, árbol).
3. **Límite aceptado:** una caída entre el swap y el borrado del original, en un move entre volúmenes, puede dejar dos copias idénticas con el mismo UUID. Se resuelven por ambigüedad u Open Document, no automáticamente.

### 3.2 Reglas vigentes que el diseño respeta

- Nunca perder texto; nunca guardar una versión alterada; cambiar de pestaña o navegar no interrumpe (reglas del dueño citadas en ODE-697).
- Un UUID nunca se trata como ruta. `NOT_FOUND`, binding huérfano, hash ambiguo o falla de filesystem son recuperables y nunca crean un draft (`AGENTS.md`, invariantes "Delegación entre servicios" y "Errores").
- Manifest antes que SQLite (`odessay-desktop-document-catalog.md:206-213`). "Si el `.md` se confirmó, fallas posteriores no pueden reportar pérdida de contenido. Deben dejar trabajo de reconciliación/retry" (`:473`).
- Solo un add/re-add explícito levanta el retiro de una raíz (`index.rs:835-850`).
- Requisito 4: sin intents, sin valla global, sin `saveWriting` UNAVAILABLE, sin almacén nuevo y sin bucle de reintentos.

### 3.3 Contrato del primitivo

```ts
type RelocateDesktopWritingResult =
  | { status: "relocated"; path: string; indexPending?: true } // el archivo ESTÁ en `path`
  | { status: "failed"; message: string }                     // el archivo sigue en el origen, intacto
  | { status: "unsupported" }                                  // web
```

- `failed` ⇒ nada se movió: el `.md` y sus bytes siguen en la ruta de origen. Si fallan a la vez el borrado del original y el rollback, queda además una copia en el destino con el mismo UUID (fila 12).
- `relocated` ⇒ el `.md` está en `path` y el manifest de destino lo nombra con el mismo UUID. `indexPending` ⇒ SQLite aún no lo proyecta, el servicio enruta al destino y el aviso de la decisión 2 está visible hasta la reparación.
- Ningún paso del relocate acuña ids de documento ni recorre una raíz entera. El pase del reconciler (`mintUnbound:false` en el escaneo, `workspace-reconciler-ports.ts:97-103`) es el único que acuña.

---

## 4. Matriz de salidas y fallos

"Hoy" = rama de fase. "Propuesto" = ODE-693 reducido + ODE-697 + este diseño. Las pruebas R* son `cargo test`, las T* son integración TS y las S* son del shell (§7).

| # | Fila | Hoy | Propuesto | ¿Texto? | ¿Identidad? | Prueba o límite |
|---|---|---|---|---|---|---|
| 1 | Guardado durante el move | CONFLICT y pestaña en error (baseline hash), o recreación de la ruta vieja (baseline `null`, `document.rs:207-212`) | El guardado espera al relocate antes de resolver la ruta (N693r) y después escribe vía `resolveBinding`. Dentro de `relocate_document` no se intercala ningún `write_file`. | Sí | Única | N693r: `tests/editor-shell-save-as-relocate.test.tsx` (COMP-65/67); T5 para la ruta pendiente |
| 2 | Fallo antes del move (P0–P3: guardado previo, carpeta retirada, prepare —incluida la carpeta de destino, fila 22—, settings) | 0a sin aviso; 0b con aviso | `failed` + `relocate-failed`; limpieza best effort de lo que creó el flujo | Sí (origen) | Única | S1, T6, T7 |
| 3 | Fallo del move (copia, verificación, rename/link) | `failed`; rollback de la copia | `failed`; Rust borra el `.tmp` y libera la reserva | Sí (origen) | Única | R9, R10 |
| 4 | Fallo de la reserva | No existe: hoy el manifest va después del move y su fallo es post-move | Es pre-move: `failed` con los manifests intactos (escritura atómica) | Sí (origen) | Única | R8 |
| 5 | Fallo de SQLite tras el move | `failed` post-move: pestaña en ruta vieja, guardados en CONFLICT | Un reintento; después `relocated` + `indexPending`, la pestaña adopta el destino, aviso, ruta pendiente; repara el siguiente guardado (touch + commit) o el pase pedido | Sí (destino) | Única | T1, T2, T12, T13, T14 |
| 5b | …causado por otro UUID aún ligado en SQLite a la ruta de destino (`canonical_path UNIQUE`, `index.rs:89`; test `index.rs:1976-1996`) | Post-move `failed` | `indexPending`; el pase lo repara porque `catalog_apply_reconcile` pasa a aplicar detaches antes que upserts | Sí | Única | R16, T1 (variante) |
| 6 | Caída entre reserva y move | — | Entrada colgante podada al arrancar; origen intacto | Sí | Única | R3, R5 |
| 7 | Caída entre move y retirada del origen | Raíz nueva: documento desaparecido (detach, `index.rs:1355-1365`) y Open File acuña. Otro volumen o hash distinto: acuña | El destino se proyecta por `manifestId` y el detach del origen se descarta | Sí | Única | R4, T4 |
| 8 | Caída entre move y SQLite | Igual que la fila 7 | Pase completo de arranque: upsert en destino, sin detach | Sí | Única | T3, T4 |
| 9 | Reinicio con la raíz de destino desmontada | — (la raíz ni estaba registrada) | Destino no observable (`observed:null`, sin cambios). Si el commit SQLite ya estaba hecho, el documento sigue ligado. Si no, el origen hace detach (`local_present=0`) hasta que vuelva el volumen y se proyecte por `manifestId` | Sí (en el volumen) | Única (temporalmente "no local") | Límite: un volumen ausente no es observable sin hardware; cubierto por la regla pura `observed:null` (`tests/services/workspace-reconciler.test.ts:152`) + T3 con la raíz de destino lanzando en el escaneo |
| 9b | Reinicio con la raíz de **origen** desmontada, con el commit pendiente (`indexPending`, o la caída de la fila 12) | — (si la raíz de destino era nueva, nadie la escanea) | §2.7, punto 4: el pase no puede confirmar que el origen ya no tenga el archivo y no mueve el binding. El documento sigue en el origen, como cualquier documento de una raíz no observable (catálogo `stale`, `workspace-reconciler.ts:847`), hasta que vuelva el volumen (entonces el punto 3, o el 2 si la copia sigue allí) o hasta que el usuario abra la copia de destino con Open Document | Sí (en el destino; con la fila 12, en las dos copias) | Única (con la fila 12, duplicado sin ganador) | T3 (variante: la raíz de origen lanza en el escaneo), T15 (4) |
| 10 | Colisión de nombre (existente, o aparece en la ventana) | Sufijo; `fs::rename` puede sobrescribir lo que aparece entre `:657` y `:658` | Sufijo; colocación exclusiva (`RENAME_EXCL` / `hard_link`); `EEXIST` → siguiente sufijo y nueva reserva; nunca sobrescribe | Sí (de ambos archivos) | Única | R12, R17 |
| 11 | Move entre volúmenes (`.tmp`) | El `.tmp` no se marca y despierta un pase que, si llega antes del paso 4, acuña → "different identity" [I] | Todo ocurre en un comando síncrono con la reserva antes: un pase posterior encuentra `manifestId`. El `.tmp` tiene nombre conocido por TS (`token`) y se marca antes | Sí | Única | R2, T9 |
| 12 | Caída entre swap y borrado del original (y fallback `hard_link` del mismo volumen), o fallo del borrado del original y del rollback a la vez | Dos archivos; el de destino acuña | Dos copias idénticas, con el mismo UUID en dos manifests. **Ningún pase elige** (§2.7): el binding sigue en la última ruta confirmada (el origen, porque el commit no llegó) y el UUID sale `ambiguous` del pase. Open Document sobre la otra copia la re-apunta por acción explícita. Nada se borra. Según D-A: (a) sin superficie nueva; (b) además, "Needs review" en Desk y Workspace mientras existan las dos copias | Sí (dos copias) | Mismo UUID, duplicado sin ganador; nunca un UUID nuevo | **Límite** (decisión 3): la ventana de una syscall no se puede cerrar. R6 y R10 (variante) documentan el estado; T15 prueba que ningún pase elige y que Open Document resuelve |
| 13 | Manifest de destino con entrada colgante | La entrada colgante gana al hint: el archivo adopta el UUID ajeno (`workspace.rs:882, 904`) | La reserva sobrescribe solo una entrada colgante (requisito 1.2) y devuelve `displaced_id`. Si SQLite aún liga el id desplazado a esa ruta, la fila 5b | Sí | Única | R12 (variante colgante), R16 |
| 14 | Cierre de pestaña o ventana durante el move | El cierre no espera al relocate | `settle` espera al guardado y el guardado al relocate (N693r). Una ventana cerrada durante el comando Rust no se procesa hasta que el comando termina (mismo hilo principal, [I]); una salida después = fila 8 | Sí | Única | N693r: COMP-68; T4 para la caída posterior |
| 15 | Edición tras Save As | Va a la ruta nueva | Igual; con `indexPending`, `resolveBinding` la lleva al destino y el commit repara SQLite | Sí | Única | Test existente "después del traslado, una edición pendiente y las siguientes se guardan en la ruta nueva" (`tests/editor-shell-save-as-relocate.test.tsx:237-238`); T1 |
| 16 | Save to disk repetido sobre la misma ruta (`lastSavePathRef`) | Rust hace no-op, pero se repiten los pasos 3–7 (escaneo y acuñado) | No-op en P1: ningún IPC de escritura | Sí | Única | T8 |
| 17 | Destino en una carpeta quitada de la app (raíz retirada) o dentro de ella | Post-move `failed`: `apply_dual_write` rechaza la raíz retirada (`index.rs:673-675`); al reiniciar, detach | `failed` antes del move (D-B) | Sí (origen) | Única | T7 |
| 18 | Fallo al retirar la entrada de origen | — | No fatal: `Ok(source_retired=false)`; la poda el siguiente `workspace_sync` del origen | Sí | Única | R11 |
| 19 | Pase del reconciler en vuelo durante el relocate (escaneó antes del move, confirma después) | Puede volver a ligar el UUID a la ruta vieja (sin guarda de concurrencia en `catalog_apply_reconcile`); los guardados fallan hasta otro pase | Pases serializados en el orquestador + pase pedido en P7: el pase pedido corre después del obsoleto y lo corrige | Sí | Única | T10 |
| 20 | Duplicate del árbol | Escribe `content` sin guarda en el draft y lo mueve | Draft con `initialMarkdown` (bytes exactos, camino canónico) y move sin `content` | Sí (copia exacta) | Una identidad nueva para la copia, por diseño | T11 |
| 21 | Refresh/pase falla tras un relocate correcto | `failed` aunque todo se movió y proyectó (`:1035-1038`) | Fire-and-forget: el resultado sigue `relocated` | Sí | Única | T6 (variante: refresh lanza) |
| 22 | Carpeta de destino inexistente: quitar de un Workspace sin la carpeta gestionada en disco, Move to workspace con su carpeta borrada, Move to o New artifact here del árbol sobre una carpeta borrada (§2.6, "Carpetas que no existen") | `relocate_file` crea las carpetas que falten antes de mover (`document.rs:641-646`) → `relocated`. Si no puede, `failed` con el original intacto. Si el move falla después, las carpetas quedan vacías | P2 las crea antes del manifest y de la reserva, y `Validated` las re-asegura → `relocated`, como hoy. Si no puede crearlas (permisos, un archivo en el camino, volumen desmontado bajo `/Volumes`) → `failed` antes del move, sin reserva ni settings. Tras un fallo o una caída posteriores, las carpetas quedan vacías (límite 5): el árbol no las muestra y la limpieza no las borra. Una raíz registrada que faltaba vuelve a ser observable | Sí (origen; destino si se movió) | Única | R18, R19, R20, T16 |

**Límites declarados:**

1. Fila 12: duplicado con el mismo UUID si la app cae en la ventana swap→delete (entre volúmenes) o link→unlink (fallback del mismo volumen sin rename exclusivo), o si fallan a la vez el borrado del original y el rollback. Ningún pase elige entre las copias (§2.7). D-A decide si se muestra.
2. Ventana de pérdida por caída del editor (debounce), común a todo guardado. No es de este issue.
3. Fila 9: el estado "no local" mientras el volumen de destino está desmontado y el commit no llegó a hacerse. Fila 9b: el documento sigue en el origen no observable hasta que vuelva su volumen o se abra la copia de destino.
4. Escrituras al destino con el volumen ausente o SQLite caído: la pestaña queda en error y la salida es de ODE-692 (sin UI propia de ODE-698).
5. Residuos inocuos tras una caída: carpetas vacías creadas para el destino (también tras un fallo posterior a P2, como hoy con `relocate_file`), manifest vacío, raíz en settings sin archivo, `.tmp` oculto.

---

## 5. Funciones y archivos a tocar, y lo que NO se toca

### 5.1 A tocar

| Archivo | Cambio | Owner que se preserva |
|---|---|---|
| `src-tauri/src/commands/document.rs` | `relocate_document` + `relocate_document_with_stages` + `RelocateStage`; carpeta padre re-asegurada en `Validated`; colocación exclusiva (`RENAME_EXCL`/`RENAME_NOREPLACE` con gating de capacidad, fallback `hard_link`); `.tmp` con `relocation_token`; el rollback solo libera la reserva si borró el destino. Se retira `relocate_file` (su único caller es `tauriRelocateFile`); su creación de carpetas pasa a P2 y a `Validated`. | Movimiento de archivos |
| `src-tauri/src/commands/workspace.rs` | `relocate_prepare_destination` (crea las carpetas que falten y la cabecera); helpers `pub(crate)` de una sola entrada: reservar, liberar, retirar, registrar evidencia (sobre `read_workspace_index` y `write_workspace_index_atomic`). | Manifest |
| `src-tauri/src/commands/index.rs` | `catalog_apply_reconcile`: detaches antes que upserts (el conjunto es disjunto por raíz). | Proyección SQLite |
| `src-tauri/src/lib.rs` | Registrar los dos comandos y quitar `relocate_file`. | — |
| `lib/services/desktop/tauri-commands.ts` | `tauriRelocatePrepareDestination`, `tauriRelocateDocument` (marca origen, pedido y `.tmp` antes; final después); quitar `tauriRelocateFile`. | Wrappers IPC |
| `lib/services/document-service-factory.ts` | `relocateWriting` (sobre el método de N693r) con P1–P7; `relocationRoutes` + `resolveBinding` usados por todos los métodos del servicio; `persist` toma raíz y relativa del binding efectivo y es touch-only con ruta activa; resultado con `indexPending`; sin `content`; `relocateDesktopWriting` y `getDesktopWritingCanonicalPath` delegan en el singleton; suscripción para el aviso; actualizar el comentario `:845-857`. | `DesktopDocumentService` (único dueño de la proyección) |
| `lib/services/desktop/workspace-reconciler.ts` | Un solo pase a la vez: `flushBurst` y `rescanAll` esperan al pase en curso (`:850-887`). Regla de duplicado (§2.7): ampliación por un `manifestId` ligado a otra raíz; ni upsert hacia otra ruta ni detach para un UUID visto en dos archivos; `ambiguous` en vez de la escalera para un `manifestId` repetido en la misma raíz; sin move hacia una ruta nueva mientras la ruta ligada no se confirme ausente. | Reconciler |
| `lib/services/desktop/workspace-reconciler-ports.ts` | Lectura por id de la ruta ligada de un `manifestId` ajeno (§2.7, punto 1). | Glue de puertos del reconciler |
| Solo con D-A (b): `lib/queries/document-catalog.ts`, sus fuentes (`lib/queries/workspace-catalog-source.ts`, Desk) y `components/ui/document-state-badge.tsx` | Las vistas reciben los UUID `ambiguous` del reconciler por `signalsById`; texto propio para "dos copias de este artefacto". | Vistas del catálogo |
| `lib/services/desktop/desktop-workspace-reconciler.ts` | Helper `notifyWorkspaceRootsChanged(rootIds)` sobre `ensureWorkspaceReconciler()`. | Wiring del reconciler |
| `lib/services/desktop/desktop-settings-service.ts` | `removeBindingRoot(id)` para la limpieza best effort (hermano de `upsertBindingRoot`). | Settings |
| `components/navigation/desktop-app-shell.tsx` + `components/navigation/relocation-index-notice.tsx` (nuevo) | Única superficie del aviso de la decisión 2, alimentada por la suscripción del servicio. Aparece con `indexPending` y desaparece al repararse. | UI de shell de app |
| `components/editor/editor-shell.tsx` | `handleSaveToDisk`: comprobar el booleano de 0a; guardado previo según el modo (con ODE-697); sin `content`; adoptar `relocated` aunque traiga `indexPending`. Solo cablea. | `EditorShell` sin ownership nuevo |
| `components/editor/panels/workspace-tree-panel.tsx` | Duplicate: `createDesktopDraft({ title, initialMarkdown })` y relocate sin `content`. | — |
| Tests y dobles | Ver §7. `tests/integration/documents/support/real-desktop-doubles.ts`: dobles fieles de los dos comandos (incluida la creación de carpetas), con etapas, retenciones y fallos por etapa; se quita el de `relocate_file`. | — |
| Docs | ADR D7 (enmienda), spec del catálogo (§Guardado, §Fallas, §Reglas de escritura del manifest), capability map. | — |

### 5.2 NO se toca

- Intents, valla global, `UNAVAILABLE` en `saveWriting`, recuperación propia al arrancar y bucle de reintentos (descartados de #653).
- La escalera de identidad (salvo el paso 0 ante un `manifestId` repetido en la misma raíz, §2.7), `correlateAcrossRoots` y WATCH-04: el move externo entre raíces sigue con device+inode+hash. Este diseño solo hace que el move consciente no dependa de esa heurística.
- `write_file` y las guardas WATCH-07 / ODE-635.
- El registro en vuelo de N693r (`renamesInFlight`): se consume tal cual.
- `relocateDesktopWritingByCanonicalPath` (move observado por el watcher).
- El opener (`lib/services/open-document*.ts`): su acuñado previo a la escalera es un hallazgo lateral (§6, V-2), no de este issue.
- Lectores externos de SQLite (§2.5): ven la ruta vieja de forma recuperable durante `indexPending`.
- La regla de resolución de raíz de destino (paso 3 de hoy) y el alcance de una raíz nueva (`[rel]`, como hoy y como Open File, `open-document-desktop.ts:152`).
- `hooks/useTauriMenuEvents.ts`: sigue pasando `payload.content`, y el shell lo ignora.

---

## 6. Verificaciones abiertas del reanálisis

| Id | Pregunta | Resultado |
|---|---|---|
| V-1 | ¿Los comandos Tauri síncronos se serializan frente a `workspace_sync`? | **Sí, entre comandos completos** [V hasta wry; I en el hilo de WebKit]: §2.6, "Serialización". Dos IPC sucesivos desde JS sí admiten intercalado. Por eso reserva, move y retirada van en **un** comando, y la raíz se registra antes en otro paso, que es inocuo si se corta. |
| V-2 | ¿Open File acuña ante un `.md` huérfano? | **Sí, siempre** [V]. `readFileEvidence` llama al wrapper por defecto (`open-document-desktop.ts:194`), que acuña para cada ruta sin entrada (`tauri-commands.ts:262-272`). Lo mismo `registerExternalRoot` (`:152`) y el puente de Workspace (`:126`). Luego `reconcileSingleFile` recibe ese id recién acuñado como `manifestId` y lo devuelve en el paso 0 (`open-document.ts:298-315`; `workspace-reconciler.ts:337-339`), sin llegar a inode ni hash. Con la reserva, un relocate consciente no produce huérfanos: Open File encuentra el UUID en el manifest. **Hallazgo lateral** (fuera de alcance): para huérfanos externos, el opener acuña antes de agotar la escalera, en contra del invariante "Apertura" de `AGENTS.md`. Se deja para un follow-up; no se crea issue. |
| V-3 | ¿Cuándo llega un baseline `null` a un guardado durante Save As? | [V] `expectedContentHash` sale del mapa del coordinador (`persistence-coordinator.ts:690-692`). Lo siembra la primera lectura del catálogo con `binding.contentHash` (`hooks/useExternalDocumentChanges.ts:196-203`) o el resultado de cada commit (`:598`, `:707`). Es `null` cuando: (a) el binding de SQLite no tiene `content_hash` (filas heredadas o migradas); (b) un guardado corre antes de esa primera lectura; (c) el documento no tiene binding al sembrar. Tras 0a/0b el baseline es el hash del propio guardado durable, no `null`. Con `null`, el guard es el inode del binding (`document-service-factory.ts:213`): por eso la ruta pendiente lleva el inode de destino (cambia entre volúmenes). Con N693r el guardado ya no corre contra el origen durante el move. |
| V-4 | ¿Carrera del `.tmp` entre volúmenes? | [V] El `.tmp` (`document.rs:727-730`) no se marca (`tauri-commands.ts:172-178`), y un evento con algún path sin marcar despierta el pase (`tauri-fs-watch.ts:151-158`; `desktop-workspace-reconciler.ts:140-143`, debounce 300 ms + coalesce 250 ms, `:145`, `workspace-reconciler.ts:598`). Hoy, con la raíz de destino registrada, ese pase puede caer entre el move y el paso 4 (IPC distintos), acuñar (`:465`) y hacer fallar el paso 4 [I, no reproducido]. Con el diseño se cierra por construcción: reserva antes del archivo + un solo comando. El marcado previo del `.tmp` con `token` evita además el pase redundante. |
| V-5 | Diseño de `relocate_document` con hooks y matriz de caídas | §2.6. |
| V-6 | `relocateDesktopWritingByCanonicalPath` solo escanea el origen | Confirmado (`document-service-factory.ts:1068-1083`) [V]. El diseño no lo usa. |
| V-7 | Paso 5 con cuerpo en la mutación | Confirmado (`:990-991` frente a `:305-310`) [V]. Resuelto al proyectar con `persist(writeContent:false)`. |
| V-8 | Carpeta retirada como destino | Hoy falla después del move [V en las piezas]. Ver D-B. |
| V-9 | Ruta reutilizada por otra identidad en SQLite | `UNIQUE(canonical_path)` + upserts antes que detaches = el pase no converge [V en el código, I en la secuencia]. Se corrige con el orden detaches → upserts (R16). |
| V-10 | Duplicado con el mismo UUID | Hoy no se marca ambiguo: gana el último commit del pase, y un pase parcial lo mueve hacia su raíz [V]. El diseño lo resuelve con la regla de duplicado (§2.7): ningún pase elige. D-A solo decide si se muestra. |
| V-11 | Pases concurrentes | `flushBurst`/`rescanAll` no esperan a un pase en curso (`workspace-reconciler.ts:850-887`) [V]. Un pase que escaneó antes del move puede confirmar después [I]. Se serializan los pases (T10). |
| V-12 | Guardado previo tras ODE-697 | En modo Source, `persistEditorSnapshot(editor)` serializaría el Rich oculto y pisaría los bytes exactos de Source [I, depende de ODE-697]. El paso previo debe usar el persist del modo activo. Punto de coordinación con D697. |

---

## 7. Plan de pruebas y mutaciones

### 7.1 Rust (`cargo test`, carpetas temporales, en el módulo de tests de `document.rs` y `index.rs`)

| Id | Caso |
|---|---|
| R1 | Mismo volumen: archivo en destino con el mismo inode; manifest de destino con UUID y evidencia; entrada de origen retirada. |
| R2 | Entre volúmenes (forzado): `.tmp` con el nombre del token, verificado y eliminado; original borrado; evidencia del destino. |
| R3 | Caída en `Reserved` (panic): origen intacto; después `workspace_sync(dest)` poda la entrada y `workspace_sync(origen)` conserva el UUID. |
| R4 | Caída en `Placed` (mismo volumen): `workspace_sync` de ambos → solo el destino nombra el UUID. |
| R5 | Caída en `CopiedToTmp`: los escaneos ignoran el `.tmp`; la entrada colgante se poda. |
| R6 | Caída en `Placed` entre volúmenes: dos copias byte a byte iguales y dos manifests con el UUID. Documenta el límite. |
| R7 | Caída en `SourceRetired`: evidencia ausente; `workspace_sync(dest)` la completa con el mismo UUID. |
| R8 | Fallo inyectado en la escritura de la reserva: `Err` y ambos manifests byte a byte iguales a antes. |
| R9 | Fallo inyectado en la colocación: reserva liberada (y entrada desplazada restaurada) y archivo en origen. |
| R10 | Fallo inyectado al borrar el original (entre volúmenes): destino borrado, reserva liberada, `Err`. Variante: también falla el borrado del destino → la reserva se conserva, quedan dos copias con el UUID (fila 12) y `Err` "two copies kept". |
| R11 | Fallo inyectado al retirar el origen: `Ok(source_retired=false)`; el siguiente `workspace_sync(origen)` poda. |
| R12 | Colisiones: archivo existente → sufijo; entrada colgante de otro id → se sobrescribe con `displaced_id`; un archivo que aparece en `Reserved` (hook) → `EEXIST` → siguiente sufijo, sin sobrescribir al intruso. |
| R13 | No-op: origen == pedido → `Ok`, sin escrituras. |
| R14 | `bindingRootId` del manifest distinto del esperado → `Err` antes de escribir. |
| R15 | `relocate_prepare_destination`: crea con `[rel]` y id nuevo; no modifica uno existente; error si el id esperado no coincide. |
| R16 | `catalog_apply_reconcile` con detach de X y upsert del UUID en la `canonical_path` de X en la misma entrada → `applied`. Hoy falla con UNIQUE. |
| R17 | Volumen sin `RENAME_EXCL` (override de test): el fallback `hard_link` nunca sobrescribe. |
| R18 | Carpeta de destino y raíz inexistentes: `relocate_prepare_destination` las crea y escribe la cabecera con `expectedRootId`; `relocate_document` mueve a esa carpeta con el mismo UUID. Si el flujo se corta tras P2, `workspace_sync` del destino no encuentra entradas y el origen sigue ligado. |
| R19 | Un archivo regular ocupa el nombre de una carpeta del camino: `relocate_prepare_destination` devuelve `Err`, no escribe manifest y el origen sigue intacto. Variante: el obstáculo aparece antes de `relocate_document` → `Err` en `Validated`, sin reserva, con los manifests byte a byte iguales. |
| R20 | Se borra la subcarpeta de destino entre `relocate_prepare_destination` y `relocate_document`: `Validated` la vuelve a crear y el move termina. Variante: se borra la raíz con su manifest → `Err` en `Validated` y el origen sigue intacto. |

### 7.2 Integración TS (`tests/integration/documents/`)

Servicio real, `SqliteDocumentCatalog` real sobre los dobles de IPC, reconciler real (`createWorkspaceReconciler` + `createWorkspaceReconcilerPorts`) y `DesktopSettingsService` real. Los dobles de los dos comandos reproducen el contrato de etapas de Rust con la forma de llamada completa: retención y fallo por etapa. Solo se dobla el transporte nativo (`workflow/quality/capability-proof-contract.md`).

| Id | Caso |
|---|---|
| T1 | Save As con dos fallos de `catalog_dual_write` → `relocated` + `indexPending`; la pestaña adopta el destino; aviso visible; una edición llega al `.md` de destino (bytes); el commit repara; el aviso desaparece; una sola fila de catálogo. Variante 5b: un id X ligado en SQLite a la ruta de destino. |
| T2 | `indexPending` reparado por el pase pedido, sin guardar. |
| T3 | Reinicio tras `indexPending`: servicio nuevo (la ruta se pierde) + `reconciler.start()` → SQLite liga el destino por `manifestId`; mismo UUID; reabrir muestra los bytes movidos. Variante fila 9: la raíz de destino lanza en el escaneo. Variante fila 9b: la raíz de origen lanza en el escaneo → el binding no se mueve; cuando vuelve con el archivo ausente → destino. |
| T4 | Caída simulada entre `relocate_document` y SQLite (el doble mueve y la orquestación se corta) → arranque → converge. |
| T5 | Guardado durante `indexPending`: no re-apunta al origen, no manda el destino a `.trash` y, con baseline `null` entre volúmenes, usa el inode de destino. |
| T6 | Raíz nueva registrada antes del move: en la retención `Reserved` del doble, settings ya la contiene con `[rel]`. Un fallo antes del move la quita junto con el manifest creado; las carpetas que creó P2 se quedan. Variante: el refresh lanza tras un relocate correcto y el resultado sigue `relocated`. |
| T7 | Destino en una raíz retirada → `failed` antes del move; archivo intacto; nada creado. |
| T8 | Save to disk sobre la ruta actual → no-op sin IPC de escritura. |
| T9 | El evento del watcher sobre `.odessay-relocate-<token>.tmp` queda suprimido (`isOdessaySelfWriteEvent`). |
| T10 | Pase retenido entre escaneo y commit + relocate completo + liberación → binding final en destino. |
| T11 | Duplicate del árbol con `initialMarkdown`: bytes exactos en la copia, UUID nuevo, origen intacto. |
| T12 | `assignToWorkspace` con `indexPending`: no lanza, limpia la asignación y el servicio publica la ruta pendiente que alimenta el aviso. |
| T13 | Move to del árbol con `indexPending`: la misma publicación (un solo dueño del aviso para todos los callers). |
| T14 | `RelocationIndexNotice` montado en `DesktopAppShell`: muestra el texto literal de la decisión 2 con al menos una ruta pendiente y desaparece cuando se limpia. |
| T15 | Duplicado de la fila 12 con el reconciler real y dos raíces. (1) Pase completo con el UUID en dos archivos presentes → binding sin cambios (origen), sin detach y con el UUID en `ambiguous`; mismo resultado con las raíces en el orden inverso de settings. (2) Pase parcial disparado solo por la raíz de destino → se amplía y da lo mismo. (3) Dos entradas con el UUID en un mismo manifest (repetir el Save As a la misma carpeta) → ninguna acuña. (4) Raíz de origen no observable → el binding no se mueve. (5) Open Document sobre la copia de destino → binding en destino; el pase siguiente no lo devuelve. (6) Se borra una copia → el pase siguiente converge a la otra. Con D-A (b), además, la fila de Desk muestra "Needs review". |
| T16 | Quitar de un Workspace con la carpeta gestionada ausente en disco → `relocated`; la carpeta existe y su manifest nace con el id de la raíz gestionada de settings. |

### 7.3 Shell (`tests/editor-shell-save-as-relocate.test.tsx`, rescatado de #653 y reescrito sin intents)

| Id | Caso |
|---|---|
| S1 | 0a falla → `relocate-failed` y no se invoca ningún comando de relocate. |
| S2 | Source (tras ODE-697): el `.md` de destino tiene los bytes exactos del textarea. |
| S3 | Tests de "paso 4/5 falla" y "reabrir" reescritos: el paso 4 ya no es un fallo post-move (R8) y el 5 es T1/T3 con el reconciler real. |

### 7.4 Mutaciones (cada una contra **solo** su archivo de test; ninguna puede quedar en verde)

| Guarda | Test | Mutación que la quita |
|---|---|---|
| Reserva antes del move | R4, T4 | Colocar el archivo antes de escribir la reserva |
| Raíz registrada antes del move | T3, T6 | Registrar la raíz después de `relocate_document` y cortar ahí |
| Binding efectivo en la rama "moved while in flight" | T5 | Usar `catalog.getById` en esa rama |
| Inode de la ruta para baseline `null` | T5 | Usar el inode de SQLite |
| Touch-only con ruta activa | T1 | Volver al `workspace_sync` con acuñado por defecto |
| `indexPending` en vez de `failed` | T1 | Devolver `failed` cuando falla el commit |
| Colocación exclusiva | R12 | `fs::rename` simple |
| Rollback libera la reserva | R9 | Omitir la liberación |
| Detaches antes que upserts | R16 | Restaurar el orden actual |
| Pases serializados | T10 | Quitar la espera al pase en curso |
| Rechazo de raíz retirada | T7 | Omitir el chequeo |
| El aviso se limpia al reparar | T1, T2, T14 | No borrar la ruta en el `CatalogChange` |
| `.tmp` marcado de antemano | T9 | Marcar solo la ruta final |
| Resultado de 0a comprobado | S1 | Ignorar el booleano |
| Carpetas aseguradas antes de la reserva | R18, R20, T16 | Quitar el `create_dir_all` de P2 (R18 y T16 en rojo) o el de `Validated` (R20 en rojo) |
| Reserva conservada si el rollback no borra el destino | R10 (variante) | Liberar la reserva siempre |
| Ningún pase elige ante el duplicado | T15 (1) | Quitar el descarte del upsert hacia la otra copia (vuelve a ganar el último commit) |
| Ampliación por un `manifestId` ligado a otra raíz | T15 (2) | Quitar la ampliación |
| `manifestId` repetido en la misma raíz → `ambiguous` | T15 (3) | Volver a la escalera (acuña) |
| Sin move con la ruta ligada no observable | T15 (4), T3 (variante 9b) | Mover aunque la raíz ligada no sea observable |

---

## 8. Riesgos y contratos que cambian

### 8.1 Contratos

- **ADR `odessay-adr-identidad.md`, enmienda de D7 (`:80-83`):** el move consciente preserva el binding porque **el ledger de destino reserva el UUID antes del move y la raíz de destino queda registrada antes**. El reconciler lo reconoce por `manifestId`, no por inode/hash. Se añade el límite de la decisión 3 con la regla de duplicado (§2.7: ningún pase elige) y la visibilidad que fije D-A.
- **Spec `odessay-desktop-document-catalog.md`:** §Guardado gana la subsección "Relocate consciente" (orden P2 [carpetas + cabecera] → P3 → reserva → move → retirada → SQLite + cola → pase). §Fallas gana las filas 5, 7, 8, 9b, 12, 17 y 22. §Reglas de escritura del manifest añade que una reserva precede al archivo y solo sobrescribe una entrada colgante. §Prioridad de reconciliación añade la regla de duplicado. El orden "`.md` → manifest → SQLite" no cambia: el relocate no escribe contenido, y "manifest antes que SQLite" se mantiene.
- **Contrato Rust/TS:** se quitan `relocate_file` y `tauriRelocateFile`; se añaden `relocate_prepare_destination` (crea las carpetas que falten) y `relocate_document` (el rollback solo libera la reserva si borró el destino). `catalog_apply_reconcile` aplica detaches antes que upserts.
- **Reconciler:** un `manifestId` no mueve un binding mientras la ruta ligada no se confirme ausente, y un UUID visto en dos archivos sale `ambiguous` (§2.7).
- **Capability map:** DOC-08 / WS-02 / SYS-04 (la evidencia de `tests/integration/documents/cross-workspace-move.test.ts` se reescribe sobre el comando nuevo); DOC-07 (nota: registro compartido de N693r); DOC-09 (un archivo relocalizado se abre por `manifestId`); WATCH-04 no cambia. Filas COMP nuevas para las de §7, en un rango que reserva el coordinador al planificar el BUILD.
- **`workflow/docs.json`:** falta la entrada de este documento. No va en este PR: el archivo lo comparten los cuatro nodos D* y queda fuera del ownership del nodo. Se añade al mergear.

### 8.2 Riesgos

| Id | Riesgo | Mitigación |
|---|---|---|
| R-1 | La garantía de un solo comando depende de que siga siendo síncrono en el hilo principal | Invariante escrito en el contrato y comentario en el comando; punto del checklist de review |
| R-2 | Una copia grande entre volúmenes bloquea el hilo principal (la UI) mientras dura | Los `.md` son pequeños; hoy `relocate_file` ya es síncrono |
| R-3 | Una segunda instancia de la app no se serializa [NV] | Fuera de alcance; macOS reactiva la instancia existente salvo `open -n` |
| R-4 | Conflictos de archivo con N693r y ODE-697 (`document-service-factory.ts`, `editor-shell.tsx`) | Orden: N693r → ODE-697 → ODE-698 (ODE-698 está bloqueado por ambos) |
| R-5 | Falso WATCH-07 si la escritura llega al `.md` pero falla su proyección (el baseline no avanza) | Preexistente (DOC-03) y común a todo guardado; la salida es de ODE-692 |
| R-6 | Open File y una raíz nueva estrechan un manifest existente a `[rel]` y el siguiente escaneo poda las otras entradas | Preexistente y se mantiene como hoy; queda anotado para un follow-up |
| R-7 | Un `CatalogChange` del UUID con SQLite aún obsoleto, en la ventana entre "SQLite vuelve" y "reparación", haría que `useExternalDocumentChanges` siga la ruta vieja con aviso "moved" | Ventana mínima (la reparación es lo primero que escribe); límite aceptado sin prueba |
| R-8 | La serialización de pases alarga la espera de un pase pedido detrás de uno largo | Los pases son idempotentes; el pase pedido es fire-and-forget |
| R-9 | Residuos tras caídas | Inocuos (§4, límite 5) |
| R-10 | La ampliación por un `manifestId` ligado a otra raíz cuesta un escaneo de todas las raíces | Solo ocurre con un move, un `indexPending` o un duplicado; en estado estable cada `manifestId` está ligado en su raíz. Mismo tope que ODE-661: una ampliación por pase |
| R-11 | Otros orígenes de UUID repetidos (p. ej., una carpeta copiada con su `.odessay` y registrada) dejan de alternar entre raíces y quedan `ambiguous` [I] | Coherente con la decisión 3; nada se borra ni se acuña |

---

## 9. Decisiones nuevas para Hugo

**D-A. ¿Se avisa en Desk del duplicado de la decisión 3?** En las dos opciones la app no elige entre las copias (regla de duplicado, §2.7). El documento sigue en su última ruta confirmada, que tras la caída es el origen. La otra copia se abre con Open Document, que re-apunta el documento por acción explícita del usuario. Nada se borra. El mismo límite cubre el fallback del mismo volumen (`hard_link` → borrar el original) en discos sin rename exclusivo.
- (a) **Recomendada:** sin aviso nuevo. El duplicado queda como `ambiguous` en el resultado del pase, igual que hoy el empate de hash, que tampoco tiene superficie en la interfaz: nadie alimenta `signalsById` (`lib/queries/document-catalog.ts:78-100`; `lib/queries/workspace-catalog-source.ts:57`) [V], y un comentario del código asigna la UX de ambigüedad a ODE-373 (`editor-shell.tsx:2142-2143`). Sin código de UI. La ventana es de una syscall.
- (b) Mostrar el estado existente "Needs review" (`components/ui/document-state-badge.tsx:92-97`) en Desk y en Workspace mientras existan las dos copias: el reconciler publica sus UUID `ambiguous` y las vistas los pasan por `signalsById`. Requiere un texto propio, porque el tooltip actual describe el caso inverso (un archivo que coincide con varios artefactos), y encendería también el empate de hash. Más código y una decisión de texto.

**D-B. ¿Qué pasa con Save As (o Move to) hacia una carpeta que se quitó de la app, o hacia una subcarpeta suya?** Hoy, en la carpeta misma, el archivo se mueve, después falla el catálogo y al reiniciar el documento desaparece de Desk. En una subcarpeta se crea una raíz anidada dentro del workspace eliminado.
- (a) **Recomendada:** rechazarlo antes de mover, con el aviso existente "This artifact couldn't be moved to the chosen folder…". Coherente con la regla de que solo añadir o re-añadir la carpeta levanta su retiro (`index.rs:835-850`).
- (b) Tomar el diálogo como consentimiento y re-activar la carpeta, lo que hace reaparecer todos los documentos de ese workspace eliminado.
