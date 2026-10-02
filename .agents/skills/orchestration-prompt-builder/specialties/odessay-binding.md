# Odessay: hechos del proyecto para el prompt de orquestación

Lo que este skill necesita saber de Odessay para escribir un prompt ejecutable. Si un dato cambió, se corrige aquí, no en el prompt.

## Repo, tracker y archivo de prompts

- **Repo:** `hugomarin/Odessay`. `main` no tiene protección de rama: un PR se puede mergear en rojo, así que el reviewer comprueba el CI antes de mergear.
- **Orca:** repo id `0b0529c6-cbaa-461d-bbfb-aca9c2238ab2`. El coordinador carga el skill de orquestación de Orca y recibe el prompt con `/orchestration`.
- **Tracker:** Linear, team **ODE ("Artifact Studio")**, workspace `hugo-marin`. **Nunca CON** ("Context Atelier", otro team).
  - Lectura, comentarios y estados: `node scripts/linear-cli.mjs get|comment|move`, desde el checkout principal (que tiene `.env.local`) o con `LINEAR_API_KEY` exportada.
  - Crear issues y editar briefs o comentarios existentes: GraphQL con `LINEAR_API_KEY`. El CLI no crea issues.
  - El MCP de Linear de los agentes apunta a otro workspace: **no se usa**.
  - **Precondición:** la config de Linear de Orca (`~/.orca/linear-workspaces.json`) apunta al workspace correcto.
  - La integración GitHub → Linear mueve a Done al mergear, también los PRs parciales.
- **Prompts:**
  - se escriben en `.cache/orchestration-v<N>.md` del checkout principal (ignorado por git), con su delta en `.cache/orchestration-v<N>-delta.md`;
  - el número siguiente sale del más alto que haya en `.cache/`;
  - se archivan en Narratif, colección **"Orchestration"**.

## Checks mecánicos (deben existir en `main` antes de invocarlos)

| Check | Uso en el prompt |
|---|---|
| `npm run ops:brief:lint -- <ids> --require-contract --require-recon` | Precondición de la tanda y paso 1 de cada BUILD. **Los dos flags:** `--require-recon` solo no exige el contrato |
| `npm run ops:proof:precheck` | Antes de abrir el PR. Verifica el orden de commits, que `it.fails` entre solo y antes del fix, el flip y las celdas de la fila. También corre en CI (`process-checks`) |
| `npm run ops:status:drift:strict` | Antes del PR y después del ledger. Escanea **cualquier** `ODE-\d+` en los asuntos de commit |
| `npm run ops:workflow:validate` | Después de escribir el ledger |
| `npm run ops:ledger -- append-review '<json>'` / `append-built '<json>'` | Ledger en main, en un worktree temporal |
| `npm test -- --changed origin/main` | Suite local acotada |
| CI `CI required` (`blocking-ci.yml`) | Agrega `quality`, `process-checks` y `repo-checks`. Reintenta una vez solo los tests que fallaron por timeout |

## Ledger y traceability

- La rama de feature **no toca** `workflow/built.jsonl`, `workflow/review-history.jsonl` ni `workflow/status.json`. Se escriben en main, inmediatamente después de cada merge: `drift:strict` lo cobra en el **siguiente** PR.
- **Una fila `append-built` por PR**, con su `pr_url` (desde #558). Las entregas parciales empiezan las notes con "PARTIAL DELIVERY — paso N de M".
- `append-review` por cada ronda, incluidas las rechazadas. El asunto del commit de un rechazo lleva `review_rejected`.
- `[ODE-<n>]` en cada commit y en el título del PR. Ninguno nombra otro `ODE-###`.
  - Excepciones declaradas por nodo: por ejemplo, un PR que cierra dos issues lleva los dos en el título y cada uno en su commit.
- **Ramas:** `hugomarin/ode-<n>-<tema>`, sin otros números. Las partes 2 se escriben en palabras.
- Los PRs de solo docs o proceso van con label `process` (exentos del gate de traceability si solo tocan rutas del allowlist). El PR del mapa de Recon no nombra `ODE-###` en los asuntos.
- `traceability_exceptions.ignored_issue_ids` en `status.json`: quitar un id de ahí cuando su arreglo entra (por ejemplo, ODE-644).

## Documentos que el prompt cita

- `workflow/quality/capability-proof-contract.md`: las 10 reglas de un capability proof.
- `workflow/quality/capability-integration-map.md`: las filas; el estado se deriva, no se decide.
- `workflow/testing/integration-harness-catalog.md`: los harnesses, los mapas de Recon de cada tanda y, en § "Recuento del capability map", el comando de recuento.
- `workflow/quality/editor-shell-decomposition-diagnostic.md`: el mapa del área de la shell.
- `skill-planning/specialties/area-recon.md` y `skill-code-review/SKILL.md` § Review de un Recon.

## Recursos compartidos y producción

- **Supabase local** (tanda 3): una sola instancia (`project_id "odessay"`, API 54321, DB 54322).
  - Todo pasa por el lock: `npm run test:supabase` y `npm run supabase:locked -- <cmd>`.
  - **Prohibido:** `supabase stop`, `db reset`, `migration up`/`repair`, `--linked`, `db push`, `config push`, `link` y `npx supabase`. Solo el nodo que crea el harness reinicia el stack, una vez.
  - No copiar `supabase/.temp` a los worktrees: el checkout principal está linkeado a producción.
- **`.env.local` es un symlink en los worktrees con la service role key de PRODUCCIÓN.** Nada fuera del harness la usa, y ningún script escribe datos con ella.
- **Producción:** los agentes nunca la tocan. Consultas de conteo y migraciones son **gates humanos**. Las migraciones van en `supabase/migrations/<timestamp>_<nombre>.sql`, con el rollback comentado.
- **Docker:** se enciende como gate (`Docker.app`; verificación: `docker info` con exit 0).
- **Rust / Tauri:** `src-tauri/`. Clonar `target/` con `cp -cR` y `cargo test --manifest-path src-tauri/Cargo.toml` (15 min o más). CI lo corre en el job `desktop-rust`.

## Configuración de las herramientas (comprobar antes de cada tanda)

- **Codex:** `~/.codex/config.toml` (`model`, `model_reasoning_effort`). Orca lo lanza sin `--model`/`--effort`.
- **OpenCode:** `~/.config/opencode/opencode.jsonc`. Permisos `edit`, `bash`, `webfetch` en `allow`. Revisar `external_directory` y `doom_loop`: preguntan por defecto y pueden frenar a un worker.
- **Claude Code:** permisos en `~/.claude/settings.json` para `git push origin main`, `gh pr merge`, `cargo test` y `node scripts/linear-cli.mjs`. Sin ellos, el reviewer se detiene a pedir permiso.
- **Orca:** `orca orchestration worker-start --help` lista los agentes habilitados.
