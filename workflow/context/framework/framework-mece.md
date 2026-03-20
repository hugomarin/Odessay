# Framework MECE para proyectos con agentes de código

Este documento define el modelo de preguntas que un proyecto debe responder para ser completamente ejecutable por agentes autónomos. Se puede aplicar a cualquier proyecto de software — no es específico de Odessay.

La lógica es simple: si un agente puede responder todas las preguntas sin ambigüedad, puede construir el proyecto sin intervención humana en las decisiones. Si alguna pregunta no tiene respuesta, el agente improvisa — y la improvisación produce inconsistencia.

---

## El principio MECE aplicado a documentación

**Mutuamente excluyente:** cada pregunta tiene respuesta en exactamente un lugar. Si dos documentos responden lo mismo, hay contradicción latente.

**Colectivamente exhaustivo:** el conjunto de preguntas cubre todo lo que el agente puede necesitar saber. Si una pregunta no tiene respuesta, el framework está incompleto.

**Test de exhaustividad:** para cada pregunta, ¿existe un documento que la responde sin ambigüedad? Si no → el framework tiene un gap.

**Test de exclusividad:** para cada documento, ¿responde una sola pregunta principal? Si responde dos → probablemente hay solapamiento o el documento está mal dividido.

---

## Las 10 preguntas

### 1. ¿Para qué existe esto y para quién?

Visión del producto, problema que resuelve, usuario objetivo, principios que nunca se negocian. Sin esto, el agente no puede tomar decisiones de prioridad ni saber qué no construir.

**Tipo de documento:** `fundacional.md` — narrativo, no técnico. Lo escribe el dueño del producto, no el agente.

---

### 2. ¿Qué ve y hace el usuario?

Flujos de usuario, páginas y rutas, comportamiento esperado en cada interacción, estados vacíos, estados de error desde la perspectiva del usuario.

**Tipo de documento:** `paginas.md` + `flujos.md` — descripciones de comportamiento por ruta, no implementación.

---

### 3. ¿Cómo se ve exactamente?

Tokens de diseño (colores, tipografía, espaciado, sombras), componentes visuales y sus variantes, valores exactos por vista, referencias visuales concretas (prototipos, screenshots).

**Tipo de documento:** `skill-design.md` + `.agents/skills/skill-design/vistas.md` + carpeta `workflow/context/reference/`. El agente no interpreta — tiene los valores exactos.

---

### 4. ¿Qué datos existen y cómo se modelan?

Schema de base de datos, tipos de cada campo, relaciones entre tablas, políticas de acceso (RLS), índices relevantes. Sin esto, el agente define su propio schema y el producto se fragmenta.

**Tipo de documento:** `modelo-datos.md` — el schema es la fuente de verdad, no el código.

---

### 5. ¿Cómo está organizado el código?

Stack tecnológico, estructura de carpetas, naming conventions, patrones de componentes, gestión de estado, reglas de Server vs Client components, accesibilidad. Define cómo se escribe, no solo qué se escribe.

**Tipo de documento:** `stack.md` + `arquitectura.md` + `skill-frontend.md`

---

### 6. ¿Cómo funciona cada parte crítica?

Especificaciones técnicas de los componentes más complejos o únicos del producto: editor, sistema de sync, componentes custom, extensiones, integraciones de terceros. No todos los componentes la necesitan — solo los que tienen comportamiento no evidente.

**Tipo de documento:** docs específicos por componente (`editor.md`, `ai-editor.md`, `margenes.md`). Un doc por componente crítico, no un doc por feature.

---

### 7. ¿Cómo se implementa el backend?

Patrones de API routes, autenticación, integración con base de datos, manejo de errores, contrato de respuesta, servicios externos. El agente no define su propio estilo de API.

**Tipo de documento:** `skill-backend.md` + `skill-database.md`

---

### 8. ¿Qué existe hoy en el codebase?

Estado actual: qué está construido, qué no existe todavía, decisiones tomadas que no están en el código pero sí en la historia del proyecto. Referencia a PRs para el detalle — este doc da orientación, no registro.

**Tipo de documento:** `STATUS.md` — se actualiza con cada PR significativo. Sin este doc, el agente asume que nada existe o que todo existe.

---

### 9. ¿Cómo opera el agente en este proyecto?

Variables de entorno, cómo levantar el proyecto, tools requeridos, permisos necesarios, estrategia de Git, convenciones de commits, flujo de entrega, protocolo de escalación cuando algo falla o falta.

**Tipo de documento:** `SETUP.md` — el primer doc que lee el agente. Si no puede completar el pre-flight, no empieza.

---

### 10. ¿Cómo sé que terminé?

Estructura de issues ejecutables, Definition of Done verificable, validaciones que el agente puede correr (typecheck, lint, tests), criterios de revisión antes del PR. El agente no decide por su cuenta cuándo algo está listo.

**Tipo de documento:** `skill-product-manager.md` + `skill-code-review.md` + comandos ejecutables en `SETUP.md`

---

## Cómo aplicar este framework a un proyecto nuevo

**Paso 1 — Crear la estructura de carpetas:**

```
/docs
  fundacional.md       → pregunta 1
  paginas.md           → pregunta 2
  flujos.md            → pregunta 2
  modelo-datos.md      → pregunta 4
  arquitectura.md      → pregunta 5
  stack.md             → pregunta 5
  [componente].md      → pregunta 6 (uno por componente crítico)
  STATUS.md            → pregunta 8
  SETUP.md             → pregunta 9

/.agents/skills
  skill-design/        → pregunta 3
  skill-design/ → pregunta 3
  skill-frontend/      → pregunta 5
  skill-backend/       → pregunta 7
  skill-database/      → pregunta 7
  skill-product-manager/ → pregunta 10
  skill-code-review/   → pregunta 10

/workflow/reference             → pregunta 3 (prototipos y screenshots)

CLAUDE.md              → meta-instrucciones: orden de lectura, routing de skills
AGENTS.md              → resumen condensado para el agente
```

**Paso 2 — Auditar con el test de exhaustividad:**

Para cada una de las 10 preguntas: ¿existe un documento que la responde sin ambigüedad? Marcar las que no tienen respuesta — esos son los gaps. No empezar a desarrollar hasta que todas las preguntas tengan respuesta, o hasta que se haya decidido conscientemente qué gaps son aceptables en esta fase.

**Paso 3 — Auditar con el test de exclusividad:**

Para cada documento: ¿cuál de las 10 preguntas responde principalmente? Si un documento responde dos preguntas igualmente, probablemente necesita dividirse. Si dos documentos responden la misma pregunta, probablemente necesitan fusionarse o uno de los dos establece precedencia sobre el otro.

---

## Señales de un framework incompleto

Un agente que improvisa en estas áreas indica un gap en el framework:

- Elige tecnologías no especificadas → falta pregunta 5 o 7
- Diseña pantallas que no coinciden con el producto → falta pregunta 3
- Crea tablas o campos no documentados → falta pregunta 4
- Duplica trabajo ya hecho → falta pregunta 8
- Se bloquea en permisos o configuración → falta pregunta 9
- Nunca termina o termina de forma diferente cada vez → falta pregunta 10
- Agrega funcionalidad no pedida → falta pregunta 1 (los principios no están claros)

---

## Lo que este framework no reemplaza

El framework garantiza que el agente tiene todo lo que necesita para ejecutar. No garantiza que lo que está documentado sea correcto. La calidad del producto depende de la calidad de la documentación — especialmente de las preguntas 1, 2 y 3, que ningún agente puede completar por el dueño del producto.
