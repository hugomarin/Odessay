---
name: skill-planning
description: "Método de Planning para Odessay: cómo convertir cada unidad de trabajo del roadmap en un Issue Brief ejecutable y bien definido — schema, verificación de definición, contratos, revisión por domain skills. Usar cuando definas o endurezcas un issue del roadmap."
---

# Skill: Planning

Este skill tiene tres funciones. Primera, definir cómo se define y endurece cada issue para que sea completamente ejecutable por un agente de código o legible por un humano sin ambigüedad. Segunda, establecer qué debe contener cada tipo de contrato (`Architecture`, `Performance`, `Visual/UX`) y cuándo es obligatorio. Tercera —y la que falla cuando un trabajo se ejecuta impecablemente y aun así sale mal— **garantizar que la definición sobre la que se construye el brief es verdadera** (reconciliada con el código, no solo internamente consistente) **y que el resultado entregado fue aceptado por el dueño** contra su intención. Sin la tercera función, las dos primeras producen ejecución perfecta de la cosa equivocada.

La orquestación de la fase — topología, secuenciación, critical path, síntesis — vive en `.agents/agents/planning-agent.md`. Este skill no la repite: endurece cada nodo de esa topología en un Issue Brief ejecutable.

El alcance específico del proyecto — fases e issues macro — vive en `workflow/define/roadmap.md`. Lee ese documento antes de crear issues.

Este skill define **qué** debe existir en cada issue y con qué calidad. La persistencia en Linear — crear y gestionar proyecto e issues — es ownership de `wf-define` (ver `workflow/workflow.md`), no de este documento.

Si la fase ya tiene roadmap y DoD, este skill se usa para convertir esa definición en planeación táctica de issues. No debe reabrir la estrategia de fase salvo que detecte una asimetría real entre roadmap y DoD.

Cuando el issue deje de ser solo producto/scope y pase a involucrar runtime boundaries, shared core, save path, sync, parser/serializer o extracción de servicios, cargar también `.agents/skills/skill-architecture/SKILL.md`.

Cuando el issue introduzca datos, fetches, hydration, listeners, componentes en caminos críticos, procesos bulk, trabajo background o una capability de runtime, cargar también `.agents/skills/skill-performance/SKILL.md` antes de cerrar el brief.

---

## Execution Trace — schema

Toda salida cerrada de `wf-define` debe incluir esta `Execution Trace` — **una por ejecución de `wf-define`, no una por issue**: la fase puede generar varios issues en una sola corrida, y todos comparten la misma traza de cómo se planificó la fase. Un solo canonical owner del schema: este skill lo define porque forma parte de la calidad de la definición. El `Planning Agent` la produce; `wf-define` solo verifica que exista antes de cerrar — ninguno de los dos repite el schema completo.

- `Planning role`: rol efectivamente usado
- `Skills loaded`: skills realmente cargados, no skills meramente disponibles
- `Specialist consults`: consultas explícitas a frontend/backend/database/ux u otros
- `Skill reviews` — veredicto por cada skill de dominio del scope: `sin objeciones` u `objeciones resueltas: <lista>` (ver §Revisión por skills de dominio). No se puede cerrar una definición con este campo vacío si el scope activó al menos un skill.
- `Audit run` — si se ejecutó `skill-audit-planning`, y sobre qué artefactos.
- `Definition check` — resultado de la verificación de definición (ver §Verificación de definición): `docs↔code↔linear = consistente` o `contradicción detectada (bloquea)`. No se puede cerrar una definición con este campo vacío.
- `Artifacts created`: proyecto/issues/comentarios/documentos persistidos
- `Why`: justificación corta de por qué esos skills/consultas fueron suficientes

El objetivo no es verbosear el razonamiento interno, sino dejar trazabilidad operativa verificable.

---

## Descubrimiento documental para arquitectura y desktop

Cuando el prompt, roadmap o conversación mencionen cualquiera de estas señales:

- desktop
- Tauri / Electron
- mobile
- shared core
- adapters
- runtime
- filesystem
- `.md` como fuente de verdad
- local-first más allá del runtime web
- separación frontend/backend para portabilidad
- extracción de servicios (`DocumentService`, `SyncService`, etc.)

el Planning Agent debe asumir que el issue toca la estrategia arquitectónica del producto y cargar esta secuencia, en este orden:

1. `workflow/context/features/odessay-desktop-app.md`
2. `workflow/context/features/odessay-desktop-migration-diagnostic.md`
3. `workflow/context/features/odessay-desktop-target-architecture.md`
4. `workflow/context/features/odessay-desktop-migration-plan.md`

Cómo llegar ahí:

- primero consultar `workflow/docs.json` para ubicar el documento correcto y confirmar que existe en el inventario canónico
- luego citar explícitamente en `Reference docs` solo los documentos de la secuencia que realmente condicionan el issue

Regla:

- si un issue cambia arquitectura, contratos, runtime boundaries, documento canónico o secuencia de migración, el brief no puede quedarse solo con docs técnicos locales del feature; debe incluir el doc desktop correspondiente
- si el prompt menciona desktop de forma estratégica y el Planning Agent no cita ninguno de estos docs, el brief está incompleto
- si además el issue cruza frontend/backend/database, el Planning Agent debe usar `skill-architecture` para clasificar ownership y boundaries antes de cerrar el brief

---

## Verificación de definición — antes de escribir el brief

El resto del skill da por hecho que los docs que el brief cita son verdaderos. **No lo asumas.** El modo de falla más caro de Odessay no es un brief ambiguo: es un brief perfecto construido sobre una definición stale, que BUILD ejecuta impecablemente y produce *la cosa equivocada con toda consistencia*. Antes de citar cualquier doc como contrato del issue, verifícalo.

### Regla rectora: consistencia ≠ corrección

Que un doc sea internamente coherente, o que coincida con otros docs, **no** lo hace correcto. Un error repetido en tres docs sigue siendo un error. La definición se valida contra **el código real** y **la intención del producto**, no contra "así estaba escrito".

### Qué verificar (por cada doc que el brief va a citar como contrato)

1. **docs ↔ code.** Las afirmaciones clave del doc que condicionan este issue, ¿siguen siendo ciertas en el código que describe? (Abre el archivo/función que el doc nombra y compáralo. No infieras desde el doc.) Ejemplo real: un doc decía "`body_json` es la fuente de verdad" mientras la dirección del producto era `.md` canónico — un brief que lo citara habría pedido lo contrario de lo correcto.
2. **docs ↔ docs.** ¿El doc contradice a otro doc del corpus, o a un skill? Si dos fuentes se contradicen, **no promedies** ni elijas una por inercia.
3. **docs ↔ Linear.** ¿El spec del issue en Linear contradice lo que dice el doc, o lo que hace el código?
4. **¿El doc es normativo por delante del código?** Algunos docs describen el *destino*, no el runtime actual (p. ej. el corpus de identidad de documento reconciliado por su ADR). Si es así, el brief debe **marcar qué partes son destino vs. estado actual**, para que BUILD no implemente el destino prematuramente ni lea el doc como descripción del runtime vigente.

### Qué hacer cuando hay contradicción

Una contradicción detectada (docs↔code, docs↔docs, docs↔linear) es **bloqueante**, igual que un `Context Gap` por doc faltante. No se resuelve dentro del brief:

- Escálala al dueño, o
- abre una **reconciliación de contexto** formal antes de construir el brief (precedente: el ADR de identidad de documento `workflow/context/core/odessay-adr-identidad.md`, que cerró una polaridad que ningún skill estaba facultado para resolver).

Marcar el brief como `needs-clarification` / `blocked` y declarar la contradicción es correcto. Construir el brief encima de la contradicción "porque el doc lo dice" es el error que esta sección existe para evitar.

### Salida obligatoria

El campo `Definition check` de la `Execution Trace` registra el resultado: `docs↔code↔linear = consistente` o `contradicción detectada (bloquea)` con la contradicción concreta. Un brief no está listo para DEFINE/BUILD con este campo vacío.

---

## Revisión por skills de dominio — antes de crear el issue

La verificación de definición garantiza que el brief está construido sobre hechos. Esta sección garantiza que el brief **no viola las reglas de las disciplinas que va a tocar**. Son gates distintos: un brief puede ser verdadero y aun así planear algo que `skill-frontend` prohíbe.

Precedente que motiva este gate: ODE-338 (learned words) pasó DEFINE, BUILD y REVIEW violando invariantes ya escritos en los skills (matching sin límites de token prohibido por `skill-frontend §ProseMirror guardrails`; filtro aplicado en un solo entry point). Los skills existían; nadie los invocó contra el brief. Ver `docs/revision-correcciones-anotaciones-2026-07.md §5`.

### Matriz de activación (obligatoria, no consultiva)

| El brief toca... | Skill que DEBE revisar el brief |
|---|---|
| UI, componentes, editor, vistas | `skill-frontend` (+ `skill-design` si hay superficie visual nueva) |
| API routes, server-side, integraciones | `skill-backend` |
| Migraciones, schema, RLS, queries | `skill-database` |
| AI corrections, learned words, sugerencias, decoraciones de corrección | `skill-corrections` |
| Desktop, multi-runtime, shared core, save path, sync, parser/serializer, servicios | `skill-architecture` (ya obligatorio; se mantiene) |
| Flujos de usuario con criterios de aceptación E2E | `skill-ux-testing` |

Si el brief toca varios scopes, se invocan varios skills. Si no toca ninguno (issue de infra/docs puro), el campo `Skill reviews` de la Execution Trace declara `no aplica — <razón>`.

### Protocolo de revisión

Por cada skill activado, el agente de planeación (o un subagente si el entorno lo soporta):

1. Carga el `SKILL.md` completo del skill.
2. Revisa el brief contra tres cosas del skill: **invariantes/guardrails**, **anti-patterns bloqueantes**, y **checklist de entrega** (para verificar que los Requirements del brief son compatibles con lo que el checklist va a exigir en BUILD).
3. Produce un veredicto: `sin objeciones` o una lista de objeciones concretas, cada una citando la regla del skill que el brief viola u omite.
4. Las objeciones son **bloqueantes**: se resuelven modificando el brief (o escalando al dueño si la objeción revela una tensión de producto) antes de crear el issue en Linear. No se anotan como "notas" para resolver en BUILD.

El resultado va en la `Execution Trace` (`Skill reviews`) y las objeciones resueltas quedan reflejadas en el brief mismo (Requirements, Failure modes, Reference docs) — no como apéndice.

### Regla de invariantes citados

Cuando el brief cite un invariante de un skill o feature doc como criterio ("las coincidencias parciales no se aceptan", "todo estado tiene salida"), debe anotar cómo se verifica:

- `enforced by: <test o comando existente>` — el invariante tiene verificación ejecutable; BUILD debe mantenerla verde.
- `no enforcement — BUILD debe crear el test` — el invariante existe solo en prosa; crear su test entra al alcance del issue.

Un invariante citado sin esta anotación es un `Context Gap`: nadie sabrá si se cumplió.

---

## Estructura en Linear — leer antes de crear nada

```
Team: Odessay
  └── Project: Fase N — <nombre>     ← status: In Progress   (la fase activa)
  └── Project: Fase N+1 — <nombre>   ← status: Planned
  └── Project: Fase N+2 — <nombre>   ← status: Planned
  ...una entrada por cada fase del roadmap (ver workflow/define/roadmap.md para el estado real)
```

**Reglas no negociables:**
- Un proyecto por fase. No un proyecto "Odessay" con milestones internos.
- El team Odessay ya es el contenedor del producto — un proyecto adicional con el mismo nombre es redundante.
- Los milestones dentro de un proyecto solo se usan si una fase tiene sub-entregas con criterios de done independientes. En la mayoría de las fases no son necesarios.
- Cada proyecto se crea con status `Planned` hasta que su fase se activa. Solo la fase activa pasa a `In Progress`.

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
- Nombres de claves en archivos de config compartidos (`workflow/perf-budgets.json`, `workflow/status.json`, los ledgers `workflow/*.jsonl`, etc.).

Un brief que cambia un contrato sin listar consumidores produce regresiones latentes: el feature consumidor sigue funcionando localmente con su asunción vieja hasta que un caso edge lo expone, típicamente lejos del autor del cambio. Cuando dudes si algo es "un contrato", asume que sí lo es y enumera consumidores.

Esta lista no termina en el brief: `.agents/skills/architecture-recon/SKILL.md` la confirma contra el código real antes de implementar (BUILD), y `.agents/skills/review-architecture/SKILL.md` verifica que los consumers efectivamente dependen del owner declarado, no de una copia paralela (REVIEW). Un consumer que el brief omitió es la causa más común de un finding `[P0]`/`[P1]` de arquitectura.

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
5. `workflow/workflow.md` solo aparece cuando cambian reglas operativas, tools, permisos, o el nombre del check de CI que gatea el merge (hoy `CI required`, agregado por `.github/workflows/blocking-ci.yml`). Los ledgers (`workflow/built.jsonl`, `workflow/review-history.jsonl`, `workflow/status.json`) no van aquí — las ramas de feature no los tocan; se actualizan en `main` post-merge durante REVIEW (ver `workflow/workflow.md`).
6. **Honestidad de scope code vs docs.** Si el cambio principal es documental (`workflow/context/features/*.md`, `workflow/context/core/*.md`, etc.) pero el doc define o redefine un patrón que requiere código para funcionar, listar también los archivos de código que el patrón obliga a tocar. Aplica en cualquier dirección: un brief de feature, performance budget, modelo de datos, contrato de presentación o protocolo de auth puede empezar como docs y terminar requiriendo route handlers, helpers, migraciones, tests o componentes. Un brief que oculta el código bajo la etiqueta "docs-only" genera scope creep silencioso en BUILD y deja al REVIEW sin baseline. Ejemplos de patrones que típicamente arrastran código: redefinición de un contrato de URL/redirect, cambio de schema de tabla, nuevo budget de perf con harness asociado, nuevo flow visual con componente compartido, nueva política de validación de input.

Si el issue solo toca código sin conflictos de archivos compartidos, evita `N/A`: lista al menos los archivos núcleo tocados.

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

## Failure modes *(required si el issue toca operaciones async: fetch, sync, cache, AI, colas, timers)*

Los Requirements describen el happy path. Esta sección obliga a definir el comportamiento esperado cuando algo falla — la clase de bug que los checklists no atrapan (carreras, estados colgados, optimistic updates sin rollback; precedente: C4, C6, C7, C8 y C10 de `docs/revision-correcciones-anotaciones-2026-07.md`, todos shippeados porque ningún brief preguntó "¿y si falla?").

Por cada operación async que el issue introduce o modifica, responder cuatro preguntas:

1. **Fallo de red/servicio:** ¿qué ve el usuario y qué queda en el estado local? ¿Hay retry? ¿Hay rollback del update optimista?
2. **Respuesta inválida:** si la fuente (API, LLM, cache) devuelve datos malformados o parciales, ¿se degrada por item o colapsa todo?
3. **Carrera:** si esta operación compite con otra (carga vs análisis, edición vs re-cálculo, cambio de doc a mitad), ¿quién gana y cómo se garantiza?
4. **Estado intermedio:** si la operación introduce un estado transitorio visible (loading, stale, recalculando), ¿cuál es su transición de salida garantizada y su timeout? Un estado sin salida es un bug de diseño, no un edge case.

Formato: prosa corta por operación. `not required` exige justificación ("el issue no toca operaciones async porque...") — la omisión silenciosa es lo que este campo existe para evitar.

Este campo no es solo autochequeo: es el contrato que `.agents/skills/review-correctness/SKILL.md` verifica en `/wf-review` (transición co-owned, estado intermedio no modelado, identidad creada en hot path, update optimista sin rollback, colapso de colección sobre output de LLM). Un brief que responde bien estas cuatro preguntas reduce directamente los findings de esa lente.

## Validation requirements

Por cada Requirement/Failure mode declarado arriba, elegir el **nivel mínimo de evidencia que pueda falsificarlo** — no el nivel que "se usa normalmente". La taxonomía (unit / contract / integration / E2E / performance) y el principio rector ("test at the lowest-cost boundary that can falsify the failure mode we care about") viven en `workflow/testing/critical-capabilities-testing.md`; este campo no los repite, los aplica.

Formato: por cada propiedad crítica del issue, una línea `<qué se falsifica> → <nivel elegido>`. E2E y Performance no son el default — cuando se seleccionan, la línea debe justificar por qué el nivel inferior no basta (qué failure mode real requiere browser, o qué hot path requiere un Performance Contract). "Hagamos E2E para estar seguros" no es una justificación válida.

Ejemplo:

```text
- Export a DOCX no corrompe Unicode → contract test sobre el adapter, sin UI.
- Modal de reasignación de Workspace se cierra correctamente tras confirmar → E2E — el failure mode es choreography de foco/cierre que un test bajo el componente no modela razonablemente.
```

`.agents/skills/review-testing/SKILL.md` verifica en `/wf-review` que la evidencia entregada corresponde al nivel declarado aquí, y que toda escalada a E2E/performance vino con justificación — no exige Playwright por defecto.

**Si el issue produce o modifica evidencia de una fila del `workflow/quality/capability-integration-map.md`:** el brief declara el *failure mode* a cerrar, nunca un `coverage_status` objetivo — `"mover DOC-03 a INTEGRATION"` es un criterio de aceptación inválido, `"endurecer la evidencia de DOC-03 para el failure mode X"` es el válido; el status se deriva de la evidencia al cerrar. Además, este campo nombra el **entry point de producción** por el que el proof debe entrar y el **completion event** cuando la cadena incluye trabajo async o diferido. Las reglas de construcción viven en `workflow/quality/capability-proof-contract.md`: este skill no las duplica, exige que el brief las respete.

## Performance Architecture Review

La arquitectura de performance vive en `.agents/skills/skill-performance/SKILL.md`. Este skill no duplica sus tablas, umbrales ni patrones: decide cuándo debe consultarse y exige que el resultado forme parte del brief.

Cuando aplica, el brief debe incluir el `Performance Architecture Contract` del skill, con al menos:

- outcome sistémico;
- unidad de escala y camino crítico;
- consumidores existentes;
- estrategia de carga y actualización;
- forma de costo esperada;
- riesgo de crecimiento;
- capability/runtime involucrado;
- evidencia proporcional;
- enfoque descartado y por qué.

El Planning Agent no debe crear un issue que resuelva una necesidad local mientras agrega carga global no explicada. Si no se puede determinar la forma de carga o los consumidores existentes, el issue queda `needs-clarification` o `blocked` antes de BUILD.

## Visual / UX Contract

La arquitectura de performance y el contrato visual son contratos distintos. Históricamente, **ningún contrato visual** — y ese hueco dejó pasar superficies que funcionaban pero no se veían ni se comportaban como debían (p. ej. una tabla de Workspace que debía ser idéntica a la de Desk y salió con fondo, borde redondeado e ícono que Desk no tiene). "Se ve como X" no es aceptable como intención implícita: si no está escrito y es verificable, no se cumple.

**Cuándo es `required`:** todo issue etiquetado `frontend`, o que toque `components/**`, `app/(app)/**/page.tsx`, o cualquier superficie visible al usuario. Marcar `not required` exige justificación; no es un default silencioso.

```
Visual / UX Contract:
  Referencia visual:   [superficie existente que debe igualarse | anchor de design spec | screenshot adjunto]
  Criterio de paridad: [enumerado y verificable — ej. "mismo fondo/borde/columnas/sin ícono que DeskActivityTable;
                        misma densidad de fila; mismo empty state"]
  Comportamiento:      [estados que deben coincidir — hover, selección, loading, vacío, error]
  Fuera de alcance:    [diferencias intencionales permitidas, si las hay]
Evidence required in PR:
  - Screenshot lado-a-lado de la superficie nueva contra la referencia, por cada criterio de paridad.
```

**Regla.** Si el issue dice "igual que <otra superficie>", el criterio de paridad debe nombrar la superficie de referencia concreta (componente/archivo) y enumerar en qué dimensiones debe ser idéntica. "Igual que Desk" sin enumerar qué significa "igual" es exactamente la ambigüedad que produjo el mismatch.

## Reference docs
Documentos del proyecto que el agente debe leer antes de implementar.
Usar siempre paths completos desde la raíz del repo.

Ejemplo mínimo (backend/database tradicional, no baseline universal):

- workflow/context/core/odessay-modelo-datos.md (sección: writings)
- .agents/skills/skill-database/SKILL.md
- .agents/skills/skill-backend/SKILL.md

Regla:

- No copiar este ejemplo por inercia.
- `Reference docs` debe construirse desde el scope real del issue.
- Si el issue toca desktop, shared core, runtime boundaries o contrato documental, la familia documental desktop reemplaza cualquier baseline implícito web/Supabase-first.
- `Reference docs` no se valida por "trae los cuatro docs" sino por suficiencia contractual: debe incluir exactamente los documentos que BUILD necesita para ejecutar sin inferir arquitectura desde el código.

**Qué incluir según el tipo de issue:**
- Cualquier issue con UI → `.agents/skills/skill-design/SKILL.md` + `.agents/skills/skill-design/vistas.md`
- Cualquier issue con páginas nuevas (`/login`, `/signup`, `/desk`, etc.) → `workflow/context/core/odessay-paginas.md`
- Cualquier issue con flujos de usuario → `workflow/context/core/odessay-flujos.md` (sección relevante)
- Cualquier issue de frontend → `.agents/skills/skill-frontend/SKILL.md`
- Cualquier issue de backend/API → `.agents/skills/skill-backend/SKILL.md`
- Cualquier issue que introduzca o modifique carga, hydration, sync, listeners, procesos bulk, trabajo background o capabilities de runtime → `.agents/skills/skill-performance/SKILL.md`
- Cualquier issue de base de datos → `.agents/skills/skill-database/SKILL.md` + `workflow/context/core/odessay-modelo-datos.md`
- Issues que tocan un feature con doc propio → el doc de `workflow/context/features/` correspondiente
- Issues que tocan tabs, filtros, o navegación interna del editor → `workflow/context/features/odessay-sync.md` + `workflow/context/core/odessay-arquitectura.md`
- Issues con templates visuales reutilizables (emails, PDFs, public pages) → la sección correspondiente de `.agents/skills/skill-design/vistas.md` con el spec canónico citado por anchor (no genérico).
- Issues que tocan AI de corrección ortográfica, streaming de sugerencias o memoria de accept/reject → `workflow/context/features/odessay-ai-writing-assist.md` + `.agents/skills/skill-corrections/SKILL.md` (ambos obligatorios).
- Issues que tocan extensiones de TipTap/ProseMirror, decorations, serializer/parser o round-trip Markdown ↔ JSON → `workflow/context/features/odessay-prosemirror-tiptap.md` (obligatorio).
- Issues que tocan arquitectura del producto, portabilidad web/desktop/mobile, runtime boundaries, servicios compartidos, filesystem local, o el rol de `.md`/`body_json` → citar el subconjunto suficiente de la familia desktop:
  - `workflow/context/features/odessay-desktop-app.md` cuando el issue depende de dirección de producto, objetivos de experiencia o definición del problema desktop.
  - `workflow/context/features/odessay-desktop-migration-diagnostic.md` cuando el issue depende del estado actual del codebase, gaps de migración, diferencias `tauri dev` vs build, save path real o restricciones del runtime vigente.
  - `workflow/context/features/odessay-desktop-target-architecture.md` cuando el issue depende de layering, boundaries, adapters, contracts o arquitectura objetivo.
  - `workflow/context/features/odessay-desktop-migration-plan.md` cuando el issue depende de secuencia de rollout, fases de migración, dependencias o estrategia de transición.
- Issues que tocan clasificación por capas, ownership entre frontend/backend/database, contracts de servicio o boundaries core/adapters → `.agents/skills/skill-architecture/SKILL.md` (obligatorio)

**Regla de conexión de documentos (obligatoria):**
- Si el issue cambia comportamiento de una feature documentada, el brief debe citar explícitamente ese documento en `Reference docs`.
- Si no existe documento de feature para el cambio, el Planning Agent debe crear un sub-issue de documentación o ampliar el issue para incluir la actualización del documento y `workflow/docs.json`.
- No dejar documentos “huérfanos”: todo documento de `workflow/context/features/` debe tener al menos un tipo de issue que lo cite de forma explícita.
- En temas de desktop/arquitectura, el Planning Agent debe poder explicar la ruta de descubrimiento del documento: `prompt/roadmap -> workflow/docs.json -> doc de dirección -> diagnóstico -> target architecture -> migration plan`. Si no puede reconstruir esa ruta, hay riesgo de documento desconectado.
- En temas de arquitectura, el Planning Agent debe poder responder además: `qué capa es`, `qué runtime toca`, `qué contract toca` y `quién es owner`. Si no puede responder eso, el brief todavía no está listo para BUILD.
- Si el issue usa solo una parte de la familia desktop, el brief debe justificarlo implícitamente en su `Architecture Contract`: `Required docs` debe nombrar los docs concretos de los que depende el trabajo. Si el trabajo depende del estado actual del runtime o del save path real, omitir `odessay-desktop-migration-diagnostic.md` es un gap bloqueante.
- Si el issue toca desktop/shared core/runtime boundaries/save/sync/parser/servicios, el brief debe incluir además un bloque explícito `Architecture Contract` con:
  - `Layer`
  - `Runtime scope`
  - `Owner`
  - `Contracts touched`
  - `Invariants`
  - `Required docs`
- Si falta cualquiera de esos campos, el issue no está listo para DEFINE ni para BUILD.

**External references — obligatorias cuando el issue depende de un servicio o protocolo externo:**

Las refs internas del repo no bastan cuando el issue se integra con un proveedor (Supabase, Stripe, Resend, Anthropic, Vercel, GitHub, etc.) o sigue un patrón documentado fuera del repo. La regla general: si BUILD necesitaría buscar en Google para implementar correctamente, ese link debe estar en `Reference docs`.

Categorías de referencia que típicamente caen acá:
- **APIs y SDKs de terceros** — link al endpoint canónico del feature usado, no al landing page genérico. Si hay variantes (server-side vs client-side, SSR vs SPA, App Router vs Pages Router), citar la variante que aplica al stack del repo.
- **Protocolos y standards públicos** — OAuth2, OIDC, JWT, PKCE, OTP, CORS, CSP, RFC específicas. Incluir tanto el RFC como cualquier guía de implementación que el proveedor publique.
- **Convenciones del framework** — patrones de Next.js App Router, React Server Components, Tailwind config, Vercel env handling cuando el issue depende de ellos.
- **Limitaciones documentadas** — quotas, rate limits, plan tiers, feature gates del proveedor que afectan el diseño.

El criterio operativo es simple: BUILD debe poder implementar sin tener que inferir nombres de variables, formas de payload, ni elegir entre patrones equivalentes. Si el brief no cita el link canónico, BUILD invariablemente inventa un patrón aproximado o usa uno obsoleto. Ese costo aparece como rounds extra de REVIEW, no como falla obvia en BUILD.

## Delivery

### Validation — qué evidencia debe exigir el brief

Esta sección no ejecuta validaciones — define qué evidencia debe exigir el brief para que BUILD sepa qué producir y REVIEW sepa qué verificar. Ejecutar los checks, pegar outputs y abrir el PR es de BUILD (ver `workflow/workflow.md`); el schema de qué se exige vive aquí.

Todo brief debe declarar:

- **Proof of work de código:** como mínimo, que `typecheck`, `lint` y `test` deben pasar antes de que el issue avance. No es suficiente que el código compile — el brief exige el output real de lo que corrió, no solo que "compiló".
- **Evidencia de interacción**, si el issue toca funcionalidad interactiva en el browser: qué flujo completo debe quedar recorrido y qué estados (carga, error, edge cases de Requirements) deben quedar verificados. El brief especifica qué debe quedar demostrado, no qué herramienta usar para demostrarlo.
- **Visual / UX Contract**, si aplica (ver §Visual / UX Contract): qué comparación lado-a-lado y qué criterios de paridad enumerados hacen falta como evidencia. "No hay errores en consola" no cubre paridad visual.
- **Performance evidence**, si `skill-performance` está activo: qué artefacto (`ops:perf:gate`, `ops:network:gate`, fixture de escala, evidencia de bundle desktop) prueba la decisión arquitectónica del `Performance Architecture Contract`. El brief declara qué decisión prueba cada artefacto — no todo issue necesita todos los artefactos, solo el que el riesgo real seleccione.
- **Evidencia de base de datos**, si el issue toca schema/RLS: qué verificación de schema y de policies (permite/bloquea según las reglas definidas) debe quedar documentada.
- **Demo de outcome**, para todo issue con comportamiento visible al usuario (ver más abajo).

**El owner de Odessay es no técnico — pero eso no lo saca de la aceptación.** Hay que separar dos cosas que antes estaban colapsadas:

- **Calidad de código:** la prueba el proof of work (typecheck/lint/tests + evidencia). Ejecutarlo y confirmarlo es de BUILD/REVIEW.
- **Aceptación del resultado:** la hace el humano, sobre el *outcome* — si la tabla de Workspace se ve como la de Desk, si Studio lo manda al editor, si el flujo hace lo que el issue prometía —, no sobre el código. Confundir "no puede revisar código" con "no puede aceptar resultados" es lo que dejó shippear mismatches visibles: el código se auto-validaba y nadie con intención de producto miraba el resultado antes de Done.

**Demo de outcome (issues con comportamiento visible al usuario):** el brief debe exigir, además del proof of work de código, evidencia del estado final de cada Requirement (screenshots o recording del flujo real) mostrada **contra la intención declarada**, no contra el código — y debe dejar explícito que el dueño acepta o rechaza sobre ese resultado, no solo sobre que el código corre. Cómo se publica ese demo, dónde se enlaza, y qué transición de estado sigue a un rechazo es protocolo de BUILD/REVIEW (ver `workflow/workflow.md`) — este skill exige que el requisito exista en el brief, no ejecuta la publicación.

Las condiciones verificables que significan Done para el issue quedan en §Definition of Done; esta sección solo define qué evidencia las respalda.

### Definition of Done
Condiciones que deben ser verdaderas para cerrar el issue. Escritas en prosa. Sin checklists.
Deben ser verificables sin ambigüedad.

Ejemplo: El usuario puede crear un writing desde /write, escribir texto, y verificar que
persiste al recargar la página. El auto-save no genera errores en consola. La persistencia
observada coincide con el contrato del runtime que el issue declara explícitamente
(por ejemplo: base local web actual, sync remoto, o write-path desktop).

Para issues con comportamiento visible al usuario, Done exige además la **aceptación de resultado del dueño** sobre el demo de outcome (ver §Validation), no solo el merge. Un issue cuyo código corre pero cuyo resultado el dueño no aceptó NO está Done.

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

La secuencia de issues dentro de una fase se deriva de la topología que el Planning Agent resuelve — capabilities, dependencies, contracts y critical path (ver `.agents/agents/planning-agent.md`) —, no de un orden fijo de capas. Un `smallest coherent stage` puede cruzar capas (database+backend+frontend en el mismo issue) cuando esa es la unidad mínima coherente; forzar la separación por capa cuando la topología real no lo pide fragmenta el trabajo sin necesidad.

Los issues de infra y configuración suelen terminar como `critical-path` porque casi toda otra capability depende de ellos — eso es consecuencia de su posición real en la topología, no una regla de orden que se aplique por default.

Las dependencias se declaran explícitamente en la sección Dependencies de cada issue. Un issue sin dependencias declaradas se asume independiente. Nunca asumir dependencias implícitas — si algo debe existir para que este issue funcione, se declara.

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
Si el team y el proyecto tienen el mismo nombre (`Team: Odessay`, `Project: Odessay`), el nivel de proyecto no agrega ningún significado — es ruido. Con un proyecto por fase, la jerarquía es plana y semánticamente clara: `Team: Odessay → Project: Fase N — <nombre> → Issues`.

### Milestone (dentro de un proyecto, opcional)

Los milestones marcan un **gate interno** dentro de una fase: un punto donde un bloque de trabajo debe estar 100% verificado antes de que el siguiente bloque pueda empezar.

Cuándo usarlos: cuando una fase tiene dos bloques grandes con una dependencia real entre ellos — no una dependencia de issue a issue, sino una dependencia de bloque a bloque. Ejemplo en Fase 6:

```
Milestone: "API lista"       → /api/ai/observe + /api/ai/discuss
Milestone: "Frontend listo"  → panel UI + render de observaciones + context instructions
```

El frontend no debería empezar hasta que la API esté validada. El milestone hace ese gate explícito y visible.

Cuándo NO usarlos: cuando las dependencias entre issues ya dan el orden correcto. En la mayoría de las fases los issues están encadenados por Dependencies — no hace falta un milestone adicional. Añadirlos ahí es ruido.

### Issue (uno por entregable)

La descripción del issue sigue la estructura definida en §Estructura de un issue. El Context del issue explica por qué existe *ese* issue específico — no describe el producto ni la fase.

---

## Cómo usar este skill

### Al crear un issue

Sigue la estructura de descripción definida en este documento. Todo issue debe tener Context, Dependencies, Requirements, Reference docs, Delivery y Notes si aplica. Un issue sin Definition of Done no es un issue.

**Asignación:** el agente crea los issues sin assignee. El humano los asigna. No asignar issues a nombres o usuarios — dejar el campo vacío al crear.

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

Un brief construido sobre un spec que contradice el código propaga el error con consistencia. Si el doc citado afirma algo que el código real ya no hace (o contradice a otro doc, o al spec de Linear), el brief hereda la mentira y BUILD ejecuta impecablemente la cosa equivocada. Consistencia ≠ corrección. Una contradicción detectada es bloqueante: se escala o se reconcilia el contexto primero (ver §Verificación de definición). No se promedia ni se elige una versión por inercia.

Un issue de UI sin `Visual / UX Contract` está incompleto. "Se ve como Desk" no es una intención implícita que BUILD pueda adivinar y REVIEW pueda verificar. Sin referencia visual nombrada y criterio de paridad enumerado, el resultado pasa todos los checks técnicos y aun así no coincide. Ver §Visual / UX Contract.

Un issue visible cerrado solo con proof of work de código no está aceptado. Typecheck/lint/tests verdes prueban que el código corre, no que el resultado es el correcto. Si el dueño no aceptó el demo de outcome, el issue no está Done aunque el PR esté mergeado. Ver §Validation — Demo de outcome.

Un brief que no pasó por los skills de su scope es un brief sin revisar. Que el Planning Agent conozca las reglas de frontend no sustituye cargar `skill-frontend` y confrontar el brief contra sus invariantes — el precedente ODE-338 demuestra que las reglas escritas no protegen si nadie las invoca. Ver §Revisión por skills de dominio.

Un issue con operaciones async sin sección Failure modes shippea el happy path. Los bugs de carrera, estados colgados y optimistic updates sin rollback no los atrapa ningún checklist de código — solo se previenen si el brief los definió. Ver §Failure modes.
