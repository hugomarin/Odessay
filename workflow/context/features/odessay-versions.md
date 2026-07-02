# ODESSAY — Versions

**Documento de referencia para agentes de desarrollo.**
Lee `odessay-margenes.md` (anotaciones tipo `ai`, contrato de sincronización), `odessay-ai-editor.md` (límite del agente residente — no confundir con este flujo), `odessay-sync.md` (watcher, `content_hash`, reconciliación desktop) y `odessay-desktop-app.md` antes de implementar.

Última actualización: 2026-07-01.

---

## Qué resuelve

Cuando el autor trabaja con herramientas AI externas (Claude Code, Codex, u otro agente que edite archivos locales directamente) usando sus anotaciones de margen tipo `ai` como directivas, terminan existiendo múltiples versiones del mismo documento fuera de cualquier registro: la versión antes del round-trip externo y la versión después. Hoy Odessay no distingue esos momentos — el archivo simplemente cambió.

Versions no es historial de cada tecleo (eso es `History` de TipTap, in-memory, sin persistir). Es un registro deliberado de **puntos de quiebre grandes**, especialmente los que resultan de un ciclo de edición AI externo sobre anotaciones `ai`.

---

## Qué no es

- No reemplaza el undo/redo del editor.
- No es un fork sincronizado ni una rama — cada versión es un snapshot inmutable de un momento.
- No construye un loop de "AI edita el documento dentro de Odessay". El agente residente (`odessay-ai-editor.md`) sigue sin generar texto. La edición ocurre siempre afuera, por herramientas que el autor elige y controla — Odessay solo detecta, registra y evalúa el resultado.

---

## El ciclo que formaliza

```
[Autor anota margen tipo "ai" pidiendo un cambio]
  → [Autor copia anotaciones AI ("Copy AI annotations") o trabaja directo sobre el .md local]
  → [Herramienta externa (Claude Code / Codex / etc.) lee el .md, ejecuta las directivas, guarda el archivo]
  → [Watcher de desktop (tauri-fs-watch.ts) detecta el cambio externo al archivo]
  → [Artifact Studio sugiere: "Este archivo cambió afuera. ¿Crear una versión?"]
  → [Autor confirma (o crea versión manualmente en cualquier momento, sin depender del watcher)]
  → [Versión nueva queda registrada, enlazada a las anotaciones "ai" que estaban abiertas en la versión anterior]
  → [Autor puede pedir comparación AI entre dos versiones]
```

---

## Triggers de creación de versión

Dos triggers, no mutuamente excluyentes:

1. **Automático por watcher.** El watcher de desktop (`lib/services/desktop/tauri-fs-watch.ts`) ya distingue escrituras propias de la app (supresión de self-write, `DEFAULT_SELF_WRITE_SUPPRESSION_MS`) de cambios externos al `.md`. Cuando detecta un cambio externo genuino en un archivo que tiene anotaciones `ai` activas (no resueltas) en su última versión conocida, Artifact Studio debe **sugerir** crear una versión — no crearla en silencio. El autor decide.
2. **Manual.** Botón explícito "Guardar versión" disponible en cualquier momento, independiente de si hay anotaciones `ai` pendientes — para que el autor marque un punto antes de un cambio grande por su cuenta.

Ambos triggers producen el mismo tipo de registro; difieren solo en cómo se originaron (`created_via: "watcher-suggested" | "manual"`).

---

## Qué guarda una versión

Una versión es un snapshot **desconectado** de la copia de trabajo — igual que el patrón de "Add to my writings" (ver Fase 8), no vive sincronizada con el documento activo después de crearse.

Campos mínimos:
- `id` (uuid)
- `writing_id`
- `created_at`, `created_via` (`watcher-suggested | manual`)
- `content_hash` del snapshot (reutilizar `lib/content-hash.ts`, mismo contrato BLAKE3 que sync)
- snapshot del contenido — `.md` canónico completo en desktop (fuente de verdad D1, ver `odessay-adr-identidad.md`); considerar guardar solo el `.md` (no `body_json` derivado) para no duplicar el problema de doble fuente de verdad que la identidad de documento ya resolvió
- `annotations_open_ai` — lista de IDs de anotaciones tipo `ai` que estaban activas (no resueltas) al momento de crear la versión, para anclar la comparación posterior

**Costo de storage:** `body_json` no tiene límite de tamaño documentado (ver hallazgo en la investigación de este issue); duplicar snapshots completos por versión escala con el número de versiones × tamaño del documento. Es una decisión de producto aceptar ese costo a cambio de simplicidad — no se optimiza con diffs incrementales en v1.

---

## Comparación entre versiones (AI)

Dos salidas, ambas generadas por AI, no mutuamente excluyentes en la misma comparación:

1. **Reporte de cobertura por anotación.** Toma las `annotations_open_ai` de la versión más antigua del par y el contenido de ambas versiones. Por cada anotación: ¿se atendió? ¿cómo? ¿la herramienta externa hizo cambios adicionales no pedidos por esa anotación? Output estructurado, anclado a `annotation.id`.
2. **Resumen narrativo de cambios.** Changelog en prosa de qué cambió entre las dos versiones, sin depender de que existan anotaciones `ai` — sirve también para comparar dos versiones creadas manualmente sin directivas asociadas.

Esta comparación es una **evaluación sobre el documento**, no una edición del documento — coherente con el límite del agente residente (`odessay-ai-editor.md`): observa y reporta, nunca escribe en el body del autor.

---

## Runtime scope

Versions es una funcionalidad **desktop-first** en v1: el trigger automático depende del watcher de filesystem local, que solo existe en el runtime desktop. La creación manual de versión podría eventualmente existir en web (sobre `body_json` en vez de `.md`), pero v1 no lo requiere — se define explícitamente cuando se decida extender.

---

## Invariantes

- Crear una versión nunca muta el documento activo.
- El trigger automático **sugiere**, nunca crea en silencio.
- Restaurar una versión anterior (si se implementa) es una operación explícita y separada de la comparación — comparar no implica restaurar.
- El snapshot es inmutable una vez creado.
- La comparación AI nunca escribe de vuelta al documento — solo produce un reporte que el autor lee.
