# Odessay Auth Email

Ultima actualizacion: Mayo 2026.

Este documento define la feature de emails de autenticacion de Odessay y su frontera con Supabase Auth, Resend y Namecheap.

---

## Decision

Todo lo relacionado con autenticacion vive en Supabase Auth:

- Signup confirmation.
- Password recovery.
- Secure email change.
- Magic link, si se habilita.
- Reauthentication, si se habilita.
- Tokens, expiracion, validacion y sesiones de recuperacion.

Odessay no genera tokens propios de recuperacion, no guarda reset tokens en tablas propias y no envia emails de autenticacion directamente desde la app.

Resend solo actua como proveedor SMTP conectado a Supabase Auth. Namecheap solo aloja los DNS del subdominio.

---

## Dominio

El subdominio dedicado para emails de autenticacion es:

```text
auth.odessay.com
```

El remitente canonico es:

```text
Odessay <no-reply@auth.odessay.com>
```

No usar `@odessay.com` para emails automaticos de autenticacion. El dominio raiz queda reservado para correo humano/institucional. Si mas adelante existen emails de producto no-auth, pueden usar otro subdominio, por ejemplo `mail.odessay.com`.

---

## Responsabilidades

| Capa | Responsabilidad |
|---|---|
| Odessay app | UI, llamadas al SDK de Supabase Auth, redirect handling, copy de estados y validacion de formularios |
| Supabase Auth | Tokens, links, expiracion, sesiones, templates de auth y envio del email |
| Resend | SMTP delivery provider usado por Supabase Auth |
| Namecheap | DNS de `auth.odessay.com` |

---

## Configuracion requerida

### Resend

1. Agregar dominio `auth.odessay.com`.
2. Copiar los registros DNS que Resend entregue.
3. Esperar verificacion del dominio.
4. Obtener credenciales SMTP para Supabase Auth.

### Namecheap

Agregar los registros DNS requeridos por Resend para `auth.odessay.com`, normalmente:

- DKIM.
- SPF.
- Return-path / bounce handling, si Resend lo entrega.
- DMARC recomendado.

No se necesita publicar un sitio en `auth.odessay.com`; basta con los registros DNS de email.

### Supabase

En Supabase Dashboard:

1. Authentication -> Emails -> SMTP Settings.
2. Activar custom SMTP.
3. Configurar SMTP con credenciales de Resend.
4. Configurar From address:

```text
Odessay <no-reply@auth.odessay.com>
```

5. Authentication -> URL Configuration.
6. Configurar Site URL de produccion.
7. Agregar Redirect URLs para produccion, staging, localhost y previews aprobadas.

---

## Flujos

### Recuperacion de contrasena

1. El usuario solicita recuperacion en `/forgot-password`.
2. Odessay llama `supabase.auth.resetPasswordForEmail(email, { redirectTo })`.
3. Supabase Auth genera el link de recuperacion.
4. Supabase Auth envia el email via Resend SMTP.
5. El usuario abre `/auth/reset-password`.
6. Supabase establece la sesion de recuperacion.
7. Odessay llama `supabase.auth.updateUser({ password })`.
8. El usuario vuelve a `/desk`.

Regla: no crear tokens propios ni endpoints propios de validacion de reset.

### Cambio de email

1. El usuario solicita cambiar email desde Settings.
2. Odessay usa el flujo nativo de Supabase Auth.
3. Secure email change permanece habilitado.
4. Supabase Auth envia confirmaciones al email viejo y al nuevo mediante `auth.odessay.com`.

Regla: Odessay no debe generar links con Supabase Admin para enviarlos directamente por Resend salvo que una decision futura apruebe Supabase Auth Hooks.

---

## Templates

Los templates de auth se configuran en Supabase Dashboard, no como React Email dentro del repo.

Templates requeridos:

- Confirm signup.
- Reset password.
- Change email address.
- Reauthentication, si se habilita.

Reglas de copy:

- Un solo CTA.
- Sin marketing.
- Sin promesas de producto.
- Sin links extra que compitan con la accion de seguridad.
- Tono claro, sobrio y directo.

Si mas adelante se necesita renderizar templates de auth desde codigo, abrir un issue especifico para Supabase Send Email Auth Hook.

---

## Variables de entorno

Las credenciales SMTP de Resend para auth se configuran en Supabase Dashboard, no en la app.

`RESEND_API_KEY` solo aplica si Odessay envia emails no-auth desde codigo, por ejemplo invitaciones o notificaciones de producto. No debe ser requerida para signup, recuperacion de contrasena o cambio de email.

---

## Validacion

Antes de cerrar el setup:

1. `auth.odessay.com` verificado en Resend.
2. Custom SMTP activo en Supabase Auth.
3. Email de recuperacion recibido desde `no-reply@auth.odessay.com`.
4. Link de recuperacion vuelve a Odessay.
5. Password reset completa y entra a `/desk`.
6. Secure email change envia emails desde `auth.odessay.com`.
7. Staging no envia accidentalmente emails reales sin control.
