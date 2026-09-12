# ODESSAY — Stack tecnológico

**Documento de referencia para agentes de desarrollo.**
Lee `odessay-fundacional.md` para entender qué es el producto.
Última actualización: Marzo 2026.

> **En arquitectura de documento, prevalece `workflow/context/core/odessay-adr-identidad.md` (ADR):** la base local (IndexedDB) es un **espejo**, no la verdad; la verdad del contenido es el `.md` canónico, la metadata vive en la nube (D1/D4/D10).

---

## Principio operativo

Este proyecto será construido principalmente por agentes de código (Claude Code, Cursor, agentes con MCP) con mínima intervención humana. Toda decisión técnica debe favorecer la autonomía del agente: convenciones claras, estructura predecible, herramientas bien documentadas.

**Criterio de decisión técnica permanente:**
> ¿Esto hace que la app se sienta más rápida e inmediata, o la vuelve más pesada y frágil?

---

## Velocidad como criterio de arquitectura

La velocidad no es una tabla universal de umbrales ni un requisito que cada PR
deba medir por defecto. Es una propiedad del diseño que debe permanecer
sostenible cuando crecen los documentos, usuarios, componentes, eventos y
operaciones.

La autoridad para activar el análisis, elegir el patrón de carga y seleccionar
la evidencia es `.agents/skills/skill-performance/SKILL.md`. Ese skill se
consulta desde planeación, arquitectura, frontend, backend, database, review y
UX cuando el cambio toca carga, hydration, sync, listeners, bootstrap,
operaciones bulk, desktop o trabajo background.

Los budgets y gates existentes son instrumentos especializados, no un contrato
global. Solo se invocan cuando el `Performance Architecture Contract` del issue
identifica que representan el riesgo real. Las decisiones de dominio —por
ejemplo un intervalo de sync o una forma de payload— permanecen en el documento
de la feature correspondiente y no deben convertirse en umbrales
transversales.

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
| SQLite | Catálogo operacional desktop / persistencia derivada | En desktop sirve `DocumentCatalog`, presencia local/cloud, metadata cacheada y sync queue; se reconstruye desde filesystem + manifests + nube. El `.md` sigue canónico y `.odessay/index.json` preserva el binding. IndexedDB cumple el adapter local-first en web. |
| AI Provider API (configurable) | Agente editor residente + writing assist | Siempre server-side. Proveedor/modelo se resuelven por configuración (env), sin hardcode de modelo en rutas de negocio. |
| Resend | SMTP / email transaccional | SMTP provider para Supabase Auth en `auth.odessay.com`; app-side solo para emails no-auth como invitaciones o notificaciones de writings. |
| Vercel | Hosting web | Deploy desde `main`. Branch previews para PRs. |

### Arquitectura local-first

```
Usuario escribe → base local operativa (inmediato) → Sync queue → Supabase (background)
```

El usuario nunca espera a Supabase. La base local es la fuente de verdad operativa.

**Matiz por runtime:**
- **Web actual:** IndexedDB/local cache + sync queue + Supabase remoto.
- **Desktop objetivo:** filesystem local como write-path principal, con índice derivado opcional (SQLite) y sync remoto secundario.

### Desktop (roadmap)

Desktop no debe tratarse como una web app empaquetada. La meta es un **shared core** reutilizable (dominio, casos de uso, contrato Markdown, validación) con **adapters por runtime** para web, desktop y futuro mobile.

| Opción | Trade-off |
|--------|-----------|
| **Tauri** | Ligereza, menor consumo, binarios pequeños. Más trabajo inicial. Recomendado para Odessay — coherente con la filosofía "Slow" del producto. |
| **Electron** | Mayor velocidad de implementación, ecosistema maduro. Binarios más pesados. |

**Decisión pendiente.** La shell final se decide después de fijar el contrato documental (`.md`), extraer servicios explícitos y separar infraestructura web de core compartido. No al revés.

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
OPENAI_API_KEY=
# Workspace Agent semantic classification defaults to gpt-5.6-luna; optional overrides:
OPENAI_WORKSPACE_MODEL=gpt-5.6-luna
OPENAI_WORKSPACE_REASONING_EFFORT=none
OPENAI_WORKSPACE_MAX_OUTPUT_TOKENS=8192
# Solo para emails no-auth enviados desde la app. Auth email usa Supabase Dashboard SMTP.
RESEND_API_KEY=

# Client-side (NEXT_PUBLIC_)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=   # Nombre preferido (Supabase nuevo)
NEXT_PUBLIC_SUPABASE_ANON_KEY=                  # Alias legacy — backward compatible
```

El setup y matriz de variables por entorno se documenta a nivel repositorio en `.env.example`.
