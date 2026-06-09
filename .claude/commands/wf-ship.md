# wf-ship

Implementa un issue y cierra a Done sin pasar por wf-review.

## Uso
/wf-ship ODE-88
/wf-ship ODE-88 --branch codex/ode-245-workspace-explore

## Instrucciones para el agente
1. Resolver el issue a partir del argumento recibido. Si hay `--branch`, registrarlo.
2. Leer `workflow/agents.md`.
3. Leer `workflow/workflow.md` y seguir estrictamente la sección `/wf-ship [issue-id]`.
4. Cargar sólo el contexto adicional que el protocolo indique para ese issue.
5. Ejecutar SHIP end-to-end: implementación, validaciones, PR, workflow files, comentario y Done en Linear.
6. Si el gate no puede cerrarse, dejar trazabilidad clara en Linear y reportar el bloqueo.
7. Emitir `SHIP completado — PR #{número} abierto, listo para merge manual.`
