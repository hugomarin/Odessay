# Desktop Runtime Rules (Tauri)

Reglas locales para `src-tauri/**`. Complementan, no reemplazan, las reglas universales de `AGENTS.md` raíz ni el guardrail de arquitectura documental desktop ahí definido.

## Commands: capa delgada

`src-tauri/src/commands/*.rs` es la superficie IPC — recibe la llamada de `invoke()`, valida input y delega. No es el lugar para acumular lógica de dominio nueva.

`index.rs` (~3.4k líneas) y `workspace.rs` (~2.1k líneas) son hotspots ya identificados — igual que `editor-shell.tsx` en el frontend, su tamaño no es el finding; que seguir creciendo con responsabilidad nueva de dominio o de storage sí lo es (ver `Proteger hotspots de orquestación` en `AGENTS.md` raíz). No se exige extraerlos de una sola vez — es deuda con disposition `ratchet + staged extraction`: no agregarles más, extraer cuando una feature vuelva a tocar esa zona.

## Native owners

Cuando una responsabilidad nueva necesite lógica nativa (filesystem, keychain, proceso del sistema), preferir un módulo propio bajo `src-tauri/src/` sobre agregar la lógica dentro de un archivo de `commands/`. El command invoca al módulo; no lo reemplaza.

## Catálogo SQLite

`rusqlite` es el único catálogo operacional y cola durable de desktop (ver guardrail de arquitectura documental desktop en `AGENTS.md` raíz). No introducir un mecanismo de storage nativo paralelo para responsabilidades que ya pertenecen al catálogo.

## Sin runtime web

`src-tauri/src/**` es el adapter desktop — no depende de Next.js, de conceptos exclusivos del navegador, ni asume que el mismo código corre en `web`. Si una pieza necesita compartirse entre web y desktop, esa pieza no vive aquí; vive en shared core y este runtime la consume.

## Antes de tocar un command existente

Inspeccionar qué command/módulo ya resuelve una responsabilidad análoga antes de agregar uno nuevo — vía `.agents/skills/architecture-recon/SKILL.md`. Un segundo command que hace casi lo mismo que uno existente es el mismo finding sistémico que un segundo owner en TypeScript.

## Verificación de bundle

El checklist de bugs específicos del bundle desktop (CSP, keyring backend, `supabase-js` vs `ssr`, `isTauriBuild`, DevTools) vive en `.agents/skills/review-architecture/SKILL.md` — no se repite aquí. Aplica en REVIEW, no como regla de construcción.
