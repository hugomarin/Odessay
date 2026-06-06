# Funcionalidad propuesta: Table of Contents automático en Odessay

## 1. Tesis de producto

La funcionalidad de **Table of Contents** permite que Odessay genere automáticamente un índice navegable a partir de la estructura del texto.

El objetivo no es solo mostrar una lista de encabezados, sino mejorar la orientación dentro de documentos largos.

> En textos largos, el índice no es decoración. Es una forma de navegación, comprensión y control estructural.

## 2. Problema que resuelve

Cuando un writing crece, el usuario pierde orientación:

```txt
- No sabe rápidamente qué secciones existen.
- No puede saltar entre partes del texto.
- No ve si la estructura está balanceada.
- No detecta secciones demasiado largas o mal jerarquizadas.
- No entiende fácilmente la arquitectura del documento.
```

Esto afecta especialmente:

```txt
- Ensayos largos.
- Documentos técnicos.
- Research notes.
- Manuales.
- Context briefs.
- Documentos generados o asistidos por IA.
```

## 3. Comportamiento esperado

Odessay debe leer los headings del documento y generar un índice automático.

### Input

```md
# El harness como sistema operativo del agente

## 1. Clasificación del video

### Arquitectónico

### Metodológico

## 2. Tesis central

## 3. Implicaciones para Deus
```

### Output visual

```txt
El harness como sistema operativo del agente
  1. Clasificación del video
    Arquitectónico
    Metodológico
  2. Tesis central
  3. Implicaciones para Deus
```

## 4. Alcance inicial

La primera versión debe soportar:

```txt
h1
h2
h3
```

No es necesario incluir h4, h5 o h6 en MVP, porque pueden volver el índice demasiado granular.

### Regla

```txt
ToC MVP = h1 + h2 + h3
```

## 5. Integración con Tiptap

Tiptap ya tiene las piezas necesarias para implementar esta funcionalidad.

### Extensiones relevantes

```txt
Heading
TableOfContents
UniqueID
```

### Configuración conceptual

```ts
import Heading from '@tiptap/extension-heading'
import UniqueID from '@tiptap/extension-unique-id'
import { TableOfContents } from '@tiptap/extension-table-of-contents'

const editor = useEditor({
  extensions: [
    Heading.configure({
      levels: [1, 2, 3],
    }),

    UniqueID.configure({
      types: ['heading'],
    }),

    TableOfContents.configure({
      anchorTypes: ['heading'],
      onUpdate: items => {
        setTocItems(items)
      },
    }),
  ],
})
```

## 6. IDs estables

Los headings deben tener IDs estables para navegación interna.

### Problema

Si los IDs cambian en cada render, se rompen:

```txt
- Links internos.
- Scroll hacia heading.
- Navegación desde ToC.
- Anclajes compartibles.
```

### Propuesta

Usar `UniqueID` o una estrategia propia de slug persistente.

```html
<h2 id="tesis-central">Tesis central</h2>
```

### Regla

```txt
Cada heading navegable debe tener un ID estable.
```

## 7. UI sugerida

El índice puede vivir en el panel lateral derecho o como una pestaña dentro del panel de documento.

### Opción A — Panel derecho

```txt
DOCUMENT
- Índice
- Anotaciones
- Comentarios
- Preparar para AI
```

### Opción B — Tabs

```txt
Anotaciones | Índice | AI
```

### Opción C — Dropdown compacto

Para documentos cortos:

```txt
Outline
- Introducción
- Tesis central
- Conclusión
```

## 8. Render del ToC

Ejemplo de componente:

```tsx
function TocPanel({ items }) {
  return (
    <nav>
      {items.map(item => (
        <button
          key={item.id}
          style={{ paddingLeft: `${(item.level - 1) * 16}px` }}
          onClick={() => item.scrollTo()}
        >
          {item.textContent}
        </button>
      ))}
    </nav>
  )
}
```

### Estados útiles

Cada item debería poder mostrar:

```txt
- heading activo
- nivel
- texto
- scroll target
- si tiene hijos
```

## 9. ToC + annotations

Una mejora importante para Odessay es cruzar el índice con anotaciones.

Ejemplo:

```txt
1. Clasificación del video        3 anotaciones
  Arquitectónico                 1 anotación
  Metodológico                   2 anotaciones
2. Tesis central                  0 anotaciones
```

Esto permite ver dónde está concentrado el pensamiento o la revisión.

### MVP posterior

```txt
- Mostrar annotation count por heading.
- Click en count abre anotaciones de esa sección.
- Filtrar anotaciones por sección.
```

## 10. ToC insertable dentro del documento

Además del panel lateral, se puede permitir insertar un índice dentro del documento.

### Sintaxis posible

```md
[[toc]]
```

O un node Tiptap propio:

```txt
TableOfContentsNode
```

### Recomendación

No incluir en MVP inicial si complica el editor. Primero construir ToC lateral/navegable. Después agregar ToC insertable si hay demanda.

## 11. AI-assisted outline

La versión avanzada no solo lee headings existentes. También puede sugerir mejoras estructurales.

### Acciones posibles

```txt
Suggest missing headings
Detect weak structure
Find sections that are too long
Detect repeated headings
Suggest better section names
Generate outline from messy text
```

### Ejemplo

```txt
AI suggestion:
The section “Notas varias” contains three distinct ideas. Consider splitting it into:
- Context degradation
- Agent routing
- Evaluation criteria
```

Esto puede ser funcionalidad premium o parte de AI writing review.

## 12. Criterio de producto

ToC debería ser funcionalidad core/free, no necesariamente paga.

Razón:

```txt
- Mejora la experiencia básica de documentos largos.
- Refuerza la idea de Odessay como hogar serio para textos.
- No requiere IA.
- Aumenta la percepción de calidad del editor.
```

Lo pago puede ser:

```txt
- AI-assisted outline.
- Reestructuración automática.
- Sugerencias de headings.
- Outline critique.
```

## 13. MVP recomendado

```txt
1. Detectar h1/h2/h3.
2. Generar índice lateral.
3. Permitir click para navegar.
4. Resaltar heading activo.
5. Usar IDs estables.
6. Mantener actualizado al editar.
```

## 14. Issues sugeridos para Linear

### Issue 1 — Add Heading-based ToC support

Generar índice automático desde headings h1/h2/h3 del documento.

Criterios:

```txt
- Detectar headings.
- Construir estructura jerárquica.
- Actualizar al editar.
```

### Issue 2 — Add stable heading IDs

Agregar IDs estables a headings.

Criterios:

```txt
- IDs persistentes.
- Compatibles con navegación.
- No deben cambiar en cada render.
```

### Issue 3 — Build ToC sidebar panel

Crear UI de índice en panel lateral.

Criterios:

```txt
- Mostrar niveles h1/h2/h3.
- Indentar según nivel.
- Click navega al heading.
- Resaltar sección activa.
```

### Issue 4 — Connect ToC with annotations

Mostrar conteo de anotaciones por sección.

Criterios:

```txt
- Calcular qué anotaciones pertenecen a qué heading.
- Mostrar count junto al heading.
- Permitir filtrar anotaciones por sección.
```

### Issue 5 — Add AI outline suggestions

Agregar función avanzada para sugerir mejoras estructurales.

Criterios:

```txt
- Detectar secciones largas.
- Sugerir headings faltantes.
- Sugerir renombres de secciones.
- No aplicar cambios sin confirmación.
```

## 15. Prioridad recomendada

### P0

```txt
1. Heading-based ToC.
2. Stable heading IDs.
3. Sidebar navigation.
```

### P1

```txt
4. Active heading state.
5. Annotation counts by section.
```

### P2

```txt
6. ToC insertable.
7. AI outline suggestions.
```

## 16. Principio final

> El índice debe ayudar al usuario a orientarse dentro del texto y entender su estructura sin salir del flujo de escritura.
