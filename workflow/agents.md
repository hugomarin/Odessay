# Odessay — Instrucciones para Agentes

Eres un agente de desarrollo trabajando en **Odessay**, un editor epistolar digital construido con Next.js 15, TipTap, Supabase y un provider AI server-side configurable.

Las reglas universales de construcción, invariantes y guardrails del repositorio viven en `AGENTS.md` (raíz) — es su canonical owner. Este documento no las repite: define las instrucciones operativas del sistema `/wf-*` — qué hace cada comando, qué contexto carga, qué roles de agente usa, y cómo interactúa con Linear, ramas y estados.

## Lo que tienes disponible

- `workflow/docs.json`: El inventario completo del proyecto. Contiene la ruta y descripción de cada archivo en `workflow/` y `.agents/skills/`. Consúltalo para ubicarte.
- `workflow/workflow.md`: El protocolo maestro. Define qué hace cada comando `/wf-*` (como `/wf-define` o `/wf-build`). Léelo SIEMPRE que recibas un comando.
- `.agents/skills/`: Directorio que contiene el "cómo" (instrucciones técnicas, snippets y checklists por dominio de ingeniería o producto).
- `.agents/skills/skill-architecture/SKILL.md`: Clasifica responsabilidades, contratos y runtimes. Úsala cuando el cambio requiera decidir ownership, fuente de verdad o boundaries; las operaciones desktop, shared core, save, sync y parser/serializer la activan cuando afectan esas decisiones, según `AGENTS.md`.

## Cómo operar

Este proyecto usa un modelo **contexto-justo-a-tiempo**:
Cuando recibas un comando `/wf-*`, lee `workflow/workflow.md` y sigue la secuencia definida paso a paso. No cargues contexto adicional al azar. Cada issue en Linear trae explícitamente citados los documentos que requiere en su línea `Referencia:`. Usa los skills solo cuando apliquen a la tarea en curso.

Los **roles de agente** viven en `.agents/agents/`.

- Para `/wf-define`, usar `.agents/agents/planning-agent.md` como rol de orquestación. Resuelve la topología de ejecución (capabilities, dependencias, critical path) antes de escribir briefs, y usa `.agents/skills/skill-planning/SKILL.md` para endurecer cada issue de esa topología.
- Para `/wf-build`, usar `.agents/agents/build-agent.md` como rol de orquestación. Ejecuta `.agents/skills/architecture-recon/SKILL.md` antes de implementar cualquier cambio no trivial, para localizar owner/siblings/consumers/tests reales antes de escribir código.
- Para `/wf-review`, usar `.agents/agents/review-agent.md` como rol de orquestación. Usa `.agents/skills/skill-code-review/SKILL.md` y sus referencias de corrección, arquitectura, testing y tamaño del cambio según el scope real del diff.
- La convención de formato para roles vive en `.agents/agents/README.md`.
- Los skills en `.agents/skills/` complementan al rol; no lo reemplazan.

Antes de modificar `components/editor/**` o `src-tauri/**`, leer también el `AGENTS.md` local de ese subtree — trae las reglas específicas del hotspot (qué no debe absorber, qué deuda ya está identificada y no debe copiarse).

Si el trabajo afecta identidad, contenido, metadata, binding o lifecycle documental, cargar el ADR de identidad según `AGENTS.md`. Si afecta catálogo, reconciliación, apertura, save o sync desktop, cargar además el spec del catálogo. `workflow/docs.json` permite localizar esas fuentes y los documentos de apoyo; dirección desktop, diagnóstico, target architecture y migration plan se consultan cuando la pregunta requiere producto, estado vigente, diseño objetivo o secuencia de transición, respectivamente. La precedencia normativa vive en `AGENTS.md`.

Si además la pregunta es “dónde debe vivir esto” o “qué capa toca”, carga también `.agents/skills/skill-architecture/SKILL.md` antes de decidir si el trabajo cae en frontend, backend o database.

## Guardrail no negociable — catálogo e identidad documental desktop

Los invariantes de identidad/catálogo, su precedencia (ADR → spec del catálogo → target architecture/plan → código) y el protocolo `Context Gap — Desktop Document Architecture` viven en `AGENTS.md` (raíz) — es el canonical owner de este contrato. Leerlo ahí antes de tocar desktop, Desk, Workspace, Open Document, watcher, filesystem, SQLite, IndexedDB, sync/hydration, identidad o apertura documental. No se repiten aquí para evitar que ambos archivos diverjan con el tiempo.

Los documentos de apoyo se seleccionan por la pregunta concreta y conservan la precedencia declarada en `AGENTS.md`.

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
