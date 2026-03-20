# ODESSAY — Gobernanza del trabajo

## Alcance

Contrato operativo del flujo de trabajo: etapas (`/wf-*`), estados en Linear, outputs, handoffs y reglas de Git por etapa.

## Cuándo se usa

- Al iniciar cualquier etapa (`/wf-define`, `/wf-build`, `/wf-review`).
- Antes de mover un issue entre estados en Linear.
- Ante dudas de ownership humano/agente o reglas de rama.

## No incluye

- Setup técnico y variables → `workflow/setup/environment.md`.
- Criterios de testing y observabilidad → `workflow/quality/testing-observability.md`.
- Pasos de ejecución de un issue específico → `workflow/runbooks/phase-1-operations.md`.
- Políticas de contexto por etapa → `workflow/docs.json → stage_policies`.

---

## Frontera humano / agente

### Siempre hace el humano

- Asignar issues en Linear.
- Aprobar y mergear PRs a `main`.
- Resolver handoffs externos (credenciales, dashboards, permisos no automatizables).

### Siempre hace el agente

- Ejecutar el flujo por etapa (`/wf-*`) respetando gates.
- Implementar, validar y documentar evidencia.
- Mover estados operativos en Linear según esta guía.
- Actualizar `workflow/status.json` al pasar a `In Review`.
- Dejar comentario en Linear al cerrar cada etapa.

---

## Operación por etapa

### `/wf-define` (PLAN)

**Objetivo:** definir alcance ejecutable y producir el `Issue Brief`.

| | |
|---|---|
| Estado Linear de entrada | `Todo` o `Backlog` |
| Estado Linear de salida | `Todo` (listo para BUILD) |
| Gate de entrada | Ninguno |
| Gate de salida | `Issue Brief` escrito y disponible |

**Output obligatorio:**
- `Issue Brief` en Linear (cuerpo del issue o comentario) **o** `workflow/issues/<issue-id>.md`.
- Comentario en Linear confirmando brief completo y alcance acordado.

**Restricción:** no iniciar código ni abrir rama en esta etapa.

---

### `/wf-build` (BUILD)

**Objetivo:** implementar sobre un brief ya aprobado.

| | |
|---|---|
| Estado Linear de entrada | `Todo` (con brief existente) |
| Estado Linear de salida | `In Review` |
| Gate de entrada | `Issue Brief` debe existir |
| Gate de salida | `npm run ops:delivery:gate` en verde + PR abierto |

**Operación de estado:** al tomar el issue para ejecución, mover a `In Progress`. Al dejar PR listo, mover a `In Review`.

**Output obligatorio:**
- Cambios de código en rama del issue.
- PR abierto con evidencia (typecheck, lint, tests).
- `workflow/status.json` actualizado.
- `npm run ops:delivery:gate` en verde.
- Comentario de trazabilidad en Linear (qué se construyó, evidencia).

---

### `/wf-review` (REVIEW)

**Objetivo:** verificar calidad del PR y cerrar trazabilidad del issue.

| | |
|---|---|
| Estado Linear de entrada | `In Review` |
| Estado Linear de salida (aprobado) | `Done` — solo después de merge confirmado por el humano |
| Estado Linear de salida (rechazado) | `In Progress` — volver a BUILD |
| Gate de entrada | PR abierto + validaciones + `workflow/status.json` actualizado |

**Output obligatorio — si aprobado:**
- Comentario en Linear: resultado de revisión + confirmación de que el humano puede mergear.
- Mover issue a `Done` solo tras merge confirmado.

**Output obligatorio — si rechazado:**
- Comentario en Linear: hallazgos específicos que bloquean aprobación.
- Mover issue a `In Progress`.
- No cerrar el PR — mantener rama y PR del issue.

**Restricción:** no agregar alcance nuevo en REVIEW. Solo correcciones derivadas del review.

---

## Handoff humano (protocolo)

Usar cuando el agente no puede continuar sin una acción externa.

```text
⏸ HANDOFF REQUERIDO

Etapa actual: [PLAN|BUILD|REVIEW]
Bloquea: [qué no puede avanzar]
Completé: [trabajo ya realizado]
Necesito que tú: [acción concreta]
Evidencia esperada: [qué debe compartir el humano]
Reanudación: [acción exacta que hará el agente al recibir evidencia]
```

**Regla de estado durante handoff:**
- Si el handoff ocurre en BUILD → issue permanece en `In Progress`.
- No mover a `In Review` mientras exista handoff pendiente.
- Si REVIEW rechaza → volver a `In Progress` con comentario de hallazgos.

---

## Estrategia de Git por etapa

### PLAN (`/wf-define`)

- No abrir rama de implementación.
- Solo producir brief y decisiones de alcance.

### BUILD (`/wf-build`)

Crear rama por issue desde `main` actualizado.

**Convención de nombre:**

```
feat/{issue-id}-{descripcion-corta}
fix/{issue-id}-{descripcion-corta}
docs/{issue-id}-{descripcion-corta}
chore/{issue-id}-{descripcion-corta}
```

**Commits:** atómicos con formato `tipo(scope): descripción [ISSUE-ID]`. Push por subtarea significativa.

### REVIEW (`/wf-review`)

- Mantener misma rama y PR del issue.
- Solo commits de corrección derivados del review.
- El merge a `main` lo ejecuta el humano — nunca el agente.

---

## `WORKFLOW.md` por issue (uso excepcional)

Reservado para excepciones temporales que no caben en la gobernanza global de este issue específico.

**Cuándo sí usarlo:**
- Restricción técnica temporal de ese issue.
- Orden de validación no estándar para ese issue.
- Dependencia externa puntual que cambia el orden normal.

**Cuándo no usarlo:**
- Reglas generales del repositorio (van aquí o en otro doc de `workflow/`).
- Recordatorios que ya viven en `workflow/`.

**Contenido mínimo:**
1. Contexto extra del issue.
2. Restricción temporal.
3. Validación adicional obligatoria.
4. Condición para retirar el archivo.

Al mergear, `WORKFLOW.md` se elimina.

---

## Regla de foco

Una issue activa por agente implementador.
