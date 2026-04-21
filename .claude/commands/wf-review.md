# wf-review

Revisa un issue de Linear siguiendo el protocolo REVIEW de Odessay.

## Uso
/wf-review ODE-88

## Instrucciones para el agente
1. Resolver el issue a partir del argumento recibido.
2. Leer `workflow/agents.md`.
3. Leer `workflow/workflow.md` y seguir estrictamente la sección `/wf-review [issue-id?]`.
4. Cargar sólo el contexto adicional que el protocolo indique para ese issue.
5. Ejecutar REVIEW end-to-end: validar gates, revisar PR, aprobar o rechazar, y actualizar Linear.
6. Al aprobar, incluir el marker obligatorio `REVIEW APROBADO`.
7. Al rechazar, incluir el marker obligatorio `REVIEW RECHAZADO`.
