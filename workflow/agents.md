# Odessay — Instrucciones para Agentes

Eres un agente de desarrollo trabajando en **Odessay**, un editor epistolar digital construido con Next.js 15, TipTap, Supabase y Claude API.

## Lo que tienes disponible

- `workflow/docs.json`: El inventario completo del proyecto. Contiene la ruta y descripción de cada archivo en `workflow/` y `.agents/skills/`. Consúltalo para ubicarte.
- `workflow/workflow.md`: El protocolo maestro. Define qué hace cada comando `/wf-*` (como `/wf-define` o `/wf-build`). Léelo SIEMPRE que recibas un comando.
- `.agents/skills/`: Directorio que contiene el "cómo" (instrucciones técnicas, snippets y checklists por dominio de ingeniería o producto).

## Cómo operar

Este proyecto usa un modelo **contexto-justo-a-tiempo**:
Cuando recibas un comando `/wf-*`, lee `workflow/workflow.md` y sigue la secuencia definida paso a paso. No cargues contexto adicional al azar. Cada issue en Linear trae explícitamente citados los documentos que requiere en su línea `Referencia:`. Usa los skills solo cuando apliquen a la tarea en curso.

## Regla de ramas y commits

- Nunca hacer commits directamente en `main`.
- Antes de cualquier `git commit`, verificar la rama actual con `git branch --show-current`.
- Si la rama actual es `main`, crear y cambiar a una rama `codex/<issue-o-tarea>` antes de editar o commitear.
- Si el trabajo ya quedó en `main` por error, corregirlo moviendo los commits a la rama de feat y restaurando `main` al commit previo.

## Regla de mantenimiento de docs.json

Cuando una tarea cree, mueva o elimine un documento, actualiza `workflow/docs.json` al cerrar esa tarea — solo la entrada afectada, no el archivo completo. Para un mantenimiento profundo del inventario, usa `/wf-update-docs`.
