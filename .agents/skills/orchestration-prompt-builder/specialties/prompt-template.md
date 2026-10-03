# Plantilla del prompt `/orchestration`

Esqueleto del prompt que se entrega a Orca. Hay dos tipos de bloque:
- **Bloques de tanda:** marcados con `<…>`, se rellenan con el DAG, los gates y las notas de esta tanda.
- **Bloques fijos:** se copian tal cual. Solo cambian cuando una lección nueva de `lessons.md` lo justifica, y el cambio se explica en el delta.

Los comandos son los de Odessay (`odessay-binding.md`). En otro proyecto, se sustituyen por los de su especialidad local.

El prompt va **en el idioma del humano**, autosuficiente: el coordinador no estuvo en ninguna conversación.

---

```text
/orchestration v<N> — <proyecto>, <milestone>, <tanda>: <lista de nodos o issues>

v<N> (<fecha>). <Base: v<N-1> + delta, o "autosuficiente">. <Una línea: qué cubre la tanda.>

## Qué cambia respecto del v<N-1>
<Viñetas del delta, cada una con el incidente que la motiva.>

## Precondiciones (comprobarlas antes de despachar nada)
1. <PR o issue que debe estar mergeado> — `<comando de verificación>` → <resultado esperado>.
2. La orquestación anterior (Run `<id>`) está cerrada y sin dispatches vivos: `orca orchestration worker-list --json`, todo `completed` o `failed`. No corre en paralelo con otra. Opcional: `worker-release` de las terminales retenidas.
3. Lint de todos los issues: `npm run ops:brief:lint -- <ids> --require-contract --require-recon`. Si alguno falla: parar y reportar. No completar briefs a mano.
4. <Permisos de los agentes, que el tracker se lee bien desde Orca y otras precondiciones operativas de la Auditoría. **Cada una con su comando y su resultado esperado.**>

## Entradas de cada issue (orden de precedencia)
<Regla: una corrección o ronda posterior manda sobre la anterior del mismo tipo ("Recon Pack correction" > Recon Pack; "segunda pasada" > primera Auditoría).>
1. El comentario `## Decisiones (<humano>, <fecha>)`. Un "— ajuste" manda sobre lo anterior.
2. La sección "Auditoría" de la descripción.
3. El comentario `## Recon Pack (verificado en main@<sha>)` y el `## Architecture Contract` del brief.
4. El brief original.
Si un choque entre dos entradas cambia el alcance: Context Gap y parar.
Mapa compartido: `<documento> § <sección>` (entra con el PR #<n>).

## Secuencia
### Fase 0R — review del Recon (<herramienta>). Termina con el PR #<n> mergeado.
<Bloque fijo, de skill-code-review § Review de un Recon:
- al menos 4 rangos al azar por issue en el sha declarado;
- los hallazgos que cambian el alcance, nombrados uno a uno;
- el recuento esperado: <valores>;
- diff de solo docs y ningún ODE-### en los asuntos de commit;
- PASS: update-branch, CI verde, merge y comentario en cada issue;
- FAIL: parar y reportar. Nada se despacha antes del PASS.>

### <Fase H, si quedan decisiones: una sola pregunta al humano con defaults. Si ya está hecha, marcarla ✅ con la fecha.>

### Grafo de dependencias (DAG). Despachar cuando las dependencias estén mergeadas y haya hueco (máximo 3 builders)
| Id | Trabajo | Depende de (mergeado) | Ola | Tamaño |
|---|---|---|---|---|
<filas de dag-and-waves.md § 6; los gates en filas propias en negrita>

**Prioridad al llenar un hueco:** <1. Urgent; 2. lo que desbloquea más; 3. orden de la tabla>.
**Merges, de uno en uno.** Orden preferente: <por ola>. Un PR aprobado no espera a otro sin arista dura.
**Paradas humanas (gates de Orca, con `gate-create`):**
- **<G1>, <momento>.** Mensaje: "<texto exacto>". Verificación: <comando>. Mientras tanto: <qué sigue>.
<…>
Después de la ola <última>, parar y reportar. No empezar issues fuera de la tabla, ni <lista de los que parecen listos pero no van>.

**Override de ORCA:** con PASS, el reviewer mergea (`gh pr merge <n> --merge -R <repo>`, nunca squash), appendea el ledger en main y mueve el issue en el tracker. El builder no mergea.

## Roles y herramientas
<Tabla de roles-and-models.md § 2, ya comprobada en la máquina.>
<Detalles de lanzamiento por herramienta (roles-and-models.md § 3).>
<Independencia, fallo de herramienta, traspaso, fallback de solo cierre y límites (roles-and-models.md § 4).>

## Recordatorios de Orca para CADA spec de worker (build y review)
<Bloque fijo: roles-and-models.md § 5.>
Plantillas de spec: más abajo (Target / Change / Constraints / Ownership / Observable acceptance), rellenadas por nodo con su fila del DAG.

## BUILD (<herramienta>; fallback <herramienta>): reglas   ← bloque fijo
- Sigue /wf-build (workflow/agents.md y la sección /wf-build de workflow/workflow.md).
- Paso 1: `npm run ops:brief:lint -- <issue> --require-contract --require-recon` antes de pasar a In Progress.
- **Rama:** worktree nuevo (`--worktree new-top-level --name … --base-branch origin/main`), con rama `hugomarin/ode-<n>-<tema>`, sin otros números (el gate toma cada segmento numérico como un ID). Las partes 2 se escriben en palabras ("part-two").
- **Traceability:** `[ODE-<n>]` en cada commit y en el título del PR. Ningún asunto nombra otro ODE-###. npm, nunca pnpm.
- **Recon en modo validación (10 min o menos):** `git diff <sha del pack>..origin/main -- <archivos del pack>`.
  - Vacío: empezar.
  - Con cambios: revalidar solo esos rangos; los cambios de los pasos anteriores del mismo issue son esperados.
  - Cambio estructural: "Context Gap — Recon Pack" y parar.
  - Anotar el tiempo.
  - El campo "Construir con" del pack es el punto de partida: reutilizar lo que nombra y no crear lo que excluye. Desviarse exige una Recon correction.
- **Construcción de la prueba** (capability-proof-contract.md, las 10 reglas): producción como punto de entrada, la secuencia real, solo fronteras externas fakeadas, afirmar después del evento de completitud y sobre el resultado canónico, dobles con todas las formas de llamada.
- **Bug real:** primero `it.fails` en su propio commit, después el fix sin tocar el cuerpo del test (en Rust, un commit con `cargo test` en rojo). Arreglar solo en el owner que nombran el pack o las Decisiones. Si cambia un contrato, o es pérdida de datos o seguridad no prevista: parar y preguntar.
- **"No construible":** intentarlo de verdad y dejar el intento en el PR antes de declararlo. Si de verdad no se alcanza, la fila queda en PARTIAL_INTEGRATION con la costura nombrada.
- **Mutaciones:** antes de abrir el PR, el builder corre **todas** las de la Guía de review (la fase roja del bug real, el modo de fallo, el control positivo si se afirma una ausencia y las demás), cada una contra **solo el archivo de test indicado**, y revierte. La Guía pega por mutación: el cambio exacto, el test y la línea de la aserción que falló. Una mutación que queda en verde no se entrega: se arregla el test o se quita de la Guía con la razón escrita.
- **Suite local:** mientras trabajas, solo los archivos afectados; al terminar, `npm test -- --changed origin/main` una vez, más typecheck y lint. La suite completa solo si se tocan `tests/support/**`, `tests/integration/**/support/**`, `vitest.config.ts` o `package.json`. Si falla un test ajeno, correrlo aislado y, si pasa, nombrarlo en el Context Report. Máximo 2 `npm test` completos simultáneos en la máquina.
- **Antes del PR:** `npm run ops:proof:precheck` (si falla, rebase no interactivo y `git push --force-with-lease`, solo en la rama del issue) y `npm run ops:status:drift:strict`.
- **Rust:** clonar `target/` (`cp -cR <checkout principal>/src-tauri/target <worktree>/src-tauri/`), `cargo test --manifest-path src-tauri/Cargo.toml` con timeout de 15 min o más, y la salida en el Context Report.
- **El mapa del área** se actualiza en el mismo PR (líneas nuevas, qué salió y a dónde).
- **La rama no toca** los ledgers ni `workflow/status.json`.
- **Temporales en `.cache/` del worktree.** `git log -1` antes de `--amend`. Nunca `git add -A` tras un merge de main.
- **No sobre-complicar:** el mínimo que cumple el brief; lo demás se anota.
- **UI:** si el nodo cambia una superficie visible, el builder declara el Presentation Contract (copy, estados, accesibilidad) según `/wf-build` paso 1. El chrome de la app va en inglés; el contenido del usuario, en su idioma.
- **Entrega:** PR abierto **sin esperar CI**, con body, Context Report y Guía de review (en el body y como comentario en el tracker). Issue en In Review, o In Progress si es PARTIAL DELIVERY. El Context Report trae: tiempo de validación del pack y Recon corrections, tiempo total, corridas de la suite, las mutaciones y su salida roja, y el estado final de la fila y por qué.

<Bloques de recursos compartidos de la tanda, si los hay: base local con lock, comandos prohibidos, secretos de producción, aislamiento.>

### Notas por issue (lo esencial; mandan la Auditoría y las Decisiones)
<Por nodo: owner y archivos, qué reutilizar, test y punto de entrada, mutación, trampas, commits esperados, estado de fila esperado y si es parcial.>

## REVIEW (<herramienta>; fallback <herramienta> si no construyó): reglas   ← bloque fijo
- La misma rama y el mismo worktree del build. Sigue /wf-review y skill-code-review.
- **Confirmar:** PR contra main, `[ODE-<n>]` en todos los commits, CI required y el preview en verde en el head revisado (`gh pr checks`, con polling de 60 s o más). Un head de solo docs sin preview se acepta por equivalencia.
- **Checks mecánicos:** con el precheck en verde no se re-verifican a mano el orden de commits, el flip ni las celdas. El foco está en cuatro cosas:
  1. que el rojo sea por la razón declarada;
  2. que las mutaciones de la Guía se re-corran en vivo: una muestra (como mínimo la del modo de fallo) si el builder pegó su salida; todas si falta alguna;
  3. que el estado de la fila esté bien juzgado;
  4. que el Status y la Note de la fila digan lo mismo.
- **Qué revisar:** entrada de producción, dobles solo en fronteras, afirmación tras la completitud, "no construible" intentado, Decisiones ni más ni menos, el diff dentro del Recon Pack y su "Construir con", el mapa y el catálogo actualizados, arreglos solo en el owner nombrado, red intacta y `cargo test` en local si se tocó Rust. Los hallazgos de seguridad bloquean.
- **Re-review ligera** si el diff posterior solo toca docs, tests o fixtures. Si no, completa. El veredicto dice cuál se hizo.
- **CI con reintento:** si aparece `(retry x1)` en un test que no es `it.fails`, se anota en ProcessInsights.
- **No rechazar** porque BUILD omitió In Review o el Context Report: se completa y se registra.
- **FAIL:** comentario de veredicto (TechnicalVerdict, QualityScore, hallazgos con archivo:línea y severidad, herramientas) y vuelta a BUILD. No corregir tú. El asunto del commit de ledger del rechazo lleva `review_rejected`.
**PASS: cerrar primero, escribir después.**
1. `gh pr update-branch <n>`. Un conflicto solo en el mapa o en el catálogo lo resuelves tú (conservas las dos filas, repites el recuento y esperas CI verde). Cualquier otro vuelve al builder.
2. Merge con merge commit (`--merge`, nunca squash). Anotar el SHA.
3. **En un worktree temporal de main**, nunca en el checkout principal (`git pull --ff-only`):
   - `append-review` por ronda (incluida la rechazada) y una fila `append-built` por PR, con su `pr_url`. Las parciales empiezan las notes con "PARTIAL DELIVERY — paso N de M";
   - `last_updated`;
   - `npm run ops:workflow:validate` y `npm run ops:status:drift:strict`;
   - commit `[ODE-<n>]` y push a main. Si el push es rechazado, `pull --rebase` y reintentar.
4. **Tracker:** Done si era el último PR. Si es parcial, la integración lo mueve a Done: devolverlo a In Progress y comentarlo. Si hay un gate posterior al merge, queda In Review hasta que se resuelva.
5. Comentario de veredicto con el SHA del merge y del ledger. Avisar al coordinador.

## Coordinador: reglas   ← bloque fijo
- Esperar solo `worker_done,escalation,question`, en segundo plano y con el timeout máximo. Heartbeats con `--ack`, sin reportarlos.
- Una sola espera activa por Run (`waiter_exists`: no relanzar). Ante `runtime_unavailable`: `request-show` y `--retry-request`.
- **Worker detenido sin `worker_done`:** `worker-stop` (si queda `stop_unknown`, `worker-abandon`), después `worker-start --task <id> --retry-of <dispatch> --worktree path:<mismo> --agent <mismo>`, y `send` con lo ya hecho.
- **BUILD terminado por evidencia:** PR abierto con body, Context Report y Guía en el issue, e issue en In Review o In Progress.
- Después de cada merge, avisar a los builders con PR abierto en la misma ola que mergeen `origin/main`.
- **Tracker:** el CLI desde el checkout principal; los comentarios largos, en `.cache/` con `"$(cat …)"`; la edición de briefs, por GraphQL; nunca el MCP de otro workspace.
- No crear issues durante la orquestación.

## Control de tiempo   ← bloque fijo
- Un build normal cierra en menos de 60 min. Excepciones legítimas: <nodos L>.
- 60 min sin commits nuevos → preguntar qué hace, qué lo frena y cuánto le falta. 90 min sin avance → fallback. 2 h sin causa legítima → parar y reportar.
- Cada intervención en un comentario: "Control de tiempo: <id>, <minutos>, <causa>, <acción>".

## Reporte al humano (3 líneas, solo al cerrar cada PR, ante un gate o ante una pregunta)   ← bloque fijo
- Qué quedó: PR mergeado (SHA), estado del issue, fila del mapa (antes → después) y ledger.
- Métricas: validación del pack, Recon corrections, tiempo del BUILD, corridas de la suite, mutación roja sí/no, fallbacks y controles de tiempo.
- Una sola pregunta si algo lo decide el humano. Si no, sigue el DAG.
Al cerrar la tanda: la lista de seguimientos pendientes (los `it.fails` "follow-up pendiente" más los ya conocidos) para que el humano los cree.

## Paradas obligatorias   ← bloque fijo + las de la tanda
- **Parar y preguntar:** Context Gap (incluidos "— Recon" y "— Recon Pack"), una decisión que choca con el código, un hallazgo de seguridad o pérdida de datos no previsto, un bug cuyo arreglo cambia un contrato, un conflicto que cambia la arquitectura, cualquier intento de un comando prohibido o de usar secretos de producción, y los gates.
- **Parar y reportar:** una precondición sin cumplir, FAIL en 0R, 3 FAIL en un PR o las dos herramientas de un rol caídas, más de 2 h sin causa legítima, y el cierre de la última ola (fin del encargo).
```

---

## Plantillas de spec de worker

El coordinador las rellena por nodo con su fila del DAG y sus notas. Van **completas en el `--spec`**: el worker no ve el prompt del coordinador.

### Spec de BUILD

```text
Target: <id del nodo> — <trabajo>. Issue ODE-<n>. <Parcial: paso N de M | Último PR del issue>.
Change: <qué cambia, en una o dos frases, desde las notas del issue>.
Constraints:
- /wf-build ODE-<n>. Lint del brief con --require-contract --require-recon antes de In Progress.
- Precedencia: Decisiones (y "— ajuste") > Auditoría > Recon Pack > brief.
- Recon en modo validación contra main@<sha>; "Construir con" como punto de partida.
- Rama hugomarin/ode-<n>-<tema>; [ODE-<n>] en cada commit y en el título; ningún otro ODE-###.
- Suite: los afectados mientras trabajas; --changed una vez al final; precheck y drift antes del PR.
- Antes del PR, todas las mutaciones de la Guía en rojo (solo el archivo indicado), con su salida pegada. Una en verde no se entrega.
- Temporales en .cache/. No tocar ledgers ni status.json. No crear issues.
- <Restricciones de recursos compartidos: lock, comandos prohibidos.>
Ownership: <owner y archivos que puede tocar; lo que NO toca>.
Observable acceptance: <el test (archivo) que pasa de rojo a verde o que prueba la costura; las mutaciones de la Guía corridas en rojo, con su salida pegada; el estado esperado de la fila; el PR abierto con body, Context Report y Guía; el issue en In Review o In Progress>.
Orca: copia el handle exacto del preámbulo para el heartbeat y el worker_done; lee mensajes solo con el check del preámbulo y su --terminal (nunca check --run); usa el ask del preámbulo si te bloqueas; no empieces otro trabajo después del worker_done.
```

### Spec de REVIEW

```text
Target: review del PR #<pr> (<id del nodo>, ODE-<n>). Construyó: <herramienta>. Tú no construiste ni corregiste.
Change: verificar y, con PASS, cerrar.
Constraints:
- /wf-review con skill-code-review. Misma rama y worktree del build.
- CI required y preview en verde en el head revisado. Foco: rojo por la razón declarada, muestra de las mutaciones de la Guía en vivo (todas si falta una salida), estado de la fila, Status y Note coherentes.
- Re-review ligera solo si el diff posterior es de docs o tests.
- FAIL: veredicto y vuelta a BUILD; el commit del rechazo lleva review_rejected.
- PASS: cerrar primero (update-branch, merge --merge, ledger en worktree temporal de main, tracker) y después el comentario.
Ownership: este PR y el ledger en main. No tocas el checkout principal.
Observable acceptance: PR mergeado (SHA), ledger en main (SHA), issue en el estado correcto, comentario de veredicto.
Orca: <los mismos recordatorios que en BUILD>.
```
