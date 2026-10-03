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
tests/support/catalog-seam-recorder.ts   grabador: modelo de fs/manifiesto/catálogo + escenarios (los SYNC-05 delegan la cola en real-desktop-doubles)
tests/fixtures/catalog-seam/catalog-seam-v4.json   fixture versionado (generado, no a mano; proyección de respuesta por invoke, incluido contentHash, y pasos de control)
tests/catalog-seam-fixture.test.ts       gate de drift TS (npm test)
src-tauri/tests/catalog_seam.rs          replay Rust sobre las pub fn reales + SQLite real
.github/workflows/desktop-rust.yml       job cargo-test (gate en CI required, solo con cambios de Rust/seam)
```

**Qué deja real.** En la grabación: `SqliteDocumentCatalog` y `createWorkspaceReconciler` (cableado como `desktop-workspace-reconciler.ts`: `workspace_sync` → `listByBindingRoot` → `applyReconcileTransaction`) y, en los escenarios SYNC-05, la cadena de guardado de producción entera (`DesktopDocumentService.saveWriting` vía `getDocumentService` y `desktopCatalogSyncService.flushPending()`, con el documento registrado por el reconciliador real, nunca sembrado a mano). En el replay: los `pub fn` de `commands::index`, `commands::workspace` y `commands::document`, SQLite real, fs real de un tempdir, y una conexión nueva para leer las filas canónicas.

**Qué dobla.** El decode IPC de Tauri (`@tauri-apps/api/core`), que en la grabación responde con la semántica de cada comando, y —solo en SYNC-05— la red de Supabase (`fake-supabase-server.ts`: retención del próximo write y fallo one-shot). La semántica de la cola de sync no se copia una tercera vez: el dispatch delega `catalog_dual_write`, el listado de pendientes, `catalog_update_mutation_status` y `catalog_apply_cloud_snapshots` en los dobles de `real-desktop-doubles.ts`. Las respuestas del doble **no** son desechables: deciden los ids que el wrapper reenvía y los upserts que commitea, así que cada invoke grabado guarda una proyección de la respuesta — los pares `relativePath`→`id` y `unboundPaths` de `workspace_sync`, `changed` de `catalog_apply_reconcile`, `id`/`relativePath`/`localPresent`/`bindingRootId` de las lecturas, el binding tocado (`workspace_touch_file`), el cuerpo releído (`open_file`) y las filas de las dos colas (sin `payloadJson`, eco del argumento ya grabado); `folderCount` y los campos dependientes de la máquina de `workspace_touch_file` quedan excluidos con la razón escrita — y el replay Rust proyecta la respuesta real igual y la afirma contra la grabada, paso a paso (fix ciclo 1, review ronda 1 P2-1). Además, cada escena SYNC-05 cierra con pasos de control: el estado que el doble cree del documento (`sync_status`, `cloud_present`) y de cada fila de `sync_mutations`, afirmado en TS antes de grabar y contrastado por Rust en una conexión SQLite nueva. El transporte real de `invoke` sigue fuera y es RUNTIME (ODE-622). Los escenarios usan raíces `$ROOT_A`/`$ROOT_B` y DB `$DB` como placeholders; el test Rust los reescribe a directorios temporales.

**Cómo se regenera (nunca a mano).**

```sh
UPDATE_CATALOG_SEAM_FIXTURE=1 npx vitest run tests/catalog-seam-fixture.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --test catalog_seam
```

`npm test` corre el gate de drift: regenera la secuencia en memoria desde el wrapper y falla si el fixture commiteado difiere — así el replay nunca prueba una secuencia vieja. El grabador lanza error si el wrapper emite un comando que el doble no conoce.

**Cuándo NO es el adecuado.** Propiedades de UI o de orquestación multi-servicio; aquí solo entran cadenas cuyo contrato de comandos se puede grabar desde TS y reproducir sin runtime de Tauri. El transporte IPC real (RUNTIME, ODE-622) y la red de Supabase (frontera externa doblada) siguen fuera: la secuencia prueba los comandos Rust/SQLite reales, no el bridge de la webview ni la nube.

**Dónde se extiende.** Escenarios nuevos en `catalog-seam-recorder.ts` (helpers `fsWrite`/`fsRename`/`fsDelete` + reconciler real; para cadenas de servicio, el backend `queue` delega los `catalog_*` en `real-desktop-doubles.ts`); comandos nuevos en el `switch` del doble y en el dispatch de `catalog_seam.rs`, **más su proyección de respuesta** (`projectInvokeResponse` en TS y los `project_*` del replay): si la respuesta real difiere de la grabada, el replay señala el paso exacto. Si el comando mueve estado durable, añade también un paso de control (`kind: "control"`) con lo que el doble cree del documento y de su cola. Si cambia la forma de un comando, el gate de drift lo detecta en `npm test`.

**ODE-637 Parte 2 (fixture v3).** El grabador reutiliza `computeMarkdownContentHash` (`lib/content-hash.ts`) para registrar hashes BLAKE3 reales en `workspace_sync` y en las proyecciones de filas del catálogo. El escenario `watch07-external-edit-same-path` registra el archivo, cambia su contenido externamente en la misma ruta e inode, vuelve a escanear y lee el mismo UUID con `getById`. El replay compara esas respuestas con las funciones Rust reales y, en una conexión SQLite nueva, contrasta `document_bindings.content_hash` con el hash del `.md` en disco; quitar la actualización del hash en el `ON CONFLICT` de `catalog_apply_reconcile` hace fallar el replay. La edición física se simula con `fs::write` sobre el archivo existente; no cambia Rust de producción. El transporte IPC real de Tauri sigue fuera del proof y lo cubre ODE-622 (RUNTIME).

**ODE-644 PR2 (fixture v4).** Los escenarios `sync05-save-during-flush-failure` y `sync05-save-during-flush-success` graban la cadena SYNC-05 entera: registro por el reconciliador real, guardados por `DesktopDocumentService.saveWriting` (vía `getDocumentService`) y flush por `desktopCatalogSyncService.flushPending()`, con el write de Supabase retenido (`holdNextWrite`) y, en la variante de fallo, fallado una vez (`failNextWrite`). El replay añade `write_file`, `open_file`, `workspace_touch_file`, `catalog_dual_write`, `catalog_list_pending_mutations`, `catalog_list_pending_metadata_mutations`, `catalog_update_mutation_status` y `catalog_apply_cloud_snapshots` sobre los comandos reales. En la escena de éxito, la v3 en vuelo queda `synced` con su `last_error` de supersede y el documento sigue `pending` hasta que el segundo flush sube la v4; en la de fallo, la v3 superada no revive como `failed` y, pasado su backoff de 2 s, el segundo flush lista solo la v4. Los 5 escenarios anteriores no cambian de semántica: su diff de regeneración es solo la versión. **Ronda 1 de review (fix ciclo 1):** la escena no alcanza la rama `NOT EXISTS` de la proyección — el supersede mantiene una sola mutación accionable por UUID, así que una respuesta de la v3 superada retorna antes por `updated == 0` y quitar la cláusula deja el replay verde — y la única ruta de producción que inserta una segunda accionable (`catalog_apply_workspace_removal`) acuña el UUID del delete dentro de Rust (fuera del lazo byte a byte de respuestas y controles) y retira la raíz, así que no se puede grabar como escena sin ampliar el seam y añadir la re-alta de la carpeta para el cierre canónico. SYNC-05 volvió a `PARTIAL_INTEGRATION` en esa ronda; la costura quedaba abierta en esa rama, cubierta solo por el cargo test sembrado de `mod catalog_tests`. **La cierra ODE-663 (ver abajo).** El mutante válido de la Guía para el replay es quitar `AND status IN ('pending','failed')` del UPDATE.

**ODE-663 (fixture v4 extendido).** La escena `sync05-workspace-removal-not-exists` cierra la rama `NOT EXISTS` de la proyección: documento cloud-owned hidratado desde el fake, guardado real en vuelo (`saveWriting` vía `getDocumentService` + `flushPending` con el write de Supabase retenido) y, con el guardado viajando, el retiro real de la raíz por el wrapper `SqliteDocumentCatalog.applyWorkspaceRemoval` — el comando `catalog_apply_workspace_removal` (`index.rs:860-991`) se graba y el replay lo ejecuta contra Rust/SQLite real —, que archiva el documento y encola su mutación `delete`: la segunda accionable del mismo UUID. Cuando llega la respuesta del guardado, `catalog_update_mutation_status` no proyecta el documento (`NOT EXISTS`; control `sync05-removal-not-exists-guard` leído en SQLite real: `pending`); el segundo flush resuelve el delete y ahí sí proyecta (`sync05-removal-delete-resolved`: `deleted`, `cloud_present=0`). Como el UUID del delete se acuña en Rust (`index.rs:957`), el fixture guarda un alias estable por documento (`$MUTATION_REMOVAL_<documentId>`) solo para ese id y el replay lo liga al UUID v4 real en la primera respuesta/control que lo expone (forma y unicidad) y lo resuelve en los args posteriores; el resto —payload, versión, timestamps, estado, retry, orden, document id y conteos— se compara literal. El cierre vuelve a registrar la raíz (`catalog_activate_binding_root` + rescan del reconciliador real) porque retirar un root no borra el `.md`, y `assert_scenario` lo verifica atado y `local_present` con el hash del disco. Mutaciones vivas contra `catalog_seam.rs`: quitar `AND NOT EXISTS` pone rojo el control del guard (`synced` ≠ `pending`) y quitar el enqueue del delete lo pone rojo por la misma aserción.

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
| `tests/integration/collections/delete-collection-keeps-writings.desktop.test.ts` (ODE-618 PR1) | `deleteLocalCollection` (el puerto real que usa `collections-view.tsx`), `deleteDesktopCollection`, `createDesktopDraft` y `SqliteDocumentCatalog` reales, `.md` real en fs temporal, `loadCollectionState`/`loadDeskCatalogData` y `buildCollectionSummaries`/`getUncategorizedWritings` reales; desde ODE-666 también `desktopCatalogSyncService.hydrateCollections` real | Solo el transporte IPC de Tauri (`tauri-commands` → `real-desktop-doubles.ts`, con `tauriCatalogDeleteCollectionDouble` y, desde ODE-666, `tauriCatalogApplyCollectionSnapshotDouble`) y la red (`sync-service-factory` no agenda; el caso ODE-666 sí usa `desktop-client` con Supabase doblado para servir el snapshot atrasado). Cinco casos verdes (documentos, bindings y bytes sobreviven; el join de la vista conserva la colección viva; desde PR1b, F6: el documento cuya única colección se borró vuelve a estar sin clasificar; y desde ODE-666 un snapshot cloud atrasado no revive la colección tombstoned ni reinserta sus relaciones) |
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

**Confirmado por ODE-611 PR 2 (2026-09-30); corregido en el fix ciclo 1 del 2026-09-30:** el escenario se falsó en desktop con el doble de comportamiento de la cola (espejo del SQL citado) y los tres efectos ocurren: `it.fails` en `tests/integration/sync/desktop-sync-multiple-saves-before-flush.test.ts` — éxito en vuelo deja `documents.sync_status='synced'` con la mutación nueva `pending` (`expected 'synced' to be 'pending'`); el fallo en vuelo revive la mutación superada como `failed` (`expected 'failed' to be 'synced'`); y el reintento de esa v3 revivida, al vencer su backoff (~2 s, más largo que el debounce de 1.5 s del flush de la v4), vuelve a pisar la nube: el cuerpo sale del `.md` (v4) pero la metadata sale del payload de la v3, así que la nube acaba en `{version: 3, status: "draft"}` — **la metadata de la v4 se pierde en la nube y la versión retrocede, en silencio** (`expected 3 to be 4`). La v4 no se pierde en la cola; lo que se pierde en la nube es su metadata. Bug real en Rust: **ODE-644**, enlazado a ODE-611; la confirmación contra el Rust/SQLite real es la costura de ODE-613. **Fix ODE-644 PR1:** `catalog_update_mutation_status` solo actualiza una fila accionable (`status IN ('pending','failed')`) y proyecta `documents.sync_status` solo cuando no queda otra accionable (`NOT EXISTS`), con la misma guarda en la cola de metadata; el doble TS copia el SQL nuevo y los tres casos pasan a `it`. **ODE-644 PR2 (fixture v4, 2026-10-01):** los escenarios SYNC-05 del seam replayan la cadena de guardado y flush de producción sobre `catalog_dual_write`, el listado de pendientes y `catalog_update_mutation_status` reales con SQLite real, comparando la respuesta de cada comando y afirmando documento y cola en una conexión nueva en los dos controles de cada escena (éxito y fallo en vuelo). La costura TS→Rust/SQLite de la cola queda probada para la guarda de fila y el supersede; la rama `NOT EXISTS` de la proyección no es alcanzable por la secuencia grabada (el supersede mantiene una accionable por UUID) y queda solo en los cargo tests sembrados, así que SYNC-05 se queda en `PARTIAL_INTEGRATION` (revisión ronda 1, P1 test-gap); el transporte IPC real sigue siendo RUNTIME (ODE-622).

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
| ODE-647 | `tests/services/document-service-factory.test.ts` "DesktopDocumentService filesystem boundary contract" (extend the canonical AST scan) | One parse with two collectors (class methods + exported module functions) with exact literal discovery, plus a per-branch scenario table. Module targets: `relocateDesktopWriting`, `relocateDesktopWritingByCanonicalPath`, `getDesktopWritingCanonicalPath` (resolver) and `createDesktopDraft` (decision E, discovered by name because it delegates through the service instance). The runtime path-position assertion (`not.toContain(id)`) now also observes `tauriWriteFile`, `tauriOpenFile`, `tauriRelocateFile`, `tauriWorkspaceSync` and `tauriWorkspaceTouchFile`, including the save/persist and delete routes (decision F); the UUID remains legitimate as a workspace-sync map value or workspace-touch `documentId`. Static source proof only; no new product, harness or Rust. |
| ODE-648 | tests/integration/sync/desktop-sync-multiple-saves-before-flush.test.ts (ODE-611) | Real DesktopDocumentService, SqliteDocumentCatalog, desktopCatalogSyncService, temporary .md; Supabase and Tauri IPC decode are the only doubles in the critical data path; retain ODE-611's no-op sync-service-factory control only to suppress automatic debounce while calling real flushPending(). ODE-648 adds the cloud-only `binding:null` case (real `DesktopSettingsService.deleteVocabularyItem`), the bound pending-save + metadata case, the first-upload/no-initial-flush case, and the account-limit case; the fix lives in `processMutation` (metadata with binding resolves the `.md` snapshot; an existing cloud row only receives body/hash + its own metadata; a foreign `cloudAccountId` is never inserted). Native replay remains unproven: the queue double mirrors Rust and does not prove the real engine — owned by ODE-670. |
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

## Mapa de Recon — milestone 4, tanda 4 (ODE-648, 652, 647)

**Verificado en: main@77ef767f (2026-10-02).** Es el primer Recon hecho con `skill-planning/specialties/area-recon.md` en modo completo (PR #596). Tres workers, uno por cluster, leyeron el código en solo lectura: no se ejecutó ningún test.

Cada issue lleva:
- en la descripción, la sección "Auditoría (2026-10-02, verificado en main@77ef767f)", que manda, y `## Architecture Contract`: añadido en 652 y 647, corregido por campo en la Auditoría de 648;
- un comentario `## Recon Pack (verificado en main@77ef767f)` con el campo "Construir con".

`ops:brief:lint --require-contract --require-recon` pasa en los tres. Antes del Recon fallaba en los tres: sin contrato (652, 647), sin Reference docs (652) y con el pack en la descripción en vez de en un comentario.

Si BUILD encuentra algo distinto, corrige este mapa en su PR.

### Hallazgos que cambian el alcance de los briefs

| Issue | Hallazgo | Evidencia |
|---|---|---|
| ODE-648 | ✔ El caso "guardado pendiente + metadata" **fallaba**; el arreglo por defecto se aplicó en ODE-648: en el consumidor (`processMutation`), la metadata de un documento con binding resuelve el snapshot completo del `.md`, sobre una fila existente solo actualiza cuerpo/hash + la metadata propia, y una fila de otra cuenta activa nunca se inserta bajo la sesión actual. La prueba (it.fails primero) cubre solo-nube, fila existente, primera subida sin flush inicial y límite de cuenta; la cola sigue siendo un espejo conductual. | supersede `index.rs:704-711` (doble `real-desktop-doubles.ts:220-241`, `:903`); parche `desktop-catalog-sync-service.ts:293-311`; 0 filas `:306-308` |
| ODE-648 | ✔ "Coordinar con ODE-644" quedó desfasado: ODE-644 cerró con su replay nativo de SYNC-05, sin metadata ni `catalog_bulk_dual_write`. El paso nativo de SYNC-08 ahora tiene owner: ODE-670 (dependiente de ODE-648), que cubre el replay real por Rust/SQLite. | `built.jsonl:200`, `:208`; `catalog-seam-recorder.ts:349`, `:370-447` |
| ODE-652 | Los bytes ya son del documento del click: el id se captura por valor y los bytes se fijan antes del diálogo. **El defecto es el aviso:** el de A aparece en el panel de B y se queda, también sin carrera. El dueño del arreglo es `properties-panel.tsx`, no `editor-shell.tsx`. | `editor-shell.tsx:2283-2301` (antes `:2343-2361`); `properties-panel.tsx:144-151`, `:310-348`; panel sin `key` `editor-shell.tsx:2856` |
| ODE-647 | `importDesktopWritingFile` ya no existe (lo borró ODE-619). Tal como está escrito, el test no detectaría nada: la aserción solo observa los dobles de FilesystemDocumentService y las funciones de módulo hablan con Tauri directo, así que la mutación de R5 saldría verde. Hay que observar los comandos Tauri de fs por posición de ruta y exigir un descubrimiento exacto. Ningún bug hoy. | `a6b7ac07`; `tests/services/document-service-factory.test.ts:1070`, `:1094-1101`; `document-service-factory.ts:805`, `:810`, `:853`, `:875`, `:941`, `:1003` |

### Grafo de conflictos (solo código, tests, dobles y fixtures)

| Issue | Archivos de código que toca |
|---|---|
| ODE-648 | `tests/integration/sync/desktop-sync-multiple-saves-before-flush.test.ts`, `lib/sync/desktop-catalog-sync-service.ts` (arreglo por defecto); opcional `tests/desktop-catalog-sync-service.test.ts` |
| ODE-652 | `components/editor/panels/properties-panel.tsx`, `tests/support/editor-shell-doubles.ts` (amplía el tipo de `saveDialogResult`, compatible hacia atrás), `tests/editor-shell-export-delivery-desktop.test.tsx` |
| ODE-647 | `tests/services/document-service-factory.test.ts` |

**Sin conflictos de código entre los tres.** Solo comparten este catálogo y el mapa de capabilities, en filas distintas (SYNC-08, EXP-05, SYS-02), y eso no cuenta como conflicto.

Acoplamiento a vigilar: si un arreglo futuro añadiera a `lib/services/document-service-factory.ts` una función exportada que toque fs, el descubrimiento exacto de ODE-647 se pondrá rojo. Es la guardia buscada.

### Olas (máximo 3 builders a la vez)

- **Ola única:** ODE-647 (S) · ODE-652 (M) · ODE-648 (M), los tres en paralelo, sin Docker, sin Supabase local y sin cargo.
- **Orden de merge preferente:** ODE-647 → ODE-652 → ODE-648, de menor a mayor. Ninguno desbloquea a otro.

### Trampas transversales

- **ODE-652 monta `EditorShell`:** le afectan los flakes conocidos del harness de la shell (ODE-639, ODE-641). Relojes reales, sin fake timers, y timeout de 90 s por test.
- **ODE-648 y ODE-647 no montan la shell.** Son de nivel servicio (ODE-648) y de contrato source-level (ODE-647).
- **Sin `it.fails` en ODE-647:** no hay bug. ODE-648 (caso con binding) y ODE-652 (aviso en B) sí entran con `it.fails` y después el arreglo.
- **Follow-ups:** no se crean issues durante la orquestación. Cada Auditoría tiene su lista de seguimientos.

### Recuento del capability map (tanda 4)

El comando de la sección "Recuento del capability map", en main@77ef767f, da `CONTRACT=7, INTEGRATION=40, NONE=1, PARTIAL_INTEGRATION=47, RELEASE=1, UNIT_ONLY=11, total=107`. Filas de esta tanda:

| Fila | Status |
|---|---|
| SYNC-08 | `CONTRACT` |
| EXP-05 | `PARTIAL_INTEGRATION` |
| SYS-02 | `CONTRACT` (se queda en CONTRACT por la decisión de ODE-621; ODE-647 solo amplía la evidencia) |

**No explorado en esta tanda:**
- si el diálogo nativo de guardado es modal en macOS (D4 de ODE-636);
- el transporte IPC real (ODE-622);
- el coste real de re-subir el cuerpo en cada cambio de metadata de un documento con `.md` (ODE-648).

### Entregado en ODE-652 (BUILD, 2026-10-02)

El harness de export del editor suma la carrera que este mapa marcaba como no explorada: con el diálogo nativo de guardado retenido (`world.saveDialogResult` admite ahora una promesa), la pestaña cambia de A a B antes de liberarlo. Son reales el `PropertiesPanel` (menú "Export as…" → `handleExport`), `EditorShell.exportBinary`, `DesktopDocumentService`, `FilesystemDocumentService`, `saveBinaryArtifact`/`saveDesktopBinaryExport` y el filesystem temporal; el diálogo nativo y el decode IPC de Tauri siguen siendo los boundaries doblados. El `.docx` escrito se verifica con JSZip sobre `word/document.xml` (cuerpo de A presente, de B ausente), el `defaultPath` propuesto es el nombre canónico de A y el toast (`data-testid="document-action-toast"`) nombra A y sobrevive al cambio de pestaña, con caso sin carrera y control positivo. Límites reales: el diálogo retenido no discrimina un error de bytes (se fijan antes de abrirse) — los bytes se afirman positivamente y la mutación discriminante es del lado del aviso; la modalidad WKWebView/DMG y el transporte IPC real siguen fuera. Corrección al Recon Pack: el montaje del panel sí necesitaba un prop nuevo (`writingTitle`, el título visible) porque el panel no conocía el nombre del documento; `exportMarkdown` quedó sin cableado (decisión G) y la función se conserva sin tocar. Markdown sale del menú Exportar del panel; Guardar y "Copy as Markdown" no cambian. Recuento tras el PR: `CONTRACT=7, INTEGRATION=41, NONE=1, PARTIAL_INTEGRATION=46, RELEASE=1, UNIT_ONLY=11, total=107` (EXP-05 pasa a `INTEGRATION`; la carrera de share de 652-B/SHARE-03 sigue fuera de este PR).

**652-B (SHARE-03, decisión D, 2026-10-02):** el mismo harness monta la carrera del enlace de compartir. El servicio de compartir es un boundary externo doblado (`sharingServiceDouble` en `tests/support/editor-shell-doubles.ts`, con `world.rotatePreviewLink` admisible como promesa retenida); son reales el `PropertiesPanel` (pestaña "Share" → botón "Regenerate"), el gesto de cambiar de pestaña, el `Copy` del panel y el toast. Con la rotación de A en vuelo, la pestaña cambia a B (que ya carga su propio enlace) y se libera: el enlace tardío de A no reemplaza el enlace activo de B ni su `Copy` (se pulsa `Copy` y el portapapeles recibe el enlace de B), y el resultado se informa en el toast que nombra A (`Share link for ‘A’ is ready`), con caso sin carrera y control positivo (sin cambio de pestaña el enlace generado de A sí aparece). Límite real, declarado: el harness no demuestra que un token real resuelva ni autoriza acceso — generación y lookup siguen sin conectarse — y la fila SHARE-03 se queda en `UNIT_ONLY` por eso; el detalle vive en su Note. Mutaciones en vivo (quitar el guard, leer el título actual al resolver, no mostrar el toast, ocultarlo al cambiar, romper el control positivo y no limpiar el flag de guardado) en la Guía de review del PR. Recuento sin cambios de Status: `CONTRACT=6, INTEGRATION=41, NONE=1, PARTIAL_INTEGRATION=47, RELEASE=1, UNIT_ONLY=11, total=107`.

## Harness Supabase local (ODE-616)

**Creado en:** ODE-616 PR1 (2026-10-01). El proof service-role de SHARE-04 vive en `tests/integration/sharing/service-role-authorization.supabase.test.ts` (ODE-616 PR2, +ODE-659); además lo consumen ODE-617-B (`tests/integration/sharing/visibility-persistence.supabase.test.ts`), la parte web de ODE-618, ODE-659 y ODE-660.

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

**Consumidores.**

- `tests/integration/collections/delete-collection-keeps-writings.supabase.test.ts` (ODE-618 PR2, COL-06 web) — entra por los handlers reales `DELETE /api/collections/[id]` (y `PATCH`, para crear la colección) y por la lectura real `GET /api/writings/[id]/collections`; los documentos y sus filas de unión se siembran con `seedWriting`/`seedMembership` (RLS como dueño). Lo único doblado es `@/lib/supabase/server#createClient` con `serverClientAs` (transporte de cookies). Afirma filas canónicas (`writings` con cuerpo y metadata idénticos, `collections`, `writing_collections`) después del commit; el borrado del dueño es el control positivo. ODE-660 extendió la ficha al contrato de respuesta: el dueño recibe `deleted:true`, el extraño `deleted:false` con la colección intacta, un segundo DELETE del dueño `deleted:false` (idempotente para la cola) y el `PATCH` ajeno es un control de no-2xx (500 `DB_ERROR`) con la fila intacta; la mitad worker de la idempotencia vive en `tests/sync-worker.test.ts` (transporte doblado, worker real). El mutation test de BUILD usa el trigger `zz_mutation_ode618_<runId>` acotado por email del dueño, creado y dropeado en un `finally` bajo el lock (`.cache/mutation-618-cascade-writings.mjs`).

**Helpers** (detalle en `tests/support/supabase-local/`).

- `seedUsers(tag, roles)` → `{id, email, password, username, accessToken, refreshToken}`. Crea con `auth.admin.createUser` (`email_confirm`, `user_metadata.username`; el trigger crea el profile), **lee el username real de `profiles`** (porque `ensure_unique_username` normaliza y agrega sufijos) y hace **un** `signInWithPassword` por usuario. Si falla la lectura del profile o el signIn, borra las cuentas ya creadas antes de propagar el error (el caller no ve la lista parcial). `cleanupUsers` borra por `deleteUser` → cascada. `tests/supabase-local-fixtures.test.ts` cubre el camino de error doblando solo el cliente de Supabase.
- `createLocalAdminClient()` (service role, PostgREST real) y `createUserClient(user)` (anon + `setSession` = RLS real).
- `seedWriting(admin, {...})` privilegiado; `seedShare` / `seedCollection` / `seedMembership` por RLS **como dueño**; `readRow`/`readRows` por admin.
- `session.ts` — `bearerRequest`, `serverClientAs`/`serverClientMockFactory` (sustituye `@/lib/supabase/server#createClient` por un cliente real, solo se fakea el transporte de cookies), `mockEmptyCookies`, `expectNotFound`/`expectRedirect` (digest `NEXT_HTTP_ERROR_FALLBACK;404` / `NEXT_REDIRECT`).
- `route-fetch.ts` — `createRouteFetch(routes, {as})`: `/api/...` entra al handler real con Bearer, `http://127.0.0.1:54321` usa fetch real y cualquier otra URL lanza.

**Aislamiento.** Un `runId`/tag por archivo; solo se borran los usuarios propios; nunca se trunca una tabla (la instancia se comparte entre worktrees). No copiar `supabase/.temp` a los worktrees: el checkout principal está linkeado a producción.

**CI (ODE-658).** `.github/workflows/supabase-local.yml` (reusable: `workflow_call` + `workflow_dispatch`; `permissions: contents: read`) levanta la instancia local en `ubuntu-latest` (`timeout-minutes: 20`) y corre `supabase test db --local` (los 6 pgTAP) + `npm run test:supabase`. Usa `supabase/setup-cli@v1` fijado a 2.113.0 y `supabase start -x studio,imgproxy,mailpit,realtime,edge-runtime,logflare,vector,postgres-meta,supavisor`; `supabase stop --no-backup` va en `if: always()`. Cada job es un runner aislado: declara checkout, setup-node (`node-version-file: package.json`, cache npm), `npm ci` y CLI propios. Un guard falla si el entorno trae cualquier variable `*SUPABASE*` (solo nombres de variable; no inspecciona valores).

`blocking-ci.yml` lo llama como job `supabase-local` con `needs: [detect-changes, process-checks]` y `if: supabase_changed == 'true' && process-checks.result == 'success'`. Va **sin** `secrets: inherit` (no recibe la URL ni la publishable key de PRODUCCIÓN, ni `TAURI_SIGNING_PRIVATE_KEY`) y **fuera** de `required.needs`: un fallo no bloquea `CI required` mientras no sea required (dos semanas en verde lo deciden). `detect-changes` agrega el output `supabase_changed` con: `supabase/**`, `lib/supabase/**`, `lib/sharing/**`, `lib/services/web-sharing-service.ts`, `lib/collections/**`, `app/api/**`, `app/(reading)/shared/**`, `app/[username]/**`, `tests/**/*.supabase.test.*`, `tests/support/supabase-local/**`, `vitest.supabase.config.ts`, `scripts/run-supabase-tests.mjs`, `package.json`, `package-lock.json` y los dos workflows. Antes de los tests, el job comprueba con `has_table_privilege` que `service_role` tenga DML en `public` y, si el volumen fresco no lo trae, aplica el grant como `supabase_admin` (ver la trampa del ACL). La suite no pasa por la Storage API: la migración de storage policies escribe en `storage.buckets` por Postgres y ni pgTAP ni el harness usan el API, así que `supabase start -x … ,storage-api` deja el job verde (corrida real 36975549189) — el servicio no es load-bearing para este job.

**Trampas pagadas.**

- **`replace_writing_collections` stale en el volumen local.** Al 2026-10-01 la instancia compartida falla con `column c.deleted_at does not exist` (`42703`) al invocar la RPC: `public.collections` no tiene `deleted_at` y la función instalada todavía filtra por esa columna, así que `PUT /api/writings/[id]/collections` responde 500. La migración `20260528110006` la alinea con el schema vivo, pero el volumen no la re-aplicó. No es de la prueba de COL-06: las filas de unión se siembran con `seedMembership` bajo RLS y el DELETE real no pasa por la RPC.
- **ACL de `service_role` en `public`.** Un volumen local puede quedar con `service_role` sin DML sobre las tablas de `public`, y entonces `createAdminClient` recibe `permission denied for table ...`. **Corregido el 2026-10-02 (ODE-658):** el volumen fresco del runner de CI (CLI 2.113.0, `postgres:17.6.1.158`) NO trae esos grants — `has_table_privilege('service_role','public.writings','select')` da `f` con owner `postgres` — así que `.github/workflows/supabase-local.yml` lo detecta y repara antes de los tests como `supabase_admin` (superusuario del contenedor), en un `-c` (dos trampas pagadas: `docker exec` sin `-i` descarta el stdin de un heredoc, y un `GRANT` de `postgres` sobre tablas cuyo owner no es él es un warning no-op). En local, verificar con `has_table_privilege('service_role','public.writings','select')`; si da `f`, reparar bajo lock: `npm run supabase:locked -- psql "<DB_URL>" -c "grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant all on all functions in schema public to service_role; alter default privileges in schema public grant all on tables to service_role; alter default privileges in schema public grant all on sequences to service_role; alter default privileges in schema public grant all on functions to service_role;"`.
- **`[auth.rate_limit].sign_in_sign_ups`.** Con CLI 2.113 + gotrue v2.195 la clave se parsea pero no llega al contenedor: esa versión no tiene `GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS`. Sí se aplican `token_refresh` y `token_verifications` (`GOTRUE_RATE_LIMIT_TOKEN_REFRESH`, `GOTRUE_RATE_LIMIT_VERIFY`). La config se mantiene (no afecta a remoto y cubre versiones futuras), pero no asumir que sube el límite de sign-in en este stack.
- **pgTAP de `supabase/tests`.** Al 2026-10-01, dos archivos fallaban en main por drift test↔schema: `margins_enforce_identity.test.sql` insertaba `profiles` sin `display_name` (columna `not null`; además el trigger `on_auth_user_created` ya había creado la fila, así que el insert directo chocaba por partida doble) y `enforce_invitation_writing_ownership.test.sql` esperaba `42501` en un retarget que en realidad bloquea antes el trigger `invitations_enforce_status_update` (`P0001`), y simulaba una fila histórica con un `UPDATE` que ese trigger ahora prohíbe a cualquier rol. ODE-658 los alineó con el schema real (margins: upsert con `display_name`; invitaciones: `throws_like` del mensaje del trigger y fila forjada creada con el trigger desactivado dentro de la transacción) y el job de CI los corre enteros. `writing_shares_permission_enforcement.test.sql` pasa (33/33: 17 aserciones de RLS/RPC y, desde ODE-665, 16 llamadas directas a `public.can_read_writing(target, viewer)` con viewer explícito y booleanos literales —dueño en las tres visibilidades, anónimo, extraño, invitado activo/revocado, share viejo sobre `private`, soft-deleted con control positivo e id inexistente—, sin RLS, RPC ni wrappers; el caso F1 de privado con share viejo es de ODE-616 PR2). Mutaciones en vivo y su salida roja en la Guía de review de ODE-665. Para correr un archivo concreto: `npm run supabase:locked -- supabase test db --local <archivo>`.
- **`.cache/**`.** `npm test` recogía copias de recon alojadas ahí; desde este PR las dos configs de Vitest lo excluyen.
- **DOM para el motor de documentos en node.** El flujo desktop del proof de SHARE-05 (ODE-617 PR-B) necesita el round-trip markdown → TipTap, que usa `window.DOMParser` y `Node`/`document`; el archivo los presta desde un `Window` de happy-dom (peer requerido de `@tiptap/html`) sin cambiar de entorno, para no reemplazar `fetch`/`Request`/`Response` ni perder el pass-through a `127.0.0.1:54321`.

## Mapa de Recon — milestone 4, tanda 5 (ODE-670, 663, 667, 666, 635, 664, 665, 661, 638, 543)

**Verificado en solo lectura sobre `main@68b3f57673b2458875860d18793feed98db213c9` (2026-10-02).** Se consultaron los diez issues con `scripts/linear-cli.mjs get`; todos estaban en Backlog. No se ejecutaron tests, comandos de Supabase ni operaciones en producción. Este mapa registra el Recon técnico; no es autorización para despachar BUILD. Antes del despacho, cada issue requiere su Auditoría, `Architecture Contract`, `Reference docs` y comentario `## Recon Pack` completos, lintados y una sección humana `## Decisiones` según `area-recon.md`.

### Clusters y alcance confirmado

Las agrupaciones sugeridas se ajustan donde el código revela owners distintos. Solo A comparte un seam de código que obliga a ordenar ambos PRs. D es una cohorte semántica de visibilidad, pero ODE-664 y ODE-665 tienen owners y archivos de implementación/test independientes.

| Cluster de Recon | Issues | Decisión de agrupación |
|---|---|---|
| A | ODE-670 → ODE-663 | Se conserva. Ambos extienden el seam SYNC-05/08, sus fixtures y el replay Rust; ODE-670 debe mergear primero. |
| B1 | ODE-667 | Se separa de ODE-666: handler web de DELETE y SyncWorker, sin owner compartido. |
| B2 | ODE-666 | Catálogo desktop, hidratación y snapshot SQLite; runtime distinto de ODE-667. |
| C1 | ODE-635 | Se separa de ODE-638: resolve/rename/persistencia del servicio de documentos. Hugo confirmó conservar el significado de null; BUILD aún debe resolver la protección path-aware contra writes a una ruta obsoleta. |
| C2 | ODE-638 | Guarda UI de persistencia del editor ante cambios externos; no comparte archivos con ODE-635. |
| D1 | ODE-664 | Trigger canónico y convergencia de visibilidad web/desktop. Comparte dominio con ODE-665 y tiene gate humano de migración en producción. |
| D2 | ODE-665 | Oracle pgTAP directo de `can_read_writing`; no comparte archivo de implementación con ODE-664. |
| E1 | ODE-661 | `WorkspaceReconciler`, correlación de movimientos entre roots y coste del scan. |
| E2 | ODE-543 | Tres correcciones independientes del harness (Studio, menú Tauri y fecha); no comparte owner con ODE-661. |

### Auditoría por issue

| Issue | Hallazgo resuelto y efecto para el usuario | Owner, evidencia y simplificación |
|---|---|---|
| ODE-670 — replay de SYNC-08 | El proof debe grabar las llamadas reales de `catalog_list` y `catalog_bulk_dual_write` del camino de metadata de Settings, reproducirlas por el seam existente y entrar en las funciones Rust de catálogo contra SQLite temporal. No requiere cambio de producto. Si el contrato IPC discrepa, el test falla; este issue no repara producción Rust. | Reusar `tests/support/catalog-seam-recorder.ts`, `tests/fixtures/catalog-seam/catalog-seam-v4.json` y `src-tauri/tests/catalog_seam.rs`. ODE-648 ya es dueño del body de nube; ODE-644 no cubre `catalog_bulk_dual_write`. La fila SYNC-08 está en `PARTIAL_INTEGRATION`; este proof agrega evidencia sin cambiar la categoría. |
| ODE-663 — guard `NOT EXISTS` de SYNC-05 | El replay actual no llega a la rama protegida: después de supersede queda una mutación accionable por UUID. Se necesita capturar el comando real `catalog_apply_workspace_removal` y probar que quitar `AND NOT EXISTS` deja el test rojo. Rust genera el ID de la mutación, mientras el recorder TS stubbea `crypto.randomUUID`; la comparación byte a byte de esa respuesta no es válida. Normalizar solo ese ID con alias estable por evento/documento, validando forma y unicidad UUID, y seguir comparando tipo, payload, versión, timestamps, estado, retry, orden, document ID y conteos. Retirar un root no elimina el directorio; para cerrar debe registrarse de nuevo. | Reusar el seam A, el comando en `src-tauri/src/commands/index.rs:860-975` (UUID en `:957`) y el predicado en `:1473-1477`; recorder `:1084-1105`. `workflow/testing/integration-harness-catalog.md:90` ya reconoce el hueco. ODE-670 primero porque ambos regeneran fixtures/seam. |
| ODE-667 — DELETE remoto ya ausente | `DELETE /api/writings/[id]` usa service role y filtra explícitamente por `id + author_id`; 404 se considera error retryable por SyncWorker. El cambio mínimo es una mutación condicional owner-scoped que devuelva éxito idempotente cuando afectó cero filas, sin distinguir ID inexistente de fila ajena; limpiar shares/invitaciones solo si la fila propia se borró. Evita SELECT→UPDATE y su carrera. Mantener 401, validación y errores DB; no añadir excepción general en SyncWorker/retry. El usuario deja de reintentar para siempre un borrado cuya fila nube ya desapareció, y no puede borrar fila de otra cuenta. | Owner: handler `app/api/writings/[id]/route.ts:236-303`; cliente admin en `lib/supabase/admin.ts:4-10`; filtro y 404 en `route.ts:252-265`, borrado/cleanup `:267-303`. SyncWorker reintenta non-2xx en `lib/sync/worker.ts:42-65,92-106,320-365` y retry `lib/sync/retry.ts:1-16`. No hay test de DELETE de writings; extender integración del handler + worker con cola/DB real local al construir. Caso aparte fuera del scope: un upsert ya en vuelo puede terminar antes de que el delete pendiente se procese en el siguiente trigger (`worker.ts:232-242`); follow-up, no generalizar esta corrección. |
| ODE-666 — hidratación de colecciones tombstoned | La hidratación desktop aplica una colección cloud como `deletedAt:null`; `catalog_apply_collection_snapshot` hace upsert ciego tanto de colección como de relaciones. Un snapshot stale revive una colección local borrada y puede volver a mostrarla en Desk/Properties. Preservar tombstones locales (pending y confirmados) dentro del merge transaccional de catálogo y omitir sus relaciones; no restaurar ni borrar writings/files, ni podar filas por ausencia del snapshot. No introducir restore implícito: cloud no tiene `deleted_at` y el delete cloud es físico. | Owner: `lib/sync/desktop-catalog-sync-service.ts:566-590`, comando Rust `src-tauri/src/commands/index.rs:1560-1627`; borrado atómico desktop en `lib/services/desktop/desktop-collection-service.ts:125-134` y `index.rs:1700-1722`; status sync `:1795-1812`. Reusar merge del catálogo. Extender `src-tauri/tests/collection_delete_keeps_documents.rs` con delete→snapshot live stale, pending/confirmed tombstone, cero relaciones y contenido intacto; la prueba TS de hidratación complementa, no sustituye SQLite real. La política de colecciones exige conservar documentos y archivos (`workflow/context/features/odessay-collections.md:130-133`). Merge antes de ODE-664, que toca el mismo servicio TS. **Construido en ODE-666:** el merge transaccional preserva el tombstone local (pending y confirmado) y omite sus relaciones; la prueba canónica es `src-tauri/tests/collection_delete_keeps_documents.rs` sobre SQLite real y la complementa el recorrido real de `hydrateCollections` → `catalog_apply_collection_snapshot` en `tests/integration/collections/delete-collection-keeps-writings.desktop.test.ts` (el transporte IPC sigue doblado, como en toda la fila). |
| ODE-635 — null baseline + rename | `expectedContentHash:null` significa explícitamente “sin guardia” tanto en el contrato TS como Rust. La integración existente es `it.fails`: save sin baseline cruzado con rename puede recrear el archivo en la ruta anterior y el reconciliador puede rebindear el UUID. `renamesInFlight` solo espera/reintenta ante conflictos; no es un mutex reusable. Usar silenciosamente el hash actual del binding como sustituto cambia el contrato y podría sobrescribir un H2 externo con un caller obsoleto H1. Hugo confirmó conservar null y proteger cambios externos sin escribir en la ruta vieja; no queda una decisión de producto pendiente. BUILD debe diseñar y demostrar esa coordinación/path resolution en el owner existente, sin asumir que hay un lock reusable. | Owner: `lib/services/document-service-factory.ts:181,352-396,505-519`; null contract `lib/services/contracts/document-service.ts:73`, Rust `src-tauri/src/commands/document.rs:104-145`; reproducer `tests/integration/documents/save-rename-null-baseline.test.ts:94,103,143-168`; control ODE-629 en `tests/editor-shell-create-rename.test.tsx:420`. No hay lock por UUID existente; `PersistenceCoordinator` no coordina rename/relocate. Requeridos ADR de identidad y catálogo por el contrato binding/save. La integración usa filesystem real, pero transporte de SQLite/Tauri doblado. |
| ODE-638 — observar la guarda externa | La guarda semántica vive en `useEditorPersistence.persistEditorSnapshot` antes de entrar en `PersistenceCoordinator` y ya no queda invisible: la mutación que la elimina pone rojos los dos casos sucios por su contador de intentos de `write_file`. El caso nuevo retiene la lectura del catálogo del evento externo y el rAF del tecleo, de modo que la decisión de conflicto ve la edición local antes de su hand-off; al drenar el trabajo agendado y esperar el debounce durable completo (150 ms + 4 s) no hay ni un intento de escritura, el disco conserva la externa, el editor conserva su copia, el aviso sigue y la barra no pasa por `Saving...`/`Needs attention`; «Keep my version» sigue guardando como control positivo. El caso sucio existente ahora espera 4.5 s y afirma el contador. Sin cambio de producto ni de dobles compartidos. | Owner `hooks/useEditorPersistence.ts:429-436` (guard) y `:468-493` (hand-off); resolución `hooks/useExternalDocumentChanges.ts:225-232,344-357`; prueba `tests/editor-shell-external-changes-desktop.test.tsx` (caso nuevo + extensión del caso de `:415`), reutilizando `holdCatalogReads` y `holdAnimationFrames` del harness. Mutaciones en vivo: quitar la guarda temprana (contador 2≠1 en el caso viejo y 1≠0 en el nuevo) y no limpiar el ref antes del guardado deliberado (control positivo rojo). Alcance rich mode; Markdown sin tocar. Sin conflicto de archivos con ODE-635. |
| ODE-664 — visibilidad derivada al compartir | La fuente canónica debe ser el trigger existente `public.writings_set_derived_fields()`: antes de derivar slug, promocionar `private`→`shared` si existe fila en `writing_shares`, dentro de esa misma función. El PATCH web ya implementa el guard manual y puede dejar de hacerlo manteniendo auth/owner filter. Desktop actualmente escribe la visibilidad enviada y marca sync sin leer de vuelta el resultado canónico; debe proyectar `shared` de nube a SQLite sin pisar una mutación local pendiente más nueva. El usuario/grantee conserva acceso uniforme tras editar el writing desde web o desktop; strangers y anónimos no. No crear segundo trigger, RPC, UI desktop ni índice duplicado (unique `(writing_id,shared_with_id)` ya da left-prefix lookup). | Owner DB: `supabase/migrations/20260331_phase2_visibility_rls.sql:21-60`; el trigger de writings está en `20260317145743_initial_schema.sql:467-470`. Web `app/api/writings/[id]/route.ts:132-169`; desktop `lib/sync/desktop-catalog-sync-service.ts:376-452,671-674`; test de integración actual `tests/integration/sharing/visibility-persistence.supabase.test.ts:482-513`. `can_read_writing` exige no eliminado, y para `shared` owner o grantee (`initial_schema.sql:482-509`); recepción usa la misma función en `20261002000000_fix_list_incoming_shared_writings_visibility.sql:40-47`. Sharing sigue siendo web-only por `odessay-runtime-coexistence-policy.md:58`. |
| ODE-665 — oracle directo de permisos | Extender el pgTAP existente con llamadas literales y viewer explícito a `can_read_writing`: owner, anon, stranger, grantee, grant revocado, eliminado, id inexistente y share viejo sobre writing `private`; no inferir resultado a través de RLS, RPC o wrappers. Actualizar `plan(17)` según las aserciones añadidas. No se necesita cambio de CI: `.github/workflows/supabase-local.yml:101-105` descubre todos los `supabase/tests/*.test.sql`. Corregir el encabezado stale “not wired into CI” si se edita el archivo. | Owner `supabase/tests/writing_shares_permission_enforcement.test.sql:28,45-50,89-95`; oracle `public.can_read_writing` en `supabase/migrations/20260317145743_initial_schema.sql:482-509`. `tests/integration/supabase-local-smoke.supabase.test.ts:159` cubre solo service_role owner/stranger private, no sustituye pgTAP directo. La fila SHARE-04 queda en `INTEGRATION`; este test amplía la prueba del contrato. Sin instancia local/remota necesaria para el Recon. |
| ODE-661 — move entre roots con eventos separados | La cobertura existente correlaciona los eventos que llegan en una misma ráfaga de 250 ms. Los dos casos `it.fails` de este issue separan detach y arrival por 500 ms y alternan su orden. El watcher solo reenvía eventos; `WorkspaceReconciler` correlaciona solo lo observado en el mismo pass (`correlateAcrossRoots`), por lo que pass A puede olvidar evidencia antes de B y acuñar UUID nuevo. Owner único: reconciliador global, no UI. Decisión de Hugo (2026-10-03): ampliar la cobertura a avisos más lentos, sin imponer un máximo temporal; 500 ms es el caso del test, no el límite del producto. Candidato de diseño: ante scan sospechoso (unbound o detached), expandir ese mismo pass a todos los roots activos antes de escribir binding/UUID, y reusar `correlateAcrossRoots`; scans normales siguen locales. Limitar a una expansión por burst con coalesce/single-flight. Coste esperado: normal O(n del root); sospechoso O(N archivos seleccionados de roots activos) por burst. BUILD debe instrumentar roots/archivos por scan y medir tamaño representativo. **Context Gap — Desktop Document Architecture (`stale-doc`):** la decisión de producto amplía el alcance más allá del límite de 250 ms de la spec aceptada; esa spec y su registro documental deben actualizarse antes de BUILD. Hasta entonces el issue no se despacha. | Owner `lib/services/desktop/workspace-reconciler.ts:4-25,409-425,632-735,740-775`; watcher `lib/services/desktop/desktop-workspace-reconciler.ts:140-151`; test `tests/integration/documents/external-move-across-roots.test.tsx:499-588`. Correlación exige 1:1 `device+inode+content_hash`; no resuelve cross-volume. Catálogo guarda inode/hash pero no device; el binding indexa root+relative path, y el detach confirmado borra el binding (`src-tauri/src/commands/index.rs:1342-1365`), así que candidato global durable requiere migración/estado nuevo. Reusar scan completo existente solo bajo sospecha evita cache y lifecycle nuevos. La prueba usa watcher doblado: no afirma transporte OS/Tauri real. WATCH-04 sigue `PARTIAL_INTEGRATION`. |
| ODE-543 — tres expectativas del harness | (1) La expectativa de status bar sí identifica drift de producto: prototipo `.dc.html` es autoridad geométrica; Studio prescribe tres columnas y `EditorStatusBar` usa dos grupos flex. Restaurar grid `minmax(0,1fr) auto minmax(0,1fr)` y probar regiones/layout sin depender solo de una cadena utilitaria. (2) En menú Tauri, las dos invocaciones esperadas son `write_file`; `take_pending_open_paths` es el drain legítimo de arranque. Filtrar por comando y afirmar args en lugar del total global. (3) Formatter de actividad usa timezone local por contrato; `2026-03-10T00:00Z` cae en Mar 9 en America/Bogota. Estabilizar fixture al mediodía UTC; no cambiar formatter. BUILD verifica en UTC y America/Bogota. | Status bar: `components/editor/status-bar.tsx:70-100`, contract `docs/design/views/studio.md`, autoridad geométrica `Artifact Studio Studio.dc.html:806-816`, guard actual `tests/studio-shell-contract.test.ts:16-33`. Menú: `hooks/useTauriMenuEvents.ts:128-134,158-195`, test `tests/tauri-menu-events-save.test.tsx:136-155`. Fecha: `lib/queries/desk-activity.ts:194-208,629-637`, fixture `tests/desk-activity.test.ts:7-19`. No cambiar consumidor de fechas ni convertir una consulta correcta a UTC. ODE-599 ya está resuelto. Este issue sí toca implementación visual para restaurar el contrato; los otros dos son ajustes de prueba/fixture. **Construido en ODE-543 (BUILD, 2026-10-03):** la status bar volvió al grid de tres regiones `minmax(0,1fr) auto minmax(0,1fr)` (save state · modo · métricas+acciones), con las regiones marcadas `data-region` y probadas por orden y ownership — no solo por la clase; el guard pasó por `it.fails` en commit propio y el fix lo dejó en `it` sin tocar su cuerpo. El test de menú filtra por comando y afirma los args de los dos `write_file`, dejando `take_pending_open_paths` fuera del conteo y sin cambio de producto. El fixture de actividad quedó a mediodía UTC (`2026-03-09T12:00:00.000Z`), conservando la aserción `Created Mar 9` y verde en `TZ=UTC` y `TZ=America/Bogota`; el formatter no se tocó. Mutaciones en rojo: status bar a flex (`tests/studio-shell-contract.test.ts:27`), un `write_file` extra (`tests/tauri-menu-events-save.test.tsx:148`) y el fixture a medianoche Mar 10 bajo `TZ=UTC` (`tests/desk-activity.test.ts:193`). |

### Conflictos reales de archivos y precedencia

El grafo excluye este mapa, el capability map y otros docs compartidos del conteo de conflictos, tal como pide `area-recon.md`.

| Arista | Archivos coincidentes | Orden requerido |
|---|---|---|
| ODE-670 — ODE-663 | `tests/support/catalog-seam-recorder.ts`, `tests/catalog-seam-fixture.test.ts`, `tests/fixtures/catalog-seam/catalog-seam-v4.json`, `src-tauri/tests/catalog_seam.rs`; posible `tests/integration/documents/support/real-desktop-doubles.ts` | ODE-670 → ODE-663; ODE-663 regenera y extiende el seam ya estabilizado por ODE-670. |
| ODE-667 — ODE-664 | `app/api/writings/[id]/route.ts` (DELETE frente a PATCH) | ODE-667 → ODE-664 para evitar resolver conflictos en el mismo handler. |
| ODE-666 — ODE-664 | `lib/sync/desktop-catalog-sync-service.ts` (snapshot/hidratación frente a write/readback) | ODE-666 → ODE-664. |

ODE-664 y ODE-665 no comparten archivo de código/test previsto: pgTAP directo queda en `supabase/tests/writing_shares_permission_enforcement.test.sql`; 664 usa migración, route y prueba de integración TS. Se recomienda mergear 665 antes de 664 para establecer primero el oracle del permiso, pero no es una colisión técnica. ODE-635 y ODE-638 tampoco comparten código/test; ODE-661 y ODE-543 son independientes. `workflow/quality/capability-integration-map.md` se excluye del grafo, aunque SHARE-05 debe corregir su nota stale y WATCH-04 documentar el límite nuevo cuando se autorice actualización de ese mapa.

### Olas y orden de merge

**Corrección posterior al merge (2026-10-03, revisión del Recon antes del v9).** Las olas originales dejaban ODE-670 (P0, fila CRITICAL) en la ola 3 y las dos cadenas largas al final. El v9 arranca por las cabezas de las cadenas:

- **Ola 1:** ODE-670 · ODE-667 · ODE-666. Son las cabezas de las dos cadenas (670 → 663 y 667/666 → 664).
- **Al liberarse un hueco, en este orden:** ODE-663 (cuando 670 esté mergeado) · ODE-664 (cuando 667 y 666 estén mergeados; mejor después de 665) · ODE-635 · ODE-661 (requiere la enmienda de la spec en main) · ODE-665 · ODE-638 · ODE-543.
- Máximo 3 builders activos. Un PR aprobado no espera a otro sin arista dura.

**Orden de merge preferente:** ODE-670 → ODE-667 → ODE-666 → ODE-663 → ODE-665 → ODE-664 → ODE-635 → ODE-661 → ODE-638 → ODE-543.

**Merge = deploy.** Vercel despliega `main` en cada merge, así que el gate de producción de ODE-664 va **antes de su merge**, no antes de un deploy aparte (ver abajo).

### Decisiones y tareas humanas

- **ODE-635 — decisión recibida de Hugo (2026-10-03):** `expectedContentHash:null` conserva el significado de “sin baseline”; no usar el hash actual del binding como sustituto. El guardado debe evitar persistir en la ruta obsoleta y proteger cambios externos. BUILD debe diseñar y probar esa ruta sin reinterpretar `null` como permiso para sobrescribir.
- **ODE-664 — decisión recibida de Hugo (2026-10-03):** toda fila existente de `writing_shares` cuenta como grant vigente, sin backfill ni revocación automática. Un siguiente UPDATE puede restaurar el acceso al destinatario. Las filas que ya no deban conceder acceso se deben revisar/revocar explícitamente antes del cambio.
- **ODE-661 — decisión recibida de Hugo (2026-10-03):** no fijar un máximo de tiempo para la separación entre avisos del mismo movimiento. Antes de BUILD, actualizar/aprobar el contrato del catálogo y su registro documental para quitar el límite de 250 ms; hasta entonces el issue sigue en hold. **Hecho en el PR de la enmienda ODE-661 de la spec** (`odessay-desktop-document-catalog.md` § Prioridad de reconciliación, cabecera de enmiendas y `workflow/docs.json`). Los movimientos entre volúmenes siguen fuera de alcance según la limitación de inode.
- **Gate de producción para ODE-664 (tarea humana), ANTES del merge de su PR.** No existe staging: el único proyecto Supabase se llama "odessay-staging" y **es producción**. Orden: (1) validación completa en Supabase local; (2) Hugo corre la consulta de solo lectura de la Auditoría de ODE-664 (writings privados que conservan filas en `writing_shares`) y revoca las que no deban conceder acceso, porque con el trigger esos writings pasan a `shared` en su siguiente UPDATE; (3) Hugo aplica y confirma la migración en producción; (4) se mergea el PR. El rollback de la migración debe restaurar la función vigente de `20260331_phase2_visibility_rls.sql` (con slug/body_text), no la versión antigua de `initial_schema.sql`. Este Recon no inspecciona ni modifica producción y no ejecuta comandos Supabase.
- **Antes de cerrar ODE-661:** BUILD aporta medición representativa de roots/archivos seleccionados, contadores de expansión y prueba de ambos órdenes separados por >250 ms; confirma que edit normal no lanza full scan y que un burst sospechoso expande como máximo una vez. No se fija threshold sin dato de volumen del producto. **Cumplido (BUILD, 2026-10-03, PR de ODE-661):** los dos órdenes con 500 ms pasan a `it` sin editar sus cuerpos; `WorkspaceReconciler` expande la misma pasada a todas las raíces activas solo ante un resultado sospechoso (unbound o detach sin su par) y como máximo una vez por ráfaga; el test de coste mide edición normal = 1 raíz/5 archivos contra detach sin par = 3 raíces activas escaneadas una sola vez (origen 4 archivos + expandida 3 + gestionada). WATCH-04 sigue en `PARTIAL_INTEGRATION` (watcher/IPC OS doblados); cross-volume queda fuera de alcance. **Revisión ronda 1 (2026-10-03, P1 corregido):** la raíz de origen vacía ya no pierde identidad; `WorkspaceReconciler` retiene por raíz activa el último volumen observado y lo usa para verificar el lado origen sin exigir archivos residentes, preservando la igualdad de volumen y el límite cross-volume. La regresión nueva cubre los dos órdenes con raíz de origen vacía (500 ms) y mide la pasada (3 raíces activas una vez, origen 0 archivos, destino 1 no ligado); la mutación M4 de la Guía (quitar el volumen recordado) pone rojos ambos órdenes. **Revisión ronda 2 (2026-10-03, P1+P2 corregidos):** el volumen recordado se invalida cuando la pasada no puede observar la raíz (scan `null` por desmontaje posible) y se reemplaza con cada observación directa, así que una raíz re-montada en otro volumen no reutiliza el device viejo (UUID nuevo antes que ligar mal); las entradas se podan a las raíces activas en `start`/`rescanAll`, de modo que una raíz retirada no crece la tabla ni resucita evidencia al re-añadirse. Dos regresiones nuevas en `external-move-across-roots.test.tsx` (cambio de volumen; retirada/re-añadida) con `it.fails` pre-fix y mutaciones M5/M6 rojas; cross-volume sigue fuera de alcance y WATCH-04 sigue `PARTIAL_INTEGRATION`. **Revisión ronda 3 (2026-10-03, P1 residual corregido):** un scan rechazado —el adapter puede rechazar después de un `workspace_sync` fallido o de un snapshot, al leer el catálogo fuera de su try interno— también invalida la evidencia de volumen de esa raíz: el `catch` por raíz descarta la entrada antes de aislar el fallo, así que un re-montaje observado después en otro volumen no reutiliza el device viejo (UUID nuevo antes que ligar mal). La regresión nueva ('scan rechazado') entra como `it.fails` pre-fix, el fix la pasa a `it` sin tocar su cuerpo y la mutación M7 de la Guía (quitar la invalidación del catch) la pone roja; M5/M6 re-corridas en rojo. Sin contrato nuevo ni estado durable; cross-volume sigue fuera de alcance y WATCH-04 sigue `PARTIAL_INTEGRATION`.
- **Para toda la tanda:** Hugo confirmó las decisiones de ODE-635, ODE-664 y ODE-661; sus comentarios `## Decisiones` ya están registrados en Linear. Antes del dispatch, los otros issues necesitan su comentario humano `## Decisiones` de cierre según `area-recon.md`. No se han aplicado defaults que Hugo no haya confirmado.

### Capability map y follow-ups

Recuento base observado en `main@68b3f57673b2458875860d18793feed98db213c9`: `CONTRACT=6, INTEGRATION=41, NONE=1, PARTIAL_INTEGRATION=47, RELEASE=1, UNIT_ONLY=11, total=107`. Filas relevantes: SYNC-05 `PARTIAL_INTEGRATION`; SYNC-08 `PARTIAL_INTEGRATION`; SHARE-04 y SHARE-05 `INTEGRATION`; WATCH-04 `PARTIAL_INTEGRATION`; WATCH-07 `INTEGRATION`; COL-06 `INTEGRATION`. Recon no cambia la categoría. BUILD, al cerrar las pruebas, debe actualizar evidencia: ODE-663 cierra la rama `NOT EXISTS`; ODE-670 fortalece SYNC-08 sin promoverla por sí sola a `INTEGRATION`; ODE-665 añade oracle pgTAP a SHARE-04; ODE-664 actualiza nota stale de SHARE-05 si la visibilidad queda persistida en ambas rutas; ODE-661 no promueve WATCH-04 más allá de `PARTIAL_INTEGRATION` porque watcher/IPC OS siguen doblados. ODE-543 (2026-10-03): los tres guards del harness (status bar, menú y fixture de fecha) quedan verdes; ninguno es evidencia de un escenario del capability map, así que el recuento no cambia.

No se crean follow-ups en Recon. ODE-667 deja fuera la carrera upsert-en-vuelo→delete para seguimiento del área; ODE-664 no afirma que el `EXECUTE` ACL de `can_read_writing` exponga un oracle (no verificado en un entorno autorizado); ODE-661 deja fuera movimientos cross-volume. BUILD puede elevarlos solo con evidencia y brief propio. No se inspeccionó ni cambió ninguna base de datos.

### Entregado en ODE-667 (BUILD, 2026-10-03)

El DELETE remoto de un writing ya no distingue "fila ausente" de "fila ajena": `app/api/writings/[id]/route.ts` hace una única mutación condicional por `id + author_id` con `.select()` (sin SELECT→UPDATE), responde 200 idempotente con `{ data: null, error: null }` cuando afectó cero filas y solo limpia shares/invitaciones con una fila propia confirmada. La política de retry de `lib/sync/worker.ts`/`lib/sync/retry.ts` no se tocó. El proof nuevo, `tests/integration/sync/web-writing-delete-idempotent.supabase.test.ts`, entra por los servicios reales de web (`webDocumentService.saveWriting`/`deleteWriting`), usa el `localDB` real sobre `fake-indexeddb`, el `getSyncService()`/`scheduleFlush()` reales y el **`SyncWorker` singleton real** (nada de `vi.mock` ni de instanciar otro worker): el encolado programa `getSyncWorker().schedule(0)`, el timer se controla con fake timers de vitest y el `flush()` real corre con su transporte de producción; solo se doblan fronteras externas: la red (el fetch del worker entra al handler real por `createRouteFetch`) y el runtime de navegador (`window`/`navigator.onLine`, como el navegador real). El handler usa el service role real y Postgres es la instancia Supabase local; el evento de completitud es la métrica de producción `sync.flush` (cuyo `trigger` distingue `schedule(0)` del tick de retry `debounce`) y el estado canónico se lee por el admin del harness después de esa métrica, no del tick que agenda. Cubre: (A) crear local-only → encolar delete → flush antes de cualquier upsert, con la cola consumiendo la mutación sin gastar intentos y la nube sin fila; (B) respuesta perdida tras un delete aplicado (el fetch rechaza después de que el handler commiteó), un intento consumido por la política intacta y replay de la misma mutación sin duplicar ni corromper, con cleanup del dueño; (C) fila ajena intacta y sin cleanup, respuesta idéntica a la de un ID inexistente y control positivo del dueño real. Mutaciones en vivo en la Guía de review, re-corridas con este harness (404 con cero filas, quitar `author_id`, cleanup fuera del guard, omitir cleanup). La fila SYNC-04 suma esta evidencia y sigue `PARTIAL_INTEGRATION` (el retry de upsert y el libro de intentos siguen en unidad/dobles; el delete de desktop usa otro owner). **Follow-ups que BUILD no convierte en issue:** (1) la carrera de un upsert en vuelo contra un delete pendiente (`worker.ts:232-242`) sigue fuera de alcance, como marcó el Recon; (2) el cleanup de invitaciones del handler filtra por una columna `marker` que no existe en `public.invitations` (el `UPDATE` falla con columna inexistente y el error se traga en `[writings:delete:cascade]`), así que ese cleanup es un no-op previo, ajeno a la idempotencia de ODE-667; el filtro vigente de los enlaces ux-eval es el email `ux-eval+%`. Tiempo de validación del Recon Pack: ~1 min, `git diff 68b3f576..origin/main` vacío para los cuatro archivos del pack; sin correcciones de Recon.

### Entregado en ODE-670 (BUILD, 2026-10-03)

**SYNC-08 — replay nativo del camino de metadata (fixture v4 extendido).** El seam existente graba y replaya ahora `catalog_list` y `catalog_bulk_dual_write` desde los productores reales de metadata, además de `settings_read`/`settings_write` (el store de Settings es parte de la ruta de producción). Tres escenas nuevas, todas con backend de cola y solo la red de Supabase y el decode IPC de Tauri doblados:

- `sync08-bound-pending-save-metadata`: documento ligado cloud-owned (hidratado por `hydrateWritings` real desde el fake cloud) → `DesktopDocumentService.saveWriting` (mutación de cuerpo pendiente) → `updateWritingMetadata` antes del flush. Control tras cada frontera: la mutación de cuerpo con `mutationKind:null`, luego el supersede con una sola accionable de metadata y el hash del binding intacto.
- `sync08-first-upload-metadata-before-flush`: `createDesktopDraft` real con id conocido y `preferredPath` (perfil `queue`, sin commit de reconcile) cuyo create pendiente es superado por la metadata antes del primer flush.
- `sync08-settings-metadata-batch`: `DesktopSettingsService.deleteVocabularyItem` → `catalog_list(cloudAccountId:null, …)` → `catalog_bulk_dual_write` con `binding:null`. La fila ligada cloud-owned recibe una mutación de metadata; el control local-only se reescribe sin mutación; la fila solo-nube (hidratada con cuenta, sin binding) queda **excluida por el filtro de cuenta real** del SQL (`index.rs:1166-1187`).

El recorder delega la cola en `real-desktop-doubles.ts` y añade `tauriCatalogListQueryDouble`, espejo fiel de filtros y orden de `catalog_list`; `tauriCatalogListDouble` (el atajo que ignora la query) se conserva porque ODE-648 lo consume. El replay en `src-tauri/tests/catalog_seam.rs` cubre `catalog_list`, `catalog_bulk_dual_write` y `settings_read`/`settings_write` sobre las funciones reales, compara cada respuesta (ids del bulk en orden de entrada; filas con cachés de metadata) y afirma por escena documento, metadata/versión, `document_bindings.content_hash` y cada fila de `sync_mutations` en una conexión nueva, con el payload que distingue metadata de cuerpo. El perfil `queue` evita las aserciones de estado final del reconciliador en la escena sin commits de reconcile; el resto conserva `assert_scenario`.

**Hallazgo y límite:** el productor de Settings pasa `cloudAccountId:null` y el SQL real lo trata como "sin cuenta activa", así que una fila solo-nube con cuenta nunca entra al lote. ODE-648 no lo vio porque su doble ignoraba la query. Sin cambio de producto: el caso correcto queda como `it.fails` "follow-up pendiente (ODE-670)" en `tests/catalog-seam-fixture.test.ts` y el seguimiento (pasar la cuenta activa en el productor) se anota en el Context Report. Mutaciones en vivo: vaciar el hash del binding en la escritura de metadata pone rojo el control cloud-owned; invertir los ids del bulk rompe la comparación de respuesta; quitar el filtro de cuenta de `catalog_list` mete la fila solo-nube en la respuesta real; delegar en el doble sin filtro o perder `mutationKind` en la proyección rompen la grabación. La fila SYNC-08 sigue en `PARTIAL_INTEGRATION`: el transporte IPC real (RUNTIME, ODE-622), la red de Supabase y el body cloud final (ODE-648) quedan fuera; el `.md` en disco es la autoridad del cuerpo que el replay verifica.
