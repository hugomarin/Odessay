# Salir de un documento cuya escritura falló (ODE-692) — diseño

Estado: **diseño propuesto, pendiente de aprobación de Hugo (gate GD-692)**. Sin código de producción ni tests en este PR.

Verificado en `codex/ode-528-539-document-components@96d1f105` (2026-10-09), solo lectura. Supone **ODE-697 construido** según su diseño (`docs/design/document-components/source-markdown-save.md`, PR #657): Source guarda el Markdown directo, `activateDocument` vacía el guardado de Source y `persistEditorSnapshot` es consciente del modo. Con eso, Source deja de tener una variante propia de "escritura fallida" y este diseño vale igual en Rich y en Source.

Etiquetas: **[V]** verificado leyendo el código (o el código fuente de una dependencia, con su ruta); **[I]** inferencia a partir del flujo de control, sin ejecutar; **[NV]** no verificado. No se ejecutaron tests ni sondas.

Entradas, por precedencia: comentario "Decisiones (Hugo, 2026-10-07)" de ODE-692 (decisión D) y los "Default propuesto" de su Auditoría, que esa decisión acepta; requisitos de la descripción de ODE-692; reglas vigentes del dueño escritas en ODE-697 ("nunca perder texto; nunca guardar una versión alterada; cambiar de pestaña o navegar no interrumpe"); Recon Pack de ODE-692 (`@60096f56`, solo como mapa); §4 del reanálisis de ODE-540 (`/private/tmp/claude-501/mut/ode540-reanalysis.md`, fila "fallo de escritura en disco"); los límites que los diseños D697 (M15, M19, M29) y D698 (R-5, §4 punto 4) delegan en ODE-692.

---

## 1. Resumen de producto (5 líneas)

1. Si guardar funciona, nada cambia: cambiar de pestaña, cerrar o salir siguen igual que hoy, sin avisos ni esperas nuevas.
2. Si un guardado falla, el texto no se pierde: queda retenido en la pestaña, en memoria y mientras la app esté abierta, con "Needs attention", hasta que se guarde.
3. Cambiar de pestaña con un guardado fallido muestra un aviso con "Retry save" y "Switch anyway". Si cambias igualmente, al volver el texto sigue ahí, en error.
4. Cerrar la pestaña, cerrar la ventana o salir de la app (también con Cmd+Q) con texto sin guardar se detiene y pregunta: reintentar o descartar a propósito. Es la única forma de perder ese texto.
5. Abrir otro documento, crear uno nuevo o ir a otra sección nunca se interrumpe: si el guardado falla después, el texto queda retenido y la pestaña marcada en error.

---

## 2. Representaciones y flujo de escritura

### 2.1 Dónde vive el texto que todavía no es durable

| Almacén | Runtime | Qué guarda | Vida | Escribe / borra hoy |
|---|---|---|---|---|
| Editor TipTap y textarea de Source | ambos | el texto que ve el usuario | el documento activo; **una sola instancia por shell**, que cada activación rehidrata desde el almacén durable (`hooks/useDocumentHydration.ts:512-525`) **[V]** | el usuario; la hidratación lo reemplaza |
| Colas de la shell (frame/150 ms de Rich, 800 ms de Source) | ambos | la última edición aún no entregada | hasta el vaciado (`hooks/useEditorPersistence.ts:49-61, 156-177, 533-572`) **[V]** | `prepareDocumentExit` (`hooks/useDocumentExit.ts:200-216`) y el desmontaje (`useEditorPersistence.ts:408-419`) las vacían **[V]** |
| `pendingRequests` / `inFlightRequest` del coordinador | ambos | `PersistenceSnapshot` completo (`lib/editor/persistence-coordinator.ts:32-55`) | hasta que la petición **empieza**: se saca del mapa antes de `start` (`:767, 788, 848, 889`) **[V]** | `persist()` (`:927-999`) |
| Marcador "sin confirmar" | ambos | **solo la identidad** (writingId, draftWritingId, sourceTabId, secuencia); nunca bytes (comentario de `:255-259`) **[V]** | hasta un commit que lo supere o `discardUnconfirmed` (`:357-368`); **sobrevive al fallo** **[V]** | lo lee solo WATCH-07 (`hooks/useExternalDocumentChanges.ts:211-216`) y lo descarta la siembra de cada activación (`:200-206`) **[V]** |
| Línea base WATCH-07 | ambos | hash durable por documento | instancia del coordinador | avanza solo tras un commit (`persistence-coordinator.ts:707`) **[V]** |
| `.md` → manifest → SQLite + cola | desktop | bytes y metadatos | durable | `DesktopDocumentService.persist` (`lib/services/document-service-factory.ts:185-384`) **[V]** |
| IndexedDB `LocalWriting` | web | `body_json`, `body_text` | durable | `webDocumentService.saveWriting` (`lib/services/web-document-service.ts:169-185`) **[V]** |
| `save_state` de cada pestaña y status bar | ambos | `"saving" \| "error" \| …` (`components/editor/save-state.ts:10`) | sesión | `onError` → `updateTabSaveState(error)` y `applySyncStatus("error")` (`useEditorPersistence.ts:348-377`); la pestaña activa se publica desde `syncStatus` (`components/editor/editor-shell.tsx:1927-1934`) **[V]** |
| Snapshot del borrador saliente | ambos | `editor.getJSON()` de un borrador sin materializar | un solo hueco, vida de la shell (`useDocumentExit.ts:117-125`) **[V]** | se restaura al volver al borrador (`useDocumentHydration.ts:282-289`) **[V]** |

**Vida del coordinador.** El `PersistenceCoordinator` se crea en un `useMemo` de `useEditorPersistence` (`:179-402`) y se cierra con `dispose()` al desmontar (`:408-419`). `EditorShell` lo monta la página `/write` (`app/(app)/write/page.tsx`), así que ir a Desk, Studio o Settings lo destruye **[V]**. Conclusión: hoy **ningún almacén conserva los bytes de una escritura fallida**. Solo quedan en el editor, y el editor se reemplaza en cuanto se activa otro documento o se desmonta `/write`.

### 2.2 Flujo actual de una escritura fallida (desktop)

1. El coordinador saca la petición de `pendingRequests` y la ejecuta (`persistence-coordinator.ts:767-768` o `:848-849`) **[V]**.
2. `DesktopDocumentService.persist` escribe el `.md` (`document-service-factory.ts:214-224`). Después ocurren el touch/sync del manifest (`:283-302`) y `commitDualWrite` (`:377`). Cualquiera de esos pasos puede fallar **después** de que el `.md` ya tenga los bytes nuevos **[V]**.
3. El fallo llega como `STORAGE_ERROR` (escritura del `.md`, `lib/services/desktop/filesystem-document-service.ts:347`), `CONFLICT` (guarda WATCH-07 de Rust, `src-tauri/src/commands/document.rs:115-150`; `filesystem-document-service.ts:340-346`), `NOT_FOUND` (sin binding, `document-service-factory.ts:466-468`) o `DB_ERROR`/`UNAVAILABLE` (`:470`; `persistence-coordinator.ts:198-215`) **[V]**.
4. El coordinador emite `failed` y `onError`, devuelve `false` y **no reencola** la petición (`persistence-coordinator.ts:729-740`; materialización de borrador `:633-644`; red de seguridad `:796-807`). La línea base no avanza (`:707` solo corre con éxito) y el marcador sigue puesto **[V]**.
5. La shell pone la pestaña en `error` y, si el documento sigue activo, la barra en "Needs attention" (`useEditorPersistence.ts:244-246, 258-260, 348-360`; `components/editor/status-bar.tsx:38`) **[V]**. No hay acción de reintento: el siguiente guardado lo dispara la siguiente edición (`tests/editor-shell-durable-save-state.test.tsx:580-629`) **[V]**.

### 2.3 Flujo web

Igual en el coordinador. `persistenceDebounceMs` es 0 en web (`useEditorPersistence.ts:225`), así que la escritura empieza en cuanto llega. Un fallo es un error de IndexedDB que `saveWriting` devuelve como `DB_ERROR` (`web-document-service.ts:182-184`) **[V]**. El hook de pestañas es el mismo (`hooks/useWorkspaceTabs.ts`), y no hay ningún `beforeunload`: el único `pagehide` del código limpia el arrastre de pestañas (`components/editor/editor-tabs.tsx:149-171`) **[V]**.

### 2.4 Salidas de hoy: qué esperan y qué pasa si la escritura falla

| Salida | ¿Espera la escritura? | Si falla durante la espera | Si ya había fallado antes (nada pendiente) |
|---|---|---|---|
| Cambiar de pestaña (`useWorkspaceTabs.ts:84-149`; también el atajo de pestaña adyacente y el lápiz de una pestaña de fondo) | Sí, si el saliente tiene `writingId` y `hasPending` (`:116-122`) **[V]** | `if (!settled) return` (`:121`): el clic se descarta sin aviso; la pestaña y la barra ya muestran `error` por `onError` **[V]** | No espera (`hasPending` es falso); B se hidrata sobre la única copia de A **[I]** |
| Volver a pulsar la pestaña activa | No (`:101, 116`); reactiva A con una hidratación nueva (`:136-142`) **[V]** | — | La hidratación vuelve a leer el disco y **reemplaza** el texto más nuevo del editor **[I]** |
| Cerrar pestaña (`:151-236`) | Sí (`:180-186`) **[V]** | `return` (`:183-185`): la pestaña no se cierra y no dice por qué **[V]** | Cierra: el texto se pierde **[I]** |
| Cerrar otras / todas (`:242-259`) | Una a una | La que falla queda abierta en silencio y el bucle sigue **[V]** | Igual que cerrar pestaña |
| Abrir otro documento (Search, Recent, árbol: `hooks/useWorkspaceTabOpening.ts:170-190`; menú Open File: `editor-shell.tsx:2125-2151`) | No: vacía y activa **[V]** | — | El fallo posterior marca la pestaña de A (`onError`), pero el editor ya muestra el otro documento: el texto se pierde **[I]** |
| New Artifact (`useWorkspaceTabOpening.ts:77-167`) | No **[V]** | — | Igual que abrir **[I]** |
| Salir de `/write` (desmontar) | No: vacía y `dispose()` (`useEditorPersistence.ts:408-419`) **[V]** | — | Tras `dispose` el fallo solo marca la pestaña y deja un `console.error`; el texto muere con el editor **[I]** |
| Cerrar la ventana (semáforo, Cmd+W = `close_window`, `src-tauri/src/lib.rs:279`) | Sí: `settleBeforeClose` (`editor-shell.tsx:2290-2294`) **[V]** | **No mira el resultado** de `settle` y `destroy()` corre igual (`hooks/useTauriCloseGuard.ts:45-46`) **[V]**: el texto se pierde **[I]** | `settle()` no tiene nada que vaciar, devuelve `true` y se cierra **[I]** |
| Cerrar la ventana fuera de `/write` | No hay guard: el único `useTauriCloseGuard` vive en la shell (`editor-shell.tsx:2295`) **[V]** | — | Se cierra **[I]** |
| Salir con Cmd+Q / "Quit Artifact Studio" | **No pasa por ningún guard** (ver abajo) | — | Se pierde lo retenido y, también en el caso normal, lo que quedaba en las colas (hasta 150 ms + 4 s) **[I]** |
| Web: cerrar o recargar la pestaña del navegador | Sin guard **[V]** | — | Se pierde **[I]** |

**Cmd+Q no emite `CloseRequested`.** El menú usa el ítem predefinido `.quit()` (`src-tauri/src/lib.rs:83`). En macOS, muda lo convierte en el selector `terminate:` (`~/.cargo/registry/.../muda-0.19.2/src/platform_impl/macos/mod.rs:994`). El delegado de tao 0.35.3 no implementa `applicationShouldTerminate:`, solo `applicationWillTerminate:` (`tao-0.35.3/src/platform_impl/macos/app_delegate.rs:47-89, 131-135`), que llama a `AppState::exit()` → `Event::LoopDestroyed` (`app_state.rs:272-283`). `tauri-runtime-wry 2.11.2` lo traduce a `RunEvent::Exit` (`src/lib.rs:4192-4194`). `ExitRequested` solo se emite al destruirse la última ventana o con `app.exit()` (`:4317-4333, 4361-4373`), y la app no maneja ni uno ni otro (`src-tauri/src/lib.rs:376-378`) **[V en el código de las dependencias]**. Consecuencia en ejecución: **[I]**, pendiente de comprobar en el DMG.

### 2.5 Flujo propuesto: la copia sin guardar

**Dueño.** La capa de persistencia. Se añade un almacén de copias sin guardar **a nivel de módulo** (`lib/editor/unsaved-copies.ts`, una instancia por proceso y una fábrica para tests), inyectado en `createPersistenceCoordinator` como dependencia. No es un segundo coordinador ni un draft: no escribe a disco, no acuña UUID y muere con el proceso (decisión D). Vive fuera de la instancia del coordinador porque esa instancia muere al desmontar `/write` (§2.1), y la decisión D pide "mientras la app esté abierta".

**Entrada.** `{ key, writingId, draftWritingId, sourceTabId, sequence, snapshot, overrides, reason: ServiceError, baselineHash, capturedAt }`. `snapshot` es el `PersistenceSnapshot` completo: Rich (`bodyJson`) o, tras ODE-697, Markdown (`markdown`). `sequence` sale de un contador **global del módulo**, no por instancia, para que una copia de una shell anterior no quede ordenada por detrás de un commit de la shell nueva.

**Quién escribe:**
- **El coordinador, al fallar.** En los tres `catch` (`:633-644`, `:729-740`, `:796-807`) guarda la copia, siempre que el token de la petición siga siendo el último de su clave (una edición más nueva pendiente gana). También guarda si la petición ya no es `current`: el fallo de fondo (abrir, New Artifact, desmontar) es justo el caso que hoy pierde texto.
- **El coordinador, al salir sin resultado.** Nueva operación `retainUnconfirmed(target, reason)`: copia la petición en vuelo o pendiente del destino cuando el usuario elige salir antes de que termine (tiempo de espera, M10). También la usa toda salida con un conflicto WATCH-07 abierto (pestaña, abrir, New Artifact, desmontar, y el vaciado que la shell registra en la puerta de la app al cerrar o salir): el guardado está bloqueado antes de encolar (`useEditorPersistence.ts:434-436`), así que no hay petición que falle, y la shell entrega el snapshot actual con razón `CONFLICT` (M24, M24b).

**Quién borra:**
- un commit durable de la misma clave con `sequence` mayor o igual (dentro de `clearUnconfirmedContentForCommit`, `:357-362`);
- un descarte explícito del usuario: "Close without saving", "Quit without saving" o "Reload external" (`hooks/useExternalDocumentChanges.ts:312-330`).

Nada más la borra. En particular, **la siembra WATCH-07 de cada activación deja de descartarla** (`useExternalDocumentChanges.ts:200-206`) y toma la línea base de la copia.

**Quién lee:**
- `hasUnconfirmedContent(target)` incluye las copias;
- nueva operación `retry(target?)`: si no hay una petición más nueva, reencola la copia y hace `settle`; sin destino, reintenta todas;
- la hidratación, para restaurar (M19);
- la puerta de cierre de la app, para decidir (M26-M29).

**Fallo después del `.md`.** Si falla el manifest o `commitDualWrite` cuando el `.md` ya se escribió, `persist` lanza el error con `details: { contentWritten: true, contentHash }` (hash de `writtenMarkdown` con `computeMarkdownContentHash`, la función que `persist` ya usa en `:255`). El coordinador avanza la línea base a ese hash y lo guarda en la copia. Así "Retry save" no choca con sus propios bytes (M22).

**Salidas.** La regla tiene dos partes:
- **Las salidas que esperan** (cambiar de pestaña, cerrar pestaña, cerrar ventana, salir): primero vacían y hacen `settle`, como hoy; luego reintentan la copia del saliente, sin interfaz. Solo si después sigue habiendo texto sin confirmar, se detienen y muestran el aviso.
- **Las salidas que no esperan** (abrir otro documento, New Artifact, desmontar, y cambiar de pestaña desde un borrador sin materializar, que hoy tampoco espera: `useWorkspaceTabs.ts:116`): siguen sin esperar (requisito 4: sin fallo no cambia nada). Si el guardado falla después, la copia queda retenida y la pestaña de A en `error`.

**Volver al documento.** Al hidratar A, si existe texto sin confirmar de A (copia o petición pendiente o en vuelo), la hidratación aplica **el snapshot más nuevo** encima de lo leído del disco, sin persistir. Ese snapshot se aplica en su forma (Rich o Markdown, con las reglas de regeneración de ODE-697). Después:
- la barra y la pestaña quedan en `error` si hay copia;
- la línea base es la de la copia, no la del catálogo, y el marcador se conserva;
- si el disco cambió mientras tanto (hash del catálogo distinto de la línea base), aparece el banner de conflicto que ya existe (`editor-shell.tsx:2481-2506`) en lugar de recargar.

**Puerta de cierre de la app** (desktop):
- `useTauriCloseGuard` pasa de la shell a `DesktopAppShell` (`components/navigation/desktop-app-shell.tsx`), que envuelve todas las rutas `(app)` en desktop (`app/(app)/layout.tsx:14-18`).
- La shell montada registra en la puerta su vaciado y su `settle`.
- La puerta vacía, hace `settle`, reintenta todas las copias y solo llama a `destroy()` si no queda nada sin confirmar o si el usuario eligió descartar.
- Cmd+Q pasa por la misma puerta (decisión D2).

En web, el mismo almacén activa `beforeunload` **solo mientras haya copias**.

**Tiempo de espera.** `settle` no tiene límite (`persistence-coordinator.ts:893-924`) **[V]**. El límite lo pone la salida: si a los **10 s** la escritura del saliente sigue en vuelo, aparece el aviso con razón de tiempo. El coordinador no cambia su máquina de estados.

### 2.6 Qué ve el usuario (chrome en inglés, literal)

**Aviso en la shell.** Mismo hueco, tipografía y tono que `relocate-failed` (`editor-shell.tsx:2452-2477`), con botones como los del banner de conflicto (`:2481-2506`). Es `role="alertdialog"` no modal, con el foco en la primera acción. Escape cierra el aviso sin cambiar de pestaña y sin cerrar. Nombra el documento y la razón:

| Salida | Texto | Acciones (la 1.ª lleva el foco) |
|---|---|---|
| Cambiar de pestaña | **Couldn't save “{title}”.** {reason} If you switch, your changes stay in this tab until they're saved. | `Retry save` · `Switch anyway` |
| Cerrar la pestaña | **Couldn't save “{title}”.** {reason} Closing the tab would discard your changes. | `Retry save` · `Close without saving` |
| Cerrar otras o todas | **Couldn't save {n} artifacts:** “{title}”, … They stay open. | `Retry save` · `Close without saving` |
| Razón `CONFLICT` | {reason} = "It changed outside Artifact Studio." | `Stay` (en lugar de `Retry save`, que volvería a fallar) · la segunda acción de su salida |
| Escritura en vuelo más de 10 s | {reason} = "Saving is taking longer than usual." | `Keep waiting` · la segunda acción de su salida |

Razones (`{reason}`):
- `STORAGE_ERROR`, `DB_ERROR`, `UNAVAILABLE` o desconocido: "The file couldn't be written."
- Fallo después del `.md`: "Artifact Studio couldn't finish saving it."
- `NOT_FOUND`: "Its file is no longer where Artifact Studio expected it."

El mensaje técnico va en `title` y en el `console.error` que ya existe (`useEditorPersistence.ts:379-389`).

**Diálogo de la app** (desktop, cerrar ventana o salir, desde cualquier ruta; decisiones D1 y D2):
- título: **Some changes couldn't be saved**;
- cuerpo: la lista de títulos con su razón y "Quitting now would discard them.";
- acciones: `Retry save` (foco) · `Quit without saving` · `Cancel` (Escape);
- una entrada con razón `CONFLICT` dice "It changed outside Artifact Studio. Choose a version in the artifact first." `Retry save` no la reintenta (volvería a fallar); `Cancel` devuelve al documento, donde el banner de conflicto decide (M20), y `Quit without saving` la descarta como a las demás.

**Sin aviso:**
- el caso normal;
- las salidas que no esperan;
- volver a un documento con copia: la barra dice "Needs attention" y la pestaña lleva el punto rojo (`components/editor/editor-tab-item.tsx:177-181`).

---

## 3. Contrato de comportamiento

### 3.1 Decisiones de Hugo (literales)

Comentario "Decisiones (Hugo, 2026-10-07)" de ODE-692:

> **D — Cambiar igualmente.** "Switch anyway" guarda un snapshot volátil etiquetado por writingId en el owner de persistencia mientras la app esté abierta; al volver a A el texto sigue ahí en estado de error. Sin persistencia durable ni draft de fallback; el cierre de la app sigue el exit/error gate existente.
>
> Además quedan aceptados los "Default propuesto" de la sección `## Auditoría (2026-10-07)` de este issue; BUILD los aplica tal cual.

"Default propuesto" de la Auditoría (2026-10-07), aceptado por esa decisión:

> Switch anyway guarda snapshot volátil etiquetado por writingId en el PersistenceCoordinator hasta retry exitoso; cerrar la app mientras sigue fallido mantiene el exit/error gate existente, no promete recuperación durable.

Requisitos de ODE-692 (descripción):

> 1. Si la escritura saliente falla al cambiar de pestaña, el usuario ve un aviso que nombra el documento y el motivo (no se pudo guardar), con dos salidas explícitas: reintentar o cambiar igualmente (el contenido no guardado permanece recuperable en la pestaña de origen y su estado de error se mantiene).
> 2. La pestaña de origen muestra `error` (no `saving`) en cuanto falla la escritura.
> 3. Reintentar con éxito activa la pestaña pedida; cambiar igualmente la activa sin perder el contenido no guardado del origen (al volver, sigue en el editor y en error hasta guardar).
> 4. Si no hay fallo, el comportamiento actual no cambia: la activación espera la durabilidad y no muestra aviso.

Visual / UX Contract de ODE-692 (descripción):

> Criterio de paridad: misma ubicación, tipografía y tono que esos avisos; nombra el documento; dos acciones con texto explícito ("Retry save", "Switch anyway").
> Comportamiento: foco en la primera acción; Escape cierra sin cambiar de pestaña.
> Fuera de alcance: rediseño del indicador de guardado.

Reglas vigentes del dueño (descripción de ODE-697, 2026-10-08):

> nunca perder texto; nunca guardar una versión alterada; cambiar de pestaña o navegar no interrumpe.

Guardrail (`AGENTS.md:76`): "`NOT_FOUND`, binding huérfano, hash ambiguo o falla de filesystem son resultados recuperables; nunca crean un draft ni otro estado durable como fallback."

### 3.2 Correcciones del Recon a las premisas de la decisión

1. **"En el PersistenceCoordinator … mientras la app esté abierta".** La instancia muere al desmontar `/write` (§2.1) **[V]**, así que la copia vive en el módulo de persistencia, fuera de la instancia. Es el mismo dueño (persistencia) con la vida que la decisión pide.
2. **"Switch anyway guarda un snapshot".** Cuando el usuario pulsa, el coordinador ya no tiene los bytes: la petición fallida salió del mapa antes de empezar y no se reencola (`persistence-coordinator.ts:729-740, 767, 848`) **[V]**. La copia se toma **al fallar**, y "Switch anyway" se limita a activar B. De paso quedan cubiertas las salidas que no pasan por el aviso (abrir, New Artifact, desmontar).
3. **"El exit/error gate existente".** No existe una puerta que se detenga ante un fallo:
   - `settleBeforeClose` descarta el booleano de `settle` (`editor-shell.tsx:2290-2294`) y la guarda llama a `destroy()` igual (`useTauriCloseGuard.ts:45-46`) **[V]**;
   - solo existe dentro de `/write` (`editor-shell.tsx:2295`) **[V]**;
   - Cmd+Q no la alcanza (§2.4) **[V en dependencias, I en ejecución]**.

   Qué hace la puerta ante texto sin guardar es una decisión nueva: D1 y D2 (§9).
4. **Requisito 2.** Ya se cumple cuando el fallo ocurre durante la espera: `onError` pone `error` después del `saving` de `useWorkspaceTabs.ts:118` (`useEditorPersistence.ts:352, 359`) **[I]**. Se conserva y se prueba en la ruta de la pestaña.
5. **Casos que el brief no listaba y que hoy pierden texto o bloquean la salida [I]:**
   - el fallo ocurrido **antes** del clic;
   - volver a pulsar la pestaña activa;
   - abrir otro documento, New Artifact o desmontar con fallo posterior;
   - Cmd+Q;
   - el reintento tras un fallo posterior al `.md`, que siempre choca con un CONFLICT falso.

### 3.3 Invariantes

- **I1. Ningún fallo se lleva el texto.** Desde que una petición falla, hasta un commit durable más nuevo o un descarte explícito del usuario, sus bytes existen en el editor o en la copia, en cualquier ruta y tras cualquier salida, salvo que muera el proceso.
- **I2. El caso normal no cambia.** Sin fallo, ninguna salida muestra un aviso ni espera más que hoy (requisito 4).
- **I3. Solo el usuario descarta.** "Close without saving", "Quit without saving" y "Reload external" son los únicos descartes. La siembra WATCH-07, la hidratación y el desmontaje nunca descartan.
- **I4. La hidratación no pisa lo no confirmado.** Hidratar un documento con texto sin confirmar aplica el snapshot más nuevo, nunca el disco (STATE-08).
- **I5. Reintentar escribe exactamente la copia.** El reintento escribe la copia retenida, nunca una versión regenerada ni canonicalizada de nuevo (regla "nunca guardar una versión alterada"). La guarda WATCH-07 se mantiene: la línea base es la de la copia o la que avanzó un `.md` ya escrito.
- **I6. Sin estado durable de rescate.** No se crea draft, UUID ni archivo para la copia (`AGENTS.md:76`).
- **I7. Una sola puerta de salida de la app**, para la ventana, Cmd+Q y web; un solo dueño de la decisión de activar pestaña (`hooks/useWorkspaceTabs.ts`), y la shell solo presenta.

---

## 4. Matriz de salidas y fallos

Definiciones:
- "Hoy" = rama de fase en `96d1f105` (con ODE-697 la fila es igual en Source, porque el texto de Source entra al coordinador por la misma ruta).
- "¿Texto?" = qué pasa con lo no guardado de A.
- "¿Identidad?" = UUID y ruta.

Las pruebas T1–T19 están en §7. Un límite lleva su razón.

| # | Salida y momento del fallo | Hoy | Propuesto | ¿Texto? | ¿Identidad? | Prueba o límite |
|---|---|---|---|---|---|---|
| M1 | Cambiar de pestaña, la escritura de A **funciona** | Espera `settle` y activa B (`useWorkspaceTabs.ts:116-132`) **[V]** | Igual, sin aviso | Durable antes de activar B | Igual | Existente `tests/editor-shell-exit-protocol.test.tsx:385-422` sin cambiar sus aserciones + T1 (control: sin aviso) |
| M2 | Igual, en web | Igual (bloque DOC-05 web, `:474-564`) **[V]** | Igual | Durable | Igual | Existente, sin cambios |
| M3 | Cambiar de pestaña, la escritura **falla durante la espera** | `if (!settled) return` (`:121`): clic descartado sin explicación; pestaña y barra en `error` por `onError` **[V]** | Aviso de cambio con la razón; A sigue activo; Escape cierra el aviso sin cambiar | En el editor y en la copia | Igual; B no se activa sin elección | T2 |
| M4 | M3 → `Retry save` funciona | No existe | Escribe la copia; activa la **última** pestaña pedida | Durable | Igual | T3 |
| M5 | M3 → `Retry save` vuelve a fallar | No existe | El aviso sigue, con la razón nueva; la copia se actualiza | Copia | Igual | T3 |
| M6 | M3 → `Switch anyway` | No existe | Activa B; A conserva la copia y su pestaña en `error`; al volver, el texto y "Needs attention" | Copia, y en el editor al volver | Igual | T4 |
| M7 | Cambiar de pestaña cuando la escritura de A **ya había fallado** (nada pendiente) | No espera (`hasPending` falso); B se hidrata sobre la única copia de A. Al volver: contenido del disco, la siembra descarta el marcador (`useExternalDocumentChanges.ts:200-206`) y la barra toma el estado durable (`useDocumentHydration.ts:583-589`) **[I]** | Reintenta la copia sin interfaz; si funciona, cambia; si no, M3 | Durable, o copia con aviso | Igual | T5 (`it.fails` primero) |
| M8 | Segundo clic (C) con el aviso abierto | El contador de petición ya supera a la anterior (`:102, 123`) **[V]**; no hay aviso | El aviso sigue hablando de A y el destino pasa a C; `Retry save` o `Switch anyway` activan C | Igual que M3 | Igual | T6 |
| M9 | Volver a pulsar la pestaña activa con escritura pendiente o fallida | Reactiva A con una hidratación nueva desde el disco (`:101, 136-142`; `useDocumentHydration.ts:512`), que reemplaza el texto más nuevo del editor **[I]** | La hidratación aplica el snapshot sin confirmar más nuevo (I4) | Se conserva | Igual | T7 (`it.fails` primero) |
| M10 | La escritura de A **no termina** | `settle` no tiene límite (`persistence-coordinator.ts:893-924`): el clic no responde nunca **[V]** | A los 10 s, aviso "taking longer" con `Keep waiting` · `Switch anyway`; `Switch anyway` llama a `retainUnconfirmed`; el resultado tardío borra o actualiza la copia | Copia, y durable si termina | Igual | T8 (`holdWriteFile` + reloj falso) |
| M11 | Borrador sin materializar cuya materialización **falla** | El cambio no espera a borradores (`:116` exige `writingId`); el contenido queda en `draftContentSnapshotRef` (un hueco, vida de la shell) y vuelve al regresar (`useDocumentExit.ts:117-125`; `useDocumentHydration.ts:282-289`) **[V]** | Igual, más la copia con clave `draftWritingId`, que sobrevive al desmontaje; la restauración la usa si el hueco de la shell no es de ese borrador | Copia | Sin UUID ni archivo (I6) | T9 |
| M12 | Cerrar la pestaña A, la escritura **falla** durante la espera | `return` (`:183-185`): la pestaña no se cierra y no dice por qué **[V]** | Aviso de cierre: `Retry save` · `Close without saving` (D1); Escape cancela el cierre | Copia hasta la elección; solo se pierde con el descarte | Igual | T10 |
| M13 | Cerrar una pestaña de fondo cuyo documento tiene copia (tras M6) | Hoy no existe la copia; se cerraría sin espera (`:180`) **[V]** | El mismo aviso, con el nombre de ese documento | Igual que M12 | Igual | T10 |
| M14 | Cerrar otras o todas, con un documento que falla | La pestaña que falla queda abierta en silencio y el bucle sigue (`:242-259`) **[V]** | Cierra las que pueden cerrarse; las otras quedan abiertas y un único aviso las lista | Copias | Igual | T10 (variante) |
| M15 | Abrir otro documento (Search, Recent, árbol, menú) y la escritura de A falla **después** | No espera (`useWorkspaceTabOpening.ts:181-189`; `editor-shell.tsx:2125-2151`); el fallo marca la pestaña de A, pero el texto se pierde **[I]** | Sin espera ni aviso (I2); copia; punto rojo en A; al volver, M19 | Copia | Igual | T11 |
| M16 | New Artifact (desktop y web) con fallo posterior | Igual que M15 (`useWorkspaceTabOpening.ts:94-108, 134-136`) **[I]**; con ODE-697, `activateDocument` también vacía en web | Igual que M15 | Copia | Sin documento extra | T11 (variante) |
| M17 | Ir a otra sección (desmontar `/write`) con fallo posterior | Vacía y `dispose` (`useEditorPersistence.ts:408-419`); el fallo marca la pestaña y el texto muere con el editor **[I]** | La copia sobrevive en el módulo; al volver a `/write` y activar A, M19 | Copia | Igual | T12 |
| M18 | Volver a `/write` mientras sigue en vuelo una escritura de la shell anterior | Dos coordinadores pueden escribir A a la vez (previo) **[I]** | La secuencia global impide que un fallo más viejo reviva una copia superada por un commit más nuevo | Lo más nuevo gana | Igual | T12 (variante con `holdWriteFile` a través del desmontaje) |
| M19 | Volver a A con copia (tras M6, M15, M16 o M17) | No existe; se ve el disco **[I]** | La hidratación aplica la copia (Rich: `bodyJson`; Source: los bytes, ODE-697); `error` en barra y pestaña; línea base de la copia; marcador conservado | En el editor | Igual | T4, T11, T12 |
| M20 | M19 con el disco cambiado por fuera mientras tanto | No existe | Banner de conflicto existente (Keep my version / Reload external); nunca recarga ni sobrescribe sin elección | El que elija el usuario | Igual | T13 |
| M21 | Copia tomada en un modo y restaurada en el otro | No existe | Se restaura en su forma y la vista se regenera sin persistir (reglas de ODE-697; si Rich no se puede regenerar, Source con "Try again") | Bytes de la copia | Igual | T14 |
| M22 | Falla el manifest o SQLite **después** de escribir el `.md`, y luego "Retry save" | El `.md` ya tiene los bytes (`tests/integration/documents/component-save-faults.test.ts:302-331`) **[V]**, pero la línea base no avanza (`persistence-coordinator.ts:707`) y el reintento choca con sus propios bytes (`document.rs:124-136`; doble fiel `tests/integration/documents/support/real-desktop-doubles.ts:537-547`) **[I]** | `contentWritten` + `contentHash` → la línea base avanza; el reintento rehace la proyección | Durable al reintentar | Igual; un solo `.md` | T15 (`it.fails` primero) |
| M23 | Fallo por `CONFLICT` (cambio externo) en una salida | Como M3/M7; ningún banner nace del lado de la escritura (`useEditorPersistence.ts:364-375` solo trata `keptPath`/`preservationFailed`) **[V]** | Aviso con razón de conflicto: `Stay` · `Switch anyway` / `Close without saving`; la copia guarda la línea base y al volver, M20 | Copia | Igual | T13 |
| M24 | Cambiar de pestaña, abrir, New Artifact o desmontar con ediciones bloqueadas por un banner de conflicto sin resolver | El autosave devuelve `false` antes de encolar (`useEditorPersistence.ts:434-436`), no hay nada pendiente y la salida pierde lo editado **[I]** | La salida entrega el snapshot con `retainUnconfirmed(…, CONFLICT)` y sigue como M23 (o como M15–M17 en las salidas que no esperan) | Copia | Igual | T13 (variante) |
| M24b | **Cerrar la ventana o salir con un conflicto WATCH-07 sin resolver**, en Rich o en Source (límite M29 de D697, delegado aquí por la revisión factual de #657) | Nada pendiente: `settleBeforeClose` vacía, el guardado se corta antes de encolar (`useEditorPersistence.ts:434-436`), `settle()` devuelve `true` sin mirar nada más (`editor-shell.tsx:2290-2294`) y `destroy()` cierra (`useTauriCloseGuard.ts:45-46`) **[V]**; lo editado se pierde **[I]** | El vaciado que la shell registra en la puerta entrega el snapshot como copia `CONFLICT`; la puerta no destruye y el diálogo lo lista con la razón de conflicto: `Cancel` vuelve al documento con el banner (Keep my version / Reload external); `Quit without saving` lo descarta (D1) | Copia hasta la elección | Igual | T16 (variante de conflicto) |
| M25 | `NOT_FOUND`: el documento perdió su binding o el archivo se borró por fuera | Falla; Save As tampoco rescata, porque primero guarda en la ruta canónica (`editor-shell.tsx:2193-2203`) **[V]** | Aviso con `Retry save`, que funciona si el archivo vuelve, más la segunda acción de la salida; la copia sobrevive | Copia | Igual | T2 (variante). **Límite:** no hay "guardar una copia en otra ubicación"; se anota como seguimiento (§8.4) |
| M26 | Cerrar la ventana (semáforo o Cmd+W) y la escritura falla en la puerta | `settleBeforeClose` ignora el resultado y `destroy()` corre igual (`editor-shell.tsx:2290-2294`; `useTauriCloseGuard.ts:45-46`) **[V]**; texto perdido **[I]** | Puerta en `DesktopAppShell`; con algo sin confirmar, la ventana sigue abierta y aparece el diálogo de la app (D1) | Copia hasta la elección | Igual | T16 |
| M27 | Cerrar la ventana con una copia anterior (nada pendiente) | `settle()` devuelve `true` → se cierra **[I]** | La puerta reintenta las copias; si no puede, diálogo | Igual que M26 | Igual | T16 |
| M28 | Cerrar la ventana fuera de `/write` (Desk, Studio…) | Sin guard **[V]** | La misma puerta, en todas las rutas | Igual que M26 | Igual | T16 (variante sin shell montada) |
| M29 | Salir con Cmd+Q o con "Quit Artifact Studio" | Sin guard: `terminate:` sin `CloseRequested` (§2.4); se pierde lo no confirmado y, también en el caso normal, lo que quedaba en las colas (hasta 150 ms + 4 s) **[I, NV en el DMG]** | Ítem Quit propio, mismo texto y atajo, que pasa por la puerta y termina con `exit` (D2) | Durable o diálogo | Igual | T17 + comprobación del dueño en el DMG |
| M30 | Quit desde el Dock, cierre de sesión o apagado | `terminate:` sin gancho en tao 0.35.3 **[V en dependencias]** | Igual | Se pierde lo que estaba en memoria | — | **Límite:** sin `applicationShouldTerminate:` no hay dónde engancharse; es de la clase del crash |
| M31 | Doble petición de cierre mientras la puerta trabaja | `if (closing) return` va antes de `preventDefault` (`useTauriCloseGuard.ts:39-42`) **[V]**; ODE-697 lo corrige (su T15) | Una sola puerta y un solo diálogo; la segunda petición se previene y no destruye | Igual que M26 | Igual | T16 (variante) |
| M32 | Web: cerrar o recargar la pestaña del navegador con copias | Sin `beforeunload` **[V]**; se pierde **[I]** | `beforeunload` solo mientras haya copias (aviso genérico del navegador) | Copia hasta la elección | Igual | T18 |
| M33 | Crash o reinicio con copias | Se pierde la memoria del proceso | Igual | Se pierde | — | **Límite** aceptado por la decisión D ("sin persistencia durable"); hasta 150 ms + 4 s en el caso normal (`useEditorPersistence.ts:55, 61`) |
| M34 | Escritura fallida sin salir (A sigue activo) | "Needs attention" en barra y pestaña; reintenta la siguiente edición (`tests/editor-shell-durable-save-state.test.tsx:580-629`) **[V]** | Igual, más la copia; sin aviso (el indicador queda fuera de alcance) | Editor y copia | Igual | Existente + T19 (la copia nace y se borra con el commit siguiente) |

**Comprobación de la garantía:**
- Toda petición fallida deja una copia (I1).
- Toda salida que espera la reintenta y, si sigue fallando, se detiene.
- Toda salida que no espera deja la copia viva en el módulo.
- Toda hidratación la aplica (I4).
- Toda salida de la app pasa por la puerta, salvo M30.

Las únicas pérdidas posibles son:
- el descarte explícito (M12, M14, M24b, M26-M29, por D1);
- la muerte del proceso (M30, M33).

---

## 5. Funciones y archivos a tocar

| Archivo | Cambio |
|---|---|
| `lib/editor/unsaved-copies.ts` (nuevo) | Almacén de copias por proceso: `retain`, `get`, `list`, `clearUpTo(key, sequence)`, `discard(writingId \| draftWritingId)`, `subscribe`; contador de secuencia global; fábrica para tests. Sin I/O |
| `lib/editor/persistence-coordinator.ts` | Dependencia `unsavedCopies`; guardar la copia en los tres `catch` (`:633-644, 729-740, 796-807`); borrarla en `clearUnconfirmedContentForCommit` (`:357-362`); `hasUnconfirmedContent` que incluye copias; `retry(target?)`; `retainUnconfirmed(target, reason)`; avanzar la línea base con `details.contentWritten`; trasladar la copia en `rebindMaterializedDraftRequests` (`:383-448`). Sin cambios en `persist`, `pump`, el debounce ni la generación |
| `lib/services/document-service-factory.ts` | `persist`: los fallos posteriores al `.md` (`:283-377`) llevan `details: { contentWritten: true, contentHash }` |
| `hooks/useEditorPersistence.ts` | Inyectar el almacén; exponer `retry`; registrar en la puerta de la app el vaciado de la shell (en lugar de `settleBeforeClose`) |
| `hooks/useWorkspaceTabs.ts` | Dueño de la decisión: cambiar y cerrar devuelven un resultado observable (`activated` / `blocked`, con documento, razón y destino) en lugar del `return` silencioso; reintento automático de la copia del saliente; `Retry save`, `Switch anyway`, `Close without saving`; lote con un solo aviso; tiempo de espera de 10 s |
| `components/editor/editor-shell.tsx` | Solo cablea: pinta el aviso en el hueco de `externalFileNotice` (foco y Escape); quita `useTauriCloseGuard(settleBeforeClose)` (`:2290-2295`); en una salida con el conflicto abierto, y en el vaciado que registra en la puerta de la app, entrega el snapshot como copia `CONFLICT` (M24, M24b) |
| `hooks/useDocumentHydration.ts` | Aplicar el snapshot sin confirmar más nuevo después de cargar (`:512-525`) y antes de fijar el estado (`:583-589`): `error` si hay copia; borrador desde la copia (`:282-289`) |
| `hooks/useExternalDocumentChanges.ts` | La siembra (`:200-206`) toma la línea base de la copia y no la descarta; el disco distinto de la línea base levanta el banner existente (M20); "Reload external" descarta la copia |
| `hooks/useTauriCloseGuard.ts` | La puerta decide: `destroy()` solo si queda todo confirmado o el usuario descartó. Con el `preventDefault` primero que trae ODE-697 |
| `components/navigation/desktop-app-shell.tsx` | Monta la puerta y el diálogo de la app (todas las rutas) |
| Web: un componente cliente montado en el layout web de `(app)` (`app/(app)/layout.tsx`, `renderWebAppLayout`) | `beforeunload` solo con copias (M32) |
| `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `hooks/useTauriMenuEvents.ts` | **Solo si se aprueba D2.** Ítem Quit propio (`MenuItem::with_id(app, "quit", "Quit Artifact Studio", true, Some("CmdOrCtrl+Q"))`) en lugar de `.quit()` (`:83`); el evento de menú llega a la puerta; `exit(0)` de `@tauri-apps/plugin-process` (ya instalado: `package.json:61`; `src-tauri/src/lib.rs:52`); permiso `process:allow-exit` (hoy solo `process:allow-restart`, `default.json:20`) |
| Tests | §7 |
| `workflow/quality/capability-integration-map.md` | §8.3 |

**No se toca:**
- `write_file`, el hash, el manifest y el esquema de SQLite y de Supabase. Rust solo cambia si se aprueba D2, y únicamente en el menú.
- La máquina de estados del coordinador (debounce de 4 s, `pump`, generación, `settle`).
- La ruta de guardado de Source (ODE-697), el relocate (ODE-698), la reparación de componentes (ODE-694) y la señal de layout (ODE-540 reducido).
- La política de esperar la durabilidad al cambiar de pestaña: no se convierte en un cambio automático.
- La decisión de activar pestaña: no se mueve a la shell.
- No se crea draft, UUID ni archivo de rescate (`AGENTS.md:76`).
- Abrir y New Artifact no ganan una espera nueva (requisito 4).
- El indicador de guardado: fuera de alcance (Visual / UX Contract).

---

## 6. Verificaciones abiertas del reanálisis y del Recon

### 6.1 Resueltas

1. **¿`settleBeforeClose` mira el resultado de `settle`?** No **[V]**: `await persistenceCoordinator.settle()` descarta el booleano (`editor-shell.tsx:2290-2294`) y la guarda llama a `destroy()` en cuanto la promesa resuelve (`useTauriCloseGuard.ts:45-46`). Hay además tres huecos que el reanálisis no nombraba:
   - una escritura que ya había fallado no está pendiente, así que `settle()` devuelve `true` (M27);
   - fuera de `/write` no hay guard (M28) **[V]**;
   - Cmd+Q no emite `CloseRequested` (M29) **[V en dependencias]**.
2. **"Al cerrar ventana o desmontar se pierde lo no escrito" (reanálisis §4, era [I]).** Mecanismo verificado **[V]**: sin copia, sin guard que mire el resultado, y `dispose` silencia `emit` (`persistence-coordinator.ts:501, 1014-1019`). La pérdida queda como **[I]** (sin ejecutar), cubierta por T12 y T16.
3. **Recon Pack, "hasUnconfirmedContent solo da marcador".** Confirmado (`:255-259`) **[V]**. Además, su único lector es WATCH-07 y la siembra lo descarta en cada activación (`useExternalDocumentChanges.ts:200-206`) **[V]**.
4. **Recon Pack, "useDocumentExit conserva snapshot solo para draft efímero".** Confirmado (`useDocumentExit.ts:117-125`) **[V]**.
5. **Recon Pack, "Switch anyway requiere preservar la única copia antes de hidratar B" (era inferencia).** Precisado: cuando el usuario pulsa, la copia ya no existe en el coordinador (§3.2, punto 2) **[V]**. Por eso se toma al fallar.
6. **Requisito 2 ya se cumple en la ruta de espera** **[I]** (§3.2, punto 4). Se prueba en T2.
7. **Límites delegados a ODE-692 por D697** (M15 cerrar ventana, M19 escritura fallida, M29 conflicto sin resolver) **y por D698** (R-5 CONFLICT falso tras proyección fallida; escrituras con el volumen ausente). Quedan en M26, M3–M7, M24 y M24b, M22 y M25.
8. **Tiempo de espera de `settle` (modo de fallo del brief).** El coordinador no tiene ninguno **[V]**. Se declara 10 s en la salida (M10).
9. **Alcance añadido por el coordinador (revisión factual de D697, #657): cerrar la ventana o salir con un conflicto WATCH-07 sin resolver (M29 de D697).** Verificado **[V]**: el guardado se corta antes de encolar (`useEditorPersistence.ts:434-436`), así que `settle()` no tiene nada que esperar y devuelve `true`, y `settleBeforeClose` tampoco miraría un `false` (`editor-shell.tsx:2290-2294`). Queda cubierto en M24b con la variante de conflicto de T16; D697 lo referencia como cerrado por ODE-692.

### 6.2 Marcadas para BUILD

- **[I] M7, M9, M15–M17 y M24 pierden texto hoy, y M22 bloquea el reintento.** Cada uno se escribe primero como `it.fails` en su propio commit (regla B9), con el control positivo de que la escritura falló de verdad.
- **[I/NV] M29 en ejecución.** El código de tao 0.35.3 muestra que no hay `applicationShouldTerminate:`, pero la ruta completa de AppKit solo se puede ver en el DMG. Tarea del dueño: con D2 aprobada, escribir, pulsar Cmd+Q antes de 4 s y reabrir el documento; sin D2, documentar el resultado.
- **[I] Dos coordinadores a la vez (M18).** La escritura de la shell desmontada sigue viva mientras la nueva arranca. La secuencia global de copias lo hace seguro para las copias; la carrera de escrituras es previa y no se toca.
- **[NV] `beforeunload` en WKWebView** no aplica (desktop usa la puerta). En web, los navegadores ignoran el texto propio y muestran su aviso genérico.
- **[I] Copia de borrador frente a `draftContentSnapshotRef`.** En la salida, los dos contienen el último texto entregado (el vaciado va antes del snapshot, `useDocumentExit.ts:204-210`). Restaurar desde la copia solo cuando el hueco no es de ese borrador evita dos fuentes compitiendo.
- **Driver de tests.** `clickEditorTab` exige que la activación ocurra en 10 s (`tests/support/editor-shell-harness.tsx:883-902`), así que no sirve para los casos con aviso: esos usan `pointerClick` sobre la pestaña y comprueban el aviso.

---

## 7. Plan de pruebas y mutaciones

Se aplican las reglas de `workflow/quality/capability-proof-contract.md`:
- entrada de producción: shell real (`tests/support/editor-shell-harness.tsx`), gesto real sobre la pestaña (`pointerClick`), botón real de cerrar y `onCloseRequested` con el doble fiel al wrapper (`node_modules/@tauri-apps/api/window.js:1632-1641`: `await handler(evt); if (!evt.isPreventDefault()) destroy()`);
- fallo real en la frontera: `failNextWriteFile`, `failNextDualWrite`, `holdWriteFile` (`tests/integration/documents/support/real-desktop-doubles.ts:405-430, 964-967`);
- coordinador, servicios y almacén reales;
- aserción después del evento de completitud (aviso visible, pestaña activa, bytes del `.md`, fila de IndexedDB).

Archivo nuevo `tests/editor-shell-failed-write-exit.test.tsx` (bloques desktop y web). Se amplían `tests/editor-shell-exit-protocol.test.tsx` (solo el control T1), `tests/tauri-close-guard.test.tsx`, `tests/integration/documents/component-save-faults.test.ts` y `tests/editor-persistence-coordinator.test.ts`.

| Prueba | Escenario y completion event | Mutación que debe ponerla roja |
|---|---|---|
| T1 | Control del caso normal: cambio con escritura que funciona; sin aviso; activa B tras el `.md`. Lo mismo con abrir, New Artifact y cerrar | Mostrar el aviso siempre, o esperar en abrir → rojo |
| T2 | `failNextWriteFile` sobre A, escribir, pulsar B: aviso con el título de A y la razón; A sigue activo con su texto; pestaña y barra en `error` (no `saving`); foco en `Retry save`; Escape cierra sin cambiar. Variante `NOT_FOUND` | Volver al `return` silencioso → rojo (sin aviso ni salida) |
| T3 | Desde T2: `Retry save` con el disco sano → el `.md` tiene el texto y se activa B; con un segundo fallo → el aviso sigue | `Retry save` que activa sin escribir, o que no activa la última pedida → rojo |
| T4 | Desde T2: `Switch anyway` → B activo; volver a A → el editor tiene la edición fallida y la barra dice "Needs attention"; el `.md` de A no la tiene (control positivo) | No guardar la copia al fallar → rojo. La siembra la descarta (`useExternalDocumentChanges.ts:203`) → rojo |
| T5 | Fallo en el autosave **antes** del clic; luego pulsar B con el disco sano → cambia sin aviso y el `.md` tiene el texto; con el disco caído → aviso (`it.fails` primero) | Quitar el reintento automático de la salida → rojo |
| T6 | Aviso abierto y clic en C → `Retry save` activa C, no B | Ignorar el contador de petición → rojo |
| T7 | Escritura retenida (`holdWriteFile`) o fallida, y volver a pulsar la pestaña activa → el editor conserva el texto más nuevo (`it.fails` primero) | Hidratar sin mirar lo no confirmado → rojo |
| T8 | `holdWriteFile` sin soltar: a los 10 s (reloj falso), aviso "taking longer"; `Switch anyway` → B; soltar con fallo → A vuelve con la copia; soltar con éxito → sin copia | Quitar el límite → rojo (el test agota su tiempo). Quitar `retainUnconfirmed` → rojo |
| T9 | Desktop: borrador cuya materialización falla (`createDesktopDraftOverride`); salir de `/write` y volver → el borrador conserva su texto; no hay archivo ni UUID nuevos | Copia sin clave `draftWritingId` → rojo |
| T10 | Cerrar A con fallo → aviso de cierre; `Close without saving` cierra y descarta; Escape cancela. Variantes: pestaña de fondo con copia; "Close all" con un documento que falla → un solo aviso y las demás cerradas | Cerrar sin aviso (descartar la copia) → rojo |
| T11 | Abrir otro documento o New Artifact con `holdWriteFile` + fallo al soltar → sin aviso; punto rojo en A; volver a A → texto restaurado (`it.fails` primero) | No guardar la copia de las peticiones que no son `current` → rojo |
| T12 | Desmontar `/write` (navegación real) con fallo después de `dispose`; montar de nuevo y activar A → texto restaurado. Variante: escritura retenida que termina después de montar la shell nueva; un fallo más viejo no revive una copia superada (`it.fails` primero) | Copia en la instancia del coordinador → rojo. Borrar sin comparar la secuencia → rojo |
| T13 | Copia de A, cambio externo del `.md` (reconciliación `bulk`), volver a A → banner de conflicto, sin recarga ni escritura; "Keep my version" escribe la copia; "Reload external" la descarta. Variantes: `CONFLICT` en la salida (`Stay`) y salida con el banner abierto (M24) | Sembrar la línea base desde el catálogo → rojo (sobrescritura silenciosa) |
| T14 | Copia tomada en Source y restaurada con la pestaña en Rich, y al revés → los bytes de la copia; ninguna escritura al regenerar | Restaurar siempre como Rich → rojo |
| T15 | `failNextDualWrite`: el `.md` tiene los bytes; `Retry save` → éxito y una sola mutación nueva (`it.fails` primero) | Sin `contentWritten`, la línea base no avanza → rojo (CONFLICT falso) |
| T16 | Puerta de la app con el doble fiel: fallo en la puerta → `destroy` no se llama y aparece el diálogo; `Retry save` con éxito → `destroy` una vez; `Quit without saving` → `destroy`; copia anterior sin nada pendiente → diálogo; sin shell montada (en Desk) → el mismo diálogo; doble petición → un diálogo. Variante de conflicto (M24b), en Rich y en Source: reconciliación `bulk` que levanta el banner, editar, cerrar la ventana → `destroy` no se llama; el diálogo muestra la razón de conflicto; `Cancel` deja el banner y el texto en el editor; `Quit without saving` → `destroy` | `settleBeforeClose` sin mirar el resultado → rojo. Puerta solo dentro de la shell → rojo en la variante Desk. Vaciado de la puerta sin entregar la copia `CONFLICT` → rojo en la variante de conflicto |
| T17 | Evento de menú `quit` → vaciado, `settle` y reintento antes de `exit(0)`; con fallo, diálogo y sin `exit` | Llamar a `exit` sin pasar por la puerta → rojo |
| T18 | Web: con una copia, `beforeunload` llama a `preventDefault`; sin copias, no hay listener (control del caso normal) | Listener siempre activo → rojo en el control |
| T19 | Coordinador (unidad): la copia nace en los tres `catch`; un commit más nuevo la borra; uno más viejo no; secuencia entre instancias; traslado al materializar un borrador | Cada regla, invertida → rojo |

Los casos existentes que no cambian sus aserciones:
- `tests/editor-shell-exit-protocol.test.tsx`, todo el archivo (requisito 4);
- `tests/editor-shell-durable-save-state.test.tsx:580-629`;
- `tests/editor-shell-active-tab-ref-owner.test.tsx` (invariante del Architecture Contract original).

Suite completa: se tocan `tests/support/**` (driver de aviso) y `tests/integration/**/support/**`.

---

## 8. Riesgos y contratos que cambian

### 8.1 Contratos

- **ADR documento activo** (`workflow/context/core/odessay-adr-documento-activo.md:64, 105-107`):
  - la salida deja de ser "esperar y, si falla, nada": cambiar y cerrar tienen un resultado `blocked` con aviso;
  - la hidratación aplica lo no confirmado (I4).

  Es una enmienda que hay que anotar en el ADR.
- **ADR de identidad / guardrail** (`AGENTS.md:76`): no cambia. La copia es memoria del proceso y nunca durable.
- **Catálogo** (`workflow/context/features/odessay-desktop-document-catalog.md`): no cambia el orden de guardado. Solo cambia la forma del error de `persist` cuando el `.md` ya se escribió (`details.contentWritten`).
- **`PersistenceCoordinator`:**
  - nueva dependencia `unsavedCopies`;
  - nuevas operaciones `retry` y `retainUnconfirmed`;
  - `hasUnconfirmedContent` incluye copias.

  Su doc comment (`persistence-coordinator.ts:133-141`) se reescribe.
- **WATCH-07** (`lib/editor/external-change-policy.ts`): la política no cambia. Cambian dos cosas del lado de la shell: la siembra respeta la copia, y un hash distinto de la línea base de la copia al volver se trata como cambio externo.
- **Menú nativo** (solo con D2): Quit pasa a ser un ítem propio, con el mismo texto y atajo, y se añade el permiso `process:allow-exit`.

### 8.2 Riesgos

- **Restaurar sobre un documento que cambió.** Lo cubre M20: el banner existente decide, nunca la restauración.
- **Copias que se acumulan.** Una por documento (la última gana), solo para documentos cuyo guardado falló. La memoria es el texto del usuario, que es justo lo que se quiere conservar.
- **Arista blanda con N693r** (`lib/services/desktop/menu-event-bus.ts`) si D2 añade el evento `quit`: un PR detrás del otro.
- **Orden de BUILD:** ODE-697 primero (las copias de Source son Markdown), luego ODE-692. Se puede partir en dos PRs:
  - PR 1: almacén, coordinador, hidratación, siembra y avisos de cambio y cierre de pestaña;
  - PR 2: puerta de la app, Cmd+Q y `beforeunload`.
- **Volumen:** unos 10 archivos de producción. La matriz tiene una prueba por celda.

### 8.3 Capability map

- **DOC-05** (`workflow/quality/capability-integration-map.md:68`) y **STATE-01** (`:94`): ampliar la nota con la salida bloqueada y "Switch anyway".
- **STATE-08** (`:101`): la hidratación no pisa lo no confirmado (T7).
- **COMP-13** (`:77`): el reintento tras un fallo de proyección (T15).
- Filas nuevas, en el rango que asigne el coordinador:
  - "Failed write blocks tab switch with Retry / Switch anyway";
  - "Unsaved copy survives switch, open, new and leaving Write";
  - "Hydration restores unconfirmed content";
  - "App close and quit gate never discards silently";
  - "Retry after partial save does not raise a false conflict";
  - "Web unload guard only with unsaved copies".

### 8.4 Seguimientos (no se crean issues)

- **"Save a copy elsewhere"** para `NOT_FOUND` (M25): hoy Save As guarda primero en la ruta canónica y no puede rescatar.
- **Reintento automático en segundo plano** de las copias de documentos inactivos. Este diseño reintenta en cada salida que espera y en la puerta de la app.
- **Quit desde el Dock, cierre de sesión y apagado** (M30): requiere que tao implemente `applicationShouldTerminate:`.

---

## 9. Decisiones nuevas para Hugo

**D1. Qué pasa al cerrar la pestaña, cerrar la ventana o salir de la app con texto que no se pudo guardar.**
Tu decisión D dice que el cierre "sigue el exit/error gate existente". Pero hoy no hay una puerta que se detenga ante un fallo: la ventana se cierra igual y el texto se pierde (§3.2, punto 3).
- **Recomendada: A.** La salida se detiene y ofrece `Retry save` y un descarte explícito: `Close without saving` en la pestaña y `Quit without saving` en la ventana o la app. Es la única forma de perder ese texto, y solo por elección del usuario. En el caso normal no aparece nada.
- **B.** Se detiene sin opción de descarte. El riesgo: si el disco o el volumen no vuelven, la app no se puede cerrar sin forzarla.
- **C.** Como hoy: se cierra y se pierde. Contradice "nunca perder texto".

**D2. Cmd+Q pasa por la misma puerta.**
Hoy "Quit Artifact Studio" (Cmd+Q) cierra la app sin pasar por ninguna comprobación (§2.4). Pierde el texto retenido y, también sin ningún fallo, lo escrito en los últimos 4 s [I, a comprobar en el DMG].
- **Recomendada: sí.** Cambiar el ítem Quit del menú por uno propio, con el mismo nombre y atajo, que espere al guardado (y, con un fallo, muestre el diálogo de D1) antes de salir. Toca el menú nativo (Rust) y un permiso.
- **Alternativa:** dejarlo como hoy y documentar el límite. El Quit del Dock, el cierre de sesión y el apagado quedan como límite en ambos casos (M30).
