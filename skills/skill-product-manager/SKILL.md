---
name: skill-product-manager
description: Workflow de Product Manager para Odessay en Linear: definición de issues ejecutables, dependencias, prioridades, validaciones y criterios de done. Usar cuando crees, priorices, refinés o ejecutes tickets y milestones del roadmap.
---

# Skill: Product Manager (Linear)

Este skill tiene dos funciones. Primera, definir cómo se escribe y ejecuta cada issue para que sea completamente ejecutable por un agente de código o legible por un humano sin ambigüedad. Segunda, establecer el proceso de orquestación: cómo se secuencian los issues, cómo se hace seguimiento, y cómo se valida la entrega.

El alcance específico del proyecto — fases e issues macro — vive en `docs/ops/odessay-roadmap.md`. Lee ese documento antes de crear issues.

Usa Linear MCP para crear y gestionar todo directamente.

---

## Estructura en Linear — leer antes de crear nada

```
Team: Odessay
  └── Project: Fase 0 — Cimientos    ← status: In Progress
  └── Project: Fase 1 — Escribir     ← status: Planned
  └── Project: Fase 2 — ...          ← status: Planned
  ...hasta Fase 7
```

**Reglas no negociables:**
- Un proyecto por fase. No un proyecto "Odessay" con milestones internos.
- El team Odessay ya es el contenedor del producto — un proyecto adicional con el mismo nombre es redundante.
- Los milestones dentro de un proyecto solo se usan si una fase tiene sub-entregas con criterios de done independientes. En la mayoría de las fases no son necesarios.
- Todos los proyectos se crean desde el inicio con status `Planned`. Solo la fase activa pasa a `In Progress`.

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
- `critical-path` — este issue bloquea otros. Nada puede avanzar hasta que esté Done. Ejemplos que siempre son `critical-path`: repo/infra base, schema inicial de base de datos, autenticación (sin auth no pueden existir rutas protegidas ni flujos de autor), sistema de diseño base.
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

## Files affected
Archivos que este issue va a crear o modificar. El agente verifica antes de empezar
que ningún PR abierto toca los mismos archivos — si hay solapamiento, espera.

Formato — siempre texto plano, nunca Markdown links:
- src/path/to/file.tsx (nuevo | modifica)
- src/otro/archivo.ts (nuevo | modifica)

**Reglas:**
1. Texto plano siempre. Nunca `[archivo.md](<http://archivo.md>)` ni ninguna sintaxis de link — los nombres de archivo no son URLs.
2. Paths sin prefijo `./` — usar `app/page.tsx`, no `./app/page.tsx`. El path es relativo a la raíz del repo, el `./` es ruido.
3. Los docs de spec (`docs/core/`, `docs/features/`) nunca van aquí — son fuente de verdad que la implementación lee, no modifica. Si los pones en Files affected, estás invirtiendo la dirección de la dependencia.
4. Los skills (`skills/*/SKILL.md`) nunca van aquí — son referencia, no output. Van en Reference docs.
5. Excepción válida: `docs/ops/STATUS.md` y `docs/ops/SETUP.md` pueden aparecer como `(modifica)` cuando el issue explícitamente actualiza el estado del proyecto o el setup.

Si el issue solo toca código sin conflictos de archivos compartidos, escribir: N/A.

## Requirements
Lo que debe existir cuando el issue esté terminado. Numerado. Cada item es verificable
de forma independiente. No son instrucciones de implementación — son resultados esperados.

1. El usuario puede hacer X.
2. La tabla Y existe con los campos Z.
3. El endpoint W responde correctamente cuando...

## Reference docs
Documentos del proyecto que el agente debe leer antes de implementar.
Usar siempre paths completos desde la raíz del repo.

- docs/core/odessay-modelo-datos.md (sección: writings)
- skills/skill-database/SKILL.md
- skills/skill-backend/SKILL.md

**Qué incluir según el tipo de issue:**
- Cualquier issue con UI → `skills/skill-design/SKILL.md` + `skills/skill-design/vistas.md`
- Cualquier issue con páginas nuevas (`/login`, `/signup`, `/desk`, etc.) → `docs/core/odessay-paginas.md`
- Cualquier issue con flujos de usuario → `docs/core/odessay-flujos.md` (sección relevante)
- Cualquier issue de frontend → `skills/skill-frontend/SKILL.md`
- Cualquier issue de backend/API → `skills/skill-backend/SKILL.md`
- Cualquier issue de base de datos → `skills/skill-database/SKILL.md` + `docs/core/odessay-modelo-datos.md`
- Issues que tocan un feature con doc propio → el doc de `docs/features/` correspondiente

## Delivery

### Commits
El agente hace commits atómicos durante el desarrollo con mensajes en formato convencional.
Cada mensaje incluye el ID del issue al final: `feat: implement auto-save debounce [ODY-42]`
Se hace push al branch remoto al terminar cada subtarea significativa dentro del issue.

### Validation
[LLM] Antes de mover el issue a In Review, ejecuta las validaciones que apliquen y documenta el resultado. No es suficiente que el código compile — el agente debe proporcionar proof of work: el output real de lo que corrió.

**Checks obligatorios en todo issue:**
```bash
npm run typecheck   # debe pasar sin errores
npm run lint        # debe pasar sin errores
npm test            # debe pasar sin dependencias externas (ver §Hermetic testing en SETUP.md)
```
Pegar el output de estos tres comandos en la descripción del PR. Sin este output, el PR no está completo.

**Si el issue toca funcionalidad de interacción en el browser:**
- Usa Playwright MCP para recorrer el flujo completo que el issue habilita.
- Verifica que no hay errores en consola del browser durante el flujo.
- Verifica estados de carga, errores y casos edge definidos en Requirements.
- Pegar screenshot o log del resultado en el PR.

**Si el issue toca base de datos:**
- Usa Supabase MCP para verificar que el schema resultante coincide con lo especificado.
- Verifica que las RLS policies permiten y bloquean acceso según las reglas definidas.
- Pegar el output de la verificación en el PR.

**Si el issue es de infra, configuración o documentación:**
No se requiere Playwright ni Supabase MCP. Verificar que el resultado es funcional y documentar cómo se verificó.

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

## Jerarquía de Linear — qué va en cada nivel

Hay tres niveles: proyecto → milestone → issue. Cada nivel tiene un contrato de contenido distinto. Mezclarlos es el error más frecuente.

### Team (uno por producto)

El team agrupa todo el trabajo del producto. No tiene descripción de implementación — es solo el contenedor organizacional. En Linear: `Team: Odessay`.

### Proyecto (uno por fase)

Cada fase del roadmap es un proyecto independiente en Linear. Un proyecto = una unidad de trabajo con inicio, fin y entregable claro.

La descripción del proyecto define el **exit criteria de esa fase** — qué existe y funciona cuando todos sus issues están Done. Una o dos frases máximo.

Bien: "Editor TipTap operativo con auto-save local-first y Desk personal funcional y visualmente terminado."
Mal: "Odessay es una plataforma de escritura epistolar con tres modos principales..."

El status del proyecto refleja el estado real de la fase: `Planned` → `In Progress` → `Completed`. Cuando una fase termina, el proyecto se cierra. No se reutiliza.

**Por qué un proyecto por fase y no un proyecto por producto:**
Si el team y el proyecto tienen el mismo nombre (`Team: Odessay`, `Project: Odessay`), el nivel de proyecto no agrega ningún significado — es ruido. Con un proyecto por fase, la jerarquía es plana y semánticamente clara: `Team: Odessay → Project: Fase 0 — Cimientos → Issues`.

### Milestone (dentro de un proyecto, opcional)

Los milestones marcan un **gate interno** dentro de una fase: un punto donde un bloque de trabajo debe estar 100% verificado antes de que el siguiente bloque pueda empezar.

Cuándo usarlos: cuando una fase tiene dos bloques grandes con una dependencia real entre ellos — no una dependencia de issue a issue, sino una dependencia de bloque a bloque. Ejemplo en Fase 6:

```
Milestone: "API lista"       → /api/ai/observe + /api/ai/discuss
Milestone: "Frontend listo"  → panel UI + render de observaciones + context instructions
```

El frontend no debería empezar hasta que la API esté validada. El milestone hace ese gate explícito y visible.

Cuándo NO usarlos: cuando las dependencias entre issues ya dan el orden correcto. En Fase 0, Fase 1 y la mayoría de las fases, los issues están encadenados por Dependencies — no hace falta un milestone adicional. Añadirlos ahí es ruido.

### Issue (uno por entregable)

La descripción del issue sigue la estructura definida en §Estructura de un issue. El Context del issue explica por qué existe *ese* issue específico — no describe el producto ni la fase.

---

## Cómo usar este skill

### Al iniciar el proyecto

1. Lee `docs/ops/odessay-roadmap.md` para entender fases y el mapa de issues.
2. Crea los labels en Linear exactamente como están definidos en este documento.
3. Crea los estados en Linear: Backlog, Ready, In Progress, In Review, Done.
4. Crea **un proyecto por fase** en Linear, con el nombre exacto de la fase (`Fase 0 — Cimientos`, `Fase 1 — Escribir`, etc.) y descripción de exit criteria específica a esa fase.
5. Crea todos los proyectos desde el inicio con status `Planned`. Solo la fase activa pasa a `In Progress`.
6. Crea los issues de la fase activa dentro de su proyecto, con estado Backlog.
7. Mueve a Ready solo los que no tienen dependencias abiertas.
8. No crees issues de fases siguientes hasta que la fase anterior esté completa.

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

Un archivo en Files affected escrito como link Markdown rompe la legibilidad. `[CLAUDE.md](<http://CLAUDE.md>)` no es un path — es un artefacto de parseo. Los nombres de archivo van siempre como texto plano.

Un spec doc en Files affected invierte la causalidad. Si `docs/features/odessay-sync.md` aparece como `(modifica)`, significa que el issue está reescribiendo el spec en lugar de implementarlo. El spec existe antes que el issue. La implementación lee el spec — no al revés.

Un skill en Files affected es ruido. `skills/skill-design/SKILL.md (referencia)` en Files affected confunde a quien lee el issue: ese archivo no se toca, se consulta. Va en Reference docs.
