# Funcionalidad propuesta: Context Workspace en Odessay

## 1. Tesis de producto

**Context Workspace** no es una carpeta, una colección ni un project manager. Es una mesa de trabajo para reunir documentos, reglas, notas y objetivos en un contexto vivo.

La idea central:

> Cuando trabajas con muchos documentos, el problema no es guardarlos. El problema es saber si juntos dicen lo correcto, sin repetirse, sin contradecirse y sin dejar huecos.

Odessay ya trabaja con writings individuales. Context Workspace agrega una capa superior: permite trabajar con un cuerpo de documentos como un sistema.

## 2. Diferencia entre Collections y Context Workspace

### Collections

Organizan writings por tema, categoría o etiqueta.

```txt
Collection: Harness
Collection: Odessay
Collection: Contratos
Collection: Ensayos
```

Una collection responde:

> ¿De qué tema es este writing?

### Context Workspace

Organiza writings por propósito, objetivo y relación funcional dentro de un contexto.

```txt
Context Workspace: Itogai Skill System
Objective: Crear un sistema coherente de skills para agentes de producto, contrato y refactor.
```

Un Context Workspace responde:

> ¿Para qué están juntos estos documentos y qué papel cumple cada uno dentro del contexto?

### Regla simple

```txt
Collections organize by theme.
Context Workspaces organize by purpose.
```

O en español:

```txt
Las collections agrupan por tema.
Los Context Workspaces agrupan por intención, función y contexto.
```

## 3. Problema que resuelve

Cuando un usuario trabaja con muchos documentos relacionados, especialmente documentos generados o asistidos por IA, aparecen problemas recurrentes.

### 1. Overlap

Varios documentos dicen lo mismo con pequeñas variaciones.

Ejemplo:

```txt
La misma regla aparece en:
- SKILL.md
- anti-patterns.md
- performance-contract-rubric.md
```

Esto vuelve difícil saber cuál documento es la fuente correcta.

### 2. Ausencia

El corpus parece grande, pero falta una pieza crítica.

Ejemplo:

```txt
Hay reglas, templates y anti-patterns,
pero no hay un documento que defina source of truth.
```

### 3. Contradicción

Dos documentos dan instrucciones incompatibles.

Ejemplo:

```txt
Un documento dice:
“El agente debe inferir el routing.”

Otro documento dice:
“El routing debe ser explícito y determinístico.”
```

### 4. Desorden funcional

La información existe, pero vive en el documento equivocado.

Ejemplo:

```txt
Una regla global aparece escondida dentro de un documento específico.
Una decisión importante está solo en una anotación.
Una excepción aparece repetida en tres archivos.
```

### 5. Costo mental

El usuario tiene que abrir muchos documentos, recordar relaciones, reconstruir jerarquías, detectar duplicados y sostener el contexto completo en la cabeza.

Context Workspace reduce ese costo mental.

## 4. Objetivo de Context Workspace

El objetivo es ayudar al usuario a saber si un conjunto de documentos tiene:

```txt
- La información necesaria.
- La información bien repartida.
- Relaciones claras entre piezas.
- Contexto suficiente para cumplir el objetivo.
- Pocas repeticiones innecesarias.
- Pocas contradicciones no resueltas.
- Buenas fuentes de verdad.
- Una vista condensada de lo que importa.
```

La funcionalidad no solo almacena contexto. Lo ayuda a mantenerse sano.

Frase de producto:

> A Context Workspace doesn’t just store context. It helps keep it coherent.

En español:

> Un Context Workspace no solo guarda contexto. Ayuda a mantenerlo coherente.

## 5. Casos de uso principales

### Caso 1 — Contexto operativo

Para construir algo: skills, documentación, estrategia, contratos, producto, sistemas de trabajo.

Preguntas que debe responder:

```txt
¿Este contexto sirve para ejecutar el objetivo?
¿Qué falta para que alguien o un agente pueda trabajar con esto?
¿Qué documento debería ser source of truth?
¿Qué reglas están duplicadas?
¿Qué documentos se contradicen?
¿Qué notas deberían convertirse en decisiones o reglas?
```

Ejemplo:

```txt
Context Workspace:
Itogai Skill System

Objective:
Crear un sistema coherente de skills para agentes de producto, contrato y refactor.

Documentos:
- SKILL.md
- anti-patterns.md
- reference-doc-routing-rules.md
- performance-contract-rubric.md
- linear-issue-template.md
```

### Caso 2 — Aprendizaje / estudio

Para estudiar un tema con muchos textos, autores, posiciones o notas.

Preguntas que debe responder:

```txt
¿Qué tengo que entender?
¿Qué ideas se repiten?
¿Qué posiciones existen?
¿Qué autores se contradicen?
¿Qué matices no debo perder?
¿Qué debería leer primero?
¿Qué conceptos faltan?
```

Ejemplo:

```txt
Context Workspace:
Motor learning and observation

Objective:
Entender qué se aprende al observar movimiento y qué no se transfiere automáticamente al cuerpo.
```

### Caso 3 — Investigación y escritura

Para ordenar fuentes, notas, borradores, tesis y fragmentos.

Preguntas que debe responder:

```txt
¿Qué tesis está emergiendo?
¿Qué fragmentos pertenecen a qué argumento?
¿Qué está repetido?
¿Qué falta demostrar?
¿Qué textos son fuente, borrador u output?
¿Qué anotaciones deberían subir al nivel global?
```

## 6. Estructura conceptual

Un Context Workspace tiene contexto propio, objetivo propio y reglas propias.

```txt
Context Workspace
- Nombre
- Objetivo
- Descripción
- Reglas / condiciones
- Criterios de éxito
- Documentos vinculados
- Propósito de cada documento
- Roles de documentos
- Notas globales
- Anotaciones promovidas
- Tasks / pendientes ligeros
- AI Context Review
```

La unidad central no es solo “documento agregado”. Es:

> Documento + función dentro del workspace.

## 7. Modelo de datos sugerido

### ContextWorkspace

```ts
type ContextWorkspace = {
  id: string;
  name: string;
  objective: string;
  description?: string;
  contextType?: "operational" | "learning" | "research" | "writing";
  contextRules?: string[];
  successCriteria?: string[];
  status: "active" | "paused" | "done";
  createdAt: Date;
  updatedAt: Date;
};
```

### WorkspaceDocument

```ts
type WorkspaceDocument = {
  id: string;
  workspaceId: string;
  writingId: string;

  role:
    | "foundation"
    | "source"
    | "draft"
    | "output"
    | "reference"
    | "rule"
    | "rubric"
    | "decision_log"
    | "archive";

  purpose?: string;
  importance?: "low" | "medium" | "high" | "critical";
  notes?: string;

  addedAt: Date;
  updatedAt: Date;
};
```

### WorkspaceNote

```ts
type WorkspaceNote = {
  id: string;
  workspaceId: string;
  sourceAnnotationId?: string;

  type:
    | "insight"
    | "open_question"
    | "risk"
    | "decision"
    | "contradiction"
    | "todo";

  body: string;
  status?: "open" | "resolved" | "ignored";
  createdAt: Date;
};
```

### WorkspaceRule

```ts
type WorkspaceRule = {
  id: string;
  workspaceId: string;
  body: string;
  priority?: "low" | "medium" | "high";
  createdAt: Date;
};
```

### Futuro: WorkspaceDocumentRelation

No necesario para MVP, pero conviene diseñarlo para una fase posterior.

```ts
type WorkspaceDocumentRelation = {
  id: string;
  workspaceId: string;
  fromWritingId: string;
  toWritingId: string;

  type:
    | "derived_from"
    | "supports"
    | "contradicts"
    | "replaces"
    | "depends_on"
    | "summarizes";

  description?: string;
};
```

## 8. Roles de documentos

Cada documento dentro del workspace debe poder tener un rol.

```txt
Foundation
Source
Draft
Output
Reference
Rule
Rubric
Decision Log
Archive
```

### Ejemplos

```txt
Documento: SKILL.md
Role: Foundation
Purpose: Define el comportamiento base del skill y sus límites operativos.

Documento: anti-patterns.md
Role: Rule / Guardrail
Purpose: Registrar errores recurrentes que el agente debe evitar.

Documento: performance-contract-rubric.md
Role: Rubric
Purpose: Definir cómo se evalúa si el output cumple el contrato de calidad.

Documento: linear-issue-template.md
Role: Output template
Purpose: Estandarizar la creación de issues en Linear.
```

Este campo es clave porque convierte una lista de archivos en una arquitectura funcional de contexto.

## 9. Pantalla principal del Context Workspace

La pantalla debería funcionar como una mesa de trabajo.

### Estructura sugerida

```txt
Context Workspace: Itogai Skill System

Objective
Crear un sistema coherente de skills para agentes de producto, contrato y refactor.

Context Rules
- Separar metodología de entregables.
- Evitar contradicciones entre skills.
- Preservar intención operacional.
- No duplicar reglas si deben vivir en un documento fuente.

Documents
Document                         Role          Status       Purpose
SKILL.md                         Foundation    In Review    Define behavior base
anti-patterns.md                 Rule          Done         Prevent recurrent failures
routing-rules.md                 Rule source   Draft        Define routing logic
linear-template.md               Template      Done         Standardize Linear issues

Workspace Notes
- Open questions
- Risks
- Decisions
- Contradictions
- To dos

AI Context Review
[Analyze coherence] [Find contradictions] [Find missing context] [Generate context brief]
```

## 10. Modos de navegación

MVP recomendado:

```txt
Overview
Documents
Annotations
AI Review
```

### Overview

Vista de alto nivel:

```txt
- Objective
- Description
- Rules
- Context health summary
- Recent workspace notes
- Key documents
```

### Documents

Mesa de documentos:

```txt
- Document title
- Role
- Purpose
- Status
- Collections
- Annotation count
- Task count
- Structure / headings
- Preview action
```

### Annotations

Vista agregada de notas:

```txt
- Anotaciones locales de documentos
- Workspace notes
- Preguntas abiertas
- Riesgos
- Decisiones
- Contradicciones
```

### AI Review

Historial y acciones de inteligencia:

```txt
- Context Review
- Contradiction Review
- Overlap Review
- Missing Context Review
- Condensed Context Brief
```

## 11. Integración con Preview

Preview es una pieza clave para Context Workspace.

El usuario debe poder:

```txt
- Ver la mesa global.
- Abrir un documento en Preview.
- Revisar contenido, status, annotations y estructura.
- Cerrar Preview.
- Seguir en la vista global sin perder orientación.
```

Esto evita abrir y cerrar documentos completos constantemente.

Regla:

```txt
Context Workspace = vista global.
Preview = detalle rápido.
Editor = trabajo profundo.
```

## 12. Anotaciones dentro del workspace

Las anotaciones tienen dos niveles.

### Local annotation

Nota sobre un fragmento específico de un writing.

```txt
“Esto contradice la regla del skill de refactor.”
```

### Workspace note

Nota sobre el contexto completo.

```txt
Possible contradiction between Product Manager Skill and Refactor Skill.
```

### Promover anotaciones

Una anotación local puede promoverse a nota global del workspace.

```txt
Promote to workspace note:
- Insight
- Open question
- Risk
- Decision
- Contradiction
- Task
```

Esto permite que el pensamiento local se vuelva arquitectura de contexto.

## 13. Context Actions / AI Modes

No conviene exponer “skills” como concepto principal al usuario en V1. Internamente pueden existir skills o prompts especializados, pero en UI sería mejor hablar de:

```txt
Context Actions
Review Modes
Workspace Intelligence
```

### Acciones operativas

```txt
Review coherence
Find contradictions
Find missing context
Suggest source of truth
Suggest document consolidation
Prepare AI context bundle
Challenge assumptions
Suggest next document
```

### Acciones de aprendizaje

```txt
Build study brief
Compare positions
Extract key concepts
Find repeated claims
Map disagreements
Generate reading path
Explain key distinctions
```

## 14. Context Health

El workspace debería poder producir una lectura de salud del contexto.

No se recomienda comenzar con scores falsamente precisos. Mejor un diagnóstico cualitativo accionable.

### Ejemplo

```txt
Context status

This workspace has enough material to explain the project, but several rules are repeated across documents and the source of truth is unclear.

Main issues
- 3 documents repeat the same routing rules.
- 2 documents disagree on how strict the agent should be.
- No document defines the project’s success criteria.
- Several annotations contain decisions that are not reflected in source docs.
```

### Dimensiones del diagnóstico

```txt
Coverage
Coherence
Overlap
Contradictions / tensions
Distribution
Synthesis
```

## 15. Context Review

La feature más fuerte del workspace debería ser **Context Review**.

Pregunta central:

> ¿Este cuerpo de documentos está completo, coherente, ordenado y listo para cumplir su objetivo?

### Estructura sugerida del output

```txt
Context Review

1. Executive diagnosis
Estado general del workspace.

2. Coverage
Qué información está y qué falta.

3. Overlap
Qué se repite y dónde consolidarlo.

4. Contradictions / tensions
Qué documentos chocan o requieren clarificación.

5. Document roles
Qué papel parece cumplir cada documento.

6. Distribution issues
Qué información está en el lugar equivocado.

7. Suggested improvements
Acciones concretas para mejorar el workspace.

8. Condensed context brief
Versión breve para entender o reutilizar el contexto.
```

## 16. Coverage

Coverage analiza si está toda la información necesaria para cumplir el objetivo.

Ejemplo:

```txt
Objective:
Crear un sistema coherente de skills para agentes de producto, contrato y refactor.

Missing context:
- Falta documento de arquitectura general del sistema de skills.
- Falta decisión explícita sobre qué reglas son globales vs específicas.
- Falta guía de versionamiento.
- Falta criterio de suficiencia para considerar un skill listo.
```

Regla:

> “Falta” siempre significa “falta para qué”.

Por eso el objetivo del workspace es indispensable.

## 17. Coherence

Coherence analiza si los documentos se sostienen entre sí o se contradicen.

### Tipos de hallazgos

```txt
Hard contradiction
Tension
Different perspective
Needs clarification
```

No toda contradicción es mala. En aprendizaje o investigación, las tensiones pueden ser matices importantes.

Ejemplo:

```txt
Potential contradiction:
SKILL.md says the agent should infer routing based on context.
reference-doc-routing-rules.md says routing must be explicit and deterministic.

Why it matters:
This creates ambiguity for agents deciding which document governs behavior.
```

## 18. Overlap

Overlap detecta información repetida.

Ejemplo:

```txt
Repeated concept:
“Do not generalize beyond available context” appears in:
- SKILL.md
- anti-patterns.md
- performance-contract-rubric.md

Recommendation:
Keep the rule in anti-patterns.md as the canonical source.
Reference it from SKILL.md instead of duplicating it.
```

Esto es especialmente importante cuando los documentos son generados por IA, porque la IA tiende a repetir, expandir y reexplicar.

## 19. Distribution

Distribution analiza si cada información vive en la pieza correcta.

Ejemplo:

```txt
This decision appears in an annotation but should be promoted to a workspace rule:
“Global strategic constraints should be tracked at workspace level, not per document.”

Suggested action:
Promote annotation to Workspace Rule.
```

Acciones posibles:

```txt
Promote to Workspace Rule
Promote to Decision
Promote to Open Question
Promote to Risk
Promote to Task
Suggest source document update
```

## 20. Synthesis / Context Brief

El workspace debe poder generar una vista condensada de lo que hay que saber.

### Para contexto operativo

```txt
Context Brief

What this workspace is trying to produce
...

Key rules
...

Source of truth
...

Open questions
...

Risks
...

Next recommended action
...
```

### Para aprendizaje

```txt
Study Brief

What this workspace is about
...

Key ideas
...

Important distinctions
...

Competing positions
...

Repeated claims
...

Open questions
...

What to read first
...
```

Esto permite entender el conjunto sin abrir todos los documentos.

## 21. Acciones accionables desde los hallazgos

Los hallazgos de AI no deberían quedarse como texto estático. Deben convertirse en acciones.

Ejemplos:

```txt
Missing context
[Create document] [Add note] [Ignore]

Overlap detected
[Mark canonical] [Consolidate] [Ignore]

Contradiction found
[Create decision] [Add clarification] [Ignore]

Annotation should be promoted
[Promote to workspace rule] [Ignore]
```

Esto transforma Context Review en una herramienta de mejora del contexto, no solo en un reporte.

## 22. Context Workspace y AI-generated documents

Muchos documentos generados con IA tienen problemas similares:

```txt
- Repiten definiciones.
- Agregan explicaciones generales.
- Cambian matices entre versiones.
- Parecen completos pero dejan huecos.
- No distinguen fuente, output, regla y comentario.
```

Context Workspace puede funcionar como un sistema de control de calidad para estos documentos.

Pregunta central:

> ¿Este corpus generado o asistido por IA está produciendo claridad o está inflando el contexto?

## 23. MVP recomendado

### V1 — Context Workspace básico

Funcionalidades:

```txt
1. Crear Context Workspace.
2. Agregar name, objective, description y context rules.
3. Agregar writings al workspace.
4. Asignar role y purpose a cada writing.
5. Ver documentos en tabla global.
6. Ver status, collections, annotations count y preview.
7. Crear workspace notes.
8. Abrir documentos en Preview desde el workspace.
```

No incluir todavía:

```txt
- Grafo visual.
- Relaciones complejas padre/hijo.
- Colaboración en tiempo real.
- Task manager completo.
- Sync con Linear/Notion.
```

### V2 — Workspace Intelligence

Funcionalidades:

```txt
1. Ejecutar Context Review.
2. Detectar missing context.
3. Detectar overlaps.
4. Detectar contradictions/tensions.
5. Sugerir document roles.
6. Generar condensed context brief.
7. Convertir hallazgos en notes/tasks/rules.
```

### V3 — Context Architecture

Funcionalidades futuras:

```txt
1. Relaciones entre documentos.
2. Source of truth explícito.
3. Document graph.
4. derived_from / supports / contradicts / replaces / depends_on.
5. Vista de mapa si el uso real lo justifica.
```

## 24. Qué no construir al inicio

Para evitar sobrecomplicar:

```txt
No construir un Notion-lite.
No construir un Linear-lite.
No construir coworking/collaboration como premisa inicial.
No empezar por un grafo visual.
No convertirlo en task manager.
No exponer “skills” como concepto principal en la UI.
No aplicar cambios automáticos sin revisión del usuario.
```

## 25. Lenguaje de producto

### Definición corta

> Context Workspace is a working table for a body of writing.

### Definición más clara

> A space to work with many documents as a living context, not as isolated files.

### En español

> Un espacio para trabajar con muchos documentos como un contexto vivo, no como archivos aislados.

### Diferencia contra collections

```txt
Una collection dice:
“Estos textos son sobre Harness.”

Un Context Workspace dice:
“Estos documentos juntos están construyendo el skill system de Itogai, y cada uno cumple un papel dentro del contexto.”
```

## 26. Issues sugeridos para Linear

### Issue 1 — Create Context Workspace model

Crear entidad `ContextWorkspace` con:

```txt
name
objective
description
contextType
contextRules
successCriteria
status
```

Criterios:

```txt
- Crear workspace.
- Editar metadata.
- Listar workspaces.
- Abrir workspace detail.
```

### Issue 2 — Add writings to Context Workspace

Permitir vincular writings existentes a un workspace.

Criterios:

```txt
- Agregar desde Desk.
- Agregar desde Writing view.
- Agregar por bulk selection.
- Evitar duplicados.
```

### Issue 3 — Add role and purpose per workspace document

Cada writing dentro del workspace debe tener:

```txt
role
purpose
importance
notes
```

Criterios:

```txt
- Role editable.
- Purpose editable.
- Mostrar en tabla.
- No afecta el writing global fuera del workspace.
```

### Issue 4 — Build Context Workspace overview screen

Crear pantalla principal del workspace.

Debe mostrar:

```txt
- Objective
- Description
- Context rules
- Key documents
- Workspace notes
- AI Review entry point
```

### Issue 5 — Build workspace documents table

Crear tabla de documentos del workspace.

Columnas MVP:

```txt
Document
Role
Purpose
Status
Collections
Annotations
Tasks
Preview
```

Criterios:

```txt
- Permitir filtrar o agrupar por role/status.
- Permitir abrir Preview.
- Permitir editar role y purpose.
```

### Issue 6 — Add workspace notes

Crear notas globales del workspace.

Tipos:

```txt
Insight
Open question
Risk
Decision
Contradiction
Task
```

Criterios:

```txt
- Crear nota global.
- Ver notas por tipo.
- Marcar resolved/ignored si aplica.
```

### Issue 7 — Promote annotation to workspace note

Permitir convertir una anotación local en nota global del workspace.

Criterios:

```txt
- Elegir workspace.
- Elegir type.
- Mantener referencia a sourceAnnotationId.
- Permitir navegar de la nota global a la anotación original.
```

### Issue 8 — Add Context Review action

Crear acción de IA para revisar el workspace completo.

Output:

```txt
Executive diagnosis
Coverage
Overlap
Contradictions / tensions
Document roles
Distribution issues
Suggested improvements
Condensed context brief
```

### Issue 9 — Persist Context Review results

Guardar resultados de Context Review.

Criterios:

```txt
- Historial de reviews.
- Fecha de ejecución.
- Modelo/proveedor usado si aplica.
- Resultados estructurados.
- Estado: draft/reviewed/applied.
```

### Issue 10 — Convert review findings into actions

Permitir convertir hallazgos en:

```txt
Workspace note
Workspace rule
Task
Document update suggestion
New document suggestion
```

Criterios:

```txt
- Cada finding debe tener acciones disponibles.
- El usuario decide qué aplicar.
- No aplicar cambios automáticamente.
```

### Issue 11 — Generate Context Brief

Crear acción para generar una vista condensada del workspace.

Versiones:

```txt
Operational Context Brief
Study Brief
Research Brief
```

Criterios:

```txt
- Debe usar objective y contextType.
- Debe incluir key ideas, open questions y recommended reading/order.
```

### Issue 12 — Detect overlap across workspace documents

Crear revisión específica para detectar repetición.

Criterios:

```txt
- Identificar conceptos repetidos.
- Mostrar documentos afectados.
- Sugerir canonical source.
- Sugerir consolidación.
```

### Issue 13 — Detect contradictions and tensions

Crear revisión específica para contradicciones.

Criterios:

```txt
- Clasificar como hard contradiction, tension, different perspective o needs clarification.
- Mostrar documentos involucrados.
- Explicar por qué importa.
- Sugerir acción.
```

### Issue 14 — Detect missing context against objective

Crear revisión de cobertura.

Criterios:

```txt
- Usar objective como criterio.
- Identificar información faltante.
- Sugerir documentos o secciones a crear.
- Explicar prioridad.
```

## 27. Prioridad recomendada

### P0 — Base estructural

```txt
1. Create Context Workspace model.
2. Add writings to Context Workspace.
3. Add role and purpose per workspace document.
4. Build workspace overview screen.
5. Build workspace documents table.
```

### P1 — Notas y navegación

```txt
6. Add workspace notes.
7. Promote annotation to workspace note.
8. Integrate Preview from workspace documents table.
```

### P2 — Intelligence layer

```txt
9. Add Context Review action.
10. Persist Context Review results.
11. Generate Context Brief.
```

### P3 — Diagnóstico avanzado

```txt
12. Detect overlap.
13. Detect contradictions and tensions.
14. Detect missing context against objective.
15. Convert review findings into actions.
```

### P4 — Context architecture futura

```txt
16. Add document relations.
17. Add source of truth management.
18. Add context map / graph view.
```

## 28. Principios finales

### Producto

> Context Workspace no es una carpeta. Es una mesa de trabajo para un cuerpo de contexto.

### Experiencia

> El usuario debe poder ver el todo, abrir la parte, volver al todo y entender cómo cada documento contribuye al objetivo.

### IA

> La IA no solo resume documentos. Audita si el contexto está completo, coherente, ordenado y listo para cumplir su objetivo.

### Control

> La IA puede sugerir reorganización, consolidación o nuevas piezas de contexto, pero el usuario decide qué aplicar.

### Scope

> Primero roles, propósito, notas y preview. Después inteligencia. El grafo visual viene solo si el uso real demuestra que hace falta.
