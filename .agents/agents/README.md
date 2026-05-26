---
name: agents-convention
type: convention
scope: .agents/agents
description: "Convención mínima para roles de agente en Odessay: ubicación, responsabilidad, frontmatter requerido y relación con workflow y skills."
---

# Agents Convention

Este directorio contiene **roles de agente**.

Un rol de agente responde:

> ¿Quién conduce una clase de trabajo y cómo orquesta contexto, skills y especialistas?

No reemplaza:

- `workflow/` — protocolo, gates, secuencia operativa
- `.agents/skills/` — conocimiento especializado por dominio

---

## Responsabilidad de esta carpeta

`.agents/agents/` existe para modelar roles de orquestación como:

- planning
- build
- review
- operations

Cada archivo debe describir:

- qué trabajo conduce ese agente
- qué capa del sistema orquesta
- qué skills usa como marco principal
- cuándo convoca especialistas
- qué clase de output consolida

---

## Convención de archivo

- Un archivo por rol.
- Formato: Markdown.
- Nombre recomendado: kebab-case, orientado al rol.
  - ejemplo: `product-manager.md`
  - ejemplo futuro: `build-agent.md`

---

## Frontmatter requerido

Todo rol de agente debe abrir con frontmatter YAML:

```yaml
---
name: agent-product-manager
role: planning-agent
scope: wf-define
description: "Rol de agente para la planeación de fases en Odessay."
---
```

Campos requeridos:

- `name` — identificador estable del rol
- `role` — tipo de agente
- `scope` — comando, etapa o dominio principal que conduce
- `description` — resumen corto de responsabilidad

Campos opcionales recomendados:

- `uses_skills` — lista de skills principales que usa
- `commands` — lista de comandos o workflows donde aplica

Ejemplo:

```yaml
---
name: agent-product-manager
role: planning-agent
scope: wf-define
description: "Orquesta roadmap, DoD y briefs."
uses_skills:
  - skill-product-manager
  - skill-architecture
commands:
  - /wf-define
---
```

---

## Regla de arquitectura

Un rol de agente no debe duplicar:

- el protocolo detallado de `workflow/workflow.md`
- el contenido de implementación de un `SKILL.md`

Debe referenciarlos y explicar cómo los orquesta.

En corto:

- `workflow` dice **qué** pasa
- `agent role` dice **quién** lo conduce
- `skill` dice **cómo** pensar o ejecutar una parte especializada

---

## Señales de buen diseño

- el rol tiene una responsabilidad clara
- su output está bien definido
- usa skills como apoyo, no como sustituto
- consolida una sola voz final cuando la tarea requiere síntesis

## Señales de mal diseño

- mezcla protocolo, rol y skill en el mismo documento
- duplica instrucciones que ya viven en `workflow`
- describe varios agentes a la vez en un solo archivo
- no deja claro si el agente decide, implementa o solo consulta
