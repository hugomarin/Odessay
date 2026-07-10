# Odessay — Agent Instructions

Ver instrucciones completas en `workflow/agents.md`.

## Guardrail obligatorio — arquitectura documental desktop

Antes de modificar desktop, Desk, Workspace, Open Document, watcher, sync, SQLite, IndexedDB o identidad documental, leer:

1. `workflow/context/core/odessay-adr-identidad.md`
2. `workflow/context/features/odessay-desktop-document-catalog.md`

Estas decisiones son no negociables salvo un nuevo ADR aprobado:

- el `.md` materializado gobierna el contenido;
- `.odessay/index.json` es el ledger durable del binding local por `BindingRoot`;
- SQLite es el único catálogo operacional y cola durable de desktop;
- Supabase gobierna metadata y existencia cloud, no el contenido local materializado;
- un `WorkspaceReconciler` global proyecta eventos del filesystem a manifest + SQLite;
- Desk, Workspace, Search, Recent y Open Document consumen el mismo `DocumentCatalog`;
- Workspace es una vista organizativa, no un subsistema documental;
- abrir un archivo externo requiere confirmar su carpeta como `BindingRoot`, inicialmente limitado al archivo, sin convertirla obligatoriamente en Workspace;
- IndexedDB es el adapter local-first de web y solo compatibilidad transitoria en desktop;
- toda apertura `{ id | path }` reconcilia identidad y converge a `OpenDocument(UUID)` antes de hidratar el editor;
- el guardado desktop respeta `.md` atómico → manifest atómico → SQLite + enqueue → sync cloud en background;
- auth controla capacidades cloud, no la existencia ni visibilidad de archivos locales;
- la UI no consulta directamente SQLite, manifests, IndexedDB, Supabase ni rutas del filesystem;
- una falla de apertura nunca crea un draft ni estado durable como fallback.

Si un brief, documento o código contradice estas reglas, no seguir esa contradicción por inercia. Reportar `Context Gap — Desktop Document Architecture` con evidencia exacta y clasificarla como documento desactualizado, código legacy, brief incompleto o conflicto normativo. El ADR y el spec prevalecen sobre documentación subordinada y código legacy; si se contradicen entre sí, detenerse y pedir decisión humana.
