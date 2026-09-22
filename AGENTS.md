# Odessay — Agent Instructions

Este archivo es el **canonical owner** de las reglas universales de construcción, invariantes y guardrails del repositorio — qué debe seguir siendo verdad en cualquier cambio, para cualquier agente.

`workflow/agents.md` es el documento complementario: instrucciones operativas del sistema `/wf-*` — qué hace cada comando, qué contexto carga, qué roles de agente usa, y cómo interactúa con Linear, ramas y estados. Referencia las reglas de este archivo; no las redefine. Léelo para saber *cómo operar* un comando; lee este archivo para saber *qué no debe romperse* mientras lo haces.

## Reglas universales de construcción

Aplican a prácticamente cualquier cambio, en cualquier runtime. No son opcionales ni requieren que un `AGENTS.md` local las repita.

### Reuse before creation
Antes de crear un service, store, hook, helper, state machine, serializer o path de persistencia nuevo:
1. identificar el owner existente;
2. buscar siblings relevantes;
3. inspeccionar consumers y tests canónicos.

En BUILD esto lo ejecuta `.agents/skills/architecture-recon/SKILL.md` — no es un paso opcional cuando el cambio no es trivial.

### Una responsabilidad semántica, un owner
No introducir una implementación paralela de una responsabilidad que ya tiene owner canónico. Un segundo owner de la misma responsabilidad es el hallazgo sistémico de mayor prioridad tanto en BUILD (Architecture Recon) como en REVIEW (`review-architecture`).

### Arquitectura antes que localidad
Principio universal: el archivo más cercano no define ownership por sí solo — esto siempre es verdad, no requiere activar ninguna skill para tenerlo presente.

Activación técnica: resolver `Layer`, `Runtime scope`, `Owner` y contrato con `.agents/skills/skill-architecture/SKILL.md` solo cuando el cambio afecte ownership, contratos, runtime o boundaries. No aplicarlo a cambios triviales (copy, estilo aislado, ajustes que no mueven ownership) — eso solo sube el costo cognitivo sin agregar señal. `.agents/skills/architecture-recon/SKILL.md` ya usa el mismo criterio de activación en BUILD; mantener la misma filosofía aquí.

### Proteger hotspots de orquestación
Los módulos centrales de composición (ej. `components/editor/editor-shell.tsx`, `src-tauri/src/commands/index.rs`) pueden cablear comportamiento, pero no deben adquirir ownership nuevo de dominio, persistencia o runtime. El tamaño de un hotspot no es en sí mismo la violación; que absorba una responsabilidad nueva sí lo es. Ver `Construction order` y `Hotspots` en `.agents/agents/build-agent.md`.

### El cambio más pequeño coherente
Preferir el cambio más pequeño que preserve ownership y contratos — no optimizar solo por menos archivos tocados, ni inflar un PR con decisiones no relacionadas. Ver `.agents/skills/review-change-size/SKILL.md`.

### Instrucciones scoped
Antes de modificar un subtree, verificar si existe un `AGENTS.md` más específico y aplicarlo. Hoy existen `components/editor/AGENTS.md` y `src-tauri/AGENTS.md`; si tu cambio cae fuera de ambos, solo aplican las reglas de este archivo.

---

## Guardrail obligatorio — arquitectura documental desktop

Este archivo es el **canonical owner** de este contrato — `workflow/agents.md` lo referencia, no lo repite.

### Cuándo cargar cada documento

No es "cualquier cambio que toque Desktop/Desk/Workspace" — el criterio es si el cambio puede afectar el contrato, no si toca la superficie donde vive:

- Cargar `workflow/context/core/odessay-adr-identidad.md` cuando el cambio pueda afectar identidad/UUID, autoridad de contenido o metadata, binding archivo↔documento, el contrato `.md`/`body_json`, lifecycle local/cloud, o semántica documental compartida entre runtimes.
- Cargar además `workflow/context/features/odessay-desktop-document-catalog.md` cuando pueda afectar el `DocumentCatalog`, BindingRoots/`.odessay/index.json`, SQLite/IndexedDB desktop, el watcher/`WorkspaceReconciler`, resolución `UUID ↔ path`, apertura/materialización, las fuentes de datos de Desk/Workspace/Search/Recent, o el lifecycle de save/sync.
- Un cambio puramente visual, de copy o de interacción local que no altera ninguno de esos contratos **no** carga estos documentos solo por tocar Desk, Workspace o Desktop.

Precedencia de lectura: ADR de identidad → spec del catálogo desktop → implementación. Estas decisiones son no negociables salvo un nuevo ADR aprobado.

### Precedencia

1. El ADR prevalece en identidad, fuente de verdad y metadata.
2. El spec del catálogo prevalece en operación desktop: manifests, SQLite, watcher/reconciliador, superficies de consulta, apertura y retiro de IndexedDB.
3. Target architecture, migration plan y docs de feature se subordinan a ambos.
4. El código vigente es evidencia del estado actual; no invalida un contrato aceptado. Un camino que lo contradice se clasifica como legacy hasta que migre.

### Invariantes obligatorios

- **Contenido:** el `.md` materializado es la autoridad. SQLite, IndexedDB y Supabase solo guardan proyecciones, metadata o copias según su contrato.
- **Binding:** `.odessay/index.json` es el ledger durable `ruta relativa ↔ UUID ↔ inode ↔ content_hash` dentro de un `BindingRoot`; no es metadata ni caché descartable de UUIDs local-only.
- **Catálogo desktop:** SQLite es el único `DocumentCatalog` consultable y la cola durable de sync. No se particiona por usuario ni gobierna el contenido.
- **Nube:** Supabase gobierna metadata y existencia cloud; auth habilita capacidades cloud, no existencia local.
- **Reconciliación:** el watcher solo detecta eventos. Un `WorkspaceReconciler` global, montado fuera de las vistas, resuelve identidad y escribe primero manifest atómico y después SQLite en transacción.
- **Superficies:** Desk, Workspace, Search, Recent y Open Document consultan el mismo `DocumentCatalog`. Ninguna descubre documentos mediante una fuente paralela.
- **Workspace:** es una vista/filtro organizativo sobre catálogo y `BindingRoots`, no un pipeline documental distinto.
- **BindingRoot externo:** abrir un archivo fuera de roots requiere confirmación para registrar su carpeta padre; `selectedPaths` empieza limitado al archivo y `visible_as_workspace` no se activa por defecto.
- **IndexedDB:** sigue siendo el adapter local-first de web. En desktop es compatibilidad transitoria y se retira solo tras cosechar todos los scopes, bindings y mutaciones pendientes.
- **Apertura:** la entrada pública puede ser `{ kind: "id" }` o `{ kind: "path" }`, pero debe agotar reconciliación antes de acuñar identidad y converger a `OpenDocument(UUID)` antes de hidratar el editor. Workspace no hace seed manual de IndexedDB.
- **Delegación entre servicios:** un UUID nunca se trata como ruta de filesystem. Toda operación que necesite delegar a un adapter de filesystem resuelve primero `UUID → canonical_path` mediante el `DocumentCatalog`; esta regla aplica dentro de servicios y no solo en la UI.
- **Guardado:** el orden desktop es `.md` atómico → manifest atómico → SQLite + enqueue en transacción → sync cloud en background.
- **Boundaries:** la UI no depende directamente de SQLite, manifests, IndexedDB, Supabase, Tauri ni rutas de filesystem para decidir identidad o estado.
- **Errores:** `NOT_FOUND`, binding huérfano, hash ambiguo o falla de filesystem son resultados recuperables; nunca crean un draft ni otro estado durable como fallback.

### Protocolo ante contradicciones

Si código, brief o documentación contradice un invariante:

1. Emitir `Context Gap — Desktop Document Architecture` antes de implementar la interpretación contradictoria.
2. Citar el archivo/brief y la conducta exacta; nombrar el invariante vulnerado.
3. Clasificar el hallazgo: `stale-doc`, `legacy-code`, `incomplete-brief` o `normative-conflict`.
4. No "promediar" contratos ni asumir que el código actual gana por existir.
5. Si es `stale-doc`, corregirlo solo cuando la tarea autorice documentación y sincronizar `workflow/docs.json` si aplica.
6. Si es `legacy-code`, no expandirlo; ejecutarlo solo cuando el issue actual posea explícitamente esa migración. En otro caso, crear/actualizar el follow-up en Linear antes de continuar.
7. Si es `incomplete-brief`, detener BUILD/SHIP hasta que el Architecture Contract y Required docs queden completos.
8. Si ADR y spec se contradicen entre sí, clasificar `normative-conflict`, detenerse y pedir una decisión humana; ningún agente puede resolverlo por inferencia.

Un camino legacy no bloquea automáticamente el trabajo si el issue actual existe precisamente para retirarlo y el brief declara migración, rollback y evidencia. Sí bloquea usar ese camino como fundamento de arquitectura nueva.
