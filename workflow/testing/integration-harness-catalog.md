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

**Cuándo NO es el adecuado.** Si la propiedad bajo prueba no depende de que el shell esté montado. Montar la UI para probar una regla de un servicio es caro y frágil: baja al nivel de servicio. Tampoco sirve para propiedades que dependen de layout real (alturas, overflow, scroll con medidas) — eso es Playwright, porque happy-dom no calcula layout.

**Dónde se extiende.** Drivers y montaje en `editor-shell-harness.tsx`; dobles de boundary en `editor-shell-doubles.ts`; lo específico de desktop en `editor-shell-desktop-doubles.ts`, que **delega** en el módulo de abajo en vez de duplicarlo.

### 2) `tests/integration/documents/support/real-desktop-doubles.ts` — nivel servicio

**Qué resuelve.** Ejercitar la cadena documental de desktop sin React: servicios reales contra filesystem real en un directorio temporal, con un catálogo que aplica las mismas reglas de identidad/binding que el lado Rust.

**Qué deja real.** Escrituras y lecturas de fs de verdad (incluido el `.tmp` + rename), hashing real de contenido, estado de manifiesto por root, y las reglas de consistencia del catálogo.

**Qué dobla.** El transporte nativo de Tauri (no hay puente dentro de Vitest) y SQLite en concreto, sustituido por un almacén de filas en memoria con las mismas reglas. Eso se declara explícitamente en el módulo: el seam TS → `invoke()` real → Rust/SQLite **sigue siendo un gap abierto** y ningún test que use estos dobles puede afirmar lo contrario.

**Cuándo NO es el adecuado.** Cuando la propiedad vive en la UI (qué se renderiza, qué pasa al cambiar de pestaña, cómo reacciona el editor). Ahí toca el nivel componente.

**Dónde se extiende.** Aquí mismo: es el canonical owner de los dobles de desktop. Añadir un comando nuevo significa revisar también sus consumidores actuales, porque lo comparten los tests de integración y el banco del editor.

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

**El estado real persiste entre tests del mismo archivo.** `fake-indexeddb` es un colaborador real: reutilizar el mismo documento hace que el segundo test encuentre estado del primero y no dispare lo que debía. Usar identidades nuevas por test, que es lo que hace producción.

**Pasar un doble canónico de `unimplemented` a real desbloquea efectos asíncronos en todos los escenarios que lo comparten.** `tests/support/editor-shell-desktop-doubles.ts:119` cableó `tauriCatalogListRetiredBindingRoots` al no-op real (`tauriCatalogListRetiredBindingRootsDouble`, que devuelve `[]`), y eso puso en marcha el reconciliador de workspace —incluido el seeding de starter docs— en cada test desktop del harness. El `main` se rompió en `blank-draft-naming` y el "suite completa en verde" del PR no lo vio porque el seeding es asíncrono y depende de timing (ODE-580, remediado por #513 con la exclusión de starter docs). Candidatos a la misma trampa, todavía en `unimplemented`: `tauriCatalogApplyReconcile` y `tauriCatalogListBindingRootDocuments`. Ver paso 7 del protocolo.

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
