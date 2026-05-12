# ODESSAY — Roadmap

**Documento de referencia para agentes de desarrollo y product management.**
Lee `workflow/context/core/odessay-fundacional.md` para la visión, `.agents/skills/skill-product-manager/SKILL.md` para el proceso de creación y ejecución de issues.

Este documento define el alcance completo del producto: fases, los issues macro que componen cada fase y sus dependencias. Es la fuente de verdad del qué y el cuándo. El cómo vive en los skills.

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
Crear dos proyectos en Supabase. Documentar todas las variables de entorno del proyecto completo de una vez: Supabase (URL, publishable key, service role key), Anthropic API key, Resend API key, dominio Vercel. Configurar variables en el repo y en Vercel para ambos ambientes.
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
Implementar la capa de persistencia local como base de toda la experiencia. En web: IndexedDB. Interfaz unificada `localDB` que abstrae el storage — los componentes no saben con qué hablan. Sync worker en background con cola de mutaciones y reintentos exponenciales. El usuario nunca espera a Supabase — la base local es la fuente de verdad operativa.
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

## Fase 4 — Writing Harness / Editorial Intelligence Layer

Al terminar esta fase: Odessay deja de ser solo un editor con AI y se convierte en una capa de criterio editorial para escritura asistida por AI. El usuario puede pedir un diagnóstico por capas sobre intención, voz, retórica, estructura argumental, lógica informal, capa epistémica, emoción y audiencia antes de aceptar reescrituras. La promesa de fase es: escribir con AI sin perder voz, intención ni criterio.

---

**Document product thesis and MVP scope for Writing Harness** `[product, ai-editor]` `[critical-path]`
Convertir la iniciativa "Odessay - Writing Harness / Editorial Intelligence Layer" en un spec operativo: problema, ICP, casos de uso, criterios de éxito, alcance MVP y no-alcance explícito. La fase no debe construir un detector de AI ni un "humanizer"; debe evaluar si un texto tiene voz, intención, estructura y pensamiento propio.
Dependencias: Working App usable para pruebas con design partners.
Referencia: Linear initiative `Odessay - Writing Harness / Editorial Intelligence Layer`.

**Define editorial layer taxonomy and scoring contract** `[product, ai-editor]` `[critical-path]`
Definir las capas del harness como contrato de producto y datos: intención, voz, retórica, estructura argumentativa, lógica informal, capa epistémica, emoción y audiencia. Cada capa debe tener heurísticas, señales observables, tipos de hallazgo, severidad y formato de salida. El contrato debe priorizar diagnóstico accionable sobre calificación superficial.
Dependencias: Document product thesis and MVP scope for Writing Harness.
Referencia: Linear initiative `Odessay - Writing Harness / Editorial Intelligence Layer`.

**Implement /api/ai/editorial-diagnosis — layered writing analysis** `[backend, ai-editor]` `[critical-path]`
API route server-side que recibe el writing, contexto declarado del autor y configuración de análisis. Invoca el modelo con el harness editorial y devuelve diagnóstico estructurado por capas: intención probable, hallazgos prioritarios, evidencia textual, explicación breve y recomendación accionable. No reescribe por default.
Dependencias: Define editorial layer taxonomy and scoring contract, Implement auto-save, Configure Supabase projects.
Referencia: `.agents/skills/skill-backend/SKILL.md`, `workflow/context/features/odessay-ai-editor.md`.

**Build editorial diagnosis panel in editor** `[frontend, ai-editor]` `[critical-path]`
Panel lateral o surface integrada donde el autor ve el diagnóstico por capas. Debe mostrar un resumen prioritario, navegación por capa y evidencia anclada al texto. La experiencia se siente como tener un editor inteligente al lado, no como un corrector automático ni como una calificación moralizante.
Dependencias: Implement /api/ai/editorial-diagnosis — layered writing analysis.
Referencia: `.agents/skills/skill-design/vistas.md`, `.agents/skills/skill-frontend/SKILL.md`.

**Anchor diagnosis findings to text ranges** `[frontend, ai-editor]`
Renderizar hallazgos del harness como referencias navegables dentro del editor: frase fuerte subdesarrollada, tono genérico, cambio de audiencia, premisa oculta, recurso retórico débil, etc. El anclaje debe ser estable ante ediciones razonables y no interferir con escritura, selección, formato ni undo/redo.
Dependencias: Build editorial diagnosis panel in editor.
Referencia: `workflow/context/features/odessay-editor.md`.

**Implement author intent and audience context controls** `[frontend, backend, ai-editor]`
Permitir que el autor declare tipo de pieza, intención, audiencia, nivel de riesgo, tono deseado y restricciones. El harness debe usar este contexto para evitar feedback genérico. Sin intención explícita, Odessay puede inferirla, pero debe mostrar la inferencia como editable.
Dependencias: Build editorial diagnosis panel in editor.
Referencia: Linear initiative `Odessay - Writing Harness / Editorial Intelligence Layer`.

**Implement selective recommendations and rewrite-after-diagnosis flow** `[frontend, backend, ai-editor]`
Después del diagnóstico, ofrecer recomendaciones concretas y reescrituras opcionales por hallazgo o bloque. La reescritura nunca ocurre antes del diagnóstico ni sin aceptación del autor. Debe preservar intención, voz y criterio, no solo "hacer sonar mejor" el texto.
Dependencias: Anchor diagnosis findings to text ranges, Implement author intent and audience context controls.
Referencia: Linear initiative `Odessay - Writing Harness / Editorial Intelligence Layer`.

**Build public Writing Slop / Voice Analyzer prototype** `[frontend, backend, ai-editor]`
Herramienta pública de adquisición: el usuario pega un texto y recibe un diagnóstico rápido de voz, intención, genericidad, recursos retóricos, ideas fuertes subdesarrolladas y coherencia argumental. No promete detectar si se usó AI. Promesa: no detectamos si usaste AI; mostramos si tu texto tiene voz, intención y criterio.
Dependencias: Implement /api/ai/editorial-diagnosis — layered writing analysis, Build public pages.
Referencia: Linear initiative `Odessay - Writing Harness / Editorial Intelligence Layer`.

**Validate Writing Harness with design partners** `[product, frontend, ai-editor]`
Probar el harness con textos reales de design partners. Validar si el diagnóstico ayuda a decidir qué mejorar, si preserva voz, si evita moralizar el uso de AI y si sus recomendaciones se sienten accionables. Ajustar taxonomía y prompt con evidencia.
Dependencias: Build editorial diagnosis panel in editor, Build public Writing Slop / Voice Analyzer prototype.
Referencia: `.agents/skills/skill-ux-testing/SKILL.md`.

---

## Fase 5 — Corresponder

Al terminar esta fase: dos o más personas pueden sostener una conversación epistolar completa en Odessay. El flujo queda cerrado de punta a punta: iniciar respuesta desde lectura, persistir la relación entre writings, navegar el hilo completo y saber claramente si te toca responder.

---

**Implement reply mechanism — /write?reply_to={id}** `[backend, frontend]` `[critical-path]`
Entrada de respuesta desde reading view y desde /shared. El editor se abre pre-cargado como respuesta al writing origen, con contexto mínimo visible (autor + título + extracto corto) sin romper el foco de escritura. El writing nuevo se crea con `parent_id` y conserva independencia como pieza editorial.
Dependencias: Build reading view, Implement writing_shares.
Referencia: `workflow/context/core/odessay-flujos.md` (sección: Leer y Responder), `workflow/context/core/odessay-paginas.md`.

**Implement correspondence creation and tree structure** `[backend, database]` `[critical-path]`
Crear correspondence automáticamente en la primera respuesta. Asignar `correspondence_id` al writing raíz y a todas las respuestas del árbol. Garantizar orden cronológico estable y relación padre-hijo consistente para reconstrucción de hilo en cliente. Trigger para actualizar `correspondences.updated_at` en cada nueva carta.
Dependencias: Implement reply mechanism.
Referencia: `workflow/context/core/odessay-modelo-datos.md` (sección: correspondences).

**Implement correspondence participation and access rules** `[backend, database]`
Definir quién puede ver y responder cada correspondencia según visibilidad del writing raíz y shares activos. Solo participantes autorizados acceden al hilo completo. Cambios de visibilidad y revocaciones de share no deben romper el historial ya emitido, pero sí bloquear accesos futuros no permitidos.
Dependencias: Implement correspondence creation and tree structure, Implement shared and public visibility.
Referencia: `workflow/context/core/odessay-modelo-datos.md`, `workflow/context/core/odessay-flujos.md` (sección: Leer y Responder).

**Build /correspondences — thread view** `[frontend, backend]`
Vista de correspondencias con dos capas: inbox de hilos donde el usuario participa + detalle navegable del hilo seleccionado. Incluir participants bar (avatares apilados y stats), secuencia de mini-documentos con línea conectora y CTA claro para responder. Estado por hilo: `Your turn` / `Waiting` derivado del último writing del árbol.
Dependencias: Implement correspondence participation and access rules.
Referencia: `workflow/context/features/odessay-correspondencias.md`, `workflow/context/core/odessay-arquitectura.md` (sección: Correspondences), `.agents/skills/skill-design/vistas.md` (sección: Correspondences), `workflow/context/reference/correspondences.html`.

**Validate correspondence flow — end-to-end thread loop** `[frontend, backend]`
Validar de punta a punta: lectura → responder → creación/actualización de correspondence → visualización del hilo → nuevo turno. Cubrir casos 1:1 y 1:N, además de regresiones de permisos (usuario sin acceso, share revocado, writing privado).
Dependencias: Build /correspondences — thread view.
Referencia: `.agents/skills/skill-ux-testing/SKILL.md`, `workflow/context/features/odessay-correspondencias.md`.

---

## Fase 6 — Invitar y distribuir

Al terminar esta fase: el producto puede crecer y distribuirse. Un autor puede traer a alguien nuevo a Odessay, la primera experiencia de esa persona es leer la carta que le escribieron y el contenido público está optimizado para descubrimiento y difusión.

---

**Implement invitations — token generation and sharing link** `[backend, database]`
Crear invitación con token único. Generar link /invite/{token} que el autor comparte por cualquier canal (WhatsApp, email, lo que prefiera). La invitación referencia el writing si existe. Estado: pending, accepted, expired.
Dependencias: Implement correspondence creation and tree structure.
Referencia: `workflow/context/features/odessay-invitaciones.md`, `workflow/context/core/odessay-flujos.md` (sección: Invitar).

**Build /invite/{token} — invitation landing page** `[frontend]`
Página de llegada para invitados sin autenticación. Muestra el writing-invitación si existe. Lleva al signup con email prellenado si viene de un link con email. La primera experiencia en Odessay es leer lo que alguien escribió para ti.
Dependencias: Implement invitations.

**Extend transactional email templates for invitations** `[frontend, backend, infra]`
Añadir variante de email de invitación epistolar usando el canal de emails no-auth de Odessay. El canal por link sigue siendo principal; email funciona como canal complementario. No usar Supabase Auth templates para invitaciones de producto.
Dependencias: Build /invite/{token}, Configure Supabase Auth custom SMTP on auth.odessay.com si el proveedor de envío no-auth comparte cuenta/proveedor.

**Implement i18n — English and Spanish** `[frontend, infra]`
next-intl configurado. Inglés como idioma default. Español como segundo idioma prioritario. Todas las cadenas de UI traducidas en ambos idiomas. URLs en inglés.
Dependencias: Build public pages.

**Implement SEO and Open Graph** `[frontend, backend]`
Metadata para landing, /{username}, /{username}/{slug}. Open Graph con título, autor y extracto para writings públicos. Preview coherente en redes y mensajería.
Dependencias: Build public author space, Build public pages.

**Seed data — staging completo** `[infra, database]`
Seed data completo para staging: correspondencias con múltiples participantes y árbol de respuestas, collections con writings clasificados y sin clasificar, márgenes de ejemplo, invitaciones en diferentes estados. Sin esto, los agentes no pueden testear flujos complejos de forma autónoma.
Dependencias: Implement collections, Implement margins, Build /correspondences — thread view, Implement invitations.

---

## Fase 7 — Desktop

Al terminar esta fase: Odessay existe como aplicación nativa de escritorio en macOS. La arquitectura local-first (SQLite nativo, sync en background) es el fundamento — sin ella, no hay desktop app.

---

**Package as desktop app (Tauri) — macOS** `[infra, desktop]`
Empaquetar la webapp como aplicación nativa usando Tauri. SQLite nativo reemplaza IndexedDB como storage local. La webapp ya está diseñada para esto: lógica de negocio separada de presentación, interfaz `localDB` abstraída desde la Fase 0. Binarios para macOS como primera plataforma. Windows y Linux como expansión posterior.
Dependencias: Implement local-first storage layer (Fase 0), todas las fases anteriores.
Referencia: `workflow/context/core/odessay-stack.md` (sección: Desktop).
