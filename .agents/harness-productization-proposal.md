# Propuesta conceptual: productizar el harness de `.agents`

Estado: propuesta conceptual con migración editorial aplicada a los 12 `SKILL.md` operativos. Code Review posee cuatro lentes como referencias temáticas; Architecture, Recon, Planning, Audit Planning, Frontend, Backend, Database y UX Testing separan método y especialidad local. Performance usa referencias existentes. Corrections y Design conservan conocimiento tailor-made con la misma estructura editorial; Design selecciona entre producto y marketing. Roles, workflow y checks conservan sus responsabilidades.

## Tesis

El producto portable es un **método de investigación y entrega con puntos de extensión explícitos**. Solicita conocimiento local y evidencia antes de actuar. Su profundidad surge de la composición de cuatro clases de autoridad:

1. **Método**: preguntas, orden de investigación, criterios de activación, forma de la evidencia y condiciones de parada. Viaja entre repositorios.
2. **Conocimiento técnico reusable**: failure modes y criterios ligados a una tecnología o clase de problema (Tauri, ProseMirror, RLS, migraciones, transiciones async). Viaja solo cuando esa capacidad existe y requiere versionado y verificación contextual.
3. **Contrato del proyecto**: decisiones normativas, fuentes de verdad, owners, rutas, vocabulario, valores visuales, presupuestos y excepciones. El equipo lo construye deliberadamente para cada repo y lo verifica frente a sus fuentes de autoridad.
4. **Mecanismo**: scripts, tests, schemas, linters, gates y sus presupuestos. Puede ser portable como código, pero su instalación, fixtures, umbrales y callers son locales. El método decide cuándo invocarlo; el mecanismo produce evidencia.

Una quinta pieza es la **orquestación**: roles, comandos, handoffs, tracker, PR y estados. Coordina cómo se aplican los skills. En Odessay sus owners son `.agents/agents`, `workflow/agents.md` y `workflow/workflow.md`; cada `SKILL.md` referencia ese plano cuando lo necesita.

La regla de diseño es: **separar por autoridad y condición de cambio**. Un párrafo que mezcla una regla general con un path local se divide según quién decide cada parte y cuándo cambia.

La regla editorial es: **definir primero qué es y qué hace cada concepto**. Después, cuando exista una confusión plausible, añadir una frontera o exclusión que afine esa definición. Esto aplica a los `SKILL.md`, sus artefactos asociados y la propia documentación del producto.

### Ejemplo de definición positiva

> **Architecture Recon** investiga dónde vive hoy una responsabilidad en el código y qué puede reutilizarse. Identifica al owner actual, las APIs disponibles, los módulos relacionados, sus consumidores y sus pruebas. Confronta esa evidencia con el contrato esperado para delimitar el cambio o señalar una ambigüedad antes de implementar.

**Ejemplo de aplicación en Odessay:** ante una tarea que modifica la persistencia de bloques de corrección, Recon encuentra `lib/corrections/persistence.ts` y su API `persistCorrectionBlockRemotely`, identifica a `components/editor/editor-shell.tsx` como consumidor y consulta `tests/lib/corrections/persistence-lifecycle.test.ts` junto con `components/editor/AGENTS.md`. Esa evidencia permite proponer el cambio en el owner de persistencia y el cableado correspondiente en el editor. Si aparecen dos owners plausibles, el resultado señala la ambigüedad para resolverla antes de implementar.

La definición describe primero la función del método; el ejemplo muestra cómo produce una decisión verificable. La distinción con Architecture se añade cuando la tarea la requiere: Architecture fija el contrato esperado y Recon lo confronta con el código vigente.

## Evidencia del sistema actual

| Caso | Núcleo que puede viajar | Conocimiento que debe quedar local o condicionado | Mezcla observada |
| --- | --- | --- | --- |
| `architecture-recon/SKILL.md` | Buscar owner, API reusable, siblings, consumers y tests antes de crear; clasificar `canonical/legacy/duplicate`; parar ante ambigüedad material (§Investigar, §Stop condition). | Hotspots `editor-shell.tsx` y `src-tauri/src/commands/index.rs`; subtrees con `AGENTS.md`; persistencia de hallazgos en Linear (§Cuándo activar, §Investigar, §Persistencia). | Método de recon, routing de docs y protocolo del tracker en un mismo cuerpo. Es el mejor candidato para un primer piloto. |
| `skill-architecture/SKILL.md` | Ejes `Layer / Runtime scope / Owner`, preguntas por capa, boundaries, invariantes y formato de classification (§Taxonomía, §Heurística, §Output). | Precedencia ADR de identidad → catálogo desktop, lista de servicios, documentos `odessay-desktop-*`, reglas concretas de `.md`, SQLite, Supabase (§inicio, §Paso 1, §Adapter). | La metodología de clasificación está entrelazada con una arquitectura ya decidida. `AGENTS.md` raíz es la autoridad normativa del contrato desktop. |
| `skill-planning/SKILL.md` y `skill-audit-planning/SKILL.md` | Definir requirements verificables, failure modes, consumers, evidencia proporcional; auditar cobertura, solapamientos, dependencias y huecos. | Fases de `workflow/define/roadmap.md`, DoD, `docs.json`, jerarquía y labels de Linear, check `CI required`, nombres de contratos y rutas de Odessay. | El primero contiene tanto criterio de buen brief como schema extenso y política operativa de Linear; el segundo acopla la auditoría al estado y archivos concretos del workflow. |
| `skill-code-review/SKILL.md` y antiguas lentes `review-*` | Leer diff/owner/call sites, activar criterios por riesgo, exigir path de falla concreto y evidencia de tests; distinguir `TechnicalVerdict` de gate de entrega. | Baseline TypeScript y BEM, reglas visuales, rutas de docs, catálogo de capabilities, checklist de DMG. | El review tiene un solo skill; sus lentes viven en `references/`, los criterios locales en `specialties/` y la puntuación en `scoring.md`. |
| `skill-performance/SKILL.md` + `references/` | Modelar unidad de escala, camino crítico, fan-out, estrategias de carga y evidencia proporcional. | Inventario de scripts, budgets, escenario del editor, capabilities y distribución desktop. | Ya hay un ejemplo local de separación conceptual: `references/instruments.md` conserva routing sin mover scripts. `desktop-runtime-evidence.md` contiene conocimiento Tauri reusable y datos que debe aportar el proyecto. |
| `skill-frontend/SKILL.md` | Aislar interacción caliente, modelar transiciones y salidas de error, distinguir lista/detalle, revisar hidratación y consumidores. | Next 15/React 19/TipTap/TanStack/Zustand, rutas `/write` y `/preview`, mapa de IDs, reglas de estado del editor y de Odessay. | Su razonamiento de transiciones se conecta con la referencia de corrección de Code Review y con la especialidad de correcciones. |
| `skill-backend/SKILL.md` y `skill-database/SKILL.md` | Diseño de APIs, fallos, idempotencia, migraciones, RLS y validación de queries como clases de problema. | Contrato concreto de Supabase, tablas `writings`, triggers, AI provider, endpoints, variables de entorno, staging. | Contienen recetas tecnológicas útiles, pero también afirmaciones sobre schema y proveedor que no deben pasar a otro repo como defaults. |
| `skill-corrections/SKILL.md` | Patrones generalizables: identidad ≠ ubicación, admisión única, estados con salida, degradación por item de LLM. | Fingerprint exacto, `learned_words`, `pending-stale` ~10 s, rutas/tests, historia de hallazgos C1–C10 y contrato funcional de Odessay. | No debe vaciarse en un `corrections.yaml`: es conocimiento experto de un subsistema. Conviene conservar una especialidad tailor-made con enlaces a patrones técnicos compartidos. |
| `skill-design/SKILL.md`, `tipografia.md`, `vistas.md`, `specialties/marketing-*.md` | Método para derivar tokens, comprobar paridad visual y seleccionar el sistema por superficie. | Filosofía de marca, DM Sans/Lora/Newsreader, valores, vistas, prototipos, `artifact`, reglas editor/lectura y marketing. | El sistema visual es deliberadamente local. Producto y marketing son especialidades de un skill; los 889 renglones de `vistas.md` son especificación de vistas, no un skill portable. |
| `skill-ux-testing/SKILL.md` | Criterios de aceptación, recorrido completo, evidencia observable, reutilización de harness y elección del nivel de prueba. | Seis flujos críticos de Odessay, rutas, Playwright catalog, staging y presentación cross-mode. | Método de validación, catálogo de journeys y herramienta específica aparecen juntos. |

Los roles actuales ya articulan parte de la frontera: `planning-agent.md` diseña topología y delega el schema del brief a `skill-planning`; `build-agent.md` ejecuta Recon; `review-agent.md` activa lentes. `workflow/workflow.md` posee gates, merge y ledgers. Esta separación debe preservarse al productizar, evitando un segundo owner operativo dentro de los skills.

## Aprendizajes de la referencia

En `skills.zip`, `architecture/SKILL.md` mantiene el razonamiento de clasificación y registra `specialties/runtimes.md`, `catalogo-de-servicios.md` y `fuente-de-verdad.md`; `frontend/SKILL.md` remite a `specialties/stack.md` e `ids-de-componentes.md`; `design-ux/SKILL.md` separa tokens, tipografía, layout e iconografía. Esa **lectura selectiva por pregunta** sí es valiosa. `pm-planning/reference/` distingue flujos, templates y rúbrica; `skill-code-review/specialists/` empaqueta lentes para dispatch opcional. También es útil que una specialty declare `belongs-to`, fuente y fecha de verificación.

La referencia demuestra límites de esa separación. `skill-code-review/SKILL.md` todavía incluye el flujo de PR, el gate `Django CI`, comandos, política de fallback y reglas de integridad financiera. `architecture/specialties/runtimes.md` mezcla inventario vigente con una narrativa histórica de despliegue. Una carpeta `specialties/` no garantiza fronteras de autoridad por sí sola. Tampoco adoptaría `specialists/` como sinónimo de conocimiento: en la referencia son en parte **contratos de ejecución para otros agentes**; una lente debe funcionar aunque no haya subagentes.

## Modelo de componentes propuesto

```text
fuente del harness portable (versionada)
├── skills/<nombre>/SKILL.md     # un entrypoint por skill; método o lente
├── knowledge/technology/        # guías técnicas activadas por capacidad
├── contracts/                   # formatos de salida y schemas estructurales
└── adapters/                    # integración con herramientas y entornos

repo consumidor
├── .agents/skills/<nombre>/SKILL.md       # entrypoint instalado
├── .agents/skills/<nombre>/specialties/   # vínculo con decisiones locales, si aplica
├── AGENTS.md                    # guardrails y precedencia locales
├── workflow/ y docs existentes  # ADRs, specs, roles, gates y fuentes normativas
└── scripts/ tests/ ...          # mecanismos y fixtures en rutas usadas por sus callers
```

Este árbol representa **qué responsabilidad posee cada componente**. `methods` y `lenses` son tipos de skill, no dos ubicaciones ejecutables adicionales. El `SKILL.md` instalado es el único entrypoint de esa responsabilidad en el repo; la fuente versionada es su origen de distribución. El equipo actualiza el método en el paquete y expresa decisiones propias del repo en sus fuentes locales. La instalación conserva el nombre y el path que consumen roles y workflow, o actualiza esos consumidores explícitamente en la misma migración.

Cada repo fija una versión del paquete. Una actualización cambia esa versión, revisa el diff del método, valida que sus bindings locales sigan resolviendo y repite las tareas de regresión del piloto. Los cambios tailor-made se editan en sus fuentes locales, de modo que la actualización del paquete puede reemplazar el skill instalado sin sobrescribir decisiones del proyecto.

El binding es una **capacidad de descubrimiento**, no un archivo obligatorio: relaciona una necesidad del skill con el ADR, `AGENTS.md`, spec, diseño o instrumento que ya posee la respuesta. Cuando el vínculo necesita texto propio, vive junto al skill en `specialties/` y enlaza las fuentes normativas existentes. Así el empaquetado añade descubribilidad sin crear un segundo contrato de identidad, diseño o entrega.

La ubicación definitiva de directorios auxiliares se decide durante el packaging. `references/`, `specialties/`, `specialists/`, `scripts/`, `checks/` y `schemas/` tienen estas funciones:

| Artefacto | Función principal | Frontera para desambiguar |
| --- | --- | --- |
| `SKILL.md` / método | Guía la activación, el análisis, la evidencia y la salida de una responsabilidad. | Los inventarios extensos y decisiones particulares se enlazan desde sus fuentes locales. |
| `references/` | Explica conceptos, ejemplos y procedimientos de consulta. | Las decisiones normativas conservan su owner original; la referencia las cita. |
| `technology/` o `specialties/` reusable | Aporta heurísticas verificadas para una tecnología o clase de fallo, con versión y entorno de aplicación. | El proyecto declara su configuración efectiva antes de aplicar esas heurísticas. |
| `project/` o specialty local | Vincula cada necesidad del skill con la fuente vigente; declara decisiones nuevas cuando todavía no existe un owner local. | ADRs, `AGENTS.md`, specs y diseño conservan la autoridad que ya tienen. |
| `lenses/` | Formula preguntas de review y condiciones de activación. | Puede ejecutarla el agente principal o un worker especializado. |
| `specialists/` | Adapta una lente a la ejecución y formato de un worker especializado. | La lente conserva la autoridad técnica. |
| `contracts/` y `schemas/` | Define campos obligatorios, valida estructura y conecta outputs. | La verdad semántica de una decisión requiere fuentes y revisión. |
| `checks/` / scripts | Ejecuta reglas deterministas y captura evidencia. | El método interpreta el resultado frente a la intención y el contrato. |

Todos los `SKILL.md` sí deben compartir la **misma estructura editorial y el mismo orden**. Lo que varía es el contenido y la profundidad de cada sección. Las carpetas auxiliares pueden variar: para un skill pequeño bastan el `SKILL.md` y sus enlaces. El paquete portable debe ofrecer **interfaces de conocimiento requerido**, no una gran configuración universal. Ejemplo: Architecture Recon requiere que el repo pueda responder `owners`, `hotspots` y `scoped instructions` cuando el cambio lo activa; si falta un owner, investiga y reporta incertidumbre. No genera una arquitectura por default.

### Contrato editorial único para cada `SKILL.md`

Esta plantilla aplica por igual a métodos, lentes y skills de dominio. Cada sección empieza describiendo su función o conducta positiva. Los encabezados y su orden se mantienen incluso cuando una sección se resuelve en una sola línea. Cuando una sección carece de contenido aplicable, se declara el motivo brevemente.

```markdown
---
name: <identificador>
description: <qué hace y cuándo usarlo, breve>
---

# <Nombre del skill>

## 1. Objetivo
## 2. Ámbito y activación
## 3. Entradas y fuentes de autoridad
## 4. Método y criterios
## 5. Resultado y evidencia
## 6. Manejo de fallos e incertidumbre
## 7. Relaciones y ownership
## 8. Recursos asociados
```

| Sección fija | Pregunta que responde |
| --- | --- |
| Objetivo | ¿Qué responsabilidad resuelve este skill y qué decisión ayuda a tomar? |
| Ámbito y activación | ¿En qué cambios aporta su criterio y qué señales lo activan? Las exclusiones aclaran casos cercanos que podrían confundirse. |
| Entradas y fuentes de autoridad | ¿Qué necesita leer y qué fuente prevalece si hay discrepancia? Los paths concretos del repo se enlazan, no se convierten en reglas portables. |
| Método y criterios | ¿Qué secuencia, preguntas, invariantes o heurísticas aplica? Puede ser procedimiento o criterio declarativo según el skill. |
| Resultado y evidencia | ¿Qué entrega, con qué formato y qué evidencia lo hace verificable? |
| Manejo de fallos e incertidumbre | ¿Cómo responde ante evidencia insuficiente, contradicción o fallo y cuándo escala? |
| Relaciones y ownership | ¿Qué responsabilidad posee, cuáles consume y cómo se coordina con roles, skills y workflow? |
| Recursos asociados | Para cada recurso que el skill use: ¿cuándo se carga, qué aporta, cómo se aplica a la decisión y qué fuente conserva la autoridad? La ausencia de recursos se explica brevemente. |

La plantilla hace comparables los skills, permite detectar secciones ausentes y habilita un validador estructural sencillo. Cada skill incorpora los recursos auxiliares que su función requiere: diseño puede usar especialidades visuales; Recon puede limitarse a fuentes de arquitectura. Los contratos locales extensos permanecen en sus fuentes normativas; el apartado 3 explica su precedencia y el 8 indica qué artefacto cargar, en qué situación y cómo usarlo. El nombre de una carpeta por sí solo no constituye una instrucción de uso.

El frontmatter `name`/`description` pertenece a cada `SKILL.md` operativo, porque permite descubrir y activar el skill. Sus documentos auxiliares se identifican por título y por la ruta que el `SKILL.md` selecciona; solo necesitan frontmatter si un mecanismo concreto consume metadatos estructurados como versión, fuente o fecha de verificación. Las ocho secciones comunes rigen los `SKILL.md`; cada recurso organiza su contenido según la consulta que resuelve.

### Ejemplo de composición: Architecture Recon en Odessay

| Pregunta en una tarea de BUILD | Fuente propuesta | Resultado |
| --- | --- | --- |
| ¿Hay que hacer Recon? | `methods/architecture-recon` decide por riesgo de ownership y cambio no trivial. | Se activa antes de escribir código. |
| ¿Cómo investigar? | El mismo método exige búsqueda por concepto, API existente, siblings, consumers, tests y clasificación. | Un output temporal con rutas y evidencia. |
| ¿Qué es autoridad en este repo? | `AGENTS.md` y el binding local de arquitectura apuntan al ADR de identidad y al catálogo desktop según scope. | El código observado se confronta con el contrato, sin reemplazarlo. |
| ¿Qué hotspot o instrucción scoped aplica? | Inventario local de owners/hotspots y `AGENTS.md` del subtree. | `editor-shell.tsx` queda como wiring si ese es el cambio. |
| ¿Hay riesgo Tauri? | Guía tecnológica Tauri, activada solo si el runtime aplica, más contrato local de bundle/capabilities. | Evidencia de `tauri dev` y del bundle según el riesgo declarado. |
| ¿Se puede probar mecánicamente? | Instrumento registrado por el repo en `references/instruments.md` o un check de boundaries. | El output del check complementa el juicio de Recon. |

Esta composición conserva el valor específico de Odessay sin enseñar al método portable que `editor-shell.tsx`, `.md` o SQLite existan en todos los proyectos.

## Cómo entra el conocimiento tailor-made

1. **Intake del repo**: identificar sus productos, runtimes, dependencias, fuentes de verdad, roles de servicio, vías de despliegue, CI, tracker y principales flujos. Distinguir decisiones normativas de estado observado y deuda legacy.
2. **Mapa de autoridad**: cada regla local declara `scope`, `source`, `owner`, `precedence`, `last_verified` cuando es factual, y `enforcement` (`manual`, test, script o CI). Una decisión normativa apunta al ADR existente cuando este ya la posee. Un path de código aporta evidencia que se vuelve a verificar.
3. **Binding explícito**: los entrypoints seleccionan qué fuentes locales y guías tecnológicas cargar según el cambio. La selección por riesgo/scope se mantiene en el método; el binding local resuelve las fuentes concretas del repo y registra la precedencia entre ellas.
4. **Prueba con tareas reales**: ejecutar retrospectivamente un cambio de planning, uno de BUILD y uno de review. Ver si el sistema encuentra owner, cita autoridad, escoge evidencia y detecta contradicciones sin cargar todo el repositorio.
5. **Learning loop**: un hallazgo puntual queda con el issue; una regla recurrente se promueve al owner local o a un check; una heurística validada en varios repos puede proponerse para el paquete portable. Promoción con revisión humana, no extracción automática de prompts.

El contrato local puede ser prosa bien delimitada. Usar schema solo para metadatos y outputs que se puedan validar de manera objetiva. Una decisión como “el `.md` materializado es autoridad” debe seguir explicada en el ADR/`AGENTS.md`, no reducida a `contentAuthority: markdown` sin semántica.

### Regla de clasificación de una afirmación

Para decidir el destino de una sección mixta, clasificar **cada afirmación** por la fuente que la hace verdadera:

1. Un procedimiento que conserva su validez al cambiar producto y stack pertenece al método portable.
2. Un criterio que depende de una tecnología o clase de fallo identificable pertenece a conocimiento técnico condicionado; declara versión, supuestos y evidencia de aplicación. Antes de publicarlo como reusable, se prueba en un segundo contexto o se conserva como candidato.
3. Una decisión de producto, arquitectura, despliegue o diseño pertenece a la fuente normativa del repo. El binding la descubre y cita.
4. Una regla comprobable de forma determinista puede tener un check; el check implementa una parte verificable de la afirmación y conserva el vínculo a su owner conceptual.
5. Una secuencia de roles, herramientas o estados pertenece al protocolo de orquestación y sus adapters.

La afirmación “`tauri dev` no acredita el bundle distribuido” tiene una parte técnica reusable; “este producto distribuye DMG con estas capabilities” es un hecho local. Separar ambas conserva profundidad y evita transportar una configuración accidental.

## Evaluación crítica de la propuesta

| Hueco relevante | Riesgo para el objetivo | Mejora propuesta |
| --- | --- | --- |
| `methods/`, `lenses/` y `.agents/skills/` parecían tres rutas con posibles `SKILL.md` ejecutables. | Una responsabilidad podría adquirir varios owners y versiones divergentes al instalarse. | Un `SKILL.md` ejecutable por responsabilidad; las lentes internas de review son referencias del skill que produce el veredicto. |
| Un directorio local separado para bindings podía convertirse en una copia de ADRs, `AGENTS.md`, specs y diseño. | El harness viajaría con un overlay nuevo pero perdería la precedencia y profundidad del proyecto original. | Especialidad junto al skill, con punteros, scope y precedencia; crear texto local nuevo solo para conocimiento que carece de owner. |
| La prueba en otro repo estaba al final de la secuencia. | Podríamos reorganizar todos los skills antes de descubrir que el método aún depende de Odessay. | Piloto temprano de Recon + Architecture en Odessay y en otro repo real, con una tarea comparable y un caso de contexto faltante. |
| El ciclo de actualización entre paquete y repo consumidor estaba implícito. | Un upgrade podría sobrescribir adaptaciones locales o dejar bindings rotos. | Versión fijada, skill instalado tratado como distribución del método y upgrade con diff, validación de bindings y regresión. |

La estructura editorial común de ocho secciones **sí aporta valor**: facilita lectura, comparación y lint. Su calidad se evalúa por el contenido que permite encontrar, no por la presencia de encabezados. Las carpetas auxiliares siguen siendo proporcionales al skill. La automatización de checks es un paso posterior a probar la frontera de conocimiento; adelantarla mediría forma sin demostrar portabilidad.

## Duplicaciones y fronteras a resolver

1. **Desktop documental**: `AGENTS.md` raíz es owner de precedencia e invariantes. La migración alineó los skills trasladados y `workflow/agents.md` con el routing local hacia ADR y catálogo según scope. Las fuentes de dirección, diagnóstico, target architecture y migration plan se seleccionan por la pregunta concreta. Este ajuste es documental; no reinterpreta el contrato aceptado.
2. **Transiciones y correcciones**: estado transitorio con salida, owner único, admisión y rollback aparecen en frontend, la referencia de corrección de Code Review y `skill-corrections`. La referencia revisa el patrón; la especialidad de correcciones conserva su instanciación, tests y tiempos. Frontend consume el criterio cuando corresponde.
3. **Performance**: `skill-performance` ya se declara owner de forma de costo y evidencia; frontend, backend, database, UX testing y review deben referenciarlo y conservar solo sus consecuencias de dominio. `references/instruments.md` es el patrón más avanzado de esta separación en Odessay.
4. **Presentación textual**: `skill-design`, `tipografia.md`, `skill-frontend`, `skill-ux-testing` y review citan la paridad write/preview/shared/public. Un contrato visual local único define superficies y valores; construcción y validación solo lo aplican desde su modo.
5. **Review**: conservar `TechnicalVerdict` en review y `GateResult` en workflow. `scoring.md` posee la fórmula. El baseline mecánico de `skill-code-review` debe convertirse gradualmente en checks; la consistencia visual local debe vivir con diseño y ser consumida por la lente adecuada.
6. **Planning**: separar método de definición, schema de Issue Brief, rúbrica de auditoría y adapter Linear. Hoy `skill-planning` posee partes de los cuatro. La extracción debe respetar `planning-agent` como owner de topología y `workflow/workflow.md` como owner de estados/gates.

## De instrucciones a mecanismos verificables

| Regla actual | Mecanismo candidato | Límite |
| --- | --- | --- |
| Paths requeridos, docs citados y precedencia de carga | Validador de enlaces y manifiesto de fuentes; resolver referencias inexistentes y scopes. | No prueba que dos documentos estén semánticamente de acuerdo. |
| Estructura común de `SKILL.md` | Lint de frontmatter, encabezados, orden y referencias a recursos asociados. | Solo comprueba forma; no garantiza que el método o las fuentes sean correctos. |
| Schema de Issue Brief, `Architecture Contract`, `Performance Architecture Contract`, `Execution Trace` | Schema/validador de presencia, tipos, campos condicionales y referencias. | Un bloque completo puede seguir siendo genérico o falso; exige review humano. |
| “Un owner por responsabilidad” y límites de hotspots | Dependency graph, reglas de imports y checks de boundaries específicos del repo. | No pueden descubrir por sí solos un duplicado semántico con nombres distintos. Recon y review siguen. |
| Baseline de review: `any`, `@ts-ignore`, logs, naming, rutas | ESLint/TypeScript/AST o checks de CI donde la regla sea sintáctica. | No convertir preferencias visuales o de diseño en falsos bloqueos automáticos. |
| Invariantes de correcciones: fingerprint, matching, admisión y salida de stale | Tests de contrato y propiedades por todos los entry points; fixtures de LLM malformado y timeout. | El test requiere un owner y escenarios correctos, no solo contar cobertura. |
| RLS, migraciones y compatibilidad de consumidores | Tests de políticas por rol, schema diff, validación de migrations y contract tests. | No sustituye decidir quién tiene autoridad sobre los datos. |
| Performance y bundle desktop | Reusar gates y presupuestos existentes, capturas del bundle instalado cuando el riesgo lo exija. | `tauri dev` y un HAR no acreditan por sí solos capabilities del artefacto distribuido. |
| Paridad visual y flujos críticos | Comparación de superficies y E2E de journeys reales con fixtures estables. | La intención visual y la calidad de experiencia conservan juicio humano. |

Orden de inversión: primero demostrar la frontera entre método y conocimiento local en dos repos; después añadir checks baratos de integridad documental y schemas donde el piloto revele errores repetibles; finalmente considerar tests de invariantes y analizadores de boundaries. Los scripts activos conservan sus rutas operativas mientras package scripts, CI o tests los consuman desde ellas.

## Secuencia de adopción sugerida

1. **Preparar el piloto**: clasificar afirmaciones solo en Architecture Recon y Architecture; registrar sus owners, consumidores y fuentes de autoridad actuales. Conservar los paths de los skills que ya invocan los roles. Resolver el routing del ADR y catálogo desktop antes de probarlo en Odessay.
2. **Probar la frontera en dos repositorios reales**: aplicar el mismo método de Recon a una tarea de Odessay y a otra de un repo con arquitectura distinta. En cada una, comprobar si identifica owner, APIs, consumers y tests, si cita el contrato local correcto y si un dato faltante genera un `Context Gap` preciso. Incluir un cambio trivial como control para verificar activación selectiva.
3. **Decidir con evidencia**: si el método requiere datos de Odessay para funcionar en el segundo repo, ajustar la frontera y repetir el piloto. Si funciona, estabilizar el `SKILL.md` común y el binding local; entonces extender el patrón a planning, review y dominios profundos, conservando en Odessay los contratos de corrections, diseño e identidad documental.
4. **Empaquetar y verificar**: versionar los skills y guías tecnológicas que demostraron portabilidad; validar la estructura editorial, los bindings y los links. Adaptar schemas y checks a fallos observados, manteniendo los mecanismos existentes y sus callers operativos.

### Implementación actual en los skills

El piloto de Odessay permitió migrar los métodos operativos `architecture-recon` y `skill-architecture` a sus rutas habituales. Ambos conservan la estructura común; Architecture usa [criterios de capas y boundaries](skills/skill-architecture/references/layers-and-boundaries.md) y la [especialidad de Odessay](skills/skill-architecture/specialties/ownership-and-sources.md). Recon consume esa especialidad para conocer fuentes y hotspots sin incorporarlos al método.

Las cuatro lentes de Code Review contienen el criterio reusable en [references/](skills/skill-code-review/references/architecture.md), dentro del mismo skill que produce `TechnicalVerdict`. Su [especialidad de contratos locales](skills/skill-code-review/specialties/review-contracts.md) reúne el bundle desktop, reglas de producto, evidencia de capacidades y umbrales; `skill-code-review` y `review-agent` seleccionan ambas por riesgo del diff. Los antiguos directorios `review-*` dejaron de ser skills ejecutables.

Los 12 `SKILL.md` usan las mismas ocho secciones. Planning, Audit Planning, Frontend, Backend, Database y UX Testing tienen un entrypoint de método y especialidades nombradas por su responsabilidad. Planning distingue verificación de definición, schema de Issue Brief y convenciones de publicación en Linear; Frontend distingue runtime/editor de componentes/interacción; Backend distingue API/persistencia de integraciones externas. Audit Planning, Database y UX Testing usan un recurso temático cada uno. Performance mantiene en su `SKILL.md` el método y el contrato de evidencia, con las referencias de instrumentos y runtime que ya tenía.

Corrections conserva el contrato propio de su subsistema. Design tiene un único `SKILL.md` que selecciona el sistema visual: producto conserva sus reglas y recursos, mientras marketing aporta `marketing-system.md` y `marketing-page.md` como especialidades locales. Su portabilidad consiste en ofrecer un lugar y una forma explícita para que otro proyecto construya su sistema visual, sin copiar los valores de Odessay.

Esta migración fija una frontera de instalación: el método puede leerse sin los hechos de Odessay en los skills separados, y el repo carga su especialidad cuando aplica. Algunas recetas técnicas dentro de las especialidades podrían viajar como guías condicionadas a un stack, pero extraerlas ahora sin un segundo caso comprobado produciría una abstracción especulativa. La prueba de comportamiento en otro repo sigue pendiente antes de declarar portable una distribución externa.

Las simulaciones del piloto se hicieron solo en Odessay: una tarea de sync de imagen con respuesta conocida y un caso de apertura de Workspace con contrato esperado fijado antes de investigar el código. Architecture determinó el owner esperado; Recon encontró owners, consumers y pruebas existentes, e identificó una discrepancia de descriptor y un camino legacy de filas. Esa evidencia justificó migrar los dos métodos; no valida por sí sola el resto de los skills.

Aprendizajes aplicados: conservar la pregunta y el output que consumen los roles; separar afirmaciones por fuente de autoridad; mantener una estructura editorial común con recursos proporcionales; verificar callers antes de mover contratos; y distinguir normalización de portabilidad demostrada.

### Revisión de tamaño de los recursos

La longitud por sí sola no determina una división. Un recurso se separa cuando sus partes tienen distintas condiciones de carga, autoridad o mantenimiento y el `SKILL.md` puede seleccionar cada parte sin reconstruir el documento entero. Así se extrajeron las convenciones de Linear del recurso de definición de Planning. Las referencias de Architecture, Code Review y Performance son breves y tienen una pregunta propia; `issue-brief-schema.md`, `scoring.md`, tipografía y el contrato de auditoría se consultan como unidades completas.

Frontend y Backend conservan guías locales extensas con secciones identificables; sus `SKILL.md` indican qué secciones leer según el cambio. `vistas.md` agrupa vistas independientes, pero permite localizar la vista afectada y el checklist sin crear un archivo por pantalla. Dividir esos recursos solo por número de líneas multiplicaría rutas y referencias sin demostrar una mejora de uso; una separación posterior debe responder a cargas repetidas de contenido irrelevante o a mantenimiento realmente independiente.

### Criterios de aceptación de la productización

- Un segundo repo real puede ejecutar Recon con el mismo método y sus propias fuentes, sin cargar rutas ni decisiones de Odessay; planning y review pasan por la misma prueba antes de declararse portables.
- Todos los `SKILL.md` conservan las ocho secciones en el mismo orden; el contenido y los recursos asociados son específicos de cada skill.
- La instalación no convierte defaults tecnológicos en decisiones arquitectónicas del repo.
- Una tarea muestra qué método, guía tecnológica, contrato local e instrumento usó, con fuente y precedencia.
- Un `Context Gap` identifica exactamente el conocimiento local faltante; no rellena el hueco por analogía.
- Un mismo invariante local tiene un owner normativo y múltiples consumidores, sin copias divergentes.
- Los checks existentes siguen en sus rutas operativas o migran con todos sus callers en un cambio explícito.
- Un cambio real en Odessay conserva o mejora el resultado de planificación, BUILD y review durante el piloto.
- El piloto documenta tres resultados observables: tarea de Odessay, tarea del segundo repo y caso de contexto insuficiente; el cambio trivial sirve para comprobar que la activación sigue siendo proporcional.

## Principios de alcance

- **Estructura editorial común, recursos proporcionales:** cada `SKILL.md` usa el mismo orden; arquitectura y diseño pueden tener `specialties/`, mientras una lente pequeña puede sostenerse en su archivo principal.
- **Conocimiento de dominio explicado:** corrections, identidad documental y diseño conservan contexto, historia de fallos, ejemplos y contratos normativos. La configuración representa solo datos que admiten validación objetiva.
- **Tecnología condicionada por el repo:** un método frontend describe cómo razonar sobre UI; local-first, TipTap, Next y Zustand entran cuando el proyecto realmente los usa.
- **Lentes ejecutables en distintos entornos:** la lente funciona con un agente principal; `specialists/` adapta su ejecución cuando hay workers disponibles.
- **Calidad basada en investigación y evidencia:** el harness encuentra el owner, confronta contrato con realidad y comunica la incertidumbre. Los scripts aportan pruebas para las reglas que admiten verificación determinista.
