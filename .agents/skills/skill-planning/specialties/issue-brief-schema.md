# Schema de Issue Brief y Execution Trace de Odessay

Este recurso describe decisiones y convenciones vigentes de Odessay para este skill. AGENTS.md y los contratos aceptados conservan la precedencia normativa.

## Execution Trace — schema

Toda salida cerrada de `wf-define` debe incluir esta `Execution Trace` — **una por ejecución de `wf-define`, no una por issue**: la fase puede generar varios issues en una sola corrida, y todos comparten la misma traza de cómo se planificó la fase. Un solo canonical owner del schema: este skill lo define porque forma parte de la calidad de la definición. El `Planning Agent` la produce; `wf-define` solo verifica que exista antes de cerrar — ninguno de los dos repite el schema completo.

- `Planning role`: rol efectivamente usado
- `Skills loaded`: skills realmente cargados, no skills meramente disponibles
- `Specialist consults`: consultas explícitas a frontend/backend/database/ux u otros
- `Skill reviews` — veredicto por cada skill de dominio del scope: `sin objeciones` u `objeciones resueltas: <lista>` (ver §Revisión por skills de dominio). No se puede cerrar una definición con este campo vacío si el scope activó al menos un skill.
- `Audit run` — si se ejecutó `skill-audit-planning`, y sobre qué artefactos.
- `Definition check` — resultado de la verificación de definición (ver §Verificación de definición): `docs↔code↔linear = consistente`, `legacy-code reconocido (migración declarada): <diferencia y owner>` o `contradicción detectada (bloquea): <fuentes y decisión pendiente>`. No se puede cerrar una definición con este campo vacío ni con una contradicción normativa abierta.
- `Artifacts created`: proyecto/issues/comentarios/documentos persistidos
- `Why`: justificación corta de por qué esos skills/consultas fueron suficientes

El objetivo no es verbosear el razonamiento interno, sino dejar trazabilidad operativa verificable.

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

Esta lista no termina en el brief: `.agents/skills/architecture-recon/SKILL.md` la confirma contra el código real antes de implementar (BUILD), y `.agents/skills/skill-code-review/references/architecture.md` verifica que los consumers efectivamente dependen del owner declarado, no de una copia paralela (REVIEW). Un consumer que el brief omitió es la causa más común de un finding `[P0]`/`[P1]` de arquitectura.

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

Este campo no es solo autochequeo: es el contrato que `.agents/skills/skill-code-review/references/correctness.md` verifica en `/wf-review` (transición co-owned, estado intermedio no modelado, identidad creada en hot path, update optimista sin rollback, colapso de colección sobre output de LLM). Un brief que responde bien estas cuatro preguntas reduce directamente los findings de esa lente.

## Validation requirements

Por cada Requirement/Failure mode declarado arriba, elegir el **nivel mínimo de evidencia que pueda falsificarlo** — no el nivel que "se usa normalmente". La taxonomía (unit / contract / integration / E2E / performance) y el principio rector ("test at the lowest-cost boundary that can falsify the failure mode we care about") viven en `workflow/testing/critical-capabilities-testing.md`; este campo no los repite, los aplica.

Formato: por cada propiedad crítica del issue, una línea `<qué se falsifica> → <nivel elegido>`. E2E y Performance no son el default — cuando se seleccionan, la línea debe justificar por qué el nivel inferior no basta (qué failure mode real requiere browser, o qué hot path requiere un Performance Contract). "Hagamos E2E para estar seguros" no es una justificación válida.

Ejemplo:

```text
- Export a DOCX no corrompe Unicode → contract test sobre el adapter, sin UI.
- Modal de reasignación de Workspace se cierra correctamente tras confirmar → E2E — el failure mode es choreography de foco/cierre que un test bajo el componente no modela razonablemente.
```

`.agents/skills/skill-code-review/references/testing.md` verifica en `/wf-review` que la evidencia entregada corresponde al nivel declarado aquí, y que toda escalada a E2E/performance vino con justificación — no exige Playwright por defecto.

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
- Si el issue afecta el contrato documental desktop, shared core o runtime boundaries, seleccionar ADR, catálogo y documentos de apoyo según `AGENTS.md`; esas fuentes fijan la autoridad antes que un baseline web/Supabase-first.
- `Reference docs` no se valida por "trae los cuatro docs" sino por suficiencia contractual: debe incluir exactamente los documentos que BUILD necesita para ejecutar sin inferir arquitectura desde el código.

**Qué incluir según el tipo de issue:**
- Cualquier issue con UI → `.agents/skills/skill-design/SKILL.md`; para vistas de producto, añadir `.agents/skills/skill-design/vistas.md`, y para marketing, `.agents/skills/skill-design/specialties/marketing-system.md` y, si toca la landing, `marketing-page.md`.
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
- Issues que tocan arquitectura del producto, portabilidad web/desktop/mobile, runtime boundaries, servicios compartidos, filesystem local, o el rol de `.md`/`body_json` → aplicar primero la precedencia de `AGENTS.md`: ADR de identidad y, si hay operación del catálogo desktop, spec del catálogo. Añadir el subconjunto de documentos de apoyo que responda la pregunta:
  - `workflow/context/features/odessay-desktop-app.md` cuando el issue depende de dirección de producto, objetivos de experiencia o definición del problema desktop.
  - `workflow/context/features/odessay-desktop-migration-diagnostic.md` cuando el issue depende del estado actual del codebase, gaps de migración, diferencias `tauri dev` vs build, save path real o restricciones del runtime vigente.
  - `workflow/context/features/odessay-desktop-target-architecture.md` cuando el issue depende de layering, boundaries, adapters, contracts o arquitectura objetivo.
  - `workflow/context/features/odessay-desktop-migration-plan.md` cuando el issue depende de secuencia de rollout, fases de migración, dependencias o estrategia de transición.
- Issues que tocan clasificación por capas, ownership entre frontend/backend/database, contracts de servicio o boundaries core/adapters → `.agents/skills/skill-architecture/SKILL.md` (obligatorio)

**Regla de conexión de documentos (obligatoria):**
- Si el issue cambia comportamiento de una feature documentada, el brief debe citar explícitamente ese documento en `Reference docs`.
- Si no existe documento de feature para el cambio, el Planning Agent debe crear un sub-issue de documentación o ampliar el issue para incluir la actualización del documento y `workflow/docs.json`.
- No dejar documentos “huérfanos”: todo documento de `workflow/context/features/` debe tener al menos un tipo de issue que lo cite de forma explícita.
- En temas de desktop/arquitectura, el Planning Agent debe poder explicar la ruta de descubrimiento: `prompt/roadmap -> workflow/docs.json -> fuente normativa por contrato -> documentos de apoyo por pregunta`. La explicación incluye la precedencia entre ADR, spec del catálogo y estado observado.
- En temas de arquitectura, el Planning Agent debe poder responder además: `qué capa es`, `qué runtime toca`, `qué contract toca` y `quién es owner`. Si no puede responder eso, el brief todavía no está listo para BUILD.
- `Required docs` debe nombrar las fuentes concretas de las que depende el trabajo. Si depende del estado actual del runtime, incluir el diagnóstico vigente; si afecta el contrato de save desktop, incluir el ADR y el spec del catálogo.
- Si el issue modifica ownership, contratos, fuente de verdad, runtime o boundaries —incluido el trabajo desktop/shared core/save/sync/parser/servicios que afecta esas decisiones—, el brief debe incluir además un bloque explícito `Architecture Contract` con:
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
