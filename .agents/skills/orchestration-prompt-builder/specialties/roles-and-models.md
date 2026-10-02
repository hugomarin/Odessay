# Roles, modelos, lanzamiento y fallback

Las lecciones citadas (T1–T9 y otras) están en `lessons.md`.

## 1. Roles

| Rol | Qué hace | Requisito |
|---|---|---|
| **Recon** (fase 0, si va en el prompt) | Lectura profunda del código según `area-recon.md` | El modelo más fuerte disponible: decide el diseño que otros siguen |
| **Review del Recon** (fase 0R) | Verifica hechos al azar y mergea el PR del mapa | Distinto del que hizo el Recon |
| **BUILD** | `/wf-build` del nodo | Rápido y estable; valida el pack y no rediseña |
| **REVIEW** | `/wf-review` del PR; con PASS, cierra | Distinto del builder y de quien hizo las últimas correcciones (T1) |
| **Brief nuevo** (si un nodo lo necesita) | `/wf-define` del issue + lint | Rol de planner |

## 2. Elegir las herramientas: comprobar, no copiar

Antes de escribir la tabla de roles, **comprobar la configuración actual** de cada herramienta en la máquina:
- modelo y esfuerzo (Codex: `~/.codex/config.toml`; OpenCode: su `opencode.jsonc`);
- permisos para trabajar sin confirmaciones (en OpenCode, por ejemplo, `edit`, `bash` y `external_directory`);
- qué agentes acepta Orca (`orca orchestration worker-start --help`: `claude`, `codex`, `opencode`…);
- incidentes recientes de cada herramienta (`lessons.md` § 5).

**Historia de la tabla (para no repetir errores):**

| Versión | BUILD | REVIEW | Por qué cambió |
|---|---|---|---|
| v2–v4 | OpenCode | Codex, después Claude Code | Codex no enviaba su señal de "listo" en Orca (v3.2) |
| v5 | OpenCode | Claude Code | Codex fuera de los roles |
| v6 | Codex (Luna 6, Max) | Claude Code | Se vuelve a Codex; BUILD se da por terminado por evidencia, no por señal |
| v7 | **OpenCode** | **Codex (GPT-6-Luna, max)** | Codex envió `worker_done` siempre en la tanda 2; roles invertidos para que revise el modelo más fuerte |

**Tabla por defecto (v7)**, sujeta a la comprobación de arriba:

| Rol | 1.ª opción | Fallback |
|---|---|---|
| Recon (fase 0) | Claude Code | OpenCode |
| Review del Recon (0R) | Codex | OpenCode |
| BUILD | OpenCode (modelo de su config) | Claude Code |
| REVIEW | Codex (modelo y esfuerzo de su config) | Claude Code, solo si no construyó |
| Brief nuevo (wf-define) | Claude Code | — |

## 3. Lanzamiento en Orca: detalles que frenan si faltan

- `orca orchestration worker-start --spec "<spec>" --task-title "<id>" --worktree new-top-level --name <nombre> --base-branch origin/main --agent <agente> --json`.
- **OpenCode:** sin `--model`, porque Orca lo rechaza para opencode (T6). Usa su config.
- **Codex:**
  - sin `--model` ni `--effort`, porque Orca rechaza `--effort max` para gpt-6-luna (T3); la config los fija;
  - **después de cada lanzamiento**, confirmar con `orca terminal read` (o `worker-read`) que la terminal muestra el modelo y el esfuerzo esperados. La config cambió a mitad de una tanda (T4);
  - primer arranque: si aparece "Update available", elegir "Skip until next version" (flecha abajo ×2 + Enter). Si queda en `agent_readiness`, `worker-release` y relanzar con `--task … --retry-of …` (T5).
- **Claude Code:** `--agent claude`; el modelo y el esfuerzo se pueden fijar con `--model` y `--effort`.
- **Si `worker-start` sale con código distinto de 0:** no relanzar a ciegas. Leer `failedStage` y `residualResources` del JSON y seguir los comandos de recuperación que trae.
- `--retry-of` necesita `--task` con la Task fallida (`--task` y `--spec` son excluyentes) y **no hereda** la ubicación: repetir `--worktree` y `--agent`.

## 4. Independencia y fallback

- **Independencia obligatoria** (T1): quien revisa nunca construyó ni hizo las correcciones del último ciclo. Si el fallback de BUILD cae en la herramienta revisora, la review pasa a la siguiente opción distinta.
- **Fallo de herramienta** (T9), lo único que justifica cambiar: caída, cuelgue, límite de uso o de contexto, no disponible, el mismo error dos veces seguidas, o 90 minutos sin avance. **Un FAIL de review no es fallo de herramienta**: vuelve a BUILD con la misma herramienta.
- **Traspaso:** misma rama, mismo worktree y mismo PR. La herramienta nueva lee el brief, el pack, las Decisiones, la Guía, el PR, el CI, `git log origin/main..HEAD`, `git status` y los comentarios previos. El trabajo sin commitear se revisa: se commitea si está sano o se descarta explícitamente. Se comenta "Fallback: <de> → <a>", con el motivo y el rol.
- **Fallback de solo cierre** (V2): si el reviewer dejó PASS y cayó antes de cerrar, otra herramienta distinta del builder **solo cierra**, sin volver a revisar, y solo si el head del PR es exactamente el SHA del veredicto y el CI está verde.
- **Límites:** 3 FAIL en el mismo PR, o las dos herramientas de un rol caídas → parar y reportar.

## 5. Recordatorios para cada spec de worker (build y review)

Van **en cada spec**, no solo en el prompt del coordinador. El worker no ve el prompt del coordinador.
- Copiar el handle **exacto** del preámbulo para el heartbeat y el `worker_done` (T7).
- Leer mensajes **solo** con el `check` del preámbulo y su `--terminal`; nunca `check --run …` (T8).
- No crear issues de seguimiento: `it.fails` "follow-up pendiente (ODE-<propio>)" y la lista en el Context Report (C6).
- Leer el Architecture Contract, el comentario `## Decisiones` (y sus "— ajuste") y la Auditoría antes de empezar.
- Usar el `ask` del preámbulo para bloquearse, no otro canal. No empezar otro issue después del `worker_done`.
