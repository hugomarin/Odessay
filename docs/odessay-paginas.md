# ODESSAY — Arquitectura de páginas

**Documento de referencia para agentes de desarrollo.**
Lee `odessay-fundacional.md` para la visión, `odessay-stack.md` para tecnologías, y `odessay-modelo-datos.md` para el schema.

---

## Estructura general

Tres zonas: pública (sin autenticación), espacio del autor (dual: vista propia + vista visitante), y privada (requiere autenticación).

---

## Mecanismo universal de respuesta

Responder a un writing es siempre el mismo mecanismo independientemente de cómo se llegó al texto: se crea un nuevo writing con `parent_id` apuntando al writing original. El camino siempre es `/write?reply_to={id}`.

Formas de llegar a responder:
- Un writing fue compartido contigo (`shared`) → lo lees → respondes.
- Un writing es público → lo encuentras → respondes.
- Estás recorriendo una correspondencia → respondes a cualquier writing del árbol.

El botón de responder aparece en cualquier writing que tengas permiso de responder. El mecanismo es uno solo.

---

## Páginas públicas (sin autenticación)

### `/` — Landing

Manifiesto de Odessay. Explica qué es, para quién, por qué existe. Funciona como filtro: quien lo lee y siente algo, entra. Quien no, sigue de largo. Incluye acceso a login y signup.

### `/about` — Acerca de

Historia, visión, el equipo o la persona detrás de Odessay.

### `/manifesto` — Manifiesto completo

La versión extendida de la declaración fundacional de Odessay. Puede ser la misma que `/` o una pieza separada más profunda.

### `/terms` — Términos y condiciones

### `/privacy` — Aviso de privacidad

### `/invite/{token}` — Invitación epistolar

Página de llegada para invitados. Muestra la carta-invitación si existe. Lleva al signup. La primera experiencia en Odessay es leer lo que alguien te escribió.

### `/login`

Email + contraseña. Limpio.

### `/signup`

Email, contraseña, username, display_name. Si llega desde `/invite/{token}`, el email puede venir prellenado y la invitación se asocia al nuevo perfil.

---

## Espacio del autor (dual)

### `/{username}` — Espacio del autor

Una misma URL con dos visualizaciones según quién mira:

**Vista pública (visitante o no autenticado):** La vitrina del autor. Muestra display_name, bio, writings públicos y collections públicas. No tiene métricas visibles (sin contadores de seguidores, views, etc.).

**Vista propia (el autor autenticado):** El autor ve todo su contenido: público, shared y privado. Funciona como una vista previa de cómo los demás ven su espacio, pero con acceso completo a todo lo que ha escrito. Puede alternar entre "cómo me ven" y "todo mi contenido".

### `/{username}/{slug}` — Writing público

Un writing con `visibility = 'public'`. Lectura limpia: misma tipografía y espacio que el editor. Si el writing pertenece a una correspondencia, se muestra contexto de navegación para recorrer el árbol (writings anteriores y respuestas). Incluye botón de responder (lleva a `/write?reply_to={id}`, requiere autenticación).

---

## Páginas privadas (autenticado)

### `/desk` — Escritorio

El espacio privado del autor. Vista de gestión del trabajo diario. Tres secciones principales:

**Hero (In progress):** Cards horizontales deslizables con los drafts activos. Cada card muestra título, extracto y estado. Acceso rápido a retomar lo que está en curso.

**Filter bar:** All activity / Correspondence / With responses / Received.

**Tabla de actividad:** Writings con actividad epistolar, agrupados por fecha (Today / This week / Earlier). Columnas: Writing | State | With | Date.

Acceso a crear nuevo writing desde el sidebar o desde la topbar. Notificaciones sutiles de nuevas respuestas o cartas recibidas.

### `/write` — Editor (nuevo writing)

Editor TipTap limpio. Pantalla completa. Tipografía bella. Sin distracciones. Auto-save continuo. La AI editor interviene en pausas naturales (si está activa). El writing se crea como `draft` y `private` por default.

### `/write/{id}` — Editor (writing existente)

Mismo editor, cargando un writing existente. Solo accesible por el autor. Funciona igual para drafts y finished (ambos editables).

### `/write?reply_to={id}` — Editor como respuesta

Mismo editor, pero el writing se crea con `parent_id` apuntando al writing referenciado. Se hereda el `correspondence_id` (o se crea la correspondencia si es la primera respuesta). El writing original no se muestra en pantalla — la respuesta es un espacio autónomo. Una referencia sutil indica a qué writing estás respondiendo.

**Feature futura:** Sistema de citas para referenciar fragmentos del writing al que se responde, integrado como extensión de TipTap.

### `/collections` — Collections del usuario

Lista de collections propias. Crear, editar, eliminar. Cada collection muestra sus writings.

### `/collections/{id}` — Collection específica

Los writings agrupados en esta collection. Filtrable por estado y visibilidad.

### `/correspondences` — Correspondencias

Lista de correspondencias donde el usuario participa (como autor del writing raíz o como autor de alguna respuesta en el árbol). Ordenadas por actividad reciente.

### `/correspondences/{id}` — Una correspondencia

Vista del árbol completo de writings. Muestra la narrativa de la correspondencia: qué se escribió primero, qué vino después, quién respondió a quién. Navegación entre los writings del árbol. Aquí se ve el conocimiento horizontal formándose.

### `/shared` — Writings compartidos conmigo

Writings donde otros me incluyeron en `writing_shares`. Puedo leerlos y, si `can_respond = true`, responder.

### `/settings` — Configuración

Perfil (username, display_name, bio), cuenta (email, contraseña), preferencias.

---

## Notas de implementación

**Slug en writings:** Se agrega campo `slug` a la tabla `writings` (text, nullable, unique por autor). Se genera automáticamente del título. Se usa solo en la URL pública `/{username}/{slug}`. Internamente todo opera con `id`.

**Rutas protegidas:** Todas las páginas bajo `/desk`, `/write`, `/collections`, `/correspondences`, `/shared`, `/settings` requieren autenticación. Redirect a `/login` si no hay sesión.

**Mobile:** Las páginas de lectura (`/{username}/{slug}`, `/correspondences/{id}`, `/shared`) funcionan en mobile. Las de escritura (`/write`) redirigen o muestran un mensaje indicando que la escritura es en desktop.

**SEO/OG:** Las páginas públicas (`/`, `/{username}`, `/{username}/{slug}`) tienen metadata para Open Graph. Las cartas públicas generan previews con título, autor y extracto.
