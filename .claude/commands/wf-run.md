# wf-run

Orquesta build y review automático para uno o varios issues de Linear.

## Uso
/wf-run ODE-50,51,52

## Lo que hace
- Ejecuta wf-build y wf-review en loop automático por cada issue.
- Si el review rechaza, vuelve a build con el contexto del rechazo.
- Cuando aprueba, pasa al siguiente issue.
- Escribe log en logs/wf-run-{fecha}.log.
- Deja comentario en Linear solo en HANDOFF y al terminar el run.

## Instrucciones para el agente
1. Extraer los issue IDs del mensaje del usuario.
2. Verificar que scripts/wf-run.ts existe en el repo.
3. Ejecutar: npx tsx scripts/wf-run.ts {issueIds} desde la raíz del repo.
4. Hacer streaming del output en tiempo real.
5. Si aparece ⏸ HANDOFF en el output, reportarlo al usuario y pausar.
6. No modificar código ni tomar decisiones — solo invocar y reportar output.
