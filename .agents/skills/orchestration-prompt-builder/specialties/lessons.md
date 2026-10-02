# Lecciones de orquestación (incidente → regla)

Cada regla del prompt existe por algo que pasó. Esta lista conserva el porqué para que una regla no se pierda al cambiar de versión ni se mantenga cuando su causa desapareció.

**Uso:** leerla entera antes de escribir un prompt. Para cada lección vigente, el prompt tiene la regla o el delta explica por qué se omite. Una lección **revertida** sigue aquí, con la razón: evita volver al error de ida y al de vuelta.

Origen: los prompts `/orchestration` v2 → v7 de P-ODE-43 (Odessay, 2026-09-27 → 2026-10-02) y sus retros.

## 1. Secuencia y paralelismo

| # | Incidente | Regla |
|---|---|---|
| S1 | En v2–v6 todo iba en serie: la tanda 2 (9 PRs) tomó unas 13 horas, sobre todo por la espera | Olas en paralelo según el grafo de conflictos (v7) |
| S2 | Con más de 3 builders a la vez en la misma máquina, 21 archivos fallaron en la suite completa (ODE-619) y todos pasaban aislados | Máximo 3 builders simultáneos y máximo 2 `npm test` completos simultáneos |
| S3 | Dos issues que tocan el mismo arnés, doble o fila se pisan (ODE-593 → 637) | El orden lo deciden los archivos compartidos, no la prioridad |
| S4 | Los merges simultáneos rompen el ledger y el mapa | Merges de uno en uno; antes de cada merge, `update-branch` |
| S5 | El coordinador de la primera tanda lanzó nodos sobre ramas apiladas | Un nodo se lanza solo con todas sus dependencias **mergeadas en main**, nunca sobre una rama sin mergear |
| S6 | Tras un merge, los PRs abiertos de la misma ola quedan atrás de main | El coordinador avisa a los builders con PR abierto que mergeen `origin/main` |
| S7 | Un issue grande en un solo PR hace la review imposible (ODE-605, ODE-609) | Un nodo por PR: el issue se parte en pasos (PR1, PR2, "part-two") con su propia review |

## 2. Recon, decisiones y briefs

| # | Incidente | Regla |
|---|---|---|
| R1 | Cada BUILD redescubría el área: Recon de 7 a 26 min (ODE-603: 26 min y 117 llamadas) | Recon de área una vez al planificar; BUILD **valida** el pack con `git diff` en 10 min o menos (ODE-605: de 8 a 13 min) |
| R2 | El Recon afirmó "la web no remonta" sin mirar el router de Next; el reviewer lo tumbó (tanda 1) | El Recon verifica el comportamiento del framework, no lo supone; la fase 0R verifica hechos al azar |
| R3 | 593, 620 y 619 llegaron sin Architecture Contract; 593 paró a mitad del BUILD | El Recon llena el contrato; gate de lint con contrato exigido antes de despachar |
| R4 | El v7 usó solo `--require-recon`, que **no** exige el contrato | El lint lleva siempre `--require-contract --require-recon` |
| R5 | Decisiones de producto descubiertas a mitad del BUILD frenaban la tanda | Fase H: todas las decisiones en una sola pregunta, con default; ningún issue sin `## Decisiones` |
| R6 | Un "— ajuste" posterior contradecía la decisión original (593, 636) | Precedencia: Decisiones (el ajuste manda) > Auditoría > Recon Pack > brief; un choque que cambia el alcance es Context Gap |
| R7 | El mapa de Recon de ODE-605 quedó desactualizado tras el corte | Cada PR actualiza el mapa del área; el reviewer lo exige |
| R8 | Un commit del Recon con `ODE-###` en el asunto hizo que `drift:strict` exigiera una fila de ledger | Los commits del PR del mapa no nombran ningún `ODE-###` en el asunto |
| R9 | Desde el paso 2 de un issue, el `git diff` del pack muestra los pasos anteriores, y el builder lo leía como cambio estructural | Prever en el prompt que los cambios de pasos previos del mismo issue son esperados |
| R10 | La Auditoría profunda encontró problemas que el brief no veía (el 404 de 660, una fuga en 616, un filtro que escondía documentos) | El Recon es una lectura profunda y adversarial del código, nunca un resumen |

## 3. BUILD

| # | Incidente | Regla |
|---|---|---|
| B1 | Suite completa corrida 3–4 veces por build (ODE-624: 113 min para un arreglo de 4 líneas) | Mientras se trabaja, solo los archivos afectados; al final, `--changed` una vez; la suite completa solo si se tocan support, config o `package.json` |
| B2 | El builder comparaba contra un worktree de main por fallos intermitentes ajenos | Re-correr el archivo aislado; comparar contra main solo si falla aislado |
| B3 | El builder esperaba el CI en un bucle (7 min) | No esperar el CI: el body del PR, el Context Report y la Guía se escriben mientras corre |
| B4 | Las mutaciones se corrían dos veces, en build y en review | Una sola en BUILD (la fase roja del bug real, o la del modo de fallo); el resto se lista y lo corre REVIEW |
| B5 | Un prompt de permiso sin responder por escribir en `/tmp` costó unos 30 min (ODE-624) | Temporales en `.cache/` dentro del worktree |
| B6 | Un `--amend` cayó en el commit equivocado; un `git add -A` tras un merge arrastró archivos ajenos | `git log -1` antes de `--amend`; nunca `git add -A` tras un merge |
| B7 | El builder declaró "no construible" el test entre render y efecto y sí lo era: 2 FAIL en 609 | Intentarlo de verdad y dejar el intento en el PR antes de declarar algo no construible |
| B8 | Ciclos de fix mecánicos por orden de commits y por el flip de `it.fails` | `ops:proof:precheck` antes del PR; si falla, rebase no interactivo y `--force-with-lease` solo en la rama propia |
| B9 | Un bug real arreglado sin test rojo previo dejó la prueba sin discriminar | `it.fails` en su propio commit, después el fix sin tocar el cuerpo del test; en Rust, commit con `cargo test` en rojo |
| B10 | El nombre de rama con otros números hizo que el gate los tomara como IDs | Ramas `hugomarin/ode-<n>-<tema>`, sin otros números; la parte 2 se escribe en palabras ("part-two") |
| B11 | Un builder sobre-complejizó (30 min estresando la CPU para reproducir un flaky) | No sobre-complicar: el mínimo que cumple el brief; lo demás, anotado |
| B12 | Builds que se quedaron sin cerrar el paso In Review + Context Report | El reviewer no rechaza por eso: lo completa y lo registra (precedente ODE-413/414) |

## 4. REVIEW y cierre

| # | Incidente | Regla |
|---|---|---|
| V1 | El reviewer de ODE-629 dio PASS y se quedó sin tokens antes de mergear | Cerrar primero (merge, ledger, tracker) y escribir el comentario largo después |
| V2 | Mismo caso: alguien tenía que terminar | Fallback de solo cierre: otra herramienta cierra sin revisar, solo si el head es exactamente el SHA del veredicto y el CI está verde |
| V3 | Re-reviews completas para fixes de solo docs | Re-review ligera si el diff posterior solo toca docs o tests |
| V4 | El reviewer re-verificaba a mano el orden de commits y el flip | Con el precheck en verde no se re-verifica; el foco es el rojo por la razón declarada, las mutaciones en vivo y el estado de la fila |
| V5 | Las heurísticas para juzgar el Status y la Note de la fila dejaban pasar otras redacciones (#574) | La coherencia entre Status y Note la juzga el reviewer, no un script |
| V6 | El reviewer cambió de rama el checkout principal al escribir el ledger | El ledger se escribe en un worktree temporal de main, nunca en el checkout principal |
| V7 | Rechazos registrados sin `review_rejected` en el asunto pusieron `drift:strict` en rojo para todos | El asunto del commit de un rechazo lleva `review_rejected` |
| V8 | El ledger consolidado por issue chocaba con varios PRs (desde #558) | Una fila `append-built` por PR con su `pr_url`; las parciales empiezan con "PARTIAL DELIVERY — paso N de M" |
| V9 | La integración GitHub → Linear movió a Done issues con PRs parciales | Al mergear un parcial, el reviewer devuelve el issue a In Progress y lo comenta |
| V10 | `drift:strict` se cobra en el **siguiente** PR, no en el que lo causa | Ledger appendeado inmediatamente después de cada merge |
| V11 | Faltaba el preview de Vercel en heads de solo docs | Se acepta por equivalencia cuando el head solo toca docs |
| V12 | Hallazgos de seguridad tratados como notas | Bloquean desde el primer review |

## 5. Herramientas y modelos

| # | Incidente | Regla |
|---|---|---|
| T1 | El mismo agente revisaba lo que había construido o corregido | Independencia obligatoria: quien revisa nunca construyó ni hizo las últimas correcciones |
| T2 | (v5) Codex no enviaba su señal de "listo" en Orca, y se sacó de los roles | **Revertida en v7:** en la tanda 2 envió `worker_done` siempre. Además, BUILD se da por terminado por **evidencia** (PR, Context Report, estado del issue), no por la señal |
| T3 | Orca rechaza `--effort max` para gpt-6-luna (`invalid_argument`) | Lanzar Codex sin `--model` ni `--effort`; la config los fija; confirmar en la terminal |
| T4 | La config de Codex pasó a `xhigh` a mitad de la tanda 3 | Confirmar modelo y esfuerzo **en cada lanzamiento**, no solo en el primero |
| T5 | El primer arranque de Codex mostró "Update available" y el worker quedó en `agent_readiness` | Elegir "Skip until next version"; si queda trabado, `worker-release` y relanzar con `--retry-of` |
| T6 | Orca rechaza `--model` para opencode | OpenCode usa el modelo de su propia config |
| T7 | Un worker transcribió mal su handle y Orca rechazó el heartbeat (`dispatch_capability_invalid`) | Copiar el handle exacto del preámbulo |
| T8 | Un worker leyó el buzón del coordinador (`check --run`), recibió `consumer_fenced` y se detuvo sin `worker_done` | Los workers leen solo con el `check` de su preámbulo y su `--terminal` |
| T9 | Fallos de herramienta confundidos con FAIL de review | Solo cuentan caída, cuelgue, límite de uso o contexto, no disponible, el mismo error dos veces o 90 min sin avance; un FAIL vuelve a BUILD sin cambiar de herramienta |

## 6. Coordinador y entorno

| # | Incidente | Regla |
|---|---|---|
| C1 | Ruido por heartbeats reportados al humano | Esperar solo `worker_done,escalation,question`; los heartbeats se marcan con `--ack` |
| C2 | Esperas duplicadas en el mismo Run | Una sola espera activa; `waiter_exists` significa que la anterior sigue viva |
| C3 | Una espera devolvió `runtime_unavailable` | `request-show --request <id>` y relanzar con `--retry-request` |
| C4 | Workers detenidos sin `worker_done` | `worker-stop`, después `worker-abandon` si queda `stop_unknown`, `worker-start --task … --retry-of …` en el mismo worktree y mensaje con lo ya hecho |
| C5 | Fases que pasaban de una hora sin que nadie preguntara | Control de tiempo: 60 min sin commits → preguntar; 90 min sin avance → fallback; 2 h sin causa legítima → parar |
| C6 | Issues de seguimiento creados duplicados (653 de 649) o en el workspace equivocado (CON) | No se crean issues durante la orquestación: `it.fails` "follow-up pendiente" y una lista para el humano al cerrar |
| C7 | El reviewer se detenía a pedir permiso para `git push`, `gh pr merge`, `cargo test` o el CLI del tracker | Precondición: permisos de los agentes configurados antes de arrancar |
| C8 | En la tanda 3 se creyó que la config de Linear de Orca apuntaba a otro workspace porque decía "Context Atelier". Era falsa alarma: es el nombre de la organización (urlKey `hugo-marin`), que contiene los teams ODE y CON | Precondición: leer un issue de la tanda con `orca linear issue <id>` y comprobar team ODE; no juzgar por el nombre de la organización |
| C9 | El MCP del tracker apuntaba a otro workspace | Usar el CLI o GraphQL del proyecto, no el MCP |
| C10 | Los agentes no deben tocar producción | Toda acción en producción es un gate humano con mensaje exacto (conteo antes, migración después) |
| C11 | `.env.local` tiene la service role de producción y los worktrees lo heredan por symlink | Nada fuera del harness usa esa key; los comandos peligrosos del CLI de la base de datos están prohibidos |
| C12 | Dos workers usando la misma base local se pisaban | Lock compartido para la base local y un solo worker la reinicia, una vez |
| C13 | Compilar Rust desde cero en cada worktree tarda mucho | Clonar `target/` con un clon APFS (`cp -cR`) antes de compilar |
| C14 | El humano se perdía con reportes largos y frecuentes | Reporte de 3 líneas solo al cerrar un PR, ante un gate o ante una pregunta; una sola pregunta |

## 7. Lecciones de la primera prueba del skill (v8, 2026-10-02)

| # | Incidente | Regla |
|---|---|---|
| P1 | Un agente al que se le pidió "usa el skill de orquestación" cargó el skill `orchestration` de **Orca** (el que ejecuta el prompt) y entregó tres specs de worker sueltos, sin DAG, roles, cierre, ledger, gates, tiempo ni paradas | Nombre distintivo (`orchestration-prompt-builder`), contrato de salida al inicio del SKILL.md ("specs sueltos no es terminado") y puntero en `workflow/agents.md` |
| P2 | El skill solo existía en la rama de un PR; el agente trabajaba en `main` y no lo encontró | El skill tiene que estar en la rama donde trabaja el agente; mientras no esté en `main`, el agente trabaja en la rama del PR |
| P3 | Al generar el prompt apareció una decisión nueva (un PR abierto fuera de la tanda que toca los mismos archivos) y se inventó un "default a los 10 min" | Un gate espera `gate-resolve`; **un default nunca se aplica solo**. Mientras tanto avanza el resto del DAG |
| P4 | Las decisiones C, D y G hicieron crecer ODE-652 por encima de un PR revisable | Después de la fase H, re-evaluar el tamaño de cada nodo: una decisión puede obligar a partir un issue en varios PRs |
| P5 | Un PR abierto ajeno a la tanda (#423, parado y en conflicto) tocaba los archivos de un nodo | Los PRs abiertos fuera de la tanda que tocan los mismos archivos entran al grafo como decisión humana (esperar o no) con default y gate |
| P6 | El Recon tuvo correcciones posteriores (comentario "Recon Pack correction", "segunda pasada" de la auditoría) | En la precedencia de entradas, una corrección o ronda posterior manda sobre la anterior del mismo tipo |
| P7 | Precondiciones escritas sin comando ("verificar permisos") | Cada precondición lleva su comando y su resultado esperado; si no se puede verificar con un comando, es una pregunta al humano |

