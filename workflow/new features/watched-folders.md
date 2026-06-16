# Workspace / Watched Folders

**Linear:** [ODE-245](https://linear.app/z9ne/issue/ODE-245)

> **Reconciliación con el ADR de identidad (`workflow/context/core/odessay-adr-identidad.md`).** Este spec acertó en lo esencial (trackear en su lugar, no tocar frontmatter, índice con inode), pero el ADR **supersede** dos puntos:
> - **Metadata NO va en un sidecar `meta.json` en disco** — va en el **registro de nube** (writing + espejo IndexedDB) (D4). En disco solo vive un **índice de binding delgado** (ruta + inode + content_hash + UUID), no metadata.
> - **`content_hash` es objetivo/pendiente**, no estado actual: hoy el índice implementado solo guarda inode + size, y la nube no guarda hash (D6/D11). El UUID del índice debe ser el **mismo de la nube** (D5), no un `Uuid::new_v4` propio.
> - Nombre de la carpeta: **`.odessay/`** (no `.odyssey`, D8).

## Resumen

Nueva sección **Workspace** en el sidebar izquierdo (debajo de Desk) que permite agregar carpetas de proyectos del filesystem para que Odessay las vigile. Cada archivo `.md` o `.txt` dentro de esas carpetas puede tener metadata en base de datos (status, tipo, etiquetas) y opcionalmente sincronizarse a la nube para acceso web.

## Motivación

Los documentos creados en el desktop app ya se auto-guardan en disco, pero el usuario tiene archivos `.md` existentes en múltiples carpetas del sistema (notas de Claude, proyectos, documentación) que no están en Odessay. Esta feature permite trabajar con esos archivos desde Odessay sin moverlos ni modificarlos, agregando metadata y sync opcionales.

---

## Entry point: Workspace en el sidebar

El acceso a la feature es una nueva entrada en el sidebar principal:

```
Desk          ← existente (LayoutGrid icon)e
Workspace     ← nuevo (Layers icon)  ← /workspace
Collections   ← existente
```

**Icono:** `Layers` de Lucide React (`strokeWidth={1.5}`)
**Ruta:** `/workspace`
**Shortcut:** pendiente de definir post-MVP

La página de Workspace es el hub para gestionar carpetas vigiladas y navegar sus archivos.

---

## MVP de exploración (ODE-245)

> Objetivo: sentir el flujo antes de comprometerse con la arquitectura completa.

### Lo que incluye el MVP

| Feature | Implementación |
|---------|---------------|
| Item "Workspace" en sidebar | `NAV_ITEMS` en `sidebar.tsx` |
| Ruta `/workspace` | `app/(app)/workspace/page.tsx` |
| Agregar carpeta | Tauri `open()` dialog (folder picker) |
| Persistencia de rutas | `tauri-plugin-store` |
| Listar archivos `.md` | Tauri `readDir` recursivo |
| Abrir archivo | Navegar a `/write?path=...` |

### Lo que NO incluye el MVP

- No `.odessay/` ni metadata en disco
- No IndexedDB ni Supabase sync
- No FSEvents / watcher en tiempo real
- No snapshots / versiones
- No metadata (status, tags, tipo)

### Preguntas a responder con el MVP

1. ¿Lista plana o árbol de carpetas? ¿Cómo se siente navegar?
2. ¿Abrir en editor existente o panel inline nuevo?
3. ¿El nombre "Workspace" comunica bien? ¿O mejor "Local" / "Proyectos"?
4. ¿Dónde va la acción de añadir carpeta — sidebar expandido o dentro de la página?
5. ¿Se necesita búsqueda dentro de las carpetas desde el MVP?

---

## Prioridades

1. **Metadata en base de datos** — cada archivo puede tener status, tipo, etiquetas en IndexedDB/Supabase
2. **Sync a la nube** — consecuencia opcional del punto anterior, habilita acceso web
3. **Versiones simples** — snapshots del texto sin complejidad de Git

---

## Arquitectura

### Directorio `.odessay`

Cuando el usuario agrega una carpeta vigilada, Odessay crea un directorio `.odessay/` dentro de ella. No modifica los archivos del usuario.

```
/Documents/Claude/
└── .odessay/
    ├── config.json          ← settings de esta carpeta
    ├── index.json           ← mapa path → uuid
    └── objects/
        ├── <uuid>/
        │   ├── meta.json    ← metadata del documento
        │   └── snapshots/
        │       ├── 2026-06-01T10:00.md
        │       └── 2026-06-05T09:15.md
        └── ...
```

Similar a `.git` o `.obsidian` — propiedad de la herramienta, ignorable con `.gitignore`.

### `index.json`

Vincula paths a UUIDs. Usa el `inode` del OS para detectar renombres.

```json
{
  "version": 1,
  "files": {
    "skills/my-skill.md": {
      "id": "abc-123",
      "inode": 12345678,
      "content_hash": "sha256:abcdef...",
      "last_seen": "2026-06-05T10:00:00Z"
    }
  }
}
```

### `meta.json` por documento  — ⚠️ SUPERSEDED por ADR D4 (la metadata vive en la nube, no en disco)

```json
{
  "id": "abc-123",
  "title": "My Skill",
  "status": "active",
  "type": "skill",
  "tags": ["claude", "ai"],
  "supabase_id": "uuid-en-supabase",
  "synced_at": "2026-06-05T10:00:00Z"
}
```

---

## Cómo funciona el watcher

Usa macOS FSEvents vía `tauri-plugin-fs watch()`. El OS notifica al proceso cuando algo cambia — sin polling, sin overhead.

**Eventos manejados:**

| Evento | Acción |
|--------|--------|
| `Create` | Indexa el archivo nuevo, crea entrada en IndexedDB |
| `Modify` | Debounce 500ms → sync contenido → snapshot opcional |
| `Rename` | Compara inodes → actualiza `canonical_path` en index + IndexedDB |
| `Delete` | Marca documento como `orphaned` en IndexedDB |

**Reglas:**
- El directorio `.odessay/` se excluye del watch (evita loops)
- Solo se procesan archivos `.md` y `.txt`
- El watcher es recursivo dentro de la carpeta vigilada

**Si la app está cerrada:** al arrancar, Odessay escanea todas las carpetas vigiladas, compara con `index.json` y reconcilia las diferencias (archivos nuevos, renombrados, eliminados desde el último arranque).

---

## Versiones simples

No es Git. Es una línea de tiempo de snapshots del contenido:

- Se guarda un snapshot automático cada N modificaciones o por tiempo (configurable)
- Se conservan los últimos 20 snapshots por documento
- El usuario puede restaurar cualquier versión anterior
- Los snapshots viven en `.odessay/objects/<uuid>/snapshots/`

---

## Sync a la nube (opcional)

Si el usuario activa sync para un documento:

1. IndexedDB primero (offline-first, igual que documentos cloud actuales)
2. Supabase en background — contenido + metadata
3. La metadata del `.odessay/` también se sincroniza entre máquinas vía Supabase

**Indicadores en UI:**

| Estado | Indicador |
|--------|-----------|
| Solo local, sin track | sin ícono |
| Tracked, sync pendiente | ☁️ gris |
| Sincronizado en web | ☁️ azul |
| Conflicto | ⚠️ |

---

## Frontmatter

Odessay **no modifica el frontmatter** de los archivos. Muchos documentos ya usan frontmatter para otros propósitos (templates, skills, configuración de herramientas). La metadata de Odessay vive exclusivamente en `.odessay/objects/<uuid>/meta.json`.

Si en el futuro el usuario quiere que la metadata sea visible en el archivo, puede optar por exportarla a frontmatter manualmente — pero no es el comportamiento por defecto.

---

## Scope MVP

| Feature | Complejidad |
|---------|-------------|
| UI para agregar/quitar carpetas vigiladas | Baja |
| Watcher con FSEvents vía tauri-plugin-fs | Media |
| Creación de `.odessay/index.json` | Baja |
| Metadata en IndexedDB (status, tipo, tags) | Baja |
| Reconciliación al arrancar | Media |
| Sidebar: sección "Local" con carpetas | Media |
| Sync a Supabase (opcional) | Media |
| Snapshots simples | Baja |

---

## Decisiones pendientes

- ¿La carpeta `.odessay/` se agrega automáticamente al `.gitignore` del repo si existe?
- ¿Cuántos snapshots conservar por defecto?
- ¿El sync a Supabase es por documento (opt-in) o por carpeta vigilada (todos o ninguno)?
- ¿Cómo mostrar documentos locales vs cloud en la sidebar — secciones separadas o mezclados con indicador?
