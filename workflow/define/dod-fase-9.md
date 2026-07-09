# ODESSAY — Fase 9 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 9 — Workspace: Filesystem y Nube**.
Si un punto no está cumplido, Workspace no se considera una capacidad estable del producto.

Fase 7.1 validó la exploración de carpetas locales. Fase 9 convierte esa evidencia en un contrato de producto: Odessay puede agregar proyectos y carpetas existentes, trabajar con sus archivos Markdown in-place y habilitar metadata y capacidades cloud sin trasladar la autoridad del contenido al servidor.

Referencias:

- `workflow/define/roadmap.md`
- `workflow/context/core/odessay-adr-identidad.md`
- `workflow/context/core/odessay-watched-folders.md`
- `workflow/context/features/odessay-workspace.md`
- `workflow/context/features/odessay-workspace-diagnostic.md`
- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-migration-diagnostic.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`

---

## 1) Workspace es una capacidad estable desktop-first

- El usuario puede agregar un proyecto o carpeta existente desde la app desktop y limitar el scope a carpetas o archivos concretos.
- Odessay lista y abre archivos Markdown reales dentro del scope sin moverlos a un directorio interno ni modificar su frontmatter.
- Web no finge acceso al filesystem local: presenta el límite de runtime y dirige a desktop cuando corresponde.
- Quitar un Workspace elimina su registro local y observación, no mueve ni borra los archivos del usuario.

## 2) Contrato único de binding archivo↔documento

- Scan, watcher, apertura, guardado y bootstrap remoto usan un mismo resolver de binding con resultados explícitos: `bound`, `unbound-local`, `ambiguous-hash`, `identity-conflict` u `out-of-scope`.
- Un writing creado por Odessay recibe un único UUID de cliente, adoptado sin cambios por el registro cloud y el índice `.odessay/index.json`.
- Workspace no lee `frontmatter.id` durante su operación normal ni acuña UUIDs en Rust para resolver archivos externos.
- Un archivo externo queda `unbound-local` hasta una acción explícita de adopción/sincronización; un conflicto de identidad nunca borra cola, metadata local ni bindings silenciosamente.
- El índice `.odessay/index.json` contiene solo pistas de binding y configuración local (`ruta`, `inode`, `content_hash`, UUID, `selectedPaths`); no contiene metadata de Odessay.

## 3) Estados locales y cloud preservan su significado

- `local-only`, `cloud-only`, `synced` y `pending` son estados distinguibles en Workspace y no se confunden por la ruta o la sesión del editor.
- Un writing `cloud-only` no crea una copia local por abrir/listar/hidratar; materializarlo requiere una acción explícita o un flujo de pull declarado.
- Una ausencia física confirmada dentro de un path observado retira solo la copia local; excluir un path, desmontar un volumen o perder permisos no equivale a borrar el archivo.
- Borrar un archivo local no borra su metadata ni writing cloud; borrar cloud es una acción explícita separada.

## 4) Sincronización cloud añade capacidades, no autoridad de contenido

- El usuario puede adoptar/sincronizar un archivo local sin moverlo; el flujo explica que se crea o vincula un registro cloud para metadata, colaboración, publicación, AI y acceso entre dispositivos.
- El save path desktop escribe primero el `.md`, actualiza caches/índice y encola sync como operación asíncrona con retry.
- `content_hash` se calcula sobre el mismo Markdown canónico en Rust, TypeScript y payload cloud; hay prueba de paridad sobre fixtures compartidos y rebind solo ante una coincidencia única.
- Renombres, guardados atómicos y copias verbatim conservan o recuperan el binding sin producir duplicados; hash ambiguo y contenido divergente quedan en estado resoluble, no se asignan arbitrariamente.

## 5) Migración y legado se cierran de forma segura

- Las carpetas legacy `.odyssey/` migran a `.odessay/` preservando bindings existentes.
- Los ids históricos de frontmatter se cosechan/migran mediante un flujo explícito y auditable antes de dejar de consultarlos en runtime.
- El mapa de caminos legacy (path-as-id, índice Rust, IndexedDB, frontmatter, filas cloud y migraciones) queda documentado con owner, consumidor y plan de retiro.
- No queda documentación normativa que describa como estado actual un comportamiento ya retirado; cada decisión distingue contrato objetivo, implementación actual y trabajo pendiente.

## 6) Evidencia de aceptación

- Demo desktop: agregar carpeta existente → seleccionar scope → abrir archivo externo → adoptarlo/sincronizarlo → editar localmente sin red → completar sync cuando vuelve la conexión.
- Demo de lifecycle: cloud-only permanece sin archivo local; retirar archivo físico conserva cloud; un conflicto de UUID o hash no pierde datos ni se resuelve en silencio.
- Cobertura automatizada de los escenarios de binding, watcher, sync y migración definidos arriba; typecheck, lint, tests y `ops:delivery:gate` verdes.
- El dueño acepta el demo de outcome antes del cierre de fase.

## Gate de cierre de fase

Fase 9 se marca `Done` solo si se cumplen los seis bloques anteriores, no quedan issues bloqueantes abiertos en el proyecto Linear de Fase 9 y roadmap, DoD, docs de Workspace y código describen el mismo contrato operativo.
