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
| Find / replace | ~122 refs | — | unit de `lib/editor/find-replace.ts` |
| Desktop wiring (canonical path, conflicto externo, open-file, menús, close guard) | ~103 refs | WATCH-07, WS-* | **ninguna** |
| Anotaciones / selección | ~90 refs | ANN-04/05 | 1 e2e |
| Tabs / sesión / catálogo | ~62 refs | STATE-05, STATE-08 | unit del store, no el seam al shell |
| Chrome (TOC, modales, focus mode) | ~106 refs | — | **ninguna** |

Nueve filas del capability map nombran este archivo en su chain o su evidencia: **AI-05, EXP-05, STATE-01, STATE-03, STATE-04, STATE-05, STATE-07, STATE-08, WATCH-07**. De ellas, cinco están en `PARTIAL_INTEGRATION` o `NONE`, y en cuatro el tramo no probado **es precisamente este archivo**:

- **STATE-05** — el seam `store → EditorShell` (aplicación al DOM) es literalmente el gap declarado de la fila.
- **STATE-07** — el código de restore de cursor/selección vive aquí (~L2512-2520) y no lo ejercita ningún test.
- **EXP-05** — `exportBinary`/`exportMarkdown` del shell nunca se conectan al `saveBinaryArtifact` ya probado.
- **WATCH-07** — que el shell siembre el `content_hash` base correcto al abrir no lo prueba nadie; el proof de integración lo siembra a mano y lo documenta como tal.

## 5. Hallazgo 4 — el editor real sí corre fuera del navegador

No hay obstáculo técnico para una red fiel: **12 tests usan TipTap real** (no doblan `@tiptap/react`), y **6 de ellos instancian un `Editor` completo** con las extensiones reales — `tests/highlight-annotation.test.ts`, `tests/footnotes-perf.test.ts`, `tests/lib/editor/desktop-document-engine.test.ts`, `tests/lib/editor/local-image-extension.test.ts`, `tests/lib/editor/image-markdown-roundtrip.test.ts`, `tests/lib/editor/image-presentation-viewer.test.ts` — bajo `@vitest-environment happy-dom`, el mismo entorno que ya declaran los tests del shell.

Que el shell use un stub fue una decisión de comodidad, no una limitación de la plataforma.

---

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
