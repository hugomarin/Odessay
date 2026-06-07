# ODESSAY — Fase 7.1 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 7.1 — Exploración de Workspace Local / Watched Folders**.
Si un punto no está cumplido, la exploración no se considera cerrada.

El objetivo central de esta fase no es shipping completo. Es producir evidencia suficiente para decidir si la línea `Workspace` debe formalizarse como capacidad estable del producto y bajo qué contrato arquitectónico conviene hacerlo.

Referencias:
- `workflow/define/roadmap.md`
- `workflow/define/dod-fase-7.md`
- `workflow/new features/watched-folders.md`
- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`
- `workflow/context/core/odessay-stack.md`
- `.agents/skills/skill-architecture/SKILL.md`
- `.agents/skills/skill-product-manager/SKILL.md`

---

## 1) Exploración claramente separada del cierre de convergencia

- La exploración no reabre ni degrada los invariantes cerrados en Fase 7.
- El trabajo se entiende como una línea post-convergencia, no como condición para declarar paridad web/desktop.
- Cualquier issue de esta fase declara explícitamente que su objetivo es aprender y decidir, no cerrar arquitectura completa.

## 2) Base operativa mínima sobre filesystem local existente

- El usuario puede seleccionar una carpeta local desde desktop.
- Odessay puede inspeccionar esa carpeta y listar archivos soportados (`.md`, y opcionalmente `.txt` si el issue lo define).
- La lectura inicial funciona sobre archivos reales del usuario, no sobre fixtures internos ni documentos importados previamente.

## 3) Contrato de apertura validado

- Existe una decisión explícita y probada sobre cómo se abre un archivo local existente en el editor.
- No queda ambigüedad entre abrir por `path`, `canonical_path`, `writing id` o flujo de import transitorio.
- La decisión preserva el contrato documental canónico ya fijado para desktop.

## 4) Boundaries arquitectónicos declarados

- Queda claro qué parte vive en `UI`.
- Queda claro qué parte vive en `Application`.
- Queda claro qué parte vive en `Adapter/desktop`.
- No se resuelven capacidades de filesystem local como si fueran solo `frontend`.

## 5) Preguntas de producto reducidas con evidencia

Al cerrar la fase, deben quedar respondidas con evidencia concreta al menos estas preguntas:

- si la navegación debe ser lista plana, árbol o una mezcla
- si la acción de apertura reutiliza el editor actual o exige otra superficie
- si `Workspace` es el nombre correcto o si debe renombrarse
- si la acción de añadir carpeta vive en sidebar, página o ambos

## 6) No-commitment explícito sobre arquitectura expandida

- La fase puede cerrar sin `.odessay/`, metadata persistente, watcher en tiempo real, snapshots o sync cloud.
- Si alguna de esas líneas se recomienda, queda declarada como trabajo posterior y no como obligación encubierta del MVP.
- No quedan promesas implícitas de shipping completo dentro del mismo issue exploratorio.

## 7) Calidad de entrega (gate técnico)

- `typecheck` verde.
- `lint` verde.
- `tests` verdes para la porción implementada.
- Existe evidencia manual reproducible del flujo explorado.
- La documentación de planning queda alineada con el outcome real de la exploración.

## 8) Evidencia manual mínima

- Abrir desktop → agregar carpeta local → ver lista de archivos soportados.
- Seleccionar archivo existente → abrirlo mediante el contrato elegido → confirmar que el editor lo interpreta razonablemente.
- Reiniciar la app → verificar si la persistencia mínima definida para la exploración se conserva.
- Confirmar que el flujo no rompe escritura local ya existente ni reintroduce dependencia del runtime web.

## 9) Gate de cierre de fase

Fase 7.1 se marca `Done` solo si:

- Se cumplen los 8 bloques anteriores.
- Existe una recomendación explícita: promover, recortar o cancelar la línea `Workspace`.
- El resultado deja listo un siguiente paso de planning más preciso, no otro ciclo ambiguo de exploración.
