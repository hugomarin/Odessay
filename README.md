# Framework de desarrollo autónomo con agentes de código

Un sistema de documentación estructurada que permite a agentes de código construir productos de software con mínima intervención humana en las decisiones de implementación.

Desarrollado y validado en Odessay — una plataforma de escritura epistolar construida completamente por agentes de código. Este repositorio es la instancia de referencia del framework.

---

## El problema

Un agente de código sin documentación suficiente improvisa. La improvisación no es aleatoria — es localmente coherente pero globalmente inconsistente. Un agente elige un patrón de estado, el siguiente elige otro. Uno inventa un nombre de tabla, el siguiente inventa uno diferente. Cada agente produce código que tiene sentido dentro de su sesión pero no encaja con lo que construyó el anterior.

El resultado no es un codebase con bugs — es un codebase con contradicciones estructurales que se acumulan hasta que ningún agente (ni humano) puede mantenerlo.

La solución no es supervisar más. Es documentar mejor.

Si un agente puede responder las preguntas críticas del proyecto sin ambigüedad, puede construir sin improvisar. Si alguna pregunta no tiene respuesta, el agente inventa la suya — y esa invención se convierte en decisión técnica no deliberada.

---

## El framework

El framework tiene tres capas que resuelven problemas distintos: la jerarquía documental define dónde vive cada tipo de conocimiento; el modelo MECE garantiza que ese conocimiento es completo sin ser redundante; el protocolo de agentes define cómo navegan ese conocimiento de forma eficiente.

---

## Capa 1 — Jerarquía documental

La documentación se organiza en cuatro tipos con responsabilidades distintas:

```
workflow/
  core/       → Verdades estables. Todo agente las lee siempre.
  features/   → Specs de features con complejidad propia. On-demand.
  (root)      → Estado vivo y operación. Pre-flight obligatorio.
workflow/framework/    → Este framework. Transferible, no específico del proyecto.
.agents/skills/       → Instrucciones de implementación por dominio.
workflow/reference/    → Prototipos y referencias visuales.
```

### workflow/core/ — lo que define el producto

Los documentos core responden qué es el producto y cómo está construido. Son las verdades que no cambian sprint a sprint. Un agente que no los leyó no entiende el producto.

En la práctica contienen: visión y principios (`fundacional.md`), arquitectura técnica (`arquitectura.md`), stack y convenciones (`stack.md`), schema de datos (`modelo-datos.md`), rutas y páginas (`paginas.md`), flujos de usuario (`flujos.md`).

### workflow/features/ — lo que define cada feature complejo

Los docs de feature responden cómo funciona una parte específica del producto con complejidad no evidente. No todos los features necesitan doc propio — solo los que tienen comportamiento suficientemente específico como para que un agente lo maneje mal sin instrucciones explícitas.

La ausencia de un doc en `features/` no es solo un gap de documentación — es un indicador de riesgo: el agente que toque ese feature tomará decisiones de diseño sin referencia.

### workflow/ — lo que define la operación del agente

Los docs de operaciones son para el agente, no sobre el producto. Responden cómo empezar (`SETUP.md`), qué existe hoy (`workflow/status.json`), y en qué orden construir (`roadmap.md`).

`workflow/status.json` es el documento más crítico para la coordinación entre agentes: evita que un agente construya algo que ya existe o asuma que algo existe cuando no existe.

### .agents/skills/ — instrucciones de implementación

Los skills son instructivos, no descriptivos. Donde los docs de `core/` y `features/` describen qué existe y cómo funciona, los skills instruyen cómo construirlo: patrones de código, convenciones, checklists, decisiones de implementación.

Un skill tiene un archivo principal (`SKILL.md`) y puede tener archivos companion dentro de la misma carpeta para aspectos más granulares. El companion no es un skill independiente — es una referencia que el skill principal indexa. Ejemplo: `skill-design/SKILL.md` (sistema de diseño completo) + `skill-design/vistas.md` (valores exactos por vista).

---

## Capa 2 — Modelo MECE

El principio MECE (Mutuamente Excluyente, Colectivamente Exhaustivo) aplicado a documentación técnica: cada pregunta tiene respuesta en exactamente un lugar, y el conjunto de preguntas cubre todo lo que el agente puede necesitar saber.

**Mutuamente excluyente** — si dos documentos responden lo mismo, hay contradicción latente. En el momento en que divergen — y divergirán — el agente tiene que elegir cuál creer. Esa elección no es técnica: es aleatoria.

**Colectivamente exhaustivo** — si alguna pregunta no tiene respuesta, el agente improvisa. La improvisación en esa área se convierte en decisión de arquitectura no deliberada.

### Las 10 preguntas

Todo proyecto que usa este framework debe responder estas preguntas antes de empezar a desarrollar:

**1. ¿Para qué existe esto y para quién?**
Visión, problema que resuelve, usuario objetivo, principios no negociables. Sin esto, el agente no puede decidir qué no construir.
*Documento tipo: `fundacional.md` — narrativo, lo escribe el dueño del producto.*

**2. ¿Qué ve y hace el usuario?**
Flujos de usuario, páginas, rutas, comportamiento en cada interacción, estados vacíos y de error.
*Documentos tipo: `paginas.md` + `flujos.md`*

**3. ¿Cómo se ve exactamente?**
Tokens de diseño, componentes y variantes, valores exactos por vista, prototipos. El agente no interpreta — tiene los valores.
*Documentos tipo: `skill-design/SKILL.md` + `skill-design/vistas.md` + `workflow/reference/`*

**4. ¿Qué datos existen y cómo se modelan?**
Schema de base de datos, tipos, relaciones, políticas de acceso. Sin esto, el agente define su propio schema y el producto se fragmenta.
*Documento tipo: `modelo-datos.md`*

**5. ¿Cómo está organizado el código?**
Stack, estructura de carpetas, naming conventions, patrones de componentes, gestión de estado. Define cómo se escribe, no solo qué se escribe.
*Documentos tipo: `stack.md` + `arquitectura.md` + `skill-frontend/SKILL.md`*

**6. ¿Cómo funciona cada parte crítica?**
Specs técnicas de los componentes más complejos o únicos del producto. No todos los componentes la necesitan — solo los que tienen comportamiento no evidente.
*Documentos tipo: uno por componente crítico en `workflow/features/`*

**7. ¿Cómo se implementa el backend?**
Patrones de API, autenticación, base de datos, manejo de errores, servicios externos. El agente no define su propio estilo de API.
*Documentos tipo: `skill-backend/SKILL.md` + `skill-database/SKILL.md`*

**8. ¿Qué existe hoy en el codebase?**
Estado actual: qué está construido, qué no existe, decisiones tomadas que no están en el código. Sin esto, el agente asume que nada existe o que todo existe.
*Documento tipo: `workflow/status.json` — se actualiza con cada PR significativo.*

**9. ¿Cómo opera el agente en este proyecto?**
Variables de entorno, cómo levantar el proyecto, tools requeridos, permisos, Git, protocolo de escalación.
*Documento tipo: `SETUP.md` — el primer doc que lee el agente.*

**10. ¿Cómo sé que terminé?**
Estructura de issues ejecutables, Definition of Done verificable, validaciones que el agente puede correr, criterios de revisión.
*Documentos tipo: `skill-product-manager/SKILL.md` + `skill-code-review/SKILL.md`*

### Cómo auditar el framework de un proyecto

**Test de exhaustividad:** para cada una de las 10 preguntas, ¿existe un documento que la responde sin ambigüedad? Si no → gap. No empezar a desarrollar hasta que todos los gaps sean conscientemente aceptados.

**Test de exclusividad:** para cada documento, ¿cuál pregunta responde principalmente? Si responde dos igualmente → probablemente necesita dividirse. Si dos documentos responden la misma → probablemente hay solapamiento o uno establece precedencia.

### Señales de un framework incompleto

Un agente que improvisa en estas áreas indica un gap específico:

- Elige tecnologías no especificadas → falta Q5 o Q7
- Diseña pantallas que no coinciden con el producto → falta Q3
- Crea tablas o campos no documentados → falta Q4
- Duplica trabajo ya hecho → falta Q8
- Se bloquea en configuración → falta Q9
- Nunca termina o termina distinto cada vez → falta Q10
- Agrega funcionalidad no pedida → falta Q1

---

## Capa 3 — Protocolo de agentes

### workflow/docs.json como cartografía dual

`workflow/docs.json` tiene dos responsabilidades que se complementan:

**Registry** — inventario completo de todo documento que existe en el proyecto. Un documento que no está en el registry es un **nodo huérfano**: existe en disco pero ningún agente tiene ruta para llegar a él. El agente no sabe lo que no sabe — el contenido huérfano genera gaps de contexto silenciosos.

**Questions** — índice temático orientado a tareas. Mapea cada una de las 10 preguntas MECE al documento que la responde, con su scope de lectura.

La distinción es importante: el registry responde "¿qué existe?", las questions responden "¿qué leer para hacer X?". Un proyecto puede tener ambos bien formados o solo uno. Un registry sin questions obliga al agente a decidir qué leer. Questions sin registry permite que existan nodos huérfanos.

```json
{
  "registry": [
    {
      "path": "workflow/core/arquitectura.md",
      "type": "core",
      "description": "Qué contiene y para qué sirve — en una oración.",
      "scope": "always"
    }
  ],
  "questions": [
    {
      "id": 5,
      "question": "¿Cómo está organizado el código?",
      "documents": [
        { "path": "workflow/core/arquitectura.md", "scope": "always" }
      ]
    }
  ]
}
```

### Detección automática de nodos huérfanos

El pre-flight script verifica en ambas direcciones — registry → disco y disco → registry:

```js
// a) Declarado en registry pero no existe en disco
config.registry.forEach(doc => {
  if (!fs.existsSync(doc.path)) orphans.push({ problem: 'roto', path: doc.path });
});

// b) Existe en disco pero no está en registry (nodo huérfano)
const registryPaths = new Set(config.registry.map(d => d.path));
walkDirs(['docs', 'workflow', 'framework', '.agents/skills']).forEach(file => {
  if (!registryPaths.has(file)) orphans.push({ problem: 'huérfano', path: file });
});
```

Si el script encuentra problemas, el agente no empieza. La integridad del mapa es condición de trabajo.

### Tres scopes de lectura

Cada documento tiene un scope que determina cuándo lo lee el agente:

**`always`** — se lee antes de cualquier tarea, sin excepción. Son los documentos que definen el proyecto: visión, arquitectura, stack, estado actual, operación, criterio de entrega. Típicamente 6–8 documentos.

**`conditional`** — se lee cuando el issue activa su trigger. El issue declara `areas_affected` y el sistema mapea cada área a sus documentos. Un agente trabajando en backend no carga los flujos de UX. Un agente en frontend no carga el skill de base de datos. Esto reduce el contexto irrelevante y hace la lectura proporcional al trabajo.

**`reference`** — se consulta al llegar a esa parte del trabajo, no al inicio. Para specs muy granulares de componentes específicos que solo importan cuando el issue los toca directamente.

```json
"triggers": {
  "frontend": ["workflow/core/paginas.md", ".agents/skills/skill-design/SKILL.md", ".agents/skills/skill-frontend/SKILL.md"],
  "backend":  ["workflow/core/modelo-datos.md", ".agents/skills/skill-backend/SKILL.md"],
  "editor":   ["workflow/features/editor.md"]
}
```

### Protocolo de lectura en cuatro pasos

**Paso 1 — Pre-flight.** Correr el script de integridad. Leer `SETUP.md` y `workflow/status.json`. Si falta algo requerido, documentar el bloqueo y escalar — no improvisar.

**Paso 2 — Contexto base.** Leer todos los documentos `always`. Sin excepción. Son el piso de contexto que hace coherente cualquier decisión posterior.

**Paso 3 — Contexto condicional.** Leer los documentos activados por los triggers del issue.

**Paso 4 — Pre-PR.** Antes de abrir un PR, leer `skill-product-manager` y `skill-code-review`.

### WORKFLOW.md — instrucciones de issue específico

Para issues con contexto o restricciones que van más allá de los docs estándar, se crea un `WORKFLOW.md` en la raíz de la rama. Sobreescribe `AGENTS.md` para esa rama únicamente. Se borra al mergear — el historial vive en el PR.

El patrón resuelve la tensión entre instrucciones globales (docs) e instrucciones puntuales (el issue específico): los docs no se contaminan con contexto temporal, y el agente tiene acceso a las instrucciones exactas para esa tarea.

---

## Prácticas de entrega

### Hermetic testing

Los tests corren con `npm test` sin dependencias externas. Supabase se mockea, fetch se intercepta (MSW), los datos de prueba viven en fixtures del repo. Un test que pasa localmente pero falla en CI porque "hay datos en staging" está roto por diseño — no es deuda técnica, es el issue.

Tests E2E con Playwright son la excepción: corren contra staging, separados del CI básico.

### Proof of work en PRs

Antes de mover un issue a revisión, el agente pega el output de `npm run typecheck && npm run lint && npm test` en la descripción del PR. Sin ese output el PR no se revisa. Elimina la categoría de bugs "funciona en mi máquina" y hace la validación trazable.

### Actualización de status.json con cada PR

Cada PR significativo agrega una fila a `workflow/status.json`. Un PR significativo es cualquiera que implemente funcionalidad visible o infraestructura de la que otros issues dependen. Sin este hábito, el documento pierde valor en días y los agentes vuelven a improvisar sobre el estado del codebase.

---

## Aplicar el framework a un proyecto nuevo

**1. Crear la estructura de carpetas:**

```
workflow/core/         → Q1, Q2, Q4, Q5
workflow/features/     → Q6
workflow/          → Q8, Q9
workflow/framework/         → este framework
.agents/skills/            → Q3, Q5, Q7, Q10
workflow/reference/         → Q3
workflow/docs.json
CLAUDE.md
AGENTS.md
```

**2. Completar las 10 preguntas** — redactar un documento por pregunta antes de escribir una línea de código. Las preguntas 1, 2 y 3 las responde el dueño del producto, no el agente.

**3. Registrar todo en workflow/docs.json** — registry + questions. Correr el pre-flight para confirmar integridad bidireccional.

**4. Auditar con los dos tests** — exhaustividad (¿alguna pregunta sin respuesta?) y exclusividad (¿algún overlap entre documentos?).

**5. Definir triggers** — mapear cada área de trabajo (`frontend`, `backend`, `editor`, etc.) a sus documentos en `workflow/docs.json → triggers`.

---

## Lo que el framework no reemplaza

El framework garantiza que el agente tiene todo lo que necesita para ejecutar. No garantiza que lo documentado sea correcto ni que el producto valga la pena construir. La calidad del producto depende de la calidad de la documentación — especialmente de las preguntas 1, 2 y 3, que ningún agente puede completar por el dueño del producto.

Un framework perfecto con una visión equivocada produce un producto equivocado con consistencia perfecta.
