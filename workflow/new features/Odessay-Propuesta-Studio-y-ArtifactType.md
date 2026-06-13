# Propuesta: Studio Navigation y Artifact Type

## Contexto

Este documento propone dos nuevas funcionalidades para Odessay:

1. **Studio**: botón de navegación en el sidebar para volver al editor sin crear un nuevo writing.
2. **Artifact Type**: campo de clasificación en el panel de propiedades del artifact.

---

## 1. Studio — Navegación directa al editor

### Problema

El editor de documentos (vista de escritura) solo es accesible creando un nuevo writing. Si el usuario está en Desk, Workspace o colecciones y quiere volver a un documento que ya estaba editando, no hay forma directa de hacerlo: la única opción es crear uno nuevo.

Esto obliga a flujos innecesarios y rompe la continuidad del trabajo editorial.

### Propuesta

Agregar **Studio** como ítem de navegación en el sidebar, al mismo nivel que Desk y Search.

```txt
Sidebar:
+ New Artifact
  Search
  Desk
  Studio       ← nuevo
  Workspace
    Tutorial
    OS
    Skill
    ...
```

Studio representa la vista del editor: el espacio donde se trabaja el contenido de un artifact. Funciona como "volver al editor" sin depender de abrir un writing nuevo.

### Comportamiento

**Caso A: hay documents abiertos en el editor**

Navegar a Studio muestra los artifacts que el usuario tenía abiertos en la sesión actual, exactamente como los dejó. Funciona como retomar el trabajo donde se dejó.

**Caso B: el Studio está vacío (sin documents abiertos)**

La pantalla muestra un estado vacío que invita al usuario a abrir o crear un artifact.

```txt
Studio vacío:
  [Ícono de lápiz o documento]
  No hay nada abierto en el Studio.
  [Open artifact]  [New artifact]
```

El botón `Open artifact` abre un picker sobre los artifacts existentes del usuario para elegir cuál editar.

### Estado de la sesión

Studio mantiene el estado de los artifacts abiertos durante la sesión. Si el usuario navega a Desk y vuelve, Studio conserva lo que tenía.

El criterio de "qué está abierto" es por sesión de app, no por sync en servidor. No se requiere persistencia cross-device en MVP.

**Opcional para una segunda fase:** persistir en el servidor los últimos N artifacts visitados en el editor, para restaurar el Studio al abrir la app.

### Regla conceptual

```txt
Desk = biblioteca.    ¿Qué artifacts tengo?
Studio = editor.      ¿En qué artifact estoy trabajando ahora?
```

Studio no reemplaza Desk. Es el camino de vuelta al editor cuando ya existe algo en lo que se está trabajando.

### Issues sugeridos para Linear

**Issue A1 — Add Studio to sidebar navigation**

Agregar Studio como ítem de navegación principal en el sidebar.

Comportamiento esperado:
- Click en Studio navega a la vista del editor.
- Si hay artifacts abiertos en la sesión, los muestra.
- Si Studio está vacío, muestra estado vacío con acciones `Open artifact` y `New artifact`.

**Issue A2 — Studio empty state**

Diseñar e implementar el estado vacío de Studio.

Debe incluir:
- Mensaje explicativo.
- Botón `Open artifact` que abre picker de artifacts del usuario.
- Botón `New artifact` que abre el flujo de creación.

**Issue A3 — Preserve open artifacts in Studio across navigation (session)**

Implementar retención de estado del editor al navegar fuera de Studio.

Cuando el usuario navega a Desk o Workspace y regresa a Studio, los artifacts que tenía abiertos deben seguir ahí.

Alcance MVP: solo durante la sesión activa (no requiere persistencia en servidor).

---

## 2. Artifact Type — Clasificación de artifacts

### Problema

Todos los artifacts son tratados igual en la app. No hay forma de distinguir si un artifact es un prompt, un contexto para un agente, una plantilla o documentación de status. Esto dificulta organizar la biblioteca cuando el usuario trabaja con múltiples tipos de contenido.

### Propuesta

Agregar el campo **Artifact Type** al panel de propiedades del artifact.

```txt
Panel de propiedades:
  Status       [Draft ▾]
  Artifact Type [Agent ▾]   ← nuevo
  Workspace    [Tutorial ▾]
```

El campo aparece en el panel derecho de propiedades, debajo de Status.

### Tipos de artifact

```txt
General       — Documento sin clasificación específica (default)
Agent         — Contexto o instrucciones para un agente de IA
Skill         — Definición de habilidad o capacidad
Prompt        — Prompt diseñado para ser reutilizado
Template      — Plantilla de documento o estructura
Status        — Documento de estado de proyecto o tarea
```

Cada tipo tiene un ícono y un label. El tipo `General` es el valor por defecto para no romper artifacts existentes.

### Ícono por tipo

```txt
General     — documento en blanco
Agent       — figura con gafas / robot
Skill       — rayo o engranaje
Prompt      — bocadillo de chat
Template    — cuadrícula o layout
Status      — semáforo o punto de estado
```

### Comportamiento en Desk

El Artifact Type se puede usar como:
- **Filtro**: mostrar solo artifacts de tipo Agent.
- **Agrupación** (fase 2): agrupar biblioteca por tipo de artifact.

El Artifact Type debe integrarse con el sistema de filtros existente de Desk.

### Modelo de datos

```ts
type ArtifactType =
  | 'general'
  | 'agent'
  | 'skill'
  | 'prompt'
  | 'template'
  | 'status'

// En el modelo de writing/artifact:
artifactType: ArtifactType  // default: 'general'
```

La columna debe tener valor default `'general'` para que los artifacts existentes no queden en estado nulo.

### Issues sugeridos para Linear

**Issue B1 — Add artifactType field to artifact model**

Agregar el campo `artifactType` al modelo de datos del artifact (writing).

Tipos:
```txt
general | agent | skill | prompt | template | status
```

Default: `general`. La migración de base de datos debe asignar `general` a todos los artifacts existentes.

**Issue B2 — Add Artifact Type selector to properties panel**

Agregar el selector de Artifact Type en el panel de propiedades del artifact, debajo del campo Status.

El selector debe:
- Mostrar ícono + label del tipo actual.
- Al hacer click, abrir un dropdown con todos los tipos disponibles.
- Actualizar el campo en la base de datos al seleccionar.

Debe ser visualmente consistente con el selector de Status del mismo panel.

**Issue B3 — Add Artifact Type filter to Desk**

Integrar Artifact Type como opción de filtro en la barra de filtros de Desk.

El filtro debe:
- Aparecer junto a los filtros existentes (Collection, Status).
- Permitir seleccionar uno o varios tipos.
- Actualizar la lista de artifacts filtrados en tiempo real.

---

## Prioridad recomendada

### P0 — Modelo y navegación base

1. Add `artifactType` field to artifact model (B1).
2. Add Studio to sidebar navigation (A1).

### P1 — UI visible

3. Add Artifact Type selector to properties panel (B2).
4. Studio empty state (A2).

### P2 — Integración con biblioteca

5. Add Artifact Type filter to Desk (B3).
6. Preserve open artifacts in Studio across navigation (A3).

---

## Principio de producto

> **Studio es adónde vas a trabajar. Desk es adónde vas a organizar.**

> **Artifact Type responde: ¿para qué sirve este documento?**

Estas dos funciones resuelven problemas de orientación distintos: Studio elimina la fricción de volver al editor; Artifact Type da semántica a la biblioteca para que sea navegable conforme crece.
