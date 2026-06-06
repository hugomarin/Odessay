# Propuesta de mejoras para Desk en Odessay

## Contexto

La pantalla **Desk** funciona como biblioteca operativa de escritos: muestra actividad reciente, escritos propios, escritos compartidos, filtros, estatus, colecciones y acciones rápidas. Actualmente mezcla dos lógicas distintas:

1. **Actividad reciente**: textos trabajados últimamente.

2. **Biblioteca estable**: listado de writings que el usuario necesita navegar sin que cambien de posición inesperadamente.

El objetivo de estas mejoras es separar mejor ambas lógicas para que Desk sea más claro, estable y útil.

## 1. Renombrar y redefinir “Open Drafts”

### Problema

La sección superior actualmente se llama **Open Drafts**, pero no necesariamente muestra drafts abiertos. En realidad debería representar los escritos trabajados recientemente.

Además, si usa `updatedAt`, cualquier cambio administrativo —estatus, tags, collections, sharing— puede empujar un writing arriba aunque el texto no haya sido trabajado realmente.

### Propuesta

Renombrar la sección a:

- **Recent Writings**

- Alternativa en español: **Cambios recientes en tus escritos**

- Alternativa más conceptual: **Recently Worked On**

### Comportamiento esperado

La sección debe mostrar los últimos 10 o 20 escritos trabajados recientemente.

```txt
Recent Writings
- Últimos 10/20 writings
- Ordenados por contentUpdatedAt DESC
- Solo cambios reales de contenido los mueven
- Cambios de status, tags, collections o sharing no los mueven
```

### Criterio técnico

Separar timestamps:

```ts
updatedAt          // cualquier cambio del registro
contentUpdatedAt   // cambios reales de texto, título o contenido editorial
metadataUpdatedAt  // status, tags, collections, visibility, sharing
createdAt          // fecha de creación
```

La sección **Recent Writings** debe usar `contentUpdatedAt DESC`.

## 2. Mejorar cards de Recent Writings

### Problema

Las cards superiores muestran el status como texto plano tipo `IN REVIEW`, pero no usan el mismo lenguaje visual que el listado principal. Además, no muestran claramente las collections asociadas.

### Propuesta

Cada card debe mostrar:

- Status badge con ícono y diseño consistente.

- Título del writing.

- Preview del contenido.

- Collections como chips.

- Word count.

- Opcional: fecha de último trabajo real sobre el contenido.

Ejemplo conceptual:

```txt
[icon] In Review
01 — Deus Harness Context Brief...
Strategic Planning Skill Purpose...
[Harness] [AI]                         2986 words
```

### Componentes sugeridos

```tsx
<WritingStatusBadge status="in_review" />
<CollectionChips collections={writing.collections} limit={2} />
```

### Regla de diseño

El status debe usar un componente único en toda la app:

- Cards superiores.

- Lista principal.

- Filtros.

- Dropdowns.

- Vista de writing.

## 3. Normalizar diseño de status

### Problema

Los estados aparecen en distintos lugares y podrían terminar con diseños inconsistentes.

### Propuesta

Crear o consolidar un componente único:

```tsx
<WritingStatusBadge status={status} />
```

### Estados esperados

```txt
Exploring
Draft
In Review
Done
```

Posibles estados futuros:

```txt
Archived
Published
```

### Criterios

Cada estado debe tener:

- Ícono.

- Label.

- Color/surface suave.

- Variante compacta para cards.

- Variante completa para lista o dropdown.

## 4. Corregir contador de “Shared with Me”

### Problema

La pestaña **Shared with Me** muestra `0`, aunque existe al menos un writing compartido.

### Hipótesis

El contador probablemente está usando la query incorrecta:

- Cuenta solo writings donde `ownerId === currentUser.id`.

- O cuenta únicamente los writings visibles en la lista actual.

- O no está consultando la tabla de shares/collaborators.

### Propuesta

Separar claramente las queries:

```txt
My writings = writings where ownerId === currentUser.id

Shared with me = writings where:
- currentUser tiene permiso/collaboration/share record
- ownerId !== currentUser.id
```

### Criterio de aceptación

Si el usuario tiene un writing compartido, la pestaña debe mostrar el conteo correcto aunque el writing no sea suyo.

## 5. Separar filtros, agrupación y ordenamiento

### Problema

Actualmente existen filtros por collection y status, pero falta una lógica explícita de agrupación. Filtrar y agrupar son operaciones distintas.

### Definición

```txt
Filter = qué items entran en la lista
Group by = cómo se organizan visualmente los items que ya entraron
Sort = en qué orden aparecen los items
```

### Propuesta de UI

Evolucionar la barra actual:

```txt
Filter by name... | Collections | Status
```

hacia algo como:

```txt
Search... | Collections | Status | Group by | Sort
```

O una versión más compacta:

```txt
Search... | Filter | Group | Sort
```

### Filtros MVP

```txt
Collection
Status
Created date
```

### Group by MVP

```txt
None
Status
Collection
Created date
```

### Sort MVP

```txt
Created date
Recently worked on
Title
```

## 6. Agrupar por status, collection y fecha de creación

### Group by: Status

Agrupa writings por estado:

```txt
Exploring
Draft
In Review
Done
```

Este caso es simple porque cada writing debería tener un solo status.

### Group by: Collection

Agrupa writings por collection.

Riesgo: si un writing puede tener varias collections, hay ambigüedad.

Opciones:

1. Usar `primaryCollection`.

2. Duplicar el writing en varios grupos.

3. Mostrarlo en `Multiple collections`.

4. Postergar agrupación por collection si no hay modelo claro.

Recomendación MVP: usar `primaryCollection` si existe. Si no existe, mostrar en `No collection`.

### Group by: Created date

Agrupar por buckets:

```txt
Today
This week
This month
Earlier
```

Alternativa para mucho histórico:

```txt
May 2026
April 2026
March 2026
```

### Group by: Tags

Postergar para una segunda fase.

Riesgo: un writing puede tener múltiples tags. Eso obliga a decidir si el item se duplica en varios grupos o si existe un tag primario.

## 7. Estabilizar ordenamiento de la lista principal

### Problema

La lista principal parece ordenarse por cambios recientes. Eso genera un comportamiento extraño: si el usuario modifica el status de un writing que está abajo, el item sube a `Today` o al inicio de la lista.

Esto rompe la orientación espacial del usuario.

### Propuesta

La lista principal debe estar ordenada por **fecha de creación** por defecto.

```txt
Default:
Sort by createdAt DESC
Group by None
```

Los cambios de status, tags, collections o sharing no deben mover el item de posición.

### Regla

```txt
Recent Writings arriba = actividad reciente de contenido.
Main list abajo = biblioteca estable.
```

Si el usuario quiere ordenar por actividad, debe elegir explícitamente:

```txt
Sort by: Recently worked on
```

Ese sort debe usar `contentUpdatedAt`, no `updatedAt`.

## 8. Fecha de creación como filtro, agrupación y sort

### Propuesta

Agregar soporte para fecha de creación en tres niveles:

Filter by created date

```txt
Created:
- Today
- Last 7 days
- Last 30 days
- This year
- Custom range
```

Group by created date

```txt
Today
This week
This month
Earlier
```

Sort by created date

```txt
Newest first
Oldest first
```

### Criterio

La fecha de creación no debe cambiar nunca. Es útil para organizar biblioteca porque mantiene los documentos quietos.

## 9. Modelo conceptual recomendado para Desk

Desk debería dividir mentalmente la pantalla en dos zonas:

### A. Recent Writings

Actividad reciente real.

```txt
¿Qué textos trabajé últimamente?
```

Usa `contentUpdatedAt`.

### B. Writing Library

Biblioteca estable.

```txt
¿Qué escritos tengo y cómo quiero organizarlos?
```

Usa `createdAt` por defecto, con filtros, grouping y sort explícitos.

## 10. Issues sugeridos para Linear

### Issue 1 — Rename and redefine Open Drafts as Recent Writings

Cambiar el título de la sección superior de `Open Drafts` a `Recent Writings`.

La sección debe mostrar los últimos 10/20 writings ordenados por `contentUpdatedAt DESC`.

No deben contar como actividad reciente:

- Cambios de status.

- Cambios de tags.

- Cambios de collections.

- Cambios de sharing/visibility.

### Issue 2 — Add status badges and collection chips to Recent Writings cards

Actualizar las cards de Recent Writings para incluir:

- `WritingStatusBadge`.

- Collection chips.

- Word count.

- Preview del contenido.

Las cards deben usar el mismo lenguaje visual de status que el resto de la app.

### Issue 3 — Normalize writing status UI

Crear o consolidar un componente único para mostrar status.

Estados iniciales:

```txt
Exploring
Draft
In Review
Done
```

Debe poder usarse en:

- Recent Writings cards.

- Writing list.

- Status filter.

- Status dropdown.

### Issue 4 — Fix Shared with Me counter

Corregir el contador de `Shared with Me`.

Debe contar writings donde el usuario actual tiene acceso, pero no es owner.

```txt
ownerId !== currentUser.id
AND currentUser has share/collaboration permission
```

### Issue 5 — Stabilize main writing list ordering

Cambiar el ordenamiento default de la lista principal a `createdAt DESC`.

Los cambios de metadata no deben mover items en la lista.

Separar timestamps:

```ts
updatedAt
contentUpdatedAt
metadataUpdatedAt
createdAt
```

### Issue 6 — Add Group by control to Desk

Agregar control de agrupación separado de filtros.

MVP:

```txt
None
Status
Collection
Created date
```

La agrupación debe organizar visualmente los writings ya filtrados.

### Issue 7 — Add Created date filter and sort support

Agregar soporte para filtrar, agrupar y ordenar por fecha de creación.

Filtros sugeridos:

```txt
Today
Last 7 days
Last 30 days
This year
Custom range
```

Agrupación sugerida:

```txt
Today
This week
This month
Earlier
```

## 11. Prioridad recomendada

### P0 — Bugs y estabilidad conceptual

1. Fix `Shared with Me` counter.

2. Stabilize main writing list ordering.

3. Separate `contentUpdatedAt` from metadata updates.

### P1 — Mejora visible de UI

4. Rename `Open Drafts` to `Recent Writings`.

5. Add status badges and collection chips to Recent Writings cards.

6. Normalize status UI.

### P2 — Organización avanzada

7. Add Group by control.

8. Add Created date filter/group/sort.

9. Evaluate grouping by tags after defining tag ambiguity rules.

## 12. Principio de producto

La regla central para Desk debería ser:

> **Recent Writings muestra actividad. La lista principal muestra biblioteca.**

Esto evita que la pantalla se sienta inestable y permite que el usuario entienda por qué un texto aparece arriba: porque fue trabajado recientemente, no porque cambió su metadata.
