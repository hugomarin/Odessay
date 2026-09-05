# ODESSAY — Roadmap

**Documento de referencia para agentes de desarrollo y product management.**
Lee `workflow/context/core/odessay-fundacional.md` para la visión, `.agents/skills/skill-product-manager/SKILL.md` para el proceso de creación y ejecución de issues.

Este documento define el alcance completo del producto: fases, los issues macro que componen cada fase y sus dependencias. Es la fuente de verdad del qué y el cuándo. El cómo vive en los skills.

**Ámbito del roadmap:** este documento mezcla fases ya ejecutadas del runtime web actual con dirección futura de desktop. Desde el cierre de Fase 3, el roadmap pivota explícitamente a la creación del sistema multi-runtime de Odessay: shared core, adapters por runtime, desktop como foco principal y web como versión convergente sobre los mismos contratos. Para cualquier issue o fase que toque desktop, shared core, `.md` como contrato documental, runtime boundaries o extracción de servicios, el roadmap debe leerse junto con:

- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-migration-diagnostic.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`

**Estructura en Linear:** cada fase es un **proyecto independiente** dentro del team Odessay. No hay un proyecto paraguas "Odessay" — el team ya cumple ese rol. Ver `.agents/skills/skill-product-manager/SKILL.md` §Jerarquía de Linear para el contrato completo.

---

## Principio de secuencia

Cada fase produce algo deployable, funcionalmente completo y **visualmente terminado**. No existe una fase de pulido al final — el estándar de calidad visual se aplica desde la Fase 0. Lo que se entrega en cada fase es lo que el usuario ve.

La referencia visual es siempre los prototipos en `/workflow/context/reference/` y los valores exactos de `.agents/skills/skill-design/vistas.md`. Lo que se ve en los prototipos es lo que se construye.

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
Setup de Next.js 15 con App Router. React 19. Tailwind CSS instalado. ShadCN inicializado (Style: Default, Base color: Neutral, CSS variables: Yes). Estructura de carpetas según `.agents/skills/skill-frontend/SKILL.md`. El proyecto hace build sin errores.
Dependencias: Setup GitHub repository.

**Configure Supabase projects (staging and production)** `[infra, database]` `[critical-path]`
Crear dos proyectos en Supabase. Documentar todas las variables de entorno del proyecto completo de una vez: Supabase (URL, publishable key, service role key), AI provider key/model server-side configurables, Resend API key, dominio Vercel. Configurar variables en el repo y en Vercel para ambos ambientes.
Dependencias: Initialize Next.js project.

**Configure Vercel deployment with branch previews** `[infra]` `[critical-path]`
Conectar repo a Vercel. Deploy automático desde main a producción. Branch previews automáticos para PRs. Variables de entorno configuradas en Vercel para staging y producción.
Dependencias: Configure Supabase projects.

**Implement design system — tokens, typography, ShadCN base components** `[frontend]` `[critical-path]`
Implementar el sistema de diseño completo de Odessay: tokens de color en `globals.css` mapeados a variables ShadCN, configuración de Tailwind theme con colores semánticos, sombras y border-radius. Instalar Geist Sans y Lora. Configurar los archivos de componentes ShadCN (Capa 2): card, button, input, textarea, dialog, popover, dropdown-menu, tooltip, badge, sheet, avatar — con los defaults de Odessay aplicados una vez. A partir de este issue, todos los componentes heredan la identidad visual sin `className` adicional.
Dependencias: Initialize Next.js project.
Referencia: `.agents/skills/skill-design/SKILL.md` (tokens, tipografía, ShadCN), `.agents/skills/skill-design/vistas.md` (valores por vista).

**Create initial database schema migrations** `[database]` `[critical-path]`
Migraciones iniciales para todas las tablas: profiles, writings (con `version`, `sync_status`, `deleted_at`, `slug`), correspondences, collections, writing_collections, writing_shares, ai_observations, margins (con `shared_at`, `updated_at`), invitations. RLS en todas las tablas. Triggers base: on_auth_user_created, slug generation, body_text extraction, correspondence creation.
Dependencias: Configure Supabase projects.
Referencia: `workflow/context/core/odessay-modelo-datos.md`.

**Implement authentication — signup, login, session middleware** `[backend, frontend]`
Supabase Auth con email + contraseña. Páginas /signup y /login con sistema de diseño aplicado. Middleware de Next.js para rutas protegidas con redirect a /login. Trigger on_auth_user_created crea profile automáticamente.
Dependencias: Create initial database schema migrations, Implement design system.

**Implement local-first storage layer** `[backend, database]` `[critical-path]`
Implementar la capa de persistencia local como base de toda la experiencia **del runtime web actual**. En web: IndexedDB. Interfaz unificada `localDB` que abstrae el storage — los componentes no saben con qué hablan. Sync worker en background con cola de mutaciones y reintentos exponenciales. El usuario nunca espera a Supabase — la base local es la fuente de verdad operativa de la web actual.
Dependencias: Create initial database schema migrations.
Referencia: `workflow/context/features/odessay-sync.md`, `.agents/skills/skill-backend/SKILL.md` (sección: Auto-save), `workflow/context/core/odessay-stack.md`.

---

## Fase 1 — Escribir

Al terminar esta fase: un usuario puede registrarse, abrir el editor, escribir con auto-save local-first, y encontrar sus writings en /desk. El editor y el desk están visualmente terminados. Además, existe un flujo de sharing para evaluación cerrada con testers (acceso controlado), suficiente para validar la experiencia de escritura con usuarios reales antes de Fase 2.

---

**Build global sidebar shell (3 estados)** `[frontend]`
Implementar el sidebar izquierdo reutilizable en toda la zona autenticada con tres estados: colapsado (52-55px), expandido (292-300px) y expandido con panel secundario contextual (Collections). Debe incluir navegación principal (Desk, Collections, Correspondences), acceso a Settings desde user bar, acción New writing y persistencia de estado por sesión.
Dependencias: Implement authentication, Implement design system.
Referencia: `workflow/context/core/odessay-arquitectura.md` (sección: Sidebar/List panel), `.agents/skills/skill-design/vistas.md` (sección: Sidebar), `workflow/context/reference/editor.html`, `workflow/context/reference/desk.html`, `workflow/context/reference/collections.html`.

**Implement TipTap editor** `[frontend]`
Editor TipTap headless configurado con el subconjunto de extensiones de Odessay: Document, Paragraph, Text, Heading (H1/H2/H3), Bold, Italic, Strike, Highlight, Link, Blockquote, BulletList, OrderedList, ListItem, Code, CodeBlock, Markdown (tiptap-markdown + parser compatible con el dialecto markdown del proyecto), History, Placeholder, CharacterCount. Sin toolbar flotante al seleccionar. Tipografía del sistema de diseño aplicada. Layout de tres capas: topbar 46px + writing area flex-1 + statusbar 32px. Sidebar en modo mini (52px) por defecto en el editor.
Incluye modales de rename, insert link e insert footnote, shortcuts de teclado para formato testeados sin colisiones (Mac/Win/Linux) y métricas de texto en panel derecho (palabras, caracteres, oraciones, tiempo de lectura, páginas estimadas).
Dependencias: Build global sidebar shell (3 estados).
Referencia: `workflow/context/features/odessay-editor.md`, `.agents/skills/skill-design/vistas.md` (sección: Editor), `workflow/context/reference/editor.html`.

**Implement auto-save — local-first** `[backend, database]`
onUpdate de TipTap guarda inmediatamente en la base local (IndexedDB). Sync a Supabase en background con debounce de 1.5 segundos y reintentos silenciosos. Indicador visual mínimo en statusbar ("Saved" / "Saving..." en ink-4/ink-3, sin iconos). El usuario nunca espera — el save local es instantáneo. UUID generado en cliente para escrituras nuevas. Incrementar `version` en cada save.
Dependencias: Implement TipTap editor, Implement local-first storage layer.
Referencia: `workflow/context/features/odessay-sync.md`, `workflow/context/features/odessay-editor.md` (sección: Auto-save), `.agents/skills/skill-backend/SKILL.md` (sección: Auto-save).

**Build /desk — personal writing desk** `[frontend, backend]`
Vista principal del autor. Tres secciones: Hero con cards horizontales deslizables de drafts activos (220px, scroll con snap), filter bar (All activity / Correspondence / With responses / Received), tabla de actividad agrupada por fecha (Today / This week / Earlier) con columnas Writing | State | With | Date. Datos se leen primero desde base local.
Dependencias: Implement auto-save.
Referencia: `workflow/context/core/odessay-arquitectura.md` (sección: Desk), `.agents/skills/skill-design/vistas.md` (sección: Desk), `workflow/context/reference/desk.html`.

**Implement writing states and private visibility** `[backend, frontend]`
Estados draft/finished como dimensiones independientes de visibilidad. Panel Properties en el editor para cambiar estado y visibilidad. Visibilidad private por default al crear. Writing solo visible para el autor cuando es private.
Dependencias: Build /desk.

**Enable closed sharing for writing UX testing** `[backend, frontend]`
Habilitar un modo de sharing controlado para evaluación de experiencia de escritura al cierre de fase: generación de link privado por writing y lectura para testers invitados. No incluye el set completo de visibilidad/shared/public de Fase 2; es una capacidad mínima de validación con usuarios reales.
Dependencias: Implement writing states and private visibility.

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
Referencia: `workflow/context/core/odessay-arquitectura.md` (sección: Reading view), `.agents/skills/skill-design/vistas.md` (sección: Reading), `workflow/context/reference/reading.html`.

**Implement margins — highlights and annotations** `[frontend, backend, database]`
Sistema de highlights y anotaciones en la reading view. Flujo: seleccionar texto → popup mínimo (Mark / Annotate) → highlight ámbar o burbuja de anotación. Panel de márgenes 296px desde topbar. Privados por default. Compartibles con el autor. Anclados a offsets de body_text. Disponibles como contexto al iniciar una respuesta.
Dependencias: Build reading view.
Referencia: `workflow/context/features/odessay-margenes.md`, `workflow/context/core/odessay-modelo-datos.md` (tabla: margins), `workflow/context/reference/reading-margins-panel.png`.

**Build public author space — /{username} and /{username}/{slug}** `[frontend, backend]`
Espacio público del autor en /{username}: writings y collections públicas, sin métricas visibles. Vista propia con toggle "cómo me ven" / "todo mi contenido". Writing público accesible en /{username}/{slug}. Slug generado automáticamente del título.
Dependencias: Build reading view.
Referencia: `workflow/context/features/odessay-espacio-publico.md`, `.agents/skills/skill-design/vistas.md` (sección: Espacio público).

**Optimize reading for mobile** `[frontend]`
Páginas de lectura (/{username}/{slug}, /correspondences/{id}, /shared) funcionales en mobile. /write muestra mensaje amable indicando que la escritura es en desktop. Tipografía adaptada para pantallas pequeñas según tabla responsive de `workflow/context/features/odessay-editor.md`.
Dependencias: Build reading view.

---

## Fase 3 — Organizar y publicar

Al terminar esta fase: el modo Organizar está completo y el autor tiene un flujo real de preparación para publicación. Puede clasificar su archivo en collections, trabajar con múltiples documentos abiertos, recuperar y gestionar su cuenta, compartir previews con comentarios visibles, optimizar texto antes de publicar y navegar documentos recientes desde el sidebar.

---

**Implement collections — CRUD and writing assignment** `[frontend, backend, database]` `[critical-path]`
Crear, editar, eliminar collections. Asignar writings a collections desde el editor (panel Properties) y desde la vista /collections. Un writing puede estar en múltiples collections. Collections públicas visibles en el espacio público del autor. Banner uncategorized siempre visible cuando hay writings sin clasificar. Colecciones expandibles sin navegación a otra página.
Dependencias: Build /desk, Implement writing states.
Referencia: `workflow/context/features/odessay-collections.md`, `workflow/context/core/odessay-arquitectura.md` (sección: Collections), `.agents/skills/skill-design/vistas.md` (sección: Collections), `workflow/context/reference/collections.html`.

**Build multi-document workspace — editor tabs and recent documents** `[frontend, backend]`
Permitir múltiples writings abiertos en paralelo dentro del editor como pestañas de trabajo. Cada pestaña muestra título, estado de guardado y cambios pendientes. Cambiar entre pestañas sin salir del editor ni pasar por el desk. Restaurar sesión (pestañas + posición de cursor) al reabrir app. En sidebar, añadir bloque "Recientes" con los últimos 8 writings ordenados por `updated_at`; hacer clic abre en nueva pestaña directamente desde el sidebar, sin redirigir al desk. Si el writing ya está abierto, el clic lleva foco a esa pestaña.
Dependencias: Implement TipTap editor, Implement auto-save, Build global sidebar shell (3 estados).
Referencia: `workflow/context/core/odessay-arquitectura.md` (sección: Sidebar/List panel), `workflow/context/features/odessay-editor.md`.

**Implement find & replace in editor** `[frontend]`
Panel de búsqueda integrado en el editor (no modal). `Cmd+F` / `Ctrl+F` abre búsqueda; resalta todas las coincidencias en tiempo real mientras se escribe. Navegación entre coincidencias con `Enter` / `Shift+Enter`. `Cmd+H` / `Ctrl+H` expande el campo de reemplazo: reemplazar coincidencia activa (y avanza a la siguiente) o reemplazar todas con confirmación del número de cambios. Opción de distinción de mayúsculas/minúsculas. `Escape` cierra el panel y devuelve foco al editor.
Dependencias: Implement TipTap editor.

**Add selection metrics to editor statusbar** `[frontend]`
Cuando el autor selecciona texto, la statusbar reemplaza las métricas del documento por las métricas de la selección activa: palabras seleccionadas y caracteres seleccionados. Al deseleccionar, vuelve a las métricas del documento completo (palabras, caracteres, oraciones, tiempo de lectura, páginas). La transición es inmediata sin parpadeo. Complementa el panel de métricas del lado derecho definido en Fase 1.
Dependencias: Implement TipTap editor.

**Implement preview sharing with visible margin notes** `[frontend, backend, database]`
Cuando un writing se comparte en preview, el destinatario puede ver highlights y anotaciones de márgenes que el autor haya marcado como compartibles. Mantener distinción entre notas privadas y compartidas, con control explícito de visibilidad por nota.
Dependencias: Implement writing_shares, Implement margins.
Referencia: `workflow/context/features/odessay-margenes.md`, `workflow/context/core/odessay-modelo-datos.md` (tabla: margins).

**Implement publication optimization mode in editor** `[frontend, backend]`
Agregar un modo "Ready for publication" con acciones concretas: corrección ortográfica, mejoras de redacción, sugerencias de claridad/fluidez, ajuste de tono y checklist de publicación con comentarios accionables. Mostrar sugerencias con diff claro y aplicación selectiva por bloque o global.
Dependencias: Implement TipTap editor, Implement auto-save.
Referencia: `workflow/context/features/odessay-editor.md`, `workflow/context/core/odessay-fundacional.md`.

**Improve text rendering consistency across editor, preview, and public reading** `[frontend]`
Unificar renderizado tipográfico y de bloques (párrafos, headings, listas, blockquotes, code, links, highlights) para que el texto se vea consistente en /write, preview y /{username}/{slug}. Corregir desajustes de spacing, line-height y cortes visuales.
Dependencias: Build reading view, Build public author space, Implement publication optimization mode in editor.
Referencia: `workflow/context/features/odessay-editor.md`, `.agents/skills/skill-design/vistas.md`.

**Implement password recovery flow** `[backend, frontend]`
Flujo completo de recuperación de contraseña: página /forgot-password con formulario de solicitud, email vía Supabase Auth, ruta /auth/reset-password para ingresar nueva contraseña, redirect post-reset a /desk. Diseño coherente con /login y /signup.
Dependencias: Implement authentication (Fase 0).

**Implement profile settings — email and password update** `[backend, frontend]`
Página de ajustes de perfil para usuario autenticado: cambio de email (con reconfirmación vía Supabase), cambio de contraseña, actualización de username y display name. Validación en cliente con Zod. Feedback visual de éxito/error. Accesible desde el sidebar.
Dependencias: Implement authentication (Fase 0), Build global sidebar shell (3 estados).

**Configure Supabase Auth custom SMTP on auth.odessay.com** `[backend, infra]`
Configurar Supabase Auth con custom SMTP usando Resend como proveedor de envío. Supabase Auth mantiene tokens, links, expiración, sesiones y templates de autenticación. Resend solo entrega el correo. Dominio de envío: `auth.odessay.com`; From canónico: `Odessay <no-reply@auth.odessay.com>`.
Dependencias: Implement authentication (Fase 0). Este setup desbloquea validación completa de recuperación de contraseña en producción.
Referencia: `workflow/context/features/odessay-auth-email.md`.

**Define Supabase Auth email templates and transactional copy** `[frontend, infra]`
Templates de autenticación en Supabase Auth: confirmación de cuenta, recuperación de contraseña, cambio de email y reautenticación si aplica. Deben ser sobrios, con un solo CTA y sin marketing. Los emails no-auth (invitaciones, writing recibido) se documentan aparte.
Dependencias: Configure Supabase Auth custom SMTP on auth.odessay.com.

**Build public pages — landing, manifesto, about, terms, privacy** `[frontend]`
Páginas públicas sin autenticación. Landing como filtro: quien lo lee y siente algo, entra. Manifiesto completo. Tono y diseño coherentes con `workflow/context/core/odessay-fundacional.md`. Acceso a login y signup.
Dependencias: Implement design system.

Estructura de diseño por página:

- **Landing** — columna única `max-w-[640px] mx-auto`. Sin hero genérico, sin grid de features. Estructura: (1) logo Lora 17px centrado, (2) párrafo fundacional en Lora 22px line-height 1.7 — la premisa del producto en 3-4 líneas sin bullets, (3) botón terracota "Crear cuenta" centrado, (4) link secundario `ink-4` "Iniciar sesión". Above the fold solo estos cuatro elementos. Debajo del fold: manifiesto completo en Lora, sin chrome adicional. La landing es la puerta del manifiesto.
- **Manifiesto** `/manifesto` — página standalone sin sidebar ni topbar. Solo texto. `max-w-[660px] mx-auto`, Lora 18px, line-height 1.85, fondo `bg-bg`. Al final: link "Crear cuenta" en terracota.
- **About, Terms, Privacy** — misma estructura que el manifiesto: texto en columna única sin navegación compleja. About incluye logo y link de vuelta.
- **Regla transversal:** ninguna página pública tiene más de un CTA visible a la vez. El único color de acción es terracota. Sin emojis. Sin animaciones de entrada.

---

### Mejoras de diseño transversales — Fase 3

Estas especificaciones aplican a los issues de frontend de esta fase y de las anteriores. Son parte del definition of done de cada componente UI — no son issues separados.

**Estados de interacción**

Cada feature de UI cubre los cuatro estados. "No items found." no es un diseño — es un bug de UX.

| Feature | Estado vacío | Estado de carga | Estado de error |
|---|---|---|---|
| **Desk — tabla de actividad** | Ilustración lineal mínima (pluma sobre papel) + "Tu escritorio está en blanco." en Lora italic + botón terracota "Escribe tu primera carta" | Skeleton de 3 filas con `animate-pulse`, mismas proporciones que la tabla real | Toast destructivo "No pudimos cargar tu escritorio. Intentando de nuevo…" con reintentos automáticos |
| **Desk — hero drafts** | Sección oculta hasta que haya al menos un draft — nunca se muestra vacía | Skeleton horizontal de 1 card a 220px | Sección omitida silenciosamente si falla la carga |
| **Editor — auto-save** | — | "Guardando…" en `ink-4` 11px en statusbar | "No se pudo guardar" en destructive + ícono `AlertCircle` 12px; nunca bloquear la escritura |
| **Reading view** | — | Skeleton: título 30px + 8 líneas de cuerpo con `animate-pulse` fondo `muted` | Página dedicada: "Este texto no está disponible." + link volver |
| **Correspondences — inbox** | "Todavía no tienes correspondencias." + 2 líneas en Lora italic sobre el concepto epistolar + botón "Comparte tu primer escrito" | Skeleton de 2 hilos con avatar + título + badge | Toast "No pudimos cargar tus correspondencias." |
| **Collections** | Banner "Tienes X escritos sin clasificar" siempre visible + "Ninguna colección todavía." con botón inline | Skeleton de lista con 2 items | Toast + reintentar |
| **Public author space** | Sin escritos públicos: "Este espacio está en construcción." en Lora italic — sin disculpa, solo calidez | Skeleton de grid de writings | 404 con identidad Odessay, no genérico de Next.js |
| **AI observations** | Sin observaciones: el margen permanece limpio — sin placeholder ni "El agente está observando…" | Nada — las observaciones aparecen cuando están listas | Observación descartada silenciosamente; nunca mostrar error mientras el autor escribe |

Regla para estados vacíos: nunca fríos. El vacío es la primera experiencia de muchos usuarios — siempre con calidez y una acción clara. Los mensajes de estado vacío usan Lora italic; el CTA usa Geist Sans.

**Arco emocional — los tres momentos que definen el producto**

Odessay no es un editor de texto. Estos tres momentos determinan si se siente especial o como otra app de escritura.

- **Primera carta (Fase 1):** placeholder del título "Sin título" en Lora italic `ink-4`. Placeholder del cuerpo: "Comienza a escribir…" en Lora italic `ink-4` — sin instrucciones superpuestas, sin onboarding. El sidebar arranca en mini (52px). La primera letra hace desaparecer ambos placeholders al mismo tiempo. El cursor terracota parpadea en el título hasta que el usuario escribe.
- **Primera respuesta recibida (Fase 5):** no hay badge numérico — hay un cambio de estado en el hilo: "Tu turno" en terracota, sin parpadeo, sin animación agresiva. Al abrir el hilo, la respuesta aparece debajo del writing propio con la línea conectora visible. El botón "Escribir respuesta" en terracota es el único CTA prominente — nada compite con él.
- **Primera invitación enviada (Fase 6):** confirmación mínima: toast "Link copiado. Envíalo como quieras." — sin celebración exagerada, sin confetti, sin modal. El link está en el portapapeles. El autor ya sabe lo que hacer.

**Contrato de accesibilidad**

Aplica a todos los issues de frontend. Parte del definition of done de cada componente.

Navegación por teclado:
- Sidebar: `Tab` navega todos los items en orden DOM. `Enter`/`Space` activa. `Escape` colapsa si está expandido
- Editor: todos los controles de topbar accesibles por teclado. El área de escritura recibe foco al cargar
- Reading view: `ArrowLeft`/`ArrowRight` navegan writings. `Escape` vuelve (ya en el issue)
- Modales y dialogs: foco atrapado dentro mientras están abiertos. `Escape` cierra. Foco regresa al trigger
- Correspondence thread: `ArrowUp`/`ArrowDown` navega entre mini-docs del hilo

ARIA y semántica:
- Sidebar: `role="navigation"` + `aria-label="Navegación principal"`. Items activos con `aria-current="page"`
- Topbar: `role="banner"`. Título de vista con `aria-live="polite"` para cambios de ruta
- Estados de carga: `aria-busy="true"` en el contenedor + `aria-label="Cargando…"` en el skeleton
- Estados de error: `role="alert"` en toasts de error
- Editor TipTap: `role="textbox"` + `aria-multiline="true"` + `aria-label="Editor de escritura"`
- Cada mini-doc en correspondencias: `role="article"`. Badge de turno: `aria-label="Tu turno de responder"`

Contraste:
- Todos los textos de UI cumplen WCAG AA mínimo (4.5:1 texto normal, 3:1 texto grande)
- El terracota `hsl(22 55% 38%)` sobre `bg-bg` cumple 4.5:1 — verificado
- Nunca transmitir información solo mediante color: los badges de estado siempre incluyen texto, no solo color

Touch targets (reading view y espacio público en mobile, Fase 2):
- Mínimo 44×44px para todos los elementos interactivos
- Topbar en mobile: 52px de alto para acomodar touch targets
- Margen mínimo de 8px entre elementos interactivos para evitar toques accidentales

---

## Fase 4 — Shared Core Multi-Runtime

Al terminar esta fase: Odessay deja de estar organizado alrededor del runtime web actual y pasa a tener un núcleo de producto explícito. Desktop deja de ser una idea “posterior” y se convierte en el driver arquitectónico del sistema, mientras web deja de ser la fuente implícita de verdad estructural.

---

**Hito**
La arquitectura deja de estar implícita en el runtime web y queda expresada como una base de producto compartible entre runtimes.

**Al cierre de esta fase debe ser verdad que:**

- existe una partición explícita entre core compartido y responsabilidades específicas de plataforma
- el contrato documental de Odessay queda definido como parte estructural del producto, no como detalle de implementación
- desktop deja de depender de “empaquetar la web” como estrategia
- cualquier trabajo posterior de web o desktop puede clasificarse por layer y runtime scope sin ambigüedad

**Temas que entran en esta fase**

- definición y fijación de boundaries multi-runtime
- consolidación del contrato documental compartido
- reducción del acoplamiento estructural al runtime web actual
- criterios de validación para la migración

**Temas que no son objetivo de esta fase**

- shell desktop final
- capacidades remotas completas en desktop
- expansión funcional de producto sobre una base aún inestable

Referencia: `workflow/context/features/odessay-desktop-app.md`, `workflow/context/features/odessay-desktop-migration-diagnostic.md`, `workflow/context/features/odessay-desktop-target-architecture.md`, `workflow/context/features/odessay-desktop-migration-plan.md`, `.agents/skills/skill-architecture/SKILL.md`.

---

## Fase 5 — Convergencia Web sobre el Core Compartido

Al terminar esta fase: la versión web sigue siendo first-class, pero deja de ser un conjunto de flujos especiales acoplados entre sí. Web pasa a ser la primera superficie operando sobre el core compartido y sobre adapters explícitos.

---

**Hito**
La web funciona como una implementación del sistema, no como la definición del sistema.

**Al cierre de esta fase debe ser verdad que:**

- los flujos principales de escritura y lectura web corren sobre contratos ya estabilizados
- las dependencias del runtime web quedan encapsuladas como adapters identificables
- la persistencia local-first de web respeta el mismo contrato documental que servirá para desktop
- existe evidencia reproducible de que el core puede validarse sin depender de detalles accidentales del shell web

**Temas que entran en esta fase**

- convergencia del runtime web al core compartido
- explicitación de adapters web
- estabilización del write-path web sobre el contrato documental
- harnesses y validación de invariantes compartidos

**Temas que no son objetivo de esta fase**

- entregar aún una app desktop usable
- abrir nuevos frentes de feature que dependan de una base no cerrada

Referencia: `workflow/context/features/odessay-desktop-migration-diagnostic.md`, `workflow/context/features/odessay-desktop-target-architecture.md`, `workflow/context/features/odessay-desktop-migration-plan.md`, `workflow/context/features/odessay-sync.md`, `workflow/context/features/odessay-editor.md`, `.agents/skills/skill-architecture/SKILL.md`.

---

## Fase 6 — Desktop Local-First Runtime

Al terminar esta fase: Odessay existe como app desktop usable para escritura local real. El documento vive primero en el disco del usuario y la app ya puede sostener la promesa central del producto desktop sin depender de login ni de red.

---

**Hito**
Desktop ya escribe de verdad.

**Al cierre de esta fase debe ser verdad que:**

- la app desktop puede abrir, crear, editar y guardar documentos locales como capacidad nativa
- `.md` funciona como fuente de verdad del writing en desktop
- Rich mode y Source mode operan sobre el mismo documento canónico
- assets locales, índice derivado y settings existen como soporte del documento, no como sustituto
- la experiencia base desktop funciona offline

**Temas que entran en esta fase**

- runtime desktop local-first
- filesystem como base operativa del writing
- índice derivado y manejo local de assets/settings
- shell desktop solo en la medida necesaria para operar el modelo file-based

**Temas que no son objetivo de esta fase**

- paridad completa de capacidades remotas
- expansión colaborativa o social antes de cerrar la promesa local

Referencia: `workflow/context/features/odessay-desktop-app.md`, `workflow/context/features/odessay-desktop-target-architecture.md`, `workflow/context/features/odessay-desktop-migration-plan.md`, `workflow/context/core/odessay-stack.md`.

---

## Fase 7 — Capacidades Remotas y Paridad Web/Desktop

Al terminar esta fase: desktop y web convergen como una sola plataforma Odessay. Comparten el mismo núcleo de producto y se diferencian solo por runtime y adapters. La red vuelve a entrar, pero ya como extensión del sistema local y no como condición de existencia del documento.

---

**Hito**
Web y desktop ya no compiten entre sí; son dos superficies del mismo sistema.

**Al cierre de esta fase debe ser verdad que:**

- desktop puede conectarse a capacidades remotas sin perder su naturaleza local-first
- web y desktop preservan el mismo contrato documental y los mismos invariantes de producto
- publishing, sync, AI y auth se entienden como capacidades compatibles entre runtimes
- existe una política clara de coexistencia, releases y migración entre superficies

**Temas que entran en esta fase**

- reintroducción de capacidades remotas sobre la base desktop ya estable
- validación de paridad cross-runtime
- estrategia operativa de convivencia web/desktop

**Temas que no son objetivo de esta fase**

- abrir nuevas líneas de producto antes de cerrar la convergencia

Referencia: `workflow/context/features/odessay-desktop-app.md`, `workflow/context/features/odessay-desktop-target-architecture.md`, `workflow/context/features/odessay-desktop-migration-plan.md`, `workflow/context/features/odessay-prosemirror-tiptap.md`, `workflow/context/core/odessay-stack.md`, `.agents/skills/skill-architecture/SKILL.md`, `.agents/skills/skill-product-manager/SKILL.md`.

---

## Fase 8 — Biblioteca, Preview y Calidad de Producto

Al terminar esta fase: Biblioteca (Desk/Workspace) y Preview se sienten como un producto terminado, la identidad de documento (D1–D10) queda cerrada, la corrección ortográfica AI es confiable, y compartir/recibir contenido compartido funciona nativamente en desktop sin saltos al navegador. No reabre el contrato documental de Fase 7; consolida sobre la base ya convergida.

DoD formal: `workflow/define/dod-fase-8.md`.

---

**Desktop native Preview Link sharing** `[frontend, backend]`
"Share with link" en el panel Properties de desktop genera/copia/rota/revoca el token del preview link en la app, sin redirigir al navegador. Usa el mismo puente Bearer-token que `desktop-ai-service.ts` contra las rutas API existentes (ya Bearer-aware vía `getCurrentUserFromRequest`); no requiere cambios server-side.
Referencia: `lib/services/desktop/desktop-sharing-service.ts`, `lib/services/desktop-ai-service.ts`, `app/api/writings/[id]/share-test-link/route.ts`, `lib/supabase/request-auth.ts`, `components/editor/panels/properties-panel.tsx`.

**Desktop native People sharing** `[frontend, backend]`
Buscar e invitar a una persona específica, y revocar su acceso, funciona nativamente en desktop con el mismo puente Bearer-token, contra `app/api/writings/[id]/shares/route.ts`.
Referencia: `lib/services/desktop/desktop-sharing-service.ts`, `lib/services/web-sharing-service.ts`, `app/api/writings/[id]/shares/route.ts`, `components/editor/panels/properties-panel.tsx`.

**"Add to my writings" copy button (web reading surfaces)** `[frontend, backend, database]`
Un viewer autenticado que abre `/preview/[token]` o `/shared/[id]` puede convertir el writing en una copia propia, editable y desconectada del original con un click. Si no hay sesión, se solicita login/signup antes de completar la copia. Redirige a `/write/{newWritingId}`.
Dependencias: ninguna dura, pero comparte intención con ODE-292 (paridad desktop de lectura + guardar-como-propio de compartidos) — el import route debe quedar reusable por ese flujo.
Referencia: `app/api/writings/import/route.ts` (nuevo), `lib/sharing/test-link-access.ts`, `app/(public)/preview/[token]/page.tsx`, `app/(reading)/shared/[id]/page.tsx`.

**Learn word in orthography correction (user dictionary)** `[frontend, backend, database]`
Tercera acción "Learn word" en el panel de correcciones, además de Accept/Reject: descarta la sugerencia y persiste la palabra en un diccionario del usuario (`learned_words`, greenfield) para que el motor de corrección deje de marcarla en cualquier documento futuro. Distinto de la memoria por fingerprint existente (`correction-memory-client.ts`), que no generaliza por palabra.
Referencia: `workflow/context/features/odessay-ai-writing-assist.md`, `lib/ai/corrections.ts`, `lib/editor/correction-memory-client.ts`.

**Reorder editor tabs by drag** `[frontend]`
Arrastrar un tab del editor a otra posición cambia su orden; persiste en `LocalEditorSession.tabs`. Studio refleja el nuevo orden automáticamente (mirror existente, sin cambios propios). Requiere nueva dependencia de drag-and-drop (ninguna instalada hoy).
Referencia: `components/editor/editor-tabs.tsx`, `lib/local-db/editor-sessions.ts`.

**Automatic table of contents** `[frontend]`
Panel de TOC generado desde los headings del documento (niveles 1-3), al estilo Google Docs — se actualiza solo, navega por click. Usa `@tiptap/extension-table-of-contents` (no instalada, compatible con la versión TipTap 3.x actual).
Referencia: `workflow/context/features/odessay-prosemirror-tiptap.md`, `lib/editor/extensions.ts`.

**Document Versions — snapshot foundation (desktop)** `[frontend, backend, database]`
Modelo de datos de "versión" (snapshot inmutable y desconectado del `.md`) con dos triggers: automático, sugerido por el watcher de desktop cuando detecta un cambio externo genuino en un archivo que contiene al menos una anotación de margen tipo `ai` (ciclo de edición vía herramientas AI externas como Claude Code/Codex sobre el archivo local — condición corregida por audit 2026-07-01: presencia de anotación `ai`, no "no resuelta", porque `resolved` es cloud-only y el watcher no tiene acceso a red garantizado en ese instante); y manual, en cualquier momento. Runtime scope desktop-first v1 — depende del watcher de filesystem local. Requirió reconciliar una ambigüedad de contexto en `odessay-ai-editor.md` (aclarada 2026-07-01): el agente residente nunca genera texto, pero herramientas externas sobre archivos locales son un patrón legítimo y ya soportado por el watcher.
Dependencias: ninguna dura sobre otros issues de Fase 8.
Referencia: `workflow/context/features/odessay-versions.md`, `workflow/context/features/odessay-margenes.md`, `workflow/context/features/odessay-ai-editor.md`, `workflow/context/features/odessay-sync.md`, `workflow/context/core/odessay-adr-identidad.md`, `workflow/context/features/odessay-desktop-app.md`, `workflow/context/features/odessay-desktop-target-architecture.md`, `.agents/skills/skill-architecture/SKILL.md`.

**Document Versions — AI-powered comparison** `[backend, frontend]`
Comparar dos versiones produce (a) reporte de cobertura por anotación `ai` — ¿se atendió?, ¿cómo?, ¿hubo cambios adicionales no pedidos? — y (b) resumen narrativo de cambios. Evaluación de solo lectura: nunca escribe de vuelta al documento, coherente con el límite del agente residente.
Dependencias: Document Versions — snapshot foundation (desktop).
Referencia: `workflow/context/features/odessay-versions.md`, `workflow/context/features/odessay-ai-writing-assist.md`, `workflow/context/features/odessay-margenes.md`.

### Track de confiabilidad de correcciones y anotaciones — Fase 8 (definido 2026-07-03)

Origen: revisión completa del subsistema en `docs/revision-correcciones-anotaciones-2026-07.md` (21 hallazgos de código C1-C19/A1-A2 + 13 documentales D1-D13). Implementa los criterios del DoD §5 que ODE-338 dejó abiertos. Secuencia: ODE-343 (critical-path, entrega skills/docs) → chain de editor-shell ODE-344 → ODE-345 → ODE-346 → ODE-347 → ODE-348 → ODE-351; en paralelo ODE-349 (backend) y ODE-350 (anotaciones); decisión del dueño en ODE-352.

**Ship planning-skill hardening and corrections documentation reconciliation (ODE-343)** `[infra, critical-path]` — entrega el gate §Revisión por skills de dominio, skill-corrections, red flags de review y la reconciliación documental D2/D6/D9/D10/D11.
**Create shared token-boundary matching module (ODE-344)** `[frontend, ai-editor]` — C1/C13/C15: un solo matching con límites de token para servidor, decoraciones y apply. DoD §5 "no falsos positivos por matching parcial".
**Make correction fingerprints stable across edits (ODE-345)** `[frontend, ai-editor]` — C2: identidad sin hash/pos; los rechazos sobreviven ediciones.
**Route all suggestion entry points through a single admission filter (ODE-346)** `[frontend, ai-editor]` — C3/C6: learned words filtran también en hidratación de cache y retroactivamente. DoD §5 "deja de marcarse en cualquier documento futuro".
**Guarantee exit transitions for stale suggestions (ODE-347)** `[frontend, ai-editor]` — C4/C10: pending-stale expira (10 s); error, cache-hit y ventana de supresión tienen salida.
**Harden learned words (ODE-348)** `[frontend, backend]` — C7/C8: rollback del optimista, retry de carga, paginación completa.
**Parse LLM corrections per item and unify route paths (ODE-349)** `[backend, ai-editor]` — C5/C18/D5: un item malformado no vacía el lote; una sola normalización en la ruta.
**Color annotation highlights by mark type (ODE-350)** `[frontend]` — A1/A2/D3: color por marca (`data-annotation-type`), no por heurística de párrafo; reescribe `odessay-anotaciones-ai.md` al sistema de tipos real.
**Batch correction blocks per request and clean queue lifecycle (ODE-351)** `[frontend, backend, ai-editor]` — C17/C14/C12/D1/D7/D8: batching (Mejora 2, único pendiente del plan de mejoras), limpieza de cola por doc, contador del toast.
**Decide corrections product policies (ODE-352)** `[needs-clarification]` — C11/C16/C19: spellcheck nativo, normalización de acentos, memoria de rechazos a Supabase — decisiones del dueño antes de implementar.

Referencia del track: `docs/revision-correcciones-anotaciones-2026-07.md`, `.agents/skills/skill-corrections/SKILL.md`, `workflow/context/features/odessay-ai-writing-assist.md`.

Referencia general: `workflow/context/core/odessay-adr-identidad.md`, `.agents/skills/skill-architecture/SKILL.md`, `.agents/skills/skill-product-manager/SKILL.md`.

---

## Fase 7.1 — Exploración de Workspace Local / Watched Folders

Al terminar esta fase: Odessay habrá validado si trabajar sobre carpetas locales existentes del usuario debe convertirse en una línea formal del producto, sin mezclar esa exploración con el gate de convergencia web/desktop.

---

**Hito**
Existe evidencia de producto y arquitectura suficiente para decidir si `Workspace` / watched folders entra al roadmap principal como capacidad estable.

**Al cierre de esta fase debe ser verdad que:**

- la exploración corre sobre la base desktop ya convergida, sin reabrir el contrato documental de Fase 7
- Odessay puede inspeccionar carpetas locales elegidas por el usuario y listar documentos compatibles de forma usable
- queda claro cuál sería el contrato correcto para abrir un archivo local existente dentro del editor
- existe una decisión explícita sobre si esta línea se promueve, se recorta o se cancela

**Temas que entran en esta fase**

- exploración acotada de `Workspace` / watched folders sobre filesystem local
- validación de UX de navegación de carpetas y apertura de archivos existentes
- definición de boundaries entre UI, application y adapter desktop para esta línea
- evidencia para decidir si hace falta `.odessay/`, metadata local, watcher en tiempo real o sync posterior

**Temas que no son objetivo de esta fase**

- reabrir el gate de Fase 7
- comprometer la arquitectura completa de metadata, snapshots, sync cloud o indexación permanente sin evidencia
- mezclar esta exploración con una promesa ya cerrada de paridad remota web/desktop

**Issue semilla sugerido**

- `ODE-245` — exploración MVP de Workspace / watched folders, reposicionado como validación post-convergencia y no como trabajo de cierre de Fase 7

Referencia: `workflow/context/core/odessay-watched-folders.md`, `workflow/context/features/odessay-desktop-app.md`, `workflow/context/features/odessay-desktop-target-architecture.md`, `.agents/skills/skill-architecture/SKILL.md`, `.agents/skills/skill-product-manager/SKILL.md`.

---

## Fase 9 — Workspace: Filesystem y Nube

Al terminar esta fase: Odessay desktop deja de tener tres personalidades documentales. Desk, Workspace, Search, Recent y Open Document consultan un solo `DocumentCatalog` respaldado por SQLite y abren mediante un solo `openDocument({ id | path })`. Las diferencias visibles corresponden al estado local/cloud del documento, no a pipelines de persistencia distintos.

DoD formal: `workflow/define/dod-fase-9.md`.

---

**Hito**
Artifact Studio integra filesystem y nube mediante un catálogo, un binding y una apertura documentales únicos, observables y seguros.

**Al cierre de esta fase debe ser verdad que:**

- el `.md` sigue gobernando el contenido materializado y `.odessay/index.json` v2 conserva el binding durable por `BindingRoot`;
- SQLite es el catálogo operacional y la cola durable únicos de desktop; IndexedDB queda limitado al adapter web tras la migración;
- un UUID estable vincula manifest, catálogo, editor y registro cloud sin usar frontmatter ni paths como identidad;
- un reconciliador global mantiene filesystem, manifest y SQLite alineados desde cualquier ruta desktop;
- Desk y Workspace muestran el mismo conjunto base y los mismos estados, variando solo filtro, agrupación y presentación;
- Open Document reconcilia antes de acuñar identidad y ningún fallo de apertura crea drafts;
- `local-only`, `cloud-only`, `synced`, `pending` y `conflict` tienen semántica estable y visible;
- auth controla capacidades cloud, nunca la existencia de archivos locales.

**Temas que entran en esta fase**

- contratos `DocumentCatalog`/`DocumentBindingStore` y schema SQLite v2 con dual-write reversible;
- `BindingRoot managed` y externos, manifest v2 y reconciliador global en `DesktopAppShell`;
- apertura unificada por UUID o ruta para todas las superficies desktop;
- Desk y Workspace como vistas del mismo catálogo;
- migración de todos los scopes, bindings y mutaciones pendientes de IndexedDB desktop;
- materialización cloud-only, paridad/backfill de `content_hash` y retiro de rutas legacy;
- migración auditable de `.odyssey`, frontmatter histórico y path-as-id.

**Temas que no son objetivo de esta fase**

- convertir Workspace web en un explorador de filesystem;
- mover o reubicar archivos del usuario para que encajen en una carpeta interna;
- usar metadata en frontmatter o sidecars por documento;
- implementar merge automático de contenido divergente entre dispositivos;
- convertir SQLite en autoridad del contenido o `.odessay/index.json` en una caché descartable del UUID local-only;
- mantener pipelines de apertura distintos por superficie.

**Secuencia de ejecución**

0. `ODE-366` — reconciliar documentación/código y fijar el mapa de caminos actuales/legacy contra el spec aceptado.
1. **M1 — `ODE-367`:** introducir contratos `DocumentCatalog`/`DocumentBindingStore`, schema SQLite v2 y dual-write detrás de feature flag.
2. **M2 — `ODE-370`:** migrar manifest a v2 y montar el reconciliador global; cubrir rename, move, delete, save atómico y roots no disponibles.
3. **M3 — `ODE-375`:** implementar `openDocument({ id | path })` y migrar Desk, Workspace, sidebar, Search, Recent y Open Document sin seed de IndexedDB.
4. **M4 — `ODE-373`:** hacer que Desk y Workspace consuman el mismo catálogo y presenten estados/errores coherentes.
5. **M5 — `ODE-376`:** cosechar todos los scopes, bindings y mutaciones de IndexedDB desktop; dejar compatibilidad read-only por una versión.
6. **M6 — cierre de reconciliación y compatibilidad:**
   - `ODE-371` — materialización cloud-only, validación/backfill de `content_hash` y convergencia cloud;
   - `ODE-374` — cosecha histórica y retiro de frontmatter/path-as-id/compatibilidades una vez preservados los datos.
7. `ODE-372` — ejecutar el gate final: matriz de evidencia del DoD, E2E en DMG y aceptación explícita del dueño.

`ODE-368` y `ODE-369` son auditorías transversales: alimentan la reconciliación y el plan de retiro, pero no sustituyen ninguna entrega de producto.

Referencia: `workflow/define/dod-fase-9.md`, `workflow/context/features/odessay-desktop-document-catalog.md`, `workflow/context/core/odessay-adr-identidad.md`, `workflow/context/core/odessay-watched-folders.md`, `workflow/context/features/odessay-workspace.md`, `workflow/context/features/odessay-workspace-diagnostic.md`, `workflow/context/features/odessay-desktop-app.md`, `workflow/context/features/odessay-desktop-migration-diagnostic.md`, `workflow/context/features/odessay-desktop-target-architecture.md`, `workflow/context/features/odessay-desktop-migration-plan.md`, `workflow/context/features/odessay-sync.md`, `.agents/skills/skill-architecture/SKILL.md`, `.agents/skills/skill-product-manager/SKILL.md`.

---

## Fase 10 — Artifact Studio: la superficie

Al terminar esta fase: el producto se ve, se nombra y se comporta como Artifact Studio. Dos capas visuales explícitas —producto y marketing— con tokens separados por scope, un shell de dos capas, un inventario cerrado de overlays, una marca regenerada y un solo vocabulario. La arquitectura documental cerrada en Fase 9 no se mueve: esta fase toca presentación.

DoD formal: `workflow/define/dod-fase-10.md`.

---

**Hito**
Artifact Studio tiene una identidad visual única y verificable en todas sus superficies, sin que el rediseño introduzca una sola fuente de datos, store o pipeline documental nuevo.

**Al cierre de esta fase debe ser verdad que:**

- ninguna vista rediseñada descubre documentos fuera del `DocumentCatalog` ni introduce estado durable nuevo;
- las capas de producto y marketing están separadas por `[data-layer="marketing"]` y no se contaminan en ninguna dirección;
- los cinco deltas del paquete de diseño están resueltos en `skill-design`, no solo en el código;
- el shell de dos capas —layer 0 shell, layer 1 hoja— es observable en cada vista, con una sola superficie elevada;
- existen exactamente cinco patrones de overlay y ninguna superficie inventa un sexto;
- Desk, Studio, Workspace, Add workspace, Settings, Auth y los estados vacíos cumplen su spec y su checklist;
- la UI dice **artifact**, en inglés, y la marca es una sola geometría en app icon, favicon y `src-tauri/icons/*`;
- los tipos y estados son vocabulario del usuario, no listas cerradas en el código: se crean, se editan, se ocultan, se propagan sin recargar, sobreviven al reinicio en web y desktop, y ningún componente tiene una versión local del catálogo;
- la landing existe en `app/(marketing)` y argumenta el problema antes que la solución;
- ninguna ruta de app paga por la capa de marketing —ni una fuente, ni un token, ni un píxel.

**Temas que entran en esta fase**

- bajada del paquete de diseño a `docs/design/` y creación de `skill-design-landing`;
- fusión de los deltas de tokens, tipografía y geometría en `skill-design` y `app/globals.css`;
- primitivas compartidas: los cinco overlays y la barra de selección única;
- refresco de marca: geometría del mark, wordmark en Geist, app icon y favicon regenerados;
- rediseño vista por vista: Auth/Splash, Desk, preview de artifact, Workspace índice y detalle, Add workspace, Settings, Studio y los tres estados vacíos;
- barrido de vocabulario a "artifact" en copy;
- Settings › Workflows, precedido de un design pass que responda sus preguntas abiertas;
- conversión de artifact types y writing statuses en vocabularios configurables por el usuario: un modelo de persistencia y un servicio compartidos, un solo catálogo en el cliente, y Settings encendido;
- capa de marketing completa: tokens scoped, primitivas, once secciones, gráficos y cutover de la home.

**Temas que no son objetivo de esta fase**

- cambiar catálogo, binding, apertura, sync o cualquier contrato de Fase 9;
- implementar la regla *Ignore* persistente del flujo add-workspace — se envía solo checkbox + "Only this";
- reescribir `editor-shell.tsx`: Studio se interviene en presentación, en el lugar;
- renombrar archivos y símbolos de "writing" a "artifact" — el copy cambia en esta fase, los nombres en un pase mecánico posterior;
- convertir los prototipos `.dc.html` en código: entran al repo en `docs/design/reference/` como autoridad visual y se leen sus valores, pero no se copian sus nodos.

**Secuencia de ejecución**

1. **M0 — normativa:** bajar el handoff a `docs/design/` y fusionar los deltas en `skill-design` + `app/globals.css`. Sin este bloque, cada vista reinventa el sistema.
2. **M1 — primitivas:** overlays, barra de selección compartida y marca.
3. **M2 — entrada:** splash y pantallas de auth.
4. **M3 — Desk:** header, filtros, filas, grupos, y el overlay de preview con su tarjeta de sharing.
5. **M4 — Workspace:** índice, detalle con columna de árbol y flujo de add-workspace.
6. **M5 — Settings:** cuenta, tipos, estados, archivo y su modal editor.
7. **M6 — Studio:** shell, tabs, paneles, status bar; después barra AI, sugerencias y palabras aprendidas.
8. **M7 — cierre de producto:** estados vacíos, barrido de vocabulario, design pass de Workflows y su implementación.
9. **M8 — marketing:** tokens scoped y grupo de rutas, primitivas, secciones estáticas, gráficos y cutover de la home.
10. **M10 — vocabulario configurable:** esquema y servicio (`ODE-472`), persistencia y reconciliación desktop (`ODE-473`), catálogo único en el cliente (`ODE-474`), Settings encendido (`ODE-475`), consumidores repintados (`ODE-476`) y matriz de evidencia cross-runtime (`ODE-477`). Corre en paralelo a M8; `ODE-474` es `critical-path` de todo lo visible del bloque.
11. **M9 — gate:** matriz de evidencia del DoD y aceptación explícita del dueño.

Fase 10 corre en paralelo al cierre de Fase 9: `ODE-372` sigue siendo el gate DoD de esa fase y no se absorbe aquí.

Referencia: `workflow/define/dod-fase-10.md`, `docs/design/migration-plan.md`, `docs/design/system-app.md`, `docs/design/layout.md`, `docs/design/overlays.md`, `docs/design/icons.md`, `docs/design/brand.md`, `docs/design/views/*.md`, `.agents/skills/skill-design/SKILL.md`, `.agents/skills/skill-design/vistas.md`, `.agents/skills/skill-design/tipografia.md`, `.agents/skills/skill-design-landing/SKILL.md`, `.agents/skills/skill-frontend/SKILL.md`, `.agents/skills/skill-product-manager/SKILL.md`, `workflow/agents.md`.

---

## Fase 11 — Artifact Studio: Agente de Workspace

Al terminar esta fase: Artifact Studio tiene un agente invocado bajo demanda que expone la capa de contexto ya construida en fases anteriores —catálogo, anotaciones, vocabulary configurable, collections, learned words— y que, con autorización explícita del usuario, puede leer, escribir, mover, editar y eliminar documentos del workspace. Vive en el entorno local; esta fase no construye ni depende de una versión web/cloud del agente. Fase 10 no se toca: el vocabulario y el shell visual que esa fase entregó son insumo de esta, no se rediseñan.

DoD formal: `workflow/define/dod-fase-11.md`.

---

**Hito**
El agente resuelve enlaces rotos, sugiere tipo/estatus, señala candidatos a archivar y detecta contradicciones entre documentos citando evidencia real, sin escribir nada sin aprobación explícita por acción, y sin introducir ni una fuente de contexto paralela ni un store durable nuevo.

**Al cierre de esta fase debe ser verdad que:**

- con autorización explícita del usuario, el agente puede leer, escribir, mover, editar y eliminar documentos del workspace, y cada una de esas operaciones requiere aprobación por acción individual, nunca una autorización global de sesión;
- el agente lee anotaciones, vocabulary, collections y learned words tal como existen hoy, sin duplicar ninguno en un almacén paralelo;
- `workflow.md` puede ser redactado por el propio agente a partir del contexto existente del workspace, y una vez que existe se carga como contexto de cualquier otra acción sobre ese workspace;
- cada acción individual (enlaces rotos, tipo/estatus, archivar, contradicciones) cita evidencia real antes de ofrecer una escritura, y ninguna se ejecuta sin que el usuario la vea primero;
- revisar un hallazgo ensancha el panel del agente en el lugar — nunca aparece un modal o sheet que cubra Desk, Studio o Workspace detrás;
- el mismo componente se monta en Studio (`editor-right-panel-tabs.tsx`) y en Workspace (`workspace-detail.tsx`), diferenciado solo por scope;
- arrastrar un archivo o una carpeta hacia el panel del agente lo acumula como contexto adjunto antes de enviar;
- el chat es efímero por sesión — no se introduce tabla ni superficie de sync nueva;
- el wireframe interactivo aprobado el 2026-09-05 es la referencia de interacción de la fase, nunca de visual final: la piel se construye contra `skill-design`, no contra los colores/iconos del wireframe.

**Temas que entran en esta fase**

- capa de herramientas autorizada: leer, escribir, mover, editar y eliminar documentos, con aprobación explícita por acción;
- acción "generar/actualizar `workflow.md`" a partir del contexto existente del workspace;
- acción "enlaces rotos" (determinística, sin llamada a modelo);
- acción "sugerir tipo y estatus" contra el catálogo de vocabulary vigente;
- acción "candidatos a archivar" con razón explícita citada;
- acción "contradicciones y fusión", incluyendo el patrón de cola cuando hay más de un hallazgo;
- montaje dual del panel del agente en Studio y Workspace, con drag-and-drop de archivos y carpetas como contexto adjunto;
- traducción del wireframe interactivo a los tokens, tipografía e iconografía reales de Artifact Studio.

**Temas que no son objetivo de esta fase**

- vocabulario de entidades (extender `LearnedWordEntry` con tipo/definición) — queda nombrado en Horizonte Posterior hasta que este epic esté cerrado;
- writing harness / editorial intelligence layer — sigue diferido en Horizonte Posterior; esta fase es la que lo vuelve viable, no la que lo construye;
- cualquier cambio al catálogo, binding, apertura o sync cerrados en Fase 9;
- cualquier cambio al shell visual, overlays o marca cerrados en Fase 10;
- versión web/cloud del agente;
- acción de "mover/reorganizar carpetas completas" más allá de lo que la capa de herramientas de M0 ya habilita — se nombra como candidata futura, no se compromete en esta fase.

**Secuencia de ejecución**

1. **M0 — capa de herramientas:** leer/escribir/mover/editar/eliminar documentos con aprobación explícita por acción, montada sobre el catálogo y el filesystem local ya existentes. Nada más en esta fase funciona sin esto.
2. **M1 — primera acción end-to-end:** generar/actualizar `workflow.md`, porque ejercita la capa completa (lee contexto real, escribe con aprobación) con el riesgo más bajo.
3. **M2 — enlaces rotos:** determinística, valida el patrón de detección de solo-lectura antes de tocar acciones con juicio.
4. **M3 — sugerir tipo y estatus:** clasificación acotada contra vocabulary.
5. **M4 — candidatos a archivar:** señales del catálogo más juicio, siempre con razón citada.
6. **M5 — contradicciones y fusión:** comparación real de contenido; incluye el patrón de cola para varios hallazgos.
7. **M6 — chrome dual y drag-and-drop:** montaje en Studio y Workspace, arrastrar archivos/carpetas como contexto.
8. **M7 — gate:** traducción visual contra `skill-design`, matriz de evidencia y aceptación explícita del dueño.

Referencia: `workflow/define/dod-fase-11.md`, `workflow/context/features/odessay-desktop-document-catalog.md`, `lib/queries/document-catalog.ts`, `lib/vocabulary/catalog.ts`, `lib/margins/margins.ts`, `lib/collections/collections.ts`, `lib/workspace/types.ts`, `components/editor/panels/editor-right-panel-tabs.tsx`, `components/workspace/workspace-detail.tsx`, `docs/design/system-app.md`, `.agents/skills/skill-design/SKILL.md`, `.agents/skills/skill-product-manager/SKILL.md`, `workflow/agents.md`.

---

## Horizonte Posterior — Iniciativas Diferidas

Estas líneas no desaparecen del producto, pero salen del critical path mientras se construye la plataforma multi-runtime.

- **Writing Harness / Editorial Intelligence Layer** — retomar cuando shared core, adapters y paridad web/desktop estén estables. Su valor depende de operar sobre un contrato documental sólido, no sobre un runtime acoplado.
- **Correspondences** — retomar después de la base multi-runtime; la conversación epistolar debe construirse sobre contratos de documento, sharing y sync ya estabilizados.
- **Invitations, distribution, i18n y SEO** — quedan diferidos hasta que la convivencia web/desktop y el modelo documental estén cerrados.
