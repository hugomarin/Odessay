# ADR — Fuente única del documento activo en el editor

- **Estado:** Aceptado (2026-09-24)
- **Fecha:** 2026-09-24
- **Decide:** Hugo. Aprobó la propuesta de forma explícita en ODE-566.
- **Estado del corpus vs. código:** este ADR va **por delante del código**. El runtime vigente es el que describe §Contexto hasta completar las fases ODE-567…ODE-571; `odessay-sync.md` y `skill-frontend` distinguen, en cada punto, el destino del estado actual.
- **Ámbito:** **qué documento está activo en el editor** en cada momento y quién puede cambiarlo. No toca la identidad *documental* (UUID, `.md` canónico, catálogo), que gobierna `odessay-adr-identidad.md` y prevalece en su ámbito.
- **Reconcilia:** `workflow/context/features/odessay-sync.md` §"Fuente de verdad única por dimensión" y `.agents/skills/skill-frontend/specialties/runtime-and-editor.md` §"Una fuente de verdad por dimensión". Ambos contradecían al código (ver §Contradicción) y quedaron alineados con este ADR en ODE-566.

---

## Contexto

La serie ODE-562/563/564 dejó un solo dueño por dato **dentro** de `editor-shell.tsx`. Por debajo queda el problema de fondo: "el documento activo" vive en **seis portadores**, y cada transición los sincroniza a mano.

| # | Portador | Dónde vive | Qué hace con él el sistema |
|---|---|---|---|
| 1 | `currentWritingId` + `currentWritingIdRef` | shell; dueño `setActiveWritingId` | hidratación, guardado, imágenes, correcciones, atajos |
| 2 | `active_tab_id` + `tabs[].writing_id` | `lib/stores/editor-session-store.ts`, persistido en IndexedDB | pestañas, restauración de sesión, Studio, Recientes, títulos del catálogo |
| 3 | `activeEditorTabIdRef` | shell; espejo del #2 más escrituras a mano | callbacks de persistencia y cierre |
| 4 | `hydrationWritingId` | shell | dispara la hidratación y bloquea la publicación de pestaña mientras dura |
| 5 | ruta (`writingId` prop, `/write/[id]`, `/write?id=`) | Next; se reescribe con `replaceEditorHistory` / `router.replace` | entrada desde Desk, Search, Recent y la apertura desktop |
| 6 | `activeDocumentId` | `lib/editor/persistence-coordinator.ts`, vía `activateDocument(currentWritingId)` | qué guardado cuenta como "actual" |

A esto se suma el borrador aún sin materializar, con identidad en dos sitios: `ephemeralDraftWritingIdRef` en la shell y `draft_writing_id` de la pestaña `draft` en el store.

### Transiciones × portadores

Salida de `node scripts/report-active-document-carriers.mjs` sobre `main` (2026-09-24):

```text
transición                    shell      store      tabRef     hydration  route      total
handleCloseWorkspaceTab       ✓          ✓          ✓          ✓          ✓          5
handleCreateWorkspaceTab      ✓          ✓          ✓          ✓          ✓          5
handleSelectWorkspaceTab      ✓          ✓          ✓          ✓          ✓          5
ensureIdentity                ✓          ✓          ·          ✓          ✓          4
finishCreation                ✓          ✓          ✓          ✓          ·          4
handleMenuOpenFile            ✓          ✓          ·          ✓          ✓          4
recoverUnavailableTab (hook)  ✓          ✓          ·          ✓          ✓          4
useEffect@L1933               ✓          ✓          ·          ✓          ✓          4   (restauración de sesión)
handleOpenWorkspaceDocument   ✓          ✓          ·          ✓          ·          3
onIdentityCreated             ✓          ·          ·          ✓          ✓          3
onMaterialized                ✓          ✓          ·          ✓          ·          3
useEffect@L1905               ✓          ·          ·          ✓          ·          2   (carga por ruta externa)

transiciones que cambian la identidad: 12
portadores tocados por transición (media): 3.8
```

Además hay **sincronizaciones automáticas en los dos sentidos**:

- shell → store: efecto que llama a `publishTabState`. Es el origen de ODE-561.
- store → `activeEditorTabIdRef`: efecto espejo.
- store → shell: restauración de sesión.
- ruta → shell: carga externa.
- shell → coordinador de persistencia: efecto `activateDocument`.
- store → Studio: `syncStudioSessionFromEditorTabs`, dentro del propio store.

### Hechos que condicionan la decisión

1. **Cada entrada externa remonta la shell.** `app/(app)/write/[id]/page.tsx` monta `<EditorShell key={identifier} …>` y `components/editor/desktop-write-entry.tsx` monta `key={writingId}`. Abrir un documento desde Desk, Search o Recent **destruye el estado de la shell**; los cambios de pestaña internos no, porque reescriben la URL con `replaceState` sin navegar. **Lo único que sobrevive a una entrada es el store de sesión.**
2. **El store ya es lo que persiste y lo que leen los demás.** Studio, Recientes y la sincronización de títulos del catálogo leen el store. Ninguno escribe la identidad; el catálogo solo reescribe títulos.
3. **El store se lee al instante desde cualquier sitio.** `getEditorSessionState()` devuelve el valor vigente de forma síncrona; `useSyncExternalStore` lo lleva al render. No hace falta un ref para que un callback de larga vida vea el valor actual. Los tres bugs de esta familia (ODE-555, ODE-561, la ventana de ODE-564) nacieron del desfase entre estado de React, refs y efectos que los copian.
4. **Cambiar de documento es un protocolo, no una asignación.** Antes de salir hay que volcar la edición en cola (`flushQueuedRichModeUpdate`), conservar el contenido del borrador (`snapshotOutgoingDraftContent`), guardar el `view_state` saliente (`persistCurrentWorkspaceViewState`) y, al cerrar, esperar la escritura (`persistenceCoordinator.settle`). Hoy ese protocolo está copiado en cinco handlers, **y no es igual en todos**: `handleOpenWorkspaceDocument` no guarda el `view_state` saliente.
5. **Si una activación hidrata lo decide hoy cada handler, sin una regla.** Seleccionar, abrir, restaurar, recuperar, crear una pestaña (`handleCreateWorkspaceTab`) y materializar un borrador (`onMaterialized`) fijan `hydrationWritingId` al documento nuevo. `ensureIdentity` activa el documento y lo deja en `null`: no hidrata. Una fuente única necesita que la transición declare su **motivo** y que la regla "¿hay que cargar?" se derive de él, en vez de repetirse en cada handler.

## Contradicción normativa

- `odessay-sync.md` dice: *"La dimensión 'writing activo' tiene una sola fuente de verdad: `currentWritingIdRef.current` en el editor-shell. La URL refleja ese valor, pero no lo controla."* `skill-frontend/specialties/runtime-and-editor.md` repite la misma tabla.
- **El código no lo cumple.** El store de sesión guarda y persiste la pestaña activa; en la restauración de sesión y en la recuperación de un documento no disponible **manda sobre la shell**; y la shell le publica de vuelta. Por el Hecho 1, la shell tampoco *puede* ser la fuente a través de una entrada externa.
- El mismo documento describe el estado intermedio como `hydrationPhase` (`idle → switching → loading → ready`). **`hydrationPhase` no existe en el código**; su papel lo cumple a medias `hydrationWritingId`.

Precedencia aplicada: este ADR prevalece sobre ambas secciones, que se reconciliaron con él (ver §Consecuencias).

## Opciones

**A — La shell manda.** Ratifica `odessay-sync.md`. El store de sesión y la ruta son proyecciones de `currentWritingId`.

**B — El store de sesión manda.** La pestaña activa (`active_tab_id` → `writing_id`, o el `draft_writing_id` de la pestaña borrador) *es* el documento activo. La shell, la ruta y el coordinador de persistencia derivan de él.

**C — Un coordinador de navegación manda.** Un módulo de capa Application guarda el documento activo y proyecta hacia store, shell y ruta.

## Criterios y comparación

| Criterio | A — shell | B — store | C — coordinador |
|---|---|---|---|
| Sobrevive a una entrada externa (Hecho 1) | **No**: la shell se remonta; necesita leer el store al montar, o sea, dos fuentes | **Sí**, por construcción | Sí, si persiste (y entonces duplica el store) |
| Restauración de sesión y persistencia | Hay que copiar al store para persistir | Nativa | Hay que persistir aparte o delegar en el store |
| Borrador sin `writing_id` | Sigue en dos sitios (ref + store) | Ya modelado como pestaña `draft` con `draft_writing_id`; falta terminarlo | Igual que B si delega |
| Consumidores fuera de la shell (Studio, Recientes, catálogo) | Dependen de que la shell publique; esa publicación es la de ODE-561 | Sin cambio de contrato: ya leen el store | Leen el store, que pasa a ser proyección |
| Entradas por URL y apertura desktop | La shell traduce ruta → estado → store | Una entrada = una llamada que activa en el store | Una llamada al coordinador |
| Disparo de la hidratación (Hecho 5) | Sigue decidiéndolo cada handler | Hace falta el motivo de la transición: el store solo sabe *qué* está activo, no *por qué* | Lo decide el coordinador, que conoce el motivo |
| Coherencia con `components/editor/AGENTS.md` (la shell no es owner de identidad ni de estado de tabs) | **La contradice** | La cumple | La cumple |
| Familias de bug ya pagadas | ODE-561 sigue siendo posible: la publicación shell → store permanece | ODE-561 y la ventana de ODE-564 desaparecen por construcción; ODE-555 (trabajo diferido) sigue cubierto por el dueño de generación | Como B, si no duplica estado |
| Lectura síncrona sin refs | No: requiere `currentWritingIdRef` | Sí (`getEditorSessionState`) | Sí, si es un store externo |
| Protocolo de salida (Hecho 4) | Sigue repartido en handlers | No lo resuelve por sí solo | Lo centraliza |
| Coste de migración | El menor | Medio: la shell deja de ser dueña | El mayor si es un almacén nuevo |

**Lectura.** A es la más barata, pero no cumple el criterio que ningún otro puede sortear: la shell se remonta en cada entrada externa, así que no puede ser la fuente a través de ella. B resuelve casi todo, porque el store ya persiste, ya lo leen los demás y se lee al instante, pero deja el protocolo de salida repartido. C centraliza el protocolo, pero como almacén propio añade un séptimo portador.

## Decisión

**D1 — El store de sesión es la única fuente del documento activo.** El documento activo es la pestaña activa del store: su `writing_id`, o el `draft_writing_id` de la pestaña borrador. Ningún otro portador decide qué documento está activo.

**D2 — Una sola función cambia el documento activo.** Una función de capa Application (nombre orientativo `activateDocument(target, reason)`) es **la única** que escribe la pestaña activa del store. Ejecuta el protocolo de salida del documento saliente mediante un hook que registra la shell (volcar la edición en cola, conservar el contenido del borrador, guardar el `view_state`, esperar la escritura si se cierra), escribe el store y declara el **motivo** (`select`, `open`, `create`, `materialize`, `close`, `restore`, `recover`), que decide si hay que hidratar. Es la opción C, pero como *escritor* del store, no como almacén: el dato sigue viviendo en un solo sitio.

> **Ajuste de la Fase 1 (ODE-567):** el protocolo de salida vive en una función aparte, `prepareDocumentExit`, porque algunas transiciones (cerrar, abrir desde el workspace o desde el menú) salen **antes** de un `await` y activan **después**; juntarlo con `activateDocument` obligaría a mover trabajo a través de ese `await`. Cada transición declara qué pasos del protocolo ejecuta. Hoy no son iguales en todas, y uniformizarlos es una decisión aparte. A los siete motivos se sumaron tres que aparecieron al mudar los escritores: `route` (carga por ruta externa), `identity` (identidad creada en el primer guardado web) y `revert` (deshacer una creación fallida).

**D3 — Todo lo demás deriva.**
- La shell lee el documento activo del store: render con `useSyncExternalStore` y callbacks con `getEditorSessionState()`. `currentWritingIdRef`, `setActiveWritingId` y `activeEditorTabIdRef` desaparecen.
- La **ruta** es proyección: un único efecto store → URL. Una entrada por URL es una llamada a `activateDocument(id, "open")`.
- El coordinador de persistencia se suscribe al store en vez de recibir `activateDocument` desde un efecto de la shell.
- `hydrationWritingId` deja de ser identidad: pasa a ser la fase explícita de la transición (`idle → switching → loading → ready`), el `hydrationPhase` que `odessay-sync.md` ya describía.
- La publicación shell → store (`publishTabState`) queda solo para **metadatos** de la pestaña activa (título, estado de guardado). Nunca crea, activa ni reemplaza pestañas.

**D4 — Invariantes.** Los de ODE-562/563/564 siguen vigentes durante la migración. Además: ninguna transición escribe más de un portador de identidad; ningún efecto copia identidad de un portador a otro; una pestaña cerrada solo vuelve por `activateDocument` (se conserva el guard de ODE-561 en el store).

## Consecuencias

**Por consumidor:**

| Consumidor | ¿Cambia su contrato? |
|---|---|
| `lib/stores/studio-session-store.ts` | No: sigue reflejando el store |
| `hooks/useRecentWritings.ts` | No: sigue leyendo el store |
| `hooks/useCatalogEditorSessionSync.ts` | No: solo sincroniza títulos |
| `hooks/useDocumentHydration.ts` | Sí: se dispara por el motivo y la fase de `activateDocument`, no por `hydrationWritingId` |
| `hooks/useManualCorrections.ts` | Sí, mecánico: lee la identidad del store en vez de un `RefObject` |
| `lib/editor/persistence-coordinator.ts` | Sí: su documento activo sale de una suscripción al store |
| Entradas URL (Desk, Search, Recent, apertura desktop) | No para quien navega: la URL sigue siendo `/write?id=` y `/write/[id]`; cambia cómo la consume la shell |

**Documentos a reconciliar tras la aceptación:**
- `odessay-sync.md` §fuente de verdad: la dimensión "writing activo" pasa a tener como fuente la pestaña activa del store de sesión, con `activateDocument` como único escritor; `hydrationPhase` pasa de afirmación a destino de la Fase 4.
- `skill-frontend/specialties/runtime-and-editor.md`: su tabla de dimensiones.
- `components/editor/AGENTS.md` ya dice que la shell **no** debe ser owner canónico de la "identidad documental" ni del "estado de dominio de tabs". Esta decisión lo cumple, así que ese archivo no cambia.

## Plan de migración

Cada fase es un issue propio, con la red de pruebas como precondición y la regla de dos tiempos del diagnóstico: primero mover, después cambiar ownership. El script de inventario mide el avance de cada fase.

| Fase | Qué hace | Tiempo | Red previa | Medida esperada |
|---|---|---|---|---|
| 1 (ODE-567) | Extraer el protocolo de salida y la secuencia de cada transición a una sola función (`activateDocument`) que por dentro sigue escribiendo los mismos portadores de hoy. Uniformiza el protocolo; la diferencia de `handleOpenWorkspaceDocument` se caracteriza antes de decidir si era bug | mover | barridos de ventanas (ODE-561, ODE-564), 4a, 4b, metadatos; una prueba nueva del protocolo de salida por transición | los 12 escritores pasan por una función |
| 2 (ODE-568) | La shell lee el documento activo del store; eliminar `currentWritingIdRef`, `setActiveWritingId` y `activeEditorTabIdRef` | ownership | la de la fase 1 más el barrido de identidad de ODE-564 contra la lectura nueva | columnas `shell` y `tabRef` vacías |
| 3 (ODE-569) | La ruta como proyección: un efecto store → URL; las entradas llaman a `activateDocument(…, "open")`; la restauración sale del store al iniciarse | ownership | pruebas de restauración y entrada por URL (a crear), e2e de apertura | columna `route` solo en la proyección |
| 4 (ODE-570) | La hidratación como fase explícita de la transición; `hydrationWritingId` desaparece; el coordinador de persistencia se suscribe al store | ownership | ODE-464, 4a, selección, admisión | columna `hydration` vacía |
| 5 (ODE-571) | Borrador: `ephemeralDraftWritingIdRef` pasa a ser el `draft_writing_id` del store | ownership | pruebas ODE-405 / ODE-478 | sin identidad de borrador en la shell |

## Qué no decide este ADR

- El diseño concreto de `activateDocument` (firma, módulo, forma del hook de salida). Sale del recon de la Fase 1.
- `modeRef` y los demás espejos que no son de identidad.
- La identidad documental (UUID, binding, catálogo): la gobierna `odessay-adr-identidad.md`.

## Verificación

`node scripts/report-active-document-carriers.mjs` recalcula la tabla de transiciones × portadores. Al terminar la Fase 5, cada transición debería mostrar un solo portador: el store, a través de `activateDocument`.

## Referencias

- `workflow/context/features/odessay-sync.md` — transiciones críticas, owner único (la sección que se reconcilia)
- `workflow/context/core/odessay-adr-identidad.md` — identidad documental
- `workflow/quality/editor-shell-decomposition-diagnostic.md` — Hallazgo 1 y regla de dos tiempos
- `workflow/testing/integration-harness-catalog.md` — ventana commit → efectos pasivos y barridos
- `components/editor/AGENTS.md` — rol de la shell
- ODE-555, ODE-561, ODE-562, ODE-563, ODE-564 — la serie que llevó hasta aquí
