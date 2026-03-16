# ODESSAY — Roadmap

**Documento de referencia para agentes de desarrollo y product management.**
Lee `odessay-fundacional.md` para la visión, `skill-product-manager.md` para el proceso de creación y ejecución de issues.

Este documento define el alcance completo del proyecto: fases, milestones, y los issues macro que componen cada fase con sus dependencias. Es la fuente de verdad del qué y el cuándo. El cómo vive en los skills.

---

## Principio de secuencia

Cada fase produce algo deployable, funcionalmente completo y **visualmente terminado**. No existe una fase de pulido al final — el estándar de calidad visual se aplica desde la Fase 0. Lo que se entrega en cada fase es lo que el usuario ve.

La referencia visual es siempre los prototipos en `/reference/` y los valores exactos de `skills/skill-design/vistas.md`. Lo que se ve en los prototipos es lo que se construye.

Dentro de cada fase, el orden de ejecución es siempre: database → backend → frontend → validation. Los issues de infra son siempre `critical-path` y van primero.

---

## Fase 0 — Cimientos

`critical-path` para todas las fases siguientes. Nada se puede construir sin esto.

Al terminar esta fase: el proyecto existe en GitHub, hace deploy en Vercel, tiene Supabase configurado en staging y producción, el schema base está migrado, la autenticación funciona, el sistema de diseño está implementado con tokens y componentes ShadCN configurados, y todas las variables de entorno están documentadas.

---

**Setup GitHub repository and branch strategy** `[infra]` `[critical-path]`
Crear el repo, definir branch strategy (main + feature branches con formato `feat/{issue-id}-{descripcion}`), configurar .gitignore, añadir CLAUDE.md y todos los docs y skills al repo.
Dependencias: ninguna. Es el primer issue del proyecto.

**Initialize Next.js project with Tailwind and ShadCN** `[infra, frontend]` `[critical-path]`
Setup de Next.js 15 con App Router. React 19. Tailwind CSS instalado. ShadCN inicializado (Style: Default, Base color: Neutral, CSS variables: Yes). Estructura de carpetas según `skill-frontend.md`. El proyecto hace build sin errores.
Dependencias: Setup GitHub repository.

**Configure Supabase projects (staging and production)** `[infra, database]` `[critical-path]`
Crear dos proyectos en Supabase. Documentar todas las variables de entorno del proyecto completo de una vez: Supabase (URL, anon key, service role), Anthropic API key, Resend API key, dominio Vercel. Configurar variables en el repo y en Vercel para ambos ambientes.
Dependencias: Initialize Next.js project.

**Configure Vercel deployment with branch previews** `[infra]` `[critical-path]`
Conectar repo a Vercel. Deploy automático desde main a producción. Branch previews automáticos para PRs. Variables de entorno configuradas en Vercel para staging y producción.
Dependencias: Configure Supabase projects.

**Implement design system — tokens, typography, ShadCN base components** `[frontend]` `[critical-path]`
Implementar el sistema de diseño completo de Odessay: tokens de color en `globals.css` mapeados a variables ShadCN, configuración de Tailwind theme con colores semánticos, sombras y border-radius. Instalar Geist Sans y Lora. Configurar los archivos de componentes ShadCN (Capa 2): card, button, input, textarea, dialog, popover, dropdown-menu, tooltip, badge, sheet, avatar — con los defaults de Odessay aplicados una vez. A partir de este issue, todos los componentes heredan la identidad visual sin `className` adicional.
Dependencias: Initialize Next.js project.
Referencia: `skill-design.md` (tokens, tipografía, ShadCN), `skills/skill-design/vistas.md` (valores por vista).

**Create initial database schema migrations** `[database]` `[critical-path]`
Migraciones iniciales para todas las tablas: profiles, writings (con `version`, `sync_status`, `deleted_at`, `slug`), correspondences, collections, writing_collections, writing_shares, ai_observations, margins (con `shared_at`, `updated_at`), invitations. RLS en todas las tablas. Triggers base: on_auth_user_created, slug generation, body_text extraction, correspondence creation.
Dependencias: Configure Supabase projects.
Referencia: `odessay-modelo-datos.md`.

**Implement authentication — signup, login, session middleware** `[backend, frontend]`
Supabase Auth con email + contraseña. Páginas /signup y /login con sistema de diseño aplicado. Middleware de Next.js para rutas protegidas con redirect a /login. Trigger on_auth_user_created crea profile automáticamente.
Dependencias: Create initial database schema migrations, Implement design system.

**Implement local-first storage layer** `[backend, database]` `[critical-path]`
Implementar la capa de persistencia local como base de toda la experiencia. En web: IndexedDB. Interfaz unificada `localDB` que abstrae el storage — los componentes no saben con qué hablan. Sync worker en background con cola de mutaciones y reintentos exponenciales. El usuario nunca espera a Supabase — la base local es la fuente de verdad operativa.
Dependencias: Create initial database schema migrations.
Referencia: `skill-backend.md` (sección: Auto-save), `odessay-stack.md`.

---

## Fase 1 — Escribir

Al terminar esta fase: un usuario puede registrarse, abrir el editor, escribir con auto-save local-first, y encontrar sus writings en /desk. El editor y el desk están visualmente terminados.

---

**Implement TipTap editor** `[frontend]`
Editor TipTap headless configurado con el subconjunto de extensiones de Odessay: Document, Paragraph, Text, Heading (H1/H2/H3), Bold, Italic, Link, Blockquote, BulletList, OrderedList, ListItem, Code, CodeBlock, Markdown (tiptap-markdown), History, Placeholder, CharacterCount. Sin toolbar flotante al seleccionar. Tipografía del sistema de diseño aplicada. Layout de tres capas: topbar 46px + writing area flex-1 + statusbar 32px. Sidebar en modo mini (52px) por defecto en el editor.
Dependencias: Implement authentication, Implement design system.
Referencia: `odessay-editor.md`, `skills/skill-design/vistas.md` (sección: Editor), `reference/editor.html`.

**Implement auto-save — local-first** `[backend, database]`
onUpdate de TipTap guarda inmediatamente en la base local (IndexedDB). Sync a Supabase en background con debounce de 1.5 segundos y reintentos silenciosos. Indicador visual mínimo en statusbar ("Saved" / "Saving..." en ink-4/ink-3, sin iconos). El usuario nunca espera — el save local es instantáneo. UUID generado en cliente para escrituras nuevas. Incrementar `version` en cada save.
Dependencias: Implement TipTap editor, Implement local-first storage layer.
Referencia: `odessay-editor.md` (sección: Auto-save), `skill-backend.md` (sección: Auto-save).

**Build /desk — personal writing desk** `[frontend, backend]`
Vista principal del autor. Tres secciones: Hero con cards horizontales deslizables de drafts activos (220px, scroll con snap), filter bar (All activity / Correspondence / With responses / Received), tabla de actividad agrupada por fecha (Today / This week / Earlier) con columnas Writing | State | With | Date. Datos se leen primero desde base local.
Dependencias: Implement auto-save.
Referencia: `odessay-arquitectura.md` (sección: Desk), `skills/skill-design/vistas.md` (sección: Desk), `reference/desk.html`.

**Implement writing states and private visibility** `[backend, frontend]`
Estados draft/finished como dimensiones independientes de visibilidad. Panel Properties en el editor para cambiar estado y visibilidad. Visibilidad private por default al crear. Writing solo visible para el autor cuando es private.
Dependencias: Build /desk.

**Seed data — staging básico** `[infra, database]`
Seed data mínimo para staging: 2-3 usuarios de prueba con profile completo, 5-8 writings en diferentes estados (draft/finished) y visibilidades, sin correspondencias aún. Permite testear el flujo de escritura y el desk de forma autónoma desde este punto.
Dependencias: Implement writing states.

---

## Fase 2 — Compartir y leer

Al terminar esta fase: un usuario puede compartir un writing, el destinatario puede leerlo en una vista dedicada, puede hacer highlights y anotaciones en los márgenes, y los writings públicos son accesibles en la URL del autor. La lectura funciona en mobile.

---

**Implement shared and public visibility** `[backend, database]`
Lógica completa de visibilidad shared y public. RLS actualizado para cada caso. API para cambiar visibilidad en cualquier dirección y en cualquier momento.
Dependencias: Implement writing states.

**Implement writing_shares — share with specific users** `[backend, frontend]`
Buscar usuarios por username o email. Crear entradas en writing_shares con can_respond. Revocar acceso. Vista /shared para writings recibidos de otros.
Dependencias: Implement shared and public visibility.

**Build reading view — dedicated reading space** `[frontend]`
Vista dedicada de pantalla completa para leer un writing. Sin sidebar. Fondo bg. Autor + título en Lora 30px + cuerpo en Geist Sans 17px / line-height 1.85. Topbar 46px con back link, navegación Previous/Next y botón "Write a response" en terracota. Sin cursor, sin toolbar, sin posibilidad de editar. Navegación entre writings con flechas del teclado, ESC para volver.
Dependencias: Implement writing_shares.
Referencia: `odessay-arquitectura.md` (sección: Reading view), `skills/skill-design/vistas.md` (sección: Reading), `reference/reading.html`.

**Implement margins — highlights and annotations** `[frontend, backend, database]`
Sistema de highlights y anotaciones en la reading view. Flujo: seleccionar texto → popup mínimo (Mark / Annotate) → highlight ámbar o burbuja de anotación. Panel de márgenes 296px desde topbar. Privados por default. Compartibles con el autor. Anclados a offsets de body_text. Disponibles como contexto al iniciar una respuesta.
Dependencias: Build reading view.
Referencia: `odessay-margenes.md`, `odessay-modelo-datos.md` (tabla: margins), `reference/reading-margins-panel.png`.

**Build public author space — /{username} and /{username}/{slug}** `[frontend, backend]`
Espacio público del autor en /{username}: writings y collections públicas, sin métricas visibles. Vista propia con toggle "cómo me ven" / "todo mi contenido". Writing público accesible en /{username}/{slug}. Slug generado automáticamente del título.
Dependencias: Build reading view.

**Optimize reading for mobile** `[frontend]`
Páginas de lectura (/{username}/{slug}, /correspondences/{id}, /shared) funcionales en mobile. /write muestra mensaje amable indicando que la escritura es en desktop. Tipografía adaptada para pantallas pequeñas según tabla responsive de `odessay-editor.md`.
Dependencias: Build reading view.

---

## Fase 3 — Corresponder

Al terminar esta fase: dos o más personas pueden intercambiar writings y ver su correspondencia completa como árbol navegable con la identidad visual definida.

---

**Implement reply mechanism — /write?reply_to={id}** `[backend, frontend]`
Editor pre-cargado como respuesta a un writing específico. Writing creado con parent_id apuntando al original. Referencia sutil al writing que se responde visible en el editor. El espacio de escritura es autónomo.
Dependencias: Build reading view.
Referencia: `odessay-flujos.md` (sección: Leer y Responder), `odessay-paginas.md`.

**Implement correspondence creation and tree structure** `[backend, database]`
Crear correspondence automáticamente cuando un writing recibe su primera respuesta. Asignar correspondence_id al writing raíz y a todas las respuestas del árbol. Respuestas subsiguientes heredan el correspondence_id. Trigger para actualizar correspondences.updated_at.
Dependencias: Implement reply mechanism.
Referencia: `odessay-modelo-datos.md` (sección: correspondences).

**Build /correspondences — thread view** `[frontend, backend]`
Vista de correspondencia: participants bar con avatares apilados y stats, secuencia de mini-documentos con línea vertical conectora, reply prompt terracota al fondo. Lista de correspondencias donde el usuario participa. Pill "Your turn" / "Waiting".
Dependencias: Implement correspondence creation.
Referencia: `odessay-arquitectura.md` (sección: Correspondences), `skills/skill-design/vistas.md` (sección: Correspondences), `reference/correspondences.html`.

---

## Fase 4 — Organizar

Al terminar esta fase: el tercer modo de Odessay (Organizar) está completo. El autor puede clasificar su archivo en collections, ver sugerencias del AI de agrupación, y gestionar su biblioteca desde una sola vista.

---

**Implement collections — CRUD and writing assignment** `[frontend, backend, database]`
Crear, editar, eliminar collections. Asignar writings a collections desde el editor (panel Properties) y desde la vista /collections. Un writing puede estar en múltiples collections. Collections públicas visibles en el espacio público del autor. Banner uncategorized siempre visible cuando hay writings sin clasificar. Colecciones expandibles sin navegación a otra página.
Dependencias: Build /desk, Implement writing states.
Referencia: `odessay-arquitectura.md` (sección: Collections), `skills/skill-design/vistas.md` (sección: Collections), `reference/collections.html`.

---

## Fase 5 — Invitar

Al terminar esta fase: el producto puede crecer. Un autor puede traer a alguien nuevo a Odessay y la primera experiencia de esa persona es leer la carta que le escribieron. Las páginas públicas y el espacio de distribución están listos.

---

**Implement invitations — token generation and sharing link** `[backend, database]`
Crear invitación con token único. Generar link /invite/{token} que el autor comparte por cualquier canal (WhatsApp, email, lo que prefiera). La invitación referencia el writing si existe. Estado: pending, accepted, expired.
Dependencias: Implement correspondence creation.
Referencia: `odessay-flujos.md` (sección: Invitar).

**Build /invite/{token} — invitation landing page** `[frontend]`
Página de llegada para invitados sin autenticación. Muestra el writing-invitación si existe. Lleva al signup con email prellenado si viene de un link con email. La primera experiencia en Odessay es leer lo que alguien escribió para ti.
Dependencias: Implement invitations.

**Integrate Resend for transactional email** `[backend, infra]`
Notificación por email cuando un writing es compartido. Email de invitación epistolar como canal complementario al link. Templates simples, coherentes con la marca. En staging, emails no llegan a destinatarios reales.
Dependencias: Build /invite/{token}.
Referencia: `skill-backend.md` (sección: Resend).

**Build public pages — landing, manifesto, about, terms, privacy** `[frontend]`
Páginas públicas sin autenticación. Landing como filtro: quien lo lee y siente algo, entra. Manifiesto completo. Tono y diseño coherentes con `odessay-fundacional.md`. Acceso a login y signup.
Dependencias: Implement design system.

**Implement i18n — English and Spanish** `[frontend, infra]`
next-intl configurado. Inglés como idioma default. Español como segundo idioma prioritario. Todas las cadenas de UI traducidas en ambos idiomas. URLs en inglés.
Dependencias: Build public pages.

**Implement SEO and Open Graph** `[frontend, backend]`
Metadata para landing, /{username}, /{username}/{slug}. Open Graph con título, autor y extracto para writings públicos. Preview coherente en redes y mensajería.
Dependencias: Build public author space, Build public pages.

**Seed data — staging completo** `[infra, database]`
Seed data completo para staging: correspondencias con múltiples participantes y árbol de respuestas, collections con writings clasificados y sin clasificar, márgenes de ejemplo, invitaciones en diferentes estados. Sin esto, los agentes no pueden testear flujos complejos de forma autónoma.
Dependencias: Implement collections, Implement margins, Build /correspondences.

---

## Fase 6 — AI Editor

Al terminar esta fase: el agente editor está activo en el editor. Observa en silencio, interviene en pausas naturales, puede ser invocado directamente, y el autor puede declarar contexto para adaptar las observaciones.

---

**Implement /api/ai/observe — automatic observations** `[backend, ai-editor]`
API route server-side. Recibe body del writing e instrucciones de contexto del autor. Invoca Claude API con el system prompt de `odessay-ai-editor.md`. Parsea la respuesta: si es SILENCIO, no envía nada al cliente. Guarda en ai_observations. Se invoca con debounce tras pausa de escritura (~8-15 segundos). Solo si el agente está activo.
Dependencias: Implement auto-save, Configure Supabase projects.
Referencia: `odessay-ai-editor.md`, `skill-backend.md` (sección: Claude API).

**Render AI observations as margin notes in editor** `[frontend, ai-editor]`
Extensión TipTap custom (AIObservationExtension) para renderizar observaciones al margen del párrafo relevante. Sutiles visualmente. Descartables con gesto mínimo. No interrumpen el flujo de escritura.
Dependencias: Implement /api/ai/observe.
Referencia: `odessay-ai-editor.md` (sección: Interfaz visual).

**Implement /api/ai/discuss — direct invocation and discussion** `[backend, ai-editor]`
API route para invocación directa del agente. Recibe body del writing + pregunta o instrucción del autor + historial de conversación en sesión. El historial se mantiene en memoria durante la escritura — no se persiste en v1.
Dependencias: Implement /api/ai/observe.
Referencia: `odessay-ai-editor.md` (sección: Modos de interacción).

**Build AI discussion panel in editor** `[frontend, ai-editor]`
Panel de diálogo (280px) junto al editor. Se abre cuando el autor invoca al agente. Conversación enfocada en el texto. Se cierra cuando no se necesita.
Dependencias: Implement /api/ai/discuss.

**Implement author context instructions for AI agent** `[frontend, backend, ai-editor]`
El autor puede declarar contexto al agente: tipo de escritura, propósito, indicaciones específicas. Controles para encender y apagar el agente.
Dependencias: Build AI discussion panel.
Referencia: `odessay-ai-editor.md` (sección: Control del autor).

---

## Fase 7 — Desktop

Al terminar esta fase: Odessay existe como aplicación nativa de escritorio en macOS. La arquitectura local-first (SQLite nativo, sync en background) es el fundamento — sin ella, no hay desktop app.

---

**Package as desktop app (Tauri) — macOS** `[infra, desktop]`
Empaquetar la webapp como aplicación nativa usando Tauri. SQLite nativo reemplaza IndexedDB como storage local. La webapp ya está diseñada para esto: lógica de negocio separada de presentación, interfaz `localDB` abstraída desde la Fase 0. Binarios para macOS como primera plataforma. Windows y Linux como expansión posterior.
Dependencias: Implement local-first storage layer (Fase 0), todas las fases anteriores.
Referencia: `odessay-stack.md` (sección: Desktop).
