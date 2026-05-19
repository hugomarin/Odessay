# ODESSAY — Stack tecnológico

**Documento de referencia para agentes de desarrollo.**
Lee `odessay-fundacional.md` para entender qué es el producto.
Última actualización: Marzo 2026.

---

## Principio operativo

Este proyecto será construido principalmente por agentes de código (Claude Code, Cursor, agentes con MCP) con mínima intervención humana. Toda decisión técnica debe favorecer la autonomía del agente: convenciones claras, estructura predecible, herramientas bien documentadas.

**Criterio de decisión técnica permanente:**
> ¿Esto hace que la app se sienta más rápida e inmediata, o la vuelve más pesada y frágil?

---

## Velocidad multidimensional (contrato fundacional)

La velocidad de Odessay no es la latencia del teclado. Es el conjunto de cinco dimensiones que, juntas, deciden cómo se siente el producto. Cada decisión técnica — frontend, backend, producto, UX — vive bajo este contrato.

| Dimensión | Qué afirma | Umbral operativo |
|---|---|---|
| **Latencia de interacción** | El usuario actúa y la app responde sin demora. | Keystroke < 16 ms (60 fps). Click/paste dentro de presupuesto en `workflow/perf-budgets.json`. |
| **Tiempo a interactivo** | Abrir una ruta y poder usarla casi de inmediato. | Editor editable < 1 s. Desk/Collections/Reading útiles < 1.5 s desde navegación. |
| **Peso transferido** | La red carga lo justo, no la base de datos entera. | Endpoint de lista ≤ 50 kB ungzip, sin payloads de fila (body_json, body_text, blobs). Endpoint de detalle documenta su p95. |
| **Forma del waterfall** | Cada fetch tiene un propósito y no se repite. | ≤ 6 fetch/XHR en los primeros 3 s de una vista. Cero requests duplicados (misma URL + params) en los primeros 5 s. |
| **Fan-out reactivo** | Un cambio en localDB no dispara N efectos. | Operaciones bulk emiten un solo evento de cambio. Suscriptores que reaccionan a writes hacen debounce ≥ 50 ms. |

**Por qué cinco y no una.** Optimizar solo el keystroke y olvidar las demás produce un editor instantáneo dentro de una app pesada — una contradicción que el usuario percibe aunque no la sepa nombrar. La sensación local-first se sostiene solo si las cinco dimensiones se respetan. Una sola en rojo hunde la experiencia completa.

**Cómo se aplica.** Cada PR declara su impacto solo en las dimensiones que realmente toca (ver `Performance Contract` en `.agents/skills/skill-product-manager/SKILL.md`). Cada skill técnico (frontend, backend, UX) traduce este contrato a su superficie de trabajo. El gate `ops:delivery:gate` cubre la dimensión de interacción del editor; las dimensiones de peso, waterfall y tiempo a interactivo se validan con evidencia objetiva del navegador (DevTools Network, Performance API, Playwright snapshots) cuando el PR las toca. Overruns pequeños dentro de una banda de gracia explícita en `workflow/perf-budgets.json` se reportan como advertencia, no como bloqueo.

**Local-first es velocidad del write path, no excusa para un read path lento.** Renderizar rápido desde IndexedDB mientras en background se bajan megabytes y se disparan cascadas de fetches viola el contrato aunque el "primer pintado" se sienta veloz. La velocidad se mide hasta que la página está completamente útil, no hasta el primer paint.

---

## Stack confirmado

### Core

| Tecnología | Rol | Notas |
|-----------|-----|-------|
| Next.js 15 (App Router) | Framework | Server Components por default. API routes para AI y envío. SSR para rutas públicas. |
| React 19 | UI | — |
| TypeScript | Tipado | Strict mode. Sin `any`. |
| Tailwind CSS | Styling | Única herramienta de styling. No CSS modules, no styled-components. |
| ShadCN/UI | Componentes | Base accesible. Se usa cerca de sus defaults estructurales — la personalización es por tokens (colores, tipografía, bordes, sombras), no por reescritura de componentes. |
| TipTap | Editor | Headless, sobre ProseMirror. Siempre aislado del árbol de React. |

### Tipografía

| Fuente | Uso | Instalación |
|--------|-----|-------------|
| Geist Sans | Todo lo funcional — UI, navegación, labels, botones, badges, metadatos | `npm install geist` |
| Lora | Todo lo epistolar — writings, lectura, títulos de cards, blockquotes | Google Fonts via `next/font/google` |

Nunca mezclar Geist Sans y Lora en el mismo elemento.

### Servicios

| Tecnología | Rol | Notas |
|-----------|-----|-------|
| Supabase | Base de datos remota, Auth, Realtime, Storage | PostgreSQL. RLS en todas las tablas. Realtime para notificaciones. **Es la capa remota, no la operativa.** |
| SQLite | Base de datos local | Persistencia local para desktop (Tauri/Electron). IndexedDB como fallback en web. |
| AI Provider API (configurable) | Agente editor residente + writing assist | Siempre server-side. Proveedor/modelo se resuelven por configuración (env), sin hardcode de modelo en rutas de negocio. |
| Resend | SMTP / email transaccional | SMTP provider para Supabase Auth en `auth.odessay.com`; app-side solo para emails no-auth como invitaciones o notificaciones de writings. |
| Vercel | Hosting web | Deploy desde `main`. Branch previews para PRs. |

### Arquitectura local-first

```
Usuario escribe → SQLite local (inmediato) → Sync queue → Supabase (background)
```

El usuario nunca espera a Supabase. La base local es la fuente de verdad operativa.

### Desktop (roadmap)

La webapp está diseñada para ser empaquetada como desktop app sin reescritura mayor.

| Opción | Trade-off |
|--------|-----------|
| **Tauri** | Ligereza, menor consumo, binarios pequeños. Más trabajo inicial. Recomendado para Odessay — coherente con la filosofía "Slow" del producto. |
| **Electron** | Mayor velocidad de implementación, ecosistema maduro. Binarios más pesados. |

**Decisión pendiente.** La arquitectura actual (Next.js + React + local-first) es compatible con ambas opciones. Lógica de negocio separada de presentación desde el inicio para facilitar la migración.

### Herramientas de desarrollo y agentes

| Herramienta | Uso |
|------------|-----|
| Claude Code | Agente principal de desarrollo |
| Playwright MCP | Testing E2E automatizado. Los agentes verifican flujos completos sin intervención humana. |
| Supabase MCP | Gestión de schema, migraciones, RLS policies desde agentes. |
| Lucide React | Iconografía. `strokeWidth={1.5}` siempre, sin excepción. |
| framer-motion | Animaciones complejas que CSS no puede manejar (stagger, drag). CSS transitions para lo simple. |

---

## Autenticación

- Supabase Auth con **email + contraseña**.
- Middleware de Next.js protege rutas privadas. Redirect a `/login` sin sesión.
- Trigger `on_auth_user_created` crea el profile automáticamente.
- Emails de autenticación enviados por Supabase Auth vía custom SMTP. Resend solo actúa como proveedor SMTP.
- Dominio de auth: `auth.odessay.com`. From canónico: `Odessay <no-reply@auth.odessay.com>`.
- Ver `workflow/context/features/odessay-auth-email.md`.

---

## Ambientes

### Desarrollo / Staging

| Servicio | Configuración |
|---------|---------|
| Vercel | Branch previews automáticos por PR. |
| Supabase | Proyecto separado. Schema idéntico a producción. Seed data para testing. |
| AI Provider API | Modelo configurable por entorno. Cambios de modelo se hacen vía env, no cambiando código. |
| Resend / Supabase Auth SMTP | Custom SMTP configurado en staging. Emails de auth salen desde `auth.odessay.com`; staging debe tener validación controlada para no enviar accidentalmente a destinatarios reales. |

### Producción

| Servicio | Configuración |
|---------|---------|
| Vercel | Dominio odessay.com. Branch `main`. |
| Supabase | Proyecto separado. Backups automáticos. RLS estricto. |
| AI Provider API | Modelo configurable + rate limiting por usuario. |
| Resend / Supabase Auth SMTP | `auth.odessay.com` verificado y conectado como custom SMTP de Supabase Auth. |

**Regla crítica:** Los agentes nunca operan contra producción. Todo en staging. Deploy a producción por merge a `main` con preview verificado.

---

## Convenciones para agentes

- **Estructura:** Next.js App Router (`/app`, `/components`, `/lib`, `/api`)
- **Naming:** inglés para todo (código, URLs, componentes, DB). UI con i18n (next-intl). Inglés por default, español segundo prioritario.
- **Commits:** convencionales (`feat:`, `fix:`, `chore:`)
- **Migraciones:** versionadas, reversibles
- **Variables de entorno:** `NEXT_PUBLIC_` solo para lo seguro de exponer. Keys siempre server-side.
- **Testing:** Playwright para E2E de flujos críticos (escribir → compartir → leer → anotar → responder)
- **Nomenclatura de componentes:** `id`, `data-page`, `data-section`, `data-testid`, clase BEM en PascalCase en cada módulo. Ver `skill-frontend.md`.

---

## Variables de entorno

```bash
# Server-side only
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
FIREWORKS_API_KEY=
FIREWORKS_MODEL=
# Solo para emails no-auth enviados desde la app. Auth email usa Supabase Dashboard SMTP.
RESEND_API_KEY=

# Client-side (NEXT_PUBLIC_)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=   # Nombre preferido (Supabase nuevo)
NEXT_PUBLIC_SUPABASE_ANON_KEY=                  # Alias legacy — backward compatible
```

El setup y matriz de variables por entorno se documenta a nivel repositorio en `.env.example`.
