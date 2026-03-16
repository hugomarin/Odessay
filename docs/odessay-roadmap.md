# ODESSAY — Roadmap

**Documento de referencia para agentes de desarrollo y product management.**
Lee `odessay-fundacional.md` para la visión, `skill-product-manager.md` para el proceso de creación y ejecución de issues.

Este documento define el alcance completo del proyecto: fases, milestones, y los issues macro que componen cada fase con sus dependencias. Es la fuente de verdad del qué y el cuándo. El cómo vive en los skills.

---

## Principio de secuencia

Cada fase produce algo deployable y funcionalmente completo. Al terminar una fase, el producto es usable en ese estado. La siguiente fase agrega capacidades, no repara lo anterior.

Dentro de cada fase, el orden de ejecución es siempre: database → backend → frontend → validation. Los issues de infra son siempre `critical-path` y van primero.

---

## Fase 0 — Cimientos

`critical-path` para todas las fases siguientes. Nada se puede construir sin esto.

Al terminar esta fase: el proyecto existe en GitHub, hace deploy en Vercel, tiene Supabase configurado en staging y producción, el schema base está migrado, la autenticación funciona, el sistema de diseño está definido, y todas las variables de entorno están documentadas.

---

**Setup GitHub repository and branch strategy** `[infra]` `[critical-path]`
Crear el repo, definir branch strategy (main + feature branches con formato `feat/{issue-id}-{descripcion}`), configurar .gitignore, añadir CLAUDE.md y todos los docs y skills al repo.
Dependencias: ninguna. Es el primer issue del proyecto.

**Initialize Next.js project with Tailwind and ShadCN** `[infra, frontend]` `[critical-path]`
Setup de Next.js 15 con App Router. React 19. Tailwind CSS instalado. ShadCN instalado sin estilos default. Estructura de carpetas según CLAUDE.md. El proyecto hace build sin errores.
Dependencias: Setup GitHub repository.

**Configure Supabase projects (staging and production)** `[infra, database]` `[critical-path]`
Crear dos proyectos en Supabase. Documentar todas las variables de entorno del proyecto completo de una vez: Supabase (URL, anon key, service role), Anthropic API key, Resend API key, dominio Vercel. Configurar variables en el repo y en Vercel para ambos ambientes.
Dependencias: Initialize Next.js project.

**Configure Vercel deployment with branch previews** `[infra]` `[critical-path]`
Conectar repo a Vercel. Deploy automático desde main a producción. Branch previews automáticos para PRs. Variables de entorno configuradas en Vercel para staging y producción.
Dependencias: Configure Supabase projects.

**Define design system and Tailwind theme** `[frontend]` `[critical-path]`
Definir el sistema de diseño de Odessay: paleta de colores (fondo cálido, no blanco puro), tipografías (serif para cuerpo, sans para UI), escala de espaciado, tokens de sombra y borde. Materializar como configuración completa de Tailwind theme. Todo lo que se construya después usa estos tokens sin excepción.
Dependencias: Initialize Next.js project.
Referencia: skill-design.md (documento separado que acompaña este issue).

**Create initial database schema migrations** `[database]` `[critical-path]`
Migraciones iniciales para todas las tablas: profiles, writings (con campos `version`, `sync_status`, `deleted_at`), correspondences, collections, writing_collections, writing_shares, ai_observations, margins, invitations. RLS en todas las tablas. Triggers base: on_auth_user_created, slug generation, body_text extraction, correspondence creation.
Dependencias: Configure Supabase projects.
Referencia: odessay-modelo-datos.md.

**Implement authentication — signup, login, session middleware** `[backend, frontend]`
Supabase Auth con email + contraseña. Páginas /signup y /login con sistema de diseño aplicado. Middleware de Next.js para rutas protegidas con redirect a /login. Trigger on_auth_user_created crea profile automáticamente.
Dependencias: Create initial database schema migrations, Define design system.

**Implement local-first storage layer** `[backend, database]` `[critical-path]`
Implementar la capa de persistencia local como base de toda la experiencia. En desktop (Tauri/Electron): SQLite nativo. En web: IndexedDB como fallback. Interfaz unificada `localDB` que abstrae el storage — los componentes no saben con qué hablan. Sync worker en background con cola de mutaciones y reintentos exponenciales. El usuario nunca espera a Supabase — la base local es la fuente de verdad operativa.
Dependencias: Create initial database schema migrations.
Referencia: skill-backend.md (sección: Arquitectura local-first), odessay-stack.md.

---

## Fase 1 — Escribir

Al terminar esta fase: un usuario puede registrarse, abrir el editor, escribir con auto-save local-first, y encontrar sus writings en /desk.

---

**Implement TipTap editor with typography and numbered sections** `[frontend]`
Editor TipTap headless configurado. Tipografía del sistema de diseño aplicada. Secciones numeradas como extensión custom. Sin toolbar visible por default — formato accesible por atajos o menú contextual. Fondo cálido. El cursor y el texto son los protagonistas.
Dependencias: Implement authentication, Define design system.
Referencia: skill-frontend.md, odessay-ai-editor.md.

**Implement auto-save — local-first** `[backend, database]`
onUpdate de TipTap guarda inmediatamente en la base local (SQLite/IndexedDB). Sync a Supabase en background con debounce de 1.5 segundos y reintentos silenciosos. Indicador visual mínimo en statusbar (estado sutil, sin texto intrusivo). El usuario nunca espera — el save local es instantáneo. Incrementar `version` en cada save para detección de conflictos.
Dependencias: Implement TipTap editor, Implement local-first storage layer.
Referencia: skill-backend.md (sección: Arquitectura local-first), odessay-modelo-datos.md (sección: writings).

**Build /desk — personal writing desk** `[frontend, backend]`
Vista principal del autor. Tres secciones: Hero con cards horizontales de drafts activos (In progress), filter bar (All activity / Correspondence / With responses / Received), tabla de actividad agrupada por fecha con columnas Writing | State | With | Date. Acceso a crear nuevo writing desde el sidebar. Notificaciones sutiles de nuevas respuestas o cartas recibidas. Datos se leen primero desde base local.
Dependencias: Implement auto-save — local-first.
Referencia: odessay-arquitectura.md (sección: Desk), skill-design-vistas.md (sección: Desk).

**Implement writing states and private visibility** `[backend, frontend]`
Estados draft/finished como dimensiones independientes de visibilidad. Controles en el editor para cambiar estado. Visibilidad private por default al crear. Writing solo visible para el autor cuando es private.
Dependencias: Build /desk.

---

## Fase 2 — Compartir, leer y anotar

Al terminar esta fase: un usuario puede compartir un writing, el destinatario puede leerlo en un espacio dedicado, y puede hacer highlights y anotaciones en los márgenes.

---

**Implement shared and public visibility** `[backend, database]`
Lógica completa de visibilidad shared y public. RLS actualizado para cada caso. API para cambiar visibilidad en cualquier dirección y en cualquier momento. Un writing puede pasar de private a shared a public y volver.
Dependencias: Implement writing states.

**Implement writing_shares — share with specific users** `[backend, frontend]`
Buscar usuarios por username o email. Crear entradas en writing_shares con can_respond. Revocar acceso. Vista /shared para writings recibidos de otros.
Dependencias: Implement shared and public visibility.

**Build reading space — dedicated reading view** `[frontend]`
Vista dedicada para leer un writing. Misma tipografía y espacio que el editor. Sin cursor, sin toolbar, sin posibilidad de editar. Es recibir el texto, no intervenirlo. Dignidad simétrica entre escritura y lectura.
Dependencias: Implement writing_shares.

**Implement margins — highlights and annotations** `[frontend, backend, database]`
Sistema de highlights y anotaciones en la reading view. Flujo: el lector selecciona texto → popup mínimo con "Mark" o "Annotate" → highlight con fondo ámbar o burbuja de anotación. Panel de márgenes en el lateral. Privados por default. El lector puede compartirlos con el autor del writing. Los márgenes se anclan a offsets de texto plano (`anchor_start`, `anchor_end`) y se persisten en la tabla `margins`. Disponibles como contexto al iniciar una respuesta.
Dependencias: Build reading space.
Referencia: odessay-margenes.md, odessay-modelo-datos.md (tabla: margins).

**Build public author space — /{username} and /{username}/{slug}** `[frontend, backend]`
Espacio público del autor en /{username}. Vista pública para visitantes: writings y collections públicas, sin métricas visibles. Vista propia para el autor autenticado: todo el contenido con toggle entre "cómo me ven" y "todo mi contenido". Writing público accesible en /{username}/{slug}. Slug generado automáticamente del título.
Dependencias: Build reading space.

---

## Fase 3 — Responder y corresponder

Al terminar esta fase: dos personas pueden intercambiar writings y ver su correspondencia completa como árbol navegable.

---

**Implement reply mechanism — /write?reply_to={id}** `[backend, frontend]`
Editor pre-cargado como respuesta a un writing específico. Writing creado con parent_id apuntando al original. Referencia sutil al writing que se responde visible en el editor. El espacio de escritura es autónomo — el writing original no se muestra en pantalla.
Dependencias: Build reading space.
Referencia: odessay-flujos.md (sección: Leer y Responder), odessay-paginas.md.

**Implement correspondence creation and tree structure** `[backend, database]`
Crear correspondence automáticamente cuando un writing recibe su primera respuesta. Asignar correspondence_id al writing raíz y a todas las respuestas del árbol. Respuestas subsiguientes heredan el correspondence_id. Trigger para actualizar correspondences.updated_at con cada nuevo writing en el árbol.
Dependencias: Implement reply mechanism.
Referencia: odessay-modelo-datos.md (sección: correspondences).

**Build /correspondences — list and tree view** `[frontend, backend]`
Lista de correspondencias donde el usuario participa (como autor del writing raíz o de alguna respuesta). Vista del árbol completo de writings de una correspondencia. Navegación entre nodos. Se puede responder a cualquier writing del árbol desde esta vista.
Dependencias: Implement correspondence creation.

---

## Fase 4 — Invitar

Al terminar esta fase: un usuario puede invitar a alguien que no tiene cuenta y la primera experiencia de esa persona en Odessay es leer la carta que le escribieron.

---

**Implement invitations — token generation and sharing link** `[backend, database]`
Crear invitación con token único. Generar link /invite/{token} que el autor comparte por cualquier canal (WhatsApp, email, lo que prefiera). La invitación referencia el writing si existe. Estado de invitación: pending, accepted, expired.
Dependencias: Implement correspondence creation.
Referencia: odessay-flujos.md (sección: Invitar).

**Build /invite/{token} — invitation landing page** `[frontend]`
Página de llegada para invitados sin autenticación. Muestra el writing-invitación si existe. Lleva al signup con email prellenado si viene de un link con email. La primera experiencia en Odessay es leer lo que alguien escribió para ti.
Dependencias: Implement invitations.

**Integrate Resend for transactional email** `[backend, infra]`
Notificación por email cuando un writing es compartido. Email de invitación epistolar como canal complementario al link (el link es lo principal, el email es opcional). Templates simples y coherentes con la marca. En staging, emails no llegan a destinatarios reales.
Dependencias: Build /invite/{token}.
Referencia: skill-backend.md (sección: Resend).

---

## Fase 5 — AI Editor

Al terminar esta fase: el agente editor está activo, observa en pausas naturales de escritura, el autor puede invocarlo directamente, y puede declarar contexto para adaptar las observaciones.

---

**Implement /api/ai/observe — automatic observations** `[backend, ai-editor]`
API route server-side. Recibe body del writing e instrucciones de contexto del autor. Invoca Claude API con el system prompt definido en odessay-ai-editor.md. Parsea la respuesta: si es SILENCIO, no envía nada al cliente. Guarda observaciones en ai_observations. Se invoca con debounce tras pausa de escritura (~8-15 segundos). Solo si el agente está activo.
Dependencias: Implement auto-save, Configure Supabase projects.
Referencia: odessay-ai-editor.md, skill-backend.md (sección: Claude API).

**Render AI observations as margin notes in editor** `[frontend, ai-editor]`
Extensión TipTap para renderizar observaciones al margen del párrafo relevante. Sutiles visualmente. Descartables con gesto mínimo. No interrumpen el flujo de escritura. Observación descartada actualiza status en ai_observations.
Dependencias: Implement /api/ai/observe.
Referencia: odessay-ai-editor.md (sección: Interfaz visual).

**Implement /api/ai/discuss — direct invocation and discussion** `[backend, ai-editor]`
API route para invocación directa del agente por el autor. Recibe body del writing + pregunta o instrucción del autor + historial de la conversación en sesión. Respuesta más extensa que las observaciones automáticas. El historial de sesión se mantiene en memoria durante la escritura — no se persiste en v1.
Dependencias: Implement /api/ai/observe.
Referencia: odessay-ai-editor.md (sección: Modos de interacción).

**Build AI discussion panel in editor** `[frontend, ai-editor]`
Panel de diálogo junto al editor. Se abre cuando el autor invoca al agente o inicia una discusión. Conversación enfocada en el texto. Se cierra cuando no se necesita. No compite con el espacio de escritura ni reduce el área del editor de forma intrusiva.
Dependencias: Implement /api/ai/discuss.

**Implement author context instructions for AI agent** `[frontend, backend, ai-editor]`
El autor puede declarar contexto al agente: tipo de escritura, propósito, indicaciones específicas. El agente adapta sus observaciones al contexto declarado. Controles para encender y apagar el agente en cualquier momento.
Dependencias: Build AI discussion panel.
Referencia: odessay-ai-editor.md (sección: Control del autor).

---

## Fase 6 — Pulir

Al terminar esta fase: el producto está completo. Collections funcionando, páginas públicas, i18n en inglés y español, lectura optimizada para mobile, SEO y Open Graph.

---

**Implement collections — CRUD and writing assignment** `[frontend, backend, database]`
Crear, editar, eliminar collections. Asignar writings a collections desde el editor y desde la vista de la collection. Un writing puede estar en múltiples collections. Collections públicas visibles en el espacio público del autor.
Dependencias: Build /desk.
Referencia: odessay-modelo-datos.md (sección: collections).

**Build public pages — landing, manifesto, about, terms, privacy** `[frontend]`
Páginas públicas sin autenticación. Landing como filtro: quien lo lee y siente algo, entra. Manifiesto completo. Tono y diseño coherentes con odessay-fundacional.md. Acceso a login y signup.
Dependencias: Define design system.

**Implement i18n — English and Spanish** `[frontend, infra]`
next-intl configurado. Inglés como idioma default. Español como segundo idioma prioritario. Todas las cadenas de UI traducidas en ambos idiomas. URLs en inglés.
Dependencias: Build public pages.

**Optimize reading experience for mobile** `[frontend]`
Páginas de lectura (/{username}/{slug}, /correspondences/{id}, /shared) funcionan en mobile. /write muestra mensaje amable indicando que la escritura es en desktop. Tipografía adaptada para pantallas pequeñas. Sin editor en mobile.
Dependencias: Build reading space.

**Implement SEO and Open Graph for public pages** `[frontend, backend]`
Metadata para landing, /{username}, /{username}/{slug}. Open Graph con título, autor y extracto para writings públicos. Preview coherente en redes y mensajería.
Dependencias: Build public author space, Build public pages.

**Package as desktop app (Tauri)** `[infra, desktop]`
Empaquetar la webapp como aplicación nativa de escritorio usando Tauri. La arquitectura local-first (SQLite nativo, sync en background) es el fundamento de esta fase — sin ella, no hay desktop app. La webapp ya está diseñada para ser empaquetada sin reescritura mayor: lógica de negocio separada de presentación desde el inicio. Binarios para macOS (primera plataforma objetivo). Windows y Linux como fases posteriores.
Dependencias: Implement local-first storage layer (Fase 0), todas las fases anteriores.
Referencia: odessay-stack.md (sección: Desktop).

**Seed data y ambiente de staging completo** `[infra, database]`
Definir y poblar seed data realista para el ambiente de staging: writings de prueba con diferentes estados y visibilidades, correspondencias completas con múltiples participantes, collections con writings clasificados y sin clasificar, márgenes de ejemplo. Sin seed data, el testing es manual y los agentes no pueden verificar su trabajo de forma autónoma.
Dependencias: Implement collections, Implement margins, Build /correspondences.
