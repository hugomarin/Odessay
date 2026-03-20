# ODESSAY — Contrato de ejecución

Este documento define **cómo operar** en este repositorio sin rehidratar contexto innecesario.

## Alcance de este archivo

`workflow/SETUP.md` es el punto de entrada operativo. No contiene detalle largo de cada tema.

- Qué etapa está activa y qué se permite leer.
- Qué documentos operativos consultar según necesidad.
- Qué gate mínimo debe pasar antes de desarrollar.

## Secuencia mínima (obligatoria)

1. Resolver etapa activa (`/wf-define`, `/wf-build`, `/wf-review`) según `workflow/docs.json`.
2. Correr pre-flight desde `workflow/setup/environment.md`.
3. Si hay trabajo de implementación, aplicar reglas de `workflow/process/governance.md`.
4. Antes de cierre, aplicar `workflow/quality/testing-observability.md`.
5. Si el issue coincide con runbook operativo (ODE-12/14/15/16), seguir `workflow/runbooks/phase-1-operations.md`.

## Mapa operativo atómico

- `workflow/setup/environment.md`: entorno, pre-flight, variables, tools/permisos, comandos base para levantar el proyecto.
- `workflow/process/governance.md`: frontera humano/agente, máquina de estados en Linear, estrategia Git, flujo de entrega.
- `workflow/quality/testing-observability.md`: política de testing hermético y observabilidad.
- `workflow/runbooks/phase-1-operations.md`: procedimientos específicos de fase/issue (no reglas globales).

## Regla de mantenimiento

Cuando cambie un área, se actualiza solo su documento atómico:

- Setup técnico: `workflow/setup/environment.md`
- Proceso de ejecución: `workflow/process/governance.md`
- Calidad/observabilidad: `workflow/quality/testing-observability.md`
- Runbooks por issue/fase: `workflow/runbooks/phase-1-operations.md`

Solo modificar `workflow/SETUP.md` cuando cambie el contrato de navegación entre estas piezas.

## Smoke check rápido

```bash
node --version
npm run env:check
npm run ops:status:drift
```

Si falla cualquier check, no iniciar implementación hasta resolver el bloqueo.
