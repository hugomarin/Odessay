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
| Claude API (Anthropic) | Agente editor residente | Nunca genera texto. Solo observaciones. Siempre server-side. |
| Resend | Email transaccional | Notificaciones de writings recibidos, invitaciones epistolares. |
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

---

## Ambientes

### Desarrollo / Staging

| Servicio | Configuración |
|---------|---------|
| Vercel | Branch previews automáticos por PR. |
| Supabase | Proyecto separado. Schema idéntico a producción. Seed data para testing. |
| Claude API | Haiku para testing si se necesita volumen. Sonnet para staging real. |
| Resend | Dominio de testing. Emails no llegan a destinatarios reales. |

### Producción

| Servicio | Configuración |
|---------|---------|
| Vercel | Dominio odessay.com. Branch `main`. |
| Supabase | Proyecto separado. Backups automáticos. RLS estricto. |
| Claude API | Sonnet. Rate limiting por usuario. |
| Resend | Dominio odessay.com verificado. |

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
RESEND_API_KEY=

# Client-side (NEXT_PUBLIC_)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=   # Nombre preferido (Supabase nuevo)
NEXT_PUBLIC_SUPABASE_ANON_KEY=                  # Alias legacy — backward compatible
```

La fuente canónica de todas las variables y su matriz por entorno (local / staging / producción) está en `workflow/setup/environment.md §Variables de entorno`.