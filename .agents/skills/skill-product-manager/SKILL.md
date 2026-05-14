---
name: skill-product-manager
description: Workflow de Product Manager para Odessay en Linear: definición de issues ejecutables, dependencias, prioridades, validaciones y criterios de done. Usar cuando crees, priorices, refinés o ejecutes tickets y milestones del roadmap.
---

# Skill: Product Manager (Linear)

Este skill tiene dos funciones. Primera, definir cómo se escribe y ejecuta cada issue para que sea completamente ejecutable por un agente de código o legible por un humano sin ambigüedad. Segunda, establecer el proceso de orquestación: cómo se secuencian los issues, cómo se hace seguimiento, y cómo se valida la entrega.

El alcance específico del proyecto — fases e issues macro — vive en `workflow/define/roadmap.md`. Lee ese documento antes de crear issues.

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

Linear usa esta máquina de estados canónica:

**Todo** — el issue existe y está definido. No está en ejecución aún.

**In Progress** — hay un agente o humano trabajando en él. Tiene branch activo.  
Si hay checkpoint humano, el issue permanece en `In Progress` con comentario `⏸ HANDOFF REQUERIDO`.

**In Review** — el trabajo terminó, el PR está abierto, esperando revisión.

**Done** — PR mergeado, criterios de entrega verificados, commit referenciado.

Transiciones obligatorias:
- `Todo` → `In Progress` al iniciar ejecución.
- `In Progress` → `In Review` al abrir PR con validaciones.
- `In Review` → `Done` tras merge confirmado.
- Si review es rechazado: `In Review` → `In Progress`.

Si el team usa estado `Ready`, se interpreta como pre-cola entre `Todo` e `In Progress`, nunca como reemplazo de `In Progress`.

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
Issues que deben estar en Done antes de que este pueda pasar a In Progress.
Si no tiene dependencias, escribir: None.

Formato: [ID-DEL-ISSUE] Título del issue del que depende.

## Consumers *(si el issue cambia un contrato del que otros issues dependen)*

Listar los issues consumidores del contrato que este issue toca, y para cada uno la asunción específica afectada. Omitir esta sección solo si el issue no cambia ningún contrato visible para otros features.

Formato:
- [ID-DEL-CONSUMER] Título — asunción concreta que este issue invalida o modifica.

El análisis de consumidores no es solo enumerativo: el agente que escribe el brief debe verificar si el cambio rompe asunciones del consumer y, si lo rompe, declarar explícitamente si se genera un sub-issue de migración o si el fix entra en el alcance de este mismo issue.

Tipos de contrato cuya modificación obliga a hacer este análisis:
- Esquema de base de datos (columnas renombradas, tipos cambiados, RLS modificadas).
- Forma de un payload de API o de un evento.
- Estructura de un objeto persistido en cliente (localStorage, IndexedDB, cookies).
- Convención de URLs/rutas (paths, query params, redirect URLs).
- Props públicas de un componente compartido.
- Variables de entorno cuyo nombre o significado cambia.
- Nombres de claves en archivos de config compartidos (`workflow/perf-budgets.json`, `workflow/status.json`, etc.).

Un brief que cambia un contrato sin listar consumidores produce regresiones latentes: el feature consumidor sigue funcionando localmente con su asunción vieja hasta que un caso edge lo expone, típicamente lejos del autor del cambio. Cuando dudes si algo es "un contrato", asume que sí lo es y enumera consumidores.

## Files affected
Archivos que este issue va a crear o modificar. El agente verifica antes de empezar
que ningún PR abierto toca los mismos archivos — si hay solapamiento, espera.

Formato — siempre texto plano, nunca Markdown links:
- src/path/to/file.tsx (nuevo | modifica)
- src/otro/archivo.ts (nuevo | modifica)

**Reglas:**
1. Texto plano siempre. Nunca `[archivo.md](<http://archivo.md>)` ni ninguna sintaxis de link — los nombres de archivo no son URLs.
2. Paths sin prefijo `./` — usar `app/page.tsx`, no `./app/page.tsx`. El path es relativo a la raíz del repo, el `./` es ruido.
3. Los docs de spec (`workflow/context/core/`, `workflow/context/features/`) nunca van aquí — son fuente de verdad que la implementación lee, no modifica. Si los pones en Files affected, estás invirtiendo la dirección de la dependencia.
4. Los skills (`.agents/skills/*/SKILL.md`) nunca van aquí — son referencia, no output. Van en Reference docs.
5. `workflow/status.json` debe aparecer como `(modifica)` en todo issue que vaya a `In Review`. `workflow/SETUP.md` solo aparece cuando cambian reglas operativas, tools o permisos.
6. **Honestidad de scope code vs docs.** Si el cambio principal es documental (`workflow/context/features/*.md`, `workflow/context/core/*.md`, etc.) pero el doc define o redefine un patrón que requiere código para funcionar, listar también los archivos de código que el patrón obliga a tocar. Aplica en cualquier dirección: un brief de feature, performance budget, modelo de datos, contrato de presentación o protocolo de auth puede empezar como docs y terminar requiriendo route handlers, helpers, migraciones, tests o componentes. Un brief que oculta el código bajo la etiqueta "docs-only" genera scope creep silencioso en BUILD y deja al REVIEW sin baseline. Ejemplos de patrones que típicamente arrastran código: redefinición de un contrato de URL/redirect, cambio de schema de tabla, nuevo budget de perf con harness asociado, nuevo flow visual con componente compartido, nueva política de validación de input.

Si el issue solo toca código sin conflictos de archivos compartidos, evita `N/A`: lista al menos los archivos núcleo tocados + `workflow/status.json`.

## Handoff *(solo si el issue requiere acción humana)*

Omitir esta sección si el issue es código puro. Incluirla cuando el agente llega a un punto que no puede resolver solo — crear un servicio externo, aprobar un acceso, llenar credenciales.

Formato:
```
Acción requerida: [qué debe hacer el humano, con suficiente detalle para ejecutarlo sin preguntar]
Dónde: [URL o lugar concreto — dashboard, settings, terminal, etc.]
Resultado esperado: [qué debe existir o estar disponible cuando el humano termine]
El agente continúa cuando: [condición verificable — ej. ".env.local tiene valor en SUPABASE_URL"]
```

Si la acción humana está bloqueada por una limitación técnica/plan (ejemplo: branch protection no disponible en repo privado), el issue no se congela: el Handoff debe declarar un fallback operativo verificable y dejar explícito qué evidencia habilita continuar.

Ejemplo (ODE-11 — Configure Supabase):
```
Acción requerida: Crear dos proyectos en Supabase — uno llamado "odessay-staging"
y otro "odessay-prod". Copiar las tres keys de cada uno en .env.local.
Dónde: https://app.supabase.com → New project
Resultado esperado: .env.local tiene valores reales en NEXT_PUBLIC_SUPABASE_URL,
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY y SUPABASE_SERVICE_ROLE_KEY.
(NEXT_PUBLIC_SUPABASE_ANON_KEY es alias legacy opcional — ver workflow/setup/environment.md §Variables de entorno.)
El agente continúa cuando: ls .env.local && cat .env.local muestra las tres variables con valor.
```

Ejemplo (ODE-9 — Setup GitHub repository sin branch protection disponible):
```
Acción requerida: Confirmar que el repositorio permanecerá privado y que, por limitación del plan, branch protection no puede habilitarse.
Dónde: GitHub repo settings + comentario en el issue de Linear.
Resultado esperado: Política operativa acordada: no push directo a main, todo cambio entra por PR y merge aprobado por humano.
El agente continúa cuando: existe comentario explícito en el issue confirmando la limitación y la política de fallback.
```

## Requirements
Lo que debe existir cuando el issue esté terminado. Numerado. Cada item es verificable
de forma independiente. No son instrucciones de implementación — son resultados esperados.

1. El usuario puede hacer X.
2. La tabla Y existe con los campos Z.
3. El endpoint W responde correctamente cuando...

## Performance Contract
Obligatorio si el issue toca interacciones de UI, editor, rendering o performance explícita.
Si no aplica, escribir `Performance Contract: not required` y justificar por qué.

Formato recomendado:
Required: yes | no
Scope: [flujo/ruta concreta que se mide]
Trace scenario: [comando o pasos exactos y reproducibles]
Budgets: workflow/perf-budgets.json (version activa)
Evidence required in PR:
- Trace path (ej: artifacts/perf/editor-trace.json.gz)
- Resultado de `node scripts/check-performance-gate.mjs --trace <trace>`
- Resultado de `OPS_PERF_TRACE_PATH=<trace> npm run ops:delivery:gate`
Approval rule: `required_failures = 0` y métricas requeridas presentes.

## Reference docs
Documentos del proyecto que el agente debe leer antes de implementar.
Usar siempre paths completos desde la raíz del repo.

- workflow/context/core/odessay-modelo-datos.md (sección: writings)
- .agents/skills/skill-database/SKILL.md
- .agents/skills/skill-backend/SKILL.md

**Qué incluir según el tipo de issue:**
- Cualquier issue con UI → `.agents/skills/skill-design/SKILL.md` + `.agents/skills/skill-design/vistas.md`
- Cualquier issue con páginas nuevas (`/login`, `/signup`, `/desk`, etc.) → `workflow/context/core/odessay-paginas.md`
- Cualquier issue con flujos de usuario → `workflow/context/core/odessay-flujos.md` (sección relevante)
- Cualquier issue de frontend → `.agents/skills/skill-frontend/SKILL.md`
- Cualquier issue de backend/API → `.agents/skills/skill-backend/SKILL.md`
- Cualquier issue de base de datos → `.agents/skills/skill-database/SKILL.md` + `workflow/context/core/odessay-modelo-datos.md`
- Issues que tocan un feature con doc propio → el doc de `workflow/context/features/` correspondiente
- Issues que tocan tabs, filtros, o navegación interna del editor → `workflow/context/features/odessay-sync.md` + `workflow/context/core/odessay-arquitectura.md`
- Issues con templates visuales reutilizables (emails, PDFs, public pages) → la sección correspondiente de `.agents/skills/skill-design/vistas.md` con el spec canónico citado por anchor (no genérico).
- Issues que tocan AI de corrección ortográfica, streaming de sugerencias o memoria de accept/reject → `workflow/context/features/odessay-ai-writing-assist.md` (obligatorio).
- Issues que tocan extensiones de TipTap/ProseMirror, decorations, serializer/parser o round-trip Markdown ↔ JSON → `workflow/context/features/odessay-prosemirror-tiptap.md` (obligatorio).

**Regla de conexión de documentos (obligatoria):**
- Si el issue cambia comportamiento de una feature documentada, el brief debe citar explícitamente ese documento en `Reference docs`.
- Si no existe documento de feature para el cambio, el PM debe crear un sub-issue de documentación o ampliar el issue para incluir la actualización del documento y `workflow/docs.json`.
- No dejar documentos “huérfanos”: todo documento de `workflow/context/features/` debe tener al menos un tipo de issue que lo cite de forma explícita.

**External references — obligatorias cuando el issue depende de un servicio o protocolo externo:**

Las refs internas del repo no bastan cuando el issue se integra con un proveedor (Supabase, Stripe, Resend, Anthropic, Vercel, GitHub, etc.) o sigue un patrón documentado fuera del repo. La regla general: si BUILD necesitaría buscar en Google para implementar correctamente, ese link debe estar en `Reference docs`.

Categorías de referencia que típicamente caen acá:
- **APIs y SDKs de terceros** — link al endpoint canónico del feature usado, no al landing page genérico. Si hay variantes (server-side vs client-side, SSR vs SPA, App Router vs Pages Router), citar la variante que aplica al stack del repo.
- **Protocolos y standards públicos** — OAuth2, OIDC, JWT, PKCE, OTP, CORS, CSP, RFC específicas. Incluir tanto el RFC como cualquier guía de implementación que el proveedor publique.
- **Convenciones del framework** — patrones de Next.js App Router, React Server Components, Tailwind config, Vercel env handling cuando el issue depende de ellos.
- **Limitaciones documentadas** — quotas, rate limits, plan tiers, feature gates del proveedor que afectan el diseño.

El criterio operativo es simple: BUILD debe poder implementar sin tener que inferir nombres de variables, formas de payload, ni elegir entre patrones equivalentes. Si el brief no cita el link canónico, BUILD invariablemente inventa un patrón aproximado o usa uno obsoleto. Ese costo aparece como rounds extra de REVIEW, no como falla obvia en BUILD.

## Delivery

### Commits
El agente hace commits atómicos durante el desarrollo con mensajes en formato convencional.
Cada mensaje incluye el ID del issue al final: `feat: implement auto-save debounce [ODE-42]`
Se hace push al branch remoto al terminar cada subtarea significativa dentro del issue.

### Trazabilidad Linear ↔ GitHub

Al mover el issue a In Review, el agente debe dejar un comentario en el issue de Linear con:
- Link al PR abierto
- SHA del commit principal (o el último commit del branch)
- Resultado resumido de las validaciones (✅ typecheck / ✅ lint / ✅ tests o equivalente)

Sin este comentario, el issue queda desconectado del trabajo real y el humano no puede hacer el merge con contexto.

Formato del comentario:
```
PR: [link]
Commit: [SHA]
Validaciones: typecheck ✅ | lint ✅ | tests ✅
Listo para merge.
```

### Trazabilidad GitHub ↔ Linear ↔ status.json

Antes de mover un issue a `In Review`, el agente debe actualizar `workflow/status.json` con una entrada en `built[]` para ese issue (issue, linear_url, commit, date, notes).

Luego corre:
```bash
npm run ops:delivery:gate
```

Si este gate falla, el issue no puede pasar a `In Review`.

### Validation
[LLM] Antes de mover el issue a In Review, ejecuta las validaciones que apliquen y documenta el resultado. No es suficiente que el código compile — el agente debe proporcionar proof of work: el output real de lo que corrió.

**El owner de Odessay es no técnico.** El agente es el único responsable de la calidad del código. El humano no hace code review — confía en las validaciones del agente. Por eso el proof of work es obligatorio e irremplazable: es la única forma que tiene el humano de saber que el trabajo está bien hecho antes de aprobar el merge.

**Checks obligatorios en todo issue:**
```bash
npm run typecheck   # debe pasar sin errores
npm run lint        # debe pasar sin errores
npm test            # debe pasar sin dependencias externas (ver workflow/quality/testing-observability.md §Hermetic testing)
```
Pegar el output de estos tres comandos en la descripción del PR. Sin este output, el PR no está completo.

**Si el issue toca funcionalidad de interacción en el browser:**
- Usa Playwright MCP para recorrer el flujo completo que el issue habilita.
- Verifica que no hay errores en consola del browser durante el flujo.
- Verifica estados de carga, errores y casos edge definidos en Requirements.
- Pegar screenshot o log del resultado en el PR.

**Si `Performance Contract` es requerido:**
- Captura trace reproducible (`node scripts/capture-editor-trace.mjs` o comando equivalente declarado en el brief).
- Evalúa budgets (`node scripts/check-performance-gate.mjs --trace <trace>`).
- Corre delivery gate con `OPS_PERF_TRACE_PATH=<trace>`.
- Adjunta en PR output de ambos comandos + rutas de artefactos generados.

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

Un issue nunca pasa a In Progress mientras tenga dependencias en estado distinto a Done.

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

1. Lee `workflow/define/roadmap.md` para entender fases y el mapa de issues.
2. Crea los labels en Linear exactamente como están definidos en este documento.
3. Crea los estados en Linear: Todo, In Progress, In Review, Done. (Ready es opcional como pre-cola).
4. Crea **un proyecto por fase** en Linear, con el nombre exacto de la fase (`Fase 0 — Cimientos`, `Fase 1 — Escribir`, etc.) y descripción de exit criteria específica a esa fase.
5. Crea todos los proyectos desde el inicio con status `Planned`. Solo la fase activa pasa a `In Progress`.
6. Crea los issues de la fase activa dentro de su proyecto, con estado Todo.
7. Mueve a In Progress solo los que no tienen dependencias abiertas.
8. No crees issues de fases siguientes hasta que la fase anterior esté completa.

### Al crear un issue

Sigue la estructura de descripción definida en este documento. Todo issue debe tener Context, Dependencies, Requirements, Reference docs, Delivery y Notes si aplica. Un issue sin Definition of Done no es un issue.

**Asignación:** el agente crea los issues sin assignee. El humano los asigna. No asignar issues a nombres o usuarios — dejar el campo vacío al crear.

### Al ejecutar un issue

[LLM] Antes de empezar: verifica que todas las dependencias están en Done. Lee los Reference docs indicados en el issue. Crea el branch desde main con el formato `codex/{issue-id}-{descripcion-corta}` o `feat/{issue-id}-{descripcion-corta}` o `fix/{issue-id}-{descripcion-corta}`. Si la rama actual es `main`, no commitees ahí: cambia primero al branch de trabajo. Mueve el issue a In Progress.

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

Un commit directo en `main` es un error operativo. Si ocurre, corrígelo antes de continuar: mueve los commits al branch de feat y restaura `main` al commit anterior.

Un archivo en Files affected escrito como link Markdown rompe la legibilidad. `[CLAUDE.md](<http://CLAUDE.md>)` no es un path — es un artefacto de parseo. Los nombres de archivo van siempre como texto plano.

Un spec doc en Files affected invierte la causalidad. Si `workflow/context/features/odessay-sync.md` aparece como `(modifica)`, significa que el issue está reescribiendo el spec en lugar de implementarlo. El spec existe antes que el issue. La implementación lee el spec — no al revés.

Un skill en Files affected es ruido. `.agents/skills/skill-design/SKILL.md (referencia)` en Files affected confunde a quien lee el issue: ese archivo no se toca, se consulta. Va en Reference docs.

Un issue con checkpoint humano sin sección Handoff bloquea silenciosamente. Si el agente necesita que el humano cree un servicio externo o llene credenciales y no lo declara explícitamente, el agente intentará ejecutar contra un entorno inexistente y fallará sin diagnóstico claro. Cualquier issue que toque servicios externos (Supabase, Vercel, GitHub, APIs de terceros) necesita sección Handoff.

Un issue que propone `router.push()` para estado interno contradice la arquitectura local-first. Si el issue describe tabs, filtros, o paneles que usan navegación de página para mostrar datos que ya están en `localDB`, debe ser reconsiderado. Ver `workflow/context/features/odessay-sync.md`.
