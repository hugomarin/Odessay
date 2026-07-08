# ADR — Arquitectura de identidad y fuente de verdad del documento en Odessay

- **Estado:** Aceptado
- **Fecha:** 2026-06-16
- **Decide:** Hugo (esta es la decisión que ningún skill/doc estaba facultado para tomar)
- **Reemplaza:** el marco "de transición" que aplazaba la polaridad A1/A2/A3
- **Gobernanza:** este ADR es la **fuente de verdad de la arquitectura de documento**. Los cuatro `odessay-desktop-*` y los skills de arquitectura/backend/database deben referenciarlo.
- **Estado del corpus vs. código:** este ADR y los docs reconciliados son **normativos y van por delante del código**. D3 (id inline), D5 (UUID único), D6/D11 (`content_hash` en índice y nube), D7 (repliegue de `rehome`) describen el **destino**, no el runtime actual (hoy el código corre el modelo A+B). Leer los docs de feature como contrato objetivo, no como descripción del estado vigente; cada brecha doc↔código está marcada como trabajo bloqueante en §Consecuencias.

---

## Contexto

El problema no era una "contradicción dentro de un sistema". Eran **dos subsistemas paralelos que nunca se conectan**:

- **Mundo Writings** (legacy, nube-first): `body_json` es la verdad persistida, metadata en frontmatter, sincroniza a Supabase, posee y mueve los archivos (`rehome`). Identidad = UUID de writing (`crypto.randomUUID`) en frontmatter.
- **Mundo Workspace** (ODE-245, local-first): trackea el archivo en su sitio, reconcilia por inode, índice JSON con UUID propio (`Uuid::new_v4` en Rust), sin metadata, sin sync.

El usuario cruza la costura entre ambos cada vez que abre un documento, y al cruzarla **cambia de identidad** (el UUID del workspace se ignora; se usa `frontmatter.id ?? path`). Esa costura es la polaridad sin dueño. Este ADR la cierra.

---

## Decisiones

### D1 — El `.md` es el documento canónico; `body_json` es copia de trabajo

En desktop, el archivo `.md` en disco es la verdad durable. `body_json` (TipTap) es un buffer de trabajo derivado del `.md` al abrir y re-serializado al guardar. En web (sin archivos) `body_json` persiste, pero el **contrato de contenido es el mismo**: markdown es la representación canónica; `body_json` es la copia de trabajo. El contrato es independiente del runtime; solo cambia el substrato donde viven los bytes canónicos. Un documento puede existir solo en nube sin archivo: aceptable.

### D2 — Un markdown, dos roles (no dos formatos)

Un solo perfil de markdown, dos roles: **markdown-fuente** (desktop, round-trip `.md ⇄ body_json` obligatorio) y **markdown-export** (web, `body_json → .md` de una vía, limpio). Al sacar la metadata del frontmatter (D4), ambos comparten el mismo cuerpo y la ausencia de frontmatter. **No convergen del todo:** el markdown-fuente sigue cargando las anotaciones inline (con su id), que el export limpio puede remover. Esa es la única diferencia restante.

### D3 — Anotaciones: ancla + id estable inline; payload en la nube

El modelo canónico de una anotación es **`==texto==[@n: comentario]`**: un span resaltado (la marca Highlight, `==..==`) que define el rango, seguido de un **marcador puntual** cuyo texto es el comentario.

- El **rango (anchor) se deriva del span `==highlight==`** que precede al marcador (`collectAnnotationNodes` en `footnote-extension.ts`); no se almacena aparte y **no se pierde** en el round-trip mientras `==..==` round-trippee.
- El **id de la anotación debe codificarse inline** en el `.md`, junto a `type/index/text`. Hoy NO está, y el round-trip lo regenera (`crypto.randomUUID` en cada parse). **El daño es DESTRUCTIVO, no cosmético:** la tabla `margins` se reconstruye desde `body_json` por id en cada save (`syncMarginsFromBodyJson` hace upsert por id y **borra toda fila cuyo id ya no exista**), así que cada ciclo `.md → body_json → .md` **borra la fila de `margins` de cada anotación** y con ella su estado de colaboración (`resolved`, `shared`, `shared_at`, `archived`), que NO vive en `body_json`. **Trabajo bloqueante y de máxima prioridad para D1/D2:** modificar el serializador/parser (`footnote-node.ts`) para que el id sobreviva el round-trip.
- El **payload rico** (rango, tipo, texto, `reader_id`, `shared`, `resolved`, timestamps) vive en la tabla `margins` del **registro de nube** (ya vive ahí hoy), atado por ese id estable. No en disco.
- Todo el contenido cabe en el perfil markdown (verificado). Las sugerencias IA (CorrectionTrigger/PublicationSuggestion) son **decoraciones de runtime** y no se persisten en el `.md`.

### D4 — El `.md` es puro contenido; la metadata vive en la nube

El `.md` no cumple ninguna función de identificación ni de metadata de Odessay. Es **solo contenido**. Si un archivo tiene frontmatter (un skill con `name/description`, un agent con `name/role/scope`), ese frontmatter es **contenido propio del archivo**, no un casillero de Odessay. Trato **uniforme para todos los archivos**: Odessay **nunca escribe en el frontmatter de ningún archivo** (no hay "reglas distintas según el tipo"). Esto elimina la corrupción de artifacts de raíz.

La metadata de Odessay (`id/slug/status/visibility/version`) y el payload de anotaciones viven en el **registro del documento en la nube** (el writing, con espejo local en IndexedDB para trabajar sin conexión, sincronizado a Supabase). **No hay sidecar de metadata en disco.**

Lo único local en disco, además del propio `.md`, es un **índice de binding delgado** (ruta + inode + huella + UUID) cuyo único trabajo es decir "este archivo = este documento de la nube". No es metadata. **Matiz importante:** el caché de recientes/títulos sí es regenerable desde los `.md`, pero el mapeo ruta↔UUID NO se regenera localmente una vez que el id sale del archivo — se **recupera re-emparejando contra la nube por content_hash** (ver D11). Los archivos ajenos que solo se trackean (skills/agents) entran en ese índice pero **no reciben registro de metadata** ni se tocan: son puro contenido.

### D5 — Una sola identidad: el UUID del cliente, que es el de la nube

Hay un solo punto de acuñación: el `crypto.randomUUID` del writing, generado offline en el cliente, que Supabase adopta como PK al sincronizar. **El índice de workspace adopta ese id** en lugar de generar su `Uuid::new_v4`. Se elimina la fractura de dos UUID desconectados.

### D6 — Identidad = UUID estable + manojo de pistas (con hash)

El binding archivo↔UUID se mantiene con **ruta + inode + content_hash**. Se agrega el **content_hash** (hoy solo hay inode+size), recomendado **BLAKE3**, calculado sobre el markdown canónico en el watcher de Rust, en el debounce (no por evento crudo), solo sobre el archivo cambiado.

- **Prioridad de reconciliación:** la **ruta es la clave primaria**; inode y hash sirven **solo para detectar mover/renombrar**. Tras un guardado atómico (que cambia inode y hash a la vez) solo coincide la ruta, y eso debe bastar para mantener el binding. Los eventos `remove`+`create` de un rename atómico **no deben** disparar la inferencia de borrado de D9.
- **Supresión de auto-escrituras:** el watcher debe ignorar los eventos de las rutas que la propia app acaba de escribir (dentro de una ventana), para no entrar en loop de reconciliación/re-hash en cada guardado.
- El **hash es el fallback del "archivo desnudo"**: si un `.md` llega sin índice de binding local, se re-empareja por hash contra la nube (ver D11) en vez de tratarse como nuevo. **Límite:** el hash es huella de un estado de contenido; solo re-empareja **copias verbatim**, no un archivo editado en otra máquina (su contenido divergió → su hash ya no coincide). La normalización del hash es un contrato estable entre versiones.

### D7 — Archivos en su lugar; replegar `rehome`

Los archivos del usuario se trackean **en su sitio**. Se repliega `rehomeProtectedCanonicalPaths` (hoy mueve archivos de Documents/Desktop/Downloads a almacenamiento interno — comportamiento no documentado que contradice "trabajar sin moverlos") y la dependencia de `writingsDir` como dueño del archivo. La materialización en pull (máquina sin archivo) crea el `.md` y, antes de hacerlo, intenta re-emparejar por hash con archivos locales existentes.

### D8 — Estandarizar `.odessay` y el índice de binding

El índice de binding vive hoy en `.odyssey/index.json` en la raíz del workspace, y el guard del watcher busca `/.odyssey/` — consistentes entre sí, pero **`.odyssey` está mal escrito**: el producto es Odessay. (Que algo esté consistente en el código no lo hace correcto; se valida contra la marca, no contra la repetición.) Decisión: **estandarizar a `.odessay`** en código (`workspace.rs`, `tauri-fs-watch.ts`) y docs (`odessay-workspace.md`), y que el watcher excluya esa carpeta de la detección de documentos. **Trabajo de migración:** renombrar las carpetas `.odyssey/` existentes en workspaces reales a `.odessay/`, o se pierden los bindings ya creados.

### D9 — Cuatro estados del documento y regla de borrado

Un documento puede estar en cuatro estados, según dos preguntas independientes (¿tiene registro en la nube? ¿tiene archivo local presente en ESTA máquina?):

- **Solo nube:** existe el registro (id, metadata, copia de contenido); no hay archivo local.
- **Solo local:** existe el `.md` pero no hay registro de nube. Es un estado **de primera clase**, no un error. Casos: creado offline (pendiente de subir), archivo llegado de afuera, falla de sync, archivo ajeno trackeado (skills/agents), o documento borrado en la nube pero conservado en disco.
- **Sincronizado:** existe en ambos lados.
- **Pendiente (transitorio):** recién creado/editado, aún encolado para sync.

La parte "local" del estado es **por-máquina**; la parte "nube" es global. La UI muestra el estado con un badge derivado de esas dos señales.

**Metadata de un documento "solo local":** un `.md` sin registro de nube ni espejo local usa **metadata por defecto (`draft`/`general`) hasta el primer sync**; NO se cachea metadata en disco (coherente con D4). Se eligió esta opción sobre la alternativa de cachear metadata en el índice de binding. (Decisión voltéable; los archivos ajenos no necesitan metadata de todos modos.)

**Regla de borrado:** borrar el archivo físico **NO** borra el documento de la nube — solo quita la copia local (pasa a "solo nube"). Borrar de la nube es una **acción explícita y separada** dentro de la app. Nunca se destruyen datos de la nube por inferir un borrado a partir de un archivo ausente (puede ser disco desmontado, movido fuera de carpetas vigiladas, accidente). Los dos borrados son procesos independientes.

**Semántica de borrado por runtime:**

- **Web:** no hay archivo local. `DocumentService.deleteWriting` realiza un soft-delete del registro de nube, encolado para sync. Es la única operación de borrado expuesta en la UI.
- **Desktop:** coexisten dos operaciones de borrado con autoridad distinta:
  1. **Borrado del archivo local** (disparado por el watcher cuando un `.md` desaparece del filesystem, o por un comando explícito futuro de "eliminar copia local"): mueve/retira el archivo y llama a `detachLocalFile`, dejando el writing en estado "solo nube". **No** borra el registro cloud.
  2. **Borrado del registro cloud** (acción por defecto en la UI): `DocumentService.deleteWriting` hace soft-delete del registro de nube, encolado para sync, igual que en web. No toca archivos locales.
- **Paridad de interfaz:** `DocumentService.deleteWriting` tiene la misma semántica en web y desktop: borra el registro cloud. El borrado físico de archivo es una operación separada, reflejada en este contrato, y queda bajo responsabilidad del watcher/fs-event (o un comando desktop explícito futuro).
- **UI:** el diálogo de borrado por defecto usa `scope="writing"` para no arrastrar la explicación desktop (archivo local vs nube) al runtime web. Los consumidores que necesiten la explicación cloud/desktop pueden optar por `scope="cloud"`.

### D10 — Cada almacén tiene un solo rol y una sola autoridad

- **`.md` en disco:** autoridad del **contenido** (cuando está materializado).
- **Registro de nube (Supabase):** autoridad de la **metadata**; guarda copia del contenido.
- **IndexedDB (`LocalWriting`):** **espejo local** del registro de nube para trabajo offline. No es verdad aparte.
- **SQLite (`writings_index`) + JSON de identificación:** **caches y puente** (recientes, títulos, mapa ruta↔id). Reconstruibles; **nunca autoritativos**.

**Regla de nombre (ODE-324):** en desktop, el nombre humano canónico es el stem del filename (`title = filename` sin `.md`). `title` en IndexedDB, SQLite y nube es un reflejo reconstruible, no una fuente alternativa. Abrir o sincronizar un archivo re-deriva el título desde su ruta; renombrar desde la app renombra primero el archivo y después actualiza caches y cola. Los caracteres ilegales se eliminan al crear/renombrar, preservando mayúsculas, acentos y espacios; una colisión se resuelve como `Nombre 2.md`, cuyo título efectivo es `Nombre 2`. El auto-title desde cuerpo de ODE-38 queda limitado al runtime web y a drafts sin filename materializado.

Orden de guardado: escribir el `.md` (commit del contenido) → actualizar caches locales (SQLite + JSON) → actualizar el espejo (IndexedDB) → encolar sync a Supabase (asíncrono, con reintentos). La divergencia entre lados se detecta con la huella de contenido. Con la huella como puente, el guardado **atómico** (temporal + reemplazo) es seguro aunque cambie el inode (la reconciliación es ruta-primero, ver D6).

### D11 — Portabilidad de identidad cross-máquina: el `content_hash` también vive en la nube (BLOQUEANTE de D4)

Quitar el `id` del frontmatter (D4) elimina lo único que hoy hace portable la identidad dentro del archivo. Para que un `.md` **desnudo** (sin índice de binding previo, en una máquina nueva) pueda reconectarse con su documento, **el registro de nube debe almacenar el `content_hash`** (sobre el markdown canónico) y, opcionalmente, un **historial de rutas**. Ante un archivo sin id, se compara su huella contra la nube y se recupera el UUID.

**Sin esto, D4 rompe la identidad cross-máquina** y todo `.md` desnudo se vuelve documento nuevo. Hoy el registro de nube NO guarda hash ni ruta — agregarlo es **trabajo nuevo y prerrequisito de D4**. (Schema de Supabase + cambio en el payload de sync + backfill.)

---

## Consecuencias / trabajo derivado (alimenta el plan de fases de código)

1. Modificar serializador/parser para id de anotación estable inline (bloquea D1/D2).
2. Unificar acuñación de UUID: workspace adopta el id del writing (D5).
3. Agregar content_hash (BLAKE3) al índice local **y al registro de nube** (D6/D11); reconciliación ruta-primero; supresión de auto-escrituras.
4. Dejar de escribir frontmatter en cualquier archivo; metadata en el registro del documento; payload de anotaciones en `margins`, atado por el id inline (D3/D4); estandarizar `.odessay` (D8).
5. Reconciliación en pull por hash + materialización in-place; replegar rehome/writingsDir (D7).
6. Migración de datos: **cosechar `frontmatter.id` ANTES de cortar el frontmatter** (registrarlo en índice de binding + nube); luego limpiar el frontmatter de Odessay de los `.md`.
7. Especificar el **camino de guardado** (orden de escritura y manejo de fallas entre `.md`, SQLite, IndexedDB y Supabase) y la detección de divergencia por huella; evaluar guardado atómico (D10).
8. Exponer en la UI el **estado del documento** (solo-nube / solo-local / sincronizado / pendiente) derivado de las dos señales de D9.
9. Renombrar carpetas `.odyssey/` → `.odessay/` en workspaces existentes (D8).

## Pendientes

- **(Runtime)** ✅ Resuelto en ODE-293 (PR #262): conteo real sobre workspaces locales vía scripts/identity/count-id-conflicts.mjs. Resultado: 80 docs, 15 con frontmatter.id, 80 con index.id, 15 conflictos, 0 sin ningún id, 4 índices legacy .odyssey/index.json cargados.
- **(Runtime D4)** ✅ Resuelto en ODE-322: se removió `parseCanonicalFrontmatter`; el runtime nunca interpreta frontmatter como casillero de metadata de Odessay y lo round-trippea siempre como contenido.

## Regla de gobernanza

Ningún implementador debe "promediar" A+B ni elegir por `canonical_path` una vez ejecutado D1/D5.

**Matiz de substrato:** el **contrato de representación** es fijo (markdown canónico, D1); lo que varía por runtime es solo el **substrato de almacenamiento** — markdown en desktop, `body_json` persistido en web (en web no hay archivos). No es "promediar arquitecturas": es un contrato único con dos substratos. La regla prohíbe mezclar *contratos*, no tener dos substratos.
