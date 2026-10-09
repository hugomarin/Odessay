# Source guarda Markdown directo; Rich es una vista regenerada (ODE-697)

Estado: **diseño propuesto, pendiente de aprobación de Hugo (gate GD-697)**. Sin código de producción ni tests en este PR.

Verificado en `codex/ode-528-539-document-components@96d1f105` (2026-10-09). El reanálisis de partida (`/private/tmp/claude-501/mut/ode540-reanalysis.md`) se hizo sobre `286776a9`; entre los dos commits solo cambió `workflow/quality/capability-integration-map.md` (`git diff --stat 286776a9..96d1f105`), así que sus citas de código siguen vigentes. Este documento las vuelve a comprobar una por una y no las copia.

Etiquetas: **[V]** verificado leyendo el código en `96d1f105`; **[I]** inferencia a partir del flujo de control, sin ejecutar; **[NV]** no verificado. No se ejecutaron tests ni sondas.

Entradas, por precedencia: decisiones de Hugo en la descripción de ODE-697 (2026-10-08); requisitos de ODE-697; reanálisis de ODE-540; comentario "Replanteo (Hugo, 2026-10-08)" de ODE-540, que deja superados los ajustes 1–3 de ODE-540.

---

## 1. Resumen de producto

1. En Source, lo que escribes se guarda tal cual. El `.md` queda con tus bytes y no pasa por Rich.
2. Rich pasa a ser una vista: se reconstruye al volver a Rich. Si no se puede reconstruir, sigues en Source con un aviso y "Try again", y tu texto ya está guardado.
3. Cambiar de pestaña, abrir otro documento, crear uno nuevo, navegar o cerrar guardan el texto de Source igual que el de Rich, sin diálogos nuevos.
4. En web, donde no hay archivo, se guarda el documento equivalente, y los componentes mal formados conservan sus bytes.
5. Se cierran de paso los caminos que hoy, estando en Source, guardarían una copia vieja de Rich (propiedades, renombrar, Save As, conflicto externo), y el cierre por doble clic.

---

## 2. Representaciones y flujo de escritura

### 2.1 Dónde vive cada representación

| Almacén | Runtime | Qué guarda | Quién lo escribe hoy |
|---|---|---|---|
| Editor TipTap (una sola instancia por shell) | ambos | ProseMirror JSON | 16 sitios de `setContent` (tabla 2.6.A) más los comandos Rich. En Source está montado y oculto: `invisible absolute`, `inert`, `aria-hidden` (`components/editor/editor-content.tsx:90-99`) **[V]** |
| Textarea de Source (`markdownValue`) | ambos | string | 9 llamadas a `setMarkdownValue` (`editor-shell.tsx:1264, 1492, 1511, 1539, 1600, 1682, 1732`; `useDocumentHydration.ts:619`; `useEditorCommands.ts:288`) **[V]**. Se pinta solo desde `markdownValue` (`editor-content.tsx:72-87`) **[V]** |
| `.md` | desktop | bytes UTF-8 | `FilesystemDocumentService.saveWriting` → `tauriWriteFile` (`lib/services/desktop/filesystem-document-service.ts:327-333`), con el Markdown que produce `DesktopDocumentService.serialize(record)`, que **siempre** serializa `content.richText` (`lib/services/document-service-factory.ts:177-183, 214-224`) **[V]** |
| Manifest `.odessay/index.json` y binding SQLite | desktop | ruta, inode, `content_hash` | `tauriWorkspaceTouchFile` / `tauriWorkspaceSync` después del `.md` (`document-service-factory.ts:288-302`); hash = blake3 de los bytes con CRLF/CR → LF (`src-tauri/src/commands/workspace.rs:960-988`) **[V]** |
| Catálogo SQLite y cola de sync | desktop | metadatos, `contentHash`, `contentUnchanged`; **sin cuerpo** | `commitDualWrite` (`document-service-factory.ts:334-380`) **[V]** |
| Nube desde desktop | desktop | `body_json`, `body_text`, `content_hash` | el flush vuelve a leer y parsear el `.md` (`lib/sync/desktop-catalog-sync-service.ts:478-487`); `content_hash` es el del binding (`:443`) **[V]** |
| IndexedDB `LocalWriting` | web | `body_json`, `body_text` | `webDocumentService.saveWriting` → `recordToLocalWriting`, que hace `body_json: richText ?? { type: "doc", content: [] }` (`lib/services/web-document-service.ts:54-61, 169-184`) **[V]** |
| Cola de sync y nube desde web | web | `body_json`; `content_hash = hash(serializeWritingToMarkdown(body_json))` | `toRemotePayload` (`lib/sync/queue.ts:23-43`, hash en `:28`) **[V]**. En la nube, un trigger recalcula `body_text` desde `body_json` (`supabase/migrations/20260317145743_initial_schema.sql:310-316, 467-470`) **[V]** |
| Márgenes | web | tabla `margins` | `PATCH /api/writings/[id]` → `syncMarginsOrConflict` (`app/api/writings/[id]/route.ts:61-66`, llamadas en `:161, 197, 212`). En desktop no hay proyección: grep vacío en sync y servicios desktop **[V]** |

### 2.2 Flujo actual en desktop, modo Source

1. `handleMarkdownChange` aplica `convertHtmlTablesToMarkdown`, escribe `markdownValue`, marca `hasUnconfirmedLocalEditRef` y programa el debounce de 800 ms (`editor-shell.tsx:1536-1554`; `useEditorPersistence.ts:49, 156-165`) **[V]**.
2. El `run` comprueba `modeRef.current === "markdown"` y, si no, **descarta** el guardado (`editor-shell.tsx:1555-1558`). Después llama a `desktopDocumentEngine.sourceToRich` y hace `setContent` en el Rich oculto. Si la conversión falla, cae a `materializeMarkdownForRichParser` (`:1560-1565`). Luego `setBodyText(editor.getText())` y `persistEditorSnapshot(editor)` (`:1569-1570`) **[V]**.
3. `persistEditorSnapshot` lee `getText()` y `getJSON()` del editor (`useEditorPersistence.ts:439, 457`) y arma un `PersistenceSnapshot` con `bodyJson` obligatorio (`lib/editor/persistence-coordinator.ts:32-55`) **[V]**.
4. El coordinador espera 4 s (`useEditorPersistence.ts:61, 225`) y construye el record con `richText: bodyJson, markdown: null, canonicalSource: "rich-text"` (`persistence-coordinator.ts:659-668`) **[V]**.
5. `serialize` vuelve a crear un editor temporal y serializa el JSON a Markdown **canónico** (`document-service-factory.ts:177-183`; `lib/editor/document-serialization.ts:134-147`) **[V]**. Resultado: el `.md` no contiene lo que escribiste, sino su forma canónica.
6. Orden posterior: `.md` → manifest → SQLite + cola → sync (`document-service-factory.ts:216-384`; `workflow/context/features/odessay-desktop-document-catalog.md:463-471`) **[V]**.

Hay **cuatro `run` más** con la misma forma, que usan `materializeMarkdownForRichParser` directamente, también en desktop: insertar enlace (`editor-shell.tsx:1610-1622`), tabla (`:1697-1708`), imagen (`:1740-1751`) y los comandos de formato en Source (`hooks/useEditorCommands.ts:286-316`) **[V]**.

### 2.3 Flujo propuesto en desktop, modo Source

1. Toda edición de Source (teclado, inserciones, comandos de formato, buscar y reemplazar) escribe el texto con un único dueño, `applyMarkdownValue`, que actualiza estado y ref en el mismo paso, como `applyEditorMode` (`editor-shell.tsx:573-576`). Después llama a un **único programador** del guardado de Source.
2. El `run` del programador no toca el editor. Llama a `persistMarkdownSnapshot(markdownValueRef.current)` en `useEditorPersistence`, hermana de `persistEditorSnapshot`. Esta función mantiene el guard de conflicto WATCH-07 (`useEditorPersistence.ts:434-436`), el título y la identidad que hoy (`:427-456`) y pone `hasUnconfirmedLocalEditRef = false` en el mismo tick que `persist()` (`:468`). El snapshot lleva `content: { kind: "markdown", markdown }` y `bodyIsEmpty = markdown.trim() === ""`. El `run` **no tiene guard de modo**: siempre persiste su texto.
3. El coordinador no cambia su máquina de estados (debounce, `settle`, `dispose`, WATCH-07). Solo construye `content = { markdown, richText: null, plainText, canonicalSource: "markdown" }` y, si el documento aún es borrador, pasa `initialMarkdown` a `createDesktopDraft`.
4. `DesktopDocumentService.serialize` devuelve `content.markdown` tal cual cuando `canonicalSource === "markdown"`; si no, hace lo de hoy. `createDraft` acepta `initialMarkdown`.
5. Desde el `.md`, nada cambia: el manifest hashea esos bytes, SQLite encola sin cuerpo y el flush parsea el `.md` para la nube.

### 2.4 Flujo web

**Hoy [V]:** el `run` hace `setContent(materializeMarkdownForRichParser(markdown))` sobre el editor visible y persiste Rich (`editor-shell.tsx:1561-1570`). `body_json` y `body_text` salen del editor y el título automático sale de `deriveAutoTitle(editor.getText())` (`useEditorPersistence.ts:439-449`; `editor-shell.tsx:271-288`).

**Propuesto:**
- `persistMarkdownSnapshot` deriva `{ bodyJson, bodyText }` **fuera del editor visible**, con un editor temporal sin montar (la forma de `parseMarkdownToSnapshot`, `document-serialization.ts:165-195`). La derivación usa `getText()` con el separador por defecto, como el camino Rich de hoy. `parseMarkdownToSnapshot` usa `"\n"` (`:189`); el separador importa porque `deriveAutoTitle` toma el texto completo e `isExplicitWritingTitle` compara título y texto al reabrir (`editor-shell.tsx:271-298`; `useDocumentHydration.ts:566-570`).
- El snapshot lleva `content: { kind: "markdown", markdown, bodyJson }`, y título y `bodyText` salen de la misma derivación. Si la derivación lanza, el snapshot va **sin** `bodyJson`: la petición se crea igual, y el adaptador web intenta derivar. Si vuelve a fallar, devuelve error y la petición termina en `failed` **dentro del coordinador** (`persistence-coordinator.ts:729-740`). Es el contrato del requisito 3.
- `webDocumentService.saveWriting` nunca escribe el documento vacío de `recordToLocalWriting` (`web-document-service.ts:59`) para un record con `canonicalSource: "markdown"` sin `richText`. Deriva o falla.
- Al volver a Rich, se regenera con el mismo `bodyJson` derivado y **sin persistir**: lo guardado y lo que muestra Rich son el mismo JSON.
- Al reabrir, Source muestra la serialización de `body_json` (decisión 2). Durante la sesión, el textarea conserva tus bytes.

### 2.5 Flujo propuesto: Rich como vista

- **Base de Rich.** La shell guarda en `richBaseRef` el par `{ markdown, doc }`: los bytes de Source con los que se construyó el documento Rich actual y ese `doc`. Se fija al hidratar (bytes del `.md` en desktop, serialización en web), al regenerar Rich desde Source, al recargar un cambio externo y al pasar de Rich a Source tras una edición Rich.
- **Rich → Source:** si `editor.state.doc.eq(richBase.doc)`, el textarea muestra `richBase.markdown`, es decir, los bytes. Si no, muestra `richToSource(editor)`. Hubo una edición Rich, así que ahí es legítimo canonicalizar (decisión 1).
- **Source → Rich:**
  1. Vacía (ejecuta) el guardado de Source pendiente. Hoy lo cancela (`editor-shell.tsx:1467-1470`).
  2. Si `markdownValue === richBase.markdown` y el `doc` sigue igual, no hace nada (COMP-60, `:1512-1515`).
  3. Si no, regenera con `sourceToRich` (desktop) o con la derivación web y aplica `setContent` con `isApplyingContentRef`, **sin persistir**. Hoy persiste en `:1531`.
  4. Si la regeneración falla, el modo **no cambia**: aviso en inglés con "Try again" (decisión 3).
- **Durante Source, Rich no se actualiza.** Las vistas que hoy leen el Rich oculto pasan al texto de Source (§2.7 y decisión D1).

### 2.6 Enumeración completa de escritores

**A. `editor.commands.setContent` en producción** (grep `commands\.setContent(` en `components`, `hooks`, `lib`, `app`) **[V]**

| # | Sitio | Cuándo | ODE-697 |
|---|---|---|---|
| 1-3 | `editor-shell.tsx:1521, 1524, 1527` | Toggle Source→Rich (desktop correcto, desktop con fallback, web) | Se queda: regenera **sin persistir**. Se elimina el fallback, porque un fallo deja el modo en Source |
| 4 | `editor-shell.tsx:1562` | `run` de `handleMarkdownChange` | Se elimina |
| 5 | `editor-shell.tsx:1617` | `run` de enlace en Source | Se elimina (pasa al programador único) |
| 6 | `editor-shell.tsx:1704` | `run` de tabla en Source | Se elimina |
| 7 | `editor-shell.tsx:1746` | `run` de imagen en Source | Se elimina |
| 8 | `hooks/useEditorCommands.ts:310` | `run` de comandos de formato en Source | Se elimina |
| 9 | `lib/editor/panel-sync.ts:35` (vía `applyMarkdownFromPanel`, `editor-shell.tsx:1273`) | Acciones de panel; en la práctica solo en Source | Se elimina en Source: el panel escribe `markdownValue` y guarda con la ruta Markdown |
| 10 | `hooks/useDocumentHydration.ts:289` | Llegada al borrador | Se queda; además restaura modo y textarea (fila M11) |
| 11-12 | `hooks/useDocumentHydration.ts:512, 523` | Hidratación | Se queda. En Source, el textarea recibe los bytes del `.md`. Por `materialize`, ver D2 |
| 13-14 | `hooks/useWorkspaceTabOpening.ts:108, 142` | New Artifact desktop/web | Se queda; además vacía el textarea (fila M10) |
| 15 | `hooks/useExternalDocumentChanges.ts:244` | Recarga externa limpia | Se queda; en Source también el textarea (fila M21) |
| 16 | `hooks/useExternalDocumentChanges.ts:319` | "Reload external version" | Igual que 15 |

Aparte, el editor **temporal** de `document-serialization.ts:178` no es el visible.

**B. Llamadas a `persistEditorSnapshot`** (grep en `components`, `hooks`) **[V]**

| Grupo | Sitios | ¿Alcanzable en Source? | ODE-697 |
|---|---|---|---|
| Edición Rich | `useEditorPersistence.ts:528`; `editor-shell.tsx:1670, 1767, 2787, 2806, 2823, 2847, 2868, 2893`; `useSelectionPopup.ts:138, 249, 276, 314`; `useCorrectionActions.ts:145`; `useFindReplace.ts:434, 496`; `useFootnotes.ts:98` | No. Guards de modo: `useEditorPersistence.ts:576`; `editor-shell.tsx:1664, 1715`; ramas `modeRef.current === "rich"` del panel de notas; `useSelectionPopup.ts:94, 198, 331`; `useCorrectionActions.ts:82`; `useFindReplace.ts:400, 470`; `useFootnotes.ts:82` | Sin cambio |
| Run de Source | `editor-shell.tsx:1570, 1620, 1706, 1749`; `useEditorCommands.ts:313` | Sí | Pasa a `persistMarkdownSnapshot` (programador único) |
| Panel en Source | `editor-shell.tsx:1294` (`applyMarkdownFromPanel`) | Sí | Pasa a `persistMarkdownSnapshot` con el texto del panel |
| Toggle | `editor-shell.tsx:1531` | Sí (Source→Rich) | Se elimina |
| **Lee Rich estando en Source** | Propiedades `:2950, 2966, 2982`; renombrar `:2053, 2087`; Save As `:2182, 2199`; imagen antes de materializar `:948`; respaldo de imagen local `:1788`; "Keep my version" (`useExternalDocumentChanges.ts:357`) | **Sí**, salvo el respaldo de imagen, que lanza un NodeView Rich, inerte en Source **[I]** | `persistEditorSnapshot` pasa a ser **consciente del modo**: en Source delega en `persistMarkdownSnapshot` con `markdownValueRef.current`. Así ningún llamador puede guardar Rich viejo en Source |

**C. `markdownSaveTimeoutRef` y `pendingMarkdownSaveRef`** **[V]**

| Sitio | Qué hace hoy | ¿Pierde texto? | ODE-697 |
|---|---|---|---|
| Armar: `editor-shell.tsx:1554, 1610, 1697, 1740`; `useEditorCommands.ts:303` | Programa el `run` (800 ms) | — | Un solo programador |
| Rearmar: `editor-shell.tsx:1548-1550, 1603-1605, 1690-1692, 1737-1739`; `useEditorCommands.ts:293-295` | Sustituye un timer por otro con texto más nuevo | No | Igual |
| `applyMarkdownFromPanel` → `clearPendingSave` (`editor-shell.tsx:1274-1282`) | Cancela, y el panel persiste en el mismo tick un texto que ya incluye el pendiente | No (sustituido) | Igual, por la ruta Markdown |
| Toggle (`editor-shell.tsx:1467-1470`) | **Cancela** y persiste vía Rich | No hoy; **sí** si se quita el persist del toggle sin vaciar | **Vaciar** (ejecutar) |
| Guard de modo dentro de cada `run` (`editor-shell.tsx:1555-1558, 1611-1614, 1698-1701, 1741-1744`; `useEditorCommands.ts:304-307`) | **Descarta** el guardado si el modo ya no es Source | **Sí**, si el `run` corre después de un cambio de modo que no vació (fila M12) | Se elimina |
| `useCorrectionActions.ts:135-138` | Cancela en la rama Rich (guard `:82`) | No: en Rich ya no queda timer, porque el toggle vacía | Sin cambio (no-op) |
| `flushPendingMarkdownSave` (`useEditorPersistence.ts:168-177`) | Ejecuta el `run` | No | Igual; también lo llama `activateDocument` |
| Desmontaje (`useDocumentExit.ts:220-222`) | Cancela el timer | No: el volcado de `useEditorPersistence.ts:408-419` corre antes (ODE-573) | Igual |

Conclusión: hoy hay **dos descartes reales**, el toggle y el guard de modo de los cinco `run`. El reanálisis pedía que nadie cancelara sin ejecutar: el diseño elimina ambos.

### 2.7 Consumidores que leen el Rich oculto durante Source **[V]**

| Consumidor | Sitio | Efecto si Rich no se actualiza | ODE-697 |
|---|---|---|---|
| `bodyText` → métricas, título visible de documentos sin nombre, nombre por defecto de Save As y título de la pestaña | `setBodyText` en los `run` (`editor-shell.tsx:1569, 1619, 1748`; `useEditorCommands.ts:312`) → `textMetrics` `:1823`, `displayTitle` `:1825-1828`, `exportFileBaseName` `:2231-2239`, `desktopSaveFileBaseName` `:2243-2246`, `publishTabState` `:1927-1934` | Quedarían congelados | Se calculan desde el texto de Source (D1) |
| TOC | La extensión TipTap → `scheduleTableOfContentsUpdate` (`editor-shell.tsx:829-845`); el panel se ve en ambos modos (`:2599-2611`) | Congelada | D1 |
| Snapshot del borrador al salir | `useDocumentExit.ts:117-125` (`editor.getJSON()`) | Volvería vacío y la siguiente edición reemplazaría la petición pendiente | Guarda modo y Markdown (fila M11) |
| Vista previa del modal de renombrar | `useWorkspaceTabs.ts:314-317` | Muestra el cuerpo viejo | `markdownValue` |
| Guardados que leen Rich | Tabla 2.6.B, fila "Lee Rich estando en Source" | **Pisan el texto de Source** | `persistEditorSnapshot` consciente del modo |
| Ya conscientes del modo; no cambian | `currentDocumentMarkdown` `:1829-1844`, `getBodyMarkdown` `:2248-2260`, panel de notas (`acceptedMarkdownForAnnotations`), `useEditorSelection`, comandos ocultos en Source (`lib/editor/shortcuts.ts:303-310`), exportación PDF/DOCX (lee el `.md`, `:2319-2337`) | — | — |

---

## 3. Contrato de comportamiento

### 3.1 Decisiones de Hugo (literales, descripción de ODE-697, 2026-10-08)

> 1. **El** `.md` **guarda byte a byte lo escrito en Source.** La canonicalización solo ocurre cuando una edición en Rich vuelve a serializar.
> 2. **Web (sin archivo):** garantía de equivalencia semántica; los spans opacos (componentes mal formados) se conservan byte a byte.
> 3. **Si Rich no se puede regenerar al volver:** se queda en Source con un aviso en inglés y "Try again", sin diálogo al salir (el texto ya es durable).
>
> Reglas vigentes del dueño: nunca perder texto; nunca guardar una versión alterada; cambiar de pestaña o navegar no interrumpe.

### 3.2 Requisitos del issue y cómo los concreta este diseño

| Req. | Texto del issue (resumido) | Concreción |
|---|---|---|
| 1 | El `run` llama a `persistMarkdownSnapshot(markdown)`; el coordinador no cambia su máquina de estados | Igual. Se refina: **un solo** programador para los cinco `run` (tabla 2.6.C), sin guard de modo |
| 2 | `serialize` devuelve `markdown` si `canonicalSource === "markdown"`; `createDraft` acepta `initialMarkdown`; orden canónico intacto | Igual |
| 3 | Web: el adaptador deriva `{ bodyJson, bodyText }` fuera del editor visible; si falla, `failed` dentro del coordinador | Se mantiene el contrato observable. Se refina **dónde** se deriva (§2.4): primero en `persistMarkdownSnapshot`, por la paridad de título y `body_text`, y el adaptador solo si el record llega sin JSON. El adaptador nunca escribe un documento vacío |
| 4 | Toggle a Rich: vaciar en vez de cancelar; sin cambios no hace nada (COMP-60); si no, regenerar **sin persistir**; si falla, Source con aviso | Igual. Se refina el atajo: compara contra la **base de Rich**, no contra `richToSource(editor)` (con un `.md` no canónico, la comparación literal reparsearía en cada toggle limpio) |
| 5 | Al hidratar en Source, el textarea muestra los bytes del `.md` (`openWriting` devuelve `content.markdown`) | Igual. Se extiende a Rich→Source sin edición Rich (§2.5), a la recarga externa (M21) y al regreso al borrador (M11) |
| 6 | Consumidores del Rich oculto → `markdownValue` (mínimo; el IR es ODE-529 paso 2) | Lista completa en §2.7: son más de los cuatro del issue. Las vistas, según D1 |
| 7 | `event.preventDefault()` antes de `if (closing) return`, con doble fiel al wrapper | Igual |
| 8 | Sin retención en memoria, sin diálogos propios de Source, sin store nuevo | Igual. Los refs nuevos (`markdownValueRef`, `richBaseRef`) tienen un solo escritor y no son espejos (`tests/architecture/editor-shell-mirrors-ratchet.test.ts`) |

### 3.3 Invariantes que el BUILD debe probar

- **I1. Bytes = textarea.** En desktop, lo que se escribe al `.md` desde Source es idéntico al valor del textarea en el momento del guardado. Toda transformación (`convertHtmlTablesToMarkdown`, `editor-shell.tsx:1538-1539`, o una acción de panel) ya está en el textarea antes de guardarse; ninguna ocurre entre el textarea y el disco.
- **I2. Sin Rich viejo.** Ningún guardado lee el editor Rich mientras el modo es Source.
- **I3. Vaciar antes de cambiar.** Toda transición de identidad (`activateDocument`, el único punto de entrada; `editor-shell.tsx:601-628`), todo cambio de modo y el desmontaje ejecutan el guardado de Source pendiente antes de cambiar. Nadie lo cancela sin que lo sustituya, en el mismo tick, una petición que contiene su texto.
- **I4. Rich no persiste al regenerar.** Regenerar Rich desde Source no escribe nada.
- **I5. Canonicalizar solo tras editar en Rich.** La forma canónica solo llega al `.md` al serializar una edición Rich.
- **I6. Orden de guardado intacto.** Desktop: `.md` → manifest → SQLite y cola → sync (`odessay-adr-identidad.md:129`; catálogo `:463-471`).
- **I7. Web nunca vacía.** Un record de Markdown sin JSON se deriva o falla; nunca escribe `{ type: "doc", content: [] }`.
- **I8. Sin estado nuevo.** Sin retención en memoria, sin diálogos de Source y sin store nuevo.

---

## 4. Matriz de salidas y fallos

"Hoy" = rama de fase @ `96d1f105`. "Texto" = qué pasa con lo escrito en Source. "Identidad" = UUID y ruta. Las pruebas T1–T16 están en §7. Un límite lleva su razón.

| # | Salida | Hoy | Propuesto | ¿Texto? | ¿Identidad? | Prueba o límite |
|---|---|---|---|---|---|---|
| M1 | Debounce de Source, desktop | `sourceToRich` + `setContent` + persist de Rich: el `.md` sale canonicalizado. Si la conversión falla, guarda el resultado de `materializeMarkdownForRichParser` (`editor-shell.tsx:1554-1572`) **[V]** | `persistMarkdownSnapshot` con los bytes; no hay conversión | Bytes exactos en el `.md` | Igual | T1, T2 |
| M2 | Debounce de Source, web | `setContent` + persist de Rich (`:1561-1570`) **[V]** | Derivación fuera del editor visible (§2.4) | Semántica; opacos byte a byte (decisión 2) | Igual | T8 |
| M3 | Inserciones, comandos de formato y buscar/reemplazar en Source | Cuatro `run` con `materializeMarkdownForRichParser` directo, también en desktop (`:1610-1622, 1697-1708, 1740-1751`; `useEditorCommands.ts:303-315`). Buscar/reemplazar pasa por `handleMarkdownChange` (`useFindReplace.ts:400-412, 470-475`) **[V]** | Un solo programador | Bytes exactos | Igual | T1 (por cada entrada) |
| M4 | Acciones de panel en Source (notas, notas al pie, correcciones) | `normalizeMarkdownForRoundTrip` sobre el documento entero (`editor-shell.tsx:1260`), `setContent` y persist de Rich (`:1273-1295`). Las correcciones parten del Markdown normalizado (`:1831`; `useCorrectionActions.ts:158-172`) **[V]** | El panel cambia solo su tramo sobre `markdownValue` y guarda por la ruta Markdown. Una corrección que no se localiza literal termina en conflicto, por la salida que ya existe (`conflictIds`) | Bytes fuera del tramo intactos (decisión 1) | Igual | T10b |
| M5 | Toggle Source→Rich | Cancela el debounce (`:1467-1470`), convierte o usa el fallback, aplica `setContent` y persiste la versión canonicalizada (`:1517-1531`) **[V]** | Vacía el debounce; regenera sin persistir; atajo limpio contra la base | Ya en el `.md` | Igual | T3, T4 |
| M6 | Toggle Rich→Source sin edición Rich, con `.md` no canónico | El textarea muestra `richToSource(editor)` (`:1472-1493`); la siguiente edición en Source canonicaliza el documento sin que haya habido edición Rich **[V]** | Muestra `richBase.markdown` | Bytes exactos (decisión 1) | Igual | T5 |
| M7 | Fallo al regenerar Rich | El fallback se aplica y se persiste (`:1522-1525, 1531`) **[V]** | Se queda en Source; aviso "Try again"; nada se persiste; sin diálogo al salir | Ya durable | Igual | T6 |
| M8 | Cambio de pestaña con Source pendiente | `prepareDocumentExit` ejecuta el `run` (`useWorkspaceTabs.ts:113` → `useDocumentExit.ts:204-207`) y espera con `settle` si hay pendiente (`useWorkspaceTabs.ts:116-122`). Llega canonicalizado **[V]** | Igual, con los bytes. Además, `activateDocument` vacía (I3) | Bytes exactos; durable antes de activar B | Igual | T7a (amplía `tests/editor-shell-exit-protocol.test.tsx:352`) |
| M9 | Abrir otro documento (Search, Recent, árbol, menú Open File) | Vaciado (`useWorkspaceTabOpening.ts:181`; `editor-shell.tsx:2125`); la escritura sigue en el coordinador **[V]** | Igual, con bytes | Bytes exactos | Igual | T7b |
| M10 | New Artifact estando en Source | Desktop: vaciado (`useWorkspaceTabOpening.ts:94`) y `setContent(EMPTY)` (`:108`), pero ni el modo ni `markdownValue` se reinician: el borrador nuevo muestra en Source el texto de A **[I]** (únicos escritores: toggle `editor-shell.tsx:1473, 1510`; hidratación `useDocumentHydration.ts:618, 650`; `setMarkdownValue` no se llama en esta ruta **[V]**). Web: `flushPendingEdit: false` (`:134`); el `run` de A corre después con la identidad del borrador: A pierde ≤800 ms y nace un documento con el texto de A **[I]** | `activateDocument` vacía el guardado de A antes del cambio (I3). La llegada al borrador fija el textarea (vacío o el snapshot del borrador) | A completo en A; B vacío | Sin documento extra | T14 (web: `it.fails` primero) |
| M11 | Volver al borrador sin materializar, dejado en Source | Snapshot = `editor.getJSON()` (`useDocumentExit.ts:117-125`). Hoy contiene el texto porque el `run` hizo `setContent` antes. La restauración aplica `setContent` sin modo (`useDocumentHydration.ts:282-289`). Un borrador no espera a su escritura al cambiar de pestaña (`useWorkspaceTabs.ts:116`: exige `writingId`) **[V]** | Snapshot `{ draftId, mode, markdown \| bodyJson }`; la llegada aplica modo y textarea. Sin esto, con ODE-697 el borrador volvería vacío y la siguiente edición reemplazaría la petición pendiente del mismo `draftWritingId` | Se conserva | Un solo UUID | T11 |
| M12 | Materialización del borrador activo mientras escribes en Source (desktop) | `onMaterialized` → `activateDocument(…, "materialize")` hidrata (`useEditorPersistence.ts:313`; `useDocumentHydration.ts:114-116`). La pestaña conserva `view_state.mode = "rich"` por defecto (`lib/local-db/editor-sessions.ts:27-28`; `lib/stores/editor-session-store.ts:446-456`), así que `applyEditorMode("rich")` (`useDocumentHydration.ts:649-650`). El `run` pendiente se descarta por el guard de modo y el editor muestra el `.md` del primer snapshot **[I]** | Sin guard de modo, el `run` siempre persiste. `materialize` relee el estado durable pero no reaplica contenido ni modo (D2) | Se conserva; el modo no cambia solo | El mismo UUID | T12 (`it.fails` primero) |
| M13 | Navegar fuera de `/write` (desmontar) | `flushPendingEditOnUnmountRef` ejecuta el `run` y luego `dispose` (`useEditorPersistence.ts:408-419, 552-557`). El `run` hace `setContent` en pleno desmontaje **[V]** | Igual; el `run` ya no toca el editor | Durable, sin aviso | Igual | T7c |
| M14 | Cerrar pestaña | Vaciado y `settle(target)` (`useWorkspaceTabs.ts:167, 180-186`) **[V]** | Igual, con bytes | Durable | Igual | T7d |
| M15 | Cerrar ventana | `settleBeforeClose`: vacía y espera `settle()`, **sin mirar el resultado** (`editor-shell.tsx:2290-2294`); luego `destroy` (`hooks/useTauriCloseGuard.ts:44-46`) **[V]** | Igual en ambos modos | Durable si la escritura funciona | Igual | T7e. **Límite:** si la escritura falla, la ventana se cierra igual. Es común a Rich y lo resuelve ODE-692 (D692) |
| M16 | Doble clic de cierre | `if (closing) return` va antes de `preventDefault` (`useTauriCloseGuard.ts:39-42`), y el wrapper destruye si el evento no se previno (`node_modules/@tauri-apps/api/window.js:1632-1641`): el segundo cierre destruye mientras `settle` sigue en curso **[V]** | `preventDefault()` primero | Durable | Igual | T15 |
| M17 | Pestaña quitada por documento no disponible | `reconcileUnavailableWritingTab` (`useDocumentHydration.ts:393-417`) **[V]** | Igual; no hay retención que quede huérfana | Lo que no llegó al disco se pierde igual que en Rich | — | **Límite** común a Rich: el documento ya no existe y no hay dónde escribir; el issue lo acepta |
| M18 | Crash | Source: 800 ms + 4 s; Rich: 150 ms + 4 s (`useEditorPersistence.ts:49, 55, 61`) **[V]** | Igual | Se pierde lo que estaba en memoria | Igual | **Límite** aceptado en el issue: es la memoria del proceso |
| M19 | Fallo de escritura (`.md` o catálogo) | `failed` y "Needs attention" (`persistence-coordinator.ts:729-740`; COMP-13) **[V]** | Igual en ambos modos | En el textarea y en el marcador sin confirmar; no durable | Igual | Prueba existente `tests/integration/documents/component-save-faults.test.ts:228, 302` (BUILD añade la variante Source). Salir con la escritura fallida es **límite** de ODE-692 |
| M20 | Fallo de derivación web | No existe | `failed` dentro del coordinador; nunca un documento vacío | Igual que M19 | Igual | T9 |
| M21 | Cambio externo limpio en Source | Solo recarga Rich (`useExternalDocumentChanges.ts:239-251`). El textarea queda viejo y la siguiente edición en Source pisa la versión externa **[I]** | En Source, el textarea recibe los bytes del `.md`; la base se actualiza | Ni el externo ni el local se pierden | Igual | T13 |
| M22 | Conflicto externo en Source: "Keep my version" o "Reload" | Keep persiste Rich (`:357`); Reload solo recarga Rich (`:319`) **[V]** | Keep persiste el texto de Source; Reload actualiza el textarea | El elegido, sin mezclar | Igual | T13b |
| M23 | Propiedades (estado, tipo, visibilidad) en Source | Persisten Rich con metadatos (`editor-shell.tsx:2944-2984`). Hoy canonicaliza; con ODE-697 sin este cambio, **pisaría** Source con un Rich viejo **[V]** | `persistEditorSnapshot` consciente del modo | Bytes de Source y metadatos | Igual | T10 |
| M24 | Renombrar en Source | Desktop materializado: `renameWriting` sin escribir contenido (`:2067-2071`; `document-service-factory.ts:596-615`). Borrador desktop y web: persisten Rich (`:2053, 2087`) **[V]** | Consciente del modo | Bytes de Source | UUID estable; la ruta cambia como hoy | T10 |
| M25 | Save As en Source | Borrador: persist de Rich (`:2182`). Materializado: vaciado y persist de Rich con `awaitDurability` (`:2193-2200`) antes del move **[V]** | Consciente del modo; el move transporta los bytes de Source | Bytes exactos en el destino | UUID conservado (ODE-402) | T10 (desktop). El fallo después del move es ODE-698 |
| M26 | Insertar imagen en Source con el borrador sin materializar | `persistEditorSnapshot(…, forceMaterialize)` lee Rich (`:945-955`) **[V]** | Consciente del modo | Se conserva | Un UUID | T10 |
| M27 | Abrir o hidratar en Source | El textarea recibe `richToSource(editor)` y no los bytes (`useDocumentHydration.ts:605-619`). Desktop `toWriting` devuelve `markdown: null` (`document-service-factory.ts:115`) **[V]** | Desktop: bytes del `.md` (`openWriting`, `:409-423`). Web: serialización (decisión 2) | Bytes exactos (desktop) | Igual | T5b |
| M28 | Hash entre máquinas con `.md` no canónico | Ver §6.2 **[V]** | Igual | Sin pérdida | Un archivo copiado desde una materialización canónica de otra máquina puede no re-emparejarse y abrir con identidad nueva | **Límite:** es la misma clase que hoy tienen los `.md` editados fuera de la app. El reanálisis ya lo señaló como coste de la decisión 1 |
| M29 | Edición en Source con un conflicto WATCH-07 sin resolver | El guardado automático está bloqueado en ambos modos (`useEditorPersistence.ts:434-436`); salir sin resolver pierde lo no guardado en ambos **[I]** | Igual: `persistMarkdownSnapshot` hereda el guard | Igual que Rich | Igual | **Límite** común a Rich y fuera de alcance; se anota como seguimiento (§8.4) |

**Comprobación de la garantía.** Con I3, después de cualquier edición en Source hay un `run` pendiente, que ejecutan el toggle, `activateDocument`, el desmontaje y los dos guards de cierre, o bien una petición ya en el coordinador, que `settle` y `dispose` vacían. Las únicas pérdidas posibles son el crash (M18), la escritura fallida (M19 y M20, ODE-692) y el documento que deja de existir (M17). Las tres son comunes a Rich.

---

## 5. Funciones y archivos a tocar

| Archivo | Cambio |
|---|---|
| `lib/editor/persistence-coordinator.ts` | `PersistenceSnapshot`: `content` discriminado, `{ kind: "rich", bodyJson }` o `{ kind: "markdown", markdown, bodyJson? }`. Construcción del record por variante (`:659-668`). `createDesktopDraft` con `initialMarkdown` (`:580-587`). Sin cambios en `persist`, `settle`, `dispose`, `pump` ni los mapas de WATCH-07 |
| `hooks/useEditorPersistence.ts` | `persistMarkdownSnapshot`; `persistEditorSnapshot` consciente del modo (en Source delega); derivación web (§2.4); programador único del guardado de Source (`scheduleMarkdownSave` con un `run` fijo) |
| `components/editor/editor-shell.tsx` | `applyMarkdownValue` (dueño único de `markdownValue` y `markdownValueRef`); `richBaseRef`; toggle (vaciar, regenerar sin persistir, aviso de fallo); los cuatro `run` al programador único; `applyMarkdownFromPanel` por la ruta Markdown, sin normalizar todo el documento; `activateDocument` vacía el guardado de Source; `bodyText` desde el texto de Source (D1); aviso "Try again" (chrome en inglés) |
| `hooks/useEditorCommands.ts` | `persistMarkdownDraft` usa el programador único |
| `hooks/useDocumentExit.ts` | Snapshot del borrador con modo y Markdown |
| `hooks/useDocumentHydration.ts` | En Source, el textarea recibe los bytes del `.md` y se fija la base; llegada al borrador con modo y textarea; regla de `materialize` (D2) |
| `hooks/useExternalDocumentChanges.ts` | Recarga limpia y "Reload" actualizan el textarea en Source; "Keep my version" usa el persist consciente del modo |
| `hooks/useWorkspaceTabs.ts` | Vista previa del modal de renombrar desde el texto de Source |
| `hooks/useCorrectionActions.ts` | En Source, aplicar sobre `markdownValue` crudo; lo que no se localiza va a conflicto |
| `hooks/useTauriCloseGuard.ts` | `preventDefault()` antes de `if (closing)` |
| `lib/services/document-service-factory.ts` | `serialize` respeta `canonicalSource: "markdown"`; `createDraft` acepta `initialMarkdown`; `toWriting` y `openWriting` devuelven `content.markdown` con los bytes |
| `lib/services/web-document-service.ts` | Deriva `body_json` si el record es de Markdown y llega sin JSON; nunca el documento vacío |
| `lib/editor/document-serialization.ts` | Una sola función de derivación Markdown → `{ bodyJson, bodyText }` con el separador de `getText()` por defecto (o una opción de `parseMarkdownToSnapshot`), compartida por el guardado web y la regeneración web |
| Tests | §7 |
| `workflow/quality/capability-integration-map.md` | §8.3 |

**No se toca:**
- Rust (`src-tauri/**`): `write_file`, hash, manifest y catálogo.
- El esquema de SQLite y de Supabase: sin columna `body_markdown`.
- El flush desktop (`desktop-catalog-sync-service.ts`), la cola web y la proyección de márgenes.
- `FilesystemDocumentService`, que ya escribe `content.markdown`.
- La máquina de estados del coordinador.
- `relocateDesktopWriting` (ODE-698), el aviso de escritura fallida (ODE-692), la reparación de componentes (ODE-694) y la señal de layout listo (ODE-540 reducido).

---

## 6. Verificaciones abiertas del reanálisis

### 6.1 Resueltas

1. **"Que ningún otro llamador cancele `markdownSaveTimeoutRef` sin ejecutarlo" (reanálisis §4).** Resuelto en la tabla 2.6.C. Además del toggle hay otro descarte que el reanálisis no nombró: el guard de modo dentro de los cinco `run`. El cleanup de desmontaje llega con el timer ya vacío (ODE-573).
2. **Enumeración de `setContent` y `persistEditorSnapshot`.** Resuelto en las tablas 2.6.A y 2.6.B. Hallazgo nuevo: hay **diez** guardados alcanzables en Source que leen Rich (propiedades ×3, renombrar ×2, Save As ×2, imagen, respaldo de imagen y "Keep my version"). El requisito 6 no los listaba, y con ODE-697 sin ese cambio pisarían el texto de Source.
3. **Riesgo de hash entre máquinas (`index.rs:1130`).** Resuelto en §6.2: límite M28.
4. **Consumidores que leen el Rich oculto.** Resuelto en §2.7. Faltaban en el requisito 6: el título visible y el nombre de Save As que salen de `bodyText`, la TOC y la restauración del borrador.
5. **Flujo web.** Resuelto en §2.4: la separación de `body_text` importa para el título.
6. **Paso 2 de ODE-529 (era [NV]).** En el comentario "PARTIAL DELIVERY — paso 1 de N" de ODE-529: "Sigue abierto en este issue: migración de consumers al IR y recorrido montado de guardado/reapertura" **[V]**.
7. **Márgenes en desktop (era [NV]).** No hay otro camino: el grep de `margin` en el sync y los servicios desktop sale vacío; solo existen las rutas web **[V]**. Es un hueco previo y ajeno a ODE-697.
8. **Doble clic (era [I]).** Verificado contra el wrapper real (`window.js:1632-1641`) **[V]**.
9. **"`settleBeforeClose` no mira el resultado de `settle`" (era [I]).** Verificado (`editor-shell.tsx:2290-2294`; `useTauriCloseGuard.ts:44-46`) **[V]**. Es de ODE-692 (D692).
10. **`toWriting` con `markdown: null` (reanálisis §3.1).** Verificado (`document-service-factory.ts:115`). `open_file` devuelve los bytes sin normalizar (`src-tauri/src/commands/document.rs:19-22`) **[V]**.
11. **`convertHtmlTablesToMarkdown` "conviene revisar".** Se mantiene: se aplica al valor del propio textarea (`editor-shell.tsx:1538-1539`), así que lo que se ve es lo que se guarda (I1). No es una alteración oculta.
12. **Requisitos 1-3 de ODE-540 (era [I]).** El toggle limpio sale antes de `setContent` (`:1512-1515`) y Rich se oculta sin desmontarse (`editor-content.tsx:90-99`) **[V]**.

### 6.2 Hash entre máquinas con `.md` no canónico

- El re-emparejamiento por hash solo se usa para un archivo **sin binding** que coincide con un documento **solo-nube** (`cloud_present=1, local_present=0, synced`), con `catalog_find_eligible_cloud_hash` (`src-tauri/src/commands/index.rs:1120-1138`, consulta en `:1129-1131`). Lo llaman Open File (`lib/services/open-document.ts:295-297` → `lib/services/desktop/open-document-desktop.ts:391-401`) y el reconciliador (`lib/services/desktop/workspace-reconciler.ts:191, 233`) **[V]**.
- El `content_hash` que sube desktop es el del binding, es decir, de los bytes del `.md` con LF (`document-service-factory.ts:312, 375`; `desktop-catalog-sync-service.ts:443`; `workspace.rs:960-988`). Otra máquina lo guarda como `cloud_content_hash` (`index.rs:1069-1074`) **[V]**.
- Una máquina que materializa el documento desde la nube escribe la serialización **canónica** de `body_json` (`open-document-desktop.ts:280, 341`) **[V]**.
- Consecuencia **[I]**: si A guardó bytes no canónicos, el archivo de A copiado tal cual a otra máquina **sí** se re-empareja (mismo hash). El archivo que materializa B no, porque su hash es el de la forma canónica. Si ese archivo de B se copia a un tercer sitio sin su manifest, abre como documento nuevo o ambiguo. No se pierde texto.
- La misma clase existe hoy con cualquier `.md` editado fuera de la app. CRLF/LF no afecta, porque el hash normaliza los finales de línea (`workspace.rs:960-965`; `lib/content-hash.ts:7-8`).

### 6.3 Marcadas para BUILD

- **[I] Paridad del `body_json` web.** El editor temporal usa `createEditorExtensions()` sin las opciones del editor visible (`document-serialization.ts:53-57` frente a `editor-shell.tsx:841-852`). Hay que comprobar que el JSON derivado y el del camino Rich coinciden, salvo atributos volátiles, y que la proyección de márgenes es la misma (T8).
- **[I] Mutaciones asíncronas del `doc` tras hidratar.** Si un plugin muta el documento después de cargarlo sin edición del usuario, `doc.eq(base.doc)` da falso y Rich→Source muestra la forma canónica. Es un fallback seguro, pero pierde la exactitud. T5 lo comprueba con los fixtures de componentes.
- **[I]** Un borrador de Source solo con espacios no se materializa (`bodyIsEmpty = markdown.trim() === ""`), mientras que en Rich decide `editor.isEmpty` (`useEditorPersistence.ts:490`). Es una diferencia menor y declarada.
- **[NV]** El textarea de WKWebView normaliza CRLF→LF en `value`, como manda el estándar HTML. No afecta al hash, pero un `.md` con CRLF que se edita en Source pasa a LF. T1 lo comprueba en el entorno de test; el DMG requiere verificación del dueño.
- **[I]** Los dos `it.fails` de ODE-686 en `tests/editor-shell-accepted-annotations-source.test.tsx:247, 284` pueden pasar a verde cuando la hidratación en Source fije el snapshot aceptado. Si pasan, se voltean en su propio commit y se coordina con ODE-686.

---

## 7. Plan de pruebas y mutaciones

Se aplican las reglas de `workflow/quality/capability-proof-contract.md`:
- entrada de producción: shell real con `tests/support/editor-shell-harness.tsx`, botones reales "Rich"/"Markdown", textarea real "Markdown source", `clickEditorTab` y `onCloseRequested`;
- coordinador y servicios reales; temp-fs en desktop y `localDB` sobre fake-indexeddb en web;
- dobles solo en las fronteras (IPC de Tauri y `sourceToRich` cuando se inyecta su fallo);
- aserción después del evento de completitud y sobre el resultado canónico (bytes del `.md`, fila, DOM).

Un bug real se escribe primero como `it.fails` en su propio commit.

| Prueba | Escenario | Mutación que debe ponerla roja |
|---|---|---|
| T1 | Desktop: Markdown no canónico escrito en Source (líneas en blanco extra, viñetas `*`, atributos de Card en otro orden, un span opaco), por teclado y por cada entrada de M3 → el `.md` es **idéntico** al textarea | `serialize` ignora `canonicalSource` → rojo; el `run` vuelve a `persistEditorSnapshot` → rojo |
| T2 | Desktop: escribir y guardar en Source no llama a `setContent` del editor visible (espía) | Volver a poner `setContent` en el `run` → rojo |
| T3 | Toggle Source→Rich antes de 800 ms: el `.md` tiene los bytes, Rich los muestra y no hay segunda escritura después del toggle | El toggle cancela en vez de vaciar → rojo (falta el texto). El toggle persiste tras regenerar → rojo (segunda escritura canonicalizada) |
| T4 | COMP-60 ampliado: toggle limpio sin `setContent` ni escritura, también con un `.md` no canónico abierto en Rich | Atajo contra `richToSource(editor)` en vez de la base → rojo |
| T5 / T5b | Rich→Source sin edición Rich muestra los bytes del `.md`; tras una edición Rich, la forma canónica. T5b: abrir en Source muestra los bytes | Usar siempre `richToSource` → rojo; hidratar Source desde Rich → rojo |
| T6 | `sourceToRich` falla (espía en la frontera): el modo sigue en Source, aviso en inglés con "Try again", sin escrituras. "Try again" con la conversión ya sana pasa a Rich. Cambiar de pestaña con el aviso no abre diálogo y A vuelve con su texto | Pasar a Rich con fallback → rojo; persistir el fallback → rojo |
| T7a–e | Salidas antes de 800 ms (pestaña, abrir, desmontar, cerrar pestaña, cerrar ventana con el doble fiel al wrapper): el `.md` tiene los bytes, mismo UUID y misma ruta | Quitar el vaciado de `prepareDocumentExit` → rojo en a/b/d. Quitar el de `activateDocument` → rojo en T14 web |
| T8 | Web: la fila local tiene el `body_json` derivado, con `body_text` y título iguales al camino Rich. El toggle a Rich no escribe y Rich muestra ese JSON | El adaptador escribe el documento vacío ante `richText: null` → rojo |
| T9 | Web: la derivación falla → `failed` y "Needs attention" dentro del coordinador | Tragarse el error → rojo |
| T10 | Desktop y web: tras guardar en Source, cambiar estado, tipo o visibilidad, renombrar (borrador y web), Save As e imagen antes de materializar conservan los bytes de Source | `persistEditorSnapshot` deja de ser consciente del modo → rojo |
| T10b | Una acción de panel en Source (nota, nota al pie, corrección) deja intactos los bytes fuera de su tramo | Volver a normalizar el documento entero → rojo |
| T11 | Borrador en Source → otra pestaña antes de materializar → volver: modo Source y el texto. Al materializar, un solo `.md` con los bytes | Snapshot del borrador desde Rich → rojo |
| T12 | Borrador en Source con `createDesktopDraft` retenido: seguir escribiendo y soltar. El modo sigue en Source, el textarea conserva todo y el `.md` final es igual al textarea (`it.fails` primero si reproduce) | Reaplicar `view_state` en `materialize` → rojo |
| T13 / T13b | Cambio externo limpio en Source: el textarea muestra los bytes externos y escribir después los conserva. Keep y Reload en Source | La recarga solo actualiza Rich → rojo |
| T14 | New Artifact en Source (desktop y web): A guardado en A, el borrador nuevo vacío, ningún documento con el texto de A (`it.fails` primero en web) | `flushPendingEdit: false` sin el vaciado de `activateDocument` → rojo |
| T15 | Dos peticiones de cierre con `settle` retenido y el doble `await handler(evt); if (!evt.isPreventDefault()) destroy()` → `destroy` una sola vez, después de `settle` | `preventDefault` después de `if (closing)` → rojo |
| T16 | STATE-10 (`tests/editor-shell-mode-toggle-persistence.test.tsx:192, 212, 232, 277`) sigue verde. La mutación que hoy retira el `persistEditorSnapshot` del toggle se sustituye por "cancelar en vez de vaciar" | — |

Tests existentes que cambian de expectativa **[V, por lectura]**:
- `tests/editor-shell-document-components-desktop.test.tsx:225-273`: hoy asume que el primer guardado tras Source es "su única canonicalización". Con ODE-697, el `.md` tras Source son los bytes del maestro y la forma canónica llega con la edición Rich `R01_EDIT`.
- `tests/editor-shell-document-components-web.test.tsx:196, 276`.
- `tests/integration/documents/component-save-faults.test.ts:228, 255, 302, 333`: variante Source.
- `tests/editor-shell-exit-protocol.test.tsx:352`.
- `tests/tauri-close-guard.test.tsx:31`: el doble pasa a ser fiel al wrapper.

Suite: la completa, porque se toca `tests/support/**`.

---

## 8. Riesgos y contratos que cambian

### 8.1 Contratos

- **ADR de identidad, D10** (`workflow/context/core/odessay-adr-identidad.md:117-125`): no cambia y queda reforzado. Hay que añadir una nota: "en Source, el `.md` se escribe con los bytes del usuario; la canonicalización ocurre al serializar una edición Rich".
- **Catálogo** (`odessay-desktop-document-catalog.md:37, 463-473`): no cambia.
- **ADR documento activo:** `activateDocument` suma el vaciado del guardado de Source (I3). Si se aprueba D2, `materialize` deja de reaplicar contenido y modo, lo que es una enmienda de ODE-570.
- **DocumentService:** usa `canonicalSource: "markdown"`, que el contrato ya permitía (`lib/services/contracts/document-service.ts:17-24, 190`). Cambian `PersistenceSnapshot` y `DesktopDraftOptions` (`document-service-factory.ts:53-63`).
- **`docs/design/document-components/syntax-and-roundtrip.md:58-67`:** coherente. La canonicalización y el parseo siguen permitidos en "coalesced save snapshots" y en "explicit Rich/Source transitions".

### 8.2 Riesgos

- **Volumen del cambio.** Toca unos 12 archivos de producción y cinco hooks. Mitigación: la matriz de §4 con una prueba por celda y un BUILD dividido en dos PRs. PR 1: núcleo (coordinador, `serialize`, `createDraft`, programador único, toggle, `persistEditorSnapshot` consciente del modo, cierre). PR 2: hidratación, borrador, recarga externa, paneles y vistas.
- **Rendimiento.**
  - Desktop mejora: desaparecen el parseo y el `setContent` cada 800 ms, y el editor temporal de `serialize`.
  - Web queda igual: un editor temporal por guardado en lugar de `setContent` en el visible.
  - La opción A de D1 añade un parseo lineal del IR sin TipTap.
- **ODE-540 reducido:** queda más simple, porque `handleRichLayoutReady` solo regenera la vista y nunca persiste (reanálisis §6).
- **ODE-692:** pasa a ser la única respuesta a una escritura fallida en ambos modos (M15, M19).
- **ODE-694:** un componente mal formado escrito en Source llega al `.md` con sus bytes exactos.

### 8.3 Capability map

- **STATE-10** (`workflow/quality/capability-integration-map.md:103`): reescribir la nota. El toggle vacía el guardado de Source en lugar de cancelarlo y persistir vía Rich; el guard de modo del `run` desaparece; la mutación pasa a ser "cancelar en vez de vaciar".
- **COMP-11** (`:75`): reescribir la nota de R03. Las "dos protecciones" se sustituyen por "el toggle vacía; no existe callback de Source tardío".
- **COMP-10** (`:74`): el momento de la canonicalización pasa a ser la primera edición Rich.
- Filas nuevas, en el rango que asigne el coordinador para el BUILD:
  - "Source save writes exact bytes" (desktop);
  - "Rich regeneration failure keeps Source durable";
  - "Source text survives every exit like Rich";
  - "No stale Rich persist while in Source";
  - "Web Source save derives body_json outside the visible editor".

### 8.4 Seguimientos (no se crean issues)

- **M29:** salir con un conflicto WATCH-07 sin resolver pierde lo no guardado en ambos modos.
- **M12 en Rich**, si D2 se limita a Source.
- **Márgenes en desktop:** sin proyección (hueco previo).

---

## 9. Decisiones nuevas para Hugo

**D1. Las vistas que hoy leen Rich mientras escribes en Source: título visible de documentos sin nombre, métricas, nombre por defecto de Save As e índice (TOC).**
Con Rich congelado en Source dejarían de actualizarse. El requisito 6 ya pide la versión mínima (`markdownValue`), pero tiene un efecto visible: el título de un documento sin nombre mostraría la sintaxis, por ejemplo "# Plan", y las métricas contarían los símbolos.
- **Recomendada: A.** Calcular título y métricas desde el texto de Source con el IR que ya existe (`parseControlledMarkdown` + `projectIrNodePlainText`, `lib/document-components/plain-text.ts:17-25`), más un recorte de la sintaxis en línea. La TOC se queda como estaba al entrar en Source y se refresca al volver a Rich; en Source hoy tampoco navega, porque apunta a Rich. Tiene un coste lineal sin TipTap. El IR completo queda para ODE-529 paso 2.
- **B.** Requisito 6 literal, con texto crudo: es más simple, pero se ve la sintaxis.
- **C.** Regenerar Rich en segundo plano solo para las vistas: sin cambios visibles, pero mantiene el parseo y el `setContent` cada 800 ms que este diseño quita.

**D2. Materializar el borrador activo deja de recargar contenido y modo.**
Al materializarse, hoy el borrador se recarga desde su `.md` con el modo de la pestaña ("rich" por defecto). Escribiendo en Source, eso cambia a Rich solo y puede perder lo último escrito (M12, [I]). La misma carrera parece existir en Rich: lo escrito durante la materialización desaparece del editor, aunque llega al disco.
- **Recomendada:** aplicar la regla en **ambos modos**. `materialize` relee ruta, metadatos y estado durable (ODE-542), pero no reaplica contenido ni modo. Es una sola regla y enmienda ODE-570.
- **Alternativa:** solo en Source, y lo de Rich queda como seguimiento.
