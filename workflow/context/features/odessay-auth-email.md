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

## Tokens HSL → HEX (para usar en emails)

```
--ink    hsl(25,18%,10%)  →  #1C1612
--ink-2  hsl(25,12%,22%)  →  #3D3530
--ink-3  hsl(25,10%,38%)  →  #695E59
--ink-4  hsl(25, 8%,52%)  →  #8C837E
--bg     hsl(38,12%,98%)  →  #FAF9F7
--border hsl(38, 8%,90%)  →  #E8E7E4
--cursor hsl(22,55%,38%)  →  #943D1F
```

**No usar:** dark mode media queries, gradientes, imagenes de fondo, tablas anidadas complejas, fuentes externas (@font-face / Google Fonts) — mala compatibilidad con Outlook.

---

## Templates

Los templates de auth se configuran en Supabase Dashboard, no como React Email dentro del repo.

Ubicacion de configuracion en Dashboard:
- **Authentication -> Emails -> Templates**

### Variables comunes

| Variable | Descripcion |
|---|---|
| `{{ .SiteURL }}` | Site URL configurada en Authentication -> URL Configuration |
| `{{ .RedirectTo }}` | URL pasada como `redirectTo` / `emailRedirectTo` desde la app (incluye el origin correcto: local o produccion) |
| `{{ .Email }}` | Email del usuario |
| `{{ .TokenHash }}` | Hash del token para verificacion server-side |
| `{{ .Token }}` | Token OTP de 6 digitos (si esta habilitado) |
| `{{ .Data }}` | Datos adicionales si se pasan |

> **Nota:** `{{ .Type }}` **no es** una variable de template de Supabase. El `type` debe hardcodearse por template segun la accion.

### Patron de links: token-hash server-side

Odessay usa el patron **token-hash verification server-side** recomendado por Supabase para Next.js App Router. Los links del email **no** apuntan directamente a Supabase (`{{ .ConfirmationURL }}`). Apuntan al route handler `GET /auth/confirm` de Odessay, que valida el token server-side con `verifyOtp` y establece la sesion en cookies.

**Ventajas:**
- No depende del `code_verifier` en cookies del browser (funciona cross-browser/cross-device).
- Sobrevive limpieza de cookies y modo incognito.
- Es el patron canonico de Supabase para SSR frameworks.

**URL del link en cada template:**

```
{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=<type>
```

Importante: `{{ .RedirectTo }}` usa el `redirectTo` que la app envia al SDK de Supabase, que incluye el `origin` correcto (local o produccion). `{{ .Type }}` **no es** una variable de template de Supabase. El `type` debe hardcodearse por template segun la accion. Tabla de mapeo:

| Template Dashboard | `type` literal | `next` en el `redirectTo` de la app |
|---|---|---|
| Confirm signup | `signup` | `/auth/confirm?next=/desk` |
| Reset password | `recovery` | `/auth/confirm?next=/reset-password` |
| Change email address | `email_change` | `/auth/confirm?next=/settings/account` |
| Magic link | `magiclink` | `/auth/confirm?next=/desk` |
| Invite user | `invite` | `/auth/confirm?next=/desk` |

El template de Reauthentication no usa `/auth/confirm` — ver seccion dedicada mas abajo.

---

### Estructura visual canonica (aplica a todos los templates con CTA)

Referencia visual: emails de Claude (Anthropic). Diseno minimalista centrado, sin imagenes decorativas, un solo CTA negro.

```
Container:     max-width 560px, margin auto, fondo blanco (#FFFFFF)
Padding outer: 40px arriba/abajo, 0 lateral (el cliente de email lo maneja)
Padding inner: 0 40px en el contenido
```

**1. Header**
   wordmark:    "Odessay" — Lora, 20px, font-weight 500, color #1C1612
               centrado, padding-top 40px, padding-bottom 32px
   separator:  border-bottom 1px solid #E8E7E4

**2. Body**
   padding:    32px 40px
   text-align: center

   titulo:     Lora, 22px, font-weight 500, color #1C1612
               line-height 1.4, margin-bottom 16px

   cuerpo:     font-family: Georgia, 'Times New Roman', serif
               font-size: 15px, line-height 1.7
               color: #695E59 (ink-3 en hex)
               margin-bottom 24px

**3. CTA button**
   display:        inline-block (centrado con text-align: center en el wrapper)
   background:     #1C1612  (ink en hex)
   color:          #FAF9F7  (bg en hex)
   padding:        12px 28px
   border-radius:  8px
   font-family:    Arial, Helvetica, sans-serif
   font-size:      14px, font-weight: bold
   text-decoration: none
   margin-bottom:  24px

**4. Secondary text (expiracion / ignore)**
   font-size:  12px, color #8C837E (ink-4 en hex)
   text-align: center, line-height 1.6

**5. Footer**
   border-top:  1px solid #E8E7E4
   padding:     24px 40px
   font-size:   11px, color #8C837E
   text-align:  center
   contenido:   (c) 2026 Odessay · direccion fisica (requisito anti-spam)
               + link "Gestionar notificaciones" (stub)

---

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
<body style="margin:0;padding:0;background-color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding:40px 40px 32px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:500;color:#1C1612;line-height:1.2;">
              Odessay
            </td>
          </tr>
          <tr>
            <td style="border-bottom:1px solid #E8E7E4;"></td>
          </tr>
          <!-- Body -->
          <tr>
            <td align="center" style="padding:32px 40px;">
              <p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:500;color:#1C1612;line-height:1.4;">Welcome to Odessay</p>
              <p style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.7;color:#695E59;">Click the button below to confirm your email and start writing.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td align="center">
                    <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup" style="display:inline-block;padding:12px 28px;background-color:#1C1612;color:#FAF9F7;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;border-radius:8px;">Confirm email address</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8C837E;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid #E8E7E4;padding:24px 40px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8C837E;text-align:center;line-height:1.6;">
              &copy; 2026 Odessay &middot; 123 Example St, San Francisco, CA 94102<br>
              <a href="https://odessay.com/settings/notifications" style="color:#8C837E;text-decoration:underline;">Gestionar notificaciones</a>
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
- Uses `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup` — never `{{ .ConfirmationURL }}`.
- Plain-text fallback is auto-generated by Supabase.

---

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
<body style="margin:0;padding:0;background-color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding:40px 40px 32px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:500;color:#1C1612;line-height:1.2;">
              Odessay
            </td>
          </tr>
          <tr>
            <td style="border-bottom:1px solid #E8E7E4;"></td>
          </tr>
          <!-- Body -->
          <tr>
            <td align="center" style="padding:32px 40px;">
              <p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:500;color:#1C1612;line-height:1.4;">Reset your password</p>
              <p style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.7;color:#695E59;">We received a request to reset the password for your Odessay account ({{ .Email }}). Click the button below to choose a new password.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td align="center">
                    <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery" style="display:inline-block;padding:12px 28px;background-color:#1C1612;color:#FAF9F7;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;border-radius:8px;">Reset password</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8C837E;">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid #E8E7E4;padding:24px 40px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8C837E;text-align:center;line-height:1.6;">
              &copy; 2026 Odessay &middot; 123 Example St, San Francisco, CA 94102<br>
              <a href="https://odessay.com/settings/notifications" style="color:#8C837E;text-decoration:underline;">Gestionar notificaciones</a>
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
- Uses `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`.
- No login link, no upsell, no "Need help?" section with multiple links.

---

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
<body style="margin:0;padding:0;background-color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding:40px 40px 32px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:500;color:#1C1612;line-height:1.2;">
              Odessay
            </td>
          </tr>
          <tr>
            <td style="border-bottom:1px solid #E8E7E4;"></td>
          </tr>
          <!-- Body -->
          <tr>
            <td align="center" style="padding:32px 40px;">
              <p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:500;color:#1C1612;line-height:1.4;">Confirm your new email</p>
              <p style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.7;color:#695E59;">You requested to change the email address for your Odessay account. Click the button below to confirm this change.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td align="center">
                    <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email_change" style="display:inline-block;padding:12px 28px;background-color:#1C1612;color:#FAF9F7;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;border-radius:8px;">Confirm new email</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8C837E;">This link expires in 24 hours. If you didn't request this change, you can safely ignore this email.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid #E8E7E4;padding:24px 40px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8C837E;text-align:center;line-height:1.6;">
              &copy; 2026 Odessay &middot; 123 Example St, San Francisco, CA 94102<br>
              <a href="https://odessay.com/settings/notifications" style="color:#8C837E;text-decoration:underline;">Gestionar notificaciones</a>
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
- Uses `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email_change`.

---

### Reauthentication (opcional)

**Subject:** `Your Odessay verification code`

**Nota importante:** Reauthentication **no usa** el route handler `/auth/confirm`. El flujo de reauthentication de Supabase envia un codigo OTP de 6 digitos que el usuario tiene que ingresar manualmente en la UI de Odessay, no clickear un link. La API `supabase.auth.reauthenticate()` dispara este email; el usuario pasa el codigo a `supabase.auth.updateUser({ password, nonce: <codigo> })` desde la pagina de reautenticacion.

**Template (HTML):**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Odessay verification code</title>
</head>
<body style="margin:0;padding:0;background-color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding:40px 40px 32px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:500;color:#1C1612;line-height:1.2;">
              Odessay
            </td>
          </tr>
          <tr>
            <td style="border-bottom:1px solid #E8E7E4;"></td>
          </tr>
          <!-- Body -->
          <tr>
            <td align="center" style="padding:32px 40px;">
              <p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:500;color:#1C1612;line-height:1.4;">Your verification code</p>
              <p style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.7;color:#695E59;">Enter this code in Odessay to confirm it's you. The code is valid for 1 hour.</p>
              <p style="margin:0 0 24px;font-family:'Courier New',monospace;font-size:28px;font-weight:600;letter-spacing:0.18em;color:#1C1612;text-align:center;">{{ .Token }}</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8C837E;">If you didn't request this, you can safely ignore this email and your account will stay secure.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid #E8E7E4;padding:24px 40px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8C837E;text-align:center;line-height:1.6;">
              &copy; 2026 Odessay &middot; 123 Example St, San Francisco, CA 94102<br>
              <a href="https://odessay.com/settings/notifications" style="color:#8C837E;text-decoration:underline;">Gestionar notificaciones</a>
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
- No hay link clickeable. El usuario copia el codigo `{{ .Token }}` y lo pega en la UI de Odessay.
- Solo aplica si reauthentication (Nonce / MFA step-up) esta habilitado en Supabase Auth settings.
- Renderiza `{{ .Token }}` (codigo de 6 digitos), no `{{ .TokenHash }}`.

---

## Route handler: `GET /auth/confirm`

El route handler `app/(auth)/auth/confirm/route.ts` es el punto de entrada para todos los links de autenticacion. Valida el token server-side con `verifyOtp` y establece la sesion en cookies antes de redirigir al destino final.

**Parametros de query:**
- `token_hash` (requerido): Hash del token enviado por Supabase (variable `{{ .TokenHash }}` en el template).
- `type` (requerido): Tipo de accion, hardcodeado por template — uno de `signup`, `recovery`, `email_change`, `invite`, `magiclink`, `email`. **No usar `{{ .Type }}`** — esa variable no existe en los templates de Supabase.
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
5. **Identidad consistente.** Header wordmark "Odessay" en Lora 20px. Footer con (c) ano, direccion fisica stub y link de gestion.
6. **URLs dinamicas.** Usar `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=<literal>`. Nunca hardcodear URLs de Supabase.
7. **Tiempo de expiracion explicito.** Mencionar cuanto dura el link (24h para signup/email-change, 1h para password reset/reauthentication).
8. **Instruccion de ignore seguro.** Siempre incluir "If you didn't request this, you can safely ignore this email."

---

## Deliverability copy review

Checklist antes de activar cada template en produccion:

| # | Criterio | Estado |
|---|---|---|
| 1 | **Subject corto.** Maximo 50 caracteres. Evitar palabras trigger ("Free", "Win", "Urgent", "Act now"). | |
| 2 | **Bajo conteo de links.** Un solo link clickeable (el CTA). El footer puede tener un link de gestion separado. | |
| 3 | **Sin lenguaje promocional.** No usar superlativos, exclamaciones multiples, o llamados a la accion agresivos. | |
| 4 | **Ratio texto/imagen 80/20 o mejor.** No usar imagenes decorativas. El wordmark es texto, no imagen. | |
| 5 | **From address consistente.** Siempre `Odessay <no-reply@auth.odessay.com>`. No rotar remitentes. | |
| 6 | **Reply-to valido.** Configurar reply-to a una direccion monitorizada o dejarlo vacio para que Supabase maneje bounces. | |
| 7 | **Preview text controlado.** El primer parrafo visible del HTML determina el preview text en Gmail/Outlook. Asegurar que no sea codigo ni variables crudas. | |
| 8 | **Alt text en CTA.** Aunque el CTA es texto plano dentro de un `<a>`, el texto del boton debe ser descriptivo sin depender de estilos. | |
| 9 | **Direccion fisica presente.** El footer incluye una direccion fisica (requisito CAN-SPAM / anti-spam). | |
| 10 | **Opcion de gestionar notificaciones.** El footer incluye un stub de link para gestionar preferencias. | |

**Subjects auditados:**

| Template | Subject | Caracteres | Notas |
|---|---|---|---|
| Confirm signup | "Confirm your Odessay account" | 30 | Directo, sin triggers. |
| Reset password | "Reset your Odessay password" | 29 | Accion clara, sin urgency words. |
| Change email address | "Confirm your new email address for Odessay" | 44 | Informativo, no promocional. |
| Reauthentication | "Your Odessay verification code" | 32 | Identifica el contenido (codigo). |

---

## Staging QA checklist

Validar cada template en el Supabase Dashboard preview o con un email real de staging antes de pasar a In Review.

### Confirm signup

- [ ] Trigger: Llamada a `supabase.auth.signUp()` con `emailRedirectTo` correcto.
- [ ] Sender esperado: `Odessay <no-reply@auth.odessay.com>`.
- [ ] Subject: "Confirm your Odessay account".
- [ ] CTA: "Confirm email address".
- [ ] Link URL: contiene `token_hash=...&type=signup`.
- [ ] Expiracion: 24 horas (configurado en Supabase Auth settings).
- [ ] Valida en: Supabase Dashboard email preview + email real recibido en staging.

### Reset password

- [ ] Trigger: Llamada a `supabase.auth.resetPasswordForEmail()` con `redirectTo` correcto.
- [ ] Sender esperado: `Odessay <no-reply@auth.odessay.com>`.
- [ ] Subject: "Reset your Odessay password".
- [ ] CTA: "Reset password".
- [ ] Link URL: contiene `token_hash=...&type=recovery`.
- [ ] Muestra el email del usuario (`{{ .Email }}`) en el cuerpo.
- [ ] Expiracion: 1 hora (configurado en Supabase Auth settings).
- [ ] Valida en: Supabase Dashboard email preview + email real recibido en staging.

### Change email address

- [ ] Trigger: Llamada a `supabase.auth.updateUser({ email }, { emailRedirectTo })`.
- [ ] Sender esperado: `Odessay <no-reply@auth.odessay.com>`.
- [ ] Subject: "Confirm your new email address for Odessay".
- [ ] CTA: "Confirm new email".
- [ ] Link URL: contiene `token_hash=...&type=email_change`.
- [ ] Expiracion: 24 horas (configurado en Supabase Auth settings).
- [ ] Valida en: Supabase Dashboard email preview + email real recibido en staging.
- [ ] Verificar que Supabase envia DOS emails: notificacion al viejo + confirmacion al nuevo.

### Reauthentication

- [ ] Trigger: Llamada a `supabase.auth.reauthenticate()`.
- [ ] Sender esperado: `Odessay <no-reply@auth.odessay.com>`.
- [ ] Subject: "Your Odessay verification code".
- [ ] No hay CTA clickeable; el cuerpo muestra el codigo OTP de 6 digitos (`{{ .Token }}`).
- [ ] Expiracion: 1 hora (configurado en Supabase Auth settings).
- [ ] Valida en: Supabase Dashboard email preview + email real recibido en staging.

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
4. Link de recuperacion apunta a `{{ .RedirectTo }}&token_hash=...&type=recovery`.
5. Route handler `GET /auth/confirm` valida el token y redirige a `/reset-password`.
6. Password reset completa y entra a `/desk`.
7. Secure email change envia emails desde `auth.odessay.com`.
8. Staging no envia accidentalmente emails reales sin control.
9. No hay llamadas app-side a Resend para confirmacion, recuperacion o cambio de email.
10. Subject lines coinciden con los definidos en este documento.
11. Templates siguen el spec visual de `vistas.md` §Transactional email templates (560px, Lora/Georgia, CTA #1C1612/#FAF9F7, header wordmark, footer con direccion).
12. Staging QA checklist completado para los 4 templates.
13. Deliverability copy review completado y subjects auditados.
