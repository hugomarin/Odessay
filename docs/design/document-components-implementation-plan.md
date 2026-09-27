# Document components — plan de implementación

Plan para llevar la exploración del [playground](./document-components-playground.md) a la integración real de TipTap, manteniendo Markdown como contrato documental. Este plan no implementa aún los componentes.

Contratos normativos del perfil:

- [Sintaxis y round-trip](./document-components/syntax-and-roundtrip.md)
- [Semántica inline](./document-components/inline-semantics.md)
- [Proyecciones por superficie](./document-components/surface-projections.md)

## Estado de planificación

**Revisión:** 2026-09-16 con `skill-performance` y `skill-product-manager`.

El diseño tiene ownership formal en **Fase 12 — Artifact Studio: Componentes Documentales**, con DoD en `workflow/define/dod-fase-12.md` y proyecto Linear [Fase 12 — Artifact Studio: Componentes Documentales](https://linear.app/hugo-marin/project/fase-12-artifact-studio-componentes-documentales-3397e6e8ea2e). `wf-define` creó y auditó los briefs `ODE-528`–`ODE-539`. La fase queda **planificada, no activa**: Fase 11 sigue siendo la fase activa y no se inicia BUILD de Fase 12 hasta una decisión explícita de activación.

### Definition check

- **Docs ↔ código:** consistentes si se distingue destino de estado actual. El ADR y este plan describen el destino; `lib/editor/annotation-markdown.ts`, `lib/editor/markdown-format.ts`, `lib/editor/annotation-document.ts` y `AnnotationReferenceNode` son la ruta legacy que este plan migra.
- **Código ↔ arquitectura:** existe una sola entrada pública de serialización, pero internamente todavía depende de TipTap y de normalizaciones regex. La extracción del Document IR es trabajo real de foundation, no una extensión cosmética.
- **Editor spec ↔ código:** reconciliado en esta revisión. El editor ya monta un `SelectionPopup` contextual; el spec anterior que prohibía cualquier toolbar al seleccionar estaba stale. También se acota `tiptap-markdown` al Markdown base: no será el parser del vocabulario controlado.
- **Roadmap ↔ Linear:** Fase 12, su DoD, el proyecto Linear y los briefs `ODE-528`–`ODE-539` están alineados. Las dependencias implementan la secuencia reader-first/writer-second y el proyecto permanece `Planned` mientras Fase 11 está activa.

## Resultado buscado

El autor podrá:

- aplicar formato Markdown nativo desde toolbar, shortcuts o sintaxis Markdown;
- convertir una selección en `Highlight`, `Annotation`, `ProtectedText` o `Entity` desde el bubble de selección;
- insertar `Tip`, `Info`, `Card`, `Accordion`, `Tabs`, `Steps` y sus grupos desde `Insert` o `/`;
- crear código y Mermaid desde `Code`, eligiendo lenguaje o vista cuando corresponda;
- editar el texto y los atributos simples dentro del componente, sin abrir un modal por defecto;
- guardar y volver a abrir el documento sin perder contenido, identidad ni estructura.

La sintaxis será de etiquetas balanceadas `PascalCase`, sin prefijo `od-`, con el texto o los bloques entre apertura y cierre. Es un perfil MDX-like controlado; no será un compilador de MDX completo.

## Alcance recomendado por incrementos

El catálogo completo se conserva como dirección, pero no debe implementarse en un solo lote.

1. **Vertical slice representativo:** foundation documental más `Annotation`, `Tip`/`Info`, `Card`, `CodeBlock` y Mermaid. Este grupo prueba identidad inline, bloque simple, atributos editables, conversión de selección, fence nativo y render costoso bajo demanda.
2. **Semántica inline:** `Entity` y `Highlight`; `ProtectedText` entra en un issue independiente por su impacto en transacciones, paste, delete, undo y acciones AI.
3. **Composición:** `Accordion`, `Tabs`, `Steps`, `CardGroup`, `AccordionGroup` y `CodeGroup`, sólo después de demostrar nesting y round-trip con el slice inicial.

Este orden reduce el riesgo sin eliminar ningún componente de la dirección de producto.

## Modelo confirmado: tres capas

El documento tendrá tres familias, pero una sola infraestructura:

1. **Markdown puro:** formato y bloques que ya tienen representación Markdown estable.
2. **Componentes propios de Odessay:** `Annotation`, `Highlight`, `ProtectedText` y `Entity`. Son semántica editorial del producto, no componentes de MDX.
3. **Componentes inspirados en MDX/Mintlify:** `Tip`, `Info`, `Card`, `Accordion`, `Tabs`, `Steps`, `CodeGroup` y sus contenedores. Se toman como patrones conocidos, pero pertenecen al perfil permitido de Odessay.

MDX aporta la sintaxis y el modelo de composición, no un catálogo universal de elementos. Por eso no se integrará “MDX” como una segunda fuente de verdad ni se permitirá JSX arbitrario. Se integrará un vocabulario controlado de componentes.

## Decisión confirmada y formalizada

La decisión de producto es reemplazar la sintaxis legacy:

```mdx
<Annotation id="ann-123" type="personal" comment="Revisar esta idea.">texto</Annotation>
```

`==texto==[@n: comentario]` queda como sintaxis de migración de documentos existentes. El serializer canónico no la producirá de nuevo.

La enmienda D2/D3 del ADR, fechada el 2026-09-16, formaliza esta decisión. El `.md` gobierna el `id`, el tipo, el comentario y el texto anclado; `margins` conserva por ese mismo `id` el estado colaborativo cloud. La sintaxis anterior se acepta sólo al leer para migrar documentos beta existentes.

Odessay sigue en una etapa beta, por lo que la compatibilidad histórica no bloquea el experimento. Aun así, la migración se implementará con lectura dual, fixtures y escritura nueva determinista para no convertir deuda temprana en una segunda ruta permanente.

## Integración con TipTap sin crear un Frankenstein

TipTap no debe interpretar tags directamente ni convertirse en un segundo parser. La integración tendrá una única tubería:

```text
.md
  ↓ DocumentParser
Document IR + validación
  ↓ TipTapDocumentAdapter
TipTap JSON / EditorState
  ↓ comandos y transacciones
TipTap JSON actualizado
  ↓ TipTapDocumentAdapter
Document IR
  ↓ DocumentSerializer
.md canónico
```

Habrá un solo vocabulario documental, pero no un registro monolítico. Las responsabilidades se dividen en contratos pequeños enlazados por un `kind` estable:

- **`DocumentComponentSpecRegistry` (shared core):** nombre, familia, inline/block, atributos permitidos, contenido, nesting y reglas de parseo/serialización.
- **`TipTapComponentAdapters` (frontend/editor):** schema, marks/nodes, comandos, transacciones y adaptación entre Document IR y TipTap JSON.
- **`ComponentRendererRegistry` (frontend/presentación):** render de lectura y primitives visuales compartidas; no conoce persistencia.
- **`ComponentInvocationCatalog` (frontend/editor shell):** toolbar, `Insert`, bubble, popovers, labels y shortcuts.

Una validación de integración comprobará que todo componente habilitado en el perfil tenga los adapters necesarios para las superficies donde se anuncia. No habrá un parser, serializer o formato de persistencia distinto para cada componente.

La capa de render se separa así:

- **Document engine:** entiende tags, Markdown, atributos, nesting y round-trip.
- **TipTap extensions:** representan el componente en JSON y exponen comandos/NodeViews para editarlo.
- **Editor shell:** muestra toolbar, `Insert`, bubble, popovers y restricciones de edición.
- **Shared component renderer:** pinta el mismo componente en editor, preview, lectura y superficies públicas; el editor sólo añade affordances de authoring.

El renderer no decide cómo se guarda el documento. El parser no importa React. La UI no concatena tags ni persiste directamente. Esta separación es el principal mecanismo contra el Frankenstein.

## Arquitectura y límites

| Área | Responsabilidad |
| --- | --- |
| Shared core / document engine | Perfil Markdown, parser, serializer, validación y round-trip. |
| `DocumentComponentSpecRegistry` | Catálogo de dominio: componentes, atributos, nesting y reglas de parseo/serialización. No importa React ni TipTap. |
| `TipTapComponentAdapters` | Adaptación entre Document IR y TipTap JSON; schema, marks/nodes, comandos y transacciones. |
| `ComponentRendererRegistry` | Componentes visuales compartidos por editor, preview, lectura y publicación. No serializa. |
| `ComponentInvocationCatalog` | Ubicación en toolbar, `Insert`, bubble y command menu; configuración breve y shortcuts. |
| TipTap | JSON de trabajo, schema, comandos, NodeViews y protección de edición. |
| UI del editor | Toolbar, `Insert`, bubble, popovers y edición visual. No escribe archivos ni SQLite. |
| Application / `DocumentService` | Coordina abrir, guardar, serializar y reportar errores. |
| Desktop adapter | Persiste `.md`, actualiza `.odessay/index.json`, SQLite y la cola según el orden existente. |
| Web adapter | Mantiene el flujo local-first actual y su persistencia `body_json` mientras converge el core. |
| Sync / backend | Sincroniza documento y datos remotos existentes; no define la sintaxis ni guarda metadata en frontmatter. |

Invariantes: `.md` gobierna el contenido materializado en desktop; `body_json` es copia de trabajo; el contenido y los IDs estables deben round-tripear; metadata, estado de UI y permisos no entran al `.md`; la UI no consulta directamente filesystem, SQLite, IndexedDB o Supabase; el serializer nunca vuelve a producir la sintaxis legacy de anotaciones.

El plan debe encajar en la secuencia desktop existente: primero contrato documental, después seams de `DocumentService`/`SyncService`, y luego adapters. No crea un write-path paralelo.

### Clasificación arquitectónica

- **Layer:** dominio como capa dominante; aplicación, UI y adapters como capas secundarias.
- **Runtime:** contrato en `shared-core`; consumidores en web y desktop; proyecciones de lectura en cloud/publicación.
- **Owner inicial:** `architecture-first` hasta cerrar perfil, IR y boundaries. Frontend posee TipTap, invocación y render; backend conserva sync y estado colaborativo; database no redefine la sintaxis.
- **Contratos tocados:** perfil Markdown, Document IR, TipTap JSON, `DocumentService`, exportación, `margins` y sync.
- **Dependencias permitidas:** adapters dependen del core; UI depende de adapters de editor/render.
- **Dependencias prohibidas:** shared core no importa React, TipTap, Next, Supabase, filesystem ni SQLite; UI no parsea tags ni persiste directamente.
- **Performance Architecture:** activa para parseo, serialización, hydration, NodeViews y preview Mermaid; el contrato está definido abajo y cada brief debe heredar sólo la evidencia que le aplique.

### Consumidores existentes e impacto global

| Contrato que cambia | Consumidores que deben migrar o demostrar compatibilidad |
| --- | --- |
| Parse/serialize canónico | `document-serialization.ts`, `desktop-document-engine.ts`, `document-hydration.ts`, import/export, starter documents y lifecycle API. |
| Extensiones y JSON TipTap | `createEditorExtensions()`, `editor-shell.tsx`, tests de round-trip, find/replace, correcciones y publication suggestions. |
| Render de lectura | renderer server y client, editor, preview, shared y publicación. La lista de extensiones de lectura no puede divergir silenciosamente de la del editor. |
| Anotaciones | `annotation-markdown.ts`, `annotation-document.ts`, `AnnotationReferenceNode`, `FootnoteExtension`, panel Notes y proyección `margins`. |
| Invocación | toolbar actual, `SelectionPopup`, `AnnotationBubble`, comandos/shortcuts y preservación de selección/foco. |
| Persistencia desktop | `DocumentService`, `FilesystemDocumentService`, guardado atómico, manifest, catálogo y cola; sin cambiar su orden normativo. |

No se considera integrado un componente que sólo funcione en una extensión de TipTap o en el playground. Debe existir en el engine, el adapter, las superficies anunciadas y su proyección de export.

## Performance Architecture Contract

```text
System outcome: un único engine entiende el perfil y alimenta editor y lectura sin agregar trabajo completo del documento a cada keystroke.
Scale unit: N = caracteres/nodos del documento; C = componentes; V = componentes visibles; M = diagrams Mermaid visibles.
Critical path: typing, selección, paste, undo/redo y confirmación del save local. Parseo de source, render Mermaid y paneles secundarios quedan fuera del handler síncrono de input.
Existing consumers: document serialization/hydration, editor shell, import/export, renderer server/client, margins projection y desktop document engine.
Load strategy: parse O(N) una vez al abrir, importar o volver de Source a Rich; registry estático; NodeViews sólo para nodos presentes; Mermaid lazy y bajo demanda.
Update strategy: transacciones incrementales de ProseMirror; save coalescido por snapshot; un owner de parse/serialize; Mermaid single-flight + cache por hash de source + descarte de resultados stale.
Expected cost: lookup de spec O(1); typing proporcional a la transacción afectada, sin parse O(N); open/source-toggle/save O(N) justificado; render inicial proporcional a V; Mermaid proporcional a M visible, nunca a todos los fences del documento.
Runtime capabilities: shared-core, web y desktop; Mermaid usa sólo capacidad de frontend y no requiere IPC ni red.
Growth risk: regex con rescans superlineales, un React root/listener por mark, serialización completa por tecla, bundle Mermaid en bootstrap, render repetido de diagrams y divergencia entre registries.
Evidence: fixture de escala con 10/100/1.000 componentes para parse/serialize e idempotencia; traces existentes `editor`, `annotation-bubble` y `studio-shell` según el entregable; conteo de mounts/listeners; prueba de lazy-load/cache/cancelación Mermaid. Usar `workflow/perf-budgets.json`, sin inventar un umbral paralelo.
Rejected approach: compilar MDX/JSX arbitrario; parsear o serializar todo el documento en cada transacción; registrar listeners por componente inline; importar/renderizar Mermaid al arrancar; crear un parser por superficie.
```

Reglas derivadas:

- `DocumentComponentSpecRegistry` es una tabla estática indexada por `kind`; no hace discovery, fetch ni IPC.
- Los marks inline no crean React roots ni listeners por ocurrencia. Un plugin/controlador del editor posee las reglas de selección y protección.
- El editor conserva su aislamiento: no publica el documento completo a Zustand/Context por tecla.
- La serialización O(N) ocurre sobre snapshots de save o cambios de modo, nunca dentro del handler síncrono de `input`.
- Mermaid conserva source-first, se importa al solicitar preview, observa visibilidad con un owner único y descarta un render si cambió el hash antes de terminar.

### Documentación dividida

Este archivo conserva la secuencia y los límites transversales. Antes de BUILD, la fase 0 extrae tres contratos pequeños para evitar un spec gigante:

1. `syntax-and-roundtrip.md`: gramática, atributos, nesting, canonicalización y source opaco.
2. `inline-semantics.md`: selección, marks, IDs, overlap, copy/paste y `ProtectedText`.
3. `surface-projections.md`: Rich, preview, lectura, publicación, export limpio y contexto AI.

El plan enlaza esos contratos; no replica sus tablas completas cuando se conviertan en fuentes de verdad.

## Contrato de componentes para la primera versión

| Componente | Modelo TipTap propuesto | Contenido y atributos | Invocación |
| --- | --- | --- | --- |
| `Annotation` | Mark semántico con identidad | `id`, `type`, `comment`; el texto seleccionado va entre tags | Bubble; comentario en popover corto |
| `ProtectedText` | Mark semántico protegido por transacciones | `id`, `reason` opcional; protección contra edición accidental en Rich | Bubble; desbloqueo separado y explícito |
| `Entity` | Mark semántico con identidad de entidad | `id`, `type`; `Aplyca` puede ser `company` | Bubble; popover de tipos |
| `Highlight` | Mark visual sin identidad en v1 | `color` | Bubble; palette rápida |
| `Tip` / `Info` | Nodo de bloque | Contenido libre; sin atributos en v1 | `Insert`; edición directa |
| `Card` | Nodo de bloque | `title` requerido; `icon`, `href` opcionales; contenido libre | `Insert` o convertir selección; título editable en el nodo |
| `CardGroup` | Contenedor de bloques | `columns` opcional | `Insert`; agrupa cards existentes |
| `Accordion` | Nodo de bloque | `title` requerido; `defaultOpen` opcional | `Insert`; título y cuerpo editables |
| `AccordionGroup` | Contenedor | Sólo hijos `Accordion` | `Insert` |
| `Tabs` / `Tab` | Contenedor + hijos | `Tab.title` requerido | `Insert`; estado activo es UI, no documento |
| `Steps` / `Step` | Contenedor + hijos | `Step.title` opcional | `Insert`; numeración derivada del orden |
| `CodeBlock` | Nodo nativo fenced | `language`; código literal | `Code` y selector de lenguaje |
| `CodeGroup` | Contenedor de `CodeBlock` | título/lenguaje en cada fence | `Insert` / `Code` |
| Mermaid | `CodeBlock` con lenguaje `mermaid` | source Mermaid literal | `Code`; preview opcional |

Los componentes inline se representan como marks porque describen rangos de texto editables. Los nodos inline atómicos se reservan para elementos puntuales sin contenido editable. Esta decisión evita encerrar texto normal dentro de pequeños subárboles ProseMirror y permite combinar negrita, cursiva y links con la semántica editorial.

## Propuesta de política por superficie — por confirmar

El markdown-fuente y el export limpio son dos proyecciones del mismo modelo, no dos formatos independientes.

| Familia | Markdown-fuente | Editor Rich | Preview / lectura / publicación | Export limpio y AI |
| --- | --- | --- | --- | --- |
| `Annotation` | Conserva tag, `id`, `type`, `comment` y ancla | Resalta el rango y abre el comentario desde una affordance | Muestra sólo el texto anclado; el comentario aparece únicamente en una vista autorizada de anotaciones | Por defecto conserva sólo el texto. “Copiar con anotaciones” o contexto del agente es una acción explícita. |
| `Highlight` | Conserva tag y color | Render visual editable | Puede conservar el resaltado visual | Markdown plano conserva el texto; una exportación enriquecida puede conservar el highlight. |
| `ProtectedText` | Conserva tag, `id` y `reason` si existe | Bloquea edición accidental en Rich | Muestra texto normal; no expone la protección | Conserva sólo el texto. Las acciones AI de edición deben omitir ese rango. |
| `Entity` | Conserva tag, `id`, `type` y texto | Render semántico discreto y editable | Muestra texto normal o affordance semántica si la superficie la soporta | Markdown plano conserva el texto; AI puede recibir `id/type` como contexto estructurado. |
| Bloques editoriales | Conservan sus tags y atributos | Render de authoring | Render completo accesible | Se degradan a Markdown comprensible: título, cuerpo y link, sin controles de UI. |

Reglas:

- nunca se publican por accidente `comment`, `reason`, IDs ni estado colaborativo;
- el export del source conserva toda la semántica; el export limpio prioriza portabilidad;
- tabs activas, acordeones abiertos, selección, permisos y estado de preview son UI y nunca se serializan;
- cada componente nuevo debe declarar su proyección limpia antes de entrar al perfil estable.

## Propuesta de contrato TipTap v1 — por confirmar

- `Annotation`, `ProtectedText`, `Entity` y `Highlight` son marks. Pueden coexistir con formato Markdown nativo.
- En v1, una acción inline exige una selección no vacía dentro de un solo textblock. Una selección que cruza párrafos no se convierte parcialmente: la UI explica el límite y conserva la selección. `Card` sí puede envolver varios bloques.
- Dos componentes propios pueden tener rangos iguales o correctamente anidados, pero no rangos cruzados que no puedan expresarse con tags balanceados. La transacción de creación debe rechazar ese caso antes de mutar el documento.
- Los marks propios usan límites no inclusivos: escribir justo antes o después no extiende silenciosamente la anotación, entidad o protección.
- El parser nunca inventa IDs. La capa de aplicación entrega la identidad al comando de creación antes de ejecutar la transacción.

Política de identidad y portapapeles:

- `Annotation.id` identifica una ocurrencia concreta. Duplicar o pegar crea un ID nuevo y conserva el comentario.
- `ProtectedText.id` identifica un rango protegido. Copiar desde Rich produce texto normal fuera del rango; la protección se reaplica de forma explícita. Pegar source que contenga `<ProtectedText>` sí restaura su semántica mediante el parser.
- `Entity.id` identifica la entidad, no la mención; varias apariciones de “Aplyca” pueden compartir `ent-123`. Si más adelante se necesita identidad por aparición, se agrega `mentionId` sin cambiar el significado de `id`.
- `Highlight` no lleva ID en v1.

`ProtectedText` es una protección editorial, no un permiso de seguridad: evita delete, replace, paste y acciones AI dentro del rango en el editor Rich. Source mode y editores externos pueden modificar el `.md`; al regresar, el archivo gobierna el contenido. El desbloqueo v1 es un comando explícito y reversible, sin sistema de roles ni modal de permisos.

## Propuesta de contrato de round-trip — por confirmar

El objetivo es **round-trip semántico canónico**, no reproducción byte por byte de todo source conocido:

```text
parse(source) ≡ parse(serialize(parse(source)))
serialize(model) = serialize(parse(serialize(model)))
```

Para componentes reconocidos, el serializer normaliza de forma determinista:

- nombres `PascalCase` canónicos;
- atributos en orden definido por el spec, comillas dobles y escaping estable;
- saltos de línea LF y separación consistente para componentes de bloque;
- tags balanceados, sin self-closing salvo que el spec del componente lo permita;
- misma identidad, contenido y semántica aunque cambie whitespace no significativo.

Para tags desconocidos, inválidos o de una versión futura, el parser produce un nodo opaco con su raw source. Ese nodo no se renderiza como componente editable, pero permanece visible en source mode y se vuelve a serializar sin pérdida. No se intenta “arreglarlo” con regex.

Los fixtures deben distinguir tres afirmaciones:

1. **equivalencia semántica** para componentes conocidos;
2. **idempotencia canónica** después del primer guardado;
3. **preservación textual** para source opaco o no soportado.

## Failure modes obligatorios

| Operación | Fallo o carrera | Comportamiento requerido |
| --- | --- | --- |
| Source → Rich | Tag inválido, nesting imposible o parser exception | No mutar el editor ni guardar una canonicalización parcial; mantener Source con diagnóstico localizado y raw source recuperable. |
| Rich → source/save | Serializer exception | Conservar EditorState y último `.md` confirmado; exponer save fallido/retry sin reportar “Saved”. Desktop nunca avanza manifest o SQLite si no confirmó el `.md`. |
| Cambio de documento | Termina un parse/render del documento anterior | Comparar identidad + revision/hash y descartar el resultado stale antes de hidratar o pintar. |
| Proyección de `margins` | Red/schema no disponible | El save local no se revierte. Se encola retry; ante IR inválido no se podan filas por ausencia. |
| Mermaid | Source inválido, timeout o cambio mientras renderiza | Mostrar el fence/source con error recuperable; cancelar o ignorar el resultado stale; nunca bloquear edición ni guardado. |
| Paste/duplicate | IDs duplicados o payload no soportado | Aplicar la política del componente de forma atómica; si no se puede validar, pegar texto/source opaco sin mutación parcial. |
| Feature flag mixta | Un consumidor aún no conoce un `kind` nuevo | Tratarlo como opaco y preservar source; ningún reader antiguo puede borrar contenido desconocido. |
| Preview / lectura | Falta el adapter o renderer de un `kind` habilitado | El componente no puede habilitarse sin cobertura declarada; en runtime el fallo se aísla al componente y no degrada silenciosamente el documento completo. |
| PDF / DOCX | Un componente no tiene proyección de export | Fallar el gate de cobertura antes del rollout; nunca omitir, aplanar o exponer metadata privada por ausencia accidental de handler. |
| Texto derivado | Un componente desaparece de `body_text` o altera offsets sin contrato | No publicar la escritura del componente hasta declarar y probar su proyección de texto plano. |
| Contenido no confiable | Atributo, URL, source opaco o SVG introduce markup ejecutable | Rechazar o escapar según el perfil; el documento nunca ejecuta JSX/JavaScript ni HTML arbitrario. |
| Assets | Una imagen, icono, ruta local o diagrama no está disponible en otra superficie | Usar el fallback declarado por la proyección sin bloquear preview, export ni guardado. |
| Documento compuesto | El documento contiene sólo nodos no textuales o componentes vacíos válidos | La detección de vacío consulta estructura además de `body_text`; no descarta contenido válido. |

Todo estado transitorio visible debe tener salida por éxito, error o cancelación. Ningún popover, preview o parse pendiente puede dejar el editor bloqueado.

## Obligaciones que los briefs de BUILD deben cerrar

Estos puntos forman parte del alcance y de la revisión de BUILD, pero este plan no fija todavía su solución visual o técnica exacta. La foundation debe asignar cada decisión a un brief antes de habilitar escritura del componente correspondiente; no se resuelven informalmente dentro de un renderer o NodeView.

1. **Cobertura de registries:** definir un gate que demuestre que cada `kind` habilitado tiene spec, adapter TipTap, render server/client y política explícita de export. `flatten`, `omit-private` o `source-fallback` son decisiones válidas; la ausencia de handler no lo es.
2. **Proyección a texto plano:** declarar qué aporta cada componente a `body_text`, búsqueda, excerpts, métricas, título automático, contexto AI y anclajes. También debe conservarse la semántica correcta de documento vacío.
3. **Interactividad de lectura:** decidir cómo `Tabs`, `Accordion` y otros bloques interactivos funcionan sobre las superficies que hoy reciben HTML, sin introducir hidratación o listeners por componente ni serializar estado de UI.
4. **Seguridad del perfil:** allowlist de atributos y protocolos, escaping de source opaco y sanitización de cualquier salida SVG/HTML, especialmente Mermaid. El vocabulario controlado no ejecuta JSX, ESM ni JavaScript del documento.
5. **Operaciones transversales:** probar find/replace, correcciones y sugerencias AI, copy/paste, drag/drop, delete y selección sobre los nuevos nodos y marks. Deben preservar estructura e identidad y respetar `ProtectedText`.
6. **Assets cross-runtime:** declarar qué ocurre con imágenes locales, iconos de `Card`, links y diagramas en web, desktop, preview, publicación, PDF y DOCX.
7. **Aislamiento y diagnóstico:** un error debe identificar documento, revisión, `kind` y superficie sin exponer contenido sensible; un componente fallido no derriba ni reescribe el resto del documento.
8. **Calidad de export:** verificar contenido y estructura reales de PDF/DOCX, no sólo que el buffer sea no vacío. Los fixtures deben cubrir jerarquía, links, estilos, saltos, contenido privado y degradaciones.
9. **Accesibilidad:** definir semántica, teclado, foco y lectura asistida para componentes interactivos, y una jerarquía textual comprensible cuando PDF/DOCX eliminan la interacción.
10. **Compatibilidad mixta:** probar reader viejo/documento nuevo, feature flag apagada, `kind` desconocido y downgrade. La regla reader-first/writer-second sigue siendo el gate de rollout.

El documento pequeño `surface-projections.md` concentrará estas decisiones cuando se cierre DC-0. Este plan sólo exige que no queden implícitas ni repartidas entre consumidores.

## Visual / UX Contract

- **Referencia:** `prototypes/document-components-playground.html`, `docs/design/document-components-playground.md`, el `SelectionPopup`/`AnnotationBubble` vigentes y el sistema visual de Artifact Studio.
- **Invocación:** Markdown nativo permanece en toolbar/shortcuts; la selección de texto abre un único bubble contextual; bloques se insertan desde `Insert` o `/`.
- **Edición:** contenido, títulos y atributos frecuentes se editan dentro del componente o en popover breve. No hay modal obligatorio para insertar componentes.
- **Paridad:** Rich añade affordances de authoring; preview, shared y public muestran la misma semántica de contenido sin controles ni metadata privada.
- **Estados:** teclado, foco, Escape, selección inválida, placeholder, error de parser, source opaco, empty body, undo/redo y mobile de lectura deben quedar definidos.
- **Evidencia:** grabación corta de insertar, convertir, configurar, deshacer, cambiar Rich/Source y reabrir; screenshots comparables de write/preview/shared/public; consola limpia.

La implementación debe evolucionar el overlay contextual ya montado por `editor-shell.tsx` y extraer su catálogo/controlador; no agregar un segundo listener global ni seguir creciendo handlers de componentes dentro del shell monolítico.

## Secuencia táctica de entregables

Los entregables quedaron materializados en Linear durante `wf-define`; la tabla conserva la vista técnica y los IDs permiten seguir el trabajo ejecutable.

| Entregable | Dependencias | Resultado verificable | Revisión de performance |
| --- | --- | --- | --- |
| **DC-0 — Cerrar definición** | Fase 12 y DoD formalizados | Crear los tres specs pequeños, cerrar enums/atributos y registrar fixtures; actualizar docs derivados que aún describan sólo la ruta legacy. | Diseño: forma de costo y corpus de fixtures. |
| **DC-1 — Extraer Document IR y engine** | DC-0 | Registry, parser/serializer canónico, nodo opaco y adapters legacy detrás de una sola API; sin React/TipTap en el core. | Escala 10/100/1.000 componentes; verificar una pasada y estabilidad. |
| **DC-2 — Vertical slice `Annotation`** | DC-1 | Lectura dual, escritura `<Annotation>`, ID estable, proyección `margins`, editor + lectura + export limpio. | Trace `annotation-bubble` más typing/paste/undo; cero poda ante parse inválido; cero listeners por mark. |
| **DC-3 — Vertical slice de bloques** | DC-1 | `Tip`/`Info`, `Card` y CodeBlock funcionan end-to-end, incluida conversión de selección a Card. | Conteo de NodeViews/renders y bundle del camino inicial. |
| **DC-4 — Mermaid bajo demanda** | DC-3 | Fence `mermaid`, preview lazy, cache por hash, cancelación y fallback al source. | Lazy chunk + escenario con varios diagrams visibles/no visibles. |
| **DC-5 — Semántica inline restante** | DC-2 | `Entity` y `Highlight`; `ProtectedText` en subentrega propia con guards de transacción y AI. | Trace de selección/paste/delete; no full parse ni roots por mark. |
| **DC-6 — Contenedores compuestos** | DC-3, DC-5 | Accordion, Tabs, Steps y grupos con nesting válido, teclado y degradación limpia. | Fixture profundo/ancho; mounts y listeners no crecen accidentalmente por hijo. |
| **DC-7 — Invocación y proyección completa** | DC-2…DC-6 | Toolbar/Insert/bubble/popovers desde un catálogo, renderer compartido, cobertura de registries, proyección de texto plano y paridad de preview/export cross-surface. | Traces `editor`/`studio-shell`, bundle, prueba de lazy loading y fixtures de cobertura por `kind`. |
| **DC-8 — Rollout beta y aceptación** | DC-7 | Reader-first/writer-second, feature flag, migración recuperable, compatibilidad mixta, inspección real de PDF/DOCX, E2E, demo de outcome y aceptación del dueño. | Ejecutar sólo gates seleccionados arriba sobre el build entregable. |

Trazabilidad de issues:

- DC-0: `ODE-528` — contratos y fixtures.
- DC-1: `ODE-529` — Document IR y engine canónico.
- DC-2: `ODE-531` — migración de `Annotation`.
- DC-3: `ODE-530` — `Tip`, `Info`, `Card` y CodeBlock.
- DC-4: `ODE-533` — Mermaid source-first y lazy.
- DC-5: `ODE-532` — `Entity` y `Highlight`; `ODE-534` — `ProtectedText` y guards transaccionales.
- DC-6: `ODE-535` — Accordion, Tabs, Steps y grupos.
- DC-7: `ODE-537` — catálogo de invocación; `ODE-536` — renderer de preview/reading; `ODE-538` — `body_text`, Markdown limpio, PDF y DOCX.
- DC-8: `ODE-539` — rollout, compatibilidad y gate final.

Cada brief contiene `Files affected`, `Requirements`, `Failure modes`, contratos de arquitectura/performance/UX según alcance y Definition of Done. `ProtectedText` permanece separado del issue genérico de marks.

## Fases técnicas

### 0. Cerrar contrato y fixtures

Usar Fase 12 y su DoD como ownership del roadmap; crear después su proyecto Linear y los briefs auditados. Definir el perfil, nombres canónicos, atributos permitidos, escape de texto, nesting válido, comportamiento ante tags desconocidos y la migración desde la sintaxis legacy de `Annotation`. La enmienda D2/D3 del ADR ya fija `<Annotation>` como sintaxis canónica; antes de BUILD se deben reconciliar los specs derivados del editor con esa decisión. Crear fixtures de source, Document IR, JSON esperado y Markdown de salida.

Esta fase incluye un spike acotado para elegir la estrategia de parsing del vocabulario controlado. Debe demostrar tags balanceados, Markdown anidado, fences opacos y source desconocido sin depender de regex globales ni ejecutar JSX. La decisión puede reutilizar una librería de sintaxis, pero el output y las reglas pertenecen al Document IR de Odessay.

Salida: una matriz de casos con round-trip esperado para cada componente, incluyendo texto con `<`, `>`, comillas, saltos de línea, componentes anidados y conversión legacy → `<Annotation>`.

### 1. Implementar el document engine

Extraer gradualmente el contrato que hoy está detrás de `lib/editor/document-serialization.ts` y `lib/editor/markdown-format.ts`. Las APIs públicas vigentes permanecen como compatibility wrappers mientras sus consumidores migran; no se hace un big-bang sobre `editor-shell.tsx`. El destino recomendado es `lib/document-components/` para el perfil, Document IR, `DocumentComponentSpecRegistry`, parser y serializer. El core no puede importar TipTap; la creación temporal de `Editor` queda en el adapter hasta que sus consumidores migren. El parser debe:

- reconocer sólo tags `PascalCase` incluidos en el perfil;
- exigir apertura y cierre balanceados;
- tratar los fences de código como opacos para no interpretar tags dentro del código;
- escapar atributos y contenido de forma determinista;
- conservar IDs y atributos conocidos en `Markdown → JSON → Markdown`;
- convertir la anotación legacy a `Annotation` durante la migración de entrada, sin volver a emitirla;
- fallar de forma recuperable ante un tag inválido o desconocido, sin borrar el source.

El engine debe recorrer el source de forma lineal o equivalente, con límites explícitos de nesting y tamaño para errores patológicos. No se aceptan cadenas de reemplazos que vuelvan a escanear el documento completo por cada componente.

No se implementará un parser genérico de JSX/MDX ni se ejecutará JavaScript/ESM del documento.

Salida: parser/serializer compartido, errores de validación y tests unitarios de round-trip.

### 2. Añadir schema y comandos TipTap

Crear extensiones aisladas y registrarlas en `createEditorExtensions()`:

- inline marks: `Annotation`, `ProtectedText`, `Entity` y `Highlight`;
- blocks/containers: `Tip`, `Info`, `Card`, `CardGroup`, `Accordion`, `AccordionGroup`, `Tabs`, `Tab`, `Steps`, `Step`, `CodeGroup`;
- configuración del `CodeBlock` nativo para `language` y Mermaid.

Cada extensión debe declarar `parseHTML`, `renderHTML`, `toMarkdown` y `parseMarkdown` o el adaptador equivalente del bridge existente. Los comandos deben operar mediante transacciones y preservar undo/redo.

La integración usa un plugin/controlador por capacidad, no listeners ni React NodeViews por cada mark. Los IDs llegan como input del comando; esto reemplaza la generación que hoy ocurre dentro de `annotation-document.ts` y nodos legacy.

`ProtectedText` requiere una guardia de transacción que rechace borrar, reemplazar, pegar o aplicar correcciones dentro del rango. El desbloqueo será un comando explícito; no se resuelve con un `contenteditable=false` aislado ni promete protección fuera del editor Rich.

Salida: JSON de TipTap estable, comandos de inserción/conversión y protección probada.

### 3. Conectar source mode y persistencia

Integrar los nuevos nodos en el flujo actual Rich/Markdown. Validar que:

- cambiar de modo no convierta tags válidos en HTML accidental;
- exportar no pierda atributos ni cierre de tags;
- source desconocido quede visible y recuperable;
- el mismo serializer se use en web y en la dirección desktop;
- el guardado desktop conserve el orden `.md` atómico → manifest → SQLite/queue → sync.

Los IDs de `Annotation`, `ProtectedText` y `Entity` se acuñan una sola vez fuera del parser y llegan listos al comando de inserción. No se generan durante cada parseo ni dentro del hot path de typing. Paste y duplicación aplican la política de identidad definida para cada componente.

Salida: integración con `DocumentService`, compatibilidad con el lifecycle local-first y pruebas de reapertura.

### 4. Implementar invocación en el editor

La UI seguirá el patrón del Artifact Studio y reutilizará la infraestructura vigente de posición/cierre del `SelectionPopup` y `AnnotationBubble`:

- **Toolbar:** Markdown nativo, `Code` y `Insert`.
- **Insert:** `Tip`, `Info`, `Card`, `Accordion`, `Tabs`, `Steps`, grupos y otras estructuras de bloque.
- **Bubble de selección:** `Highlight`, `Annotation`, `ProtectedText`, `Entity` y “convertir selección en Card”.
- **Popover:** tipos de entidad, color del highlight, tipo/comentario corto y lenguaje del código.
- **Edición directa:** títulos de `Card`, `Accordion`, `Tab` y `Step`; cuerpo entre tags.
- **Modal:** sólo para operaciones con varios campos o riesgo, por ejemplo permisos para desbloquear texto protegido. No es el camino normal de inserción.

El catálogo de acciones y los controladores salen de `editor-shell.tsx`; el shell sólo coordina la selección y delega comandos. Abrir el bubble o un popover no dispara serialización, persistencia ni carga de Mermaid.

La conversión a `Card` conserva la selección como body, inserta un `title` editable con placeholder y devuelve el foco al componente. La configuración no debe depender de editar manualmente todo el source.

Shortcuts: reutilizar los shortcuts Markdown existentes. `Highlight` conserva su shortcut actual; no asignar shortcuts nuevos a `Annotation`, `Entity`, `ProtectedText` o bloques hasta validar colisiones y el costo cognitivo. Esos elementos quedan disponibles desde bubble, `Insert` o command menu.

Salida: acciones visibles, accesibles por teclado, con selección preservada al abrir popovers y sin toolbar flotante permanente.

### 5. Render compartido

Crear una capa de render que use el mismo modelo para editor, preview y lectura:

- callouts con semántica accesible;
- acordeones y tabs con teclado, foco y estado local;
- cards y grupos responsive;
- steps con numeración derivada;
- code blocks con lenguaje visible y copy;
- Mermaid como preview del fence, con source siempre disponible.

Mermaid se carga al pedir o acercar el preview visible, no durante bootstrap. Un cache por hash comparte renders idénticos y una revisión de identidad evita pintar resultados de source anterior. Los marks inline usan HTML/marks simples; no montan un componente React por ocurrencia.

Los controles visuales de authoring no se serializan. Estado como tab activa, accordion abierto, popover o preview de Mermaid es estado de UI, no contenido.

Salida: paridad visual entre edición, preview y lectura sin duplicar el contrato de documento.

### 6. Compatibilidad, migración y rollout beta

Probar primero detrás de una feature flag o perfil experimental. Mantener lectura explícita para documentos existentes con `==…==`, referencias inline y highlights actuales, pero una sola ruta de escritura nueva. Como el producto está en beta, no se exige una infraestructura extensa de versionado ni compatibilidad indefinida: sí se exigen fixtures, copia recuperable del source original durante la prueba y reporte de casos ambiguos. Nunca se reescribe silenciosamente contenido que el parser no pueda representar.

El rollout sigue orden reader-first / writer-second: primero todos los consumidores entienden el nuevo Document IR; después se habilita la escritura `<Annotation>`; finalmente se retira la escritura legacy. Fase 11 y cualquier consumidor de `margins` deben seguir leyendo la misma identidad y estado colaborativo durante la transición.

Los componentes especializados de Mintlify (`ParamField`, `ResponseField`, `RequestExample`, `Tree`, `Frame`, `Prompt`, `Color`, `Columns`, `Update`, `Expandable`) quedan fuera de v1. Se agregan después sólo con un caso de producto y un contrato de serialización propio.

## Verificación mínima

- Unit: cada fixture `Markdown → Document IR → JSON → Document IR → Markdown` conserva semántica, atributos e IDs y queda estable después de la primera canonicalización.
- Unit: tags desbalanceados, desconocidos, nesting inválido y tags dentro de fences no corrompen el documento.
- Unit: el gate de cobertura falla si un `kind` habilitado carece de adapter, renderer server/client o política explícita de export.
- Unit: la proyección `body_text` de cada componente conserva búsqueda, excerpts, métricas, contexto AI y detección de documento no vacío según su contrato.
- Unit: `ProtectedText` bloquea delete, backspace, selección parcial, paste y replace; unlock funciona sólo por comando.
- Integration: selección inline válida para `Annotation`, `Entity`, `Highlight` y `ProtectedText`; las selecciones multibloque se rechazan sin mutación. La conversión multibloque a `Card` conserva todos los bloques.
- Integration: paste reminta `Annotation`, no propaga `ProtectedText` en Rich y conserva la identidad semántica de `Entity`.
- Integration: título de `Card`, tipo de `Entity`, lenguaje de código y comentario de `Annotation` se editan y serializan.
- Integration: find/replace, correcciones/sugerencias AI, copy/paste y drag/drop conservan o rechazan estructura e identidad de forma atómica.
- E2E: toolbar, `Insert`, bubble, shortcuts, popovers, foco, Escape, undo/redo y reapertura.
- Parity: mismo Markdown renderiza equivalentemente en rich editor, preview y lector; un fallo de componente queda localizado y no degrada todo el documento.
- Security: atributos, URLs, source opaco y Mermaid no ejecutan markup o código no permitido en ninguna superficie.
- Export: un fixture representativo se inspecciona en PDF y DOCX para contenido, jerarquía, links, metadata privada y degradaciones, no sólo por tamaño de buffer.
- Compatibility: reader viejo/documento nuevo, flag apagada, `kind` desconocido y downgrade preservan el source recuperable.
- Persistence: web local-first y desktop respetan sus adapters y no introducen metadata en frontmatter.
- Failure: parser/serializer, cambio de documento, sync de `margins` y Mermaid siempre terminan en éxito, error recuperable o cancelación; no dejan estado intermedio colgado.
- Scale: fixtures con 10/100/1.000 componentes no introducen una llamada, listener, React root o pasada completa por componente.
- Runtime: el trace del editor vigente conserva typing, paste y undo dentro de los budgets existentes; el artefacto prueba el hot path real, no sólo una función aislada.
- Bundle: Mermaid y cualquier renderer secundario no aparecen en el chunk de bootstrap del editor hasta invocarse.
- UX: demo de outcome con inserción, conversión, configuración inline, Rich/Source, reapertura y comparación write/preview/shared/public.

## Definition of Done

Fase 12 sólo se puede marcar completa cuando los specs derivados reflejan la enmienda D2/D3, el document engine tiene un único serializer canónico, los contratos de dominio/TipTap/render/invocación permanecen separados, los fixtures pasan round-trip y escala, los cuatro componentes inline respetan sus reglas de selección e identidad, `ProtectedText` está protegido por transacciones dentro de Rich, los bloques se insertan sin modal obligatorio, la persistencia existente sigue pasando sus pruebas y el dueño acepta el demo visible del outcome. Typecheck/lint/tests verdes son necesarios, pero no sustituyen esa aceptación.

## Dependencias y riesgos

- La enmienda del ADR ya está cerrada; el riesgo restante es que specs derivados o consumidores vigentes sigan asumiendo la sintaxis anterior.
- `tiptap-markdown` puede no ofrecer todos los hooks necesarios para tags balanceados; si ocurre, el adaptador debe vivir en el document engine, no en la UI.
- La selección TipTap y la selección del source textarea son coordenadas distintas; cada comando debe declarar qué modo soporta.
- Componentes anidados y contenido Markdown dentro de tags requieren una gramática delimitada, no reemplazos regex.
- Los rangos custom cruzados no pueden representarse con tags balanceados; el schema y los comandos deben impedir crearlos.
- `ProtectedText` puede afectar pegado, delete, undo y correcciones AI; debe probarse junto con decorations existentes y nunca presentarse como control de seguridad.
- El renderer vigente entrega HTML como string en varias superficies; los componentes interactivos necesitan una estrategia de interactividad e hidratación con owner único antes de entrar a BUILD visible.
- `body_text` alimenta búsqueda, excerpts, métricas, AI y detección de vacío; una proyección incompleta puede perder contenido sin romper el round-trip Markdown.
- Los exportadores actuales recorren un modelo cerrado y pueden aplanar u omitir nodos desconocidos; cada componente requiere una política de export explícita antes del rollout.
- Atributos, URLs, source opaco, assets locales y SVG Mermaid cruzan boundaries de seguridad y runtime; deben validarse por perfil y degradarse sin ejecución arbitraria.
- El parser y el render pueden aumentar el costo de documentos grandes; cada brief activado debe revisar parseo, hydration, NodeViews, autosave y preview. Un save sigue produciendo un snapshot/coalescing lógico, no eventos adicionales por componente.
- Fase 12 ya posee el incremento y sus briefs. El riesgo operativo restante es activar o construir la fase antes de cerrar Fase 11 o sin respetar las dependencias registradas en Linear.

## Execution Trace de esta revisión

- **Planning role:** Product Manager mediante `wf-define`, con Fase 12 explícita como fase futura planificada.
- **Skills loaded:** `skill-product-manager`, `skill-performance`, `skill-architecture`, `skill-audit-planning`, `skill-frontend`, `skill-design`, `skill-ux-testing`, `skill-corrections`, `skill-backend` y skill de Linear.
- **Specialist consults:** arquitectura documental, editor/TipTap, correcciones, backend de exportación, sistema visual, tipografía y evidencia UX revisados contra sus skills y fuentes del repo.
- **Skill reviews:** performance — contratos de escala, owners y lazy Mermaid; arquitectura — IR/core, adapters, autoridad Markdown y write-path preservados; frontend — sin parse por tecla, listeners por mark ni mutaciones fuera de comandos; diseño/UX — edición inline, overlay existente, teclado y paridad cross-mode; corrections — `ProtectedText` usa el lifecycle existente y un guard común; backend — export routes permanecen adapters seguros del core.
- **Audit run:** `skill-audit-planning` aplicado a roadmap, DoD, los 12 briefs, cobertura y dependencias. Gate de definición: `PASS`; BUILD sigue pendiente de activación explícita de Fase 12.
- **Definition check:** docs ↔ código = consistente como destino vs. legacy; roadmap ↔ DoD ↔ Linear = consistente; Fase 11 continúa activa en `workflow/status.json`.
- **Artifacts created:** proyecto Linear de Fase 12 y issues `ODE-528`–`ODE-539`; roadmap, DoD, este plan y `workflow/docs.json` conservan la fuente documental.
- **Why:** convertir la exploración en trabajo ejecutable y trazable sin añadir una segunda tubería documental, una segunda fuente de verdad ni carga accidental al hot path.

## Referencias

- Arquitectura documental: `workflow/context/core/odessay-adr-identidad.md`.
- Catálogo y write-path desktop: `workflow/context/features/odessay-desktop-document-catalog.md`.
- Editor y shortcuts: `workflow/context/features/odessay-editor.md`.
- Backbone TipTap/Markdown: `workflow/context/features/odessay-prosemirror-tiptap.md`.
- Arquitectura objetivo desktop: `workflow/context/features/odessay-desktop-target-architecture.md`.
- [Qué es MDX](https://mdxjs.com/docs/what-is-mdx/), [extender MDX](https://mdxjs.com/docs/extending-mdx/) y [componentes de Mintlify](https://www.mintlify.com/docs/components).
