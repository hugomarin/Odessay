# ODESSAY — Catálogo Operativo de Harnesses de Integración

**Antes de escribir la prueba, decidir el nivel** — eso vive en `workflow/testing/critical-capabilities-testing.md` (principio "test at the lowest-cost boundary that can falsify the failure mode we care about"). **Y antes de darla por buena, el contrato** — `workflow/quality/capability-proof-contract.md` tiene las reglas MUST del *qué*. Este catálogo asume ambas cosas resueltas y responde el tercer problema, el mecánico:

> ¿Qué andamiaje ya existe para montar el escenario, cuál me toca, dónde lo extiendo y qué trampas ya están pagadas?

Es el hermano de `workflow/testing/playwright-catalog.md`: aquel organiza los assets de browser, este los de integración y componente bajo Vitest.

---

## Regla principal: el criterio no es cuántos dobles, es cuáles

La señal que delata un escenario improvisado suele ser un archivo con decenas de `vi.mock`. Pero el número es **el punto de partida de la revisión, nunca el veredicto**. Lo que decide es este triángulo:

```text
1. QUÉ DOBLA        ¿boundaries externos, o seams internos de la propia app?
2. QUÉ DICE SER     ¿unit, contract o integration? (docblock, nombre, intención)
3. QUÉ SE AFIRMA    ¿alguna fila del capability map se apoya en él, y con qué status?
```

Un unit test puede doblar colaboradores internos: es su trabajo aislar. Un proof de integración no puede — regla 3 del contrato. Y una fila del mapa en `INTEGRATION` apoyada en un test que dobla un seam interno es una sobredeclaración, no un problema del test.

Por eso la auditoría de este catálogo se hace **leyendo**, no contando (ver §Auditoría).

---

## Inventario de andamiajes

### 1) `tests/support/` — banco del Editor Shell (nivel componente)

```text
editor-shell-harness.tsx         montaje real + drivers + control de trabajo diferido
editor-shell-doubles.ts          boundaries externos, camino web
editor-shell-desktop-doubles.ts  camino desktop; delega en real-desktop-doubles
```

**Qué resuelve.** Montar `EditorShell` de verdad (React DOM + `act`) con sus internals reales y drivers para conducirlo: escribir en el editor, pulsar pestañas con el gesto real, retener y soltar trabajo diferido, esperar condiciones sin `sleep`.

**Qué deja real.** TipTap con sus extensiones reales, el editor session store, `PersistenceCoordinator`, `lib/corrections/*`, `lib/local-db` sobre `fake-indexeddb`, `lib/editor/*`, `EditorTopbar` y los componentes hijos del editor. En modo desktop, además: `DesktopDocumentService`, `FilesystemDocumentService` y el catálogo con sus reglas de consistencia, contra un directorio temporal real.

**Qué dobla.** Solo lo que no puede ejecutarse fuera de la app: la red, el transporte nativo de Tauri, los diálogos del sistema operativo, el proveedor de AI y el router de Next. Cinco en modo web, siete en desktop.

**Cuándo NO es el adecuado.** Si la propiedad bajo prueba no depende de que el shell esté montado. Montar la UI para probar una regla de un servicio es caro y frágil: baja al nivel de servicio. Tampoco sirve para propiedades que dependen de layout real (alturas, overflow, scroll con medidas) — eso es Playwright, porque happy-dom no calcula layout. El scroll como valor que la shell guarda y restaura sí se puede leer (`scrollViewport`/`readViewport`; `withAppMain` monta el `<main>` desplazable del layout de la app, que la shell también guarda). Lo que no se puede leer es el recorte que hace el navegador cuando cambia el contenido: un test que dependa de él tiene que declararlo (ODE-600).

**Dónde se extiende.** Drivers y montaje en `editor-shell-harness.tsx`; dobles de boundary en `editor-shell-doubles.ts`; lo específico de desktop en `editor-shell-desktop-doubles.ts`, que **delega** en el módulo de abajo en vez de duplicarlo.

### 2) `tests/integration/documents/support/real-desktop-doubles.ts` — nivel servicio

**Qué resuelve.** Ejercitar la cadena documental de desktop sin React: servicios reales contra filesystem real en un directorio temporal, con un catálogo que aplica las mismas reglas de identidad/binding que el lado Rust.

**Qué deja real.** Escrituras y lecturas de fs de verdad (incluido el `.tmp` + rename), hashing real de contenido, estado de manifiesto por root, y las reglas de consistencia del catálogo.

**Qué dobla.** El transporte nativo de Tauri (no hay puente dentro de Vitest) y SQLite en concreto, sustituido por un almacén de filas en memoria con las mismas reglas. Eso se declara explícitamente en el módulo: el seam TS → `invoke()` real → Rust/SQLite **sigue siendo un gap abierto** y ningún test que use estos dobles puede afirmar lo contrario.

**Cuándo NO es el adecuado.** Cuando la propiedad vive en la UI (qué se renderiza, qué pasa al cambiar de pestaña, cómo reacciona el editor). Ahí toca el nivel componente.

**Dónde se extiende.** Aquí mismo: es el canonical owner de los dobles de desktop. Añadir un comando nuevo significa revisar también sus consumidores actuales, porque lo comparten los tests de integración y el banco del editor.

### 3) Seam TS → `invoke()` → Rust/SQLite: fixture grabado + `cargo test` (ODE-613, vía a)

**Qué resuelve.** La costura que ningún doble puede cerrar: la secuencia de comandos que el wrapper TS real emite, reproducida sobre los comandos Rust reales contra SQLite y filesystem reales, sin AppHandle. No hay que escribirla dos veces: se **graba** desde el código TS.

```text
tests/support/catalog-seam-recorder.ts   grabador: modelo de fs/manifiesto/catálogo + escenarios
tests/fixtures/catalog-seam/catalog-seam-v3.json   fixture versionado (generado, no a mano; proyección de respuesta por invoke, incluido contentHash)
tests/catalog-seam-fixture.test.ts       gate de drift TS (npm test)
src-tauri/tests/catalog_seam.rs          replay Rust sobre las pub fn reales + SQLite real
.github/workflows/desktop-rust.yml       job cargo-test (gate en CI required, solo con cambios de Rust/seam)
```

**Qué deja real.** En la grabación: `SqliteDocumentCatalog` y `createWorkspaceReconciler` (cableado como `desktop-workspace-reconciler.ts`: `workspace_sync` → `listByBindingRoot` → `applyReconcileTransaction`). En el replay: los `pub fn` de `commands::index` y `commands::workspace`, SQLite real, fs real de un tempdir, y una conexión nueva para leer las filas canónicas.

**Qué dobla.** Solo el decode IPC de Tauri (`@tauri-apps/api/core`), que en la grabación responde con la semántica de cada comando. Esas respuestas **no** son desechables: deciden los ids que el wrapper reenvía y los upserts que commitea, así que cada invoke grabado guarda una proyección de la respuesta — los pares `relativePath`→`id` y `unboundPaths` de `workspace_sync`, `changed` de `catalog_apply_reconcile`, y `id`/`relativePath`/`localPresent`/`bindingRootId` de las lecturas; `folderCount` queda excluido con la razón escrita (ningún consumidor de la secuencia lo lee) — y el replay Rust proyecta la respuesta real igual y la afirma contra la grabada, paso a paso (fix ciclo 1, review ronda 1 P2-1). El transporte real de `invoke` sigue fuera y es RUNTIME (ODE-622). Los escenarios usan raíces `$ROOT_A`/`$ROOT_B` y DB `$DB` como placeholders; el test Rust los reescribe a directorios temporales.

**Cómo se regenera (nunca a mano).**

```sh
UPDATE_CATALOG_SEAM_FIXTURE=1 npx vitest run tests/catalog-seam-fixture.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --test catalog_seam
```

`npm test` corre el gate de drift: regenera la secuencia en memoria desde el wrapper y falla si el fixture commiteado difiere — así el replay nunca prueba una secuencia vieja. El grabador lanza error si el wrapper emite un comando que el doble no conoce.

**Cuándo NO es el adecuado.** Propiedades de UI o de orquestación multi-servicio; aquí solo entran cadenas cuyo contrato de comandos se puede grabar desde TS y reproducir sin runtime de Tauri. Los comandos de sync/mutación no están en la secuencia (el wrapper no los ejecuta en el flujo del reconciliador); agregarlos es extender los escenarios y el dispatch del test Rust.

**Dónde se extiende.** Escenarios nuevos en `catalog-seam-recorder.ts` (helpers `fsWrite`/`fsRename`/`fsDelete` + reconciler real); comandos nuevos en el `switch` del doble y en el dispatch de `catalog_seam.rs`, **más su proyección de respuesta** (`projectInvokeResponse` en TS y los `project_*` del replay): si la respuesta real difiere de la grabada, el replay señala el paso exacto. Si cambia la forma de un comando, el gate de drift lo detecta en `npm test`.

**ODE-637 Parte 2 (fixture v3).** El grabador reutiliza `computeMarkdownContentHash` (`lib/content-hash.ts`) para registrar hashes BLAKE3 reales en `workspace_sync` y en las proyecciones de filas del catálogo. El escenario `watch07-external-edit-same-path` registra el archivo, cambia su contenido externamente en la misma ruta e inode, vuelve a escanear y lee el mismo UUID con `getById`. El replay compara esas respuestas con las funciones Rust reales y, en una conexión SQLite nueva, contrasta `document_bindings.content_hash` con el hash del `.md` en disco; quitar la actualización del hash en el `ON CONFLICT` de `catalog_apply_reconcile` hace fallar el replay. La edición física se simula con `fs::write` sobre el archivo existente; no cambia Rust de producción. El transporte IPC real de Tauri sigue fuera del proof y lo cubre ODE-622 (RUNTIME).

---

## Cómo elegir el nivel

```text
¿La propiedad se puede falsificar sin montar UI?
   sí  → nivel servicio (real-desktop-doubles)
   no  → ¿depende de layout real (alturas, overflow, scroll medido)?
            sí  → Playwright (ver playwright-catalog.md)
            no  → nivel componente (tests/support/)
```

Elegir de más cuesta tiempo y fragilidad; elegir de menos produce un proof que no puede ver el fallo que dice prevenir.

---

## Trampas ya pagadas

Cada una costó un ciclo completo de diagnóstico. Están aquí para no volver a pagarlas.

**El factory de `vi.mock` no puede cerrar un ciclo con el módulo bajo prueba.** `vi.mock("@tiptap/react", ...)` importando un módulo que a su vez importa `EditorShell` (que importa `@tiptap/react`) deja la carga del test colgada **sin imprimir ni el nombre del archivo**. Por eso los dobles viven en un módulo que no importa la app.

**Capturar, no sustituir.** Para tener el editor real y a la vez un handle, se envuelve `useEditor`: se llama al real y se guarda la instancia. Sustituirlo por un stub es lo que dejó tres tests incapaces de ver selección, cursor o scroll durante meses.

**Un driver debe verificar su propio efecto.** Los tabs del editor no escuchan `click`: implementan un gesto propio con `pointerdown` + `pointerup` y `setPointerCapture`. `node.click()` no activa nada, y la prueba navega *sin cambiar de documento* y pasa igual. Todo driver que represente una acción del usuario comprueba después que la acción ocurrió.

**Drenar todo el trabajo diferido de golpe no reproduce una carrera de identidad.** Si se sueltan a la vez el callback viejo y el nuevo, el nuevo pisa al viejo y el resultado final sale bien aunque la guarda de ownership no exista. Hay que retener el callback del documento viejo y soltarlo **después** de que el nuevo terminó.

**El timing por defecto no alcanza.** Montar el shell real cuesta ~1s aislado y bastante más con la suite completa compitiendo por CPU; el default de 5s de Vitest deja estas pruebas intermitentes sin que nada esté mal en el producto. Declarar timeout explícito, y esperar condiciones en vez de tiempos fijos.

**Una acción que muta un store externo no espera a los efectos pasivos pendientes.** Un handler que escribe en un store (`closeTab`, por ejemplo) corre aunque el último commit de React tenga efectos pasivos sin ejecutar; esos efectos llegan *después*, con el closure de antes de la acción. Así resucitaba la pestaña cerrada de ODE-561: nunca se reproducía de forma fiable por tiempo (1 de cada 16 corridas, y dos arreglos subiendo timeouts fracasaron). La ventana se abre a voluntad desde un `useLayoutEffect` de un hijo de la shell, que corre tras el commit y antes de los efectos pasivos. Como qué commit trae el efecto rezagado es un detalle de implementación, se **barren** las ventanas en vez de apostar por una (ver `tests/editor-shell-close-commit-window-desktop.test.tsx`, que dispara el gesto real de cerrar desde `world.onShellCommit`).

**La selección se puede hacer por el DOM; no hace falta el comando del editor.** Un `Range` sobre el nodo de texto del `.ProseMirror` enfocado, más el evento `selectionchange` en `document`, lo lee el `DOMObserver` de ProseMirror igual que un arrastre, y el `selectionUpdate` del shell abre el popup solo. `selectEditorText` lo hace y verifica que ProseMirror adoptó la selección (ODE-606). `setTextSelection` se salta ese camino: úsalo solo cuando la selección no es la entrada de la propiedad.

**~~Un documento sembrado con `version: 1` no lista sus anotaciones en el sidebar.~~ Arreglado en ODE-625.** El memo `footnotes` del shell solo se recalculaba cuando cambiaba `version`, y el estado del shell arranca en 1. Era un bug real, no del harness; sus casos en `tests/editor-shell-annotation-roundtrip.test.tsx` ya son `it` normales. Los escenarios que sembraron `version` distinta de 1 para esquivarlo siguen siendo válidos.

**Un atajo de la shell se pulsa una sola vez, con el modificador de la plataforma.** `pressEditorShortcut` dispara un único `keydown` en `window` con ⌘ o Ctrl según `isMacPlatform()`, como lo lee `getEditorShortcutAction`. Disparar los dos modificadores "por si acaso" (el patrón viejo de las pruebas de correcciones) alterna dos veces los atajos que alternan, como el focus mode, y la prueba sale verde sin haber entrado nunca (ODE-602).

**Un overlay de Radix se cierra solo con un pointerdown fuera.** Con el visor de imagen abierto, pulsar una pestaña con `pointerClick` lo cierra por ese camino, no por la lógica de la shell, y la prueba del cierre al cambiar de documento queda verde aunque la shell no haga nada. En la app el overlay tapa la barra de pestañas: el cambio de documento con un overlay abierto llega por el atajo de pestaña siguiente. Y afirmar la ausencia sobre el contenedor del overlay, no sobre la imagen: si el documento nuevo no tiene imágenes, el visor sigue abierto pero sin `<img>` (ODE-602).

**Un `<input type="file">` con `required` no deja enviar el formulario en happy-dom.** Su `value` no se puede asignar desde el test, así que la validación nativa bloquea el `click` del botón de enviar. Se asigna `files` y se entrega el evento `submit` al formulario, que es lo que emitiría el navegador con el archivo elegido (ODE-602, modal de insertar imagen).

**El estado real persiste entre tests del mismo archivo.** `fake-indexeddb` es un colaborador real: reutilizar el mismo documento hace que el segundo test encuentre estado del primero y no dispare lo que debía. Usar identidades nuevas por test, que es lo que hace producción.

**Pasar un doble canónico de `unimplemented` a real desbloquea efectos asíncronos en todos los escenarios que lo comparten.** `tests/support/editor-shell-desktop-doubles.ts:119` cableó `tauriCatalogListRetiredBindingRoots` al no-op real (`tauriCatalogListRetiredBindingRootsDouble`, que devuelve `[]`), y eso puso en marcha el reconciliador de workspace —incluido el seeding de starter docs— en cada test desktop del harness. El `main` se rompió en `blank-draft-naming` y el "suite completa en verde" del PR no lo vio porque el seeding es asíncrono y depende de timing (ODE-580, remediado por #513 con la exclusión de starter docs). Candidatos a la misma trampa, todavía en `unimplemented`: `tauriCatalogApplyReconcile` y `tauriCatalogListBindingRootDocuments`. Ver paso 7 del protocolo.

**La cadena del watcher se activa a propósito, no por defecto (ODE-599).** `tauriCatalogApplyReconcile` y `tauriCatalogListBindingRootDocuments` ya tienen espejo real en `real-desktop-doubles.ts`, pero `tauriCommandsDouble()` los sigue dejando en `unimplemented`: solo `tauriCommandsDouble({ withReconciler: true })` los cablea. Activarlos para todos haría que cualquier arranque del reconciliador (p. ej. el `refreshWorkspaceReconcilerRoots` de un "Save As" a carpeta nueva) proyecte ráfagas `bulk` en escenarios que no las esperan — la trampa de ODE-580. Para conducir la cadena en el orden de producción: `ensureWorkspaceReconciler()` primero (lo que hace `DesktopAppShell` al abrir la app), después abrir el documento por el opener real (registra su carpeta), esperar a que un watcher cubra esa carpeta, cambiar el archivo en disco y `emitFsWatchEvent([path])`. Arrancar el reconciliador después del open es una secuencia de reinicio (`NON_PRODUCTION_PATH`) y esconde ODE-628: hoy el registro del BindingRoot externo no refresca el watcher; el transporte del watcher (`plugin:fs|watch` y su `Channel`) lo dobla `tauriCoreDouble`. `disposeWorkspaceReconciler()` en `afterEach`: es un singleton de módulo. El doble de `workspace_sync` sigue un archivo renombrado o movido dentro de la raíz por inode, como el escaneo real. También persiste el alcance del manifiesto (`selectedPaths`) como `workspace.rs`, en vez de devolver `[]`: una segunda apertura en la misma carpeta depende de ello (ODE-628). La ventana nativa (`tauriWindowDouble`, `requestWindowClose`) permite probar la guardia de cierre por la shell.

**El harness nunca marca auto-escrituras.** `markOdessaySelfWritePath` vive en `tauri-commands.ts`, que el harness dobla entero, así que la supresión de los eventos propios de la app no se ejercita en ningún escenario del banco.

**El autosave desktop espera 4s, no 150ms.** `DESKTOP_PERSISTENCE_DEBOUNCE_MS = 4_000`; los 150ms son el debounce de la salida del editor. Un escenario que quiera "edición pendiente" en el momento de un evento la retiene con `holdWriteFile` en vez de apostar por el tiempo.

---

## Protocolo antes de montar un escenario nuevo

1. **Nivel resuelto** — `critical-capabilities-testing.md` decidió unit / contract / integration / E2E.
2. **Runtime declarado** — web o desktop. No es un detalle de configuración: hay invariantes que **solo existen en uno de los dos** (la cola de updates del editor se vacía de forma síncrona en web, así que la carrera que existe en desktop ahí no se puede falsificar).
3. **Buscar andamiaje** — ¿alguno de los dos módulos de arriba cubre este escenario? Si sí, se usa; si casi, se **extiende en su canonical owner**, no se clona.
4. **Listar los dobles que hará falta** — y para cada uno responder si es boundary externo real. Si es una pieza propia, el contrato lo prohíbe en un proof de integración: hay que conectarlo de verdad.
5. **Si la aserción es una ausencia, control positivo primero** — demostrar que el efecto es alcanzable antes de afirmar que no ocurre (regla 8 del contrato).
6. **Mutation test** antes de declararlo evidencia.
7. **Si el escenario cambia un doble canónico, razonar los efectos desbloqueados** — cuando un cambio en `tests/support/editor-shell-desktop-doubles.ts` o en `tests/integration/documents/support/real-desktop-doubles.ts` pasa un camino de `unimplemented` a real: correr la suite completa (no solo el test nuevo) y pegar el resultado en el PR; listar los efectos asíncronos que el cambio desbloquea (seeding de starter docs, reconciliador) y qué tests podrían verlos; y si un test depende del orden temporal de esos efectos, hacerlo determinista (excluir los starters o esperar el evento), nunca reintentar. Ver la trampa ODE-580/#513 en "Trampas ya pagadas".

Crear un módulo de soporte nuevo se justifica solo cuando el escenario pertenece a un área sin andamiaje —no al editor, no a la cadena documental de desktop— y se documenta aquí con su ficha al cerrarlo.

---

## Auditoría (2026-09-23, ODE-560)

Clasificación por lectura del archivo, no por conteo de dobles.

| Familia | Veredicto | Nota |
|---|---|---|
| `tests/integration/**` (6 archivos) | **Conformes** | 0–5 dobles; usan `real-desktop-doubles` donde aplica. El de AI dobla solo auth/admission, carve-out declarado en su Proof Contract |
| `tests/editor-shell-*` sobre el harness (4) | **Conformes** | 9 dobles, casi todos delegaciones de una línea al módulo compartido |
| `editor-empty-draft-persistence` (42), `editor-shell-tab-switch-persistence` (40), `editor-save-to-disk-relocate` (40) | **Divergen** | Decorado propio + editor de cartón. Dueño: requirement 3 de ODE-556. No se tocan aquí |
| `desk-workspace-catalog-integration` (16) | **No aplica** | Es un contract test y lo declara: monta Desk y Workspace reales "over one mocked DocumentCatalog". El fake está nombrado, no escondido |
| `services/workspace-service` (10), `preview-overlay-redesign` (10) | **No aplica** | Unit tests; ninguna fila del capability map se apoya en ellos |
| `services/document-service-factory` (10), `preview-modal` (10) | **No aplica** | Citados en el mapa como evidencia *previa*, no como base de un status. DOC-02 sostiene su `INTEGRATION` sobre `tests/integration/documents/materialize-save-reopen.test.ts`, no sobre estos |

> **Actualización (2026-09-24, ODE-574):** el requirement 3 de ODE-556 pasó a ODE-574. `editor-save-to-disk-relocate` ya está reescrito sobre el harness como `tests/editor-shell-save-as-relocate.test.tsx`: traslado real en disco, sin dobles del servicio. `editor-shell-tab-switch-persistence` también: 6 de sus 7 pruebas están en `tests/editor-shell-tab-transitions-desktop.test.tsx` y la séptima (el volcado al cambiar de pestaña) la cubren `editor-shell-exit-protocol` y `editor-shell-save-live-identity`. `editor-empty-draft-persistence` se reparte en cuatro archivos por tema: `editor-shell-draft-materialization-desktop` (ODE-405 y ODE-461), `editor-shell-close-commit-window-desktop` (cerrar la última pestaña y los barridos de ODE-561), `editor-shell-stale-hydration` (ODE-464, en web: la persistencia remota de correcciones solo corre para documentos confirmados por el servidor en `localDB`) y `editor-shell-blank-draft-naming-desktop` (ODE-478 caso 3 y "Save As" sobre un borrador efímero). Con eso los tres archivos legacy salen del ratchet y el requirement 3 queda cerrado.

**Resultado: ninguna corrección barata pendiente.** Se revisó si alguna fila del mapa reclamaba `INTEGRATION` apoyada en un test que dobla un seam interno — la sobredeclaración que esta auditoría buscaba — y no la hay. La única divergencia real está concentrada en los tres tests legacy del shell, que ya tienen dueño.

Eso valida la regla principal: de los ocho archivos que el conteo señalaba, **cinco resultaron legítimos al leerlos**. Un ratchet basado solo en el número habría producido cinco falsos positivos.

---

## Mapa de Recon — milestone 4 (ODE-611…614)

**Verificado en: main@6e803d21 (2026-09-30).** Solo lectura del código en ese commit. No se ejecutó ningún test ni `cargo test`. Todas las rutas son relativas a la raíz del repo. Si una parte no se exploró, se dice. Cuando BUILD encuentre algo distinto, corrige este mapa en su PR.

### Sync (ODE-611, ODE-612)

**Montajes existentes: qué es real y qué está fakeado**

| Archivo | Real | Fakeado (archivo:línea) |
|---|---|---|
| `tests/integration/sync/web-writing-save-atomic.test.ts` | `webDocumentService`, `localDB` sobre `fake-indexeddb` (:24), `SyncWorker` | `sync-service-factory`, para que `scheduleFlush` no haga nada (:27-29); spies que envuelven `localDB.writings.get/update` y abren la ventana de carrera (:88-96); transporte retenido (:100-121); `window` (:133-140). Reset: `setLocalDBScope(uuid)` (:141) |
| `tests/integration/sync/sync-lifecycle-transition-atomic.test.ts` | `SyncWorker` y `localDB` (:21-26), sin `vi.mock` de módulos | transporte (:104-111, :178-203), `window` (:114-119) |
| `tests/integration/sync/sync-worker-failure-preserves-local-content.test.ts` | `SyncWorker`, `localDB`, `MAX_ACTIVE_RETRIES` (:37-42) | transporte que falla (:82-88), `window` (:111-117). `makeMutationImmediatelyDue` (:98-109) reencola con `next_retry_at: 0` en lugar de usar fake timers |
| `tests/integration/sync/sync-multiple-saves-before-flush.test.ts` (ODE-611) | `webDocumentService`, `localDB` sobre `fake-indexeddb`, `SyncWorker`, y un servidor fake en memoria que registra cada payload recibido y devuelve el eco del registro de la API (última escritura gana) | `sync-service-factory` para que `scheduleFlush` no agende nada (mismo mock que `web-writing-save-atomic`); solo el transporte de red (`upsertWriting`, con una variante que retiene la primera respuesta para el flush en vuelo); `window`. Reset: `setLocalDBScope(uuid)` |
| `tests/integration/sync/desktop-sync-multiple-saves-before-flush.test.ts` (ODE-611 PR 2) | `createDesktopDraft`/`DesktopDocumentService.saveWriting`/`updateWritingMetadata` (entradas de producción), `SqliteDocumentCatalog` real, `desktopCatalogSyncService` real, `.md` real en fs temporal, cola `sync_mutations` en memoria y `documents.sync_status` con la semántica de Rust | Solo dos fronteras: Supabase (`fake-supabase-server.ts`) y el decodificado IPC de Tauri (`tauri-commands` → dobles de `real-desktop-doubles.ts`). `sync-service-factory` para que `scheduleFlush` no agende (mismo mock que el resto). La prueba conduce `flushPending()` | 
| `tests/integration/collections/delete-collection-keeps-writings.desktop.test.ts` (ODE-618 PR1) | `deleteLocalCollection` (el puerto real que usa `collections-view.tsx`), `deleteDesktopCollection`, `createDesktopDraft` y `SqliteDocumentCatalog` reales, `.md` real en fs temporal, `loadCollectionState`/`loadDeskCatalogData` y `buildCollectionSummaries`/`getUncategorizedWritings` reales | Solo el transporte IPC de Tauri (`tauri-commands` → `real-desktop-doubles.ts`, con el `tauriCatalogDeleteCollectionDouble` nuevo) y la red (`sync-service-factory` no agenda; `desktop-client` no se usa). Cuatro casos verdes (documentos, bindings y bytes sobreviven; el join de la vista conserva la colección viva; y desde PR1b, F6: el documento cuya única colección se borró vuelve a estar sin clasificar) |
| `tests/integration/sync/desktop-sync-failure-preserves-local-content.test.ts` (ODE-612) | La misma cadena real que la fila de ODE-611 PR 2: `createDesktopDraft`/`DesktopDocumentService.saveWriting` (entradas de producción), `SqliteDocumentCatalog` real, `desktopCatalogSyncService` real, `.md` real en fs temporal, cola `sync_mutations` y `documents.sync_status` con la semántica de Rust. Tres casos: fallo reintentable (con la respuesta retenida para observar el `pending` en vuelo), recuperación con un guardado posterior, y fallo terminal por los 10 intentos reales | Los mismos dos boundaries que la fila anterior (Supabase y decodificado IPC de Tauri). Supabase usa `failNextWrite` (reintentable), `failAllWrites` (terminal) y `holdNextWrite` (ventana en vuelo); el reloj se avanza con un spy de `Date.now` para vencer el backoff máximo entre flush explícito y flush explícito, sin sembrar `attemptCount`. La prueba conduce `flushPending()`; no hay guardado concurrente (la variante de ODE-644 la cubre `desktop-sync-multiple-saves-before-flush.test.ts`) |
| `tests/sync-worker.test.ts` | solo la clase `SyncWorker` | todo `LocalDB` son `vi.fn` (:74-125), `vi.useFakeTimers` (:180). **Es unit y no sirve como montaje de integración** |
| `tests/desktop-catalog-sync-service.test.ts` | solo el módulo del servicio; el caso SYNC-03 usa un `.md` real (:711-718) | `@tauri-apps/api/path` (:24-27), cliente supabase (:28-33), `SqliteDocumentCatalog` sustituido por una clase con `getById`/`applyCloudSnapshots` mock (:34-40), todos los comandos de catálogo y `tauriOpenFile` (:41-50), cadena de tabla supabase (:81-92). `vi.resetModules()` en cada test (:96) |
| `tests/integration/documents/support/real-desktop-doubles.ts` | fs temporal real (:286-460), manifiesto e inode (:484-614), almacén de filas del catálogo en memoria con las reglas de Rust (:618-862), **cola `sync_mutations` en memoria** (`tauriCatalogEnqueueMutationDouble`, `tauriCatalogListPendingMutationsDouble`, `tauriCatalogUpdateMutationStatusDouble`, `tauriCatalogPruneSyncedMutationsDouble`, `tauriCatalogPurgeDocumentDouble` y la lectura `catalogMutationsDouble`; el supersede vive en `applyDualWrite`, espejo de `index.rs:700-716`), settings (:871-898), **colecciones y cola `metadata_sync_mutations`**: `tauriCatalogDeleteCollectionDouble` copia el SQL de `catalog_delete_collection` post ODE-618 PR1b (soft-delete + DELETE de las relaciones de esa colección en la misma transacción + encolado de metadata), `tauriCatalogListCollectionSnapshotDouble` filtra las relaciones a colecciones vivas y `catalogMetadataMutationsDouble` lee la cola | SQLite y el transporte Tauri. El fake de Supabase vive al lado, en `tests/integration/documents/support/fake-supabase-server.ts` (última-escritura-gana, `count: "exact"`, error 23505 en insert duplicado, retención de la próxima respuesta y fallos one-shot/permanentes para ODE-612). **La cola espeja el SQL de `index.rs` (supersede/listado/proyección) leído a mano; la costura TS→Rust/SQLite real sigue abierta (ODE-613).** |

**Dueños del comportamiento**

- `lib/sync/worker.ts`, `SyncWorker` (149-426):
  - `schedule`: debounce de 1500 ms (210-230).
  - `flush` (232-277): si ya hay un flush en curso, retorna sin hacer nada (239-242).
  - `processMutation` (283-425), en este orden:
    1. descarta la mutación si fue reemplazada (`getCurrentForEntity`, 284-291);
    2. pasa el lifecycle a `syncing` (311-318);
    3. llama a `upsertWriting(entity_id, mutation.payload)` (324-327);
    4. aplica el eco del servidor, protegido por `local_updated_at` (335-344);
    5. llama a `markSynced` (357).
    - En fallo: rollback del lifecycle (404-410); terminal, `markFailed(MAX_SAFE_INTEGER)` (412-414); reintentable, `markFailed(nextRetryAt)` + `schedule()` (417-423).
- `lib/sync/queue.ts`:
  - `toRemotePayload`: snapshot completo de la fila (23-43).
  - `enqueueMutation`: id nuevo por guardado (45-66).
  - `enqueueWritingUpdate`: actualiza en una transacción y encola la fila escrita (106-119).
  - **La deduplicación vive en `lib/local-db/index.ts:1074-1095`**: borra la mutación anterior de la misma `entity_key` y guarda la nueva, así que gana la última. `markMutationSynced` (1186-1246) no hace nada si el id ya no existe (1193) y solo confirma la fila si no queda otra mutación de la entidad (1213-1240).
- `lib/sync/desktop-catalog-sync-service.ts`, `desktopCatalogSyncService` (objeto, 456-669):
  - `processMutation` (212-390): **el cuerpo se relee del `.md` en el momento del flush** (`tauriOpenFile(record.binding.canonicalPath)`, 349-356); la metadata sale del JSON de la mutación.
  - `flushPending` (531-629): un flush disparado por un guardado excluye los `failed` (538); en éxito, `tauriCatalogUpdateMutationStatus(…,"synced")` (574); en fallo, `"failed"` + `retryFailure` (583-587).
  - `retryFailure` (73-85): `MAX_SYNC_ATTEMPTS = 10` devuelve `retryAt: null` (terminal).
  - **En desktop no existe el estado `syncing`**: la mutación está `pending`, `failed` o `synced`, y Rust proyecta `documents.sync_status` en `catalog_update_mutation_status` (`src-tauri/src/commands/index.rs:1409-1443`).
- Supersede en Rust:
  - dual-write: `index.rs:700-716`;
  - enqueue: `index.rs:1446-1478`;
  - listado de pendientes: `index.rs:1482-1500`;
  - test: `latest_document_snapshot_supersedes_older_actionable_mutations` (`index.rs:3295`).

**Entradas de producción**

- **Web:** `webDocumentService.saveWriting` / `updateWritingMetadata` (`lib/services/web-document-service.ts:169-213`) → `enqueueWritingUpdate` → `getSyncService().scheduleFlush()` (`queue.ts:65`) → `getSyncWorker().schedule(0)` (`lib/services/web-sync-service.ts:231-233`).
- **Desktop:**
  - `saveWriting` (`lib/services/document-service-factory.ts:391-397`) → `persist`: la mutación va sin cuerpo (289-303), luego dual-write y `runtime.scheduleSyncFlush()` (305-310).
  - `lib/sync/sync-service-factory.ts:8-10` elige `desktopCatalogSyncService` bajo Tauri.
  - Otros disparadores: el retry ticker de 60 s (431-445) y el wakeup posterior a un flush (623-627).

**Evento de completitud (regla 4)**

- **Web, "lo que llega a la nube es la versión N":** el argumento `payload` de `upsertWriting` en `worker.ts:324-327`. Es un snapshot tomado al encolar (`queue.ts:117`), no una relectura; como la cola se queda con la última mutación, contiene el cuerpo y la metadata de N juntos.
- **Web, "la fila no queda en `syncing`":** el rollback de `worker.ts:404-410` y la confirmación de `local-db/index.ts:1234-1239`.
- **Web, guardado durante un flush en vuelo:** v4 reemplaza el id de la mutación en vuelo, así que `markSynced(oldId)` no hace nada y v4 sigue en cola. El worker solo mueve el lifecycle a `server-confirmed` (`worker.ts:340-342`).
- **Desktop, versión N:** el `row` que se pasa a `.update()`/`.insert()` de supabase (375-379). El cuerpo de ese row sale del disco en el momento del flush.
- **Desktop, estado de la fila:** `documents.sync_status` que escribe `catalog_update_mutation_status`.

**Riesgo sin verificar (hipótesis para ODE-611 req 2 en desktop):** `catalog_update_mutation_status` no protege el estado de la mutación (`index.rs:1422-1424`). Si llega un guardado durante el flush, el dual-write marca la mutación vieja como `synced` por supersede, y luego:
- si el flush falla, la vuelve a poner en `failed` y la deja accionable de nuevo;
- si tiene éxito, pone la fila del documento en `synced` aunque v4 siga `pending` (1425-1437).

**Confirmado por ODE-611 PR 2 (2026-09-30); corregido en el fix ciclo 1 del 2026-09-30:** el escenario se falsó en desktop con el doble de comportamiento de la cola (espejo del SQL citado) y los tres efectos ocurren: `it.fails` en `tests/integration/sync/desktop-sync-multiple-saves-before-flush.test.ts` — éxito en vuelo deja `documents.sync_status='synced'` con la mutación nueva `pending` (`expected 'synced' to be 'pending'`); el fallo en vuelo revive la mutación superada como `failed` (`expected 'failed' to be 'synced'`); y el reintento de esa v3 revivida, al vencer su backoff (~2 s, más largo que el debounce de 1.5 s del flush de la v4), vuelve a pisar la nube: el cuerpo sale del `.md` (v4) pero la metadata sale del payload de la v3, así que la nube acaba en `{version: 3, status: "draft"}` — **la metadata de la v4 se pierde en la nube y la versión retrocede, en silencio** (`expected 3 to be 4`). La v4 no se pierde en la cola; lo que se pierde en la nube es su metadata. Bug real en Rust: **ODE-644**, enlazado a ODE-611; la confirmación contra el Rust/SQLite real es la costura de ODE-613. **Fix ODE-644 PR1:** `catalog_update_mutation_status` solo actualiza una fila accionable (`status IN ('pending','failed')`) y proyecta `documents.sync_status` solo cuando no queda otra accionable (`NOT EXISTS`), con la misma guarda en la cola de metadata; el doble TS copia el SQL nuevo y los tres casos pasan a `it`. El replay nativo de las mutaciones sigue pendiente para el PR2.

**Tamaño del PR de ODE-611:** partir por runtime (decisión del humano del 2026-09-30: PR 1 web, PR 2 desktop).
- La mitad web reutiliza el montaje de `web-writing-save-atomic` casi tal cual: `tests/integration/sync/sync-multiple-saves-before-flush.test.ts`, **entregado en ODE-611 PR 1**. Añade solo un servidor fake en memoria (última escritura gana) sobre el montaje existente; no crea uno nuevo.
- La mitad desktop necesitaba un doble nuevo de `sync_mutations` que replicara el supersede, el listado y la proyección de estado de Rust, más un fake de supabase, añadidos a `real-desktop-doubles.ts` (su canonical owner). **Entregado en ODE-611 PR 2**: `tests/integration/sync/desktop-sync-multiple-saves-before-flush.test.ts` + `tests/integration/documents/support/fake-supabase-server.ts`. ODE-612 (SYNC-03 desktop) **entregado** reutilizando ese montaje tal cual (`tests/integration/sync/desktop-sync-failure-preserves-local-content.test.ts`): el fake Supabase ya traía fallo one-shot (`failNextWrite`), fallo permanente (`failAllWrites`) y retención de respuesta (`holdNextWrite`), y la cola en memoria expone `catalogMutationsDouble` para afirmar `pending`/`failed`/`synced` sobre la fila real del catálogo. No hizo falta extender la infraestructura compartida.

**Trampas del área**

1. Un fallo reintentable en web llama a `schedule()` con un `setTimeout` real de 1500 ms. Inyectar `scheduleTimeout` no-op.
2. Los fake timers se cuelgan con `fake-indexeddb` (comentario en `sync-worker-failure-preserves-local-content.test.ts:98-102`). Usar `next_retry_at: 0`.
3. `getPending` filtra por `next_retry_at <= now` (`local-db/index.ts:1103`).
4. `setLocalDBScope` necesita un scope único por test.
5. Guardar en web dispara el `SyncWorker` singleton por el transporte `fetch` por defecto. Mockear `sync-service-factory`.
6. El servicio desktop guarda estado de módulo: `catalogPromise`, tickers, `flushRunning`, `nextFlushTrigger` (36, 63-71). Hace falta `vi.resetModules()` o `stop()`.
7. Para que un flush vea los `failed`, tiene que ser explícito o `retry_tick`.
8. En desktop, la ruta de solo metadata falla si la fila no existe en la nube (306-308).

### Catálogo e IPC (ODE-613)

**Secuencia de `SqliteDocumentCatalog`** (`lib/services/desktop/sqlite-document-catalog.ts`). Cada método llama a un solo wrapper, y cada wrapper hace un `invoke` (`lib/services/desktop/tauri-commands.ts`):

| Método | Comandos, en orden |
|---|---|
| `getById` :81 | `catalog_get_by_id` (wrapper :323) |
| `resolvePath` :82 | `catalog_resolve_path` (:327) |
| `list` :83-105 | `catalog_list` (:331); después, `catalog_hydrate_excerpts` (:348), fire-and-forget, una vez por `dbPath` |
| `registerBinding` :124-130 | `catalog_dual_write` (:264) → `catalog_get_by_id` |
| `commitDualWrite` :159 / `commitBulkDualWrite` :169 | `catalog_dual_write` / `catalog_bulk_dual_write` (:269) |
| `listByBindingRoot` :180 / `countByBindingRoot` :176 | `catalog_list_binding_root_documents` (:277) / `catalog_count_binding_root_documents` (:273) |
| `applyReconcileTransaction` :255-297 | `catalog_apply_reconcile` (:373) |
| `detachLocalFile` :131 / `applyCloudSnapshot(s)` :132-157 | `catalog_detach_local_file` (:344) / `catalog_apply_cloud_snapshots` (:308) |
| `listRetiredBindingRoots` / `activate…` / `reactivate…` / `applyWorkspaceRemoval` (184-213) | `catalog_list_retired_binding_roots` / `catalog_activate_binding_root` / `catalog_reactivate_binding_root` / `catalog_apply_workspace_removal` |

- **El catálogo no tiene método de mover, renombrar ni borrar.**
  - Un move o un rename entra como dual-write o como un upsert de reconcile con el mismo id y una ruta nueva.
  - `tauriCatalogPurgeDocument` (:391) existe, pero la clase no la usa.
- El reconciliador desktop (`lib/services/desktop/desktop-workspace-reconciler.ts`) llama a `listRetiredBindingRoots` (:62) → `tauriWorkspaceSync` (:226) → `listByBindingRoot` (:258) → `applyReconcileTransaction` (:272).
- `workspace-reconciler.ts` es lógica pura (`reconcileRoot` :156, `createWorkspaceReconciler` :419-543). Sus tests pasan `scan` y `commit` como fakes inline.

**Lado Rust**

- Los comandos de catálogo están en `src-tauri/src/commands/index.rs`. Son `pub fn(db_path: String, …) -> Result<_, String>` sin `AppHandle` ni `State`. `open_db` (:9-32) abre una conexión nueva en cada llamada, así que cada llamada ya es un reinicio del catálogo.
- Los argumentos usan `serde(rename_all = "camelCase")`, de modo que el JSON capturado en TS deserializa directo.
- El crate es `rlib` y `lib.rs` declara `pub mod commands`, así que un `src-tauri/tests/*.rs` puede llamar a `odessay_lib::commands::index::*`. Ese directorio no existe hoy.
- **No existe un módulo `src-tauri/src/catalog/`.**
- Tests en `mod catalog_tests` (:1764; `temp_db()` es un archivo SQLite temporal real, :1769-1774):
  - `uuid_and_path_collisions_do_not_overwrite_another_document` (:1912-1940). Cubre misma ruta con otro UUID; **no** cubre "mismo nombre en dos raíces".
  - `dual_write_reuses_existing_binding_root_for_the_same_path` (:1943-1988).
  - `reconcile_reuses_existing_binding_root_for_the_same_path` (:1991-2047).
  - `transaction_failure_rolls_back_document_binding_and_queue_together` (:2050).
  - `catalog_apply_reconcile_backfills_missing_filename_title_for_local_document` (:2202-2278). Hace de facto un rename por reconcile: el mismo id resuelve la ruta nueva.
  - `catalog_apply_reconcile_preserves_cloud_metadata_and_detaches_without_cloud_delete` (:2281-2346).
  - `workspace_removal_fence_survives_restart_and_is_idempotent` (:2757-2797).
  - `reconcile_only_reports_documents_that_actually_changed` (:2902-2937).
  - `latest_document_snapshot_supersedes_older_actionable_mutations` (:3295).
- Ningún test cubre mover, reabrir la DB y resolver el mismo UUID, ni dos raíces con un archivo homónimo.
- **No existe ningún mecanismo que registre o derive la secuencia de `invoke` desde TS**: ni ts-rs, specta, `mockIPC` ni fixtures compartidos. Los tests TS mockean `tauri-commands` entero (`tests/contracts/document-catalog.test.ts:15-25`).

**CI.** Ningún workflow corre `cargo test`: `quality.yml` corre typecheck, lint, `npm test` y build. Rust solo aparece en `release-desktop.yml`, por tag `app-v*` y sin tests.

**Qué haría falta en cada vía**

- **(a) Replay Rust de una secuencia derivada del wrapper:**
  - Un test Vitest mockea `@tauri-apps/api/core` con un grabador de `{cmd, args}` y respuestas guionizadas. Conduce el `SqliteDocumentCatalog` y el reconciliador reales por los escenarios de SYS-01/SYS-05 y escribe `tests/fixtures/catalog-seam/*.json`.
  - Un test Rust (`src-tauri/tests/catalog_seam.rs`) lee el fixture, despacha cada `cmd` a las `pub fn` sobre una DB y una raíz temporales (reescribiendo `dbPath`) y hace las aserciones sobre las filas.
  - La secuencia se escribe una vez, en TS. Un test Vitest regenera el fixture en memoria y lo compara con el commiteado (drift), lo que cubre el lado TS en `npm test`.
  - Para el lado Rust hace falta un job nuevo: `cargo test --manifest-path src-tauri/Cargo.toml --test catalog_seam`. En Linux necesita las libs de webkit2gtk porque compila `tauri`; la alternativa es macOS, que ya se usa en release.
- **(b) Contrato TS contra los comandos Rust reales:** un binario o `examples/` nuevo que exponga los comandos por stdio o HTTP, más un shim de `invoke` en Vitest. Tiene el mismo costo de toolchain en CI que (a), más un arnés de proceso. Prueba algo más (la deserialización en vivo), pero es infraestructura nueva.
- **(c) Carril RUNTIME (ODE-622):** es la única vía que prueba el transporte IPC real de Tauri. Es manual o sobre el artefacto empaquetado, así que no bloquea PRs y las filas no cambian hasta que exista el carril.

**Recomendación: (a) + job de CI `cargo test` acotado al test del seam.** Reutiliza las `pub fn` ya testeables sin `AppHandle`, y el fixture grabado ata la secuencia al wrapper sin escribirla dos veces. Sin ese job, el lado Rust no queda gateado, y en ese caso SYS-01/SYS-05 no pueden subir de `PARTIAL_INTEGRATION`. Queda fuera en cualquier caso: el transporte IPC de Tauri (serialización real de `invoke`), que sigue siendo RUNTIME.

**Entregado en ODE-613 (vía a, 2026-09-30).** La vía (a) quedó construida y SYS-01/SYS-05 subieron a `INTEGRATION` (el harness se documenta en §Inventario de andamiajes 3). Correcciones al snapshot del Recon, verificadas al construir: `src-tauri/tests/` ahora existe con `catalog_seam.rs`; el fixture es **un** archivo versionado con tres escenarios (`sys01-homonyms-distinct-roots`, `sys01-register-move-reopen`, `sys05-reconcile-tracks-disk`), no un JSON por prueba; el grabador vive en `tests/support/catalog-seam-recorder.ts` y la grabación se regenera con `UPDATE_CATALOG_SEAM_FIXTURE=1 npx vitest run tests/catalog-seam-fixture.test.ts`; el job de CI es `desktop-rust.yml` (`cargo test` del crate completo) y corre dentro de `CI required` solo cuando el diff toca `src-tauri/` o el propio seam grabado (blocking-ci.yml `rust_changed`) — no en cada PR. La secuencia del reconciliador resultó ser `workspace_sync` → `catalog_list_binding_root_documents` → `catalog_apply_reconcile`, más lecturas `catalog_get_by_id`/`catalog_resolve_path`; el rename externo se resolvió por inodo tanto en `workspace_sync` (manifiesto) como en el reconciler (known bindings). Quedan fuera, como decía el Recon: el transporte IPC real (RUNTIME, ODE-622) y los comandos de sync/mutación (ODE-644 sigue abierto). **Fix ciclo 1 (review ronda 1 de ODE-613, 2026-09-30):** el fixture pasó a v2 para grabar también una proyección de la respuesta del doble por invoke y el replay Rust ahora afirma que la respuesta real coincide paso a paso — antes el replay era de lazo abierto y romper la correlación del rename en `workspace_sync` (M5) lo dejaba verde; ahora M5 lo pone rojo. Cuando el comando cambia de respuesta a propósito, además de regenerar el fixture hay que extender las proyecciones de ambos lados.

### Dos Workspaces (ODE-614)

**Montaje de dos Workspaces (extraído en ODE-614 a `tests/integration/documents/support/two-workspace-montage.ts`)**

- `cross-workspace-move.test.ts` (DOC-08/WS-02/SYS-04) y `workspace-switch-isolation.test.ts` (WS-06) consumen el mismo módulo; WATCH-04 lo reutilizará. La extracción fue movimiento puro (los dos tests de ODE-554 siguen intactos y verdes).
- El módulo expone:
  - `configureTwoWorkspaceBase(prefix)` — directorio temporal real + `configureRealDesktopDoubles` (:96), devuelve `{ baseDir, configDir, dispose }`; reemplaza el ciclo local :123-139;
  - `registerTwoWorkspaces(baseDir, configDir)` — las dos raíces reales (WorkspaceRecord + BindingRoot cada una); antes :141-170;
  - `catalogRow(configDir, id)` — fila del catálogo en memoria (antes :172-175, con la ruta de la DB repetida en :173, :209 y :253);
  - `bodyJson(text)` y `unimplemented(name)`;
  - `tauriCommandsModuleDouble(overrides)` — la tabla del `vi.mock` de `tauri-commands`. Tiene **29 entradas base** (la nota de review del Recon lo confirmó: no son 30) y `overrides` reemplaza/añade comandos; ODE-614 añadió por esa vía `tauriCatalogListCollectionSnapshot`, `tauriCatalogSaveCollection` y `tauriCatalogReplaceWritingCollections`, que en `real-desktop-doubles.ts` ahora tienen un store real en memoria (`collections` + `writing_collections`, espejo del SQL de `index.rs:1520-1730`; con cero colecciones creadas el snapshot sigue siendo el vacío genuino de antes).
- `support/` contiene `real-desktop-doubles.ts`, `fake-supabase-server.ts` (ODE-611/612) y `two-workspace-montage.ts` (ODE-614).
- Mockeados: `@tauri-apps/api/path` (68), `plugin-dialog` (70), `tauri-commands` (74), `runtime-detection` (106), `sync-service-factory` (113).
- El docblock (:12) dice que `SqliteDocumentCatalog` es "real (unmocked)". La clase sí es real, pero su almacén es el Map en memoria de `real-desktop-doubles.ts:38`, no SQLite.

**Navegación real entre vistas: hay dos rutas y solo una remonta la vista**

- **Desktop:**
  - el rail hace un `<Link href="/workspace?slug=…">` (`components/navigation/sidebar.tsx:732`);
  - `workspace-index.tsx:111` usa `router.push(buildWorkspaceHref)`, y `buildWorkspaceHref` (`lib/workspace/workspace-route.ts:11-16`) elige `?slug=` en desktop;
  - `components/workspace/desktop-workspace-entry.tsx` lee `useSearchParams().get("slug")` (:10) y renderiza `<WorkspaceDetail key={workspaceSlug} …>` (:21). **Remonta la vista en cada slug.**
- **Web:** `app/(app)/workspace/[slug]/page.tsx` renderiza `<WorkspaceDetail workspaceSlug={slug} />` **sin `key`**. En esa instancia, si sobrevive al cambio de slug, se conservan `hasLoadedWorkspaceRef` (237), `selectedFolderPath` (219), la selección (246) y los filtros (278), y no hay ningún efecto que los resetee al cambiar el slug.
- `hooks/useRailWorkspaces.ts` **no navega**: solo lista `getWorkspaceAssignmentService().listWorkspaces()` en un efecto con deps `[]` (22-48).
- Carga de la vista: `loadWorkspace` (`workspace-detail.tsx:280-320`, deps `[workspaceSlug]`):
  1. `getDesktopWorkspaceService().getWorkspace(slug)` (`lib/services/desktop/workspace-service.ts:317-334`, que hace `tauriWorkspaceSync(rootPath)`);
  2. `loadWorkspaceDocumentJoin(rootPath)` (293).
  - Se recarga al recibir foco (326-330) y ante cambios del catálogo, con un debounce de 100 ms (332-349).

**Estado de vista que puede filtrarse**

- `workspace-detail.tsx` usa `hooks/useDeskFilters.ts` (`useState`, 25-35) y `hooks/useWritingSelection.ts` (`useState<Set>`, :6). Los dos son estado por instancia, sin persistencia.
- **`useWorkspaceTableFilters` no lo usa la vista real**: solo aparece en `workspace-prototype-shell.tsx:1020`.
- La selección solo se limpia tras un borrado masivo (696) o cuando el usuario deselecciona (1502). El aislamiento depende enteramente del `key`.
- ODE-643 (`selectedIds`/`selectedIdsRef`) está en `components/editor/panels/writing-collections-section.tsx`, el panel de colecciones del editor. No es estado de la vista de Workspace.

**Fuente de las raíces y del filtrado**

- `getWorkspaceAssignmentService()` (`lib/services/workspace-service.ts:139-149`) devuelve el singleton desktop bajo Tauri y `Unavailable…` en otro caso. `listWorkspaces` → `listAssignableWorkspaces()` (`desktop/workspace-service.ts:809-816`).
- **El catálogo no filtra por raíz en la consulta** (`DocumentCatalogQuery`, `lib/services/contracts/document-catalog.ts:38-43`). `lib/queries/workspace-catalog-source.ts:47-67` trae todo (`limit 10_000`) y filtra en JS **por prefijo de ruta** (`isWithinRoot`, 36-39), no por `bindingRootId`.
  - Dos raíces hermanas quedan separadas, porque el prefijo exige un `/`.
  - Una raíz anidada dentro de otra filtraría filas a la exterior.
- Búsqueda:
  - dentro de la vista: `matchesFileQuery` (154-161) sobre `workspace.files` (358-363). Está acotada a la raíz por construcción;
  - global: `search-modal.tsx`, sin alcance de Workspace.

**Harness y trampas**

- ODE-614 agregó `tests/integration/documents/workspace-switch-isolation.test.ts`: el primer test que renderiza `WorkspaceDetail` y `DesktopWorkspaceEntry` reales. Corre la prueba en las dos entradas (desktop `?slug=` con `DesktopWorkspaceEntry`; web `/workspace/[slug]` renderizando `WorkspaceDetail` con la state key del segmento dinámico que pone el App Router — `slug|<valor>|d`, fix ciclo 1; sin ella la navegación de slug no remonta y el harness fabrica una fuga que el producto no tiene), espera por condición (header + filas) y afirma el DOM (filas, labels de los triggers del filtro, chips de colección, barra de selección). Además abre el homónimo por el opener unificado real (click de fila → `world.navigations` con `/write?id=`), prueba el Req. 4 (guardado real en B con el coordinador: cambio en B, fs y filas de A byte-idénticos) y el modo stale-listener (focus + cambio de catálogo tras el switch). Monta React con `createRoot` + `act`; necesita los parches de happy-dom que el harness de la shell ya conoce (`ResizeObserver`, `IntersectionObserver`, `matchMedia`).
- `tests/desk-workspace-catalog-integration.test.tsx` renderiza el prototipo, con todo mockeado (es un contract test).
- Para URLs mutables hay que reutilizar `nextNavigationDouble()` (`tests/support/editor-shell-doubles.ts:271-291`) y fijar `world.searchParams`.
- Trampas:
  1. Hay dos detectores de runtime: `isTauriRuntime` (`lib/runtime/detect.ts`, lo usan la entrada y el assignment service) e `isDesktopRuntime` (lo usan `buildWorkspaceHref` y `loadCatalogRecords`), aunque en el código vigente `lib/services/desktop/runtime-detection.ts` solo re-exporta `isTauriRuntime`. El montaje de ODE-614 dobla ambos módulos (`tauriRuntimeDetectDouble` + `runtimeDetectionDouble`) para que no diverjan.
  2. `getDesktopWorkspaceService()` es una promesa memoizada sobre `appConfigDir()` (`desktop/workspace-service.ts:1129-1137`). Debe apuntar al `configDir` del montaje y resetearse entre tests.
  3. En desktop, `loadCatalogRecords` importa dinámicamente `desktop-auth-service` (`lib/queries/document-catalog.ts:116`), que crea el cliente Supabase; sin sesión el error se traga y el scope queda `null` (no rompe el render).
  4. El debounce de 100 ms y el listener de `focus` obligan a esperar por condición.
  5. `useSearchParams` exige un Suspense en la página real; con el hook doblado no hace falta.
  6. Abrir un archivo va por `openWorkspaceFileInEditor(file, router)` (741). Con el router doblado se afirma el href y el `file.path`/id del join; el contenido se lee con el doble de `open_file`.
  7. `WritingPreviewModal` (importado por la vista aunque esté cerrado) llama a `createSharingService()` en un `useMemo` de montaje: hay que doblar `@/lib/services/sharing-service-factory` o el montaje revienta con `supabaseUrl is required`.
  8. El toolbar usa Popovers de Radix: abrirlos con `pointerdown` + `click` sintéticos (mismo patrón que `tests/settings-vocabulary.test.tsx`).

### Transversal

**Flakes conocidos que tocan estas redes (en Backlog)**

- **ODE-623:** `tests/desk-workspace-catalog-integration.test.tsx:551`, 5 recargas donde se esperaba 1 bajo carga. Relevante para ODE-614 si se toca Desk o el catálogo de Workspace.
- **ODE-639 y ODE-641:** `waitFor` de 2000 ms y timeout de 5 s en el harness de la shell (`editor-shell-commands`, `editor-shell-blank-draft-web`). Solo afectan si un escenario monta `EditorShell`. Ninguno de los cuatro issues lo necesita a nivel servicio o vista.

**Recuento del capability map, parseando la columna Status:**

```sh
awk -F'|' '/^# Audit Summary/{exit} /^\| *[A-Z]+-[0-9]+ *\|/{s=$6; gsub(/[ *`]/,"",s); c[s]++; n++} END{for(k in c) printf "%s=%d\n",k,c[k]; print "total="n}' workflow/quality/capability-integration-map.md | sort
```

En main@6e803d21 devuelve `CONTRACT=8, INTEGRATION=31, NONE=6, PARTIAL_INTEGRATION=49, RELEASE=1, UNIT_ONLY=12, total=107`, igual que la tabla "Coverage breakdown".

**Corrección ODE-614 (BUILD, 2026-09-30):** aquel recuento quedó viejo en dos pasos. En `main@5e58443e` (base de ODE-614) el mismo comando devuelve `INTEGRATION=33, PARTIAL_INTEGRATION=47, NONE=6, total=107` (ODE-613 movió SYS-01/SYS-05). Tras el fix ciclo 1 de ODE-614 (2026-09-30, tras el FAIL de review): `NONE=5, PARTIAL_INTEGRATION=47, INTEGRATION=34, total=107` — la fila WS-06 pasa de `NONE` a `INTEGRATION` porque las dos entradas quedan probadas y mutation-tested (el ciclo 0 la había dejado en `PARTIAL_INTEGRATION` por una fuga web que resultó ser del harness: Next sí remonta por state key de segmento, la premisa "sin `key` → la instancia sobrevive" era falsa y el falso positivo se canceló).

**ODE-636, fix cycle 1:** the same parser returns `CONTRACT=7, INTEGRATION=36, NONE=5, PARTIAL_INTEGRATION=46, RELEASE=1, UNIT_ONLY=12, total=107`. EXP-05 stays `PARTIAL_INTEGRATION` because the proof does not cover an export racing a tab switch; the row names that exact open seam.

**Estado de WS-06 tras el fix ciclo 1 de ODE-614:** `INTEGRATION`. Evidencia: `tests/integration/documents/workspace-switch-isolation.test.ts` (tres pruebas por runtime — control positivo del estado de vista, aislamiento, y alcance de documentos/colecciones con apertura del homónimo por el opener unificado — más una prueba de Req. 4: un guardado real en B no toca archivos ni filas de A). La entrada web reproduce el remontaje real del App Router con la state key del segmento `[slug]` (`layout-router.js:510`, `createRouterCacheKey` → `slug|<valor>|d`); la mutación de control que quita esa key pone rojo el aislamiento. El montaje de dos raíces se comparte con WATCH-04. Quedan como fronteras declaradas: el transporte IPC nativo (mismo seam que DOC-08) y que la entrada web modela el remontaje del router desde su state key citada, no a través de un router de Next vivo (plomería RSC no ejercitada).

**No explorado en este Recon:**
- los tests Rust de `commands/workspace.rs` (`workspace_sync`);
- ~~el camino web de `/workspace/[slug]` en ejecución~~ — explorado por ODE-614 y cerrado en su fix ciclo 1: el remontaje real del App Router se modela con la state key del segmento (decisión del humano 2026-09-30), la apertura del homónimo por el opener unificado (click de fila → `/write?id=`) y la escritura en B (requirement 4) ya están afirmadas;
- `restoreWriting` y `registerBinding` web (read-then-write, citados en la fila SYNC-03).

## Mapa de Recon — milestone 4, tanda 2 (ODE-593, 619, 620, 621, 636, 637)

**Verificado en: main@5e58443e (2026-09-30).** Solo lectura del código en ese commit; no se ejecutó ningún test ni `cargo test`. Los hallazgos que cambian alcance se re-verificaron a mano (los marcados ✔). Cada issue lleva su Recon Pack completo como comentario en Linear (`## Recon Pack (verificado en main@5e58443e)`); este mapa resume lo que comparten y lo que un BUILD no debe redescubrir. Cuando BUILD encuentre algo distinto, corrige este mapa en su PR.

### Hallazgos que cambian el alcance de los briefs

| Issue | Hallazgo | Evidencia |
|---|---|---|
| ODE-637 | ✔ El filtro de auto-escritura que alimenta la shell es `configureRootWatcher` (`lib/services/desktop/desktop-workspace-reconciler.ts:110`, `isOdessaySelfWriteEvent` en `:142`). `shouldIgnoreWorkspaceWatchEvent` (`workspace-service.ts:1108`) solo lo usan `watchWorkspace`/`watchWorkspaces` (`:949`, `:1012`), sin llamadores: código muerto. | brief ya corregido |
| ODE-637 | ✔ Parte 1 probada: con el `tauri-commands` real y un hold después de `fs.writeFile`, la ruta propia y su `.tmp` están marcadas mientras el evento llega; no aparece el banner de conflicto/recarga ni se programa otro `workspace_sync` para la raíz. El control externo posterior a 2.1 s sí levanta el banner; un evento mixto conserva y reconcilia el archivo externo. Quitar todas las marcas o solo la de `.tmp` vuelve roja la aserción del banner; forzar `isOdessaySelfWriteEvent` a `false` hace roja la aserción propia y forzarlo a `true` hace rojo el control externo. Parte 2 (proyecciones hash reales/Rust) seguía pendiente al verificar el mapa; ODE-637 P2 la cierra con el fixture v3 y el replay documentado en el inventario del seam. | `tests/integration/documents/watch07-self-write-suppression.test.tsx`; `tauriWriteFile`; `configureRootWatcher` |
| ODE-637 | Parte 2: el grabador usa un hash falso (`tests/support/catalog-seam-recorder.ts:137-143`) y ninguna proyección lleva `contentHash` (`:160-207`). Un escenario de edición externa pasaría sin que Rust detecte nada. Requiere blake3 real (`computeMarkdownContentHash`) + `contentHash` en las proyecciones → fixture v3 (regenera los 3 escenarios) y `src-tauri/tests/catalog_seam.rs`. Sin Rust de producción. Entregado en ODE-637 P2; ver inventario del seam, §3. | |
| ODE-636 | ✔ Corrección del Recon: en `main@5e58443e`, el callback de Collections que devuelve `true` está en `components/collections/collections-view.tsx:501` (no `:502`). La mutación de éxito incondicional hizo fallar ambos previews porque faltó la llamada al diálogo; salida: `expected [] to have a length of 1 but got +0`. El cuerpo vacío de Desk también se reprodujo con el valor `body_json` de la fila: el test recibió `expected '\n' to contain 'ODE636-DESK-MARKDOWN-BODY'`; ahora lee el `.md` canónico vía `DesktopDocumentService.openWriting`. | `tests/editor-shell-export-delivery-desktop.test.tsx`; salida roja pegada en el Context Report de ODE-636 |
| ODE-636 | ✔ La causa del cuelgue de `act()` era el doble de `useWritingPreviewCache`: devolvía `vi.fn()` nuevas en cada render y reactivaba el efecto de `writing-preview-modal.tsx:412-476`. Con funciones estables, `tests/preview-modal.test.tsx` termina y pasa; las páginas reales se montan en el test de export. | `tests/preview-modal.test.tsx`; `tests/editor-shell-export-delivery-desktop.test.tsx` |
| ODE-619 | ✔ `importDesktopWritingFile` (`lib/services/document-service-factory.ts:1043`) no corre en producción: `isUnifiedOpenEnabled()` = `isDesktopRuntime()` (`lib/services/open-document-factory.ts:8-10`), así que `handleMenuOpenFile` siempre toma el opener unificado (`editor-shell.tsx:2096`) y la rama de `:2162` es muerta. Un proof sobre esa función es `NON_PRODUCTION_PATH`. En desktop "importar" = Open File, que adopta en su sitio. El requisito "metadata del front matter en la fila" contradice ADR D4. | |
| ODE-620 | ✔ La respuesta de sugerencia no está atada al documento que la pidió (`components/editor/modals/rename-writing-modal.tsx:47-72`). En Desk (`desk/page.tsx:1026`), Collections y Workspace el modal queda montado con `open=false`; una respuesta tardía de A aparece en el modal de B. En la shell no (se desmonta, `editor-shell.tsx:2971`). Bug real alcanzable → `it.fails` primero. | |
| ODE-593 | ✔ Rust ya devuelve la ruta conservada (`src-tauri/src/commands/document.rs:200-205`), pero `WriteFileConflictError` no tiene campos (`lib/services/desktop/write-file-conflict-error.ts:12-17`), el `err` de `FilesystemDocumentService` no admite `details` y la ruta muere en `console.error` (`hooks/useEditorPersistence.ts:340-365`). La ruta llega por `onError`, no por `useExternalDocumentChanges`. | |
| ODE-621 | Decisions (Hugo, 2026-09-30): EXP-04=A using ODE-601's real export/filesystem path; ODE-636 runs the canonicalPath → writingId mutation and derives the row status. SYS-02=A stays CONTRACT; the AST scan covers only DesktopDocumentService methods, so ODE-647 extends it to module-level functions. SYNC-08 gets ODE-648 (High), a TypeScript proof reusing ODE-611 for cloud-only binding:null and pending-save + metadata; review correction: desktop-settings-service.ts:473 is the binding:null producer, :478 is mutationKind. Coordinate the real Rust replay at index.rs:704-711 with ODE-644. |

### Andamiajes que reutiliza cada issue

| Issue | Montaje | Qué es real / qué falta |
|---|---|---|
| ODE-637 P1 | `tests/integration/documents/watch07-self-write-suppression.test.tsx` (`EditorShell` montada, reconciliador real, filtro `configureRootWatcher` y wrappers `tauri-commands` reales; `tauriInvokeRouterDouble` y watcher/event transport se doblan; los dobles de comandos escriben en un fs temporal real y el catálogo es un doble conductual, sin SQLite real). El router traduce formas de IPC, el doble retiene `write_file` después del write real a disco, y las cuatro mutaciones cubren marca de ruta, `.tmp` y filtro en ambos sentidos; observable propio, control externo y evento mixto. La costura IPC→Rust/SQLite y las proyecciones de hash son Parte 2. |
| ODE-637 P2 | `catalog-seam-recorder.ts` + `catalog-seam-fixture.test.ts` + `src-tauri/tests/catalog_seam.rs` | Ver hallazgo: fixture v3 con hash real. |
| ODE-636 | `tests/editor-shell-export-delivery-desktop.test.tsx`: monta `DeskPage` y `CollectionsView` reales, además del `EditorShell` de ODE-601. Los recorridos reales activan Markdown desde ambos previews y ambos menús de fila; ambos previews y menús cubren éxito, cancelación y error de escritura; Desk también cubre PDF/DOCX. Se cubren además el error de lectura de Collections y el rechazo de copia Markdown desde una fila de Desk. | Son reales `DesktopDocumentService`, `SqliteDocumentCatalog`, `FilesystemDocumentService`, `saveBinaryArtifact`, `saveDesktopBinaryExport`, las páginas y sus callbacks. Tauri IPC y diálogo nativo son boundaries doblados; `tauriWriteBinaryFileDouble` escribe en filesystem temporal real. El test verifica el contenido del `.md` canónico y los bytes en el destino elegido. El mock de `useWritingPreviewCache` usa funciones estables. La carrera "export vs cambio de pestaña" queda sin probar y mantiene EXP-05 en `PARTIAL_INTEGRATION`; `WKWebView/DMG not proven (D4: manual release check, non-blocking)`. Las salidas rojas de las mutaciones están pegadas en el Context Report de ODE-636. |
| ODE-619 | `tests/editor-shell-open-file-adopts.test.tsx`: monta `EditorShell` desktop real y entra por `menu:open-file`; también monta `useGlobalOpenFileMenu` fuera de Write con un control positivo y una ruta rechazada. El flujo de shell conecta `openDocumentByPath` → use case/adaptador de apertura → `SqliteDocumentCatalog` real como clase → archivo temporal real. | Prueba el front matter como contenido, título del filename, archivo vacío, reapertura con el mismo UUID y recuperación del UUID del manifest después de un rechazo puntual del catálogo. También verifica que el rechazo de `open_file` por UTF-8 inválido muestra el aviso aprobado y mantiene el número de pestañas, el tab activo, los bytes originales y la ausencia de una fila del catálogo; el rechazo del catálogo afirma su alert y el número de pestañas antes de reabrir. Fuera de Write, el control positivo confirma el handoff de archivo pendiente y la navegación; el rechazo no encola contenido ni navega. La lectura satisfactoria de `open_file` usa el doble canónico sobre fs real; Tauri/IPC y el estado de manifest/catalog/settings se modelan en memoria, y `createDesktopClient` devuelve sesión vacía. El wrapper local del test rechaza una sola `tauriCatalogDualWrite` del path objetivo y delega las demás llamadas. El mutation de path-as-id vuelve roja la aserción UUID. Sin ejecución real de Rust/SQLite ni serialización real de `.odessay/index.json`. |
| ODE-620 | `tests/integration/ai/suggest-title-lifecycle.test.ts` extends AI-01's existing URL-routed fetch: real web `EditorShell` and `RenameWritingModal` call real `webAIService` → real POST route; `localDB` uses fake-indexeddb. Web proof covers provider timeout (the fake observes and honors the route `AbortSignal`; fake timers only `setTimeout`/`clearTimeout`), provider 503, provider network rejection, DOM error/loading reset, unchanged title/body, and healthy retry. The A→B proof keeps one real modal mounted with Desk's `open`/`writingId` prop sequence, proves A's suggestion as a positive control, then holds A and B provider replies to assert stale success/error are discarded and B's loading/suggestion remain correct. | Provider and auth/admission are boundary fakes; modal, service, URL-routed real route and `localDB` API are real. Desktop's absolute `NEXT_PUBLIC_APP_URL` plus Bearer request is not exercised and is named as the open seam in AI-03. |
| ODE-647 | tests/services/document-service-factory.test.ts (extend the canonical AST scan) | Reuse its parser and runtime assertion; add the three module-level functions. Static source proof only; no new product or Rust harness. |
| ODE-648 | tests/integration/sync/desktop-sync-multiple-saves-before-flush.test.ts (ODE-611) | Real DesktopDocumentService, SqliteDocumentCatalog, desktopCatalogSyncService, temporary .md; Supabase and Tauri IPC decode are the only doubles in the critical data path; retain ODE-611's no-op sync-service-factory control only to suppress automatic debounce while calling real flushPending(). Add cloud-only binding:null and pending-save + metadata cases. Native replay remains with ODE-644. |
| ODE-617 A | `tests/editor-shell-visibility-persistence.test.tsx` (web) + `tests/editor-shell-visibility-persistence.desktop.test.tsx`: real `EditorShell` by route, real `PropertiesPanel` guard (real "Properties panel" button → real "Share" tab) forcing private→shared, real `persistEditorSnapshot` → `DocumentService` → save chain. On web the real `SyncWorker` PATCH body is read by substituting `world.network` (the shared harness is untouched); on desktop the durable `sync_mutations.payloadJson` is read from the canonical catalog double. | Web: real `localDB` (fake-indexeddb); the network is the only double on the critical path and the PATCH body is asserted explicitly. Desktop: real `SqliteDocumentCatalog` and real temporary `.md`; Tauri IPC decode and the sync service are doubled (same montage as the rest of the desktop harness), and Supabase/auth for the sharing list is a minimal external double. A session reload is a shell remount by route on both runtimes. PR-B (Supabase local, stranger access, cloud reload) remains open and is named in the SHARE-05 row. |
| ODE-593 | `tests/editor-shell-external-changes-desktop.test.tsx` (`beginKeptVersionDoubleRace`) + `doubleRaceNextWriteFile` (`tests/integration/documents/support/real-desktop-doubles.ts:300-332, 420-490`): starts after the expected-hash check, holds the commit window while the real watcher/reconciler/catalog process external version 1, then simulates external version 2 during Rust’s restore exchange: the target retains external 1, `.conflict-<id>` (or `.tmp` when `keepBesideFails`) contains external 2, and the write rejects with Rust’s literal error. The app’s attempted bytes never reach disk; they remain in the editor until the user chooses `Keep my version`. | `WriteFileConflictError` parsing remains real (`write-file-conflict-error.ts`); the harness mocks `tauri-commands` as a whole. The tests cover both notice branches, Finder’s `dirname(keptPath)` action, removal on Reload or Keep my version, and a live parser mutation. |

### Trampas transversales

- **Relojes reales en el harness de la shell:** `advance` usa `setTimeout` real (`editor-shell-harness.tsx:344-349`). La ventana de 2 s de auto-escritura y el timeout de 45 s de la ruta de títulos piden `advance(≥2100)` o fake timers acotados a `setTimeout`/`clearTimeout`; vigilar el timeout de 60 s por test.
- **Estado global de módulo:** el mapa de marcas de auto-escritura (`clearOdessaySelfWritePathsForTests`, `tauri-fs-watch.ts:160`) y el singleton del reconciliador (`disposeWorkspaceReconciler`) se limpian en cada test.
- **Ratchet de espejos:** `tests/architecture/editor-shell-mirrors-ratchet.test.ts` prohíbe un `useEffect` que solo asigne un ref (ODE-593 añade estado en la shell).
- **Ausencias con control positivo** (regla 8): ODE-637 (banner falso), ODE-620 (sugerencia filtrada), ODE-636 (archivo no escrito), ODE-619 (ninguna fila tras el rechazo del catálogo, precedida por una adopción positiva con el mismo harness).
- `scripts/linear-cli.mjs` no crea issues: los issues nuevos (ODE-621) van por GraphQL directo.

### Archivos compartidos y orden

- `workflow/quality/capability-integration-map.md`: lo tocan los seis (filas WATCH-07, EXP-05, EXP-04, SYS-02, SYNC-08, DOC-09, AI-03 y el log). Conflictos de texto, no de código: merges en serie.
- `tests/integration/documents/support/real-desktop-doubles.ts`: ODE-593 (modo doble carrera), ODE-637 (router), ODE-636/619 (lectura). ODE-593 antes de ODE-637: el parse en la clase sobrevive al cambio de harness.
- `tests/support/catalog-seam-recorder.ts` y el fixture: ODE-637 P2 y ODE-644 (fuera de esta tanda). El segundo rebasea y regenera.
- `components/editor/editor-shell.tsx`: ODE-593 (banner) y ODE-619 (borrar la rama muerta, si se aprueba).

### Recuento del capability map

El comando de la sección anterior, en main@5e58443e: `CONTRACT=8, INTEGRATION=33, NONE=6, PARTIAL_INTEGRATION=47, RELEASE=1, UNIT_ONLY=12, total=107`. Filas de esta tanda: WATCH-07 y EXP-05 `PARTIAL_INTEGRATION`; EXP-04, SYS-02 y SYNC-08 `CONTRACT`; DOC-09 y AI-03 `NONE`.

**No explorado en esta tanda:** el comportamiento de `<a download>` en WKWebView (solo en el DMG), el transporte IPC real, y la carrera simple de ODE-593 contra la ventana de 2 s (sospecha: un evento externo dentro de la ventana marcada antes del `invoke` podría suprimirse; queda para ODE-637).

## Mapa de Recon — milestone 4, tanda 3 (ODE-615, 616, 617, 618, 547, 631, 643, 644, 657, 658, 659, 660)

**Verificado en: main@210bc0e6 (2026-10-01).** Recon y auditoría en solo lectura: no se ejecutó ningún test, ni `cargo test`, ni Supabase. Cada issue lleva:

- en la descripción, las secciones "Recon y decisiones — tanda 3", "Auditoría (2026-10-01, ronda 2)" (que manda) y `## Architecture Contract`;
- un comentario `## Recon Pack (verificado en main@210bc0e6)`;
- un comentario `## Decisiones (Hugo, 2026-10-01)`.

`ops:brief:lint --require-recon` pasa en las 12. Si BUILD encuentra algo distinto, corrige este mapa en su PR.

### Hallazgos que cambian el alcance de los briefs

| Issue | Hallazgo | Evidencia |
|---|---|---|
| ODE-657 (nuevo) | Un archivo movido fuera de la app entre dos raíces vigiladas recibe un UUID nuevo, y el original se desliga. B acuña el UUID en el wrapper y lo adopta por la regla 0 del manifest; A desliga con un DELETE sin filtro de raíz. La correlación por inode no cruza raíces en ninguna capa. El spec ya lo exige. ODE-657 bloquea a ODE-615 (decisión de Hugo: primero el fix, después la prueba). | `tauri-commands.ts:223-233`, `workspace-reconciler.ts:305-307` y `:208-220`, `index.rs:1334-1337`, `workspace.rs:809-858`; spec `:383` |
| ODE-616 | F1: `/shared/[id]`, import, `listIncomingShares` y la RPC `list_incoming_shared_writings` aceptan una fila de share sin mirar la visibilidad, mientras que `can_read_writing` exige `shared`. Desktop puede crear "privado con share" (`desktop-catalog-sync-service.ts:320`). F1c: la secuencia anterior/siguiente muestra el slug de esos documentos. F2: `generateMetadata` obtiene el título con el cliente admin sin auth. | `page.tsx:64-71`, `:88-101`, `:117-150`; `import/route.ts:102-117`; `web-sharing-service.ts:483-517`; `initial_schema.sql:482-509` |
| ODE-616 | `listSharedWritingsForUser` no tiene callers (NON_PRODUCTION_PATH). El listado productivo es `/api/shared/writings` → `listIncomingShares`. `tests/shared-page.test.tsx` prueba `app/(app)/shared/page`, no `/shared/[id]`. | `lib/sharing/shared-writings.ts:30-71` |
| ODE-618 | F6: `catalog_delete_collection` no borra `writing_collections`, y el snapshot devuelve todas las relaciones. Un documento cuya única colección se borró desaparece de la vista Collections. Desktop no reescribe front matter. | `index.rs:1657-1674`, `:1596`, `:1618`; `collections.ts:57-67` |
| ODE-644 | El bug también existe en `catalog_update_metadata_mutation_status`, y la UI de colecciones lo alcanza. Los `it.fails` de ODE-611 corren contra un doble TS que copia el SQL: arreglar solo Rust no los pone verdes. | `index.rs:1409-1443`, `:1745-1759`; `real-desktop-doubles.ts:1236-1278` |
| ODE-659 | El slug sale del título y es único por autor. La página redirige id → slug y la lista enlaza por slug, así que dos documentos compartidos llamados "Notes" dan 500. Decisión: el id es la URL canónica. Se fusiona en ODE-616 PR2. | `page.tsx:40-62`, `:103-105`; `shared-with-me-list.tsx:63-65` |
| ODE-660 | Responder 404 rompería la cola web: crear una colección y borrarla offline produce un DELETE de una fila que nunca existió, con 10 reintentos. Decisión: 200 con `{ deleted: boolean }`. | `lib/local-db/index.ts:1074-1094`; `worker.ts:42-65`, `:366-423` |
| ODE-631 | WATCH-07 ya está en INTEGRATION (ODE-637). El cambio se reduce a `diagnostic.md:949`; el mapa no se toca. | mapa `:239` |

### Grafo de conflictos (solo código, tests, dobles y fixtures)

No cuentan como conflicto `capability-integration-map.md`, este catálogo, `built.jsonl` ni `review-history.jsonl`. Cada PR edita solo su fila o su sección, y la sección "Recuento del capability map" no se toca.

| Recurso compartido | Issues / PRs | Orden |
|---|---|---|
| `tests/integration/documents/support/real-desktop-doubles.ts` | 644-PR1 (`:1236-1278`), 618-PR1 (doble nuevo de delete + comentario `:1280`), 657 (`:693-801`), 618-PR1b, 617-B (doble de cloud snapshot, si hay fix) | 644-PR1 → 618-PR1; 657 independiente en región, pero se mergea en serie |
| `src-tauri/src/commands/index.rs` | 644-PR1, 618-PR1b, 617-B (solo si se reproduce el bug de hidratación) | 644-PR1 → 618-PR1b; 644-PR1 → 617-B |
| Seam ODE-613 (`catalog-seam-recorder.ts`, `catalog-seam-v3.json`, `catalog_seam.rs`) | 657, 644-PR2 | 657 → 644-PR2 (el segundo regenera, nunca se fusiona a mano) |
| Tests de 657 (`external-move-across-roots.test.tsx`) | 657, 615 | 657 → 615 |
| `vitest.config.ts`, `package.json`, `supabase/config.toml`, harness Supabase | 616-PR1 (crea), 658 | 616-PR1 → todo lo que use Supabase local |
| `app/(reading)/shared/[id]/page.tsx` y la lista de compartidos | 616-PR2 + 659 (mismo PR) | — |
| `app/api/collections/[id]/route.ts` (tests) | 618-PR2, 660 | 618-PR2 → 660 |
| Regla de acceso de 616-PR2 (F1) | 617-B (Requirement 2 en `/shared`) | 616-PR2 → 617-B |

Sin conflicto con nadie: 631, 643 (sin la nota opcional del diagnóstico), 547-PR1 (archivo Rust nuevo), 547-PR2 (otro archivo pgTAP), 617-A y 658 (después de 616-PR1).

### Olas (máximo 3 builders a la vez)

- **Ola 1, sin Docker:** 644-PR1 (Urgent) · 657 (L) · 643 · 631 · 547-PR1 · 617-A · 618-PR1 (cuando 644-PR1 esté mergeado).
- **Ola 2, con Docker:**
  - primero 616-PR1 (harness: `[auth.rate_limit]`, reinicio del stack y lock);
  - luego 616-PR2 (+659) · 618-PR2 · 547-PR2 · 658;
  - después 660 (tras 618-PR2) y 617-B (tras 616-PR2 y 644-PR1).
- **Ola 3:**
  - 618-PR1b (tras 644-PR1 y 618-PR1);
  - 615 (tras 657);
  - 644-PR2 (necesita brief propio por wf-define y va tras 657).

### Trampas transversales

- **Instancia Supabase local compartida.** Una sola (`project_id "odessay"`). Todo pasa por el lock de 616-PR1 (`npm run test:supabase` y `npm run supabase:locked -- …`).
  - Prohibido: `supabase stop`, `db reset`, `migration up`/`repair`, `--linked`, `db push`, `config push`.
  - No copiar `supabase/.temp` a los worktrees: el checkout principal está linkeado a producción.
  - Cada archivo usa su propio `runId` y nunca trunca tablas.
- **`.env.local` en los worktrees.** Es un symlink al del checkout principal y contiene la service role key de **producción**. Fuera del harness, que la descarta y exige localhost, ningún script usa `SUPABASE_SERVICE_ROLE_KEY`.
- **`vitest.config.ts` no excluye `.cache/**`** hasta 616-PR1. `npm test` en el checkout principal recoge los worktrees que haya en `.cache/`.
- **Rust sin `it.fails`.** Primero un commit con el cargo test en rojo (con la salida pegada), después el verde sin editar el test.
- **Cargo.** Un worktree nuevo recompila el crate entero. Clonar el target con `cp -cR <main>/src-tauri/target <wt>/src-tauri/` (APFS).
- **Follow-ups.** No se crean issues durante la orquestación. Se usa un `it.fails` con "follow-up pendiente (ODE-<propio>)" y se reporta en el Context Report.

### Recuento del capability map (tanda 3)

El comando de la sección "Recuento del capability map", en main@210bc0e6, da `CONTRACT=7, INTEGRATION=37, NONE=3, PARTIAL_INTEGRATION=47, RELEASE=1, UNIT_ONLY=12, total=107`. Filas de esta tanda:

| Fila | Status |
|---|---|
| WATCH-04 | `UNIT_ONLY` |
| SHARE-04 | `PARTIAL_INTEGRATION` |
| SHARE-05 | `NONE` |
| COL-06 | `NONE` |
| CONFIG-07 | `INTEGRATION` |
| SYNC-05 | `PARTIAL_INTEGRATION` |

**No explorado en esta tanda:**
- si el título de F2 llega al HTML en Next 15.5 (BUILD lo confirma con curl, como evidencia informativa);
- la caché de "Shared with me" de desktop (sin caché persistente según el código);
- el transporte IPC real.

## Harness Supabase local (ODE-616)

**Creado en:** ODE-616 PR1 (2026-10-01). El PR2 de ODE-616 construye encima el proof service-role de SHARE-04; además lo consumen ODE-617-B, la parte web de ODE-618, ODE-659 y ODE-660.

**Qué es.** Un harness de Vitest contra la única instancia Supabase local (`project_id "odessay"`, API 54321, DB 54322) para ejercitar los caminos que saltan RLS a propósito (cliente admin/service role) con Postgres real y la app real. pgTAP no alcanza ese camino porque el código bajo prueba es TypeScript; los tests unitarios existentes de esos caminos son mock-based.

**Owner de los archivos.**

- `vitest.supabase.config.ts` — `environment: "node"`; incluye `tests/**/*.supabase.test.{ts,tsx}`; setupFile `tests/support/supabase-local/guard.ts`; `fileParallelism: false`; `testTimeout: 30000`. **No** usa `mergeConfig` (el `exclude` base concatena arrays y heredaría `**/*.supabase.test.*`, con lo que la suite no correría nada) ni `loadEnv`. Sin `passWithNoTests`: 0 tests es un fallo.
- `scripts/run-supabase-tests.mjs` — `npm run test:supabase [archivo...]`.
- `scripts/supabase-locked.mjs` — `npm run supabase:locked -- <cmd>` (pgTAP, `psql`, DDL y migraciones).
- `scripts/lib/supabase-local-env.mjs`, `scripts/lib/supabase-lock.mjs`, `scripts/lib/supabase-local-db.mjs`.
- `tests/support/supabase-local/` — `guard.ts`, `local-supabase.ts`, `fixtures.ts`, `session.ts`, `route-fetch.ts`. Sin imports de la app.
- `tests/supabase-lock.test.ts`, `tests/supabase-local-fixtures.test.ts` — tests unitarios de la propia infraestructura (los corre `npm test`; no necesitan el stack).
- `vitest.config.ts` — excluye `**/*.supabase.test.*` y `**/.cache/**`; `package.json` — los dos scripts.

**Contrato del runner.**

- Toma el lock `$(git rev-parse --git-common-dir)/odessay-supabase-local.lock` (mkdir atómico con pid, worktree, hora y token; huérfano si el pid ya no existe; sin owner legible caduca a los 15 min). `supabase:locked` toma el mismo lock.
  - El reclamo de un huérfano pasa por `mkdir <lock>.reclaim`: solo un waiter gana la reclamación y borra el lock; el resto espera. Si el ganador muere, el claim con pid muerto se mueve con rename a un tombstone único antes de reintentar. `release()` verifica el token del owner: no borra un lock ajeno.
  - `tests/supabase-lock.test.ts` cubre la carrera con dos procesos reales y un repo git temporal (sin tocar la instancia compartida).
- Exige `supabase status -o json`; si el stack no está arriba, aborta con salida clara.
- Borra **toda** variable heredada que contenga `SUPABASE` (case-insensitive) y las `TAURI_*`, y exporta SOLO `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` y `SUPABASE_SERVICE_ROLE_KEY` locales. El `.env.local` de cada worktree es un symlink al del checkout principal y trae la service role de **producción**: ninguna corrida del harness puede verla.
- Preflight: si quedan funciones o triggers `zz_mutation_%` en `public` (una mutación anterior quedó a medias), aborta y muestra el comando de limpieza.
- El guard de Vitest corre antes de importar la app y aborta si el host no es `127.0.0.1`/`localhost`, si falta la service key o si la URL no coincide con `supabase status`.

**Cómo se usa.**

```sh
npm run test:supabase                                   # toda la suite .supabase.test.*
npm run test:supabase -- tests/integration/sharing/x.supabase.test.ts
npm run supabase:locked -- supabase test db --local
npm run supabase:locked -- psql "<DB_URL>" -c "<DDL>"
npm run supabase:locked -- psql "<DB_URL>" -f supabase/migrations/<nueva>.sql
```

**Helpers** (detalle en `tests/support/supabase-local/`).

- `seedUsers(tag, roles)` → `{id, email, password, username, accessToken, refreshToken}`. Crea con `auth.admin.createUser` (`email_confirm`, `user_metadata.username`; el trigger crea el profile), **lee el username real de `profiles`** (porque `ensure_unique_username` normaliza y agrega sufijos) y hace **un** `signInWithPassword` por usuario. Si falla la lectura del profile o el signIn, borra las cuentas ya creadas antes de propagar el error (el caller no ve la lista parcial). `cleanupUsers` borra por `deleteUser` → cascada. `tests/supabase-local-fixtures.test.ts` cubre el camino de error doblando solo el cliente de Supabase.
- `createLocalAdminClient()` (service role, PostgREST real) y `createUserClient(user)` (anon + `setSession` = RLS real).
- `seedWriting(admin, {...})` privilegiado; `seedShare` / `seedCollection` / `seedMembership` por RLS **como dueño**; `readRow`/`readRows` por admin.
- `session.ts` — `bearerRequest`, `serverClientAs`/`serverClientMockFactory` (sustituye `@/lib/supabase/server#createClient` por un cliente real, solo se fakea el transporte de cookies), `mockEmptyCookies`, `expectNotFound`/`expectRedirect` (digest `NEXT_HTTP_ERROR_FALLBACK;404` / `NEXT_REDIRECT`).
- `route-fetch.ts` — `createRouteFetch(routes, {as})`: `/api/...` entra al handler real con Bearer, `http://127.0.0.1:54321` usa fetch real y cualquier otra URL lanza.

**Aislamiento.** Un `runId`/tag por archivo; solo se borran los usuarios propios; nunca se trunca una tabla (la instancia se comparte entre worktrees). No copiar `supabase/.temp` a los worktrees: el checkout principal está linkeado a producción.

**CI (ODE-658).** `.github/workflows/supabase-local.yml` (reusable: `workflow_call` + `workflow_dispatch`; `permissions: contents: read`) levanta la instancia local en `ubuntu-latest` (`timeout-minutes: 20`) y corre `supabase test db --local` (los 6 pgTAP) + `npm run test:supabase`. Usa `supabase/setup-cli@v1` fijado a 2.113.0 y `supabase start -x studio,imgproxy,mailpit,realtime,edge-runtime,logflare,vector,postgres-meta,supavisor`; `supabase stop --no-backup` va en `if: always()`. Cada job es un runner aislado: declara checkout, setup-node (`node-version-file: package.json`, cache npm), `npm ci` y CLI propios. Un guard falla si el entorno trae cualquier variable `*SUPABASE*` (solo nombres de variable; no inspecciona valores).

`blocking-ci.yml` lo llama como job `supabase-local` con `needs: [detect-changes, process-checks]` y `if: supabase_changed == 'true' && process-checks.result == 'success'`. Va **sin** `secrets: inherit` (no recibe la URL ni la publishable key de PRODUCCIÓN, ni `TAURI_SIGNING_PRIVATE_KEY`) y **fuera** de `required.needs`: un fallo no bloquea `CI required` mientras no sea required (dos semanas en verde lo deciden). `detect-changes` agrega el output `supabase_changed` con: `supabase/**`, `lib/supabase/**`, `lib/sharing/**`, `lib/services/web-sharing-service.ts`, `lib/collections/**`, `app/api/**`, `app/(reading)/shared/**`, `app/[username]/**`, `tests/**/*.supabase.test.*`, `tests/support/supabase-local/**`, `vitest.supabase.config.ts`, `scripts/run-supabase-tests.mjs`, `package.json`, `package-lock.json` y los dos workflows.

**Trampas pagadas.**

- **Volumen viejo vs. ACL de `service_role`.** Un volumen creado por una imagen anterior del stack deja la ACL por defecto de `public` con `service_role` en solo `Dxtm` (truncate/references/trigger), así que `createAdminClient` local recibe `permission denied for table ...`. Un volumen nuevo ya trae `ALL` (el init de la imagen lo concede). Verificar con `has_table_privilege('service_role','public.writings','select')`; si da `f`, reparar **solo local** bajo lock: `npm run supabase:locked -- psql "<DB_URL>" -c "grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant all on all functions in schema public to service_role; alter default privileges in schema public grant all on tables to service_role; alter default privileges in schema public grant all on sequences to service_role; alter default privileges in schema public grant all on functions to service_role;"`.
- **`[auth.rate_limit].sign_in_sign_ups`.** Con CLI 2.113 + gotrue v2.195 la clave se parsea pero no llega al contenedor: esa versión no tiene `GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS`. Sí se aplican `token_refresh` y `token_verifications` (`GOTRUE_RATE_LIMIT_TOKEN_REFRESH`, `GOTRUE_RATE_LIMIT_VERIFY`). La config se mantiene (no afecta a remoto y cubre versiones futuras), pero no asumir que sube el límite de sign-in en este stack.
- **pgTAP de `supabase/tests`.** Al 2026-10-01, dos archivos fallaban en main por drift test↔schema: `margins_enforce_identity.test.sql` insertaba `profiles` sin `display_name` (columna `not null`; además el trigger `on_auth_user_created` ya había creado la fila, así que el insert directo chocaba por partida doble) y `enforce_invitation_writing_ownership.test.sql` esperaba `42501` en un retarget que en realidad bloquea antes el trigger `invitations_enforce_status_update` (`P0001`), y simulaba una fila histórica con un `UPDATE` que ese trigger ahora prohíbe a cualquier rol. ODE-658 los alineó con el schema real (margins: upsert con `display_name`; invitaciones: `throws_like` del mensaje del trigger y fila forjada creada con el trigger desactivado dentro de la transacción) y el job de CI los corre enteros. `writing_shares_permission_enforcement.test.sql` pasa (16/16). Para correr un archivo concreto: `npm run supabase:locked -- supabase test db --local <archivo>`.
- **`.cache/**`.** `npm test` recogía copias de recon alojadas ahí; desde este PR las dos configs de Vitest lo excluyen.
