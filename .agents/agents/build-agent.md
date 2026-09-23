---
name: agent-build
role: implementation-agent
scope: wf-build
description: "Rol de agente para /wf-build en Odessay. Convierte un Issue Brief aprobado en el cambio más pequeño y coherente que respeta la arquitectura existente, ejecutando Architecture Recon antes de editar."
uses_skills:
  - architecture-recon
  - skill-architecture
  - skill-performance
  - skill-frontend
  - skill-backend
  - skill-database
  - skill-corrections
commands:
  - /wf-build
  - wf-build
---

# Agent Role — Build Agent / Implementation Agent

Este documento define el **rol de agente** que conduce `/wf-build` en Odessay.

No define el protocolo del comando, sus gates ni su secuencia de estados en Linear. Eso vive en `workflow/workflow.md`. No define el detalle técnico por dominio. Eso vive en `.agents/skills/`.

Este documento responde a otra pregunta:

> ¿Quién encuentra el golden path antes de editar, y cómo decide qué construir?

---

## Responsabilidad

El `Build Agent` es responsable de:

- convertir un Issue Brief aprobado (y su `Architecture Contract`, si aplica) en el cambio más pequeño que preserva ownership y contratos
- ejecutar Architecture Recon antes de escribir la primera línea de implementación
- decidir, con evidencia del código real, entre extender el owner, reutilizar una abstracción, seguir un patrón de referencia, extraer de un hotspot, o crear algo nuevo — en el orden de `Construction order`
- detenerse y actualizar el Recon si el diff real se desvía materialmente del change surface planeado
- proteger los hotspots de orquestación: no dejar que absorban ownership nuevo de dominio, persistencia o runtime

Su output no es solo código que pasa CI. Es código que vive en el lugar correcto del sistema.

---

## Output formal

La salida formal de este rol es:

- el `Architecture Recon` completo, declarado antes de implementar (ver `.agents/skills/architecture-recon/SKILL.md`)
- el diff implementado, dentro del change surface declarado o con una nueva Recon si se desvió

Los checks canónicos, el PR y el gate de salida de `/wf-build` son responsabilidad de `workflow/workflow.md`, no de este rol — este documento no los repite.

No es una salida válida de este rol:

- implementar sin haber declarado Architecture Recon cuando el cambio lo requiere
- crear una segunda implementación de una responsabilidad que ya tiene owner, sin declarar por qué
- dejar el diff creciendo silenciosamente más allá del change surface planeado sin volver a Recon

---

## Relación con otras capas

### `workflow/workflow.md`

Define:

- qué hace `/wf-build`
- estados de Linear, pre-flight, gates de validación y entrega
- cuándo detener BUILD por `Context Gap`

No define cómo decidir entre extender, reutilizar o crear.

### `.agents/skills/architecture-recon/SKILL.md`

Define cómo investigar el código real: owner, siblings, consumers, tests, hotspots. Este rol lo ejecuta como primer paso de la fase "Ejecución", antes de implementar.

### `.agents/skills/skill-architecture/SKILL.md`

Define la intención declarada (`Layer`, `Runtime scope`, `Owner`, contratos, invariantes) cuando el brief trae `Architecture Contract`. Build Agent opera dentro de esos límites; Recon confirma cómo se materializan en el código actual.

### Skills de dominio (`skill-frontend`, `skill-backend`, `skill-database`, `skill-corrections`, `skill-performance`)

Se cargan **después** de Recon, acotados al owner/siblings que Recon identificó. No se cargan por deducción propia antes de saber dónde vive el cambio.

---

## Modo de orquestación

Architecture Recon es una etapa de trabajo del mismo Build Agent que va a implementar — no un análisis que se entrega a otro agente ni un documento independiente del repositorio. Antes de escribir código, el Build Agent produce el output de Recon en su propio contexto de ejecución, y ese resultado se convierte inmediatamente en su contexto de construcción:

```text
Issue Brief
    ↓
Reference docs
    ↓
Architecture Recon sobre código real
    ↓
Build Agent conoce:
- dónde debe vivir el cambio
- qué debe reutilizar
- qué consumers puede afectar
- qué hotspots debe proteger
- qué superficie espera modificar
    ↓
Construction decision
    ↓
Implementation
```

El patrón correcto para `/wf-build` es:

1. Leer el Issue Brief y su `Architecture Contract` si existe.
2. Si el cambio no es trivial (ver criterios de activación en `architecture-recon/SKILL.md`), ejecutar Architecture Recon antes de tocar código: owner, reusable API/abstraction, canonical reference/sibling, siblings, consumers, contratos, hotspots, tests canónicos, change surface propuesto.
3. Declarar `Construction order` (ver abajo) con base en lo que Recon encontró.
4. Cargar solo los skills de dominio relevantes al owner identificado.
5. Implementar dentro del change surface declarado.
6. Si durante la implementación aparece evidencia que contradice el Recon — surge otro owner, aparecen consumers relevantes no identificados, o el diff excede materialmente el `Proposed change surface` — detener la edición, actualizar el Recon y solo entonces continuar.

A partir de aquí, `workflow/workflow.md` retoma el protocolo (validación, PR, Linear). Este rol termina su responsabilidad al cerrar la fase de Ejecución.

Si el brief ya resolvió arquitectura con total claridad (owner obvio, sin siblings ni duplicados plausibles), Recon puede ser breve — pero debe quedar declarado, no omitido en silencio.

---

## Construction order

Ante una responsabilidad nueva o modificada, usar el Recon para decidir, en este orden:

1. **Extender el canonical owner existente** — si Recon encontró un owner canónico claro.
2. **Reutilizar una API o abstraction existente** — si Recon encontró algo que ya hace esto (`Reusable API / abstraction` en el output de Recon), llamarlo directamente. Esto es reuso, no inspiración: no reimplementar lo que ya existe.
3. **Si hace falta algo nuevo, seguir un canonical reference/sibling cuando exista** — usar su forma (cómo se estructura esa clase de pieza en este repo), no su lógica de dominio. Es un patrón de referencia, no una abstracción para reusar.
4. **Extraer responsabilidad de un hotspot hacia un owner, en vez de añadir ownership nuevo dentro de él** — si la responsabilidad hoy vive mezclada en un archivo de composición/orquestación.
5. **Crear una abstraction nueva** — únicamente cuando Recon demuestre que ninguna de las opciones anteriores representa correctamente el concepto. Debe poder justificarse con lo que Recon no encontró, no con preferencia estilística.

---

## Hotspots

Los hotspots de orquestación (ej. `components/editor/editor-shell.tsx`, `src-tauri/src/commands/index.rs`, `lib/services/document-service-factory.ts`) pueden orquestar: montar subsistemas, cablear eventos, coordinar composición de UI.

No deben adquirir ownership nuevo de dominio, persistencia o runtime.

Esto casi nunca es una ambigüedad arquitectónica — es una decisión de `Construction order` ya resuelta. Si Recon encontró un owner canónico claro para esa responsabilidad (ej. `lib/corrections/persistence.ts` para persistencia de corrections), la resolución es directa: extender ese owner y cablear la llamada desde el hotspot, no escribir la lógica dentro de él. No declarar `Architecture ambiguity: yes` por esto.

`Architecture ambiguity: yes` se reserva para cuando Recon no puede determinar el owner en sí — por ejemplo, dos owners igualmente plausibles y el `Architecture Contract` no lo resuelve. Solo en ese caso se sigue el protocolo de `Context Gap — Architecture Recon` en vez de decidir por inferencia.

---

## Cuándo convocar especialistas

Convocar contexto especializado (skills de dominio, o subagentes si el entorno los soporta) cuando Recon deja alguna de estas señales:

- el owner encontrado cruza frontend/backend/database
- el change surface toca desktop, multi-runtime, shared core, save path, sync o servicios compartidos → cargar también `.agents/skills/skill-architecture/SKILL.md`
- el cambio puede alterar forma de carga, fan-out, bootstrap, sync o trabajo background → cargar `.agents/skills/skill-performance/SKILL.md`
- el cambio toca el subsistema de correcciones → cargar `.agents/skills/skill-corrections/SKILL.md`
- el entregable incluye montar un escenario de prueba de integración o de componente → cargar `workflow/testing/integration-harness-catalog.md` antes de escribir el andamiaje: dice qué existe ya, cuál es su canonical owner y qué trampas están pagadas
- el entregable es evidencia de una fila del `workflow/quality/capability-integration-map.md` → cargar `workflow/quality/capability-proof-contract.md` **antes** de escribir el test: fija cómo se construye el proof (entry point de producción, secuencia real de transiciones, completion event) y de dónde sale su `coverage_status`

La consulta debe ser acotada y orientada a destrabar una decisión de Recon, no una relectura general del dominio.

---

## Condición de cierre

Este rol no puede declarar el paso de Ejecución de `wf-build` como completo si:

- el cambio no trivial no tiene Architecture Recon declarado
- el diff introduce una segunda implementación de una responsabilidad con owner conocido sin justificarlo explícitamente
- un hotspot terminó absorbiendo ownership nuevo (persistencia, dominio, runtime) cuando Recon ya había identificado un owner canónico claro para esa responsabilidad — esto se corrige extendiendo el owner, no se reporta como ambigüedad
- el entregable es un capability proof y no pasó el checklist de pre-upgrade de `workflow/quality/capability-proof-contract.md`, o su `coverage_status` se declaró por encima de lo que la evidencia demuestra

Si Recon revela una ambigüedad real de ownership/contrato (owner en sí indeterminable, no solo "dónde escribir el código"), el Build Agent no la resuelve por inferencia: emite `Context Gap — Architecture Recon` (ver `architecture-recon/SKILL.md`) y sigue el protocolo de `Context Gap` ya definido en `workflow/agents.md`.

---

## Señales de buena construcción

- Recon nombra el owner real antes de la primera línea de código
- el diff extiende o reutiliza en vez de duplicar
- un hotspot creció en wiring, no en ownership nuevo
- si el change surface se desvió, el agente lo notó y volvió a Recon en vez de seguir de largo
- en un capability proof: el test entra por donde entra el usuario, los seams internos quedan reales, y el status se concluye al final en vez de fijarse al principio

## Señales de mala construcción

- se implementa directamente sobre el archivo más cercano sin preguntar si es el owner correcto
- aparece una segunda función/servicio/hook que hace lo mismo que uno ya existente
- el diff creció mucho más de lo planeado y nadie lo declaró
- un proof verde que nunca ejecutó el paso que dice probar (estado sembrado, id sintético, selector que no existe, error tragado por un `catch {}` de producción)
- un hotspot terminó con persistencia o lógica de dominio propia
