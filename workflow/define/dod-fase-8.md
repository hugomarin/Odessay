# ODESSAY — Fase 8 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 8 — Biblioteca, Preview y Calidad de Producto**.
Si un punto no está cumplido, la fase no se considera terminada.

A diferencia de Fase 6/7 (convergencia de plataforma), Fase 8 no abre un nuevo runtime ni redefine el contrato documental. Es la fase de consolidación post-convergencia: llevar Biblioteca (Desk/Workspace), Preview y las superficies de lectura/sharing al nivel de calidad de un producto terminado, y cerrar deuda de identidad de documento que quedó abierta tras Fase 7. Se activó de facto con ODE-262 (2026-06-XX); este documento la formaliza retroactivamente y fija su alcance hacia adelante.

Referencias:
- `workflow/define/roadmap.md`
- `workflow/define/dod-fase-7.md`
- `workflow/context/core/odessay-adr-identidad.md`
- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `.agents/skills/skill-architecture/SKILL.md`
- `.agents/skills/skill-product-manager/SKILL.md`

---

## 1) Biblioteca (Desk/Workspace) a nivel de producto terminado

- `<ArtifactTable />` es el componente único de listado; Desk y Workspace no divergen visualmente sin justificación.
- Filtro, group-by, sort y bulk actions funcionan de forma consistente entre Desk y Workspace.
- El estado de documento (cloud-only / local-only / synced / pending) es visible y correcto en ambas superficies.

## 2) Preview como superficie completa, no un visor de solo lectura

- El modal de Preview cubre las acciones esenciales del writing (metadata, status, workspace, sharing, export, delete) sin obligar a abrir el editor completo.
- Preview y `/write/[id]` no contradicen su estado — abrir uno y luego el otro muestra el mismo documento, mismo estado.

## 3) Identidad de documento cerrada (D1–D10)

- No quedan contradicciones abiertas entre `title`, `filename`, `slug` e `id` en los flujos activos (ver `docs/document-identity-traps.md`).
- El ADR de identidad (`workflow/context/core/odessay-adr-identidad.md`) refleja el estado real del código, no un estado aspiracional.

## 4) Sharing con paridad real entre web y desktop

- Generar/copiar/rotar/revocar un preview link funciona nativamente en desktop, sin salir al navegador.
- Compartir y revocar acceso a una persona específica ("People") funciona nativamente en desktop.
- Un viewer autenticado puede convertir un writing compartido o de preview en una copia propia editable, desconectada del original — con paridad de intención entre la ruta web (`/preview/[token]`, `/shared/[id]`) y la ruta desktop (ODE-292: lectura + guardar-como-propio de "Shared with me").
- La lectura remota (`/preview/[token]`, `/shared/[id]`) sigue siendo una experiencia web-only en esta fase; desktop resuelve su propia vista de lectura de compartidos por su ruta ya definida en ODE-292, no reutilizando SSR web.

## 5) Calidad de corrección ortográfica AI

- El motor de corrección no genera falsos positivos por matching parcial de palabra.
- El cache de sugerencias se invalida correctamente tras ediciones manuales.
- Existe harness de regresión reproducible para apply + persistencia de correcciones.
- El autor puede enseñarle una palabra al motor ("Learn word"); esa palabra deja de marcarse en cualquier documento futuro, no solo en la instancia donde se aprendió.

## 5.1) Editor y Studio — ergonomía de trabajo con múltiples documentos

- Los tabs del editor se pueden reordenar por drag; Studio refleja el mismo orden sin trabajo adicional.
- Existe tabla de contenidos automática por documento, navegable por click, que se mantiene sincronizada con los headings sin acción manual.

## 5.2) Versions — ciclo de edición AI externa formalizado

- Existe un registro deliberado de versiones de un writing (no historial de cada tecleo), con snapshot inmutable y desconectado del documento activo.
- El watcher de desktop sugiere crear una versión cuando detecta que un `.md` cambió afuera de la app mientras tenía anotaciones de margen tipo `ai` abiertas — nunca crea la versión en silencio.
- El autor puede comparar dos versiones y obtener un reporte de cobertura por anotación `ai` más un resumen narrativo del cambio, generado por AI, de solo lectura.
- Esta funcionalidad no contradice el límite del agente residente (`odessay-ai-editor.md`): la evaluación observa y reporta, nunca escribe en el body del autor.

## 6) Promesa percibida por el usuario en esta fase

Al cerrar Fase 8, el usuario debe poder sentir que:

- la Biblioteca (Desk/Workspace) es predecible: mismo dato, misma UI, mismo comportamiento en ambos lugares
- Preview es suficiente para decidir sin tener que "entrar" al documento
- compartir y recibir contenido compartido se siente nativo en desktop, no como un salto a la web
- puede quedarse con su propia copia de algo que alguien le compartió, sin fricción ni ambigüedad de qué es "suyo"

## 7) Calidad de entrega (gate técnico)

- `typecheck` verde.
- `lint` verde.
- `tests` verdes.
- `ops:delivery:gate` verde en cada PR de la fase.
- Issues que tocan desktop/shared core/runtime boundaries/save path incluyen Architecture Contract cumplido.
- Issues que tocan presentación de texto cross-mode incluyen Presentation Contract cumplido cuando aplica.

## 8) Evidencia manual mínima

- Compartir un writing por link desde desktop, copiarlo, abrirlo en un navegador real y confirmar que carga.
- Compartir un writing con una persona específica desde desktop; confirmar que aparece en su "Shared with me" y que revocar lo hace desaparecer.
- Abrir un `/preview/[token]` sin sesión, click "Add to my writings", loguearse, confirmar que se crea una copia editable sin vínculo al original.
- Editar el original después de copiar y confirmar que la copia no cambia.
- Confirmar que Desk/Workspace no muestran estados de documento contradictorios tras las operaciones anteriores.

## 9) Gate de cierre de fase

Fase 8 se marca `Done` solo si:

- Se cumplen los 8 bloques anteriores para el alcance vigente al momento del cierre.
- No quedan issues `In Progress`/`Todo` con brief aprobado dentro del proyecto Linear de Fase 8.
- El roadmap y este DoD siguen alineados con lo efectivamente construido (si algo cambió de alcance durante la fase, este documento fue actualizado, no ignorado).
