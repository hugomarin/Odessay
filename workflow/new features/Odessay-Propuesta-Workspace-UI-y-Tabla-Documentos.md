# Propuesta: Mejoras de Workspace UI y Tabla de Documentos

## Contexto

La sección Workspace de la app desktop tiene inconsistencias visuales respecto al resto de la aplicación. Además, la tabla de archivos dentro de un workspace carece de información clave (workspace de origen, tipo de artifact) y no está pensada como componente reutilizable. Este documento propone resolver ambos problemas y agrega la corrección del filtrado de archivos al añadir una carpeta.

---

## Decisión de diseño: Zero Delta

**Workspace debe seguir a Desk. Sin vocabulario visual nuevo.**

Las pantallas de Workspace no introducen ningún componente de diseño propio. Usan exactamente los mismos tokens, componentes y patrones que ya existen en Desk:

- Las workspace cards en modo grid son las mismas cards que Desk usa para writings.
- La vista de detalle del workspace usa el mismo layout de lista que Desk.
- `<ArtifactTable />` es la misma tabla de Desk, con dos columnas añadidas.
- El header, los botones de acción, los badges y los modales son los mismos que en Desk.

La regla: si un componente no existe ya en Desk, no se crea para Workspace. Se reutiliza o se generaliza el existente.

---

## 1. Alinear el diseño de Workspace con el resto de la app

### Problema

La pantalla de Workspace y sus vistas internas usan un lenguaje visual diferente al de Desk:

- El header de la lista de workspaces tiene estilos propios que no coinciden con el header de Desk.
- Las cards de workspace en la vista de grid usan bordes, sombras y tipografía que difieren de los componentes existentes.
- La vista de detalle de un workspace tiene su propia cabecera, breadcrumb y layout.
- El modal "Add a workspace" es visualmente inconsistente con otros modales de la app.

### Propuesta

Reemplazar los estilos propios de Workspace con los componentes que ya existen en Desk:

**Header de sección**
- Mismo componente de header que Desk: jerarquía tipográfica, espaciado y botón de acción principal idénticos.
- `+ Add workspace` usa el mismo estilo que `+ New writing`.

**Cards de workspace (modo grid)**
- Misma card spec que Desk. Sin estilos nuevos.
- El ícono de carpeta y la metadata secundaria (files count, updated date) siguen la typescale ya usada.

**Vista de detalle del workspace**
- Mismo layout de lista que Desk. El breadcrumb y el menú `...` usan los componentes de navegación existentes.

**Modal "Add a workspace"**
- Mismo patrón de modal que el resto de la app. Sin tipografía ni spacing nuevos.

### Criterio de aceptación

Un desarrollador debe poder implementar Workspace reutilizando componentes existentes de Desk sin escribir nuevos estilos de layout.

---

## 2. Rediseñar la tabla de documentos como componente compartido

### Problema

La tabla de archivos dentro de un workspace y la lista de writings en Desk son visualmente diferentes aunque muestran información análoga. No existe un componente de tabla unificado. Al escalar la app, habrá inconsistencias entre:

- La lista de writings en Desk.
- Los archivos dentro de un workspace.
- Futuros listados de artifacts en Studio o en otras vistas.

Además, la tabla actual del workspace no muestra:
- En qué workspace está el documento.
- Qué tipo de artifact es el documento.

### Propuesta: componente `<ArtifactTable />`

Crear un componente de tabla unificado que sirva tanto para Desk como para la vista de detalle de un workspace y cualquier otro lugar donde se listen artifacts o writings.

**Columnas del componente**

```txt
[icon]  Title + preview     Workspace     Artifact Type     Status     Date     Actions
```

Detalle de cada columna:

| Columna | Descripción |
|---|---|
| Title + preview | Nombre del artifact y primer línea de contenido |
| Workspace | Nombre del workspace al que pertenece (si aplica) |
| Artifact Type | Badge con ícono + label del tipo (`Agent`, `Prompt`, `Template`, etc.) |
| Status | `WritingStatusBadge` (Exploring / Draft / In Review / Done) |
| Date | Fecha de creación o última edición según contexto |
| Actions | Íconos de acción: copiar, descargar, eliminar |

**Configuración de columnas**

El componente debe permitir activar o desactivar columnas según el contexto:

```tsx
<ArtifactTable
  artifacts={artifacts}
  columns={['title', 'workspace', 'artifactType', 'status', 'date', 'actions']}
/>
```

En Desk se pueden ocultar la columna `workspace` si todos los artifacts pertenecen al mismo contexto, o mostrarla en la vista global.

En la vista de detalle de un workspace, la columna `workspace` puede omitirse porque ya está implícita en la navegación.

**Vista Grid vs List**

El componente debe admitir dos modos, igual que la vista de workspaces actual:

```tsx
<ArtifactTable mode="list" />
<ArtifactTable mode="grid" />
```

### Uso en Desk

La lista de writings de Desk pasa a usar `<ArtifactTable />`. Las columnas activas serían:

```txt
Title + preview | Collections | Status | Date | Actions
```

Con la columna `Artifact Type` disponible como opcional si el usuario activa el filtro o el grouping por tipo.

### Uso en Workspace (vista de detalle)

La lista de archivos dentro de un workspace pasa a usar `<ArtifactTable />`. Las columnas activas serían:

```txt
Title | Artifact Type | Status | Date | Actions
```

Esto reemplaza la tabla actual que solo muestra nombre, tamaño y fecha.

### Regla de producto

> Una sola tabla. El contexto determina qué columnas se muestran.

---

## 3. Filtrar archivos al añadir una carpeta como workspace

### Problema

Cuando el usuario añade una carpeta existente de su sistema de archivos como workspace, la app indexa todos los archivos que encuentra, incluyendo archivos `.txt`, archivos temporales, archivos del sistema y otros formatos que no son documentos de trabajo editorial.

Esto contamina la vista del workspace con archivos irrelevantes y puede hacer que aparezcan decenas de archivos que no tienen sentido mostrar en el contexto de Odessay.

### Propuesta

Al escanear una carpeta para crear o sincronizar un workspace, aplicar un filtro de inclusión por extensión.

**Extensiones incluidas por defecto:**

```txt
.md
.mdx
.txt   (ver nota)
```

**Extensión `.txt` — comportamiento especial**

`.txt` es ambiguo: puede ser un documento de trabajo válido o un archivo de sistema irrelevante. Opciones:

1. Excluir `.txt` por defecto y permitir al usuario activarlo por workspace.
2. Incluir `.txt` pero con un tamaño mínimo (p. ej., > 200 bytes) para filtrar archivos vacíos o de sistema.
3. Mostrar un resumen al añadir la carpeta: "Se encontraron N archivos `.txt`. ¿Incluirlos?"

Recomendación MVP: **excluir `.txt` por defecto**. El usuario puede añadirlo explícitamente en la configuración del workspace si lo necesita.

**Archivos y patrones excluidos siempre:**

```txt
.*              (archivos ocultos: .DS_Store, .gitignore, etc.)
*.tmp
*.log
node_modules/
.git/
__pycache__/
```

### Configuración por workspace

En la vista de detalle del workspace, el menú `...` debe incluir:

```txt
Workspace settings
  ├─ File types: .md, .mdx  [Edit]
  └─ Excluded patterns: .*, *.tmp  [Edit]
```

Esto permite que el usuario ajuste qué archivos se incluyen en cada workspace de forma independiente.

### Criterio de aceptación

Al añadir una carpeta que contiene archivos `.txt`, `.DS_Store` y archivos `.md`, solo los `.md` aparecen en el workspace por defecto.

---

## Issues sugeridos para Linear

### Issue C1 — Audit and align Workspace section visual design

Revisar todos los elementos visuales de la sección Workspace para alinearlos con los tokens de diseño y componentes del resto de la app.

Superficies a revisar:
- Header de la lista de workspaces.
- Cards de workspace en modo grid.
- Vista de detalle del workspace (header, breadcrumb, layout).
- Modal "Add a workspace".

Criterio: un diseñador externo no debe notar cambio de sistema visual entre Desk y Workspace.

### Issue C2 — Create shared `<ArtifactTable />` component

Crear un componente de tabla unificado para listar artifacts/writings en distintas partes de la app.

Columnas soportadas:
```txt
title | workspace | artifactType | status | date | actions
```

Modos: `list` y `grid`.

El componente debe ser configurable para activar/desactivar columnas por contexto.

### Issue C3 — Use `<ArtifactTable />` in Desk

Migrar la lista de writings de Desk al componente `<ArtifactTable />`.

Columnas activas:
```txt
title | collections | status | date | actions
```

### Issue C4 — Use `<ArtifactTable />` in Workspace detail view

Migrar la tabla de archivos dentro de un workspace al componente `<ArtifactTable />`.

Columnas activas:
```txt
title | artifactType | status | date | actions
```

Esto reemplaza la tabla actual que solo muestra nombre, tamaño y fecha.

### Issue C5 — Add Workspace and Artifact Type columns to table

Agregar las columnas `Workspace` y `Artifact Type` al componente `<ArtifactTable />`.

`Workspace` muestra el nombre del workspace al que pertenece el artifact.

`Artifact Type` muestra un badge con ícono + label del tipo (requiere Issue B1 de la propuesta Studio y Artifact Type).

### Issue C6 — Filter file types when scanning workspace folder

Al crear o sincronizar un workspace desde una carpeta local, filtrar los archivos incluidos.

Comportamiento por defecto:
- Incluir: `.md`, `.mdx`
- Excluir: `.txt`, archivos ocultos (`.*`), `.tmp`, `.log`, `node_modules/`, `.git/`

Agregar configuración por workspace para que el usuario pueda ajustar los tipos de archivo incluidos.

---

## Prioridad recomendada

### P0 — Corrección de comportamiento

1. Filter file types when scanning workspace folder (C6).

### P1 — Componente compartido

2. Create shared `<ArtifactTable />` component (C2).
3. Use `<ArtifactTable />` in Desk (C3).
4. Use `<ArtifactTable />` in Workspace detail view (C4).

### P2 — Enriquecimiento de tabla

5. Add Workspace and Artifact Type columns (C5) — depende de Issue B1 (artifactType field).

### P3 — Consistencia visual

6. Audit and align Workspace section visual design (C1).

---

## Principio de producto

> **Una tabla. El contexto decide qué columnas mostrar.**

> **Una carpeta de workspace solo muestra lo que el usuario escribe — no los archivos del sistema.**
