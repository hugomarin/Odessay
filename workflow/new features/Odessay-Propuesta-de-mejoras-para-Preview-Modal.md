# Propuesta de mejoras para Preview Modal en Odessay

## Contexto

La pantalla de **Preview** permite revisar rápidamente un writing desde Desk sin abrirlo en el editor completo. Su papel debería crecer dentro del producto: no solo mostrar una vista previa, sino permitir inspeccionar, clasificar y ejecutar acciones rápidas sobre un documento.

La intención principal:

> **Preview permite inspeccionar y actuar sobre un writing sin romper el flujo de Desk.**

El editor completo es para trabajar el texto. Preview debe ser para revisar, clasificar, compartir, exportar, eliminar o decidir si vale la pena abrir el writing.

## 1. Redefinir Preview como “Document Quick View”

### Problema

La pantalla actual funciona como una vista previa básica. Muestra el documento y algunas propiedades, pero todavía no se siente como una estación ligera de revisión.

### Propuesta

Convertir Preview en una vista rápida funcional:

```txt
Preview / Quick View
- Leer documento rápidamente
- Ver propiedades
- Cambiar status
- Ver collections
- Ver anotaciones
- Exportar
- Compartir
- Eliminar / mover a trash
- Abrir en editor completo
```

### Principio

```txt
Desk = biblioteca y navegación
Preview = inspección y acciones rápidas
Editor = trabajo profundo sobre el texto
```

## 2. Mejorar overlay con efecto glass

### Problema

El overlay actual oscurece el fondo, pero el Desk sigue generando ruido visual. La intención debería ser mantener contexto sin competir con el documento.

### Propuesta visual

Usar un overlay más blanco, difuso y con blur para crear una sensación tipo glass.

Ejemplo CSS:

```css
.preview-overlay {
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(18px) saturate(1.15);
  -webkit-backdrop-filter: blur(18px) saturate(1.15);
}
```

Capa adicional opcional:

```css
.preview-overlay::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 120px rgba(255, 255, 255, 0.35);
}
```

### Criterio visual

El Desk debe seguir percibiéndose detrás, pero como contexto atmosférico, no como ruido.

```txt
Antes: pantalla oscurecida
Después: documento flotando sobre vidrio
```

## 3. Mejorar jerarquía del modal

### Estructura recomendada

```txt
Header
- Navegación entre documentos
- Contador: 1 of 64
- Acciones rápidas
- Close

Main preview
- Título
- Contenido renderizado
- Scroll interno

Properties / Actions panel
- Status
- Collections
- Metadata
- Annotations
- Export
- Share
- Delete / More
```

### Ajuste conceptual

El label `PREVIEW` puede permanecer, pero no debe ser la pieza principal del header. Las acciones deberían tener más peso.

Header sugerido:

```txt
←  →   1 of 64                                      Open full writing  Share  Export  ⋯
```

## 4. Agregar acción “Open full writing”

### Problema

Si Preview sirve para revisar rápidamente, también debe ofrecer una salida clara hacia el editor completo.

### Propuesta

Agregar acción principal:

```txt
Open full writing
```

Esta acción debe abrir el writing en el editor normal.

### Criterio

La acción debe estar disponible en el header y/o en el menú `More`.

## 5. Agregar delete / move to trash

### Problema

Desde Preview el usuario debería poder eliminar o descartar un documento sin abrirlo en el editor completo.

### Propuesta

Agregar acción destructiva dentro del menú `More`, no como botón principal visible.

```txt
⋯
- Open full writing
- Duplicate
- Export
- Share
- Move to trash
```

Si no existe trash:

```txt
⋯
- Delete writing
```

### Confirmación

Antes de eliminar:

```txt
Delete “01 — Deus Harness Context Brief1. Propósito”?

This action can’t be undone.

[Cancel] [Delete]
```

### Recomendación

Preferir `Move to trash` sobre delete permanente si el modelo lo permite.

## 6. Mostrar anotaciones dentro de Preview

### Problema

Preview muestra el documento, pero no permite revisar rápidamente las anotaciones asociadas. Eso limita su valor como vista de inspección.

### Propuesta

Agregar sección de anotaciones en el panel derecho.

```txt
ANNOTATIONS
3 annotations

Personal
Este framing es clave para mi tesis...

AI
¿Cuántos son configurables en práctica?

Collaborative
Demasiado técnico para el abstract...
```

### MVP

En la primera versión:

- Mostrar conteo total de anotaciones.

- Mostrar preview de cada anotación.

- Mostrar tipo: Personal, AI, Collaborative.

- Mostrar tags si existen.

- Click en anotación abre el writing en contexto o navega al fragmento correspondiente.

### No incluir inicialmente

- Edición completa de anotaciones desde Preview.

- Threads complejos.

- Resolución de comentarios.

Esto puede venir después.

## 7. Agregar export desde Preview

### Problema

Si el usuario está revisando un documento, exportarlo desde Preview es una acción natural. No debería tener que abrir el editor completo.

### Propuesta

Agregar acción `Export` en el header o panel derecho.

Formatos disponibles según los exports actuales de Odessay:

```txt
Markdown
PDF
DOCX
HTML
```

Si algunos formatos no existen todavía, mostrar solo los disponibles.

### UX sugerida

```txt
Export
- Markdown
- PDF
- DOCX
- HTML
```

### Criterio

Debe reutilizar la lógica de export existente. Preview no debe duplicar lógica de exportación.

## 8. Agregar share desde Preview

### Problema

Preview es un buen lugar para compartir porque el usuario ya está evaluando el documento.

### Propuesta

Agregar acción `Share`.

Puede abrir el mismo modal de share usado en el editor.

### Opciones posibles

MVP:

```txt
Share
- Copy share link
- Invite collaborator
```

Versión posterior:

```txt
Share
- Invite by email
- Copy private link
- Permission: View / Comment / Edit
```

### Criterio

No crear una segunda lógica de permisos. Reutilizar el sistema de sharing existente.

## 9. Mejorar panel de propiedades

### Problema

El panel derecho tiene Status y Collections, pero se siente amplio para poca información. Puede volverse más útil si agrega metadata y acciones contextuales.

### Propuesta

Panel sugerido:

```txt
PROPERTIES

Status
[eye icon] In Review

Collections
[Harness]

Metadata
Created May 22
Last worked May 22
2986 words

Annotations
3 annotations

Actions
Export
Share
Move to trash
```

### Metadata útil

```txt
Created date
Last worked date
Word count
Owner / shared state
Collection count
Annotation count
```

### Regla

El panel debe ser informativo, no pesado. Las acciones más frecuentes pueden estar en header; las secundarias en el panel o menú.

## 10. Definir alcance de navegación entre writings

### Problema

El header muestra `1 of 64`, lo que sugiere navegación entre documentos. Hay que definir qué significa ese conjunto.

### Propuesta

Preview debe navegar dentro del set visible actual de Desk.

```txt
Si el usuario está en My writings:
navega dentro de My writings.

Si hay filtros activos:
navega solo dentro de los resultados filtrados.

Si hay búsqueda activa:
navega dentro de los resultados de búsqueda.

Si está en Shared with me:
navega dentro de Shared with me.
```

### Criterio

El contador debe representar el set actual.

```txt
1 of 64 = primer writing dentro del set visible actual
```

Esto evita confusión cuando hay filtros, tabs o agrupaciones activas.

## 11. Ajustes menores de diseño

### Header

- Hacer más clara la navegación izquierda/derecha.

- Mantener contador visible.

- Mover acciones principales al lado derecho.

- Reducir protagonismo del label `PREVIEW`.

### Documento

- Mantener buena legibilidad.

- Evitar que el contenido quede demasiado pegado al borde.

- Revisar scroll interno para que el header y panel derecho se mantengan estables.

### Panel derecho

- Reducir aire excesivo.

- Agrupar propiedades por bloques.

- Hacer que Status y Collections se sientan más compactos.

- Añadir secciones colapsables si el panel crece.

### Modal

- Mantener esquinas suaves.

- Mejorar shadow para sensación flotante.

- Usar border sutil y background ligeramente translúcido.

Ejemplo conceptual:

```css
.preview-modal {
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.16),
    0 2px 12px rgba(0, 0, 0, 0.06);
}
```

## 12. Issues sugeridos para Linear

### Issue 1 — Refine Preview modal overlay with glass effect

Actualizar el overlay del modal para que sea más blanco, difuso y con mayor blur.

Criterios:

- El fondo debe seguir percibiéndose.

- El Desk no debe competir visualmente con el documento.

- Usar `backdrop-filter`.

- Probar transparencia blanca y saturación suave.

### Issue 2 — Upgrade Preview into Document Quick View

Redefinir la pantalla como una vista rápida funcional.

Debe permitir:

- Leer el documento.

- Ver propiedades.

- Abrir editor completo.

- Ver acciones rápidas.

- Ver metadata básica.

### Issue 3 — Add quick actions to Preview header

Agregar acciones en el header:

```txt
Open full writing
Share
Export
More
Close
```

Mantener navegación y contador.

### Issue 4 — Add delete / move to trash action to Preview

Agregar acción destructiva dentro de `More`.

Criterios:

- No mostrar como botón primario.

- Confirmar antes de eliminar.

- Preferir `Move to trash` si existe.

- Actualizar la lista de Desk después de la acción.

### Issue 5 — Show document annotations in Preview panel

Agregar sección de anotaciones en el panel derecho.

MVP:

- Conteo de anotaciones.

- Preview de anotaciones.

- Tipo de anotación.

- Tags si existen.

- Click para abrir writing en contexto.

### Issue 6 — Add export action to Preview

Permitir exportar desde Preview usando los formatos existentes.

Criterios:

- Reutilizar lógica de export actual.

- Mostrar solo formatos disponibles.

- No obligar a abrir el editor completo.

### Issue 7 — Add share action to Preview

Permitir compartir desde Preview.

Criterios:

- Reutilizar modal/lógica de share existente.

- Soportar copy link o invite según lo disponible.

- No duplicar lógica de permisos.

### Issue 8 — Improve Preview properties panel

Mejorar panel derecho con:

- Status.

- Collections.

- Metadata.

- Annotation count.

- Actions secundarias.

### Issue 9 — Define Preview navigation scope

Definir que las flechas navegan dentro del set visible actual en Desk.

Criterios:

- Respetar tab activo: My writings / Shared with me.

- Respetar filtros.

- Respetar búsqueda.

- Respetar agrupación si aplica.

- El contador debe coincidir con el set navegable.

## 13. Prioridad recomendada

### P0 — Base visual y navegación

1. Refine Preview modal overlay with glass effect.

2. Define Preview navigation scope.

3. Add Open full writing action.

### P1 — Acciones clave

4. Add export action.

5. Add share action.

6. Add delete / move to trash action.

### P2 — Profundidad funcional

7. Show annotations in Preview panel.

8. Improve properties panel.

9. Add metadata and secondary actions.

## 14. Principio de producto

La regla central para Preview debería ser:

> **Preview es una vista rápida para decidir y actuar, no un editor reducido.**

Esto ayuda a mantener el scope limpio. Preview no tiene que resolver toda la edición del documento; debe permitir inspección, navegación y acciones rápidas sin romper el flujo de Desk.
