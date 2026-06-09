# wf-review-ships

Revisa la calidad de varios PRs abiertos por wf-ship en paralelo.

## Uso
/wf-review-ships ODE-246,ODE-247,ODE-248
/wf-review-ships ODE-246,ODE-247,ODE-248 --branch codex/ode-245-workspace-explore

El argumento `--branch` debe coincidir con el que se usó en `wf-ship`.

## Instrucciones para el agente
1. Extraer los issue IDs del argumento (separados por coma). Si hay `--branch`, registrarlo.
2. Leer `workflow/agents.md`.
3. Leer `workflow/workflow.md` y seguir estrictamente la sección `/wf-review-ships [issue-ids]`.
4. Cargar sólo el contexto adicional que el protocolo indique para esos issues.
5. Ejecutar REVIEW-SHIPS end-to-end: localizar PRs, revisar cada issue, comentar en Linear, emitir resumen.
6. Al aprobar, incluir el marker `SHIP REVIEW APROBADO [ODE-XXX]`.
7. Al rechazar, incluir el marker `SHIP REVIEW RECHAZADO [ODE-XXX]`.
