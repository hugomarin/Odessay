# Odessay — Agentes

**Índice de documentación de la plataforma de agentes.**

Este directorio documenta la arquitectura objetivo del **Workspace Agent**: cómo recibe una invocación, compone el contexto, decide qué información consumir, selecciona una capacidad, ejecuta tools o workflows y presenta una respuesta accionable.

No define un runtime nuevo ni reemplaza las decisiones documentales de desktop. Debe leerse junto con:

- `workflow/context/core/odessay-adr-identidad.md` — identidad y fuente de verdad del documento.
- `workflow/context/features/odessay-desktop-document-catalog.md` — catálogo, `BindingRoot`, reconciliación y apertura desktop.
- `workflow/context/features/odessay-desktop-target-architecture.md` — shared core y adapters por runtime.
- `workflow/context/features/odessay-workspace.md` — alcance y límites de Workspace por runtime.

## Orden de lectura

1. `odessay-agent-architecture.md` — mapa general, ownership y boundaries.
2. `odessay-agent-context.md` — `AgentInvocation`, `ContextEnvelope`, composición e incorporación lazy.
3. `odessay-agent-execution.md` — intents, tools, workflows, propuestas y UI de decisión.
4. `odessay-agent-context-cache.md` — artifacts, cache, presupuesto, costo e invalidación.

## Frontera con los sistemas AI existentes

Estos documentos no fusionan tres sistemas que tienen contratos distintos:

- `workflow/context/features/odessay-ai-editor.md` sigue siendo la autoridad del **AI Editor residente**. Ese agente observa y discute el texto, pero no genera ni escribe en el body del autor.
- `workflow/context/features/odessay-ai-writing-assist.md` sigue siendo la autoridad del sistema mecánico de correcciones y sugerencias de título.
- Este directorio documenta el **Workspace Agent**, un agente operacional invocado por el usuario que puede leer documentos y proponer acciones sobre ellos. Las mutaciones siguen requiriendo aprobación y pasan por tools autorizadas.

Una implementación no puede usar este directorio para relajar los límites del AI Editor residente ni para crear un segundo catálogo documental.

## Estado del contrato

Estos documentos consolidan la arquitectura objetivo que se está definiendo alrededor de ODE-489 y ODE-490. Mientras no exista una decisión posterior que los eleve a contrato aceptado, no autorizan por sí solos una contradicción con el ADR de identidad ni con el spec del `DocumentCatalog`.

La palabra **disponible** significa que el agente tiene una referencia y permiso potencial para solicitar una fuente. No significa que la fuente ya se haya leído ni que se haya enviado al modelo.

