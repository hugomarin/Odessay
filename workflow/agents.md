# Odessay — Instrucciones para Agentes

Eres un agente de desarrollo trabajando en **Odessay**, un editor epistolar digital construido con Next.js 15, TipTap, Supabase y un provider AI server-side configurable.

## Lo que tienes disponible

- `workflow/docs.json`: El inventario completo del proyecto. Contiene la ruta y descripción de cada archivo en `workflow/` y `.agents/skills/`. Consúltalo para ubicarte.
- `workflow/workflow.md`: El protocolo maestro. Define qué hace cada comando `/wf-*` (como `/wf-define` o `/wf-build`). Léelo SIEMPRE que recibas un comando.
- `.agents/skills/`: Directorio que contiene el "cómo" (instrucciones técnicas, snippets y checklists por dominio de ingeniería o producto).
- `.agents/skills/skill-architecture/SKILL.md`: La capa de clasificación arquitectónica. Úsala cuando la tarea toque desktop, multi-runtime, shared core, save path, sync, parser/serializer o boundaries entre frontend/backend.

## Cómo operar

Este proyecto usa un modelo **contexto-justo-a-tiempo**:
Cuando recibas un comando `/wf-*`, lee `workflow/workflow.md` y sigue la secuencia definida paso a paso. No cargues contexto adicional al azar. Cada issue en Linear trae explícitamente citados los documentos que requiere en su línea `Referencia:`. Usa los skills solo cuando apliquen a la tarea en curso.

Los **roles de agente** viven en `.agents/agents/`.

- Para `/wf-define`, usar `.agents/agents/product-manager.md` como rol de orquestación.
- La convención de formato para roles vive en `.agents/agents/README.md`.
- Los skills en `.agents/skills/` complementan al rol; no lo reemplazan.

Si el prompt o task habla de desktop, portabilidad multi-runtime, shared core, adapters, `.md` como documento canónico, o extracción de servicios, empieza por `workflow/docs.json` y sigue la secuencia documental de desktop:

1. `workflow/context/features/odessay-desktop-app.md`
2. `workflow/context/features/odessay-desktop-migration-diagnostic.md`
3. `workflow/context/features/odessay-desktop-target-architecture.md`
4. `workflow/context/features/odessay-desktop-migration-plan.md`

Esa secuencia de cuatro documentos es la ruta normativa. `odessay-desktop-docs-corrections-log.md` es solo histórico y no reemplaza ninguno de los cuatro pasos.

Si además la pregunta es “dónde debe vivir esto” o “qué capa toca”, carga también `.agents/skills/skill-architecture/SKILL.md` antes de decidir si el trabajo cae en frontend, backend o database.

## Guardrail no negociable — catálogo e identidad documental desktop

Para cualquier trabajo que toque desktop, Desk, Workspace, Open Document, watcher, filesystem, SQLite, IndexedDB, sync/hydration, identidad o apertura documental, la carga mínima obligatoria es:

1. `workflow/context/core/odessay-adr-identidad.md` — autoridad de identidad, contenido y metadata.
2. `workflow/context/features/odessay-desktop-document-catalog.md` — autoridad del catálogo, BindingRoots, reconciliación, apertura y migración desktop.
3. La secuencia desktop de cuatro documentos indicada arriba para clasificar estado actual, arquitectura objetivo y plan.

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
- **Guardado:** el orden desktop es `.md` atómico → manifest atómico → SQLite + enqueue en transacción → sync cloud en background.
- **Boundaries:** la UI no depende directamente de SQLite, manifests, IndexedDB, Supabase, Tauri ni rutas de filesystem para decidir identidad o estado.
- **Errores:** `NOT_FOUND`, binding huérfano, hash ambiguo o falla de filesystem son resultados recuperables; nunca crean un draft ni otro estado durable como fallback.

### Protocolo ante contradicciones

Si código, brief o documentación contradice un invariante:

1. Emitir `Context Gap — Desktop Document Architecture` antes de implementar la interpretación contradictoria.
2. Citar el archivo/brief y la conducta exacta; nombrar el invariante vulnerado.
3. Clasificar el hallazgo: `stale-doc`, `legacy-code`, `incomplete-brief` o `normative-conflict`.
4. No “promediar” contratos ni asumir que el código actual gana por existir.
5. Si es `stale-doc`, corregirlo solo cuando la tarea autorice documentación y sincronizar `workflow/docs.json` si aplica.
6. Si es `legacy-code`, no expandirlo; ejecutarlo solo cuando el issue actual posea explícitamente esa migración. En otro caso, crear/actualizar el follow-up en Linear antes de continuar.
7. Si es `incomplete-brief`, detener BUILD/SHIP hasta que el Architecture Contract y Required docs queden completos.
8. Si ADR y spec se contradicen entre sí, clasificar `normative-conflict`, detenerse y pedir una decisión humana; ningún agente puede resolverlo por inferencia.

Un camino legacy no bloquea automáticamente el trabajo si el issue actual existe precisamente para retirarlo y el brief declara migración, rollback y evidencia. Sí bloquea usar ese camino como fundamento de arquitectura nueva.

## Regla de ramas y commits

- Nunca hacer commits directamente en `main`.
- Antes de cualquier `git commit`, verificar la rama actual con `git branch --show-current`.
- Si la rama actual es `main`, crear y cambiar a una rama `codex/<issue-o-tarea>` antes de editar o commitear.
- Si el trabajo ya quedó en `main` por error, corregirlo moviendo los commits a la rama de feat y restaurando `main` al commit previo.

## Regla de transición a In Review

Antes de mover cualquier issue a `In Review` en Linear, verificar que existe un PR abierto para la rama del issue:

```bash
gh pr list --head <rama-del-issue>
```

- Si no existe PR: **no mover a `In Review`**. Completar el BUILD abriendo el PR primero con `gh pr create`.
- Si existe PR: confirmar que está en estado `OPEN` antes de continuar.

Un issue en `In Review` sin PR es un estado inválido — indica que BUILD no completó su gate.

## Regla de mantenimiento de docs.json

Cuando una tarea cree, mueva o elimine un documento, actualiza `workflow/docs.json` al cerrar esa tarea — solo la entrada afectada, no el archivo completo. Para un mantenimiento profundo del inventario, usa `/wf-update-docs`.
