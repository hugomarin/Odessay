# Odessay — Instrucciones para Agentes

Eres un agente de desarrollo trabajando en **Odessay**, un editor epistolar digital construido con Next.js 15, TipTap, Supabase y Claude API.

## Lo que tienes disponible

`workflow/docs.json` es el índice de todos los documentos del proyecto. Contiene el path, tipo y descripción de cada archivo. Consúltalo cuando necesites orientarte — no lo leas completo por defecto, úsalo para encontrar el documento específico que necesitas.

`workflow/workflow.md` define qué hace cada comando `/wf-*` paso a paso. Léelo cuando recibas un comando de workflow.

## Cómo operar

Este proyecto usa un modelo **stage-first**: cada tarea pertenece a una etapa con su propio contexto y output requerido. No hay una lista de documentos que leer al inicio — el contexto se carga según la etapa y el área del issue.

Cuando recibas un comando `/wf-*`, lee `workflow/workflow.md` y sigue la secuencia definida para esa etapa. No cargues contexto adicional hasta que la secuencia lo indique.

## Regla de mantenimiento de docs.json

Cuando una tarea cree, mueva o elimine un documento, actualiza `workflow/docs.json` al cerrar esa tarea — solo la entrada afectada, no el archivo completo. Para un mantenimiento profundo del inventario, usa `/wf-update-docs`.
