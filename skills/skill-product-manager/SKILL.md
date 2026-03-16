---
name: skill-product-manager
description: Workflow de Product Manager para Odessay en Linear: definición de issues ejecutables, dependencias, prioridades, validaciones y criterios de done. Usar cuando crees, priorices, refinés o ejecutes tickets y milestones del roadmap.
---

# Skill: Product Manager (Linear)

Este skill tiene dos funciones. Primera, definir cómo se escribe y ejecuta cada issue para que sea completamente ejecutable por un agente de código o legible por un humano sin ambigüedad. Segunda, establecer el proceso de orquestación: cómo se secuencian los issues, cómo se hace seguimiento, y cómo se valida la entrega.

El alcance específico del proyecto — fases, milestones, issues macro — vive en `odessay-roadmap.md`. Lee ese documento antes de crear issues.

Usa Linear MCP para crear y gestionar todo directamente.

---

## Labels

Los labels se crean una sola vez en Linear antes de crear cualquier issue. Son dos grupos.

**Capa técnica** — identifica qué parte del sistema toca el issue:
- `frontend` — UI, componentes, styling, editor, tipografía.
- `backend` — API routes, lógica server-side, integraciones con servicios.
- `database` — migraciones, queries, RLS, triggers.
- `infra` — Vercel, Supabase setup, variables de entorno, GitHub, CI.
- `ai-editor` — todo lo relacionado con el agente Claude: prompts, API routes de AI, observaciones.

**Estado del proyecto** — identifica condiciones especiales:
- `critical-path` — este issue bloquea otros. Nada puede avanzar hasta que esté Done.
- `blocked` — no se puede ejecutar porque depende de algo que no está resuelto.
- `needs-clarification` — el issue tiene ambigüedad que debe resolverse antes de ejecutar.

Un issue puede tener múltiples labels de capa técnica si toca varias capas. Solo uno de estado del proyecto a la vez.

---

## Estados de un issue

Linear usa estos estados en orden lineal:

**Backlog** — el issue existe y está definido pero no es momento de ejecutarlo. Sus dependencias pueden no estar resueltas.

**Ready** — todas las dependencias están en Done. El agente puede tomar este issue y ejecutarlo sin bloquearse.

**In Progress** — hay un agente o humano trabajando en él. Tiene branch activo.

**In Review** — el trabajo terminó, el PR está abierto, esperando revisión.

**Done** — PR mergeado, criterios de entrega verificados, commit referenciado.

Un issue nunca pasa a Ready si tiene dependencias abiertas. El agente verifica el estado de las dependencias antes de empezar.

---

## Estructura de un issue

Todo issue en Linear sigue esta estructura. Las secciones marcadas como `[LLM]` contienen instrucciones técnicas dirigidas al agente de código. Las demás son legibles por humanos y agentes por igual.

---

### Título

Verbo en imperativo + qué + scope si ayuda a distinguir. En inglés.

Bien: `Create writings table with RLS policies`
Bien: `Implement auto-save with debounce on TipTap editor`
Mal: `Database stuff`
Mal: `Fix the editor`

---

### Descripción

```
## Context
Por qué existe este issue. Qué problema resuelve o qué habilita en el producto.
Referencia al documento fundacional o técnico que lo justifica si aplica.

## Dependencies
Issues que deben estar en Done antes de que este pueda pasar a Ready.
Si no tiene dependencias, escribir: None.

Formato: [ID-DEL-ISSUE] Título del issue del que depende.

## Requirements
Lo que debe existir cuando el issue esté terminado. Numerado. Cada item es verificable
de forma independiente. No son instrucciones de implementación — son resultados esperados.

1. El usuario puede hacer X.
2. La tabla Y existe con los campos Z.
3. El endpoint W responde correctamente cuando...

## Reference docs
Documentos del proyecto que el agente debe leer antes de implementar.

- odessay-modelo-datos.md (sección: writings)
- skill-database.md
- skill-backend.md

## Delivery

### Commits
El agente hace commits atómicos durante el desarrollo con mensajes en formato convencional.
Cada mensaje incluye el ID del issue al final: `feat: implement auto-save debounce [ODY-42]`
Se hace push al branch remoto al terminar cada subtarea significativa dentro del issue.

### Validation
[LLM] Antes de mover el issue a In Review, ejecuta las validaciones que apliquen según el tipo de issue:

Si el issue toca funcionalidad de interacción en el browser:
- Usa Playwright MCP para recorrer el flujo completo que el issue habilita.
- Verifica que no hay errores en consola del browser durante el flujo.
- Verifica estados de carga, errores y casos edge definidos en Requirements.

Si el issue toca base de datos:
- Usa Supabase MCP para verificar que el schema resultante coincide con lo especificado.
- Verifica que las RLS policies permiten y bloquean acceso según las reglas definidas.
- Verifica que los datos en staging reflejan el comportamiento esperado.

Si el issue es de infra, configuración o documentación, no se requiere Playwright ni Supabase MCP.
Verifica que el resultado es funcional según lo que corresponda al tipo de issue.

### Definition of Done
Condiciones que deben ser verdaderas para cerrar el issue. Escritas en prosa. Sin checklists.
Deben ser verificables sin ambigüedad.

Ejemplo: El usuario puede crear un writing desde /write, escribir texto, y verificar que
persiste al recargar la página. El auto-save no genera errores en consola. El campo body_json
en Supabase refleja el contenido del editor.

## Notes
Contexto adicional, decisiones de diseño tomadas, edge cases conocidos, restricciones.
```

---

### Prioridad

**Urgent** — bloquea todo lo demás. Debe resolverse antes de cualquier otra cosa.
**High** — necesario para completar el milestone de la fase actual.
**Medium** — importante pero no bloquea el avance de la fase.
**Low** — deseable, se ejecuta cuando no hay nada de mayor prioridad.

---

### Subissues

Se crean subissues cuando un issue tiene partes que pueden ejecutarse en paralelo o que tienen criterios de entrega independientes. No se usan para dividir tareas secuenciales dentro del mismo flujo — eso va en Requirements. Un subissue sigue la misma estructura que un issue padre.

---

## Cómo secuenciar issues

Dentro de cada fase, el orden de ejecución es siempre: database → backend → frontend → validation. Los issues de infra y configuración son siempre los primeros de cualquier proyecto y son `critical-path` para todo lo demás.

Las dependencias se declaran explícitamente en la sección Dependencies de cada issue. Un issue sin dependencias declaradas se asume independiente. Nunca asumir dependencias implícitas — si algo debe existir para que este issue funcione, se declara.

Un issue nunca pasa a Ready mientras tenga dependencias en estado distinto a Done.

---

## Cómo usar este skill

### Al iniciar el proyecto

1. Lee `odessay-roadmap.md` para entender fases, milestones y el mapa de issues del proyecto.
2. Crea los labels en Linear exactamente como están definidos en este documento.
3. Crea los estados en Linear: Backlog, Ready, In Progress, In Review, Done.
4. Crea un proyecto en Linear para cada fase definida en el roadmap.
5. Crea los issues de la primera fase con estado Backlog.
6. Mueve a Ready solo los que no tienen dependencias abiertas.
7. No crees issues de fases siguientes hasta que la fase anterior esté completa.

### Al crear un issue

Sigue la estructura de descripción definida en este documento. Todo issue debe tener Context, Dependencies, Requirements, Reference docs, Delivery y Notes si aplica. Un issue sin Definition of Done no es un issue.

### Al ejecutar un issue

[LLM] Antes de empezar: verifica que todas las dependencias están en Done. Lee los Reference docs indicados en el issue. Crea el branch desde main con el formato `feat/{issue-id}-{descripcion-corta}` o `fix/{issue-id}-{descripcion-corta}`. Mueve el issue a In Progress.

Durante la ejecución: commits atómicos con ID del issue en el mensaje. Push al branch remoto al terminar cada subtarea significativa.

Al terminar: ejecuta las validaciones definidas en la sección Validation. Solo cuando todas las validaciones pasan, mueve el issue a In Review y abre el PR.

### Al completar una fase

Antes de empezar la siguiente: verifica deploy en staging funcionando. Recorre los flujos completos de la fase con Playwright MCP. Verifica que nada de fases anteriores se rompió. Si hay algo roto, crea un issue de fix antes de avanzar.

---

## Anti-patrones

Un issue vago no es un issue. "Hacer que el editor funcione" no dice nada — sin Definition of Done no hay forma de saber cuándo terminar.

Un issue enorme bloquea el progreso. Si un issue toca más de una capa y tarda más de un día, probablemente necesita dividirse en subissues con criterios de entrega independientes.

Un issue con dependencia implícita es una trampa. Si asumes que algo existe sin declararlo en Dependencies, el agente se bloqueará en medio de la ejecución.

Un issue que opera contra producción es un error crítico. Todo desarrollo y testing ocurre en staging. Producción solo recibe merges de main con preview verificado.
