# ODESSAY — Arquitectura técnica

**Documento de referencia para desarrollo.**
Lee `odessay-fundacional.md` primero. Este documento prevalece sobre versiones anteriores.
Última actualización: Marzo 2026.

---

## Stack

| Capa | Tecnología | Rol |
|------|-----------|-----|
| Framework | Next.js 15 (App Router) | SSR, routing, API routes |
| UI | React 19 + Tailwind CSS + ShadCN/UI | Interfaz |
| Tipografía | Geist Sans + Lora | UI funcional + contenido epistolar |
| Editor | TipTap (headless, sobre ProseMirror) | Motor de escritura |
| Base de datos remota | Supabase (PostgreSQL + Auth + Realtime) | Persistencia cloud, auth, sync |
| Base de datos local | SQLite (via Tauri/Electron en desktop) | Persistencia local, offline-first |
| AI | Claude API (Anthropic) | Editor residente |
| Email | Resend | Notificaciones, invitaciones |
| Hosting | Vercel | Deploy web, dominio odessay.com |

Ver `odessay-stack.md` para detalle completo.

---

## Los tres modos de Odessay

Odessay tiene tres modos de uso con interfaces y propósitos completamente distintos. Confundirlos produce interfaces incorrectas.

| Modo | Vistas | Propósito | Tono de interfaz |
|---|---|---|---|
| **Escribir** | `/write/:id` | Crear | Interfaz desaparece, texto protagonista |
| **Leer** | Reading view en Correspondences | Recibir | Chrome mínimo, tipografía protagonista |
| **Organizar** | `/desk`, `/collections` | Gestionar | Funcional, tabla, filtros |

**Decisiones clave:**
- Correspondences es una interfaz de **lectura**, no de escritura. Su propósito es que el autor reciba con dignidad lo que otros escribieron para él.
- Collections es para **organizar**, no para leer. La lectura ocurre en el editor o en la reading view.
- El Desk es para **gestionar el trabajo** — ver qué está en progreso, qué llegó, qué tiene sin organizar.

---

## Arquitectura de navegación

El layout principal de la aplicación autenticada tiene tres zonas con ancho total constante.

### Tres zonas

```
┌──────────┬─────────────────────────────┬──────────────┐
│ Sidebar  │  List Panel (contextual)    │   Editor     │
│  52px    │        240px                │   flex-1     │
│ (rail)   │   (aparece al abrir        │              │
│          │    colección/sección)       │              │
└──────────┴─────────────────────────────┴──────────────┘
     ↕                  ↕
  292px total      se abre/cierra
  siempre igual    sin mover el editor
```

### Sidebar — dos estados

**Expandido (292px = 52px rail + 240px contenido):**
Logo Odessay en Lora, New writing, Search, navegación principal con texto. Colecciones y correspondencias expandibles con chevron. Recent writings al fondo. Avatar del usuario en el bottom.

**Colapsado (52px = solo rail de iconos):**
Iconos en su posición X exacta — solo el texto desaparece. New writing con fondo oscuro (único elemento sólido en el rail). Tooltips al hover.

**Transición:** `width 300ms cubic-bezier(0.4,0,0.15,1)`. Texto: `opacity 250ms ease`.

### List panel

Aparece al abrir una colección. Ancho 240px. Coordinado con sidebar (320ms, 20ms más lento — el sidebar hace espacio primero). Ancho total sidebar + list panel = 292px siempre. El editor no se mueve.

### Properties panel

Se abre desde topbar del editor. Ancho 248px. El editor se estrecha — sidebar y list panel no se afectan.

---

## Arquitectura de páginas

```
/                           → Landing (pública)
/about, /manifesto          → Páginas públicas
/terms, /privacy            → Legales
/login, /signup             → Auth
/invite/[token]             → Landing de invitación epistolar

/desk                       → Desk (privado) — vista principal del autor
/write                      → Editor nuevo writing
/write/[id]                 → Editor writing existente
/write?reply_to=[id]        → Editor como respuesta en correspondencia
/collections                → Collections — organización del archivo
/collections/[id]           → Collection específica
/correspondences            → Lista de correspondencias
/correspondences/[id]       → Hilo de correspondencia (secuencia + reading)
/shared                     → Writings compartidos conmigo

/settings                   → Configuración

/[username]                 → Espacio público del autor
/[username]/[slug]          → Writing público
```

**Nota:** La ruta principal del autor autenticado es `/desk`, no `/home`. El término correcto en toda la app es "Desk".

---

## Vistas principales — resumen

### Desk (`/desk`)
Vista de gestión del trabajo diario. Tres secciones:
- **Hero** — drafts activos como cards horizontales deslizables (In progress)
- **Filter bar** — All activity / Correspondence / With responses / Received
- **Tabla de actividad** — writings con actividad epistolar, agrupados por fecha (Today / This week / Earlier). Columnas: Writing | State | With | Date

### Collections (`/collections`)
Vista de organización del archivo. No es para leer writings.
- **Banner uncategorized** — siempre visible si hay writings sin clasificar. AI sugiere agrupaciones.
- **Organize panel** — lista de writings sin clasificar con preview (extracto de primeras líneas, nombre de archivo, fecha, palabras). Checkbox + bulk assign + AI pill por item.
- **Colecciones expandibles** — un click muestra todos los writings de la colección con título, extracto, estado, fecha.

### Correspondences (`/correspondences/:id`)
Vista de lectura epistolar. No es para escribir.
- **Participants bar** — avatares apilados, nombres, total writings, palabras, desde cuándo
- **Secuencia de mini-documentos** — cada writing es un card con autor, título en Lora 22px, extracto, palabras. Sin borde izquierdo de color. Conectados por línea vertical sutil.
- **Reply prompt** — al fondo, con botón terracota "Write a response"

### Reading view (dentro de `/correspondences/:id`)
Pantalla completa de lectura. Sin sidebar. Sin chrome innecesario.
- Autor, título en Lora 30px, cuerpo en Geist Sans 17px, line-height 1.85
- **Márgenes** — sistema de highlight + anotación (ver sección específica)
- Navegación entre writings con Previous/Next y flechas del teclado
- ESC para volver a la secuencia

### Editor (`/write/:id`)
Ver `odessay-editor.md` para spec completa.

---

## Arquitectura de datos — local-first

```
Usuario escribe
      ↓
  SQLite local   ← inmediato, nunca falla
      ↓
  Sync queue     ← background worker silencioso
      ↓
  Supabase       ← cuando hay red, confirma y respalda
```

El usuario **nunca espera a Supabase**. La base local es la fuente de verdad operativa. Supabase es la copia remota sincronizada.

Cada writing tiene: `id`, `updated_at`, `version`, `sync_status`, `deleted_at`.

Para desktop (Tauri/Electron): SQLite vía el runtime nativo. Para web: IndexedDB como caché local con sync a Supabase.

---

Schema de entidades en `docs/core/odessay-modelo-datos.md`.

---

## Decisiones de arquitectura

**Cuerpo del writing en Geist Sans.** El cuerpo usa Geist Sans (sans-serif), no Lora serif. Títulos H1/H2/H3 y blockquotes usan Lora. Decisión de legibilidad validada en prototipos.

**Sin toolbar flotante al seleccionar texto.** Shortcuts de teclado como mecanismo primario. Acciones con input (enlace, cita, footnote) usan modales con overlay crema.

**Márgenes inmutables post-compartido.** Las anotaciones se anclan a offsets de texto plano (`anchor_start`, `anchor_end`). Para proteger los anclajes, los writings en correspondencia son inmutables una vez compartidos — no se pueden editar.

**Sidebar siempre visible en alguna forma.** El rail de 52px nunca desaparece. Focus mode es la única excepción.

**Transiciones coordinadas.** Sidebar (300ms) y list panel (320ms) ocurren simultáneamente pero desfasados 20ms. El ancho total permanece constante.

**Modales sobre prompts del navegador.** Acciones con input usan modales propios. Overlay crema con blur, animación suave, selección preservada.

**Documentos guardados completos, no por bloques.** El body_json de TipTap se guarda como documento completo. La granularidad de bloques (ProseMirror) es interna — no se expone en el schema. Simplifica sync, márgenes y AI en el MVP.