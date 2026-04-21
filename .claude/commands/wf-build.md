# wf-build

Implementa un issue de Linear siguiendo el protocolo BUILD de Odessay.

## Uso
/wf-build ODE-88

## Instrucciones para el agente
1. Resolver el issue a partir del argumento recibido.
2. Leer `workflow/agents.md`.
3. Leer `workflow/workflow.md` y seguir estrictamente la sección `/wf-build [issue-id?]`.
4. Cargar sólo el contexto adicional que el protocolo indique para ese issue.
5. Ejecutar BUILD end-to-end: implementación, validaciones, PR y comentario de evidencia en Linear.
6. Si el gate no puede cerrarse, dejar trazabilidad clara en Linear y reportar el bloqueo.
