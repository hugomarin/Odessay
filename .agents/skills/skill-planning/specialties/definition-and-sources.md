# Definición, fuentes y coordinación de issues en Odessay

Este recurso describe decisiones y convenciones vigentes de Odessay para este skill. AGENTS.md y los contratos aceptados conservan la precedencia normativa.

Planning tiene tres funciones. Primera, definir cómo se define y endurece cada issue para que sea completamente ejecutable por un agente de código o legible por un humano sin ambigüedad. Segunda, establecer qué debe contener cada tipo de contrato (`Architecture`, `Performance`, `Visual/UX`) y cuándo es obligatorio. Tercera —y la que falla cuando un trabajo se ejecuta impecablemente y aun así sale mal— **garantizar que la definición sobre la que se construye el brief es verdadera** (reconciliada con el código, no solo internamente consistente) **y que el resultado entregado fue aceptado por el dueño** contra su intención. Sin la tercera función, las dos primeras producen ejecución perfecta de la cosa equivocada.

La orquestación de la fase — topología, secuenciación, critical path, síntesis — vive en `.agents/agents/planning-agent.md`. Este skill no la repite: endurece cada nodo de esa topología en un Issue Brief ejecutable.

El alcance específico del proyecto — fases e issues macro — vive en `workflow/define/roadmap.md`. Lee ese documento antes de crear issues.

Planning define **qué** debe existir en cada issue y con qué calidad. La persistencia en Linear — crear y gestionar proyecto e issues — es ownership de `wf-define` (ver `workflow/workflow.md`). La estructura, los labels y la asignación local están en [linear-conventions.md](linear-conventions.md).

Si la fase ya tiene roadmap y DoD, Planning se usa para convertir esa definición en planeación táctica de issues. No debe reabrir la estrategia de fase salvo que detecte una asimetría real entre roadmap y DoD.

Cuando el issue deje de ser solo producto/scope y pase a involucrar runtime boundaries, shared core, save path, sync, parser/serializer o extracción de servicios, cargar también `.agents/skills/skill-architecture/SKILL.md`.

Cuando el issue introduzca datos, fetches, hydration, listeners, componentes en caminos críticos, procesos bulk, trabajo background o una capability de runtime, cargar también `.agents/skills/skill-performance/SKILL.md` antes de cerrar el brief.

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

el Planning Agent debe clasificar el contrato afectado con `AGENTS.md` y la especialidad local de Architecture. Carga el ADR de identidad si hay identidad, contenido, metadata o lifecycle documental; añade el spec del catálogo si hay catálogo, reconciliación, apertura o save/sync desktop. Los documentos de dirección, diagnóstico, target architecture y migration plan responden preguntas de producto, estado vigente, diseño objetivo o secuencia de transición, respectivamente.

Cómo llegar ahí:

- primero consultar `workflow/docs.json` para ubicar el documento correcto y confirmar que existe en el inventario canónico
- luego citar explícitamente en `Reference docs` las fuentes que realmente condicionan el issue y su precedencia

Regla:

- si un issue cambia arquitectura, contratos, runtime boundaries, documento canónico o secuencia de migración, el brief no puede quedarse solo con docs técnicos locales del feature; debe incluir el doc desktop correspondiente
- si el prompt menciona desktop de forma estratégica, el Planning Agent identifica las decisiones relevantes y cita la fuente que las posee
- si además el issue cruza frontend/backend/database, el Planning Agent debe usar `skill-architecture` para clasificar ownership y boundaries antes de cerrar el brief

---

## Verificación de definición — antes de escribir el brief

El resto del skill da por hecho que los docs que el brief cita son verdaderos. **No lo asumas.** El modo de falla más caro de Odessay no es un brief ambiguo: es un brief perfecto construido sobre una definición stale, que BUILD ejecuta impecablemente y produce *la cosa equivocada con toda consistencia*. Antes de citar cualquier doc como contrato del issue, verifícalo.

### Regla rectora: consistencia ≠ corrección

Que un doc sea internamente coherente, o que coincida con otros docs, **no** lo hace correcto. Un error repetido en tres docs sigue siendo un error. La definición se valida contra **el código real** y **la intención del producto**, no contra "así estaba escrito".

### Qué verificar (por cada doc que el brief va a citar como contrato)

1. **docs ↔ code.** Identificar si cada afirmación clave describe el estado actual o el contrato objetivo y contrastarla con el código pertinente. Abrir el archivo o función que el doc nombra. Una diferencia entre objetivo y código actual puede ser el trabajo de una migración; el brief debe declararla y asignarle owner. Ejemplo real: un doc decía "`body_json` es la fuente de verdad" mientras la dirección del producto era `.md` canónico — un brief que lo citara sin distinguir estado y destino habría pedido lo contrario de lo correcto.
2. **docs ↔ docs.** ¿El doc contradice a otro doc del corpus, o a un skill? Si dos fuentes se contradicen, **no promedies** ni elijas una por inercia.
3. **docs ↔ Linear.** ¿El spec del issue en Linear contradice lo que dice el doc, o lo que hace el código?
4. **¿El doc es normativo por delante del código?** Algunos docs describen el *destino*, no el runtime actual (p. ej. el corpus de identidad de documento reconciliado por su ADR). Si es así, el brief debe **marcar qué partes son destino vs. estado actual**, para que BUILD no implemente el destino prematuramente ni lea el doc como descripción del runtime vigente.

### Qué hacer cuando hay contradicción

Clasificar la diferencia según la precedencia de `AGENTS.md`:

- **Estado actual frente a objetivo aceptado:** registrar el comportamiento observado como `legacy-code`. Si el issue posee esa migración, expresar alcance, transición, rollback y evidencia en el brief; la diferencia queda reconocida y el issue puede avanzar. Si otro issue posee la migración, registrar el seguimiento y mantener el cambio actual dentro del contrato aceptado.
- **Premisa documental falsa o brief incompleto:** registrar `stale-doc` o `incomplete-brief` con la conducta y fuente precisas. Resolver la premisa o completar el contrato antes de declarar el brief listo.
- **Fuentes normativas incompatibles:** registrar `normative-conflict` y escalar al dueño antes de cerrar la definición. El ADR de identidad `workflow/context/core/odessay-adr-identidad.md` es un precedente de reconciliación formal.

Una contradicción normativa sin resolver bloquea la definición. El brief explicita la diferencia objetivo↔estado actual de una migración autorizada para que BUILD implemente el contrato esperado con sus precondiciones.

### Salida obligatoria

El campo `Definition check` de la `Execution Trace` registra `docs↔code↔linear = consistente`, `legacy-code reconocido (migración declarada): <diferencia y owner>` o `contradicción detectada (bloquea): <fuentes y decisión pendiente>`. Un brief queda listo cuando las premisas son consistentes o la diferencia entre código actual y objetivo aceptado pertenece explícitamente a su migración. El campo no puede quedar vacío.

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
| Cambio de ownership, contrato, fuente de verdad, runtime o boundary, incluido el trabajo desktop o multi-runtime que afecta esas decisiones | `skill-architecture` |
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

## Cómo secuenciar issues

La secuencia de issues dentro de una fase se deriva de la topología que el Planning Agent resuelve — capabilities, dependencies, contracts y critical path (ver `.agents/agents/planning-agent.md`) —, no de un orden fijo de capas. Un `smallest coherent stage` puede cruzar capas (database+backend+frontend en el mismo issue) cuando esa es la unidad mínima coherente; forzar la separación por capa cuando la topología real no lo pide fragmenta el trabajo sin necesidad.

Los issues de infra y configuración suelen terminar como `critical-path` porque casi toda otra capability depende de ellos — eso es consecuencia de su posición real en la topología, no una regla de orden que se aplique por default.

Las dependencias se declaran explícitamente en la sección Dependencies de cada issue. Un issue sin dependencias declaradas se asume independiente. Nunca asumir dependencias implícitas — si algo debe existir para que este issue funcione, se declara.

---

## Cómo usar este recurso

Al crear o revisar un issue, seguir los campos de [issue-brief-schema.md](issue-brief-schema.md): Context, Dependencies, Requirements, Reference docs, Delivery y Notes si aplica. Un issue sin Definition of Done está incompleto.

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

Un brief identifica si el spec citado describe el estado actual o el objetivo aceptado. Una afirmación desactualizada que el brief trata como premisa vigente requiere reconciliación; una diferencia `legacy-code` con migración declarada requiere alcance, transición, rollback y evidencia. Una contradicción entre fuentes normativas sigue bloqueada hasta que el dueño la resuelva (ver §Verificación de definición).

Un issue de UI sin `Visual / UX Contract` está incompleto. "Se ve como Desk" no es una intención implícita que BUILD pueda adivinar y REVIEW pueda verificar. Sin referencia visual nombrada y criterio de paridad enumerado, el resultado pasa todos los checks técnicos y aun así no coincide. Ver [issue-brief-schema.md](issue-brief-schema.md), sección `Visual / UX Contract`.

Un issue visible cerrado solo con proof of work de código no está aceptado. Typecheck/lint/tests verdes prueban que el código corre, no que el resultado es el correcto. Si el dueño no aceptó el demo de outcome, el issue no está Done aunque el PR esté mergeado. Ver [issue-brief-schema.md](issue-brief-schema.md), sección `Validation`.

Un brief que no pasó por los skills de su scope es un brief sin revisar. Que el Planning Agent conozca las reglas de frontend no sustituye cargar `skill-frontend` y confrontar el brief contra sus invariantes — el precedente ODE-338 demuestra que las reglas escritas no protegen si nadie las invoca. Ver §Revisión por skills de dominio.

Un issue con operaciones async sin sección Failure modes shippea el happy path. Los bugs de carrera, estados colgados y optimistic updates sin rollback no los atrapa ningún checklist de código — solo se previenen si el brief los definió. Ver [issue-brief-schema.md](issue-brief-schema.md), sección `Failure modes`.
