# ODESSAY — Workspace

**Documento de referencia para agentes de desarrollo.**
Lee `workflow/context/features/odessay-desktop-app.md` y `workflow/context/features/odessay-desktop-target-architecture.md` antes de decidir alcance de runtime para Workspace. El **spec de implementación** de carpetas vigiladas vive en `workflow/context/core/odessay-watched-folders.md`; el catálogo compartido con Desk y la apertura única viven en `workflow/context/features/odessay-desktop-document-catalog.md`.

Antes de cambiar scan, watcher, apertura, sincronización o identidad de Workspace, leer también `workflow/context/features/odessay-workspace-diagnostic.md`. Ese diagnóstico separa el contrato objetivo del ADR de los caminos legacy aún presentes y exige un protocolo único de binding archivo↔UUID.

Este documento fija el contrato actual de **Workspace** en Odessay: qué existe en desktop, qué no existe en web y cuál debe ser el comportamiento explícito de la UI cuando el runtime no puede ofrecer acceso al filesystem local.

---

## Tesis

Workspace es una capacidad **desktop-first** y una vista de organización/ubicación sobre el mismo `DocumentCatalog` que consume Desk.

No es una colección cloud ni un subsistema documental separado. Aporta contexto de carpetas, jerarquía y BindingRoots sobre documentos que conservan la misma identidad, estado y apertura en todas las superficies.

La regla operativa es esta:

> Si una funcionalidad depende de elegir carpetas locales, listar archivos del disco o reaccionar a file events del sistema, pertenece a desktop.

---

## Comparativa por runtime

| Capacidad | Desktop (Tauri) | Web | Contrato esperado |
|---|---|---|---|
| Crear workspace | Sí | No | Desktop puede crear una carpeta nueva y registrarla como workspace. Web no crea workspaces locales. |
| Añadir carpeta existente | Sí | No | Desktop puede conectar una carpeta local existente. Web solo informa que la acción requiere la app desktop. |
| Ver lista de workspaces | Sí | Solo mock/prototipo | Desktop lista agrupaciones reales desde `DocumentCatalog` + configuración de Workspace; `.odessay/index.json` alimenta el reconciliador, no una base de consulta paralela. |
| Ver detalle de workspace | Sí | Solo mock/prototipo | Desktop muestra archivos reales del workspace. Web no navega un filesystem local real. |
| Selección granular de carpetas/archivos | Sí | No | Desktop puede limitar qué paths quedan incluidos. Web no expone árbol de filesystem local. |
| Lista de archivos del workspace | Sí | No real | Desktop indexa `.md`/`.mdx` visibles dentro del scope elegido. Web no inspecciona carpetas locales del usuario. |
| Sincronización con filesystem | Sí | No | Desktop relee el workspace desde disco y persiste el **índice de binding** local (ruta↔id, no metadata de Odessay; ver `odessay-adr-identidad.md` D4/D8) en `.odessay/index.json`. |
| Watcher en tiempo real | Sí | No | Desktop observa cambios del filesystem con `fs:watch`. Web no tiene file events nativos equivalentes. |
| Abrir archivo en editor | Sí | No real | Desktop entrega el UUID del catálogo al mismo `OpenDocument` usado por Desk. Web no abre archivos arbitrarios del disco. |
| Selección de archivos dentro del workspace | Sí | No | Desktop puede incluir/excluir folders o archivos específicos. Web muestra limitación de runtime. |

---

## Comportamiento esperado en web

Workspace no debe fingir capacidad local en web.

Cuando el usuario intenta usar "Add workspace" en web:

1. La UI muestra un mensaje explícito: `Adding a local folder requires the desktop app.`
2. El flujo no continúa hacia selección de carpeta ni árbol de archivos.
3. La UI puede mostrar un mock o una vista explicativa, pero no debe sugerir que existe conexión real con carpetas del dispositivo.

Regla:

> En web, Workspace puede existir como superficie informativa o prototipo de producto. No puede comportarse como explorador real del filesystem local.

---

## Capacidades desktop

Desktop sí puede ofrecer Workspace porque Tauri aporta:

- selección de carpetas vía dialog nativo;
- acceso a archivos y subcarpetas permitidos por capabilities;
- watchers con `fs:watch`;
- persistencia local en `.odessay/index.json`;
- lectura y refresco del contenido sin depender de Supabase.

Capacidades actuales/esperadas de desktop:

- registrar una carpeta existente o crear una nueva;
- indexar archivos Markdown visibles dentro del scope elegido;
- abrir previews y archivos reales mediante el `DocumentCatalog` compartido;
- persistir `selectedPaths` como configuración local del workspace;
- observar solo los paths incluidos por el usuario;
- reconciliar renames/deletes del filesystem con el índice local.

Al reconciliar un rename, Workspace conserva el binding ruta-primero (D6) y re-deriva el `title` del nuevo filename antes de encolarlo para sync. Un rename atómico no se interpreta como borrado; el título es cache del stem y no puede retener el nombre de la ruta previa.

---

## Limitaciones técnicas del runtime web

La web no tiene acceso general al filesystem local del usuario.

Limitaciones relevantes:

- no puede abrir carpetas arbitrarias del disco y seguir observándolas;
- no puede mantener un watcher persistente sobre rutas locales;
- no puede asumir permisos duraderos equivalentes a Tauri `fs:watch`;
- no puede usar `.odessay/index.json` como contrato operativo sobre una carpeta del usuario fuera del sandbox del browser.

Por eso Workspace no debe modelarse como una feature cross-runtime simétrica hoy.

---

## Contrato de persistencia local

Workspace persiste configuración local en `.odessay/index.json`.

Ese documento puede incluir:

- ids estables por archivo visto;
- inode, `content_hash`, tamaño y `lastSeen` como pistas de binding;
- `selectedPaths` para recordar qué carpetas/archivos forman parte del workspace.

No incluye metadata de Odessay (`status`, `visibility`, `slug`, versiones o tags). El watcher/reconciliador global proyecta sus bindings al catálogo SQLite; Workspace y Desk consultan ese catálogo, no el JSON directamente. El índice no puede inventar ni reemplazar un UUID por ruta sin agotar la reconciliación definida en `odessay-desktop-document-catalog.md`.

`selectedPaths` es configuración **local** del workspace. No vive en Supabase.

---

## Decisión de producto vigente

Workspace queda clasificado así:

- Layer: `Adapter(desktop)` + `UI`
- Runtime scope: `desktop` dominante, `web` solo informativo
- Owner: `backend` para filesystem/watch/index, `frontend` para presentación

Invariantes:

- web no simula acceso real a carpetas locales;
- desktop no amplía capabilities sin necesidad explícita;
- la configuración del workspace se guarda localmente;
- el watcher nunca debe observar más paths que los incluidos por el usuario.

---

## Relación con issues

- `ODE-265` define este mapa de runtime.
- `ODE-266` depende de este contrato para implementar selección granular.
- `ODE-284` debe asumir este documento como fuente de verdad antes de rediseñar la UI de Workspace.
