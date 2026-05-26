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
