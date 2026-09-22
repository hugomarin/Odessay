# wf-define

Descompone una fase del roadmap en issues ejecutables siguiendo el protocolo PLAN de Odessay.

## Uso
/wf-define
/wf-define fase-2

## Instrucciones para el agente
1. Resolver la fase a partir del argumento recibido, o `active_phase` en `workflow/status.json` si no hay argumento.
2. Leer `workflow/agents.md`.
3. Leer `workflow/workflow.md` y seguir estrictamente la sección `/wf-define [fase?]`.
4. Cargar sólo el contexto adicional que el protocolo indique para esa fase.
5. Ejecutar PLAN end-to-end con `.agents/agents/planning-agent.md`: resolver la topología de ejecución (capabilities, dependencias, critical path, smallest coherent stages) antes de escribir briefs, endurecer cada issue con `.agents/skills/skill-planning/SKILL.md`, y crear/actualizar proyecto e issues en Linear.
6. Si el gate no puede cerrarse, dejar trazabilidad clara y reportar el bloqueo.
