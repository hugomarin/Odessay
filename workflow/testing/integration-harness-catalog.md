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
tests/fixtures/catalog-seam/catalog-seam-v2.json   fixture versionado (generado, no a mano; proyección de respuesta por invoke)
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
| `tests/integration/sync/desktop-sync-failure-preserves-local-content.test.ts` (ODE-612) | La misma cadena real que la fila de ODE-611 PR 2: `createDesktopDraft`/`DesktopDocumentService.saveWriting` (entradas de producción), `SqliteDocumentCatalog` real, `desktopCatalogSyncService` real, `.md` real en fs temporal, cola `sync_mutations` y `documents.sync_status` con la semántica de Rust. Tres casos: fallo reintentable (con la respuesta retenida para observar el `pending` en vuelo), recuperación con un guardado posterior, y fallo terminal por los 10 intentos reales | Los mismos dos boundaries que la fila anterior (Supabase y decodificado IPC de Tauri). Supabase usa `failNextWrite` (reintentable), `failAllWrites` (terminal) y `holdNextWrite` (ventana en vuelo); el reloj se avanza con un spy de `Date.now` para vencer el backoff máximo entre flush explícito y flush explícito, sin sembrar `attemptCount`. La prueba conduce `flushPending()`; no hay guardado concurrente (la variante de ODE-644 la cubre `desktop-sync-multiple-saves-before-flush.test.ts`) |
| `tests/sync-worker.test.ts` | solo la clase `SyncWorker` | todo `LocalDB` son `vi.fn` (:74-125), `vi.useFakeTimers` (:180). **Es unit y no sirve como montaje de integración** |
| `tests/desktop-catalog-sync-service.test.ts` | solo el módulo del servicio; el caso SYNC-03 usa un `.md` real (:711-718) | `@tauri-apps/api/path` (:24-27), cliente supabase (:28-33), `SqliteDocumentCatalog` sustituido por una clase con `getById`/`applyCloudSnapshots` mock (:34-40), todos los comandos de catálogo y `tauriOpenFile` (:41-50), cadena de tabla supabase (:81-92). `vi.resetModules()` en cada test (:96) |
| `tests/integration/documents/support/real-desktop-doubles.ts` | fs temporal real (:286-460), manifiesto e inode (:484-614), almacén de filas del catálogo en memoria con las reglas de Rust (:618-862), **cola `sync_mutations` en memoria** (`tauriCatalogEnqueueMutationDouble`, `tauriCatalogListPendingMutationsDouble`, `tauriCatalogUpdateMutationStatusDouble`, `tauriCatalogPruneSyncedMutationsDouble`, `tauriCatalogPurgeDocumentDouble` y la lectura `catalogMutationsDouble`; el supersede vive en `applyDualWrite`, espejo de `index.rs:700-716`), settings (:871-898) | SQLite y el transporte Tauri. El fake de Supabase vive al lado, en `tests/integration/documents/support/fake-supabase-server.ts` (última-escritura-gana, `count: "exact"`, error 23505 en insert duplicado, retención de la próxima respuesta y fallos one-shot/permanentes para ODE-612). **La cola espeja el SQL de `index.rs` (supersede/listado/proyección) leído a mano; la costura TS→Rust/SQLite real sigue abierta (ODE-613).** |

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

**Confirmado por ODE-611 PR 2 (2026-09-30); corregido en el fix ciclo 1 del 2026-09-30:** el escenario se falsó en desktop con el doble de comportamiento de la cola (espejo del SQL citado) y los tres efectos ocurren: `it.fails` en `tests/integration/sync/desktop-sync-multiple-saves-before-flush.test.ts` — éxito en vuelo deja `documents.sync_status='synced'` con la mutación nueva `pending` (`expected 'synced' to be 'pending'`); el fallo en vuelo revive la mutación superada como `failed` (`expected 'failed' to be 'synced'`); y el reintento de esa v3 revivida, al vencer su backoff (~2 s, más largo que el debounce de 1.5 s del flush de la v4), vuelve a pisar la nube: el cuerpo sale del `.md` (v4) pero la metadata sale del payload de la v3, así que la nube acaba en `{version: 3, status: "draft"}` — **la metadata de la v4 se pierde en la nube y la versión retrocede, en silencio** (`expected 3 to be 4`). La v4 no se pierde en la cola; lo que se pierde en la nube es su metadata. Bug real en Rust: **ODE-644**, enlazado a ODE-611; la confirmación contra el Rust/SQLite real es la costura de ODE-613.

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

**Montaje de `tests/integration/documents/cross-workspace-move.test.ts`** (270 líneas)

- Helpers definidos en el propio archivo, candidatos a extraer a `tests/integration/documents/support/`:
  - `registerTwoWorkspaces()` (:141-170);
  - `catalogRow(id)` (:172-175): la ruta de la DB se repite en :173, :209 y :253;
  - `bodyJson` (:121);
  - `unimplemented` (:62-66);
  - el ciclo del directorio temporal (:123-139);
  - sobre todo, la tabla de 30 entradas del `vi.mock` de `tauri-commands` (:74-104), que pide una fábrica `tauriCommandsModuleDouble(overrides)`.
- `support/` solo contiene `real-desktop-doubles.ts`.
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

- Ningún test renderiza `WorkspaceDetail` ni `DesktopWorkspaceEntry`.
- `tests/desk-workspace-catalog-integration.test.tsx` renderiza el prototipo, con todo mockeado (es un contract test).
- Para URLs mutables hay que reutilizar `nextNavigationDouble()` (`tests/support/editor-shell-doubles.ts:271-291`).
- Trampas:
  1. Hay dos detectores de runtime: `isTauriRuntime` (`lib/runtime/detect.ts`, lo usan la entrada y el assignment service) e `isDesktopRuntime` (lo usan `buildWorkspaceHref` y `loadCatalogRecords`). Hay que fijar los dos.
  2. `getDesktopWorkspaceService()` es una promesa memoizada sobre `appConfigDir()` (`desktop/workspace-service.ts:1129-1137`). Debe apuntar al `configDir` del montaje y resetearse entre tests.
  3. En desktop, `loadCatalogRecords` importa dinámicamente `desktop-auth-service` (`lib/queries/document-catalog.ts:116`).
  4. El debounce de 100 ms y el listener de `focus` obligan a esperar por condición.
  5. `useSearchParams` exige un Suspense en la página real; con el hook doblado no hace falta.
  6. Abrir un archivo va por `openWorkspaceFileInEditor(file, router)` (741). Con el router doblado se afirma el href y el `file.path`/id del join; el contenido se lee con el doble de `open_file`.

### Transversal

**Flakes conocidos que tocan estas redes (en Backlog)**

- **ODE-623:** `tests/desk-workspace-catalog-integration.test.tsx:551`, 5 recargas donde se esperaba 1 bajo carga. Relevante para ODE-614 si se toca Desk o el catálogo de Workspace.
- **ODE-639 y ODE-641:** `waitFor` de 2000 ms y timeout de 5 s en el harness de la shell (`editor-shell-commands`, `editor-shell-blank-draft-web`). Solo afectan si un escenario monta `EditorShell`. Ninguno de los cuatro issues lo necesita a nivel servicio o vista.

**Recuento del capability map, parseando la columna Status:**

```sh
awk -F'|' '/^# Audit Summary/{exit} /^\| *[A-Z]+-[0-9]+ *\|/{s=$6; gsub(/[ *`]/,"",s); c[s]++; n++} END{for(k in c) printf "%s=%d\n",k,c[k]; print "total="n}' workflow/quality/capability-integration-map.md | sort
```

En main@6e803d21 devuelve `CONTRACT=8, INTEGRATION=31, NONE=6, PARTIAL_INTEGRATION=49, RELEASE=1, UNIT_ONLY=12, total=107`, igual que la tabla "Coverage breakdown".

**No explorado en este Recon:**
- los tests Rust de `commands/workspace.rs` (`workspace_sync`);
- el camino web de `/workspace/[slug]` en ejecución (si en web llega a montarse con datos);
- `restoreWriting` y `registerBinding` web (read-then-write, citados en la fila SYNC-03).

## Mapa de Recon — milestone 4, tanda 2 (ODE-593, 619, 620, 621, 636, 637)

**Verificado en: main@5e58443e (2026-09-30).** Solo lectura del código en ese commit; no se ejecutó ningún test ni `cargo test`. Los hallazgos que cambian alcance se re-verificaron a mano (los marcados ✔). Cada issue lleva su Recon Pack completo como comentario en Linear (`## Recon Pack (verificado en main@5e58443e)`); este mapa resume lo que comparten y lo que un BUILD no debe redescubrir. Cuando BUILD encuentre algo distinto, corrige este mapa en su PR.

### Hallazgos que cambian el alcance de los briefs

| Issue | Hallazgo | Evidencia |
|---|---|---|
| ODE-637 | ✔ El filtro de auto-escritura que alimenta la shell es `configureRootWatcher` (`lib/services/desktop/desktop-workspace-reconciler.ts:110`, `isOdessaySelfWriteEvent` en `:142`). `shouldIgnoreWorkspaceWatchEvent` (`workspace-service.ts:1108`) solo lo usan `watchWorkspace`/`watchWorkspaces` (`:949`, `:1012`), sin llamadores: código muerto. | brief ya corregido |
| ODE-637 | Con `holdWriteFile` (retiene ANTES de escribir) el escudo de hash de la shell (`hooks/useExternalDocumentChanges.ts:199-212` contra `getDurableContentHash`) ya evita el banner: la mutación "quitar `markOdessaySelfWritePath`" quedaría verde. Discrimina solo reteniendo la cola del guardado DESPUÉS de escribir al disco (`workspace_touch_file`/`catalog_dual_write` en vuelo). | `persistence-coordinator.ts:707`; `document-service-factory.ts:181-306` |
| ODE-637 | Parte 2: el grabador usa un hash falso (`tests/support/catalog-seam-recorder.ts:137-143`) y ninguna proyección lleva `contentHash` (`:160-207`). Un escenario de edición externa pasaría sin que Rust detecte nada. Requiere blake3 real (`computeMarkdownContentHash`) + `contentHash` en las proyecciones → fixture v3 (regenera los 3 escenarios) y `src-tauri/tests/catalog_seam.rs`. Sin Rust de producción. | |
| ODE-636 | ✔ El Markdown de Desk (`app/(app)/desk/page.tsx:821-831`) y de Collections (`components/collections/collections-view.tsx:487-503`) va por `downloadBlob` y devuelve `true` sin condición; nunca pasa por `saveBinaryArtifact`. Callers no listados en el brief: menú de fila "Download markdown" (`desk-artifact-row.tsx:282-286`, `desk-activity-table.tsx:398-401`). Posible cuerpo vacío en Desk desktop (`getWritingMarkdownPayload` usa `body_json`; las filas del catálogo traen `{}`, `lib/queries/desk-catalog-source.ts:92-98`) — sin ejecutar. | |
| ODE-636 | El cuelgue de `act()` del modal es casi seguro el doble: `tests/preview-modal.test.tsx:24-33` devuelve `vi.fn()` nuevos en cada render y el efecto de `writing-preview-modal.tsx:412-476` depende de ellos. | hipótesis fuerte, sin ejecutar |
| ODE-619 | ✔ `importDesktopWritingFile` (`lib/services/document-service-factory.ts:1043`) no corre en producción: `isUnifiedOpenEnabled()` = `isDesktopRuntime()` (`lib/services/open-document-factory.ts:8-10`), así que `handleMenuOpenFile` siempre toma el opener unificado (`editor-shell.tsx:2096`) y la rama de `:2162` es muerta. Un proof sobre esa función es `NON_PRODUCTION_PATH`. En desktop "importar" = Open File, que adopta en su sitio. El requisito "metadata del front matter en la fila" contradice ADR D4. | |
| ODE-620 | ✔ La respuesta de sugerencia no está atada al documento que la pidió (`components/editor/modals/rename-writing-modal.tsx:47-72`). En Desk (`desk/page.tsx:1026`), Collections y Workspace el modal queda montado con `open=false`; una respuesta tardía de A aparece en el modal de B. En la shell no (se desmonta, `editor-shell.tsx:2971`). Bug real alcanzable → `it.fails` primero. | |
| ODE-593 | ✔ Rust ya devuelve la ruta conservada (`src-tauri/src/commands/document.rs:200-205`), pero `WriteFileConflictError` no tiene campos (`lib/services/desktop/write-file-conflict-error.ts:12-17`), el `err` de `FilesystemDocumentService` no admite `details` y la ruta muere en `console.error` (`hooks/useEditorPersistence.ts:340-365`). La ruta llega por `onError`, no por `useExternalDocumentChanges`. | |
| ODE-621 | El test de ODE-601 (`tests/editor-shell-export-delivery-desktop.test.tsx`) ya recorre la cadena de EXP-04 contra fs real y no está citado en la fila. SYNC-08 depende de un payload escrito a mano (`mutationRow`); candidato sin verificar: el dual-write supersede un guardado pendiente por una mutación de solo metadata (`index.rs:704-711`). | |

### Andamiajes que reutiliza cada issue

| Issue | Montaje | Qué es real / qué falta |
|---|---|---|
| ODE-637 P1 | `tests/editor-shell-external-changes-desktop.test.tsx` (helpers `startReconciler`, `openFromNativeMenu`, `waitForWatcherOnDocuments`, `emitFsWatchEvent`) | Falta: un router `invoke`→dobles (no existe; solo hay dispatch propio en `catalog-seam-recorder.ts:327-345`) para dejar `tauri-commands` real. Traduce formas, no lógica: `settings_read` devuelve string JSON, `write_file` rechaza con el string `CONFLICT:…`, desestructura args. Unos 25 comandos (`editor-shell-desktop-doubles.ts:103-142`); comando desconocido = throw. |
| ODE-637 P2 | `catalog-seam-recorder.ts` + `catalog-seam-fixture.test.ts` + `src-tauri/tests/catalog_seam.rs` | Ver hallazgo: fixture v3 con hash real. |
| ODE-636 | Dobles de `tests/editor-shell-export-delivery-desktop.test.tsx` (`world.saveDialogResult`, `tauriWriteBinaryFileDouble`) | Montaje nuevo de `DeskPage`/`CollectionsView` sobre servicios reales: hoy `desk-workspace-catalog-integration.test.tsx` mockea `document-service-factory` (`:174`) y no sirve tal cual. Los callbacks son closures sin export. |
| ODE-619 | `tests/editor-shell-menu-open-title.test.tsx` (ODE-581, entra por `menu:open-file`) | Plantilla directa. Doblar `cloudHashLookup` (`createDesktopClient`). |
| ODE-620 | `tests/integration/ai/suggest-title-lifecycle.test.ts` (router por URL `:96-111`) + `tests/support/editor-shell-harness.tsx` (`installNetworkDouble`) | `aiServiceDouble.suggestTitle` devuelve `{error:null,data:null}` (`editor-shell-doubles.ts:445-447`): usarlo es MOCKED_SEAM. Desktop usa URL absoluta (`desktop-ai-service.ts:86`); el router solo reconoce la relativa. |
| ODE-593 | `tests/editor-shell-external-changes-desktop.test.tsx` + modo nuevo de doble carrera en `tauriWriteFileDouble` (`real-desktop-doubles.ts:372-411`) que escriba destino y `.conflict-xxxxxxxx` y lance el mensaje Rust literal | El parse va en `write-file-conflict-error.ts` (no se mockea), no en `tauriWriteFile` (doblado entero). |

### Trampas transversales

- **Relojes reales en el harness de la shell:** `advance` usa `setTimeout` real (`editor-shell-harness.tsx:344-349`). La ventana de 2 s de auto-escritura y el timeout de 45 s de la ruta de títulos piden `advance(≥2100)` o fake timers acotados a `setTimeout`/`clearTimeout`; vigilar el timeout de 60 s por test.
- **Estado global de módulo:** el mapa de marcas de auto-escritura (`clearOdessaySelfWritePathsForTests`, `tauri-fs-watch.ts:160`) y el singleton del reconciliador (`disposeWorkspaceReconciler`) se limpian en cada test.
- **Ratchet de espejos:** `tests/architecture/editor-shell-mirrors-ratchet.test.ts` prohíbe un `useEffect` que solo asigne un ref (ODE-593 añade estado en la shell).
- **Ausencias con control positivo** (regla 8): ODE-637 (banner falso), ODE-620 (sugerencia filtrada), ODE-636 (archivo no escrito).
- `scripts/linear-cli.mjs` no crea issues: los issues nuevos (ODE-621) van por GraphQL directo.

### Archivos compartidos y orden

- `workflow/quality/capability-integration-map.md`: lo tocan los seis (filas WATCH-07, EXP-05, EXP-04, SYS-02, SYNC-08, DOC-09, AI-03 y el log). Conflictos de texto, no de código: merges en serie.
- `tests/integration/documents/support/real-desktop-doubles.ts`: ODE-593 (modo doble carrera), ODE-637 (router), ODE-636/619 (lectura). ODE-593 antes de ODE-637: el parse en la clase sobrevive al cambio de harness.
- `tests/support/catalog-seam-recorder.ts` y el fixture: ODE-637 P2 y ODE-644 (fuera de esta tanda). El segundo rebasea y regenera.
- `components/editor/editor-shell.tsx`: ODE-593 (banner) y ODE-619 (borrar la rama muerta, si se aprueba).

### Recuento del capability map

El comando de la sección anterior, en main@5e58443e: `CONTRACT=8, INTEGRATION=33, NONE=6, PARTIAL_INTEGRATION=47, RELEASE=1, UNIT_ONLY=12, total=107`. Filas de esta tanda: WATCH-07 y EXP-05 `PARTIAL_INTEGRATION`; EXP-04, SYS-02 y SYNC-08 `CONTRACT`; DOC-09 y AI-03 `NONE`.

**No explorado en esta tanda:** el comportamiento de `<a download>` en WKWebView (solo en el DMG), el transporte IPC real, y la carrera simple de ODE-593 contra la ventana de 2 s (sospecha: un evento externo dentro de la ventana marcada antes del `invoke` podría suprimirse; queda para ODE-637).
