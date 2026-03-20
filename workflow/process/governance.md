# ODESSAY — Gobernanza del trabajo

## Alcance

Contrato de proceso operativo del trabajo: responsabilidades, estados, Git y handoffs.

## Cuándo se usa

- Durante ejecución de issues (`In Progress` / `In Review`).
- Cuando hay dudas de ownership humano/agente.
- Antes de mover estados en Linear o cerrar entrega.

## No incluye

- Setup técnico de entorno y variables (ver `workflow/setup/environment.md`).
- Estándares de testing/observabilidad (ver `workflow/quality/testing-observability.md`).
- Pasos específicos de un issue puntual (ver `workflow/runbooks/phase-1-operations.md`).

## Frontera humano / agente

### Siempre hace el humano

- Crear repositorios en GitHub y branch protection cuando el plan lo permita.
- Confirmar fallback operativo si no hay branch protection por limitación de plan.
- Crear proyectos en Supabase y compartir credenciales necesarias.
- Conectar repositorio en Vercel y cargar variables de entorno.
- Aprobar/mergear pull requests.
- Autorizar tools y accesos.
- Asignar issues en Linear.

### Siempre hace el agente

- Implementar código y configuración.
- Crear migraciones y ejecutarlas en staging.
- Ejecutar `typecheck`, `lint`, `test` y dejar evidencia en PR.
- Mover estados del issue (`Todo` → `In Progress` → `In Review` → `Done`).
- Actualizar `workflow/status.json` al pasar a `In Review`.
- Actualizar este documento cuando cambie el proceso operativo.

## Máquina de estados (Linear)

`Todo` → `In Progress` → `In Review` → `Done`

Rechazo de review: `In Review` → `In Progress`

### Handoff humano obligatorio

Si un issue requiere acción humana:

```text
⏸ HANDOFF REQUERIDO

Completé: [qué hizo el agente]
Necesito que tú: [acción concreta del humano]
Una vez listo: [siguiente paso del agente]
```

El agente no mueve a `In Review` sin confirmación explícita del handoff.

## Estrategia de Git

### Ramas

`main` es estable. Nunca push directo.

Formato:

```text
feat/{issue-id}-{descripcion-corta}
fix/{issue-id}-{descripcion-corta}
docs/{issue-id}-{descripcion-corta}
chore/{issue-id}-{descripcion-corta}
```

Creación:

```bash
git checkout main && git pull origin main
git checkout -b feat/ODE-XX-descripcion
```

### Commits

Formato: `tipo(scope): descripción [ODE-XX]`

Ejemplos:

```text
feat(db): add writings table with RLS policies [ISSUE-ID]
fix(editor): correct debounce timing on local save [ISSUE-ID]
```

Committs atómicos por unidad lógica; push por subtarea significativa.

### Coordinación paralela

Antes de empezar:

```bash
git fetch origin
git branch -r
gh pr list --state open
```

Si hay solapamiento de archivos con PR abierto, esperar merge o acordar secuencia en Linear.

## WORKFLOW.md por issue (opcional)

Solo crear `WORKFLOW.md` cuando un issue requiere reglas adicionales específicas de esa rama.

No es obligatorio. Se elimina al mergear.

## Flujo completo de entrega

1. Crear rama desde `main` actualizado.
2. Mover issue a `In Progress`.
3. Crear `WORKFLOW.md` si aplica.
4. Desarrollar con commits atómicos.
5. Push por subtareas.
6. Ejecutar validaciones y pegar output en PR.
7. Abrir PR.
8. Comentar en Linear: link PR + SHA + validaciones.
9. Actualizar `workflow/status.json` (`built[]`).
10. Correr `npm run ops:delivery:gate`.
11. Mover a `In Review`.
12. Tras aprobación/merge, mover a `Done`.

Regla de foco: una issue activa a la vez por agente implementador.
