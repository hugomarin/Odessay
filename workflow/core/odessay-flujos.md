# ODESSAY — Flujos de usuario

**Documento de referencia para agentes de desarrollo.**
Lee `workflow/core/odessay-fundacional.md` para la visión, `workflow/core/odessay-stack.md` para tecnologías, `workflow/core/odessay-modelo-datos.md` para el schema, y `workflow/core/odessay-paginas.md` para la arquitectura de páginas.

El mecanismo universal de respuesta (reply_to, parent_id) está documentado en `workflow/core/odessay-paginas.md` §Mecanismo universal de respuesta.

---

## 1. Registrarse

### Directo
1. Usuario llega a `/` o `/signup`.
2. Ingresa email, contraseña, username, display_name.
3. Supabase Auth crea cuenta → trigger crea profile.
4. Llega a `/desk` — escritorio vacío, listo para escribir.

**Feature futura:** Onboarding breve post-registro para conocer intereses del usuario.

### Por invitación
1. Alguien compartió un link de invitación `/invite/{token}` (por WhatsApp, email, cualquier canal).
2. El invitado abre el link. Ve la carta-invitación si existe.
3. Se registra (email prellenado si vino por email de Resend).
4. Supabase Auth crea cuenta → trigger crea profile → `invited_by_id` se llena → invitación pasa a `accepted`.
5. Llega a `/desk` con la carta visible en su espacio. Puede responder.

---

## 2. Escribir

1. Desde `/desk`, clic en nuevo writing → llega a `/write`.
2. Editor TipTap limpio. Título opcional. Empieza a escribir.
3. Auto-save local-first: cada cambio se persiste inmediatamente en la base local (SQLite/IndexedDB). El sync a Supabase ocurre en background con debounce de 1.5s. Writing se crea como `draft` + `private`.
4. Escribe por párrafos. En pausas naturales (fin de párrafo + ~8-15 seg), la AI editor puede intervenir con una observación al margen.
5. El autor puede descartar la observación o atenderla. Sigue escribiendo.
6. Cuando quiere, cambia el estado a `finished` y/o ajusta la visibilidad.
7. Desde el editor, puede asignar el writing a una o más collections.

No hay momento de "publicación" dramático. El writing existe desde el primer auto-save. El autor decide cuándo está listo y quién lo ve como acciones separadas, en el momento que quiera.

---

## 3. Publicar / Compartir

Desde el editor o desde `/desk`, el autor cambia la visibilidad de un writing. La visibilidad se puede cambiar en cualquier dirección, en cualquier momento, independiente del estado (draft o finished).

### Compartir con personas
1. El autor selecciona "compartir" en un writing.
2. Busca usuarios por username o ingresa email.
3. Se crean entradas en `writing_shares`. Define si pueden responder (`can_respond`).
4. El destinatario recibe notificación por email (Resend) de que alguien compartió un writing.
5. El writing aparece en `/shared` del destinatario.

### Hacer público
1. El autor cambia visibilidad a `public`.
2. El writing se vuelve accesible en `/{username}/{slug}`.
3. Cualquiera con el link puede leerlo y, si está autenticado, responder.

### Volver privado
1. El autor cambia visibilidad en cualquier momento.
2. La URL pública deja de funcionar. Los shares se pueden revocar.

---

## 4. Leer y Responder

### Leer
1. Un writing llega al lector por: notificación de email, link compartido por cualquier canal, o navegando el espacio público de un autor.
2. El lector abre el writing en su **espacio de lectura** — una vista dedicada, no el editor. Misma calidad visual (tipografía, limpieza) pero solo lectura. Sin cursor, sin toolbar, sin posibilidad de editar. Es recibir el texto, no intervenirlo.

**Feature futura:** Comentarios colaborativos sobre el texto (anotaciones al margen, no edición).

### Responder
1. En cualquier writing que pueda responder, hay un botón de responder.
2. Clic → `/write?reply_to={id}`.
3. Se abre el editor limpio, espacio autónomo. Referencia sutil al writing que se responde.
4. Escribe su respuesta como cualquier otro writing (auto-save, AI editor, etc.).
5. Al compartir o publicar la respuesta, se crea la correspondencia si no existía, o se une a la existente.

### Navegar una correspondencia
1. Desde `/correspondences/{id}` se ve el árbol completo.
2. Se puede leer cada writing en secuencia.
3. Se puede responder a cualquier nodo del árbol.

---

## 5. Organizar

1. Desde `/desk`, `/collections`, o desde el editor de un writing, el autor crea y gestiona collections.
2. Asigna writings a collections de dos formas:
   - Desde la collection: selecciona writings para agregar.
   - Desde el writing (editor o vista): indica a qué collections pertenece.
3. Un writing puede estar en múltiples collections.
4. Las collections organizan la vista privada en `/desk`.
5. El autor puede hacer una collection `public` — aparece en `/{username}` como agrupación visible para visitantes.
6. Puede filtrar writings por estado (draft/finished) y visibilidad (private/shared/public).

---

## 6. Invitar

1. El autor quiere compartir un writing con alguien que no está en Odessay.
2. Desde el writing, ingresa el email del invitado.
3. Se crea una entrada en `invitations` con token único y referencia al writing.
4. **Se genera un link `/invite/{token}`** que el autor puede compartir por cualquier canal: WhatsApp, email personal, Telegram, lo que prefiera. El link es lo importante, no el canal.
5. Opcionalmente, Resend envía un email con el link como complemento.
6. El invitado abre el link, lee la carta-invitación, se registra.
7. `invited_by_id` se llena. Invitación pasa a `accepted`. El writing aparece en su espacio.
8. Si no se registra, la invitación queda `pending`. Se puede reenviar el link.

---

## 7. Navegar el editor

### Abrir un writing existente
1. Desde el sidebar (Recent writings) o desde la lista de una colección, el usuario hace click en un writing.
2. El editor carga con el contenido existente. El título aparece en el área de escritura y sincronizado en la topbar.
3. El auto-save está activo desde el primer cambio.

### Navegación por el sidebar
El sidebar tiene dos estados. La transición entre estados es suave y coordinada (300ms).

**Expandido (292px total = 52px rail + 240px contenido):**
El usuario ve: logo, New writing, Search, Desk, Collections (expandible), Correspondences (expandible), Shared, Recent writings, avatar abajo.

**Colapsado a solo iconos (52px):**
Se activa al hacer click en el toggle del sidebar o al abrir una colección. Los iconos permanecen en la misma posición X — solo el texto desaparece. Tooltips al hover.

**Abrir una colección:**
1. En el sidebar expandido, el usuario expande Collections con el chevron.
2. Hace click en una colección (ej. "Reflections").
3. El sidebar colapsa a 52px (300ms).
4. Simultáneamente se abre el list panel de 240px (320ms).
5. El ancho total es siempre 292px — el editor no se mueve.
6. El list panel muestra los writings de esa colección con título, fecha, badge de estado y extracto.
7. Hacer click en un writing lo abre en el editor.
8. La X en el header del list panel (o click en el icono activo del sidebar) cierra la lista y expande el sidebar de vuelta.

### Editar el título del writing
1. El título vive en el área de escritura como `<textarea>` con auto-resize.
2. También aparece truncado en la topbar como botón clickeable.
3. Click en el título de la topbar → dropdown con campo de texto editable.
4. Enter o click fuera confirma. Escape cancela.
5. El título en el área de escritura y en la topbar están sincronizados.

### Focus mode
1. `⌘⇧F` (o el icono en la topbar) activa focus mode.
2. Sidebar, topbar, status bar y properties panel desaparecen (opacity 0, 350ms).
3. Solo el texto en pantalla.
4. `Escape` para salir del focus mode.

---

## 8. Formato de texto en el editor

El formato se aplica siempre sobre texto seleccionado o en la posición del cursor.

### Via shortcuts (mecanismo primario)
Ver tabla completa en `odessay-editor.md`. Los principales: `⌘B` negrita, `⌘I` cursiva, `⌘K` enlace.

### Via topbar
La topbar fija muestra: selector de estilo (Normal/H1/H2/H3/Quote), B, I, separador, blockquote, lista sin orden, lista numerada, separador, enlace, footnote.

### Via modales
Tres acciones abren modal: enlace (`⌘K`), blockquote (botón o `⌘⇧B`), footnote (botón). Los modales tienen overlay crema con blur. La selección se preserva y se restaura al confirmar. Ver detalles en `odessay-editor.md`.

### Via markdown shortcuts
TipTap reconoce `# `, `## `, `### `, `> `, `- `, `1. ` al inicio de línea. Ver tabla completa en `odessay-editor.md`.

### Notas al pie
Al insertar un footnote se crea automáticamente una sección al final del documento separada por una línea horizontal corta (60px). Los números son secuenciales. El superíndice `[n]` en el cuerpo corresponde a la entrada `[n]` en la sección de notas.

---

## 9. Leer una correspondencia

La vista de una correspondencia es principalmente una **interfaz de lectura**, no de escritura. El autor recibe cada writing del hilo con la misma dignidad que cualquier carta: pantalla completa, tipografía protagonista, herramientas de highlight y márgenes disponibles antes de responder.

La correspondencia se navega como secuencia de mini-documentos conectados por una línea vertical. Cada writing se abre en una reading view completa. El turno activo ("Your turn" / "Waiting") orienta al autor sobre quién escribe ahora.

**Spec completa:** `workflow/features/odessay-correspondencias.md`

---

## 10. Collections — organizar, no leer

Collections es una interfaz de **organización y gestión**, no de lectura. El autor llega aquí para clasificar su archivo, no para leer sus writings.

El flujo central: un banner permanente señala los writings sin clasificar. El AI sugiere agrupaciones (no las aplica). El autor acepta sugerencias por item o hace bulk assign con checkbox. Las colecciones existentes son expandibles en la misma vista — sin navegación a otra página.

**Spec completa:** `workflow/features/odessay-collections.md`


---

## 11. Leer con márgenes

Los márgenes son el espacio de escritura que emerge mientras se lee. No son comentarios ni feedback — son escritura en gestación. El lector selecciona pasajes, los marca o los anota en un panel lateral. Por defecto son privados; el lector puede elegir compartirlos con el autor como texto paralelo.

Cuando va a responder, sus márgenes están disponibles en el editor como materia prima: el lector decide qué incorporar y cómo.

**Spec completa:** `workflow/features/odessay-margenes.md`