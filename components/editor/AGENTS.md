# Editor Rules

Reglas locales para `components/editor/**`. Complementan, no reemplazan, las reglas universales de `AGENTS.md` raíz.

## Rol de `editor-shell.tsx`

`editor-shell.tsx` (~7k líneas) es un **composition boundary**, no un owner de dominio. Puede montar subsistemas, cablear eventos y coordinar composición de UI.

No debe ser el owner canónico de:
- persistencia de documentos o de correcciones,
- identidad documental,
- estado de dominio de tabs,
- acceso a filesystem,
- semántica de sync.

El tamaño del archivo no es, por sí solo, un finding de review — ver `Hotspots` en `.agents/agents/build-agent.md` y `review-architecture/SKILL.md`. Que absorba una responsabilidad nueva de las listadas arriba sí lo es.

## Deuda conocida — no usar como plantilla

`editor-shell.tsx` hoy llama `localDB.correctionBlocks.*` directamente en varios puntos (save/delete/evictOldest/getByWriting). Es una violación de boundary ya identificada (`architecture/remediation` — disposition: planned; ver Gap Matrix del quality harness). No es un patrón a copiar.

Código nuevo no debe agregar más llamadas directas a `localDB.correctionBlocks` desde `editor-shell.tsx` ni desde otro componente de `components/editor/`. El owner canónico de esa persistencia es `lib/corrections/persistence.ts` — extender ahí y cablear la llamada desde el hotspot.

## Persistencia

Usar el owner de persistencia canónico para el dominio que se está tocando. Componentes de UI no escriben directamente a persistencia local (`localDB`, IndexedDB, filesystem) cuando existe un owner de aplicación/dominio para esa responsabilidad.

## Ownership de estado

Antes de introducir estado nuevo, determinar su owner y su lifecycle.

No representar el mismo estado semántico en params + estado de componente + store + refs sin lifecycles distintos y explícitos para cada uno. Si dos mecanismos pueden decidir el resultado de la misma transición, es una `Transición co-owned` — ver `review-correctness/SKILL.md`.

## Antes de agregar comportamiento

Inspeccionar el owner actual, un comportamiento análogo existente y sus tests canónicos — vía `.agents/skills/architecture-recon/SKILL.md`. No asumir que el archivo más cercano (casi siempre `editor-shell.tsx`, por ser el más grande) es el lugar correcto.
