# DoD — Fase 8: Biblioteca, Preview y Calidad de Producto

Este documento define las condiciones verificables que deben ser verdad para declarar Fase 8 como completa. Cada criterio es binario: pasa o no pasa. No existen estados intermedios de "casi listo".

---

## 1. Desk — Timestamps y estabilidad de biblioteca

- Existe la columna `content_updated_at` en la tabla `writings`. Solo se actualiza cuando cambia el contenido editorial (título, body).
- Existe la columna `metadata_updated_at`. Solo se actualiza cuando cambia metadata (status, tags, collections, visibility, sharing).
- La sección "Recent Writings" usa `content_updated_at DESC`. Cambiar el status, collections o tags de un writing no lo mueve en esta sección.
- La lista principal de Desk usa `created_at DESC` por defecto. Cambiar cualquier campo del writing no reordena la lista.

## 2. Desk — "Shared with Me" counter

- La pestaña "Shared with Me" muestra el conteo real de writings donde `owner_id != current_user.id` y el usuario tiene un registro de acceso en la tabla de shares/collaborators.
- El conteo es correcto incluso cuando el writing compartido no aparece en "My writings".

## 3. Desk — WritingStatusBadge

- Existe un único componente `WritingStatusBadge` usado en: Recent Writings cards, lista principal, filtros de status, dropdowns de status dentro del editor.
- El componente tiene variante compacta (cards) y variante completa (lista/dropdown).
- Cada estado (Exploring, Draft, In Review, Done) tiene ícono, label y surface de color consistentes.

## 4. Desk — Recent Writings cards

- Cada card de Recent Writings muestra: `WritingStatusBadge`, título, preview de contenido, collection chips (máx 2), word count.
- El lenguaje visual es el mismo que el resto de la app.

## 5. Desk — Group by y filtros avanzados

- Existe un control "Group by" en la barra de Desk con opciones: None, Status, Collection, Created date.
- Existe soporte para filtrar por fecha de creación: Today, Last 7 days, Last 30 days, This year, Custom range.
- Existe soporte para ordenar por fecha de creación: Newest first / Oldest first.

## 6. Preview — Overlay y diseño

- El overlay del Preview modal usa `backdrop-filter: blur` con fondo blanco difuso. El Desk sigue siendo perceptible como contexto visual.
- El modal tiene esquinas suaves, shadow flotante y border sutil translúcido.

## 7. Preview — Navegación y acciones

- El header del Preview muestra: `← →` (navegación), `1 of N` (contador), Open full writing, Share, Export, `⋯` (con Move to trash).
- Las flechas navegan dentro del set visible activo en Desk (respeta tab activo, filtros y búsqueda activa). El contador refleja el tamaño real del set.
- "Open full writing" abre el writing en el editor.
- "Move to trash" pide confirmación antes de eliminar y actualiza la lista de Desk tras la acción.

## 8. Preview — Panel de propiedades

- El panel derecho muestra: Status (editable), Collections, Metadata (Created date, Last worked date, word count), conteo de anotaciones.
- Export y Share son accesibles desde el panel o el header.

## 9. Studio

- Existe "Studio" como ítem de navegación principal en el sidebar, al mismo nivel que Desk y Search.
- Click en Studio muestra los artifacts abiertos en la sesión. Si no hay ninguno, muestra un estado vacío con botones "Open artifact" y "New artifact".
- Al navegar a Desk y volver a Studio, los artifacts que estaban abiertos siguen ahí (retención de sesión).

## 10. Artifact Type

- Existe la columna `artifact_type` en la tabla `writings` con valores: `general | agent | skill | prompt | template | status`. Valor default: `general`. Migration asigna `general` a todos los writings existentes.
- El panel de propiedades del writing muestra un selector de Artifact Type debajo del selector de Status.
- El selector muestra ícono + label del tipo actual y permite cambiarlo con un dropdown.
- Existe un filtro de Artifact Type en la barra de filtros de Desk.

## 11. Workspace — Selección de carpetas y archivos

- Al añadir una carpeta como workspace, la UI permite seleccionar qué subcarpetas y archivos específicos incluir (árbol de selección granular), no solo filtrar por extensión.
- El filtro de extensiones por defecto incluye `.md` y `.mdx`. Excluye `.*`, `*.tmp`, `*.log`, `node_modules/`, `.git/`.
- La diferencia de capacidades entre web y desktop está documentada y la UI refleja correctamente qué opciones están disponibles en cada runtime.

## 12. Workspace — Diseño visual

- El diseño de la sección Workspace (header, cards, vista de detalle, modal "Add workspace") usa los mismos tokens, componentes y patrones que Desk. No existe vocabulario visual nuevo en Workspace.

## 13. ArtifactTable

- Existe un componente `<ArtifactTable />` compartido con soporte para columnas configurables: `title`, `workspace`, `artifactType`, `status`, `date`, `actions`. Modos: `list` y `grid`.
- La lista de writings de Desk usa `<ArtifactTable />`.
- La vista de detalle de un workspace usa `<ArtifactTable />`.

## 14. Audio / Voice capture

- La captura de voz/audio en desktop funciona sin errores de pattern ni crashes.
- El flujo de grabación, pausa y guardado funciona sin mensajes de error visibles al usuario.

## 15. Keyboard shortcuts

- Los shortcuts existentes que tienen conflictos en desktop están corregidos o remapeados.
- Los nuevos shortcuts específicos de desktop están implementados sin colisiones con shortcuts del sistema operativo.
- Los shortcuts están documentados en la UI (tooltip o panel de ayuda).

## 16. Spell check

- El corrector ortográfico en el editor funciona sin que las palabras queden bloqueadas con comportamiento inesperado.
- La experiencia de subrayado, selección de sugerencias y corrección es fluida y no interrumpe el flujo de escritura.

---

## Criterio de cierre de fase

Todos los criterios de las secciones 1–16 deben estar en estado PASS antes de mover el proyecto de Fase 8 a `Completed` en Linear. Un PASS parcial no cuenta. Si un issue está Done en Linear pero su criterio de DoD no es verificable, el cierre de fase se bloquea hasta que lo sea.
