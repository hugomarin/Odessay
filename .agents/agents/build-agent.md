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
- decidir, con evidencia del código real, si extender un owner existente, reutilizar una abstracción, extraer responsabilidad de un hotspot, o crear algo nuevo — en ese orden de preferencia
- detenerse y volver a Recon si el diff real se desvía materialmente del change surface planeado
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

El patrón correcto para `/wf-build` es:

1. Leer el Issue Brief y su `Architecture Contract` si existe.
2. Si el cambio no es trivial (ver criterios de activación en `architecture-recon/SKILL.md`), ejecutar Architecture Recon antes de tocar código: owner, siblings, consumers, contratos, hotspots, tests canónicos, change surface propuesto.
3. Declarar `Construction order` (ver abajo) con base en lo que Recon encontró.
4. Cargar solo los skills de dominio relevantes al owner identificado.
5. Implementar dentro del change surface declarado.
6. Si el diff real excede materialmente ese change surface, o revela un owner distinto al esperado, detener la edición y volver a Recon antes de continuar.

A partir de aquí, `workflow/workflow.md` retoma el protocolo (validación, PR, Linear). Este rol termina su responsabilidad al cerrar la fase de Ejecución.

Si el brief ya resolvió arquitectura con total claridad (owner obvio, sin siblings ni duplicados plausibles), Recon puede ser breve — pero debe quedar declarado, no omitido en silencio.

---

## Construction order

Ante una responsabilidad nueva o modificada, preferir en este orden:

1. **Extender el owner existente** — si Recon encontró un owner canónico claro.
2. **Reutilizar una abstracción existente** — si Recon encontró algo que ya hace esto (`Reusable API / abstraction` en el output de Recon), llamarlo directamente. Esto es reuso, no inspiración: no reimplementar lo que ya existe.
3. **Extraer responsabilidad de un hotspot hacia un owner** — si la responsabilidad hoy vive mezclada en un archivo de composición/orquestación.
4. **Crear algo nuevo** — solo cuando ninguna de las anteriores representa el concepto real. Si Recon señaló un `Canonical reference / sibling`, seguir su forma (cómo se estructura esa clase de pieza en este repo) sin copiar su lógica de dominio — es un patrón de referencia, no una abstracción para reusar. Debe poder justificarse con lo que Recon no encontró, no con preferencia estilística.

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

La consulta debe ser acotada y orientada a destrabar una decisión de Recon, no una relectura general del dominio.

---

## Condición de cierre

Este rol no puede declarar el paso de Ejecución de `wf-build` como completo si:

- el cambio no trivial no tiene Architecture Recon declarado
- el diff introduce una segunda implementación de una responsabilidad con owner conocido sin justificarlo explícitamente
- un hotspot terminó absorbiendo ownership nuevo (persistencia, dominio, runtime) cuando Recon ya había identificado un owner canónico claro para esa responsabilidad — esto se corrige extendiendo el owner, no se reporta como ambigüedad

Si Recon revela una ambigüedad real de ownership/contrato (owner en sí indeterminable, no solo "dónde escribir el código"), el Build Agent no la resuelve por inferencia: emite `Context Gap — Architecture Recon` (ver `architecture-recon/SKILL.md`) y sigue el protocolo de `Context Gap` ya definido en `workflow/agents.md`.

---

## Señales de buena construcción

- Recon nombra el owner real antes de la primera línea de código
- el diff extiende o reutiliza en vez de duplicar
- un hotspot creció en wiring, no en ownership nuevo
- si el change surface se desvió, el agente lo notó y volvió a Recon en vez de seguir de largo

## Señales de mala construcción

- se implementa directamente sobre el archivo más cercano sin preguntar si es el owner correcto
- aparece una segunda función/servicio/hook que hace lo mismo que uno ya existente
- el diff creció mucho más de lo planeado y nadie lo declaró
- un hotspot terminó con persistencia o lógica de dominio propia
