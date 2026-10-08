# Architecture Recon — P-ODE-42 / Fase 12

Fecha: 2026-10-07. Base autoritativa `origin/main@b42c11d9163d6bfa91ea3920eac2ba3366b0a6c5`, integrada sobre `codex/ode-528-539-document-components@a90d7ca0` en merge `53b7b2e9e8e42bb3d64a8a3b1cfcd8cb1d992884`. Lectura de los 15 issues activos/no archivados del proyecto P-ODE-42 (ODE-528–542), incluidas descripciones completas y comentarios obtenidos de Linear. Evidencia del árbol integrado; símbolos/rutas son la referencia cuando las líneas cambien. Se ejecutó un probe temporal con adapters reales, eliminado después: cuatro casos rojos reprodujeron los defectos descritos. No se modificaron estados ni briefs en Linear. Las suites citadas en cada fila describen cobertura existente; el resumen de validación de esta actualización se registra aparte.

## Owners, contratos y lifecycle

- Intención: componentes controlados dentro de Markdown canónico y representación TipTap `body_json`, sin alterar autoridad documental ni arquitectura durable.
- Dominio: documentos y representaciones; Layer shared-core Domain, adapters TipTap y export, UI NodeViews y comandos; runtime shared-core/web/desktop.
- Autoridad: AGENTS raíz → ADR identidad (leído antes del spec catálogo) → catálogo desktop → contratos aceptados `docs/design/document-components/{syntax-and-roundtrip,inline-semantics,surface-projections}.md`. `.md` materializado gobierna contenido; body_json es proyección/representación de trabajo; salvar sigue DocumentService/desktop engine → `.md` → manifest → catálogo + enqueue. Registry no decide persistencia.
- Owner canónico gramática: `lib/document-components/{types,registry,parser,serializer,coverage}.ts`, APIs `parseControlledMarkdown`, `serializeControlledDocument`, `DocumentComponentSpecRegistry`; no framework/infrastructure en core.
- Adapter canónico vigente: `lib/editor/document-serialization.ts:44` ofrece IR wrappers; `parseMarkdownToSnapshot:164` y `serializeDocumentToSnapshot:149` todavía crean Editor temporal. `lib/editor/markdown-format.ts:359,453` materializa anotaciones y marcas semánticas. `lib/editor/document-component-extensions.ts:99` adapta bloques mediante reconocimiento core + markdown-it. Esto no significa que todos los consumidores hayan migrado al IR.
- Consumers: `createEditorExtensions`, `DesktopDocumentEngine` (`lib/editor/desktop-document-engine.ts`), DocumentService y paths save/open existentes, readers server/client, `lib/export/writing-export.ts`, PDF/DOCX/Markdown, `hooks/useEditorCommands.ts` y selection owner.
- Hotspots: `components/editor/editor-shell.tsx` monta/cablea `useDocumentHydration:1172`, persistencia, comandos `:1390` y selección `:1441`; respetar AGENTS scoped. Shell no debe volver a poseer dominio documental, persistencia o tabs. Main trajo owners nuevos; conservarlos al portar componentes.
- Hydration owner: `hooks/useDocumentHydration.ts:212`, coordinador `lib/editor/hydration-coordinator.ts:66`, generation/session de `lib/editor`. Destrucciones: cambio documento/tab, remount/cierre, cambio de generación. Trabajo en vuelo: fetch/reconcile/parse/adopción del snapshot. Evidencia: A→B con resolución tardía de A, draft→UUID, reopen path/id y remount; publicar solo resultado de identidad/generación vigente.
- Persistence owner: `hooks/useEditorPersistence.ts:115` consume `createPersistenceCoordinator` (`lib/editor/persistence-coordinator.ts:226`); no escribir desde NodeViews. Trabajo en vuelo sobrevive según target writingId/draft/sourceTab, settle y coordinator existentes. Validar modo+tab+cierre durante debounce y commit; contenido/identidad/no duplicate enqueue son oráculos separados del indicador Saved.
- NodeView owner: `createControlledBlockNodeView` y `DocumentCodeBlock.addNodeView` (`document-component-extensions.ts:146,425`). UI interna, observers y render promises terminan en destroy; source/render sequence descartan resultados tardíos. Cambio Rich/Source limpio debe conservar misma isla; cambio doc destruye/cancela correctamente. Testear dom identity, selection/undo, geometry en navegador y no-mutación por chrome async.
- Reuso tests: `tests/integration/documents/support/real-desktop-doubles.ts` y montaje existente; `tests/editor-shell-annotation-roundtrip-desktop.test.tsx`, `editor-shell-annotation-roundtrip.test.tsx`, `editor-shell-durable-save-state.test.tsx`, generation/coalesce/phase/stale hydration. Evitar reconstruir shell con docenas de mocks privados.

## Hallazgos transversales priorizados

**P1 confirmado por código — reader-first/capability ausente.** Registry enumera 16 kinds pero specs no incluyen capability ni handlers por superficie. `createEditorExtensions` (`lib/editor/extensions.ts:100,124`) siempre registra Annotation/Entity/Highlight/Tip/Info/Card/CodeBlock y comandos. `validateDocumentComponentCoverage` solo lo consume `tests/document-components-engine.test.ts:183`, que construye un objeto declarando todas las superficies, sin probar handlers. No hay invocation/renderer/projection registry de producción ni feature gate detectado. Writers presentes antes de ODE-536/538/539 completos contradicen gate explícito de ODE-528/539. Clasificación: implementación parcial/contradicts-brief; no expandir escritores usando esta situación como arquitectura.

**P1 confirmado por código — pérdida de título/link en proyecciones.** Card/Tip/Info title vive en attrs (`document-component-extensions.ts:157`). `parseMarkdownToSnapshot`/`serializeDocumentToSnapshot` (`document-serialization.ts:156,186`) obtiene bodyText por `editor.getText`, que no incorpora attrs.title. `collectBlocks` (`lib/export/writing-export.ts:289,344`) no conoce card/tip/info; default solo recorre children. PDF/DOCX pierden título de Card/Tip/Info y href de Card (body puede conservarse). No existe proyección IR ordered de ODE-538. Oráculo mínimo: title exclusivo, body exclusivo y href aparecen en body_text apropiado/export real; comentarios/id/reason no aparecen.

**P1 confirmado por código — reader no aísla componente faltante.** `WRITING_BODY_EXTENSIONS` (`lib/reading/render-body-html-core.ts:32`) no incluye Tip/Info/Card. Server `render-body-html.ts:23` y client `render-body-html-client.ts:23` capturan error a nivel del documento entero y pasan a body_text. Por ello falta renderer registered-block y aislamiento por componente pedido por ODE-536; la fallback pierde título attrs y puede cambiar diagramación del resto del doc. Probe real del renderer client confirmó `mode: plain-text` y `<p>ONLY_BODY</p>` para Card con ONLY_TITLE/href: se perdió título y la representación del componente.

**P2 confirmado por código — teclado semántico.** `components/reading/margins/selection-popup.tsx:255,269,303,314` responde solo a onPointerDown en Entity/Highlight y tipos/colores. Enter/Space dispatch click, sin handler: no aplica. Ya declarado P2 en comentario ODE-532, todavía visible. El fix de target detached (`:97`) sí existe y no cierra esta brecha.

**P1 defecto confirmado por reproducción — opaque end-to-end.** Engine tests sí conservan raw exact, pero no hay nodo opaque TipTap ni una ruta que garantice conservar span raw al parsear Rich. `serializeRichNode` (`markdown-format.ts:410`) retorna raw opaco y termina en parser DOM; unsupported known container también tiene sintaxis core pero no TipTap adapter. `tests/semantic-marks.test.ts:150` afirma invalid Entity preservation pero solo llama canonicalizeControlledMarkdown, sin body_json. Probe happy-dom del adapter público confirmó pérdida: invalid Entity `<Entity type="person">missing id</Entity>` serializa `missing id`; unknown `<Future kind="x">\nKeep exact\n</Future>` serializa `Keep exact`; `<ProtectedText id="lock-1" reason="private">Keep lock</ProtectedText>` serializa `Keep lock`. Se conservó texto visible, se eliminaron estructura/atributos. Duración 581ms, 4/4 casos rojos (cuarto afirma title en body_text). Ampliar ahora a save .md→reopen con raw exact y ninguna limpieza margins destructiva; el defecto está confirmado en adapter, no se hizo prueba filesystem adicional.

**P1 riesgo estático — snapshot de anotaciones en Source.** `acceptedMarkdownForAnnotations` se actualiza al aplicar un panel y al entrar desde Rich; `useDocumentHydration` y autosave Source actualizan `markdownValue` sin ese snapshot. El panel usa el snapshot aceptado, por lo que puede quedar desfasado tras abrir/restaurar otro documento directamente en Source o editarlo. No se reprodujo el recorrido de UI: añadir prueba de identidad del panel, aceptación completa e invalid-no-prune antes de modificar el owner. `useFootnotes` también lee selección Source cacheada sin el guard writingId que ya reutiliza inserción de links; cubrir selección A seguida de activación B e inserción, con control positivo en B.

**P2 incomplete-brief — Step.title.** ODE-535 exige optional Step.title; accepted syntax doc `:46`, profile fixture y `registry.ts:127` requieren title. Antes de BUILD de 535 corregir el brief para respetar decisión aceptada o pedir cambio de contrato; no inferir desde implementaciones.

## Recon por issue

| Issue / estado tracker | Esperado | Observado y evidencia | Cierre/gap y pruebas integrales |
|---|---|---|---|
| ODE-528 / In Progress | Contratos 3 familias, semantics, 10 superficies, corpus, M0 antes de writers | Existen tres docs design y `tests/fixtures/document-components/{profile,catalog}.json` con valid/invalid/legacy/nesting/assets y escala 10/100/1000 + marks. `tests/document-component-fixtures.test.ts:64` valida nombres de superficies; no handlers. Comentario SHIP a #428. | Implementación de contratos presente, aceptación/tracker no Done. Gate M0 no prueba capacidades reales; materializar producción de cada fixture hasta cada proyección. |
| ODE-529 / In Progress | Framework-neutral IR/parser/registry/serializer y diagnostics, opaque, one grammar, compatibility adapters | `lib/document-components` existe; Map registry `registry.ts:160`, IR markdown/code/component/opaque en types. parse→serialize core y fixtures en `tests/document-components-engine.test.ts`; boundary wrappers `document-serialization.ts:44`. | Core presente, migración de consumers parcial; coverage API no prueba handlers. Full snapshot aún TipTap temporal. Unknown/invalid preservation integral y diagnostic failure no cleanup deben añadirse. No asumir O(N) runtime solo por fixtures correctas. |
| ODE-530 / In Progress | Tip/Info/Card/CodeBlock commands NodeViews editables, conversion atomica, atributos, teclado, pure Markdown | `document-component-extensions.ts` implementa blocks, typed commands `:341`, insertion `:345`, Card wrap `:368`, language `:396`; NodeViews y toolbar vía `useEditorCommands`. `tests/lib/editor/document-component-blocks.test.ts` cubre parse/serialize, menu observer, one undo, invalid attrs/nesting, literal fence y typing sin getMarkdown. | Slice presente; readers/export gate no completo. NodeView DOM tests happy-dom no geometría. Integrales create→configure→undo/redo→mode→save→reopen en web/desktop y real-browser Card focus/menu/geometry. |
| ODE-531 / In Progress | Annotation único writer canónico, legacy reader, occurrence identity, margins derived, privacidad | Core+annotation adapter `annotation-markdown.ts:80,115`, markdown materialization `markdown-format.ts:359`, highlight/reference ambos IDs; ADR amended. `content-sanitizer.ts:54` quita referencias/metadata annotation; export collector strips reference semantics. Main suites ODE-606 y ODE-625 ahora editor+sidebar+persist y disco. | Sustancialmente implementado; conservar tests modernos de main. Comentarios SHIP previos no prueban árbol merged. Anotación dentro Card/Tip/code boundaries y mixed semantic ranges necesitan integral; invalid parse nunca autoriza prunes. |
| ODE-532 / In Progress | Entity shared identity + Highlight sin id, no crossing, non-inclusive, one popup, keyboard, clean projections | `semantic-marks.ts` shared selection/overlap owner, `semantic-mark-extensions.ts:22,121` marks inclusive false; `markdown-format.ts:453` materialization. `semantic-marks.test.ts` roundtrip/undo/boundary/selection/100 marks; `selection-popup-semantic.test.tsx`, real-browser More fix comment. | Código principal presente; P2 teclado confirmado pendiente, post-ship More regression E2E no verde declarado por ambiente. Invalid entity opaque test sólo core; probe real confirma pérdida de tag/attrs. Test headless real More→Entity keyboard→type, copy/paste multiple mentions ID policy y actual persist/reopen. |
| ODE-533 / In Review | Mermaid fence source-first, lazy sanitized cache, owner-scoped stale filtering, recoverable errors, UI-only preview, fallback | `lib/mermaid/{loader,coordinator,cache,sanitize}`; NodeView `document-component-extensions.ts:425,573…`; coordinator revisions are per owner; cache verifies source after FNV lookup and holds a bounded 32-entry LRU. | Implemented with recoverable localized failures; the cache follow-up is covered at the coordinator/loader boundary. Headless tests do not prove WKWebView geometry or inspect final PDF/DOCX artifacts. |
| ODE-534 / Backlog | ProtectedText guard único de transacciones, unlock undoable, AI/corrections/find replace y source authoritative | Solo kind/spec core `registry.ts:51`; `semantic-marks.ts:27` reserva slot y dice ships with 534. No mark/transaction guard/unlock tests encontrados. | No implementado; parsing core no protección Rich. Mantener writer deshabilitado. Matriz replace/delete/paste/drop/AI/correction/find replace/undo source roundtrip, owner guard compartido en adapter y todos consumers. |
| ODE-535 / Backlog | Composed nodes/commands/NodeViews, valid structural edits, logical content/UI-state separation | Specs parser nesting declarados (`registry.ts:86…156`), `valid/nesting.md`; no editor schemas/commands para containers. | No implementado en Rich; no habilitar por registry.has. Corregir Step.title brief. Añadir atomic insert/add/remove/reorder/illegal move, focus/undo, inactive child textual completeness y UI-state excluded persisted output. |
| ODE-536 / Backlog | Renderer registry único todas reading surfaces, privacy, fallback por componente, coverage gate | server/client comparten extensions+sanitizer; Entity/Highlight/Annotation clean disponibles; Mermaid source fallback parcial. No block adapters ni renderer registry, error catch global. | Parcial por slices anteriores; P1 reader drift. Suite each enabled kind×preview/shared/public/server/client, snapshot semantic/text parity, mobile keyboard progressive fallback, invalid child must not drop whole doc. |
| ODE-537 / Backlog | Typed invocation catalog toolbar/bubble/Insert/slash/shortcuts, eligibility y help | Commands slices y hooks existen; semantic popup shared selection owner. No catalog keyed commands con surfaces/capabilities ni grouped composition, slash coverage encontrada. | Parcial. Reusar `useEditorCommands`, `useSelectionPopup`; crear catalog owner sólo donde no existe. Runtime tests each advertised surface/keyboard/disabled invalid selection/stale doc selection no mutation; evitar source concat/save UI. |
| ODE-538 / Backlog | One IR text/AI/clean Markdown/PDF/DOCX ordered projection, structural emptiness y real file inspection | Current text via Editor.getText; export separate `writing-export.ts` projection; `to-markdown.ts:6` canonical serialization, no full clean profile projection. Export Card default loses attrs; Mermaid fallback present. | No complete profile implementation. Need explicit canonical backup/export vs clean export policy; preserve existing callers semantics. Gate every enabled kind→handler→real PDF text+links / DOCX XML; title-only card structural nonempty; no private metadata. |
| ODE-539 / Backlog | Reader-first capability flag + downgrade unknown/malformed/legacy + release evidence owner acceptance | No production capability gate/enabled-kind registry found. Writer unconditional first slice. No complete cross-surface/export/packaged desktop release evidence. | No fase closure posible aún. Gate debe enumerar actual writers (no todos specs) y detectar missing production handler. Preserve readers flag off. Explicit owner acceptance still required by issue; test completion no equivale a fase Done. |
| ODE-540 / In Progress | Stable Rich island, clean mode no setContent/save/enqueue/version, edited mode applied once connected/layout-ready, geometry | `editor-content.tsx` stable hidden inert rich island; shell handleToggleMode `:1456` clean early return `:1509`; real source changes setContent `:1517` then persist `:1528`. `editor-content-mode-lifecycle.test.tsx` mocks EditorContent and asserts mounts/inert, no geometry. Existing source tests originally legacy large shell mocks; main new real harness preferred. | Fix architecture presente, geometry app desktop acceptance explicitly pending en comentarios. Edited path calls applyEditorMode then setContent synchronously; connected/layout-ready guarantee needs browser evidence (set state does not itself prove layout commit). Do not claim all NodeViews fail. No-op and edited source tests with real coordinator + exact counts, compare bounding boxes pre/immediate/4s debounce. |
| ODE-541 / In Progress (comment requests Backlog) | Defer global pushState notification out insertion phase, URL synchronous/microtask coalesced, tab/session safe | `desktop-write-entry.tsx:39` queueLocationChange + queueMicrotask `:45`, patchedPushState `:58`; `tests/desktop-write-entry.test.tsx`. Comment 2026-09-24 notes old fix never main and main changed heavily. | Branch code fix exists; inherited main owner must be checked after merge. Read-only recon no reproduction assertion; regression create/open/new tab session restore insertion warning and no-restorable diagnostics real bridge/shell, separate component scope. |
| ODE-542 / Done | Durable catalog reconciles Saved even missed event/materialization/generation, parity bar/tab O(1), no false local failure clear | Main has durable save-state reconciliation helper/hook + shell applySyncStatus; `tests/editor-shell-durable-save-state.test.tsx:305` modern harness, added background/order cases; `editor-save-state-reconciliation.test.ts`; latest comment post-merge PR493 confirms 10/10 and mutation proofs. | Treat main implementation/tests as authoritative; do not port old shared branch event-only architecture. Retain gate and extend representative component snapshot, dropped synced + flush zero while active, tab A sync while B active, no-op source no Saving. Packaged desktop explicit validation still not supplied by old SHIP comment; no fresh recurrence demonstrated. |

## Lo que no concluye este Recon

- No hay evidencia para afirmar que todos los NodeViews tienen la misma falla que Card.
- Los bugs de Card geometry, menu, status stale y insertion effects tienen owners y pruebas diferentes; una misma prueba que 'abre documento' no cierra todos.
- Un CI que pasa una prueba flaky tras diagnósticos acredita ese run, no elimina por sí solo carrera de hydration.
- Registro de SHIP/comments y suites históricas no sustituyen revalidación sobre el merge exacto ni aceptación visible.
- Opaque pasó de riesgo a defecto adapter confirmado por prueba roja temporal; hydration/timing siguen requiriendo una repro propia para afirmar defecto actual.

## Superficie mínima siguiente

1. Cerrar merge main conservando hydration/persistence/session/save-state owners y shared harness modernos.
2. Implementar primero pruebas integrales fallables sobre adapters/consumers reales del slice habilitado y registrar evidencia contra HEAD mergeado.
3. Corregir writer/read/export capability gate y proyecciones antes de habilitar 534/535. No precisa nuevo owner de persistencia/hydration; sí faltan owners de invocation/projection/renderer definidos en 536–538.
4. Completar slices Backlog con comandos/guards/adapters y gates existentes, con misma matriz transversal; no marcaremos toda Fase 12 implementada por el registry.

## Resultado del probe funcional temporal

Comando `npx vitest run tests/phase12-recon-probe.test.ts` (archivo eliminado inmediatamente tras la ejecución): 1 archivo, 4 casos, 4 fallos esperados; duración 581ms. Oráculo exact-source falló para invalid Entity, unknown Future y ProtectedText sin adapter; Card title no se incluyó en body_text. Outputs reales adicionales: export Card `{blocks:[{type:"paragraph",inlines:[{text:"ONLY_BODY"}]}],footnotes:[]}` sin title/href; reader client `{bodyHtml:"<p>ONLY_BODY</p>",mode:"plain-text"}`. El source Card sí permaneció correcto en serializer canónico, separando preservación Markdown de defecto de proyección. No ejecutar los 4 casos como un gate supuestamente verde; deben permanecer como reproducción de defects/followups o resolverse primero.


## Resultado de la integración con main

Se conservaron los owners extraídos de main (`useEditorPersistence`, `useDocumentExit`, `useSelectionPopup`, `useFootnotes`, `useWorkspaceTabs`) y el indicador durable de ODE-542. Las responsabilidades de Fase 12 se adaptaron a esos hooks; no se restablecieron los bloques inline antiguos del shell. Se preservó el contrato de listener del store como único escritor de `activeEditorTabIdRef`, el lookup fresco de tabs y la revalidación tras esperar durabilidad. Los ledgers built/review conservan exactamente main: trabajo en una rama no acredita entregas mergeadas.

Dos pruebas de exit protocol fallaron en la primera resolución main-only de tabs: activar B mientras el write de A está retenido y perder la última edición de A después del recorrido A→B→A. La adaptación del settle y cancelación de requests en el hook canónico hizo pasar los cinco archivos de tabs/exit (22 tests, Node 22). No se alteraron sus aserciones. Esta corrección forma parte de cerrar coherentemente el merge; no implementa las capacidades pendientes de 534–539.

## Readiness y siguiente orden

Gate de cierre de fase: **FAIL** por capacidades y evidencias pendientes; gate de planificación: **PASS WITH GAPS**, condicionado a reconciliar Step.title y refrescar Recon Packs/Files affected con los hooks actuales antes de BUILD de cada issue. ODE-528–533 tienen implementación sustancial, con brechas transversales; ODE-534–539 no están completos. Estados Linear preservados.

1. ODE-529/539: conservar source desconocido/inválido a través del adapter real y bloquear writer sin proyecciones.
2. ODE-531/540/542: ampliar harness existente con componentes, source aceptado, lifecycle, guardado y estados terminales; separar riesgos de menú, geometría y tabs.
3. ODE-536/538: lectura localizada, proyección de títulos/links y export real antes de rollout.
4. ODE-532/537: cerrar teclado e invocación mediante owners actuales; ODE-534/535: implementar sólo tras sus dependencias y actualización del brief Step.
5. ODE-539: conectar [plan transversal](./release-test-plan.md) a CI/release y probar el artefacto distribuido. El plan está creado; la nueva suite y el gate de publicación todavía requieren implementación.

Execution Trace: revisión conducida por Codex con workers de recon y pruebas de solo lectura, y un worker para resolver integración de editor. Skills: Linear/Orca Linear, Architecture Recon, UX Testing, Audit Planning y clasificación de arquitectura/performance conforme a las fuentes locales. Excluidos de esta validación: sesión cloud real/Supabase local, geometría Chromium, DMG distribuido, inspección visual PDF/DOCX y aceptación del dueño.


## Validación ejecutada por el coordinador

| Check | Resultado y alcance |
|---|---|
| `npm ci` | Lockfile instalado; Node efectivo inicial 20.19.1, validación final con Node 22.23.3 (versión requerida por package.json). |
| Core + documentos/sync | 27 archivos, 198 pruebas PASS; corrida inicial Node 20 antes del ajuste de tabs, no evidencia de DMG. |
| Suite completa Vitest, Node 22 | 362 archivos: 361 PASS y 1 FAIL; 2.716 pruebas PASS, 2 FAIL, 1 expected-fail. Comenzó antes del ajuste final de tabs: ambos fallos son los casos exit-protocol descritos arriba. No se presenta como una segunda corrida completa verde. |
| Revalidación posterior de tabs/exit, Node 22 | 5 archivos, 22 pruebas PASS; incluye los dos casos fallidos de la corrida completa. Tests originales sin relajación de assertions. |
| Selección/semántica/editor | Corrida focalizada anterior: 7 archivos PASS y 1 FAIL, 99 PASS/2 FAIL; mismo exit-protocol, después corregido. |
| `npm run test:parity`, Node 22 | 2 archivos, 11 pruebas PASS. |
| Typecheck final, Node 22 | PASS en árbol posterior al ajuste de tabs. |
| Lint | 0 errores; warnings existentes en shell/imagen/colecciones/tree y dependencias de hooks, sin cleanup ajeno. |
| Build final, Node 22 | PASS con las mismas variables públicas de ejemplo de `quality.yml`. Primera corrida sin variables terminó por `NEXT_PUBLIC_SUPABASE_URL` ausente, no por compilación. No acredita servicios cloud reales. |
| Workflow JSON y process sync | PASS; ledgers built/review idénticos a main. |
| Probe de defectos | 4 casos rojos con adapters reales; reproducen pérdida de source y título. Probe temporal retirado; no forman parte de una suite release verde. |

Esta evidencia acredita la actualización y el diagnóstico. No ejecutó Chromium, Supabase local, cargo replay ni DMG, y no implementó la nueva suite transversal ni el wiring de release. Los [16 recorridos](./release-test-plan.md) son el plan de trabajo con oráculos y límites; no se sube coverage_status por existir ese plan.

## Continuación (Claude, 2026-10-07) — pruebas integrales y correcciones

Handoff completo desde Codex sobre `4db20da9`. Node 22.23.3 vía `npx --package=node@22`. Cada prueba nueva se verificó con mutantes en vivo (el defecto reintroducido pone la prueba en rojo por su causa) y, cuando afirma una ausencia, con control positivo en el mismo setup.

### Defectos resueltos

| Issue / escenario | Defecto | Corrección (owner) | Evidencia |
|---|---|---|---|
| ODE-529 / R12 | El adapter Rich perdía tags y atributos de Entity inválido, kinds desconocidos y `ProtectedText` (solo conservaba el texto visible). Además: `List<String>` en prosa perdía `<String>` y `Map<String, Int>` se reescribía como `&lt;…&gt;`. | Nodos `opaqueSource`/`opaqueSourceBlock` (`lib/editor/opaque-source-extensions.ts`) alimentados por el parser core. Todo kind sin adapter Rich y todo span opaco serializan sus bytes exactos. El core (`parser.ts`) ahora salta code spans inline. Un tag desconocido sin cierre conserva solo su token y el resto sigue siendo Markdown editable (decisión del adapter; el IR core no cambia). | `tests/document-components-rich-preservation.test.ts` (15) y `tests/editor-shell-document-components-desktop.test.tsx` (2, shell desktop real: Source → Rich → edición → `.md` → reapertura; un toggle limpio no escribe). |
| ODE-536/538 (kinds habilitados) | El título de Card/Tip/Info no entraba en `body_text`. El lector caía a texto plano en **todo** el documento si contenía un bloque. El export perdía título y href. DOCX nunca emitía hipervínculos nativos (preexistente, todos los links). | `renderText` del nodo (título y luego cuerpo); proyección de lectura compartida `lib/reading/component-reading-extensions.ts` (sin chrome de autoría, href solo si pasa `validateComponentAttribute`); `collectBlocks` emite sección titulada con el link seguro; `ExternalHyperlink` en DOCX. | `tests/document-components-block-projections.test.ts` (6) con inspección real de `word/document.xml` + rels y texto de PDF (unpdf). |
| Merge 53b7b2e9 (ODE-642) | La rama hacía `return` al re-seleccionar la pestaña activa: se perdía la re-activación de main (nueva generación). Matriz 2/4 fallaban en la rama y pasaban en main. | `useWorkspaceTabs`: re-seleccionar sigue cancelando la petición pendiente y re-activa como en main. | Matriz 2/4 en verde. |
| Merge + bug preexistente de main (ODE-402/652) | Tras "Guardar como", todo autosave fallaba en silencio con CONFLICT (también en main: `persist` → `false`). La causa es que el relocate reescribía su propia copia del contenido y dejaba obsoleto el hash durable del coordinador. El exit protocol de la rama lo hizo visible: el click en otra pestaña se descartaba. | `handleSaveToDisk` vuelve durable la edición por el camino canónico y mueve exactamente esos bytes. El driver `clickEditorTab` espera el evento de activación. | Caso nuevo en `editor-shell-save-as-relocate.test.tsx`; ODE-652 «sin carrera» en verde. Bajo carga paralela quedaba otra carrera (una edición Rich en cola escribía la ruta vieja durante el move); Save As ahora vacía las colas Rich/Markdown antes (9907edd1): 121 pruebas juntas dos veces, sin CONFLICT. Residual: una tecla dentro de la ventana de milisegundos del move; se cerraría con un relocate exclusivo en el coordinador (owner ODE-402). |

### Hallazgos registrados, sin corregir

- **UX (preexistente; aplica también a `---`)**: si un documento termina en un bloque atómico, no hay posición de texto después y seleccionarlo y teclear lo reemplaza. Hace falta un gapcursor o un trailing node con su owner (ODE-540/537).
- **Exit protocol**: si `settle` del documento saliente devuelve `false`, el cambio de pestaña se descarta sin feedback más allá del estado de guardado. Se mantiene la política aceptada; revisar con ODE-541/542 si debe ofrecer una salida explícita.
- **Step.title**: comentado en ODE-535 como incomplete-brief. El contrato aceptado lo exige; el brief debe corregirse antes de BUILD.
- **Footnote en Source (R05)**: la repro se retiró del árbol sin terminar. El control positivo pasaba; el caso de carrera (selección de A, modal abierto, B activado por ruta) no lograba activar B por ruta en el harness, porque re-renderizar con la misma ruta no navega. No se afirma defecto.
- **Pendiente**: `acceptedMarkdownForAnnotations` (R03/R08) sin repro aún.

### Readiness

El gate de cierre de fase sigue en **FAIL**: ODE-534/535/537/539 sin implementar, proyecciones de kinds compuestos solo como fallback de texto, wiring de release (R16, DMG, Playwright) pendiente y aceptación del dueño pendiente. Los estados de Linear no se modificaron.

### Corrida completa

Con `f8c4b022`: 366 archivos, 2742 pruebas en verde y 1 expected-fail. Los 2 fallos eran la repro de footnote (retirada) y ODE-652 bajo carga, corregido en `9907edd1`. Después de `9907edd1` no se ha repetido una corrida completa.

### Siguiente paso propuesto

Dejar de acumular BUILD transversal en esta rama. Convertir los recorridos R01–R16 en issues de pruebas agrupados por owner, hacer Recon por issue (15 de Fase 12 más los nuevos) y orquestarlos. Los hallazgos de esta sección se reparten como evidencia de esos issues.

## Recon de área 2026-10-07 — mapa, conflictos y olas

Verificado en `codex/ode-528-539-document-components@60096f56`, que integra `origin/main@b42c11d9`. Modo completo (construir + despachar), solo lectura. Seis workers Codex GPT-6-Luna max por cluster de owner (Orca `run_aedad19f3891`): core (528/529/538/539/690), blocks (530/533/540/685/691), inline (531/532/534/537/687), reading (535/536/688), persistence (541/542/684/686/692/693) y perf (689). Por issue, el Recon Pack está en el comentario `## Recon Pack` y la corrección del brief en la sección `## Auditoría (2026-10-07)` de Linear. `npm run ops:brief:lint -- <25 issues> --require-contract --require-recon` en verde.

### Estado real por issue

| Issue | Estado | Hallazgo principal |
|---|---|---|
| ODE-528 | Parcial | Contratos y fixtures existen; sus writers ya están montados sin el gate que exige su DoD. |
| ODE-529 | Parcial | Core y preservación opaca hechos. El parser tiene peor caso O(N·D) (Annotation anidada) y O(N²) (muchos `<` sin `>`), que contradicen el O(N) declarado; el adapter opaco reparsea sufijos. |
| ODE-530 | Parcial | Specs, NodeViews y comandos hechos; falta la aceptación de geometría (ODE-685) y resolver el writer gate. |
| ODE-531 | Parcial | **P1 (cadena estática):** una Annotation inválida guardada como opaca no aparece en las filas de márgenes y `syncMarginsFromBodyJson` borra filas colaborativas existentes. |
| ODE-532 | Parcial | Enter/Space no aplican Entity/Highlight; el test "keyboard" usa pointerdown. El snapshot de selección no lleva `writingId`. |
| ODE-533 | Parcial | Wave 1 (PR #646) replaced the global Mermaid revision counter with owner-scoped tokens. The cache follow-up verifies the full source after FNV lookup and caps successful SVGs at a 32-entry LRU; WKWebView geometry and final PDF/DOCX artifact inspection remain separate evidence. |
| ODE-534 | Falta | Sin mark, guard ni unlock; los owners reales de Replace All y de correcciones no están en el brief. |
| ODE-535 | Parcial | Parser y registry de grupos hechos; sin adapters Rich. `Step.title` es requerido. Falta decidir qué pasa al quitar el último hijo. |
| ODE-536 | Parcial | Tip/Info/Card se renderizan; el fallo de un renderer sigue degradando el documento entero a texto. |
| ODE-537 | Parcial | No hay catálogo ni slash menu; las listas del toolbar están duplicadas. |
| ODE-538 | Parcial | Proyección de Tip/Info/Card hecha. **Seguridad:** los links Markdown comunes se exportan sin validar el href (PDF/DOCX). Falta la ruta de Markdown limpio sin tocar el serializer de save/hash. |
| ODE-539 | Falta | No hay capability gate de producción; `coverage.ts` es declarativo. |
| ODE-540 | Parcial | El toggle limpio está bien. Source editado aplica antes de que Rich tenga layout. Si `sourceToRich` falla, se hace `setContent` y se persiste: Context Gap (legacy-code). |
| ODE-541 | Parcial | Fix presente en la rama; falta reproducir sobre main actual y en el paquete. |
| ODE-542 | Parcial | Implementación completa; falta el smoke en la app empaquetada. |
| ODE-684 | Parcial | Integración desktop base hecha; faltan fixture maestro, suite web y matriz de fallos. El doble de manifest no es el `index.json` físico. |
| ODE-685 | Falta | No hay ruta de editor con fixture determinista ni señal observable de fin de toggle/guardado; el slash no existe. |
| ODE-686 | Parcial | Owners y patrones existen; faltan las 3 suites; riesgos sin reproducir. |
| ODE-687 | Falta | Suite semántica ausente; el gap de teclado es de ODE-532. |
| ODE-688 | Parcial | Proyecciones y artefactos básicos hechos; la shell ya no ofrece Markdown (decisión previa). |
| ODE-689 | Parcial | Sin contadores de runtime. En web, `persistEditorSnapshot` hace `getText`/`getJSON` del documento completo por frame. El capturador de trazas no admite un escenario de componentes. |
| ODE-690 | Falta | **Integridad de release:** se puede publicar un binario firmado de un SHA distinto del tag; `contents:write` aplica a todo el workflow y no hay dry-run. |
| ODE-691 | Falta | Sin gapcursor ni trailing node. |
| ODE-692 | Falta | Si "Switch anyway" hidrata B sobre la única copia en memoria de A, la edición fallida se pierde; el coordinador no guarda ese snapshot. |
| ODE-693 | Parcial | El relocate no se registra en `renamesInFlight`; sin prueba con el move retenido. |

### Grafo de conflictos de archivos (owner de producción, doble, fixture o test)

| Archivo | Issues |
|---|---|
| `lib/editor/extensions.ts` | 530, 532, 534, 535, 539 (gate), 691 |
| `lib/editor/document-component-extensions.ts` | 530, 533, 535, 537, 540 |
| `components/editor/editor-shell.tsx` (hotspot) | 540, 692 |
| `lib/document-components/registry.ts` / `parser.ts` | 529, 535 (+530/533 consumen) |
| `lib/document-components/coverage.ts` | 539 (owner), 690 (wiring/test) |
| `components/reading/margins/selection-popup.tsx`, `hooks/useSelectionPopup.ts` | 531, 532, 537 |
| `lib/editor/semantic-marks.ts`, `semantic-mark-extensions.ts` | 532, 534, 537 |
| `lib/reading/render-body-html-core.ts`, `component-reading-extensions.ts` | 533, 536 |
| `lib/export/writing-export.ts`, `to-docx.ts`, `to-pdf.tsx` | 533, 538 |
| `lib/services/document-service-factory.ts` | 693 |
| `hooks/useWorkspaceTabs.ts` | 692 |
| `app/globals.css` | 530, 532, 533, 535, 536 |
| `tests/fixtures/document-components/catalog.json` | 528, 684 |
| `tests/document-components-block-projections.test.ts` | 538, 688 |
| `tests/mermaid-reading-export.test.ts` | 533, 688 |
| `tests/editor-shell-document-components-desktop.test.tsx` | 684, 691 |
| `tests/perf/*`, `scripts/capture-editor-trace.mjs` | 689 (533 si mide Mermaid) |

### Olas propuestas (dependencias + conflictos)

0. **Antes de arrancar (humano):** decisiones de la Auditoría, activación de la fase y política del writer gate (528/539).
1. ODE-684 (corpus y harness), ODE-529 (parser O(N) + consumers), ODE-531 (no-prune P1), ODE-533 (token por owner), ODE-541 (reproducir primero).
2. ODE-540 (lifecycle), ODE-532 (teclado + selección con dueño), ODE-686 (suite), ODE-693 (relocate en vuelo).
3. ODE-692 (después de 540 por la shell), ODE-691 (después de 540), ODE-687 (después de 531/532), ODE-689 (después de 684 y 529).
4. ODE-530 (cierre + aceptación de geometría), ODE-685 (después de 540/530/533), ODE-538 (proyecciones, coordinado con 688).
5. ODE-534 (después de 532).
6. ODE-535 (después de 530/532 y de la decisión del último hijo).
7. ODE-536 (después de 530–535), ODE-537 (después de 530/531/532/534/535).
8. ODE-688 (matriz completa), ODE-539 (capability gate).
9. ODE-690 (gate de release + R16 sobre el DMG). ODE-528 y ODE-542 se cierran con la aceptación del dueño y el smoke empaquetado.

`lib/editor/extensions.ts` (composition root) lo tocan 530, 532, 534, 535, 539 y 691; por eso esos issues caen en olas distintas. Ningún par de la misma ola comparte un owner de producción. Los tests y fixtures compartidos se coordinan por orden de merge.
