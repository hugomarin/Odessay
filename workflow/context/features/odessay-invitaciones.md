# ODESSAY — Invitaciones

**Feature spec para agentes de desarrollo.**
Lee `workflow/context/core/odessay-fundacional.md` para entender la naturaleza epistolar del onboarding y `workflow/context/core/odessay-modelo-datos.md` para el schema de `invitations`.

---

## Por qué las invitaciones son un feature de producto, no solo de growth

La primera experiencia de alguien en Odessay no es registrarse y ver un escritorio vacío. Es leer una carta que alguien escribió para ellos.

Esto es una decisión de producto deliberada: el valor del producto se demuestra antes del registro. El invitado entiende qué es Odessay porque lo experimenta — no porque lo lee en el landing.

La invitación no es un link de referido. Es una carta de llegada.

---

## Flujo completo

### Desde el autor (quien invita)

1. El autor tiene un writing que quiere compartir con alguien que no está en Odessay.
2. Desde el panel de compartir del writing, ingresa el email del invitado.
3. El sistema crea una entrada en `invitations`:
   - `token` — UUID único
   - `writing_id` — el writing que se comparte (puede ser null si la invitación es solo al producto)
   - `invited_email` — email del invitado
   - `invited_by_id` — profile ID del autor
   - `status` — `pending`
   - `expires_at` — 30 días desde la creación
4. Se genera el link: `odessay.com/invite/{token}`.
5. **El canal es libre.** El autor comparte el link por donde prefiera: WhatsApp, email personal, Telegram, iMessage. Resend envía un email transaccional como canal complementario — no como canal único.
6. El autor puede ver el estado de sus invitaciones pendientes y reenviar el link si es necesario.

### Desde el invitado (quien llega)

1. El invitado abre `/invite/{token}`.
2. El sistema verifica el token: si expiró o no existe → mensaje de error con link al landing.
3. Si el token es válido:
   - Se muestra la carta-invitación (el writing asociado, si existe) en la reading view completa.
   - Debajo: "Odessay — un espacio epistolar. [Nombre del autor] te invita." con botón "Join Odessay".
4. Click en "Join Odessay" → `/signup?token={token}`.
5. En `/signup`: el campo email viene prellenado con `invited_email` y deshabilitado. El invitado completa display name, username y password.
6. Al crear la cuenta: `invited_by_id` se asocia al nuevo profile. El `status` de la invitación pasa a `accepted`. El writing aparece en el `/shared` del nuevo usuario.

---

## `/invite/{token}` — Landing de invitación

**Layout:** página de pantalla completa sin sidebar. Fondo `--bg`.

**Si el writing existe:**
- Reading view completa del writing-invitación: autor con avatar, título en Lora 30px, cuerpo en Geist Sans 17px / line-height 1.85.
- Sin herramientas de lectura (highlights, márgenes) — el invitado solo lee.
- Al fondo, separado con espacio generoso: panel de invitación.

**Panel de invitación (siempre visible):**
- Avatar + nombre del autor que invita
- Texto: "[Nombre] te invita a Odessay — un espacio epistolar"
- Botón primario "Join Odessay" → `/signup?token={token}`
- Link secundario "Already have an account? Log in" → `/login?token={token}` (para asociar el writing si el invitado ya tiene cuenta)

**Si el writing no existe** (invitación al producto sin writing asociado):
- Solo el panel de invitación, centrado verticalmente.
- Fragmento del manifiesto de Odessay como contexto (mismo texto que el panel derecho de `/login`).

**Si el token expiró o es inválido:**
- Mensaje amable: "Este link de invitación ya no está disponible."
- Link al landing de Odessay.

---

## Estados de una invitación

| Estado | Descripción | Acción posible |
|--------|-------------|----------------|
| `pending` | Invitación creada, el invitado no se ha registrado | Reenviar link |
| `accepted` | El invitado completó el registro | Solo lectura |
| `expired` | Han pasado 30 días sin registro | Crear nueva invitación |

**Expiración:** el campo `expires_at` se verifica al abrir `/invite/{token}`. Una tarea cron puede limpiar invitaciones expiradas pero no es crítica para el MVP — la verificación en el request es suficiente.

---

## Gestión de invitaciones del autor

El autor puede ver sus invitaciones desde `/settings` (sección futura) o desde el panel de compartir del writing. En MVP:
- Lista de invitaciones pendientes con email y fecha
- Botón "Copy link" para reenviar por cualquier canal
- No hay límite de invitaciones por autor en MVP

---

## Email transaccional (Resend)

Resend envía el email de invitación como canal complementario al link. El email no es el canal principal — el link es el canal principal.

**Template del email:**
- From: `Odessay <invitations@odessay.com>`
- Subject: "[Nombre del autor] te escribió algo en Odessay"
- Body: texto limpio con el título del writing (si existe), el nombre del autor, y el link de invitación. Sin HTML pesado.
- En staging: los emails no llegan a destinatarios reales — usar el sandbox de Resend.

---

## Asociación de invitación a cuenta existente

Si el invitado ya tiene cuenta en Odessay y llega al link de invitación, el flujo es diferente:

1. `/invite/{token}` detecta que el usuario está autenticado.
2. Muestra el writing y el panel: "[Nombre] te compartió este writing."
3. Click en "View in Odessay" → el writing aparece en `/shared` del usuario autenticado.
4. El `status` de la invitación pasa a `accepted`.

---

## Modelo de datos (referencia)

Schema completo en `workflow/context/core/odessay-modelo-datos.md`.

**`invitations`**
- `id`, `token` (UUID único)
- `writing_id` (FK, nullable — puede invitar sin writing asociado)
- `invited_by_id` (FK a profiles)
- `invited_email`
- `status`: `'pending' | 'accepted' | 'expired'`
- `created_at`, `expires_at`

---

## Lo que este doc NO cubre

- Email transaccional setup → `.agents/skills/skill-backend/SKILL.md` §Resend
- Formulario de signup → `workflow/context/core/odessay-paginas.md` §/signup
- Sistema de compartir writings → `workflow/context/core/odessay-paginas.md` §/shared
