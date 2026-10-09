# Reparar componentes mal formados sin perder su texto (ODE-694)

Estado: **diseño propuesto, pendiente de aprobación de Hugo (gate GD-694)**. Sin código de producción ni tests en este PR.

Verificado en `codex/ode-528-539-document-components@96d1f105` (2026-10-09).

Etiquetas:
- **[V]** verificado leyendo el código en `96d1f105`;
- **[V·sonda]** verificado con una sonda temporal (vitest + happy-dom, editor TipTap real con `createEditorExtensions()`, Node 22). La sonda se borró antes de este commit y no está en el PR; el apéndice A trae lo necesario para repetirla;
- **[I]** inferencia a partir del flujo de control, sin ejecutar;
- **[NV]** no verificado.

Entradas, por precedencia:
1. la regla del dueño (Hugo, 2026-10-08) en la descripción de ODE-694;
2. los requisitos, failure modes y acceptance de ODE-694;
3. los contratos aceptados `docs/design/document-components/surface-projections.md` y `syntax-and-roundtrip.md`;
4. las decisiones de ODE-697 (bytes exactos desde Source) y el requisito 2 de ODE-691 (selección y caret alrededor de un átomo).

---

## 1. Resumen de producto

1. Un componente mal escrito se sigue viendo tal cual, pero con un aviso en inglés que dice qué falla: etiqueta sin cerrar, atributo no permitido, enlace inseguro, etiqueta desconocida o posición no permitida.
2. Según el problema, el aviso ofrece "Fix" (solo si el arreglo es seguro y deja un componente válido), "Remove component, keep text" (se van las etiquetas y el texto queda en párrafos editables) y "Edit in Source" (abre Source con el bloque seleccionado).
3. Ninguna acción borra texto. Cada una se deshace con un solo Cmd+Z y se guarda por el camino normal del documento.
4. Borrar el bloque por accidente deja de ocurrir con una sola tecla: Backspace o Delete primero lo seleccionan, y escribir encima no lo reemplaza.
5. Funciona igual en web y en desktop. El aviso no aparece al leer, compartir ni exportar.

---

## 2. Representaciones y flujo de escritura

### 2.1 Dónde vive un componente mal formado

| Representación | Runtime | Qué guarda | Quién la escribe hoy |
|---|---|---|---|
| `.md` | desktop | Los bytes exactos del span mal formado. Los nodos opacos se saltan la canonicalización (`syntax-and-roundtrip.md:65`) | El serializer del nodo opaco escribe `raw` tal cual (`lib/editor/opaque-source-extensions.ts:193-201, 229-238`) **[V]** |
| IR del core | ambos | `OpaqueSourceNode { raw, reason, start, end }` (`lib/document-components/types.ts:84-90`) y `DocumentDiagnostic { code, message, start, end, kind }` (`types.ts:113-119`) | El parser emite cinco códigos: `unknown-component` (`parser.ts:457, 466`), `invalid-attributes` (`:485`), `unbalanced-component` (`:495`), `invalid-content` (`:526`) e `invalid-nesting` (`:536`). `invalid-tag` está declarado (`types.ts:107`) y nunca se emite (grep) **[V]** |
| Placeholder para Rich | ambos | `<odessay-opaque(-block) data-raw data-text data-reason>` (`opaque-source-extensions.ts:44-45, 100-121`) | `materializeMarkdownForRichParser` saca primero los spans opacos (`lib/editor/markdown-format.ts:398-401`) con `parseControlledMarkdown(source, { recoverUnclosedUnknownTags: true })` (`opaque-source-extensions.ts:50`) **[V]** |
| Nodo ProseMirror | ambos | `opaqueSource` (inline) u `opaqueSourceBlock` (bloque), los dos `atom: true` y `selectable: true`, con atributos `raw`, `text` y `reason` (`opaque-source-extensions.ts:145-162, 168-240`). Sin NodeView: `renderHTML` pinta `text` con el título "Preserved source. Edit it in Markdown source mode." (`:164, 217-223`) **[V]** | El DOM parser de TipTap, desde el placeholder |
| `body_json` (web y nube) | web | El mismo nodo con `raw`, `text` y `reason` | El guardado web del editor. Los lectores solo reciben `text` y `reason` (`lib/editor/content-sanitizer.ts:68-74`) **[V]** |
| Textarea de Source | ambos | Hoy la serialización de Rich (`components/editor/editor-shell.tsx:1472-1494`). Con ODE-697, los bytes del `.md` mientras no haya edición Rich | El toggle Rich→Source **[V]** |
| Proyección de anotaciones | web | Cualquier nodo opaco pone `accepted: false` (`lib/editor/footnote-extension.ts:524-526, 599`), y entonces los márgenes no se podan (`lib/margins/margins.ts:445, 477-491`) **[V]** | `syncMarginsFromBodyJson` tras cada `PATCH` |

Qué contiene `text` **[V]**:
- en un span mal formado es el `raw`, con sus etiquetas (`opaque-source-extensions.ts:56`);
- en un componente válido que Rich aún no edita (`reason = "rich-adapter-unavailable"`: ProtectedText, Tabs, AccordionGroup, Steps, CardGroup, CodeGroup) es su proyección de texto plano, sin etiquetas (`:60-69`; `lib/document-components/plain-text.ts:17-25`).

**Bloque o inline [V·sonda].** Un span multilínea que ocupa sus propias líneas es bloque. Si no, es inline (`opaque-source-extensions.ts:93-104`). La comprobación de fin de línea mira `"\n"`, así que en un `.md` con CRLF **todos** los spans salen inline. En `valid/master.md` (CRLF), la Card con atributos inválidos es `opaqueSource` dentro de un párrafo; con LF es `opaqueSourceBlock`. Por eso el diseño trata igual los dos nodos.

### 2.2 Flujo actual

1. **Abrir:** el span mal formado llega a Rich como átomo. No se puede editar y no explica qué falla: solo hay un tooltip genérico (`opaque-source-extensions.ts:164`) **[V]**.
2. **Reparar:** el usuario pasa a Source a mano (`handleToggleMode`, `editor-shell.tsx:1461-1494`), busca el span a ojo, lo corrige y vuelve a Rich (`:1496-1532`) **[V]**.
3. **Borrar sin querer [V·sonda]:**
   - Backspace al inicio del párrafo siguiente borra el bloque con una sola tecla, y Delete al final del párrafo anterior también. Los comandos `joinBackward` y `joinForward` borran el átomo vecino (`node_modules/prosemirror-commands/dist/index.js:69-74, 215-220`), y el keymap de TipTap los encadena para Backspace, Delete y sus alias (`node_modules/@tiptap/core/dist/index.js:5689-5736`).
   - Con el bloque seleccionado (NodeSelection), teclear una letra lo reemplaza.
   - Solo si el párrafo siguiente está vacío, el primer Backspace selecciona el bloque en lugar de borrarlo (`prosemirror-commands/dist/index.js:51-66`).
4. **Spans que se tragan el resto del documento [V + V·sonda]:**
   - un componente conocido sin cerrar es opaco hasta el final del archivo (`parser.ts:493-498`);
   - una etiqueta conocida autocerrada (`<Card title="x" />`) también. `parseTag` la marca inválida (`parser.ts:101-104`) y el fin opaco se busca con `</Card>` hasta EOF (`:483-490`), porque la recuperación de etiquetas sin cerrar solo aplica a kinds desconocidos (`:456`).

   En los dos casos, todo lo que sigue queda dentro de un único átomo no editable.
5. **Guardar:** cualquier edición Rich pasa por `handleEditorUpdate` (`hooks/useEditorPersistence.ts:574-590`), luego por el coordinador y el DocumentService. En desktop, el orden es `.md` → manifest → SQLite + enqueue → sync (`AGENTS.md`, invariante "Guardado"). En web, el guardado local y la cola terminan en `PATCH /api/writings/[id]`, que sincroniza los márgenes (`app/api/writings/[id]/route.ts:61-66, 161, 197, 212`) **[V]**.

### 2.3 Flujo propuesto

1. **Sin cambios en la materialización.** No cambian el `.md`, el IR, el placeholder ni los atributos del nodo. Ningún atributo nuevo se persiste.
2. **Los dos nodos opacos ganan un NodeView**, en `opaque-source-extensions.ts` (§2.5). Está hecho con DOM plano, como los NodeViews de Card y de Mermaid (`lib/editor/document-component-extensions.ts:151-271, 432-740`):
   - una cabecera con `contentEditable = "false"` (`:160`) que lleva el mensaje y los botones;
   - debajo, el source en solo lectura.
3. **Diagnóstico local al span.** `planComponentRepair(raw, { parent })`, una función pura del core, se calcula al crear el NodeView o cuando cambia `raw`. Nunca se calcula por transacción ni sobre el documento entero (`syntax-and-roundtrip.md:67`).
4. **Acciones = comandos TipTap del adapter opaco:** `repairOpaqueSource`, `unwrapOpaqueSource` y `editOpaqueSourceInSource`. Cada comando que muta:
   1. revalida que en la posición viva siga el mismo nodo opaco con el mismo `raw`;
   2. construye el contenido nuevo con el **mismo** pipeline de materialización que la apertura (§5);
   3. hace `replaceWith`/`replaceRange` en **una** transacción, con `closeHistory` antes y después;
   4. despacha.

   La transacción despierta `handleEditorUpdate`, que guarda por el camino canónico. Ni el NodeView ni el comando llaman a persistencia: siguen el precedente de `updateNodeAttributes` de Card (`document-component-extensions.ts:138-149`).
5. **"Edit in Source"** lo resuelve la shell:
   1. `handleToggleMode("markdown")`, el toggle canónico (con ODE-697, sin persistir);
   2. calcula el ordinal del nodo entre los nodos opacos del documento, localiza el span con ese ordinal en el texto de Source con la misma travesía que la materialización (`listOpaqueSpans`, §5), y llama a `queueMarkdownSelectionRestore(start, end, { isStillValid })` (`hooks/useSelectionRestore.ts:89-161`).

   El precedente es la navegación del panel de notas en Source (`editor-shell.tsx:2718-2741`).
6. **Guard de teclado:** Backspace o Delete junto a un nodo opaco lo seleccionan en lugar de borrarlo. Con el nodo seleccionado, Backspace o Delete lo borran en un paso visible y deshacible. Teclear sobre un nodo seleccionado no lo reemplaza (D3).

### 2.4 Por runtime

- **Desktop.** Fix y Remove son ediciones Rich, así que el documento entero se vuelve a serializar en forma canónica, como con cualquier edición Rich. Es la decisión 1 de ODE-697: "La canonicalización solo ocurre cuando una edición en Rich vuelve a serializar". Los demás spans opacos siguen byte a byte.
- **Web.** El `body_json` recibe los nodos nuevos por el guardado web normal. Cuando desaparece el **último** nodo opaco, `accepted` pasa a `true` y el siguiente `PATCH` poda las filas de margen del dueño que ya no están en el cuerpo (`margins.ts:477-491`). Es legítimo: COMP-03 lo exige para un borrado explícito. D2 evita que "Remove" se lleve el comentario de una Annotation.
- **Lectura, compartir y export.** No usan NodeViews: pintan con `generateHTML` (`lib/reading/render-body-html.ts:21`; `render-body-html-client.ts:21`) y exportan `text` (`lib/export/writing-export.ts:226-229, 380-383`) **[V]**. El aviso no puede filtrarse ahí.

### 2.5 Owner del NodeView opaco

- **Owner:** `lib/editor/opaque-source-extensions.ts`. Hoy define los dos nodos sin NodeView (`:168-240`). El NodeView, los comandos y el guard de teclado viven ahí.
- **Por qué no en `document-component-extensions.ts`:** ese archivo es el adapter de los kinds que Rich sí sabe editar (Tip, Info, Card y CodeBlock; dueños ODE-530, ODE-533 y ODE-540). El opaco es el adapter de lo que Rich no sabe editar.
- **Composition root:** `lib/editor/extensions.ts:130-131` pasa la opción `onEditInSource`, con el mismo patrón que `LocalImageExtension` (`:108-114`).
- **Lectura sin cambios:** la lectura sigue registrando los nodos sin opciones (`lib/reading/render-body-html-core.ts:30, 61-62`). `generateHTML` no instancia NodeViews.
- **Editores temporales:** los de serialización (`lib/editor/document-serialization.ts:53-57`) sí instancian el NodeView. Por eso su constructor no tiene efectos laterales: ni listeners globales, ni timers, ni foco (riesgo R4).

---

## 3. Contrato de comportamiento

### 3.1 Regla del dueño (literal, descripción de ODE-694)

> **Nunca se pierde el texto de un bloque.** Ante un componente mal formado se puede perder, como mucho, su visualización como componente, nunca el texto que contiene. La app muestra un mensaje de error y ofrece arreglar el componente, o quitarlo conservando el texto para volver a agregarlo.

Reglas relacionadas, literales:
- **ODE-697, decisión 1:** "El `.md` guarda byte a byte lo escrito en Source. La canonicalización solo ocurre cuando una edición en Rich vuelve a serializar."
- **ODE-697, decisión 2:** "Web (sin archivo): garantía de equivalencia semántica; los spans opacos (componentes mal formados) se conservan byte a byte."
- **ODE-697, reglas vigentes del dueño:** "nunca perder texto; nunca guardar una versión alterada; cambiar de pestaña o navegar no interrumpe."
- **ODE-691, requisito 2:** "Seleccionar el bloque y teclear sigue siendo una acción explícita (el bloque se selecciona primero; Backspace o Delete lo borran en un paso visible)."

### 3.2 Requisitos del issue y cómo los concreta este diseño

| Req. | Texto del issue (resumido) | Concreción |
|---|---|---|
| 1 | Aviso legible en Rich, chrome en inglés, con el diagnóstico concreto que ya produce el parser | El parser hoy solo da el código: no distingue el atributo ni un `href` inseguro **[V·sonda]**. El core gana el detalle por atributo (§5, §6.2), y el aviso usa la tabla 3.3 |
| 2 | Fix (si es determinista), Remove component keep text y Edit in Source | Tabla 3.3. Fix se ofrece solo si su resultado re-parsea **válido** en el mismo contexto (I6) |
| 3 | Ninguna acción pierde texto; prueba de bytes del contenido | Definición operativa en §3.4, con un oráculo de bytes en el core y uno de texto y bytes canónicos en la shell |
| 4 | Borrar por accidente es recuperable y no ocurre con una tecla sin selección explícita | Guard de teclado (M16–M19), D3 para teclear y deshacer en un paso |
| 5 | Atómicas en undo/redo; guardado canónico; sin segundo store | I3 e I4 |
| 6 | Web y desktop | El mismo adapter y los mismos comandos; las pruebas cubren las dos shells (T9, T13) |
| Failure 1 | Una reparación que produce otro inválido queda opaca con su nuevo diagnóstico | Defensa en el comando (M5). Normalmente no se llega, porque Fix solo se ofrece pre-validado |
| Failure 2 | Diagnóstico desconocido: solo Remove y Edit in Source | M29. Si el span re-parsea válido en su contexto, aparece "Restore component" (Fix) |
| Failure 3 | El documento cambia con el aviso abierto: revalidar antes de mutar | I5 y M13 |

### 3.3 Diagnóstico, aviso y acciones

Textos de UI en inglés; son orientativos y el BUILD los ajusta. Los mensajes nombran kinds y atributos, nunca valores privados.

| Caso (diagnóstico del core) | Ejemplo | Aviso | Fix | Remove component, keep text | Edit in Source |
|---|---|---|---|---|---|
| Etiqueta sin cerrar (`unbalanced-component`) | `invalid/unbalanced.md` | "`<Card>` is never closed. Everything after it is kept as source." | "Close `<Card>` at the end": añade `</Card>` al final del span. Se ofrece solo si el resultado es válido (en `unbalanced.md`, sí **[V·sonda]**) | Quita solo la etiqueta de apertura; el resto vuelve a ser Markdown editable (título según D2) | Sí |
| Conocida autocerrada (hoy `invalid-attributes`) | `<Card title="x" />` | "Components can't be self-closing." | "Convert to `<Card>…</Card>`": la apertura y el cierre van juntos y el resto del span queda como Markdown. Solo si es válido | Quita el token; el resto vuelve a ser Markdown | Sí |
| Atributo no permitido: desconocido, manejador `on*`, `style`, expresión `{…}`, spread, sin comillas o duplicado (`syntax-and-roundtrip.md:18`) | `onClick="steal()"`, `title={runCode()}` | "`onClick` isn't allowed on Card." (una línea por atributo; desde el cuarto, "and N more") | "Remove invalid attributes". Solo si queda válido. En `invalid/attributes.md` **no** se ofrece, porque la Card se quedaría sin `title` **[V·sonda]** | Sí | Sí |
| Enlace inseguro (`href` no pasa `safeUrl`, `lib/document-components/registry.ts:111-123, 211`) | `href="javascript:alert(1)"` | "The Card link isn't safe (`javascript:`)." | "Remove unsafe link". `href` es opcional, así que la Card queda válida **[V·sonda]** | Sí | Sí |
| Valor inválido de un atributo opcional | `columns="7"` en CardGroup | "`columns` must be 1–4." | "Remove `columns`", si queda válido | Sí | Sí |
| Falta un atributo obligatorio, o su valor es inválido | `<Card>` sin `title`; `<Entity type="person">` sin `id` | "Card needs a title." | No: no hay un valor determinista | Sí (con la regla de texto privado de D2) | Sí |
| Etiqueta desconocida cerrada (`unknown-component`) | `invalid/unknown-tag.md` | "Odessay doesn't know `<FuturePanel>`. Its source is kept as is." | No | Sí: el contenido interno; los atributos se van con las etiquetas (título según D2) | Sí |
| Token suelto: desconocida sin cerrar o autocerrada (recuperación de Rich) | `List<String>`, `<Widget mode="future" />`, `<OpenPanel mode="future">` | "`<String>` looks like a component tag." | No | Se llama "Keep as text": el token pasa a ser texto literal (un nodo de texto) y se guarda escapado (`&lt;String&gt;`). No hay etiquetas que quitar: el token **es** el texto | Sí |
| Anidado no permitido (`invalid-nesting`) | Card dentro de Tip; Accordion sin AccordionGroup; Highlight que cruza párrafos; Tabs con un solo Tab | "Card can't go inside Tip." | No: mover no es determinista | Sí: el contenido se re-parsea en su sitio, y cada hijo inválido muestra su propio aviso | Sí |
| Contenido vacío (`invalid-content`) | `<Entity id="e" type="person"></Entity>` | "Entity is empty." | No | "Remove empty component": no hay texto que conservar | Sí |
| Componente válido sin adapter Rich (`rich-adapter-unavailable`) | ProtectedText, Tabs, AccordionGroup, Steps, CardGroup, CodeGroup | Aviso **neutro**, no de error: "Tabs can't be edited in Rich yet. Its content is preserved." | No | **No (D1)** | Sí |
| Diagnóstico desconocido o span válido en su contexto | `reason` que no reconoce el parser actual, o un `body_json` web antiguo | "This source couldn't be shown as a component.", o "This component can be restored." | "Restore component" si re-parsea válido: se re-materializa igual, sin tocar bytes | Sí | Sí |

Si un span tiene varios problemas a la vez, Fix compone todas las reparaciones deterministas y se ofrece solo si el resultado compuesto es válido.

### 3.4 Qué es "el texto" para las pruebas

- **Texto interno:**
  - en un span con apertura y cierre, los bytes entre el final de la etiqueta de apertura y el inicio de la de cierre, sin el salto de línea de frontera que la gramática ya ignora (`document-component-extensions.ts:97`; `lib/document-components/serializer.ts:27`);
  - en un span sin cierre, hasta el final del span;
  - en un token suelto, el token entero.
- **Oráculo de bytes (core):** en `fix` y en `keepText`, el texto interno aparece como una subcadena contigua y exacta de `raw`. Fix solo toca la etiqueta de apertura o añade la de cierre; el párrafo de título de D2 es el valor decodificado del atributo; "Keep as text" usa el `raw` entero. Es la "prueba de bytes del contenido" del requisito 3.
- **Oráculo de shell:** después de la acción y del guardado, el `.md` (desktop) y la fila local (web) son iguales a lo que produciría ese mismo Markdown escrito en Source y llevado a Rich: la forma canónica de una edición Rich. El texto visible del rango sustituido es el texto visible del contenido interno, y la reapertura muestra lo mismo.
- **Por qué no bytes exactos en el `.md`:** la acción es una edición Rich, y se aplica la decisión 1 de ODE-697. Quien necesite los bytes exactos tiene "Edit in Source" (ODE-697 lo garantiza).

### 3.5 Invariantes

- **I1. Sin pérdida de texto.** Ninguna acción elimina caracteres del texto interno (oráculo de bytes). Tampoco texto de título, que sigue D2.
- **I2. Solo acciones explícitas.** Nada se repara al abrir, al alternar de modo ni al guardar. "A diagnostic never authorizes a partial rewrite" (`syntax-and-roundtrip.md:54`): la reparación ocurre por un clic, Enter o Space del usuario sobre un botón.
- **I3. Una acción, un paso de undo.** Una acción es una transacción y un paso de undo, y redo la vuelve a aplicar. `closeHistory` antes y después impide que se agrupe con la escritura de los 500 ms vecinos (`node_modules/@tiptap/extensions/dist/index.js:666-672`, `newGroupDelay: 500`) **[V]**.
- **I4. Guardado canónico.** Las acciones pasan por el camino de la edición Rich. Sin llamadas a persistencia desde el NodeView o los comandos, sin store nuevo y sin atributos persistidos nuevos.
- **I5. Revalidar antes de mutar.** `getPos()` debe ser un número y en esa posición debe seguir un nodo opaco con el mismo `raw`. Si no, no se muta y se anuncia "This block changed. Review it again.".
- **I6. Fix pre-validado.** Fix solo se ofrece si su resultado re-parsea sin diagnósticos en el mismo contexto. Si al aplicarlo resulta inválido (por una carrera), queda opaco con el nuevo diagnóstico y sin pérdida.
- **I7. Sin borrado de una tecla.** Ninguna tecla borra un nodo opaco sin selección explícita. Con selección explícita, el borrado es visible y se deshace.
- **I8. Solo en el editor.** La UI de reparación existe solo en el NodeView del editor. Lectura, compartir, export y `body_text` no cambian.
- **I9. Diagnóstico local y barato.** Coste O(|raw|), al crear el NodeView o al cambiar `raw`. Nunca en la ruta de cada tecla ni sobre el documento completo.
- **I10. Una sola gramática.** El diagnóstico usa el tokenizer de etiquetas del parser del core. El adapter no tiene parser propio.

### 3.6 Teclado y accesibilidad

- **Bloque.** `<section role="group">` con `aria-label` "Card component with a problem", o "Tabs component" en el caso neutral (D1).
  - El mensaje tiene un `id`, y el nodo del editor lleva `aria-describedby` hacia él. Al llegar con las flechas, el lector de pantalla anuncia el problema.
  - El source se muestra en solo lectura y no recibe foco.
- **Botones.** `<button type="button">` nativos con `click`, así que Enter y Space funcionan sin código extra. Nunca solo `pointerdown`: es la lección de ODE-532. Nunca `preventDefault` en `pointerdown`, que en WKWebView mata el `click`.
  - El nombre accesible incluye el kind y la acción, por ejemplo "Fix Card: remove unsafe link".
- **Llegar a las acciones.** Con el nodo seleccionado (flechas o clic), **Enter** lleva el foco al primer botón.
  - **Escape** desde un botón devuelve el foco al editor con el nodo aún seleccionado, como los NodeViews de Card y de Mermaid (`document-component-extensions.ts:186, 667, 702`).
  - Ningún aviso roba el foco al abrir ni al hidratar.
- **Inline.** El chip conserva el texto que muestra hoy, sin cambiar el layout del párrafo (`workflow/context/features/odessay-prosemirror-tiptap.md:196`).
  - El mensaje y las acciones aparecen en un panel pequeño, no modal, cuando el chip está seleccionado.
  - Enter lleva el foco al panel; Escape o el blur lo cierran (`odessay-prosemirror-tiptap.md:194`).
  - Sin modales, como exige ODE-537 (popovers cortos, accesibles con teclado y que se cierran con Escape).
- **Región `aria-live` del adapter.** Anuncia "Component fixed.", "Component removed. Text kept.", "Opened in Source." y "Use Undo to restore it.".
- **Estilos.** Con los tokens de `app/globals.css`, en los dos temas, sin colores fijos.

---

## 4. Matriz de salidas y fallos

- **Hoy** = rama de fase @ `96d1f105`.
- **¿Texto?** = qué pasa con el texto del componente.
- **¿Identidad?** = UUID y ruta del documento.
- Las pruebas T1–T20 están en §7. Un límite lleva su razón.

| # | Salida | Hoy | Propuesto | ¿Texto? | ¿Identidad? | Prueba o límite |
|---|---|---|---|---|---|---|
| M1 | Abrir un documento con cada diagnóstico del corpus (`invalid/*`, `valid/master.md` LF y CRLF) | Átomo con el source y un tooltip genérico, sin diagnóstico (`opaque-source-extensions.ts:164, 217-223`) **[V]** | Aviso de la tabla 3.3 con sus acciones. Abrir no escribe | Intacto | Igual | T1, T8, T9 |
| M2 | Alternar Rich ↔ Source sin editar con opacos presentes | No escribe: el toggle limpio sale antes de `setContent` (`editor-shell.tsx:1512-1515`), y lo prueba `tests/editor-shell-document-components-desktop.test.tsx`, caso "reabrir desde disco…" **[V]** | Igual. El NodeView no despacha transacciones al construirse | Intacto | Igual | T9 (control: cero escrituras) |
| M3 | Fix determinista: cerrar, quitar `href` inseguro o atributos inválidos, expandir la autocerrada, restaurar | No existe | Una transacción. El componente vuelve a ser un nodo editable. Guardado canónico y reapertura igual | Texto interno idéntico (oráculo de bytes del core); en el `.md`, la forma canónica | Igual; sin documento nuevo | T1, T4, T9 |
| M4 | Fix cuyo resultado sería inválido (`invalid/attributes.md`: la Card queda sin `title`) | — | **No se ofrece** | — | — | T1 (el Fix es `null`) |
| M5 | Fix aplicado cuando el contexto cambió entre pintar y pulsar (carrera) | — | Recalcula el plan con el nodo vivo. Si el resultado ya no es válido, el nodo queda opaco con el nuevo diagnóstico | Intacto | Igual | T5 |
| M6 | Remove component, keep text: bloque, inline, anidado en Tip y la cola de una etiqueta sin cerrar | No existe | Párrafos editables. Bloque: el título según D2. Inline: el texto en el mismo párrafo. Tip: los párrafos quedan dentro del Tip **[V·sonda, viabilidad]** | El texto interno en los nodos nuevos | Igual | T1, T4, T9 |
| M7 | Remove con texto privado no vacío (`comment` de Annotation, `reason` de ProtectedText) | — | No se ofrece (D2). Quedan Fix, si aplica, y Edit in Source. COMP-05 (`extra="invalid"`) se repara con Fix y conserva el id | El comentario se conserva | El id de la anotación se conserva | T1, T13 |
| M8 | Keep as text (token) | No existe | Un nodo de texto con el token. El serializer de texto escapa `<` y `>` (`node_modules/tiptap-markdown/dist/tiptap-markdown.es.js:211-213, 628`) **[V]**, así que el `.md` guarda `&lt;String&gt;` y al reabrir es texto, no opaco **[I]**. Insertarlo como Markdown dejaba `&lt;` literal en la sesión **[V·sonda]**: por eso es un nodo de texto | Mismos caracteres en Rich; en Source se ven escapados, como hoy al teclear `<` en Rich | Igual | T4, T9 |
| M9 | Edit in Source | Toggle manual, sin posición | Source con el span seleccionado (ordinal entre los opacos) y sin escritura. La edición siguiente sigue las reglas de ODE-697 | Intacto | Igual | T10 |
| M10 | Edit in Source con dos spans de `raw` idéntico | — | Selecciona el que corresponde al nodo, por ordinal y no por la primera aparición | Intacto | Igual | T10 |
| M11 | Edit in Source sin poder localizar el span | — | Source con el caret al inicio, anuncio "Couldn't find the block in the source." y sin escritura | Intacto | Igual | T10 (la unidad del localizador con un recuento distinto). **Límite** en la shell: sin divergencia entre la serialización y la travesía no hay entrada de producción que lo provoque |
| M12 | Undo y redo de cada acción, también con escritura previa a menos de 500 ms | — | Un paso de undo restaura el Markdown exacto y redo lo reaplica **[V·sonda para el undo sin escritura previa]** | Restaurado | Igual | T4 |
| M13 | El documento cambia con el aviso o el panel abiertos: edición en otro sitio, recarga externa, cambio de pestaña | — | Revalidación (I5). Si el nodo ya no está o su `raw` cambió, no se muta. Si el `setContent` de otro documento destruyó el NodeView, `getPos()` no da posición y la acción se aborta **[I]** | Intacto | Sin mutar otro documento | T5 |
| M14 | Salir justo después de una acción, antes del debounce: pestaña, cerrar pestaña, desmontar, cerrar ventana | — | Es una edición Rich: el protocolo de salida existente la vacía y la espera | Durable | Igual | T11 (cambio de pestaña). El resto lo cubre la suite de salida de Rich: la acción no añade salidas |
| M15 | Fallo de escritura después de una acción | — | `failed` y "Needs attention", como cualquier edición Rich (`persistence-coordinator.ts:729-740`, COMP-13) | En el editor, no durable | Igual | T12. **Límite:** salir con la escritura fallida es de ODE-692 (D692) |
| M16 | Backspace al inicio del párrafo siguiente; Delete al final del anterior (bloque) | Borra el átomo con una tecla **[V·sonda]** | La primera tecla lo selecciona y la segunda lo borra | Intacto tras la primera tecla | Igual | T6, T18 |
| M17 | Backspace o Delete junto a un opaco inline | Borrado nativo del navegador con una tecla **[I]** | El guard selecciona el nodo antes de borrar | Intacto tras la primera tecla | Igual | T6 (comando del guard). **Límite:** el borrado nativo de contenteditable no existe en happy-dom; la prueba en navegador real queda para la verificación del dueño |
| M18 | Párrafo vacío tras el bloque, y Backspace | Selecciona el bloque y borra el párrafo vacío **[V·sonda]** | Igual | Intacto | Igual | T6 (control) |
| M19 | Bloque seleccionado y Backspace, Delete o Cut | Lo borra; undo lo restaura con el Markdown exacto **[V·sonda]** | Igual: explícito, visible, un paso de undo, más el anuncio "Use Undo to restore it." | Recuperable con undo | Igual | T7, T18 |
| M20 | Bloque seleccionado y una tecla de texto o IME | Lo reemplaza **[V·sonda]** | No lo reemplaza (D3). Anuncio | Intacto | Igual | T7 |
| M21 | Selección de rango que cruza el bloque, y borrar o escribir | Lo borra con el rango | Igual: es selección explícita. Undo lo restaura | Recuperable con undo | Igual | T7 (control de undo). **Límite:** el issue solo protege la tecla sin selección explícita |
| M22 | Componente válido sin adapter Rich | Átomo con el texto plano y el mismo tooltip **[V·sonda]** | Aviso neutro con solo Edit in Source (D1) | Intacto | Igual | T17 |
| M23 | Web: quitar el último opaco con anotaciones presentes | — | `accepted` pasa a `true`; se podan solo las filas del dueño ausentes del cuerpo. Una Annotation reparada con Fix conserva su id y su fila | Comentarios conservados | Igual | T13 |
| M24 | Lectura, compartir, export y `body_text` | `text` y `reason`; sin `raw` (`content-sanitizer.ts:68-74`) **[V]** | Sin cambios. El aviso no aparece | Igual | Igual | T14 |
| M25 | Editores temporales de serialización | No hay NodeView | El NodeView se instancia sin efectos laterales; los bytes no cambian | Igual | Igual | T15 |
| M26 | Documento grande, o un span enorme (una etiqueta sin cerrar al principio de un archivo con 1000 componentes) | Un átomo | Diagnóstico O(|raw|), una vez por NodeView. Escribir en otro sitio no re-diagnostica | Igual | Igual | T3, T16 |
| M27 | Teclado y lector de pantalla | Solo el tooltip | El contrato de §3.6 | — | — | T8, T20. **Límite:** la geometría del panel inline en WKWebView requiere el DMG (verificación del dueño) **[NV]** |
| M28 | Crash después de una acción | — | Como cualquier edición Rich (150 ms + 4 s) | Se pierde lo que estaba en memoria | Igual | **Límite** común a Rich: es la memoria del proceso |
| M29 | Diagnóstico desconocido, o span válido en su contexto (`body_json` antiguo) | Átomo | Mensaje genérico. "Restore component" si re-parsea válido | Intacto | Igual | T19 |
| M30 | Conflicto externo (WATCH-07) mientras se repara | El guardado automático está bloqueado en los dos modos (`useEditorPersistence.ts:434-436`) | Igual: la acción es una edición Rich y hereda el guard | Como en Rich | Igual | **Límite** común a Rich y fuera de alcance |

**Comprobación de la regla del dueño.** Las únicas salidas en que el texto puede no quedar durable son:
- M15, la escritura fallida (ODE-692);
- M28, el crash;
- M30, el conflicto sin resolver.

Las tres son comunes a cualquier edición Rich. El borrado explícito (M19, M21) se recupera con undo. Ninguna acción de reparación quita texto (I1).

---

## 5. Funciones y archivos a tocar

| Archivo | Cambio |
|---|---|
| `lib/document-components/types.ts` | `DocumentAttributeProblem { name, code, start, end }` con los códigos `unknown`, `duplicate`, `malformed` (sin comillas, expresión o spread), `event-handler`, `style`, `missing-required`, `invalid-value` y `unsafe-url`. Campos opcionales `attributes?` y `shape?` (`closed`, `unclosed`, `self-closing`, `token`) en `DocumentDiagnostic`, compatibles hacia atrás. `ComponentRepairPlan` |
| `lib/document-components/parser.ts` | `parseTag` registra un problema por atributo en lugar de devolver `valid: false` en el primero (`:101-131`), sin perder O(longitud de la etiqueta). `attributesValid` (`:474-482`) usa la misma lista. Las diagnosis de `invalid-attributes` llevan `attributes`. Nueva opción `context: { parent }` para diagnosticar un span en su contexto. La complejidad de COMP-20..24 no cambia |
| `lib/document-components/registry.ts` | Marca por atributo para D2: `text: "public"` (`title`), `text: "private"` (`comment`, `reason`) y `url: true` (`href`) |
| `lib/document-components/repair.ts` (nuevo, puro, sin TipTap) | `planComponentRepair(raw, { parent })` → `{ diagnosis, fix, keepText }`. `fix` está pre-validado con el parser, y el texto interno de `fix` y de `keepText` es una subcadena exacta de `raw` (el `raw` entero en un token). Una sola gramática: reutiliza el parser con `context` |
| `lib/editor/opaque-source-extensions.ts` | NodeView de bloque e inline (§3.6); comandos `repairOpaqueSource`, `unwrapOpaqueSource` y `editOpaqueSourceInSource`; guard de Backspace/Delete y sus alias (`@tiptap/core/dist/index.js:5719-5736`) con prioridad sobre el keymap del core; `handleTextInput` para D3; región `aria-live`; opción `onEditInSource`; `listOpaqueSpans(markdown)` exportada sobre `collectOpaqueSpans` (`:47-75`) para localizar spans en Source |
| `lib/editor/document-serialization.ts` | `parseMarkdownFragmentToContent(markdown)`: el mismo pipeline que la apertura (`materializeMarkdownForRichParser` en un editor temporal), sin separar frontmatter (`:61-87`). Así un `---` del contenido no se toma como frontmatter |
| `lib/editor/extensions.ts` | Pasa `onEditInSource` a los dos nodos opacos (`:130-131`). Se toca después de que mergee N691 (ODE-691, el mismo archivo) |
| `components/editor/editor-shell.tsx` | `handleEditOpaqueInSource`: `handleToggleMode("markdown")` + `listOpaqueSpans` + `queueMarkdownSelectionRestore`. Se pasa a `createEditorExtensions` |
| `app/globals.css` | Estilos del aviso, el chip y el panel, con tokens y en los dos temas |
| Tests | §7 |
| `workflow/quality/capability-integration-map.md` | §8.3 |

**No se toca:**
- `lib/editor/persistence-coordinator.ts`, `hooks/useEditorPersistence.ts`, DocumentService, Rust, SQLite ni Supabase: el guardado es el de cualquier edición Rich.
- `materializeOpaqueSourceForRichParser` ni los placeholders: los bytes del `.md` no cambian al abrir.
- Los renderers de lectura (ODE-536), el export (ODE-538) ni `content-sanitizer.ts`.
- `document-component-extensions.ts` (Tip, Info, Card, CodeBlock).
- El guard de ProtectedText (ODE-534), el catálogo de invocación (ODE-537), GapCursor y TrailingNode (ODE-691) ni el toggle de ODE-697: se reutilizan.

---

## 6. Verificaciones abiertas

### 6.1 Resueltas

1. **Owner del NodeView opaco.** Resuelto en §2.5: `opaque-source-extensions.ts`. Hoy no tiene NodeView (`:168-240`) **[V]**.
2. **API de diagnósticos del parser.** Resuelto en §6.2 y §5. La API actual no basta para el requisito 1.
3. **Qué reparaciones son deterministas.** Resuelto en la tabla 3.3:
   - cerrar al final del span;
   - expandir una etiqueta autocerrada;
   - quitar atributos inválidos opcionales o no permitidos, y el `href` inseguro;
   - restaurar un span válido en su contexto.

   Las cuatro, solo si el resultado es válido (I6). Faltar un atributo obligatorio, el anidado y lo desconocido no tienen Fix.
4. **"Remove component, keep text" como párrafos editables.** Resuelto en §3.3 y §3.4. Es viable con el pipeline de materialización y se deshace en un paso **[V·sonda P4]**.
   - **Trampa:** insertar un token como Markdown dejó `&lt;` literal en la sesión **[V·sonda]**. Por eso "Keep as text" usa un nodo de texto.
   - **Trampa:** el título se pierde si nadie lo conserva **[V·sonda]**. Lo resuelve D2.
5. **Borrado accidental.** Resuelto en M16–M21 con la sonda P2/P3. El guard vive en el adapter opaco y no cambia `---` ni la imagen; esos son de ODE-691.
6. **Teclado y accesibilidad.** Resuelto en §3.6.
7. **Relación con ODE-691 y ODE-697.** Resuelto en §6.3.
8. **"Pendiente antes de BUILD" del issue:**
   - el Recon de área (owner del NodeView, API de diagnósticos y helper de reparación) es este documento más el Recon Pack de Linear;
   - el Architecture Contract está en la descripción del issue;
   - las decisiones están en §9.
9. **Dependencias del issue:**
   - **ODE-529** (In Progress, paso 1 de N integrado) es dueño de la gramática y los diagnósticos. Este diseño amplía el core en su área sin abrir otro parser; el BUILD se coordina con el paso 2 de ODE-529.
   - **ODE-540** quedó reducido a vista (comentario "Replanteo (Hugo, 2026-10-08)"): no hay conflicto, porque el opaco no necesita la señal de layout.
   - **ODE-537** no existe todavía como catálogo. Los comandos de reparación son comandos TipTap, así que el catálogo los podrá listar después.
   - **ODE-536** no se ve afectado: la lectura no cambia.

### 6.2 API de diagnósticos: estado actual y propuesta

**Hoy [V]:**
- un diagnóstico es `{ code, message, start, end, kind }`, con mensajes genéricos ("Invalid attributes for Card.", `parser.ts:485`);
- `parseTag` devuelve `valid: false` en el **primer** problema (`:103, 115, 119, 124, 130`), así que en `title={runCode()} onClick="steal()" unknown="value"` ni siquiera tokeniza `onClick`;
- los requisitos y validadores se comprueban en bloque (`:474-482`);
- el nodo de Rich solo guarda `reason`.

Consecuencia **[V·sonda]**: `href="javascript:…"`, una `<Card>` sin `title`, un atributo duplicado y una etiqueta autocerrada dan el mismo `invalid-attributes`. No se puede decir "enlace inseguro" ni ofrecer "Remove unsafe link".

**Propuesta:**
- **Diagnósticos con detalle.** El tokenizer de etiquetas acumula problemas por atributo y sigue hasta `>`. Ya está acotado por `close`, así que el coste sigue en O(longitud de la etiqueta). `parseControlledMarkdown` adjunta `attributes` y `shape` a sus diagnósticos, y cualquier consumidor del core los recibe.
- **Plan de reparación local.** `planComponentRepair(raw, { parent })` re-parsea solo el span, con `recoverUnclosedUnknownTags: true` como Rich y con el padre del nodo en ProseMirror:
  - `doc` → `document`;
  - `tip`, `info` o `card` → `Tip`, `Info` o `Card`;
  - un textblock → `text-block`.

  El plan se recalcula en el NodeView y no se persiste.
- **Una gramática.** El parser decide la validez con la misma lista de problemas. Una prueba diferencial sobre el corpus y el fuzz existente (T2) comprueba que la aceptación no cambia.

### 6.3 Relación con ODE-691 y ODE-697

**ODE-691** (caret después de un átomo; N691 en BUILD en esta ola):
- GapCursor permite escribir **después** de un opaco final sin seleccionarlo. Desde un gap, Backspace ya selecciona el átomo antes de borrarlo (`selectNodeBackward`, `prosemirror-commands/dist/index.js:148-163`) **[I]**.
- Lo que GapCursor no cubre es el borrado de una tecla desde un cursor de **texto** (M16). Eso lo resuelve este guard, solo para nodos opacos.
- Si Hugo quiere la misma regla para `---` y la imagen, se generaliza el guard en un solo owner; no se duplica.
- D3 es más estricta que el requisito 2 de ODE-691 solo para bloques con texto.
- `extensions.ts` es común: el BUILD de ODE-694 entra después del merge de N691.

**ODE-697** (Source guarda Markdown directo):
- "Edit in Source" usa el toggle canónico. Con ODE-697, el textarea muestra los bytes del `.md` mientras no haya edición Rich, y lo que el usuario corrige en Source llega al `.md` byte a byte. Al volver a Rich se regenera la vista: si el componente quedó válido se ve como componente, y si no, con su nuevo aviso.
- Sin ODE-697, "Edit in Source" funciona igual, pero la corrección llega canonicalizada (`editor-shell.tsx:1531`).
- Fix y Remove son ediciones Rich: canonicalizan según la decisión 1 de ODE-697 (§3.4).

### 6.4 Marcadas para el BUILD

- **[I] Saltos de línea blandos dentro del texto interno.** Siguen el perfil Rich de siempre. El `it.fails` de ODE-684 ya muestra que el salto tras `<OpenPanel>` se pierde en Rich (`tests/document-components-rich-preservation.test.ts:79-82`). T4 incluye un párrafo multilínea y fija el resultado: debe ser el mismo que el de ese Markdown escrito en Source.
- **[I] Ids de anotación repetidos.** Al desenvolver contenido que trae anotaciones, `materializeControlledAnnotations` deduplica dentro del fragmento y no contra el documento (`markdown-format.ts:360-396`). T4 incluye un id ya presente en el documento.
- **[I] `getPos()` de un NodeView destruido.** Se espera que no dé posición; T5 lo comprueba.
- **[I] Contenido de bloque en una posición inline.** En CRLF, un cuerpo de bloque con varios párrafos dentro de un opaco inline debe partir el párrafo (`replaceRange` con slice abierto). T4 incluye el caso.
- **[NV] Geometría del panel inline y borrado nativo** en WKWebView: requieren el DMG o un navegador real.
- **[I] El `---` y la imagen conservan el comportamiento que decida ODE-691.** T6 incluye un control positivo con `---`.

---

## 7. Plan de pruebas y mutaciones

Se aplican las reglas de `workflow/quality/capability-proof-contract.md`:
- **Entrada de producción.** Botones reales del NodeView y teclado real (`editor.commands.keyboardShortcut`, eventos de teclado sobre los botones), en la shell real con `tests/support/editor-shell-harness.tsx`. Se reutilizan `createMasterDocument`, `switchMode`, `replaceMarkdownSource`, `richNodesOfType` y `placeCaretAfter` (`tests/editor-shell-document-components-desktop.test.tsx:140-222`).
- **Servicios reales:** temp-fs en desktop y fake-indexeddb en web. Dobles solo en las fronteras.
- **Aserción** después del evento de completitud y sobre el resultado canónico: bytes del `.md`, fila, DOM.

Un bug real se escribe primero como `it.fails`, en su propio commit.

| Prueba | Escenario | Mutación que debe ponerla roja |
|---|---|---|
| T1 | Core (`tests/document-components-repair.test.ts`, nuevo): `planComponentRepair` para cada span del corpus (`invalid/*`, `master.md` LF y CRLF) y los sintéticos de la tabla 3.3. Comprueba código, kind, problemas por atributo, `fix` (o `null`), y que el texto interno de `fix` y de `keepText` sea una subcadena exacta de `raw` | Plan sin detalle por atributo → rojo en "unsafe-url". Fix sin re-parsear → rojo en `attributes.md` (debe ser `null`). `keepText` que recorta o normaliza → rojo |
| T2 | Core: aceptación del parser antes y después, idéntica sobre el corpus y el fuzz de `tests/document-components-engine.test.ts` | El tokenizer acepta un valor sin comillas → rojo |
| T3 | Core, complejidad: los contadores de COMP-20..24 siguen dentro de su cota con el tokenizer que acumula problemas, y una etiqueta con 1000 atributos inválidos se diagnostica en O(longitud de la etiqueta) | Re-escanear desde el inicio de la etiqueta por cada atributo → rojo |
| T4 | Editor (`tests/opaque-source-repair-commands.test.ts`, nuevo; TipTap real). Para cada acción y caso: documento resultante; `serializeEditorToMarkdown` igual al round-trip Rich del Markdown esperado; texto visible; undo exacto en un paso; redo; escritura previa a menos de 500 ms; párrafo multilínea; id de anotación repetido; CRLF con varios párrafos en posición inline; token → nodo de texto y `&lt;` al serializar | Sin `closeHistory` → rojo (undo agrupa la escritura). Token insertado como Markdown → rojo (`&lt;` en la sesión). Remove sin título (contra D2-A) → rojo |
| T5 | Editor: cambia el nodo, su `raw` o el documento entre pintar y pulsar → no se muta, y aparece el anuncio. Fix con el contexto cambiado → queda opaco con el nuevo diagnóstico | Quitar la revalidación → rojo |
| T6 | Editor: Backspace al inicio del párrafo siguiente y Delete al final del anterior seleccionan y no borran; la segunda tecla borra; los alias (`Mod-Backspace`, `Alt-Backspace`, `Ctrl-h`, `Ctrl-d`, `Alt-Delete`, `Alt-d`, `Ctrl-Alt-Backspace`) también; opaco inline adyacente. Controles: párrafo vacío (M18) y `---` sin cambios | Quitar el guard → rojo (vuelve el borrado de una tecla) |
| T7 | Editor: con el nodo seleccionado, una letra y el IME no lo reemplazan (D3) y hay anuncio; Backspace, Delete y Cut lo borran en un paso; undo lo restaura; una selección de rango que lo cruza también se deshace | Quitar el `handleTextInput` → rojo (vuelve el reemplazo) |
| T8 | NodeView (DOM): texto del aviso por diagnóstico, botones según la tabla 3.3, `role` y `aria-describedby`; Enter y Space activan; Escape devuelve el foco; Enter con el nodo seleccionado enfoca la primera acción | Handler de `pointerdown` en lugar de `click` → rojo (Enter y Space no activan) |
| T9 | Shell desktop (`tests/editor-shell-malformed-component-repair-desktop.test.tsx`, nuevo): para cada span del corpus y cada acción disponible, pulsar el botón real y vencer la ventana de guardado. Se comprueba: bytes del `.md`, la misma ruta, un solo archivo (sin documento nuevo), una escritura por acción y reapertura igual. Control: un toggle limpio no escribe. COMP-05: Fix sobre `extra="invalid"` conserva el id `desktop-opaque-531` | Ofrecer Fix en `attributes.md` → rojo. El comando llama a persistencia además del update → rojo (dos escrituras) |
| T10 | Shell desktop: Edit in Source selecciona el span (`selectionStart` y `selectionEnd`) sin escribir; con dos `raw` idénticos, el segundo botón selecciona el segundo; corregir en Source y volver a Rich muestra el componente. Unidad del localizador con un recuento distinto → caret al inicio y anuncio | Localizar por la primera aparición de `raw` → rojo en el caso duplicado |
| T11 | Shell desktop: acción y cambio de pestaña antes del debounce → el `.md` tiene el resultado (protocolo de salida) | — (la red es la suite de salida; la acción no añade salidas) |
| T12 | Shell desktop: la escritura falla tras una acción (`holdWriteFile` y fallo en `tests/integration/documents/support/real-desktop-doubles.ts`) → "Needs attention", sin Saved; el reintento persiste | — (se reutiliza COMP-13) |
| T13 | Shell web y ruta (`tests/editor-shell-malformed-component-repair-web.test.tsx`, nuevo, y `tests/api/writings-annotation-projection-route.test.ts`): subconjunto del corpus; una Annotation con `comment` no ofrece Remove; Fix conserva el id y la fila de margen; quitar el último opaco poda solo las filas ausentes (control: COMP-03) | Ofrecer Remove con un comentario → rojo. Fix que regenera el id → rojo |
| T14 | Lectura y export: `renderWritingBodyHtml` y `buildWritingExportDocument` con opacos iguales a su salida actual; sin "Fix", "Remove component" ni "Edit in Source" | Poner el aviso en `renderHTML` → rojo |
| T15 | Editores temporales: `tests/document-components-rich-preservation.test.ts` sigue igual byte a byte; espía de `addEventListener` en `window` y `document` durante `serializeDocumentToMarkdown` → 0 | Un listener global en el NodeView → rojo |
| T16 | Rendimiento: un contador de `planComponentRepair` da 1 por NodeView; escribir 100 caracteres en otro sitio con N opacos → 0 llamadas | Diagnosticar en `update()` sin memo → rojo |
| T17 | D1: `valid/nesting.md` y el ProtectedText del maestro muestran aviso neutro y solo Edit in Source | Ofrecer Remove → rojo |
| T18 | Shell desktop, guard de teclado de punta a punta: Backspace real al inicio del párrafo siguiente; tras la ventana de guardado el `.md` conserva el span. Un segundo Backspace lo quita del `.md`, y Cmd+Z lo devuelve byte a byte en el siguiente guardado | Quitar el guard → rojo (el primer Backspace ya lo quita del `.md`) |
| T19 | Un `reason` desconocido, o un span válido en su contexto → "Restore component" lo vuelve componente | Tratarlo como error sin Fix → rojo |
| T20 | Inline: el chip del maestro CRLF tiene las mismas acciones en su panel; Enter abre, Escape cierra y el foco vuelve al editor | Panel sin Escape → rojo |

**Tests existentes que no deben cambiar [V, por lectura]:**
- `tests/document-components-rich-preservation.test.ts`, incluido el `it.fails` de `:79-82`, que sigue siendo de ODE-684;
- `tests/document-components-rich-recovery.test.ts` (COMP-22);
- `tests/editor-shell-document-components-desktop.test.tsx` y su versión web;
- `tests/editor-shell-annotation-roundtrip-desktop.test.tsx:269` (COMP-05).

Suite: la completa, porque se toca `tests/support/**` si el BUILD añade helpers.

**BUILD en dos PRs:**
1. Core (tipos, parser, `repair.ts`), comandos, guard de teclado y D3: T1–T7, T15, T16.
2. NodeView y accesibilidad, Edit in Source en la shell, web y márgenes, lectura: T8–T14, T17–T20.

---

## 8. Riesgos y contratos que cambian

### 8.1 Contratos

- **`surface-projections.md:39`** (fila "Opaque source", Rich: "diagnostic, non-destructive source affordance") y **`:9`** (Rich: "localized diagnostics"): este diseño los implementa y no cambian.
- **`syntax-and-roundtrip.md:52-54`:**
  - "Diagnostics identify the smallest recoverable span and source offsets": se añade el detalle por atributo.
  - "A diagnostic never authorizes a partial rewrite…": hay que añadir una nota. Una reparación invocada por el usuario es una edición Rich explícita, no un efecto del diagnóstico.
- **`syntax-and-roundtrip.md:67`:** se cumple. El diagnóstico es local al span y nunca corre en la ruta de cada tecla.
- **ADR de identidad y catálogo desktop:** no cambian. Las acciones son ediciones de contenido por el guardado canónico, sin efecto en identidad, binding ni orden de escritura.
- **Core:** `DocumentDiagnostic` gana campos opcionales (compatible) y el registry gana marcas de atributo.

### 8.2 Riesgos

- **R1. Canonicalización al reparar.** Una acción canonicaliza el documento entero, como cualquier edición Rich (§3.4). Si Hugo esperaba bytes exactos fuera del span, hay que decirlo en el gate. La alternativa, editar el Markdown y regenerar Rich, rompe el undo atómico y crea un segundo camino de escritura.
- **R2. Poda de márgenes en web.** Ocurre al quitar el último opaco (M23). Es legítima, y D2 la mitiga con las Annotation que tienen comentario. T13 lo fija.
- **R3. Privacidad.** Mover `comment` o `reason` al cuerpo los publicaría en lectura y export (`surface-projections.md:47`). D2 lo evita.
- **R4. NodeView en los editores temporales** de cada serialización (§2.5). El constructor debe ser barato y sin efectos (T15, T16).
- **R5. `extensions.ts`, archivo compartido.** También lo tocan ODE-691 (esta ola), ODE-534, ODE-535 y ODE-539 (`docs/design/document-components/phase12-recon.md`, grafo de conflictos). El BUILD de ODE-694 va después de N691.
- **R6. ODE-529 en curso** sobre `parser.ts`. El BUILD de ODE-694 se ordena con el paso 2 de ODE-529, o lo integra.
- **R7. ODE-534 (ProtectedText).** Cuando tenga adapter, ProtectedText deja de ser opaco y D1 deja de aplicarle.
- **R8. Diferencias por fin de línea.** El mismo span puede ser bloque o inline según el fin de línea (§2.1). Las dos presentaciones deben ofrecer lo mismo (T20).

### 8.3 Capability map

- **COMP-05** (`workflow/quality/capability-integration-map.md:262`): añadir a la nota que el span inválido ahora se puede reparar con Fix y conserva el id.
- **COMP-14** (`:78`): reescribir la nota. El opaco pasa de "recuperable" a "reparable sin pérdida", con las tres acciones.
- **COMP-22** (`:307`): nota. El token sin cerrar se puede convertir en texto ("Keep as text").
- Filas nuevas, en el rango que asigne el coordinador:
  - "Malformed component shows its diagnosis in Rich";
  - "Deterministic Fix restores a valid component";
  - "Remove component keeps its text editable";
  - "Edit in Source selects the malformed span";
  - "Opaque block needs explicit selection before deletion";
  - "Repair actions are single undo steps through the canonical save";
  - "Repair UI never reaches reading or export".

### 8.4 Seguimientos (no se crean issues)

- La regla de borrado en dos pasos para `---` y la imagen, si Hugo la quiere general (ODE-691).
- El `it.fails` de ODE-684: el salto de línea tras un token sin cerrar.
- `getMarkdownFootnotes` y las funciones que editan anotaciones en Source (`footnote-extension.ts:208-210, 307-379, 460-480`) usan `scanControlledAnnotations`, que parsea sin recuperación (`annotation-markdown.ts:80-81`) **[V]**. En ese parse, una etiqueta desconocida sin cerrar o autocerrada deja opaco el resto del documento (sonda P1: el diagnóstico de `<Widget />` llega hasta EOF) **[V·sonda]**, así que esas funciones no verían las anotaciones posteriores **[I]**. Rich no se ve afectado, porque materializa los spans opacos antes de escanear anotaciones (`markdown-format.ts:398-401`). Es ajeno a ODE-694.

---

## 9. Decisiones nuevas para Hugo

**D1. Componentes válidos que Rich aún no edita: ProtectedText, Tabs, Accordion, Steps, CardGroup y CodeGroup.**
Hoy se ven igual que los mal formados, pero no son errores: el documento es válido (fixture `valid/nesting.md`).
- **Recomendada:** aviso neutro, "<Kind> can't be edited in Rich yet. Its content is preserved.", con solo "Edit in Source". Sin "Remove": quitaría una estructura válida y, en ProtectedText, la protección (ODE-534).
- **Alternativa:** tratarlos como "diagnóstico desconocido", la lectura literal del failure mode: "Remove component, keep text" y "Edit in Source".

**D2. Texto que vive en atributos al quitar un componente.**
El issue dice "solo se pierden las etiquetas" y mide el "texto interno". Pero el `title` de Card, Tip, Info, Accordion, Tab y Step es texto que el autor escribió y el lector ve. El `comment` de Annotation y el `reason` de ProtectedText son texto privado.
- **Recomendada:**
  - el `title` pasa a ser el primer párrafo. Ya es público: `body_text` y la lectura lo muestran. Si la Card tenía un `href` seguro, ese párrafo enlaza a él;
  - el texto privado nunca pasa al cuerpo, porque se filtraría a lectura y export. Por eso "Remove component, keep text" **no se ofrece** cuando ese texto existe; quedan Fix, si aplica, y Edit in Source;
  - ids, tipos, colores, `columns`, `language`, `icon`, `ref` y un `href` inseguro son marcado y se van con las etiquetas.
- **Alternativa B:** lo literal del issue. Solo el texto interno; el título se pierde y se recupera con Undo.
- **Alternativa C:** todo el texto de los atributos pasa al cuerpo, incluido el privado (riesgo de privacidad).

**D3. Escribir con el componente seleccionado.**
El requisito 2 de ODE-691 acepta que seleccionar un átomo y teclear sea una acción explícita, y hoy eso lo reemplaza **[V·sonda]**. En un bloque que contiene texto, una sola letra borra el bloque entero, aunque se recupere con Undo.
- **Recomendada:** las teclas de texto y el IME sobre un componente opaco seleccionado no lo reemplazan: no hacen nada y se anuncia "Use Fix, Remove component or Edit in Source". Backspace, Delete y Cut lo siguen borrando en un paso visible y deshacible, y Paste lo reemplaza como cualquier selección explícita.
- **Alternativa:** el comportamiento de ODE-691 tal cual: se reemplaza y Undo lo recupera.

---

## Apéndice A. Sonda temporal (reproducible)

Archivo temporal `tests/zz-ode694-design-probe.test.ts` (happy-dom), borrado después. Se ejecutó con:

```sh
npx --yes --package=node@22 -c 'node node_modules/vitest/vitest.mjs run tests/zz-ode694-design-probe.test.ts'
```

Comprobó:
- **P1.** Para cada caso:
  - `parseControlledMarkdown(source)` y `parseControlledMarkdown(source, { recoverUnclosedUnknownTags: true })`, con sus diagnósticos;
  - los nodos opacos de `new Editor({ extensions: createEditorExtensions(), content: materializeMarkdownForRichParser(source) })`: tipo, padre, `reason` y `text`.
- **P2.** `editor.commands.keyboardShortcut("Backspace")` con el caret al inicio de "After", en `Para / <Future kind="x">…</Future> / After`, y `keyboardShortcut("Delete")` al final de "Para". Los dos dejan 0 opacos y el Markdown `Para\n\nAfter`.
- **P3.** Con un párrafo vacío tras el átomo:
  - el primer Backspace deja una `NodeSelection` con el opaco intacto;
  - el segundo lo borra;
  - `undo` lo restaura con el Markdown exacto;
  - con `NodeSelection` sobre el opaco, `insertText("x")` deja `Para\n\nx`.
- **P4.** `insertContentAt({ from, to }, materializeMarkdownForRichParser(next))` sobre el opaco:
  - el contenido interno de `<Future>` con lista da `Keep exact\n\n- item one\n- item two`;
  - cerrar `unbalanced.md` da una `card` con su título;
  - Remove de `unbalanced.md` pierde "Never rewrite me";
  - quitar los atributos de `attributes.md` sigue siendo opaco (`invalid-attributes`, sin `title`);
  - quitar el `href` inseguro da una Card válida;
  - la Entity inline da `Hello missing **id** world`;
  - el token `<String>` como Markdown deja `&lt;` literal en el texto;
  - la Card dentro de un Tip deja el Tip con "Nested body".

  En todos los casos, `undo` devuelve el Markdown original.

Diagnósticos observados (P1):

| Caso | Diagnóstico | Nodo en Rich |
|---|---|---|
| `invalid/attributes.md` | `invalid-attributes` | `opaqueSourceBlock` |
| `invalid/unbalanced.md` | `unbalanced-component` | bloque hasta EOF |
| `invalid/unknown-tag.md` | `unknown-component` | bloque |
| `valid/nesting.md` | sin diagnósticos | dos bloques `rich-adapter-unavailable` |
| `valid/master.md` (CRLF) | core: `FuturePanel` y `Widget` (`unknown-component`, `Widget` hasta EOF) y `Card` (`invalid-attributes`). Con recuperación, además `OpenPanel`, y `Widget` queda en su token | cinco `opaqueSource` inline: ProtectedText (`rich-adapter-unavailable`), FuturePanel, la Card inválida, `<Widget mode="future" />` y `<OpenPanel mode="future">` |
| `valid/master.md` (LF) | los mismos | igual, salvo la Card inválida, que pasa a `opaqueSourceBlock` |
| `href="javascript:alert(1)"`, `<Card>` sin título y un atributo duplicado | `invalid-attributes`, sin más detalle | `opaqueSourceBlock` |
| `<Card title="x" />` seguido de texto | `invalid-attributes` | `opaqueSourceBlock` hasta EOF, con el texto que sigue dentro |
| Card dentro de Tip | `invalid-nesting` | `opaqueSourceBlock` dentro de `tip` |
| `<Highlight>` que cruza párrafos | `invalid-nesting` | `opaqueSourceBlock` |
| `<Entity id="e" type="person"></Entity>` | `invalid-content` | `opaqueSource` |
| `List<String>` en prosa | `unknown-component` (core hasta EOF; con recuperación, solo el token) | `opaqueSource` con `<String>` |
