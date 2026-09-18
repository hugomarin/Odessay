# Odessay — Agent Instructions

Ver instrucciones completas en `workflow/agents.md`.

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
El archivo más cercano no es necesariamente el lugar correcto para un cambio. Resolver `Layer`, `Runtime scope`, `Owner` y contrato primero — ver `.agents/skills/skill-architecture/SKILL.md`.

### Proteger hotspots de orquestación
Los módulos centrales de composición (ej. `components/editor/editor-shell.tsx`, `src-tauri/src/commands/index.rs`) pueden cablear comportamiento, pero no deben adquirir ownership nuevo de dominio, persistencia o runtime. El tamaño de un hotspot no es en sí mismo la violación; que absorba una responsabilidad nueva sí lo es. Ver `Construction order` y `Hotspots` en `.agents/agents/build-agent.md`.

### El cambio más pequeño coherente
Preferir el cambio más pequeño que preserve ownership y contratos — no optimizar solo por menos archivos tocados, ni inflar un PR con decisiones no relacionadas. Ver `.agents/skills/review-change-size/SKILL.md`.

### Instrucciones scoped
Antes de modificar un subtree, verificar si existe un `AGENTS.md` más específico y aplicarlo. Hoy existen `components/editor/AGENTS.md` y `src-tauri/AGENTS.md`; si tu cambio cae fuera de ambos, solo aplican las reglas de este archivo.

---

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
