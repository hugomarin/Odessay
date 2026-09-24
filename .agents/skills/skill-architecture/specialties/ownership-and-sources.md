# Ownership, runtimes y fuentes de Odessay

Este recurso vincula ambos métodos con las fuentes de Odessay. `AGENTS.md` raíz conserva los guardrails y la precedencia desktop; los ADR y specs aceptados conservan sus decisiones. Architecture determina el contrato esperado y Recon investiga la implementación observada.

## Etiquetas de clasificación

| Eje | Etiquetas de Odessay | Uso |
| --- | --- | --- |
| `Layer` | `UI`, `Application`, `Domain`, `Adapter` | UI presenta e interactúa; Application coordina operaciones; Domain fija reglas e invariantes; Adapter conecta el contrato con infraestructura. |
| `Runtime scope` | `shared-core`, `web`, `desktop`, `cloud`, `mobile-future` | Declarar runtime actual y objetivo; un componente compartido puede consumir adapters distintos. |
| `Owner` | `frontend`, `backend`, `database`, `architecture-first` | Declarar owner principal y owner de cada parte. `architecture-first` señala que el contrato necesita una decisión antes de BUILD. |

## Fuentes por señal del cambio

| Señal | Fuente a consultar | Aporte |
| --- | --- | --- |
| Todo cambio | `AGENTS.md` raíz y `AGENTS.md` del subtree afectado | Guardrails, precedencia y ownership local. |
| Identidad, contenido, metadata, binding o lifecycle documental | `workflow/context/core/odessay-adr-identidad.md` | Contrato documental aceptado. |
| Catálogo, reconciliación, apertura, Desk/Workspace/Search/Recent o sync desktop | ADR anterior y `workflow/context/features/odessay-desktop-document-catalog.md` | Operación desktop; el ADR prevalece en identidad y fuente de verdad. |
| Dirección técnica desktop | `workflow/context/features/odessay-desktop-app.md`, `workflow/context/features/odessay-desktop-migration-diagnostic.md`, `workflow/context/features/odessay-desktop-target-architecture.md` y `workflow/context/features/odessay-desktop-migration-plan.md`, seleccionados por la pregunta concreta | Estado de transición y diseño objetivo subordinados al ADR y al catálogo. |
| Servicio compartido o adapter | `lib/services/contracts/*`, el brief y tests del área | Contrato, inputs, outputs, errores, invariantes y evidencia actual. |
| Construcción dentro del editor | `components/editor/AGENTS.md` | Límites del editor y rol de `editor-shell.tsx`. |
| Cambio nativo Rust/Tauri | `src-tauri/AGENTS.md` | Reglas scoped del runtime nativo. |
| Cambio que afecta costo al crecer | `.agents/skills/skill-performance/SKILL.md` | Forma de carga y evidencia proporcional. |

Para BUILD, `workflow/workflow.md` gobierna `Reference docs`: Recon puede investigar el código relevante, pero carga documentación de producto adicional solo mediante el brief o el protocolo de `Context Gap`. `workflow/agents.md` gobierna estados y seguimiento; Recon no crea un segundo protocolo de tracker. El Recon completo permanece en el contexto de BUILD; un hallazgo reusable se registra según el learning loop local.

En Odessay, `DocumentService`, `SyncService`, `AIService`, `AuthService`, `SharingService` y `AssetService` activan la clasificación cuando se modifica su contrato o su boundary. `app/api/*` es entrada del adapter web; Tauri, filesystem, SQLite e IndexedDB desktop pertenecen a adapters de runtime. Un cambio en `.md`, `body_json`, save o sync consulta primero el contrato documental y su owner de aplicación antes de asignar trabajo a frontend, backend o database. Si el cambio altera carga, fan-out, bootstrap o trabajo background, Architecture incorpora el bloque de evidencia que define `skill-performance`.

## Hotspots y salida operativa

`components/editor/editor-shell.tsx`, `src-tauri/src/commands/index.rs` y `lib/services/document-service-factory.ts` son puntos de composición que Recon revisa cuando el cambio los alcanza. El owner del comportamiento se determina con las fuentes y el código; la proximidad del hotspot no lo decide. `components/editor/AGENTS.md` y `.agents/agents/build-agent.md` explican los límites aplicables.

La clasificación de Architecture conserva los campos que consumen briefs y roles: `Layer` dominante/secundarias, `Runtime scope` actual/objetivo, `Ownership` principal y por parte (`Frontend owns`, `Backend owns`, `Database owns` cuando corresponda), `Contracts touched`, `Invariants`, `Boundaries`, `Required docs for the issue` y `Needs architectural contract first`. Recon agrega owner esperado y observado, API reutilizable, siblings clasificados, consumers, tests, hotspots y change surface. Los resultados citan las fuentes que los sostienen.

Ante una contradicción documental desktop, usar el formato y las clases de `Context Gap — Desktop Document Architecture` definidos en `AGENTS.md`. Ante ambigüedad de ownership observada en BUILD, usar `Context Gap — Architecture Recon` y la política de `workflow/workflow.md`. Un camino legacy se trata según el issue que posea su migración y las reglas del repositorio.

Para el `Context Gap — Architecture Recon` de BUILD, conservar `Source`, `Observed behavior`, `Ambiguity`, `Classification` (`duplicate-owner`, `contradicts-brief` o `normative-conflict`) y `Required action`. La falta de tests se registra en Recon y orienta la validación; una decisión ordinaria dentro de un owner claro se resuelve durante BUILD.
