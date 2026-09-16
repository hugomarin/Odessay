# ODESSAY — Fase 12 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 12 — Artifact Studio: Componentes Documentales**.
Si un punto no está cumplido, el sistema de componentes no se considera una capacidad estable del producto aunque un componente aislado funcione en el editor o en el playground.

Fase 12 extiende el contrato documental ya aceptado; no crea un formato paralelo. El `.md` materializado continúa gobernando el contenido en desktop, TipTap continúa siendo la representación viva de edición y el mismo modelo documental alimenta web, desktop, preview, lectura y exportación. El vocabulario adopta sintaxis de etiquetas balanceadas estilo MDX, pero no ejecuta JSX, ESM ni JavaScript arbitrario.

Referencias:

- `workflow/context/core/odessay-adr-identidad.md` — autoridad de contenido, identidad, anotaciones y proyección limpia.
- `workflow/context/features/odessay-desktop-document-catalog.md` — catálogo, apertura y write-path desktop que esta fase consume, no reemplaza.
- `workflow/context/features/odessay-desktop-target-architecture.md` — separación entre shared core, aplicación, presentación y adapters.
- `workflow/context/features/odessay-prosemirror-tiptap.md` — backbone vigente del editor y guardrails de round-trip.
- `docs/design/document-components-implementation-plan.md` — secuencia táctica, contratos de arquitectura/performance/UX y riesgos.
- `docs/design/document-components-playground.md` y `prototypes/document-components-playground.html` — referencia editable de interacción y representación, no parser de producción.
- `.agents/skills/skill-architecture/SKILL.md`
- `.agents/skills/skill-performance/SKILL.md`
- `.agents/skills/skill-product-manager/SKILL.md`
- `workflow/define/roadmap.md`

---

## 1) Existe un solo perfil documental y un solo engine

- El perfil distingue tres familias sobre la misma infraestructura: Markdown puro, semántica propia de Artifact Studio (`Annotation`, `Highlight`, `ProtectedText`, `Entity`) y componentes editoriales MDX-like controlados.
- Un `DocumentComponentSpecRegistry` compartido declara `kind`, familia, atributos, contenido, nesting y políticas de parseo, serialización y proyección; no importa React, TipTap, Next, Supabase, filesystem ni SQLite.
- Un único Document IR conecta Markdown, TipTap JSON, lectura y exportación. Ninguna superficie mantiene un parser o serializer alternativo por componente.
- El parser acepta únicamente el vocabulario permitido, respeta fences opacos, valida tags balanceados y conserva como source recuperable cualquier componente desconocido o inválido.
- El serializer canónico es determinista e idempotente después de la primera canonicalización. Nunca vuelve a producir la sintaxis legacy `==texto==[@n: comentario]`.
- Los contratos pequeños `syntax-and-roundtrip.md`, `inline-semantics.md` y `surface-projections.md` existen como fuentes de verdad antes de habilitar escritura del perfil nuevo.

## 2) La integración TipTap conserva estructura, identidad y operaciones editoriales

- Markdown válido round-tripea `Markdown → Document IR → TipTap JSON → Document IR → Markdown` sin pérdida de contenido, atributos o IDs estables.
- `Annotation`, `Highlight`, `Entity` y `ProtectedText` conviven con bold, italic, links y demás formato Markdown permitido sin crear rangos cruzados imposibles de serializar.
- `ProtectedText` impide edición accidental mediante transacciones —delete, replace, paste y acciones AI— y sólo se desbloquea mediante un comando explícito. No se presenta como control de seguridad fuera del editor Rich.
- Find/replace, correcciones y sugerencias AI, copy/paste, drag/drop, undo/redo y cambio Rich/Source preservan o rechazan estructura e identidad de forma atómica.
- Los marks inline no montan un React root ni un listener por ocurrencia. El editor conserva un owner único para selección, protección e invocación contextual.

## 3) La invocación y edición responden al modelo de Artifact Studio

- Markdown puro continúa disponible mediante toolbar, shortcuts y sintaxis Markdown.
- Los componentes inline se aplican desde el bubble único de selección; los bloques se insertan desde `Insert` o `/`; código y Mermaid se crean desde la acción de código y su selector de lenguaje.
- Una selección puede convertirse en `Card` conservando el contenido como body y creando un título editable dentro del componente.
- Títulos, body y atributos frecuentes se editan directamente en el componente o mediante un popover breve. Un modal no es el camino normal de inserción o configuración.
- Toolbar, bubble, `Insert`, command menu y popovers consumen un catálogo de invocación compartido; no concatenan tags ni persisten contenido directamente.
- Teclado, foco, Escape, selección inválida, placeholders, estado vacío, undo/redo y lectura mobile tienen comportamiento definido y verificable.

## 4) Todas las superficies y exportaciones tienen una proyección explícita

- Cada `kind` habilitado declara cobertura de adapter TipTap, renderer de editor, renderer de lectura server/client y política de exportación. Un gate automatizado falla ante cobertura incompleta.
- Preview, reading, shared y publicación renderizan la misma semántica de contenido sin affordances de authoring ni metadata privada.
- Los componentes interactivos de lectura —por ejemplo `Tabs` y `Accordion`— tienen un owner único de interactividad/hidratación y funcionan con teclado y foco.
- `body_text` conserva el contenido necesario para búsqueda, excerpts, métricas, títulos derivados, contexto AI, anchors y detección de documento vacío.
- PDF y DOCX conservan contenido, jerarquía, links y degradación accesible; eliminan comentarios, razones, IDs y estado colaborativo salvo que una exportación enriquecida lo solicite explícitamente.
- Mermaid conserva siempre el source. Su preview se carga bajo demanda, se sanitiza, usa cache por hash y puede fallar localmente sin degradar el resto del documento.
- Assets locales, iconos de Card, links e imágenes tienen política explícita para web, desktop, preview, publicación, PDF y DOCX.

## 5) Persistencia y runtimes no adquieren una segunda personalidad documental

- Shared core posee perfil, Document IR, parser, serializer y validación. UI, TipTap y adapters dependen del core; el core no depende de ellos.
- Desktop conserva el orden normativo `.md` atómico → `.odessay/index.json` atómico → SQLite + enqueue en transacción → sync cloud en background.
- Web conserva IndexedDB como adapter local-first y converge al mismo contrato de contenido sin exigir que su substrato físico sea un archivo `.md`.
- La UI no consulta directamente filesystem, SQLite, manifests, IndexedDB o Supabase para interpretar componentes o guardar documentos.
- Un error de componente, parser, renderer o exportación se aísla y deja source recuperable; nunca crea un draft, poda anotaciones ni reescribe silenciosamente contenido desconocido.

## 6) Seguridad y performance están probadas sobre el riesgo real

- Atributos, URLs, source opaco y SVG Mermaid usan allowlists, escaping y sanitización; ninguna superficie ejecuta JSX, ESM, JavaScript o markup no permitido proveniente del documento.
- Parsear o serializar el documento completo queda fuera del handler síncrono de cada tecla. Parseo y serialización completa ocurren al abrir, importar, guardar snapshots coalescidos o cambiar Rich/Source.
- El registry tiene lookup `O(1)` por `kind`; NodeViews, listeners, renders y operaciones no crecen accidentalmente uno por cada componente inline.
- Fixtures con 10, 100 y 1.000 componentes demuestran round-trip estable y ausencia de fan-out evitable.
- Mermaid y renderers secundarios no entran al bootstrap del editor antes de ser invocados; renders stale se descartan si cambia el source.
- La evidencia de runtime usa los traces y budgets vigentes que correspondan al riesgo; no inventa umbrales paralelos ni valida otro build o flag distinto al entregado.

## 7) La migración beta es recuperable y reader-first

- Todos los consumidores entienden el nuevo Document IR antes de habilitar la escritura del nuevo perfil.
- El parser mantiene lectura temporal de anotaciones legacy y el serializer escribe únicamente `<Annotation>`.
- Feature flag apagada, `kind` desconocido, lector viejo/documento nuevo y downgrade conservan el source original o una copia recuperable; nunca borran contenido no entendido.
- El rollout no interpreta ausencia de una anotación como intención de borrado cuando el documento tiene errores estructurales.
- Los componentes especializados de documentación (`ParamField`, `ResponseField`, `RequestExample`, `Tree`, `Frame`, `Prompt`, `Color`, `Columns`, `Update`, `Expandable`) permanecen fuera de esta fase salvo una decisión posterior con caso de producto y contrato propio.

## 8) Evidencia y aceptación

- Existe una matriz trazable desde cada bloque de este DoD hasta tests unitarios, integración, E2E, inspección de export o aceptación explícita del dueño.
- Los fixtures prueban Markdown puro, componentes propios, bloques editoriales, nesting, source inválido, atributos con escapes, assets y documentos compuestos.
- PDF y DOCX se inspeccionan por contenido y estructura real, no sólo por la existencia o tamaño del buffer.
- Un demo de outcome muestra insertar, convertir selección, configurar inline, deshacer, cambiar Rich/Source, reabrir y comparar editor/preview/shared/public.
- Typecheck, lint, tests, validación del workflow y los gates de performance seleccionados están en verde.
- El dueño acepta el outcome visible completo antes del cierre de fase.

## Temas que no son objetivo de esta fase

- compilar o ejecutar MDX/JSX arbitrario, imports ESM o JavaScript embebido;
- admitir componentes de terceros sin registro y contrato de proyección;
- rediseñar el shell, overlays, marca o sistema visual cerrado en Fase 10;
- crear otro catálogo, write-path, store durable o protocolo de sync;
- colaboración en tiempo real o un sistema nuevo de permisos;
- implementar todo el catálogo de Mintlify sin un caso de producto;
- prometer que `ProtectedText` protege el contenido fuera del editor Rich.

## Gate de cierre de fase

Fase 12 se marca `Done` sólo cuando los ocho bloques anteriores están evidenciados, no quedan issues bloqueantes abiertos en su proyecto Linear, el parser/serializer y las proyecciones operan como una sola infraestructura en web y desktop, y el dueño acepta que los componentes se crean, editan, leen y exportan conforme a la intención documentada. Un componente funcionando únicamente en TipTap, preview o el playground no cuenta como entregado.
