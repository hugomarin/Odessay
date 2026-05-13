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

La configuracion de entrega vive fuera del runtime de Next.js. Ningun secreto SMTP de auth debe estar en `.env.local`; Supabase guarda esas credenciales en su Dashboard.

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

URLs esperadas:

- Site URL: URL canonica de produccion de Odessay.
- Redirect URLs exactas para produccion y staging.
- `http://localhost:3000/**` para desarrollo local.
- Preview URLs aprobadas usando wildcard solo en previews, no como sustituto del path exacto de produccion.

---

## Flujos

### Recuperacion de contrasena

1. El usuario solicita recuperacion en `/forgot-password`.
2. Odessay llama `supabase.auth.resetPasswordForEmail(email, { redirectTo })`.
3. Supabase Auth genera el link de recuperacion.
4. Supabase Auth envia el email via Resend SMTP.
5. El usuario abre el link del email.
6. El link apunta al route handler `GET /auth/confirm` de Odessay con `token_hash` y `type=recovery`.
7. El servidor valida el token con `supabase.auth.verifyOtp({ type: 'recovery', token_hash })`.
8. Supabase establece la sesion de recuperacion en cookies.
9. El servidor redirige a `/reset-password`.
10. Odessay llama `supabase.auth.updateUser({ password })`.
11. El usuario vuelve a `/desk`.

Regla: no crear tokens propios ni endpoints propios de validacion de reset.

### Cambio de email

1. El usuario solicita cambiar email desde Settings.
2. Odessay llama `supabase.auth.updateUser({ email }, { emailRedirectTo })`.
3. Secure email change permanece habilitado.
4. Supabase Auth envia confirmaciones al email viejo y al nuevo mediante `auth.odessay.com`.
5. El link del email apunta a `GET /auth/confirm` con `token_hash` y `type=email_change`.
6. El servidor valida el token y establece sesion en cookies.
7. El servidor redirige a `/settings/account`.

Regla: Odessay no debe generar links con Supabase Admin ni enviar emails de cambio de email directamente por Resend salvo que una decision futura apruebe Supabase Auth Hooks.

---

## Templates

Los templates de auth se configuran en Supabase Dashboard, no como React Email dentro del repo.

Ubicacion de configuracion en Dashboard:
- **Authentication -> Emails -> Templates**

### Variables comunes

| Variable | Descripcion |
|---|---|
| `{{ .SiteURL }}` | Site URL configurada en Authentication -> URL Configuration |
| `{{ .Email }}` | Email del usuario |
| `{{ .TokenHash }}` | Hash del token para verificacion server-side |
| `{{ .Token }}` | Token OTP de 6 digitos (si esta habilitado) |
| `{{ .Type }}` | Tipo de accion: recovery, email_change, signup, invite, magiclink |
| `{{ .Data }}` | Datos adicionales si se pasan |

### Patron de links: token-hash server-side

Odessay usa el patron **token-hash verification server-side** recomendado por Supabase para Next.js App Router. Los links del email **no** apuntan directamente a Supabase (`{{ .ConfirmationURL }}`). Apuntan al route handler `GET /auth/confirm` de Odessay, que valida el token server-side con `verifyOtp` y establece la sesion en cookies.

**Ventajas:**
- No depende del `code_verifier` en cookies del browser (funciona cross-browser/cross-device).
- Sobrevive limpieza de cookies y modo incognito.
- Es el patron canonico de Supabase para SSR frameworks.

**URL del link en cada template:**

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=<destino>
```

Donde `<destino>` depende del template:
- Reset password → `/reset-password`
- Change email address → `/settings/account`
- Confirm signup → `/desk`
- Magic link → `/desk`

### Confirm signup

**Subject:** `Confirm your Odessay account`

**Template (HTML):**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm your Odessay account</title>
</head>
<body style="margin:0;padding:0;background-color:#faf9f7;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:8px;">
          <tr>
            <td style="padding:40px 32px 24px;">
              <p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#1a1a1a;">Welcome to Odessay</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4a4a;">Click the button below to confirm your email and start writing.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#8c5e3c;border-radius:6px;text-align:center;">
                    <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/desk" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;border-radius:6px;">Confirm email address</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#8a8a8a;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:24px 0 0;padding-top:24px;border-top:1px solid #eae8e4;font-size:12px;line-height:1.5;color:#9a9a9a;">Odessay — <a href="https://odessay.com" style="color:#8c5e3c;text-decoration:none;">odessay.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Key rules:**
- Single CTA: "Confirm email address".
- No marketing copy, no feature list, no social links.
- Uses `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/desk` — never `{{ .ConfirmationURL }}`.
- Plain-text fallback is auto-generated by Supabase.

### Reset password

**Subject:** `Reset your Odessay password`

**Template (HTML):**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your Odessay password</title>
</head>
<body style="margin:0;padding:0;background-color:#faf9f7;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:8px;">
          <tr>
            <td style="padding:40px 32px 24px;">
              <p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#1a1a1a;">Reset your password</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4a4a;">We received a request to reset the password for your Odessay account ({{ .Email }}). Click the button below to choose a new password.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#8c5e3c;border-radius:6px;text-align:center;">
                    <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/reset-password" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;border-radius:6px;">Reset password</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#8a8a8a;">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:24px 0 0;padding-top:24px;border-top:1px solid #eae8e4;font-size:12px;line-height:1.5;color:#9a9a9a;">Odessay — <a href="https://odessay.com" style="color:#8c5e3c;text-decoration:none;">odessay.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Key rules:**
- Single CTA: "Reset password".
- Shows `{{ .Email }}` so the user knows which account is affected.
- Uses `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/reset-password`.
- No login link, no upsell, no "Need help?" section with multiple links.

### Change email address

**Subject:** `Confirm your new email address for Odessay`

**Template (HTML):**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm your new email address for Odessay</title>
</head>
<body style="margin:0;padding:0;background-color:#faf9f7;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:8px;">
          <tr>
            <td style="padding:40px 32px 24px;">
              <p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#1a1a1a;">Confirm your new email</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4a4a;">You requested to change the email address for your Odessay account. Click the button below to confirm this change.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#8c5e3c;border-radius:6px;text-align:center;">
                    <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/settings/account" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;border-radius:6px;">Confirm new email</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#8a8a8a;">This link expires in 24 hours. If you didn't request this change, you can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:24px 0 0;padding-top:24px;border-top:1px solid #eae8e4;font-size:12px;line-height:1.5;color:#9a9a9a;">Odessay — <a href="https://odessay.com" style="color:#8c5e3c;text-decoration:none;">odessay.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Key rules:**
- Single CTA: "Confirm new email".
- Supabase sends two emails when secure email change is enabled: one to the old address (notification) and one to the new address (confirmation). This template applies to the confirmation email sent to the new address.
- Uses `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/settings/account`.

### Reauthentication (opcional)

**Subject:** `Verify your identity on Odessay`

**Template (HTML):**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your identity on Odessay</title>
</head>
<body style="margin:0;padding:0;background-color:#faf9f7;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:8px;">
          <tr>
            <td style="padding:40px 32px 24px;">
              <p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#1a1a1a;">Verify your identity</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4a4a;">For security, we need to verify it's you. Click the button below to continue.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#8c5e3c;border-radius:6px;text-align:center;">
                    <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/desk" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;border-radius:6px;">Verify identity</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#8a8a8a;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:24px 0 0;padding-top:24px;border-top:1px solid #eae8e4;font-size:12px;line-height:1.5;color:#9a9a9a;">Odessay — <a href="https://odessay.com" style="color:#8c5e3c;text-decoration:none;">odessay.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Key rules:**
- Single CTA: "Verify identity".
- Only relevant if reauthentication (Nonce / MFA step-up) is enabled in Supabase Auth settings.
- Uses `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/desk`.

---

## Route handler: `GET /auth/confirm`

El route handler `app/(auth)/auth/confirm/route.ts` es el punto de entrada para todos los links de autenticacion. Valida el token server-side con `verifyOtp` y establece la sesion en cookies antes de redirigir al destino final.

**Parametros de query:**
- `token_hash` (requerido): Hash del token enviado por Supabase.
- `type` (requerido): Tipo de accion — `recovery`, `email_change`, `signup`, `invite`, `magiclink`.
- `next` (opcional): Ruta de destino despues de la verificacion. Default: `/`.

**Flujo:**
1. Lee `token_hash`, `type`, y `next` de los query params.
2. Crea `createServerClient` con acceso a cookies.
3. Llama `supabase.auth.verifyOtp({ type, token_hash })`.
4. Si es exitoso: redirige a `next`.
5. Si falla: redirige a `/login?error=<mensaje>`.

**Por que no usar `{{ .ConfirmationURL }}`:**
- `ConfirmationURL` apunta directamente a Supabase y requiere PKCE `code_verifier` en cookies del mismo browser.
- Eso falla cuando el usuario abre el email en otro browser/device, o cuando las cookies se limpian.
- El patron `token_hash` + `verifyOtp` server-side elimina esa dependencia.

---

## Reglas de copy universales para templates de auth

1. **Un solo CTA por email.** Nunca mas de un boton de accion.
2. **Sin marketing.** No mencionar features, product roadmap, o promesas de valor.
3. **Sin links extra.** Solo el CTA principal y el footer legal con link al dominio raiz.
4. **Tono claro, sobrio y directo.** Frases cortas. No usar exclamaciones excesivas.
5. **Identidad consistente.** Siempre firmar como "Odessay" con link a `https://odessay.com`.
6. **URLs dinamicas.** Usar `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=...`. Nunca hardcodear URLs de Supabase.
7. **Tiempo de expiracion explicito.** Mencionar cuanto dura el link (24h para signup/email-change, 1h para password reset/reauthentication).
8. **Instruccion de ignore seguro.** Siempre incluir "If you didn't request this, you can safely ignore this email."

---

## Variables de entorno

Las credenciales SMTP de Resend para auth se configuran en Supabase Dashboard, no en la app.

`RESEND_API_KEY` solo aplica si Odessay envia emails no-auth desde codigo, por ejemplo invitaciones o notificaciones de producto. No debe ser requerida para signup, recuperacion de contrasena o cambio de email.

`RESEND_FROM_EMAIL` sigue la misma regla: solo aplica a email de producto no-auth. El remitente de auth se controla desde Supabase Auth SMTP Settings.

El check de entorno del repo no debe bloquear desarrollo local por falta de `RESEND_API_KEY`, porque la entrega auth depende del Dashboard de Supabase.

---

## Validacion

Antes de cerrar el setup:

1. `auth.odessay.com` verificado en Resend.
2. Custom SMTP activo en Supabase Auth.
3. Email de recuperacion recibido desde `no-reply@auth.odessay.com`.
4. Link de recuperacion apunta a `{{ .SiteURL }}/auth/confirm?token_hash=...&type=recovery&next=/reset-password`.
5. Route handler `GET /auth/confirm` valida el token y redirige a `/reset-password`.
6. Password reset completa y entra a `/desk`.
7. Secure email change envia emails desde `auth.odessay.com`.
8. Staging no envia accidentalmente emails reales sin control.
9. No hay llamadas app-side a Resend para confirmacion, recuperacion o cambio de email.
10. Subject lines coinciden con los definidos en este documento.
