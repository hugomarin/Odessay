# Editor Shell — Diagnóstico de descomposición

`components/editor/editor-shell.tsx` es el mayor riesgo estructural del código y su deuda más grande. La intención es romperlo en piezas con responsabilidad específica, pero **no antes de tener cobertura que sirva como red de seguridad** — refactorizar a ciegas un archivo de este tamaño es cómo se rompen invariantes en silencio.

Este documento es el diagnóstico previo: qué hay realmente ahí dentro, qué cobertura existe hoy, por qué la que existe no sirve como red, y qué hace falta construir antes de mover la primera pieza.

**No** es el plan de extracción detallado. Ese se escribe cuando la red exista, y su contenido depende de lo que la red revele.

**Snapshot de la medición**
```text
Fecha:   2026-09-22
Commit:  e8889942 (main)
Método:  inventario de declaraciones + conteo mecánico sobre el archivo real,
         no estimación sobre el mapa de capabilities
```

---

## 1. Qué hay dentro

```text
7,324 líneas
   63 useEffect        92 useCallback        30 useRef        ~60 useState
  602 lecturas de `<algo>Ref.current`
   19 efectos cuya única función es copiar estado a un ref
    8 llamadas directas a localDB.correctionBlocks (deuda ya declarada en components/editor/AGENTS.md)
```

**Actualización (2026-09-23, ODE-558):** la cola automática de correcciones resultó ser **código inalcanzable** y se eliminó. El archivo y el cluster quedan así:

```text
6,664 líneas        (-660)
   61 useEffect     (-2)    84 useCallback (-8)    19 useRef (-11)
  481 lecturas de refs      (-121)
  305 referencias a corrections   (-228, era el cluster más grande)
    8 llamadas directas a localDB.correctionBlocks   (sin cambio: todas viven en el camino manual)
```

**Actualización (2026-09-23, ODE-562 — primer corte, hidratación):** el efecto de hidratación (~456 líneas) salió tal cual a `hooks/useDocumentHydration.ts`. Mudanza mecánica: mismas 12 dependencias y mismas guardas de generación; la shell llama al hook en la posición que ocupaba el efecto y los refs espejo siguen siendo suyos. Diferencias medidas contra `main` con el mismo método antes y después:

```text
6,265 líneas        (-399)
   60 useEffect     (-1)
  -25 lecturas de refs (el efecto las lleva consigo; siguen leyendo los mismos refs)
    8 llamadas directas a localDB.correctionBlocks   (sin cambio, a propósito: las dos de la
                                                      hidratación se inyectan desde la shell, donde
                                                      la deuda está declarada; pagarla es el corte 2)
```

La red que lo protege: 4a, 4b, los humos desktop y corrections, ODE-464 y los barridos de ODE-561, más dos pruebas nuevas previas al corte (restauración de selección, STATE-07, y admisión de sugerencias hidratadas desde caché). Las tres mutaciones de referencia se repitieron sobre el hook y siguen poniéndose en rojo. La regla `ui-no-direct-persistence` escanea ahora también `hooks/`.

**Actualización (2026-09-24, ODE-586 — corte 2, entrega 1):** las 8 llamadas directas a `localDB.correctionBlocks` de la shell pasan por su dueño canónico, `lib/corrections/persistence.ts` (`readLocalCorrectionBlocks`, `saveLocalCorrectionBlock`, `deleteLocalCorrectionBlocks`). El baseline de `ui-no-direct-persistence` queda vacío. Sin cambio de comportamiento; la mudanza del cluster a un hook es la entrega 2.

**Actualización (2026-09-24, ODE-586 — corte 2, entrega 2a):** el estado de sugerencias, su admisión y la caché de bloques de corrección salen tal cual a `hooks/useCorrectionBlocks.ts` (batcher, `applyCorrectionSuggestionUpdate`, admisión, `persistCorrectionBlockWriteThrough`, `updatePersistedBlocksFromSuggestions`, `deletePersistedBlocksForPosition`, `flushPendingCorrectionBlocks`…). Mudanza mecánica, como ODE-562: sin efectos, así que el orden de efectos de la shell no cambia; el estado y los refs siguen siendo de la shell. Antes se añadió la red que faltaba, aceptar y rechazar una corrección por la shell (`tests/editor-shell-corrections-accept.test.tsx`, AI-05/AI-06). Contra la entrega 1, con el mismo método:

```text
6,121 líneas        (-249)
   80 useCallback   (-10)
  228 referencias a corrections   (-58)
```

La segunda mitad del cluster (aplicar, aceptar, rechazar, aprender palabra, el toast, el cableado de `useManualCorrections` y la invalidación por edición) es la entrega 2b.

**Actualización (2026-09-24, ODE-586 — corte 2, entrega 2b):** la segunda mitad sale en dos hooks, cada uno llamado donde estaba su código, porque en la shell vivía en dos bloques separados y juntarlos habría obligado a reordenarla:

- `hooks/useCorrectionActions.ts`: aplicar (rich y markdown), aceptar, rechazar, aceptar o rechazar todas, aprender y olvidar palabras, y el toast. Solo callbacks.
- `hooks/useCorrectionLifecycle.ts`: los espejos de sugerencias y palabras aprendidas, la carga de palabras aprendidas, `useManualCorrections`, la invalidación por edición, el volcado al recuperar la conexión y las acciones en línea desde las decoraciones. Sus efectos corren en el mismo orden y en la misma posición.

Mudanza mecánica. El estado y los refs siguen siendo de la shell. Sale también `getBlockSuggestions`, que nadie usaba. Contra la entrega 2a:

```text
5,500 líneas        (-621)
   45 useEffect     (-6)
   68 useCallback   (-12)
  122 referencias a corrections   (-106)
```

Con esto el cluster de correcciones queda fuera de la shell. Lo pendiente es de estado, no de sitio:

- **Los espejos** de sugerencias y palabras aprendidas siguen existiendo; ahora viven en el hook.
- **Aceptar y rechazar están duplicados**: la versión del panel y la versión en línea desde las decoraciones tienen cada una su lógica.
- **Sin prueba:** el volcado de bloques pendientes al recuperar la conexión no tiene ninguna.

**Actualización (2026-09-25, ODE-587 — corte 3, entrega 1a):** los handlers de pestaña salen tal cual a `hooks/useWorkspaceTabs.ts`: seleccionar, cerrar, cerrar otras o todas, mostrar el archivo, renombrar (también desde una pestaña de fondo) y reordenar, más el estado editorial que dibuja cada pestaña. La shell los llama donde empezaba ese bloque; entre su primer handler y su último efecto no había otro efecto, así que el orden no cambia. Antes se añadió la red que faltaba para las dos piezas sin prueba (`tests/editor-shell-workspace-tabs.test.tsx`). Cerrar con un guardado pendiente y activar la siguiente pestaña al cerrar solo los prueba #494 (ODE-574), verificado sobre el código combinado. El resto del cluster (restaurar la sesión, publicar el estado de la pestaña, crear pestaña, abrir un documento del workspace) vive en otros bloques de la shell y va en entregas siguientes. Contra la entrega 2b de ODE-586:

```text
5,247 líneas        (-253)
   43 useEffect     (-2)
   60 useCallback   (-8)
```

**Actualización (2026-09-25, ODE-587 — corte 3, entrega 1b):** la entrada a la sesión sale tal cual a `hooks/useSessionRestore.ts`, con sus tres efectos consecutivos, en el mismo orden y en la misma posición:

- abrir la pestaña del documento de la ruta;
- restaurar la sesión persistida;
- la identidad ansiosa de un `/write` en blanco en web.

Los helpers puros del módulo de la shell (`navigateToWriting`, `deriveAutoTitle`, `isPerfHarness`) llegan por `input` para no crear un ciclo de imports. El efecto que activa el documento de la ruta y el espejo `activeEditorTabIdRef` (la excepción declarada del ADR) se quedan en la shell. Abrir la pestaña de la ruta no tiene ningún efecto observable distinto de la publicación de la pestaña en los escenarios probados: sin él, esa publicación crea la pestaña igual.

**Actualización (2026-09-25, ODE-587 — corte 3, entrega 1c):** abrir documentos en pestañas sale tal cual a `hooks/useWorkspaceTabOpening.ts`, en el mismo orden y llamado donde empezaba ese bloque:

- crear pestaña ("New Artifact": borrador efímero en desktop, identidad local nueva en web);
- abrir un documento desde el árbol del workspace;
- pasar a la pestaña contigua con el teclado;
- la creación forzada de `/write?new`.

Antes se añadió la red que faltaba en `tests/editor-shell-workspace-tabs.test.tsx`: el atajo de pestaña siguiente y "New Artifact" en web. Abrir desde el árbol del workspace sigue sin prueba, porque el árbol necesita los dobles de settings de desktop que llegan con #492. Contra la entrega 1b:

```text
4,910 líneas        (-181)
   39 useEffect     (-1)
   58 useCallback   (-2)
```

**Actualización (2026-09-24, ODE-563 — segundo tiempo del primer corte):** los 9 metadatos del documento (título, título explícito, versión, fecha de creación, slug, estado, tipo, visibilidad, ciclo de vida) tienen ahora un solo dueño, `applyDocumentMetadata`, que escribe estado y ref en el mismo paso. Se eliminaron sus 9 efectos espejo y todas sus escrituras a mano; `writingSlugRef` desapareció, porque nadie lo leía. Contra `main`, con el mismo método:

```text
6,255 líneas        (-10; el dueño único compensa casi todo lo que se borró)
   51 useEffect     (-9)
    8 efectos espejo restantes   (17 → 8; quedan identidad, modo, pestaña activa,
                                  TOC y los de correcciones/learned words)
  -22 lecturas de refs
```

Lo que importa no es el recuento de líneas: los refs de metadatos ya no pueden llevar el valor del documento anterior entre una escritura y el commit siguiente. Efecto colateral: el menú Abrir archivo leía `titleRef` justo después de `setTitle` y le ponía a la pestaña nueva el título del documento anterior; ahora lee el nuevo.

**Actualización (2026-09-24, ODE-564 — identidad del documento activo):** `currentWritingId` y `currentWritingIdRef` tienen ahora un solo dueño, `setActiveWritingId`. Antes, 21 sitios escribían el ref a mano y un efecto espejo lo reescribía tras cada commit. Contra `main`:

```text
6,251 líneas
   50 useEffect     (-1)
    7 efectos espejo restantes   (8 → 7)
   19 → 1   escrituras de currentWritingIdRef en la shell (la del dueño)
```

La ventana en la que un espejo pendiente devolvía el ref al documento anterior **no resultó observable** por el camino de usuario: el barrido de ventanas de commit pasaba contra `main`, y ningún efecto posterior al espejo lee la identidad de forma síncrona. El cambio se justifica por quitar la dualidad. La calibración mostró además que el espejo era, en la práctica, la red de seguridad de cualquier escritor que olvidara el ref; con el dueño único esa red deja de hacer falta, porque no queda ninguna escritura fuera de él.

El tamaño no es el hallazgo — `components/editor/AGENTS.md` ya establece que el tamaño por sí solo no es un finding de review. Los dos números que importan son los del medio.

**Actualización (2026-09-26, ODE-598 — limpieza tras los cortes 1–3, sin cambio de producto):** los cortes 1–3 y sus follow-ups están en `main`. Estado actual medido sobre el archivo real con el mismo método:

```text
5,090 líneas
   40 useEffect      60 useCallback      26 useState      20 useRef
```

Los 7 hooks extraídos por los cortes, en orden de llamada en la shell:

```text
L1204  useCorrectionBlocks      (ODE-586, corte 2 entrega 2a)
L1863  useSessionRestore        (ODE-587, corte 3 entrega 1b)
L2109  useDocumentHydration     (ODE-562, corte 1)
L2303  useCorrectionActions     (ODE-586, corte 2 entrega 2b)
L3552  useCorrectionLifecycle   (ODE-586, corte 2 entrega 2b)
L3981  useWorkspaceTabs         (ODE-587, corte 3 entrega 1a)
L4082  useWorkspaceTabOpening   (ODE-587, corte 3 entrega 1c)
```

(Siguen viviendo en la shell, previos a los cortes y fuera de su alcance: `useEditor` de TipTap, `useEditorSelection`, los de menú/cierre de Tauri y los de stores. No se cuentan como extraídos.)

Los 7 efectos espejo que quedan, con su línea (el conteo mecánico de `scripts/report-active-document-carriers.mjs` dice 6 porque su patrón no ve el `?? null` de L1570; a mano son 7, los mismos 7 que dejó ODE-564):

```text
L764   reconcileActiveSaveStateRef.current = reconcileActiveSaveState
L1569  editorInstanceRef.current = editor ?? null
L1603  tableOfContentsItemsRef.current = tableOfContentsItems
L1607  activeTableOfContentsItemIdRef.current = selectedTableOfContentsItemId
L1785  modeRef.current = mode
L1853  activeEditorTabIdRef.current = editorSession.active_tab_id   (la excepción declarada del ADR)
L3540  currentDocumentMarkdownRef.current = currentDocumentMarkdown
```

Los cortes que faltan, con su issue:

```text
3b  ODE-599  hecha (entrega 2): cambios externos a hook; menú y cierre se quedan en la shell (sus callbacks van con su dueño natural: apertura/guardado)
4a  ODE-602  red y extracción del chrome (TOC, focus mode, find/replace, visor de imagen, paneles y modales)
4b  ODE-603  red y extracción de los comandos (handleRunAction e inserts de link/tabla/imagen)
5   ODE-605  extraer el cluster de guardado/persistencia
6   ODE-607  extraer anotaciones/selección
7   ODE-609  un solo dueño para los espejos que quedan + ratchet de arquitectura
```

(El cierre —medir, actualizar diagnóstico y mapa, dejar el estado final— es ODE-610. La enmienda del dueño de `activeEditorTabIdRef` es ODE-608.)

ODE-598 no mueve líneas de producto: quita los rodeos de ODE-577 en 4 tests de la shell desktop (ahora actúan determinísticamente pre-carga, sin espera de sesión ni reapertura por ruta), re-exige la aserción de nombre in-flight de ODE-585, y deja la fila STATE-07 del capability map en `INTEGRATION` con su prueba citada. La red para los cortes 3b–7 queda así: `tests/editor-shell-selection-restore.test.tsx` (STATE-07), `tests/editor-shell-draft-adoption-desktop.test.tsx` (ODE-577) y los 4 archivos sin rodeos.

**Actualización (2026-09-27, ODE-602 — corte 4a, entrega 1: la red del chrome):** sin cambio de producto. Cuatro archivos nuevos montan la shell (web) y conducen el chrome por sus entradas reales —atajos sobre `window`, botones del status bar, de la cabecera de la hoja y del panel, el node view de la imagen—, leyendo lo guardado en `localDB` cuando la propiedad es de persistencia:

```text
tests/editor-shell-chrome-toc.test.tsx            TOC: encabezados del activo, cambio de documento,
                                                   click → cursor, activo por scroll, caso de coste
tests/editor-shell-chrome-find-replace.test.tsx   resaltado, Replace/Replace all → sucio y guardado,
                                                   cambio de documento con la búsqueda abierta
tests/editor-shell-chrome-focus-panels.test.tsx   focus mode (selección, contenido, restauración),
                                                   closeActivePanel y precedencia de Escape
tests/editor-shell-chrome-modals.test.tsx         visor de imagen; renombrar e insertar imagen
                                                   sobre el documento activo
```

Cada caso se validó con una mutación que lo pone en rojo por la razón esperada. Dos observaciones de esa calibración:

- **La TOC tiene dos defensas al cambiar de documento**, no una: el vaciado de `tableOfContentsItems` al cambiar `currentWritingId` y la propia extensión TableOfContents, que vuelve a emitir con el `setContent` del documento nuevo. Quitar solo una deja la prueba verde.
- **El caso de coste de la TOC** es una ráfaga de cinco teclas dentro de un encabezado: hoy produce un solo recálculo visible (el debounce de 180ms). Sin el debounce, cinco.

**Bug encontrado — ODE-630.** En rich mode, `richFindMatches` se memoriza con `editor` (la misma instancia durante toda la vida de la shell) y no con el documento. Replace y Replace all insertan en las posiciones de ese memo rancio: dos Replace seguidos corrompen el texto, y tras cambiar de pestaña con la búsqueda abierta "Replace all" escribe en el documento nuevo con las posiciones del anterior, y se guarda. Sus dos casos quedan como `it.fails` y la mudanza no los arregla.

**Actualización (2026-09-27, ODE-602 — corte 4a, entrega 2: la mudanza del chrome):** mudanza mecánica a tres hooks, cada uno llamado donde estaba su código, con el estado y los refs en la shell:

- `hooks/useFocusMode.ts`: entrar, salir y alternar (solo callbacks).
- `hooks/useTableOfContents.ts`: los dos espejos de la TOC, tal cual (su dueño lo decide ODE-609), descartar el item activo que desaparece, seguir el scroll y llevar el cursor al encabezado pulsado. Sus cuatro efectos en el mismo orden y posición.
- `hooks/useFindReplace.ts`: coincidencias, decoraciones, abrir/cerrar, navegar y reemplazar. Se llama justo detrás del efecto que publica el estado de la pestaña: sus memos vivían delante de ese efecto, que no los lee, y sus efectos detrás. El bug de ODE-630 viaja tal cual. `handleRunAction`, más arriba, abre la búsqueda por una declaración de función elevada que delega en el hook, como hacía la declaración original.

Se quedan en la shell, por triviales (menos de 20 líneas y un estado) o porque moverlos cambiaría el orden de efectos: los dos callbacks que la extensión TableOfContents necesita al crearse y su debounce, los dos efectos de limpieza de ese debounce, la clase de focus mode en `<body>`, el visor de imagen (abrir, cerrar y limpiarlo al cambiar de documento), `closeActivePanel` y `openInsertImageModal`. El manejador de teclado (Escape y atajos) es de los comandos, corte 4b (ODE-603). La red de la entrega 1 pasa idéntica antes y después, y sus mutaciones se repitieron sobre los hooks. Contra `main` (`be1ebf4b`), con el mismo método:

```text
4,628 líneas        (-464)
   33 useEffect     (-7)
   52 useCallback   (-8)
   11 useMemo       (-3)
    5 efectos espejo en la shell   (7 → 5; los dos de la TOC viven ahora en su hook)
```

**Actualización (2026-09-27, ODE-599 — corte 3b, entrega 2: la conexión con desktop):** la reacción a cambios externos sale tal cual a `hooks/useExternalDocumentChanges.ts`, llamado donde estaba el efecto (entre `useSessionRestore` y `useDocumentHydration`), así que el orden de efectos no cambia. Se mueven:

- la suscripción al catálogo del documento activo (borrado, movimiento y cambio de contenido), con la proyección del estado durable de sync de ODE-542;
- los dos manejadores del banner de conflicto ("Reload external" y "Keep my version").

El estado (`externalFileNotice`, `externalContentConflict`), los refs y `persistEditorSnapshot` siguen siendo de la shell y llegan por `input`; los tipos `ExternalFileNotice` y `ExternalContentConflict` viven ahora en el hook. No se crean envoltorios sobre `useTauriCloseGuard`/`useTauriEditorMenuEvents`/`useTauriMenuEvents`: sus callbacks (`handleMenuOpenFile`, `handleMenuNewFile`, `handleSaveToDisk`, `settleBeforeClose`) se quedan en la shell, como estaban; moverlos es de su dueño natural (apertura/guardado, cortes 5 y 7). `publishTabState` también se queda: publica metadatos de la pestaña activa y su dueño se decide en el corte 7 (espejos, ODE-609); el ADR del documento activo fija su contrato (solo metadatos, nunca crea/activa/reemplaza pestañas). La red (`tests/editor-shell-external-changes-desktop.test.tsx`) pasa idéntica (8 passed) sin tocar sus tests, el conteo de suscripciones vivas y de lecturas por evento no cambia, y dos mutaciones en vivo sobre el hook (quitar el banner, no persistir en "Keep my version") ponen en rojo sus casos. Contra `main` (`9efb5fa0`), con el mismo método:

```text
4,521 líneas        (-216)
   32 useEffect     (-1)
   53 useCallback   (sin cambio; los manejadores inline pasan a useCallback en el hook)
   19 useRef        (sin cambio)
   26 useState      (sin cambio)
   11 useMemo       (sin cambio)
```

Los 11 hooks extraídos por los cortes, en orden de llamada en la shell:

```text
L762   useFocusMode               (ODE-602, corte 4a entrega 2)
L1165  useCorrectionBlocks        (ODE-586, corte 2 entrega 2a)
L1576  useTableOfContents         (ODE-602, corte 4a entrega 2)
L1765  useSessionRestore          (ODE-587, corte 3 entrega 1b)
L1788  useExternalDocumentChanges (ODE-599, corte 3b entrega 2)
L1848  useDocumentHydration       (ODE-562, corte 1)
L2043  useCorrectionActions       (ODE-586, corte 2 entrega 2b)
L3305  useCorrectionLifecycle     (ODE-586, corte 2 entrega 2b)
L3376  useFindReplace             (ODE-602, corte 4a entrega 2)
L3431  useWorkspaceTabs           (ODE-587, corte 3 entrega 1a)
L3534  useWorkspaceTabOpening     (ODE-587, corte 3 entrega 1c)
```

Los 5 efectos espejo que quedan son los mismos que dejó ODE-602; este movimiento no los toca:

```text
L752   reconcileActiveSaveStateRef.current = reconcileActiveSaveState
L1541  editorInstanceRef.current = editor ?? null
L1688  modeRef.current = mode
L1756  activeEditorTabIdRef.current = editorSession.active_tab_id   (la excepción declarada del ADR)
L3294  currentDocumentMarkdownRef.current = currentDocumentMarkdown
```

**Actualización (2026-09-27, ODE-603 — corte 4b, entrega 1: la red de los comandos):** sin cambio de producto. `tests/editor-shell-commands.test.tsx` recorre **cada acción de `EditorShortcutAction`** (41) con una tabla tipada `satisfies Record<EditorShortcutAction, …>` — una acción nueva sin fila rompe `tsc` — y `it.each` sobre la propia tabla, sin copia de la lista. Cada fila entra por su **entrada real**: el `keydown` de `window` que traduce `getEditorShortcutAction` para los comandos con atajo, el canal `menu:<acción>` del menú nativo (desktop) para los que solo existen ahí, y el formulario real de cada modal para link, tabla, imagen y footnote. Los modos se cambian con los botones reales "Rich"/"Markdown" de la status bar.

Qué fija, por modo. La tabla **no declara modos**: el runner recorre cada fila en ambos (Rich primero, Markdown después) y una fila sin aserción de Markdown rompe `tsc`:

```text
24 acciones con rama en ambos modos   rich y markdown, cada una con su aserción del efecto
 6 acciones sin rama Markdown         rich con efecto; markdown fija el no-op actual (control
   (codeBlock, horizontalRule,        positivo en el mismo test), más un it.fails por comando
   clearStyles, copyAsMarkdown,       que documenta el bug vigente ODE-632
   copyAsHtml, date)
17 acciones globales / de menú        rich y markdown, cada una con su transición observable
                                       en Markdown (navegación contada por pasada, panel,
                                       pestaña, cookie, modal o borrador), no con el mismo
                                       chequeo repetido
```

`focusMode` es la única fila con `freshMountPerMode`: activar el foco oculta la status bar, que es la entrada real del cambio de modo, así que cada modo arranca de un montaje limpio. El driver de modo (`setMode`) verifica su propio efecto y reintenta el click del botón real hasta 10 s: tras cambiar de pestaña, el click puede caer mientras el shell hidrata (el `editor` todavía es null y `handleToggleMode` retorna sin cambiar de modo) — la flake de `nextTab`/`prevTab` bajo carga que la ronda de corrección encontró y fijó.

Persistencia real en una muestra por familia — formato (`bold`), inserción (`table`) y nota (`footnote`) — afirmada sobre `localDB` en web y sobre el `.md` en desktop. `handleBackupLocalImage` corre entero en desktop por su entrada real (botón del node view de la imagen local → modal → `backUpLocalImage` → sustitución del src y persistencia en el `.md`). Mutaciones: renombrar el `case "<acción>"` de producción pone en rojo el caso de esa acción (barrido 41/41 en la ronda inicial, barrido de las 17 globales en la ronda de corrección); invertir `if (modeRef.current === "markdown")` en `handleRunAction` pone en rojo `bold` en ambos modos; y un `return` temprano para `markdown` antes del despacho global puso rojas las 17 aserciones nuevas de Markdown, cada una por su propia etiqueta (no por timeout de montaje).

**Bug encontrado — ODE-632 (Medium).** En modo Markdown, `codeBlock` y `horizontalRule` (cuyo atajo la ayuda publica como disponible en ambos runtimes) y los de menú `clearStyles`/`copyAsMarkdown`/`copyAsHtml`/`date` no tienen rama y caen en `default: return`: el comando queda mudo. La toolbar sigue visible en Markdown y su "Text → Code" es clickeable y no hace nada. La red fija el no-op actual (para que la mudanza no lo cambie) y seis `it.fails` documentan el efecto esperado; no se arregla en este corte.

**Actualización (2026-09-27, ODE-603 — corte 4b, entrega 2: la mudanza de los comandos):** `handleRunAction` sale tal cual a `hooks/useEditorCommands.ts`, llamado donde estaba su código (detrás de `captureRichSelectionSnapshot`), así que ni el orden de los hooks ni el de los efectos de la shell cambian; el hook no tiene efectos. Mudanza mecánica, como ODE-602: el cuerpo (513 líneas) es el de la shell, sin cambios. El estado y los refs siguen siendo de la shell y llegan por `input` (identidades estables: la memoización no cambia); los helpers puros `markdownSelectionOwnerId` y `readMarkdownSelectionForActiveDocument` también llegan por `input`, como en ODE-587, para no crear un ciclo de imports. Las dependencias de la shell se conservan tal cual, más los refs, setters y helpers nuevos (todos estables). La lista de acciones sigue siendo `EditorShortcutAction` (`lib/editor/shortcuts.ts`): no se declara una copia. Los tipos `PendingRichSelectionSnapshot` y `PendingAnnotationSnapshot` viven ahora en el hook porque el contrato de `input` los expone; la shell los importa.

Los tres manejadores de inserción (`handleInsertLink`, `handleInsertTable`, `handleInsertImage`) y `handleBackupLocalImage` se quedan en la shell: su lógica ya tiene dueño (`lib/editor/transactions.ts` y `lib/editor/local-image-backup.ts`) y su contrato con los modales reales no cambia; la red de la entrega 1 los cubre enteros. Este corte mueve el despachador, no cambia dueños.

El warning de `exhaustive-deps` de `openFindReplacePanel` —la declaración de función elevada que se recrea en cada render, a propósito, como dejó ODE-602— deja de aparecer: la regla ya no puede seguir su identidad a través de `input`. La conducta es la misma (el callback se recrea en cada render, como antes). Lint total sin cambios en número (14 → 14) y sin warnings nuevos.

La red de la entrega 1 pasa **idéntica**: `tests/editor-shell-commands.test.tsx` → 43 passed | 6 expected fail (49). Los seis `it.fails` de ODE-632 siguen rojos. Mutaciones repetidas sobre el hook: renombrar `case "bold"` deja rojo `bold` en ambos modos (2 failed), e invertir `if (modeRef.current === "markdown")` deja rojo `bold`; ambas revertidas. La suite completa quedó verde (314 files, 2307 passed | 7 expected fail | 3 skipped) en las corridas limpias de la rama. Nota: `tests/editor-shell-chrome-toc.test.tsx` (el caso de coste de ODE-602, con timers reales y el debounce de 180 ms) puede fallar en corridas completas bajo carga de la máquina; no se reproduce aislado (10/10 en la rama, 6/6 en HEAD) ni en HEAD bajo quemadores de CPU (5/5), y este corte no toca ese camino.

Contra `main`, con el mismo método:

```text
4,011 líneas        (-510)
   32 useEffect     (sin cambio: el hook no tiene efectos)
   52 useCallback   (-1)
   19 useRef        (sin cambio)
   26 useState      (sin cambio)
   11 useMemo       (sin cambio)
```

Los 12 hooks extraídos por los cortes, en orden de llamada en la shell:

```text
L742   useFocusMode               (ODE-602, corte 4a entrega 2)
L1145  useCorrectionBlocks        (ODE-586, corte 2 entrega 2a)
L1556  useTableOfContents         (ODE-602, corte 4a entrega 2)
L1745  useSessionRestore          (ODE-587, corte 3 entrega 1b)
L1768  useExternalDocumentChanges (ODE-599, corte 3b entrega 2)
L1828  useDocumentHydration       (ODE-562, corte 1)
L2023  useCorrectionActions       (ODE-586, corte 2 entrega 2b)
L2100  useEditorCommands          (ODE-603, corte 4b entrega 2)
L2795  useCorrectionLifecycle     (ODE-586, corte 2 entrega 2b)
L2866  useFindReplace             (ODE-602, corte 4a entrega 2)
L2921  useWorkspaceTabs           (ODE-587, corte 3 entrega 1a)
L3024  useWorkspaceTabOpening     (ODE-587, corte 3 entrega 1c)
```

Los 5 efectos espejo que quedan son los mismos; las líneas se corren con el archivo:

```text
L732   reconcileActiveSaveStateRef.current = reconcileActiveSaveState
L1521  editorInstanceRef.current = editor ?? null
L1668  modeRef.current = mode
L1736  activeEditorTabIdRef.current = editorSession.active_tab_id   (la excepción declarada del ADR)
L2784  currentDocumentMarkdownRef.current = currentDocumentMarkdown
```

## 2. Hallazgo 1 — cada dato tiene dos dueños

Diecinueve efectos existen solo para mantener una copia sombra del estado en un ref: `title → titleRef`, `version → versionRef`, `lifecycle → lifecycleRef`, y así con unos veinte campos. Y hay 602 puntos donde el código lee la sombra en vez del estado.

La razón es legítima: los handlers de larga vida (guardado diferido, cola de correcciones, eventos de Tauri, callbacks de `requestAnimationFrame`) capturan valores viejos en su closure, y el ref es la forma de leer el valor actual. Pero la consecuencia es que **toda extracción tiene que decidir cuál de las dos copias es canónica**, y equivocarse no rompe la compilación ni los tests: produce una carrera.

Es exactamente la `Transición co-owned` que el `AGENTS.md` local prohíbe, ya materializada ~20 veces. ODE-555 es el caso vivo: `finishHydration()` se llamaba en el mismo tick en que se *agendaba* el rAF del restore, la cancelación de generación ganaba la carrera y el scroll se perdía sin error, sin excepción y sin remount.

## 3. Hallazgo 2 — la red actual lleva los ojos vendados

Tres tests montan el shell:

```text
tests/editor-shell-tab-switch-persistence.test.tsx     924 líneas   40 vi.mock
tests/editor-empty-draft-persistence.test.tsx        1,425 líneas   42 vi.mock
tests/editor-save-to-disk-relocate.test.tsx            430 líneas   40 vi.mock
```

Tres problemas, en orden de gravedad:

1. **Los tres doblan `@tiptap/react`.** El editor es un stub que solo captura `onUpdate`. Ninguna de las tres puede detectar una regresión en selección, cursor, scroll o transacciones — justo la clase de bug de ODE-555. Lo único que cubre eso son 8 specs de Playwright.
2. **Doblan piezas propias**, no solo boundaries externos: `@/lib/corrections/persistence`, `@/lib/editor/suggestion-engine`, `@/lib/local-db`, `@/lib/editor/extensions`. Un test que sustituye nuestras propias piezas no prueba que encajen entre sí; prueba que encajan con dobles que escribimos nosotros. Viola la regla 3 de `capability-proof-contract.md`.
3. **No hay andamiaje compartido.** En el primero, la primera prueba real empieza en la **línea 461**: 460 líneas de montaje antes de la primera assertion, repetidas a mano en los otros dos con variaciones. Una prueba nueva cuesta hoy cientos de líneas de decorado, y los tres decorados no son idénticos — una prueba puede estar verde porque su decorado es más blando que el de al lado.

## 4. Hallazgo 3 — cuatro de ocho clusters no se ejercitan por el shell

| Cluster | Peso aprox. | Capabilities | Cobertura vía shell |
|---|---|---|---|
| Correcciones (persistencia y aplicación de sugerencias del análisis manual) | ~305 refs *(era ~533; ODE-558 eliminó la cola automática inalcanzable)* | AI-05 | humo del camino real (`editor-shell-corrections-path.test.tsx`), aislamiento entre documentos (`editor-shell-corrections-isolation.test.tsx`, ODE-559) y aceptar/rechazar por la shell (`editor-shell-corrections-accept.test.tsx`, ODE-586) |
| Save / persistencia | ~317 refs | WATCH-07, DOC-02/03/06 | **ninguna** (el coordinator sí, por debajo) |
| Hidratación / identidad | ~104 refs, 7 efectos | STATE-01/03/04/05 | 1 e2e + unit del coordinator |
| Find / replace | ~122 refs | — | unit de `lib/editor/find-replace.ts`; por la shell desde ODE-602: resaltado, Replace/Replace all hasta lo guardado y cambio de documento con la búsqueda abierta (`editor-shell-chrome-find-replace.test.tsx`), con un bug real fijado como `it.fails` (ODE-630) |
| Desktop wiring (canonical path, conflicto externo, open-file, menús, close guard) | ~103 refs | WATCH-07, WS-* | reacción a cambios externos (limpio, sucio con sus dos botones, borrado, movimiento, cambio de pestaña a mitad) y guardia de cierre por la shell con la cadena real watcher → reconciliador → catálogo (`editor-shell-external-changes-desktop.test.tsx`, ODE-599); open-file y Save As por ODE-581/ODE-574 |
| Anotaciones / selección | ~90 refs | ANN-04/05 | 1 e2e |
| Tabs / sesión / catálogo | ~62 refs | STATE-05, STATE-08 | unit del store, no el seam al shell |
| Chrome (TOC, modales, focus mode) | ~106 refs | — | por la shell desde ODE-602: TOC (`editor-shell-chrome-toc`), focus mode y paneles (`editor-shell-chrome-focus-panels`), visor de imagen y modales de renombrar e insertar imagen (`editor-shell-chrome-modals`) |

Nueve filas del capability map nombran este archivo (o el hook que salió de él) en su chain o su evidencia: **AI-05, EXP-05, STATE-01, STATE-03, STATE-04, STATE-05, STATE-07, STATE-08, WATCH-07**. De ellas, cuatro están en `PARTIAL_INTEGRATION` o `NONE`, y en tres el tramo no probado **es precisamente este archivo**:

- **STATE-05** — el seam `store → EditorShell` (aplicación al DOM) es literalmente el gap declarado de la fila.
- **EXP-05** — `exportBinary`/`exportMarkdown` del shell nunca se conectan al `saveBinaryArtifact` ya probado.
- **WATCH-07** — que el shell siembre el `content_hash` base correcto al abrir no lo prueba nadie; el proof de integración lo siembra a mano y lo documenta como tal. *(ODE-599: la red de la shell ya lo ejercita —la línea base la siembra la primera lectura del catálogo tras abrir por el opener real— y encontró dos bugs reales: la clasificación limpio/sucio tras un autosave rechazado, ODE-627, y, en el orden de producción, que el Open File fuera de todo Workspace no refresca el watcher, ODE-628. Ambos están arreglados y sus casos son `it` de nuevo, sin tocar el cuerpo; la reacción de la shell vive desde la entrega 2 en `hooks/useExternalDocumentChanges.ts`. Ver la fila del mapa.)*

(STATE-07 salió de esta lista en ODE-598: el restore de cursor/selección vive desde ODE-562 en `hooks/useDocumentHydration.ts` y lo ejercita `tests/editor-shell-selection-restore.test.tsx`; ver la fila del mapa.)

## 5. Hallazgo 4 — el editor real sí corre fuera del navegador

No hay obstáculo técnico para una red fiel: **12 tests usan TipTap real** (no doblan `@tiptap/react`), y **6 de ellos instancian un `Editor` completo** con las extensiones reales — `tests/highlight-annotation.test.ts`, `tests/footnotes-perf.test.ts`, `tests/lib/editor/desktop-document-engine.test.ts`, `tests/lib/editor/local-image-extension.test.ts`, `tests/lib/editor/image-markdown-roundtrip.test.ts`, `tests/lib/editor/image-presentation-viewer.test.ts` — bajo `@vitest-environment happy-dom`, el mismo entorno que ya declaran los tests del shell.

Que el shell use un stub fue una decisión de comodidad, no una limitación de la plataforma.

---

## 6. Mapa de Recon — cluster de guardado/persistencia (piloto, ODE-605)

Mapa de área del piloto de Recon inteligente (`issue-brief-schema.md`, sección `Recon Pack`): se exploró una vez al planificar para que los BUILD del área (el corte 5, ODE-605, y los que toquen el guardado después) **validen** en vez de redescubrir.

```text
Verificado en: main@a76f658d (2026-09-28), después de ODE-624 y ODE-590
Archivo:       components/editor/editor-shell.tsx — 4.101 líneas
Validar con:   git diff a76f658d..origin/main -- components/editor/editor-shell.tsx
```

Si el diff toca estos rangos, re-verificar solo los afectados y reportar la diferencia como `Recon correction`; el planner la aplica aquí.

### Estado tras el corte 5 (ODE-605) — verificado en main@ba13217e (2026-09-28)

El cluster ya salió de la shell a tres hooks (PRs #543–#545). Las tablas de abajo ("La cadena" y el orden de efectos) son la foto **de antes del corte** (`a76f658d`) y se quedan como referencia; las líneas vigentes son estas:

| Hook | Archivo (líneas) | Llamada en la shell | Qué contiene (líneas en el hook) | Efectos, en orden de declaración |
|---|---|---|---|---|
| `useEditorPersistence` | `hooks/useEditorPersistence.ts:108–580` | `editor-shell.tsx:759` (el destructuring empieza en 753) | `scheduleMarkdownSave` 148–157, `flushPendingMarkdownSave` 160–169, `persistenceCoordinator` 171–371, `persistEditorSnapshot` 390–493, `runRichModeUpdateSideEffects` 495–501, `flushQueuedRichModeUpdate` 503–520, `scheduleQueuedRichModeUpdate` 529–542, `handleEditorUpdate` 544–571 (es el `onUpdate` de `useEditor`, shell:1106) | 373 activar el coordinador → 377 volcado + `dispose` al desmontar → 522 asignar `flushPendingEditOnUnmountRef` |
| `useSaveStateSync` | `hooks/useSaveStateSync.ts:57–252` | `editor-shell.tsx:1390` | `reconcileActiveSaveState` 78–115 | 118 espejo `reconcileActiveSaveStateRef` → 129–250 suscripción única a sync (ODE-542/ODE-590) |
| `useDocumentExit` | `hooks/useDocumentExit.ts:91–259` | `editor-shell.tsx:1406` | `snapshotOutgoingDraftContent` 115–123, `persistCurrentWorkspaceViewState` 125–186, `prepareDocumentExit` 198–213 | 215–256 cleanup de desmontaje: cancela las colas rich/markdown/selección y el toast, y guarda la vista |

Se quedan en la shell: todo el estado y sus refs (colas en 608, 611, 705–707 y 747), `applyHydrationPhase` (466–470) con `hydrationPhaseRef` (456) y `applySyncStatus` (484–487, único escritor de `syncStatus`/`syncStatusRef`).

**Orden de efectos: se conserva.** Comparado con el orden de declaración de `a76f658d` (`git show a76f658d:components/editor/editor-shell.tsx | grep -n 'useEffect('`):

```text
Antes:  1044 activar → 1054 volcado+dispose → 1172 handoff desktop → 1310 asignar el volcado → … → 1912 suscripción → 2027 cleanup
Ahora:  759 [373 activar → 377 volcado+dispose → 522 asignar el volcado] → 903 handoff desktop → … → 1390 [118 espejo → 129 suscripción] → 1406 [215 cleanup]
```

- Lo que exige ODE-573 se cumple: el volcado + `dispose` (dentro de 759) está declarado antes del cleanup que cancela las colas (1406), y la suscripción sigue siendo una sola, entre los dos.
- Hay dos desplazamientos relativos sin efecto observable. (a) La asignación del volcado (hook:522) pasa por delante del efecto del handoff desktop (shell:903), que no lee ese ref. (b) El espejo `reconcileActiveSaveStateRef` pasa de estar antes de la hidratación (L750 en `a76f658d`) a estar después (`useSaveStateSync`, 1390, tras `useDocumentHydration`, 1341). Su lector en la hidratación (`useDocumentHydration.ts:595`, `"post-hydration"`) corre después de los `await` de `hydrateEditor` (374–538), no en el cuerpo síncrono del efecto; el otro lector (`useSaveStateSync.ts:150`) es el callback de un evento. En ambos casos el ref ya tiene la versión real cuando se lee.

### La cadena

| Tramo | Símbolo | Líneas | Qué hace |
|---|---|---|---|
| Entrada rich | `onUpdate` del editor | 1516–1533 | ignora mientras se aplica contenido o en modo markdown; marca `hasUnconfirmedLocalEditRef` (WATCH-07) y encola un solo rAF |
| Debounce rich | `scheduleQueuedRichModeUpdate` | 1316–1329 | web: vuelca en el rAF; desktop: espera `DESKTOP_EDITOR_OUTPUT_DEBOUNCE_MS` = 150 |
| Volcado rich | `flushQueuedRichModeUpdate` → `runRichModeUpdateSideEffects` | 1291–1308, 1283–1289 | cancela rAF/timer y llama a `persistEditorSnapshot` |
| Entrada markdown | `handleMarkdownChange` y los inserts (`handleInsertLink`, `handleInsertTable`, `handleInsertImage`) | 2528, 2569, 2666, 2717 | programan el guardado con `scheduleMarkdownSave` |
| Debounce markdown | `scheduleMarkdownSave` / `flushPendingMarkdownSave` | 637–643, 645–654 | 800 ms (`MARKDOWN_SAVE_DEBOUNCE_MS`); el run pendiente queda en `pendingMarkdownSaveRef` para volcarlo al salir o desmontar (ODE-573) |
| Snapshot | `persistEditorSnapshot` | 1195–1281 | arma el snapshot **leyendo refs** (`currentWritingIdRef`, `activeEditorTabIdRef`, `titleRef`…) y llama a `persistenceCoordinator.persist`; con `awaitDurability`, `settle` |
| Coordinador | `persistenceCoordinator` (`useMemo`) | 842–1042 | instancia de `PersistenceCoordinator` con `onStateChange`, `onMaterialized`, `onIdentityCreated`, `onCommitted`/`onBackgroundCommitted` y `onError` |
| Documento activo del coordinador | efecto | 1044–1046 | `persistenceCoordinator.activateDocument(currentWritingId)` |
| Estado de guardado | `applySyncStatus` | 509–512 | único escritor de `syncStatus` + `syncStatusRef` |
| Reconciliación del activo | `reconcileActiveSaveState` (+ espejo `reconcileActiveSaveStateRef`) | 710–747, 750–753 | relee la fila durable del documento activo (O(1)) |
| Suscripción a sync | efecto | 1912–2025 | **una por shell** (ODE-542). Activo → reconciliación. Fondo en `synced` → `getCatalogRecord` + `reconcileSaveStateFromDurable` antes de `updateTabSaveState` (1952–2002, ODE-590) |
| Salida | `prepareDocumentExit` | 1651–1666 | vuelca la edición en cola, `snapshotOutgoingDraftContent` (1547–1555) y `persistCurrentWorkspaceViewState` (1586–1639) |
| Vista | `persistCurrentWorkspaceViewState` | 1586–1639 | no guarda mientras la hidratación no terminó: lee `hydrationPhaseRef` (481), escrito solo por `applyHydrationPhase` (491–495) (ODE-624) |
| Unmount 1 | efecto | 1054–1065 | vuelca `flushPendingEditOnUnmountRef` (asignado en el efecto 1310–1315) y **después** `persistenceCoordinator.dispose()` |
| Unmount 2 | efecto | 2027–2059 | cancela timers y rAF de rich/markdown/selección y guarda la vista |

### Orden de efectos que el corte no puede cambiar

1044 (activar en el coordinador) → 1054 (volcado + `dispose` al desmontar) → 1310 (asignar el volcado) → 1912 (suscripción a sync) → 2027 (cancelar colas + guardar la vista). React corre las limpiezas en orden de declaración: si 2027 quedara antes que 1054, las colas se cancelarían antes del volcado y se perdería lo escrito en los últimos 150/800 ms (ODE-573).

### Tests que deben pasar idénticos

`tests/editor-persistence-coordinator.test.ts`, `editor-shell-durable-save-state.test.tsx` (incluye el caso de costo: lecturas y listeners), `editor-shell-exit-protocol.test.tsx`, `editor-shell-open-exit-protocol.test.tsx`, `editor-shell-close-commit-window-desktop.test.tsx`, `editor-shell-unmount-flush.test.tsx`, `editor-shell-mode-toggle-persistence.test.tsx`, `editor-shell-draft-materialization-desktop.test.tsx`, `editor-shell-create-rename.test.tsx`, `editor-shell-new-tab-clean-view-state.test.tsx` y `-desktop`, `editor-shell-selection-restore.test.tsx`, y `tests/architecture/persistence-boundary.test.ts` (ratchet de `architecture/boundaries.yml`; `ui-no-direct-persistence` también escanea `hooks/`).

### Trampas ya pagadas

- **Orden de limpiezas (ODE-573):** ver arriba.
- **Refs, no estado, en los callbacks de larga vida:** `persistEditorSnapshot` y `persistCurrentWorkspaceViewState` leen refs a propósito. Pasarlos a dependencias de estado recrea los callbacks (y re-ejecuta el cleanup que guarda la vista) o persiste con el documento viejo: DOC-05, A escrito en B.
- **Cortocircuito de WATCH-07:** `persistEditorSnapshot` no persiste si `externalContentConflictRef` está activo (primera guarda de la función).
- **Costo de sync:** 1 `getById` por evento del activo o por `synced` de fondo, 0 `list`, una sola suscripción. Un hook por pestaña o por cluster rompe el caso de costo.
- **Tests:** fijar scroll o selección exige `waitForHydrationReady`, no `flush()`; la sesión en `fake-indexeddb` es estado compartido entre tests (ODE-624).

### Espejos del área (inventario para el corte 7, ODE-609)

`syncStatusRef` (escritor único, `applySyncStatus`), `reconcileActiveSaveStateRef` (espejo por efecto, 750–753), `hydrationPhaseRef` (escritor único, `applyHydrationPhase`), `currentDocumentMarkdownRef` (828; se escribe en 2874) y `activeEditorTabIdRef` (espejo por efecto en 1770; ODE-608). Líneas de `a76f658d`; el inventario vigente, con lectores y escritores, está en §7.2.

## 7. Mapa de Recon — resto de la shell (cortes 6 y 7 y cierre: ODE-607, ODE-608, ODE-609, ODE-610)

```text
Verificado en: main@ba13217e (2026-09-28), después de ODE-605
Archivo:       components/editor/editor-shell.tsx — 3.466 líneas
Validar con:   git diff ba13217e..origin/main -- components/editor/editor-shell.tsx hooks/ lib/stores/editor-session-store.ts
```

Mismo contrato que §6: BUILD valida estas líneas en vez de buscarlas; si el diff las movió, re-verifica solo lo afectado y lo reporta como `Recon correction`. Lo que no se exploró se dice en cada apartado.

### 7.1 Anotaciones y selección (ODE-607)

**Símbolos** (todos en `editor-shell.tsx` salvo que se diga otra cosa):

| Símbolo | Líneas | Qué es / qué lee |
|---|---|---|
| tipos `SelectionSnapshot`, `OwnedMarkdownSelectionSnapshot`, `MarkdownSelectionRead` | 190–203 | nivel de módulo |
| `markdownSelectionOwnerId` | 205 | helper puro: `writingId ?? EDITOR_DRAFT_TAB_ID` |
| `readMarkdownSelectionForActiveDocument` | 207–232 | helper puro (ODE-625): la selección cacheada solo vale si es del documento activo; si no, usa el `view_state` de la pestaña activa leído de `getEditorSessionState()`, nunca el textarea compartido |
| estado | 477 `markdownSelectionState`, 489 `richFootnoteRevision`, 548 `pendingAnnotation`, 549 `pendingRichSelection` | |
| refs | 699 `selectionRef`, 700 `markdownSelectionRef`, 701 `markdownTextareaRef`, 712 `markdownSelectionRafRef`, 723 `pendingMarkdownSelectionRef`, 724 `suppressNextSelectionPopupRef` | |
| `refreshRichFootnotes` | 918–920 | sube `richFootnoteRevision`; lo reciben `useExternalDocumentChanges` (1295), `useDocumentHydration` (1369) y `useWorkspaceTabOpening` (2495) |
| `queueMarkdownSelectionRestore` | 922–1090 | `useCallback` con deps `[]`; lee `currentWritingIdRef`, `pendingMarkdownSelectionRef`, `markdownSelectionRafRef`, `markdownTextareaRef`, `markdownSelectionRef`. Cola de ODE-582: 946–958 (el `onSettled` reemplazado se encadena, no se pierde). Validez en el momento del rAF: 977–980 |
| `getRichSelectionOverlayPositions` | 1503–1525 | posiciones del popup y del bubble desde `editor.view.coordsAtPos` |
| `captureRichSelectionSnapshot` | 1527–1552 | `null` fuera de Rich (lee `modeRef`) o con selección vacía |
| *(no es del cluster)* `useEditorCommands` | 1555–1591 | está **en medio** del cluster: recibe `captureRichSelectionSnapshot`, `setPendingRichSelection`, `setPendingAnnotation`, `queueMarkdownSelectionRestore`, `selectionRef` y `markdownSelectionRef` |
| `dismissSelectionPopup` | 1593–1596 | |
| `handleMarkSelection` | 1598–1616 | tipo `personal`: `setHighlight()` sobre el rango del popup y `persistEditorSnapshot` |
| `convertStandaloneHighlight` | 1618–1652 | solo lo llama el sidebar (3218, 3239), no el popup |
| `handleAnnotateSelection` | 1654–1668 | abre el bubble (`setPendingAnnotation`) |
| `handleFootnoteSelection` | 1670–1688 | en Markdown abre el modal; en Rich guarda `selectionRef` y abre el modal |
| `handleEditorSelectType` | 1690–1703 | enruta `personal` / `footnote` / `ai` |
| `handleConfirmAnnotation` | 1705–1740 | aplica la marca sobre el rango de `pendingAnnotation` y `persistEditorSnapshot` |
| efecto `selectionUpdate` del editor | 1742–1777 | abre o cierra el popup (antes 3059) |
| efecto de reposicionar el overlay | 1779–1831 | `resize` y `scroll` en captura (ODE-409) (antes 3096) |
| efecto `FOOTNOTE_REF_EVENT` | 2019–2029 | clic en una referencia → panel `notes` |
| `handleInsertFootnote` | 2171–2192 | Markdown: `appendMarkdownFootnote`; Rich: `addFootnote` + `richFootnoteRevision` + `persistEditorSnapshot` |
| memo `footnotes` | 2195–2204 | depende de `version || richFootnoteRevision` (fix de ODE-625, bug 1) |
| JSX | 3021–3030 `onMarkdownSelectionChange`; 3091–3270 `NotesPanel` con 7 manejadores inline (`onNavigate` 3093, … `onDeleteHighlight` 3246); 3407 `InsertFootnoteModal`; 3451 `SelectionPopup`; 3457 `AnnotationBubble` | los manejadores inline del `NotesPanel` no se exploraron línea a línea |

**Estado tras ODE-607, paso 1 (`useSelectionRestore`, este PR; rama `hugomarin/ode-607-step1` sobre `main@789179f8`):** la cola y sus helpers salieron a `hooks/useSelectionRestore.ts`. Mudanza mecánica: el bloque de la cola es byte a byte el de la shell (deps `[]`), y los helpers solo ganaron `export`.

| Qué | Antes (main@ba13217e, `editor-shell.tsx`) | Ahora |
|---|---|---|
| `queueMarkdownSelectionRestore` | 922–1090 | `hooks/useSelectionRestore.ts:89–257`; la shell la recibe en 892–898 |
| `markdownSelectionOwnerId` | 205 | `hooks/useSelectionRestore.ts:43` (la shell lo importa en 36) |
| `readMarkdownSelectionForActiveDocument` | 207–232 | `hooks/useSelectionRestore.ts:45–70` (la shell lo importa en 37) |
| tipos `OwnedMarkdownSelectionSnapshot`, `MarkdownSelectionRead` | 196–203 | `hooks/useSelectionRestore.ts:34–41`; `SelectionSnapshot` se queda en la shell (194–198) |

La shell pasó de 3.466 a 3.274 líneas; el resto de la tabla de arriba son las líneas de `ba13217e` y se quedan como referencia. Las líneas vigentes del paso: estado `markdownSelectionState` 443; refs `markdownSelectionRef` 666, `markdownSelectionRafRef` 678, `pendingMarkdownSelectionRef` 689. El hook se llama donde estaba el `useCallback` (892), antes de sus consumidores: `useDocumentHydration` 1149, `useDocumentExit` 1214, `useEditorCommands` 1363 y `useFindReplace` 2129, así que el orden de efectos no cambia. Los helpers los sigue usando la shell fuera de la cola (link, imagen, comandos, find/replace y panel de notas), por eso viven aquí exportados y no duplicados.

**`captureEditorCursorSnapshot` y `restoreEditorCursorSnapshot` ya no están en la shell:** salieron con find/replace en ODE-602 (`hooks/useFindReplace.ts:198` y `:234`; el ref `editorCursorSnapshotRef` sigue en la shell, 704). No son parte del corte 6.

**Estado tras ODE-607, paso 2 (`useSelectionPopup`, este PR; rama `hugomarin/ode-607-step2` sobre `main@50acb364`):** los 7 manejadores del popup y sus dos efectos salieron a `hooks/useSelectionPopup.ts`. Mudanza mecánica: las 237 líneas movidas son token-idénticas a las de `main` (extracción por bloques + `diff`), con las mismas dependencias; el estado y los refs siguen en la shell y llegan por `input` (identidades estables, la memoización no cambia).

| Qué | Antes (main@ba13217e, `editor-shell.tsx`) | Ahora |
|---|---|---|
| manejadores del popup | 1593–1740 | `hooks/useSelectionPopup.ts:81–228` (`dismissSelectionPopup` 81, `handleMarkSelection` 86, `convertStandaloneHighlight` 106, `handleAnnotateSelection` 142, `handleFootnoteSelection` 158, `handleEditorSelectType` 178, `handleConfirmAnnotation` 193) |
| efecto `selectionUpdate` del editor | 1742–1777 | `hooks/useSelectionPopup.ts:230–265` |
| efecto de reposicionar el overlay | 1779–1831 | `hooks/useSelectionPopup.ts:267–319` |

La shell pasó de 3.274 a 3.059 líneas. El hook se llama en 1404–1417, donde empezaba `dismissSelectionPopup`, después de `useEditorCommands` (1362–1398) y de `useDocumentExit` (1213), y el orden de efectos se conserva: `selectionUpdate` (230) antes que la reposición del overlay (267), y los dos después de `useDocumentExit`. Los consumidores no cambiaron de contrato: `convertStandaloneHighlight` (2811, 2832), `handleEditorSelectType` (3046), `dismissSelectionPopup` (3047) y `handleConfirmAnnotation` (3054). `handleMarkSelection`, `handleAnnotateSelection` y `handleFootnoteSelection` quedan internos del hook (no los consume nadie más). Estado y refs que no se mueven: `pendingAnnotation` 513, `pendingRichSelection` 514, `selectionRef` 664, `suppressNextSelectionPopupRef` 689; `modeRef` (516), `persistEditorSnapshot`, `updateDerivedEditorState`, `setActivePanel` y `setFootnoteModalOpen` también llegan por `input`.

**Estado tras ODE-607, paso 3 (`useFootnotes`, este PR; rama `hugomarin/ode-607-step3` sobre `main@630a00c6`):** el efecto `FOOTNOTE_REF_EVENT`, `handleInsertFootnote` y el memo `footnotes` salieron a `hooks/useFootnotes.ts`. Mudanza mecánica: los tres bloques son token-idénticos a los de `main` (extracción por bloques + `diff`, deps incluidas) y el memo conserva `version || richFootnoteRevision` (fix de ODE-625); el estado y los refs siguen en la shell y llegan por `input` (identidades estables).

| Qué | Antes (main@ba13217e, `editor-shell.tsx`) | Ahora |
|---|---|---|
| efecto `FOOTNOTE_REF_EVENT` | 2019–2029 | `hooks/useFootnotes.ts:64–74` |
| `handleInsertFootnote` | 2171–2192 | `hooks/useFootnotes.ts:76–96` |
| memo `footnotes` | 2195–2204 | `hooks/useFootnotes.ts:98–109` |

La shell pasó de 3.059 a 3.033 líneas. El hook se llama en 1759, donde estaba `handleInsertFootnote`; el efecto se conserva en orden: entre `handleInsertLink`/`handleInsertTable` (posición antigua) y 1759 solo hay manejadores sin efectos (`handleInsertTable`, `handleInsertImage`, `handleBackupLocalImage`), y sigue después de `useDocumentExit` (1213) y de `useSelectionPopup` (1404). Consumidores sin cambio de contrato: `annotations={footnotes}` (2658) e `<InsertFootnoteModal onConfirm={handleInsertFootnote}>` (2974).

**Recon correction del paso 3:** `refreshRichFootnotes` (881–886) **se queda en la shell**. Sus consumidores `useExternalDocumentChanges` (1103) y `useDocumentHydration` (1177) están declarados antes del punto de llamada de `useFootnotes` (1759), así que moverlo con el resto exigiría reordenar declaraciones o partir el hook en dos llamadas de distinta forma; `useWorkspaceTabOpening` (2062) lo recibe después. Es la salida "deja en la shell lo que no quepa" del dispatch.

**La trampa del orden, resuelta como preveía el pack:** `getRichSelectionOverlayPositions` (1310–1332) y `captureRichSelectionSnapshot` (1334–1358) se quedan en la shell porque `useEditorCommands` (1362) los recibe antes; el hook del popup los recibe por `input`. No se reordenó `useEditorCommands`.

**Flujo.** Rich: TipTap emite `selectionUpdate` → el efecto 1742 llama a `captureRichSelectionSnapshot` → `pendingRichSelection` → `<SelectionPopup>` (3451) → `handleEditorSelectType` → marca directa (`handleMarkSelection`), modal de footnote o bubble (`handleAnnotateSelection` → `pendingAnnotation` → `<AnnotationBubble>` → `handleConfirmAnnotation`). Cada acción que cambia el documento pone `suppressNextSelectionPopupRef` para que el `selectionUpdate` de su propio `setTextSelection` no reabra el popup, y persiste con `persistEditorSnapshot`. Markdown: no hay popup; la selección llega por `onMarkdownSelectionChange` (3021, con guarda de dueño) a `markdownSelectionRef` y `markdownSelectionState`, y la restauran `queueMarkdownSelectionRestore` y su rAF.

**Orden de efectos que no puede cambiar.** 1742 (suscripción a `selectionUpdate`) va antes de 1779 (overlay), y ambos van después de `useDocumentExit` (1406), cuyo cleanup cancela `markdownSelectionRafRef` y vacía `pendingMarkdownSelectionRef`. Si el hook del popup se llama en 1593, donde empieza su código, el orden no cambia. `queueMarkdownSelectionRestore` no tiene efectos, pero tiene que estar declarado antes que sus consumidores: `useDocumentHydration` (1341), `useEditorCommands` (1555) y `useFindReplace` (2321).

**Cómo toca a los hooks ya extraídos.**
- `useEditorPersistence`: el cluster solo llama a `persistEditorSnapshot(editor)` (1615, 1738, 2189); no lee su estado interno.
- `useFindReplace`: recibe `queueMarkdownSelectionRestore`, `markdownSelectionOwnerId`, `markdownSelectionRef` (2332–2339) y es dueño del cursor snapshot.
- `useEditorCommands`: recibe el snapshot, los setters del popup y del bubble y la cola (1555–1591). Los tipos `PendingRichSelectionSnapshot` y `PendingAnnotationSnapshot` viven en `hooks/useEditorCommands.ts:42–58`.
- `useDocumentHydration`: termina la hidratación Markdown a través de la cola (`onSettled: finishHydration`, `useDocumentHydration.ts:624–640`).
- `useDocumentExit`: lee `markdownSelectionRef` con `readMarkdownSelectionForActiveDocument` para guardar la vista y cancela la cola al desmontar.

**Tests que deben pasar idénticos:** `tests/editor-shell-selection-restore.test.tsx` (STATE-06/07, ODE-625 bug 2), `editor-shell-markdown-hydration-coalesce.test.tsx` (ODE-582), `editor-shell-selection-popup-actions.test.tsx`, `editor-shell-annotation-roundtrip.test.tsx` y `-desktop`, `editor-shell-document-state-isolation.test.tsx` (ODE-625), `editor-shell-commands.test.tsx` (footnote y anotación por comando), `editor-shell-chrome-find-replace.test.tsx` (cursor snapshot), `tests/annotation-bubble-session.test.tsx` y `tests/footnote-extension.test.ts`. En `main` ya no queda ningún `it.fails` de ODE-625: sus casos son `it`.

**Trampas ya pagadas.**
- **ODE-625:** la selección Markdown se guarda con dueño (`writingId`) y se lee con `readMarkdownSelectionForActiveDocument`, y el memo `footnotes` depende de `version || richFootnoteRevision`. Si se mueve alguno sin su guarda, vuelven los dos bugs (los tests los fijan).
- **ODE-582:** la cola coalesce solicitudes, pero encadena los `onSettled`. Moverla tal cual, con deps `[]`.
- **`waitForHydrationReady`, no `flush()`,** para fijar selección o scroll en los tests (`tests/support/editor-shell-harness.tsx:605`). La selección se hace por el DOM con `selectEditorText`; `setTextSelection` se salta el `DOMObserver` (catálogo del harness).
- **Nombres:** `hooks/useEditorSelection.ts` (métricas, llamado en 2206) y `hooks/useWritingSelection.ts` (selección de filas del Desk) ya existen. No usar ninguno de los dos nombres.
- **`editorInstanceRef`:** ninguna línea del cluster lo lee. El popup, los manejadores y los footnotes usan `editor` (el valor de `useEditor`) por closure. Sus lectores son de correcciones y cambios externos (§7.2).

**División propuesta (un PR por paso):**
1. `useSelectionRestore`: `queueMarkdownSelectionRestore` (922–1090) tal cual, llamado en 922. Los helpers puros (205–232) se quedan como están o pasan por `input`, como en ODE-603. El cursor snapshot no entra, porque ya es de `useFindReplace`.
2. `useSelectionPopup`: 1503–1552 y 1593–1831, llamado en 1593. `getRichSelectionOverlayPositions` y `captureRichSelectionSnapshot` tienen que seguir declarados **antes** de `useEditorCommands` (1555), que los recibe. Hay dos salidas: dejarlos en la shell y mover solo 1593–1831, o partir el hook en dos llamadas. Decide BUILD, con el orden de efectos intacto.
3. `useFootnotes`: `handleInsertFootnote` y el memo `footnotes` (2171–2204), más el efecto `FOOTNOTE_REF_EVENT` (2019–2029), si cabe sin reordenar. Ese efecto está entre `handleInsertLink` y `handleInsertTable`, así que moverlo a 2171 lo pasaría por detrás de esos manejadores, que no tienen efectos. BUILD confirma el orden.

### 7.2 Inventario de espejos (ODE-608, ODE-609)

Comando que los encuentra (efectos cuya primera sentencia asigna un ref; mismo patrón que el ratchet que pide ODE-609). Está en §7.3.

| Ref (declaración) | Escritor | Tipo | Lecturas |
|---|---|---|---|
| `editorInstanceRef` (722) | **dueño único:** se escribe en el render que adopta la instancia devuelta por `useEditor`, `editorInstanceRef.current = editor ?? null` (949), el mismo patrón que `routerRef` (397); efecto espejo borrado (PR 3 de ODE-609). El render cubre la creación (`null` → instancia) y una eventual recreación (vieja → nueva) antes de cualquier efecto | dueño único | `useCorrectionBlocks.ts:99`, `:168`; `useExternalDocumentChanges.ts:241`; `useManualCorrections.ts:183`, `:385` (llega como `editorRef` desde `useCorrectionLifecycle.ts:196`). `useEditor` (922–939) refresca la instancia cuando cambian `editorExtensions` o `handleEditorUpdate`; no usa `onCreate`/`onDestroy` |
| `modeRef` (514) | **dueño único:** `applyEditorMode` (584–587) escribe el ref y el estado en el mismo paso; las 4 llamadas son `handleToggleMode` 1451 (→ markdown) y 1481 (→ rich), y `useDocumentHydration.ts:618` y `:650`. Efecto espejo borrado (PR 1 de ODE-609); ya no hay `setMode` fuera del dueño | dueño único | 36 lecturas: shell 17, `useDocumentExit` 5, `useFindReplace` 4, `useSelectionPopup` 2, `useCorrectionActions` 2, `useCorrectionLifecycle` 2, `useEditorCommands` 2, `useFootnotes` 1, `useEditorPersistence` 1. **Transición a propósito:** en `handleToggleMode` → rich, `applyEditorMode` escribe el ref en `"rich"` en 1481, **antes** de `setContent` (1486–1492) y con `setMode` en el mismo paso; el orden ref-primero es un contrato del pack sin lector observable hoy: el único lector síncrono es `handleEditorUpdate` (`useEditorPersistence.ts:546`), que sale antes por `isApplyingContentRef`, y `persistEditorSnapshot` no lee `modeRef`. El ref se inicializa con el valor inicial del estado (`useRef(mode)`, 514) |
| `activeEditorTabIdRef` (594) | **dueño único:** `useActiveEditorTabIdRef` (`hooks/useActiveEditorTabIdRef.ts:31`) escribe el ref desde el listener síncrono del store (`subscribeToEditorSessionStore`, `lib/stores/editor-session-store.ts:117`); efecto espejo y 4 escrituras manuales borrados (PR 2 de ODE-609, opción B de ODE-608) | dueño único | ver la tabla de lecturas de abajo |
| `currentDocumentMarkdownRef` (725) | efecto 2238–2240 | espejo de un **memo derivado** (`currentDocumentMarkdown`, 2211–2226: depende de `mode`, `markdownValue`, `editor` y `version`) | `useCorrectionActions.ts:161`, `useCorrectionLifecycle.ts:159` |
| `reconcileActiveSaveStateRef` (663) | efecto `useSaveStateSync.ts:118–120` | latest-callback (se mantiene, ODE-609) | shell 1362 (en el `input` de `useDocumentHydration`), `useSaveStateSync.ts:150` |
| `tableOfContentsItemsRef` (708) | efecto `useTableOfContents.ts:51–53` | espejo | `useTableOfContents.ts:70` |
| `activeTableOfContentsItemIdRef` (709) | efecto `useTableOfContents.ts:55–57` **y** escritura manual `:99` | espejo + manual | `useTableOfContents.ts:98` |
| `automaticCorrectionSuggestionsRef` (726) | efecto `useCorrectionLifecycle.ts:101–103` | espejo | `useCorrectionLifecycle.ts` 128, 134, 348, 365, 385; `useCorrectionActions.ts` 195–425 (17 lecturas) |
| `learnedWordsRef` (727) | efecto `useCorrectionLifecycle.ts:105–107` | espejo | `useCorrectionActions.ts:312`, `:344`, `:372`; `useCorrectionLifecycle.ts:123`; `useCorrectionBlocks.ts:114`; `useManualCorrections.ts:334` |
| `flushPendingEditOnUnmountRef` (747) | efecto `useEditorPersistence.ts:522–527` | latest-callback | `useEditorPersistence.ts:384` (cleanup de desmontaje). **No está en la tabla de ODE-609**, pero el patrón del ratchet lo va a marcar: necesita fila en la allowlist |
| `onBeforeCloseRef`, `onRunActionRef` | `useTauriCloseGuard.ts:20`, `useTauriEditorMenuEvents.ts:42` | latest-callback permitidos (ODE-609) | internos |
| `mountedRef` | `useVoiceRecorder.ts:335` | falso positivo del patrón (asigna `true` al montar), fuera de la shell | — |

**Escritor único (no son espejos; el ratchet no debe marcarlos):** `modeRef` (`applyEditorMode` 584–587; PR 1 de ODE-609), `activeEditorTabIdRef` (`useActiveEditorTabIdRef`; PR 2 de ODE-609, el listener del store), `editorInstanceRef` (el render que adopta la instancia de `useEditor`, 949; PR 3 de ODE-609), `hydrationPhaseRef` (`applyHydrationPhase` 466–470), `syncStatusRef` (`applySyncStatus` 484–487), los metadatos (`applyDocumentMetadata` 571), `currentWritingIdRef` (`setActiveWritingId` 626) y `externalContentConflictRef` (4 escrituras junto a su estado en `useExternalDocumentChanges`). `routerRef` y `routeWritingIdRef` (432–435) se asignan **en el render**, no en un efecto: el ratchet por efecto no los ve y siguen al valor sin retraso.

**`activeEditorTabIdRef`: escritores.**

| Escritor | Sitio | Orden respecto al store |
|---|---|---|
| listener del store (único) | `hooks/useActiveEditorTabIdRef.ts:31` | en el acto: `setSessionState` emite tras asignar, y el listener re-lee `getEditorSessionState().session.active_tab_id` |
| ~~efecto espejo~~ | ~~`editor-shell.tsx:1069–1071`~~ | borrado en el PR 2 de ODE-609 |
| ~~manual~~ | ~~`useWorkspaceTabs.ts:91`, `:168`; `useWorkspaceTabOpening.ts:117`, `:149`~~ | borradas en el PR 2 de ODE-609 |

**Caminos que cambian `active_tab_id` en el store** (`lib/stores/editor-session-store.ts`; todos pasan por `setSessionState` 131–168, que emite en el acto a los listeners de `subscribeToEditorSessionStore` 117–122, público desde el PR 2 de ODE-609):

| Mutador | Líneas | Llamadores | ¿Escritura manual del ref? |
|---|---|---|---|
| `initializeEditorSessionStore` (carga + replay de `changesBeforeLoad`, ODE-577) | 197–251 | shell 977, `useCatalogEditorSessionSync.ts:27`, `useRecentWritings.ts:28` | no |
| `openDraftTab` | 253–303 | `useWorkspaceTabOpening.ts:116`, `:148`; `useSessionRestore.ts:123` | no; el listener cubre las dos que antes escribían a mano (PR 2 de ODE-609) |
| `openWritingTab` | 305–378 | shell 2120, 2179 (`handleMenuOpenFile`); `useWorkspaceTabOpening.ts:192`; `useSessionRestore.ts:60` | no |
| `reconcileMaterializedDraftTab` | 389–466 | `useEditorPersistence.ts:284` | no |
| `focusTab` | 468–491 | `useWorkspaceTabs.ts:92` | no; el listener cubre la escritura manual que estaba en 91 (PR 2 de ODE-609) |
| **`publishTabState`** | 493–559 | efecto de la shell (llamada 1894) | no. Escribe `active_tab_id: writingId ?? EDITOR_DRAFT_TAB_ID` (554) cada vez que cambian el título, `syncStatus`, la fase o la ruta, y puede añadir una pestaña (`unshift`). **No está en la lista del análisis de la opción B de ODE-608** |
| `closeTab` | 600–629 | `useWorkspaceTabs.ts:162` | no; el listener cubre la escritura manual que estaba en 168 (PR 2 de ODE-609) |
| `reconcileUnavailableWritingTab` | 637–676 | `useDocumentHydration.ts:395` | no |
| `reorderTab`, `updateTabSaveState`, `saveTabViewState`, `syncWritingTitlesFromCatalog` | 678, 561, 583, 704 | — | no tocan `active_tab_id` (verificado solo en las líneas del grep; sin leer cada cuerpo entero) |

**`activeEditorTabIdRef`: lecturas**, y si leer `getEditorSessionState().session.active_tab_id` daría lo mismo (requisito 2 de ODE-608). Con el PR 2 de ODE-609 la copia vale el store en todo momento (el listener emite en el acto), así que **hoy ninguna lectura ve un valor viejo**; esta tabla conserva el análisis de ODE-608 (qué lectura habría cambiado si la copia fuera por detrás) y los `||` de 181/229 se quedan como fallback (No tocar). La "ventana" era el intervalo entre un cambio del store sin escritura manual y el siguiente render de la shell:

| Lectura | Contexto | ¿Mismo valor que el store? |
|---|---|---|
| `useEditorPersistence.ts:181` | `applyCommittedTabState` (callback asíncrono del coordinador) | fuera de la ventana, sí; dentro, no. El `|| currentWritingIdRef.current === record.id` lo compensa, y `activateDocument` va antes que `openWritingTab` en los caminos de apertura |
| `:229` | `onStateChange` | igual que 181 (tiene el mismo `||`) |
| `:272` | `onMaterialized`, `isSourceDraftActive` | fuera de la ventana, sí. Se calcula antes de `reconcileMaterializedDraftTab` (284), así que el renombre síncrono no lo cambia |
| `:348` | `onError` | fuera de la ventana, sí; dentro, **no**, y **no tiene `||`**: un error de la pestaña vieja pintaba la barra de estado del documento nuevo (riesgo 2 del análisis). Es el único cambio de comportamiento aceptado de la opción B: con el listener la copia ya vale la pestaña nueva, así que la barra no pinta el error ajeno (badge de la pestaña vieja sí; test de ODE-609) |
| `:425` | `persistEditorSnapshot` → `sourceTabId` | síncrono desde manejadores. En las transiciones del editor se vuelca con `prepareDocumentExit` antes del cambio del store (`useWorkspaceTabs.ts:97`, shell 2091), así que coincide. Un guardado armado dentro de la ventana (p. ej. el rAF de `onUpdate` tras `openWritingTab`) tomaría la pestaña vieja |
| `useWorkspaceTabs.ts:134` | `handleCloseWorkspaceTab`, `isClosingActiveTab`, antes del primer `await` | sí en la práctica: es un manejador de clic, y React vacía los efectos pasivos de los updates discretos antes del siguiente evento. Con el listener, además, la copia ya vale el store en el acto en cualquier camino |

Lecturas **a mitad de transición a propósito** (ref ≠ estado por diseño): `modeRef` en `handleToggleMode` (1481–1497). En `activeEditorTabIdRef` no hay ninguna lectura que dependa de que el ref vaya por detrás; con el PR 2 de ODE-609 ya no va por detrás (`||` en 181/229 se quedan como fallback).

Las 36 lecturas de `modeRef` quedaron contadas por archivo en su fila de arriba (PR 1 de ODE-609, `grep -rn 'modeRef\.current' components/editor/editor-shell.tsx hooks/`), pero no se revisó cada una línea a línea.

### 7.3 Línea base para el cierre (ODE-610)

Se mide con este script. Se corre con `bash` desde la raíz del repo; en `zsh` el `for` sobre la lista no parte las palabras.

```bash
F=components/editor/editor-shell.tsx
echo "líneas: $(wc -l < $F | tr -d ' ')"
for p in useState useRef useEffect useCallback useMemo; do
  printf "%-12s %3s  (con genérico: %s)\n" "$p" "$(grep -c "$p(" $F)" "$(grep -cE "\b$p(<|\()" $F)"
done
echo "lecturas .current: $(grep -o '[A-Za-z]*Ref\.current' $F | wc -l | tr -d ' ')"
echo "-- efectos cuya primera sentencia asigna un ref (candidatos a espejo):"
for f in $F hooks/*.ts; do
  awk -v f="$f" '/useEffect\(/ {s=NR; n=1; next} n==1 {n=0; if ($0 ~ /^[ \t]*[A-Za-z]+Ref\.current = /) {sub(/^[ \t]+/, ""); print f":"s"  "$0}}' "$f"
done
echo "-- hooks de los cortes (línea de llamada en la shell, líneas del hook):"
for h in useFocusMode useEditorPersistence useCorrectionBlocks useTableOfContents useSessionRestore useExternalDocumentChanges useDocumentHydration useSaveStateSync useDocumentExit useCorrectionActions useEditorCommands useCorrectionLifecycle useFindReplace useWorkspaceTabs useWorkspaceTabOpening; do
  printf "L%-5s %-28s %4s\n" "$(grep -n "\b$h({" $F | head -1 | cut -d: -f1)" "$h" "$(wc -l < hooks/$h.ts | tr -d ' ')"
done
echo "-- tests editor-shell-*: $(ls tests/editor-shell-*.test.tsx | wc -l | tr -d ' ') archivos"
```

Salida en `main@ba13217e`:

```text
líneas: 3466
useState      26  (con genérico: 54)
useRef        18  (con genérico: 63)
useEffect     26  (con genérico: 26)
useCallback   43  (con genérico: 43)
useMemo       10  (con genérico: 10)
lecturas .current: 153
-- efectos cuya primera sentencia asigna un ref (candidatos a espejo):
components/editor/editor-shell.tsx:1113  editorInstanceRef.current = editor ?? null
components/editor/editor-shell.tsx:1180  modeRef.current = mode
components/editor/editor-shell.tsx:1248  activeEditorTabIdRef.current = editorSession.active_tab_id
components/editor/editor-shell.tsx:2238  currentDocumentMarkdownRef.current = currentDocumentMarkdown
hooks/useCorrectionLifecycle.ts:101  automaticCorrectionSuggestionsRef.current = automaticCorrectionSuggestions
hooks/useCorrectionLifecycle.ts:105  learnedWordsRef.current = learnedWords
hooks/useEditorPersistence.ts:522  flushPendingEditOnUnmountRef.current = () => {
hooks/useSaveStateSync.ts:118  reconcileActiveSaveStateRef.current = reconcileActiveSaveState
hooks/useTableOfContents.ts:51  tableOfContentsItemsRef.current = tableOfContentsItems
hooks/useTableOfContents.ts:55  activeTableOfContentsItemIdRef.current = selectedTableOfContentsItemId
hooks/useTauriCloseGuard.ts:20  onBeforeCloseRef.current = onBeforeClose
hooks/useTauriEditorMenuEvents.ts:42  onRunActionRef.current = onRunAction
hooks/useVoiceRecorder.ts:335  mountedRef.current = true
-- hooks de los cortes (línea de llamada en la shell, líneas del hook):
L672   useFocusMode                   84
L759   useEditorPersistence          580
L896   useCorrectionBlocks           331
L1136  useTableOfContents            168
L1258  useSessionRestore             139
L1281  useExternalDocumentChanges    369
L1341  useDocumentHydration          756
L1390  useSaveStateSync              252
L1406  useDocumentExit               259
L1478  useCorrectionActions          447
L1555  useEditorCommands             728
L2250  useCorrectionLifecycle        413
L2321  useFindReplace                523
L2376  useWorkspaceTabs              405
L2479  useWorkspaceTabOpening        224
-- tests editor-shell-*: 49 archivos
```

Notas para comparar con las cifras anteriores del documento:
- **La serie histórica mezcla dos patrones.** Re-medido sobre el punto de partida (`e8889942`): `useRef` da 30 con `useRef(` (lo que dice §1) y 75 con genérico; `useState` da 25 sin genérico y 54 con genérico, y §1 dice "~60", más cerca del segundo. Desde ODE-598 ("26 useState, 20 useRef") la serie coincide con `useX(` sin genérico, así que `useRef<T>(` y `useState<T>(` no entran. Para comparar con la serie reciente, usar la primera columna; la cifra real de llamadas es la columna "con genérico". ODE-610 tiene que decir cuál reporta, y usar la misma en el punto de partida y en el cierre.
- Espejos: 13 candidatos del patrón = 8 espejos por efecto (4 en la shell, 2 en correcciones, 2 en la TOC) + 4 latest-callback (`reconcileActiveSaveStateRef`, `flushPendingEditOnUnmountRef` y los 2 de Tauri) + 1 falso positivo (`useVoiceRecorder`).
- Casos de test: el número fiable es el que da vitest, no un grep (hay `it.each` y `it.fails` compuestos). `npx vitest run tests/editor-shell-` en `ba13217e`: **49 archivos, 218 passed | 6 expected fail (224)**, 144 s. Los 6 `it.fails` son los de ODE-632 en `editor-shell-commands`.

### 7.4 Continuación de ODE-609 (2026-09-29)

**PR 4 — markdown derivado.** `currentDocumentMarkdownRef` tiene un solo
escritor: el render que adopta `currentDocumentMarkdown`, inmediatamente después
de calcular el memo y antes de montar el ciclo de correcciones. El memo conserva
sus dependencias y la normalización; no se crea otro cálculo ni otro estado.
El efecto espejo desaparece. La prueba
`tests/editor-shell-markdown-ref-owner.test.tsx` monta la shell real y lee el ref
por el input del consumidor real de correcciones en la fase de layout. Contra
el espejo detecta el markdown anterior en el commit de una edición en el textarea (`it.fails`);
con el escritor del render pasa como `it`, sin cambiar el cuerpo.

**PR 5 — TOC (dos refs).** `useTableOfContentsState`, en el módulo existente
`hooks/useTableOfContents.ts`, posee items, item seleccionado y sus refs. Cada
setter resuelve actualizaciones funcionales contra el ref vigente y escribe
ref y estado juntos. Se monta antes de crear las extensiones, sin efectos:
el debounce y el reset al hidratar reutilizan su setter estable. Se borran los
dos espejos y la escritura manual del scroll. Navegación, scroll y descarte del
item ausente usan el mismo dueño. `tests/editor-shell-toc-ref-owner.test.tsx`
lee los inputs del hook real en layout tras recibir encabezados y pulsar el
segundo item; ambos casos son rojos con los espejos y verdes con el dueño.

## Plan

### Fase 0 — Banco de pruebas (harness)

Un módulo compartido (`tests/support/editor-shell-harness.ts` o equivalente) que monte `EditorShell` en una llamada.

**Real:** el editor de TipTap con las extensiones reales, el store de sesión, `PersistenceCoordinator`, `lib/corrections/persistence`, la base local (`fake-indexeddb`), el `document-service` sobre un directorio temporal real cuando el escenario sea desktop.

**Doblado — solo lo que no cabe en la terminal:** la nube (Supabase/red), el transporte nativo de Tauri, los diálogos nativos del sistema operativo, el proveedor de AI. El objetivo explícito es pasar de ~40 dobles a unos pocos.

**Criterio de aceptación:** las tres pruebas existentes reescritas sobre el harness, verdes, sin su decorado propio. Si alguna se cae al quitarle el stub del editor, **eso es un hallazgo, no un contratiempo** — significaba que estaba verde por el decorado.

Esta fase no produce cobertura nueva. Es la inversión que hace que las ~8 pruebas siguientes cuesten decenas de líneas en vez de cientos, y que mejorar la fidelidad se haga en un sitio y no en once.

### Fase 1 — Tres pruebas de caracterización

Las tres van sobre el harness, con el editor real, y las tres se validan rompiéndolas a propósito antes de darlas por buenas (mutation test — obligatorio por `capability-proof-contract.md`).

1. **Identidad y trabajo diferido.** Cambiar de documento mientras otro está hidratando no puede aplicar el viewState del anterior; ningún callback diferido (rAF, timeout, promesa en vuelo) puede escribir sobre el documento nuevo. *Falsifica:* la familia de ODE-555. *Toca:* STATE-03/04/05.
2. **Guardado contra identidad viva.** Un save encolado antes de cambiar de pestaña no puede escribir en el documento ahora abierto ni perder el contenido del anterior; el estado "sucio" debe ser visible desde el input real, no desde el debounce. *Falsifica:* pérdida silenciosa de contenido en cambio de tab/cierre. *Toca:* STATE-01, WATCH-07, DOC-*.
3. **Aislamiento de correcciones por documento.** Al cambiar de documento, la cola, los timers, los reintentos y el circuit breaker no arrastran estado del anterior, y ningún bloque se persiste contra el `writingId` equivocado. *Falsifica:* fuga entre documentos. *Toca:* AI-05.

### Fase 2 — Cerrar los gaps ya nombrados

Los cuatro del §4, en este orden: STATE-07 (cero cobertura hoy), STATE-05 (seam store→shell), WATCH-07 (siembra del baseline al abrir), EXP-05 (caller real de export). Al cerrarlos, cuatro filas del capability map suben de estado **y** quedan cubiertos los bordes por donde va a pasar el corte.

### Fase 3 — Extracción, siempre en dos tiempos

Orden propuesto:

1. **Hidratación / identidad** — el que más fallos reales ha producido y el que falla en silencio.
2. **Correcciones** — ya no es el cluster más grande: ODE-558 eliminó la mitad automática por inalcanzable (~228 referencias menos). Lo que queda es la aplicación y persistencia de sugerencias del análisis manual, con owner canónico ya existente (`lib/corrections/persistence.ts`); cierra además las 8 llamadas directas que hoy son deuda declarada. El invariante de identidad ya es falsificable (ODE-559): vive en una sola compuerta, `isResponseStillCurrent` en `hooks/useManualCorrections.ts`, y lo prueba `tests/editor-shell-corrections-isolation.test.tsx`.
3. **Tabs / sesión y wiring desktop.**
4. **Chrome** (TOC, find/replace, modales, focus mode) — mayormente puro; riesgo tipográfico, no semántico.

**Regla no negociable en cada paso:** primero la mudanza mecánica sin cambio de comportamiento, se verifica que todo sigue igual, y solo en un segundo commit se cambia la decisión de estado. Nunca mover estado y comportamiento a la vez — ahí es donde muerden los 19 espejos del §2.

---

## Trampa operativa conocida

`architecture/boundaries.baseline.json` lista `components/editor/editor-shell.tsx` bajo `ui-no-direct-persistence`, y el ratchet de `tests/architecture/persistence-boundary.test.ts` es **monotónico en ambas direcciones**: si la extracción *arregla* la deuda (mover las 8 llamadas a `localDB.correctionBlocks` a su owner canónico), el test falla igual hasta que se borre esa entrada del baseline. Hay que borrarla en el mismo PR que la arregla.

## Qué no decide este documento

- El diseño concreto de cada pieza extraída (dónde vive, qué interfaz expone). Eso sale del `architecture-recon` de cada issue, con la red ya puesta.
- Si alguna de las Fases 1-2 debe correr en CI universal o en `scoped-ci.yml`. Se decide por coste real cuando existan.

## Documentos relacionados

- `workflow/quality/capability-proof-contract.md` — reglas MUST de construcción de cada prueba de este plan.
- `workflow/quality/capability-integration-map.md` — estado por capability y el `coverage_status` que estas fases mueven.
- `workflow/testing/critical-capabilities-testing.md` — taxonomía de niveles y principio de menor coste.
- `components/editor/AGENTS.md` — rol declarado del archivo y deuda conocida.
