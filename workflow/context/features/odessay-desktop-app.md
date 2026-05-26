# ODESSAY — Desktop App

**Documento de referencia para agentes de desarrollo.**
Lee `workflow/context/core/odessay-fundacional.md` para la visión, `workflow/context/core/odessay-stack.md` para el stack vigente, `workflow/context/features/odessay-editor.md` para el comportamiento del editor, `workflow/context/features/odessay-prosemirror-tiptap.md` para el backbone TipTap/Markdown, y `workflow/context/features/odessay-sync.md` para la capa local-first actual.

Este documento captura la **dirección objetivo** de Odessay como Desktop App. No describe el estado exacto del runtime web actual; describe la arquitectura y las decisiones que deben guiar la implementación desktop y la convergencia futura entre web y desktop.

Para implementación y secuenciación, este documento se complementa con:

- `workflow/context/features/odessay-desktop-migration-diagnostic.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`
- `workflow/context/features/odessay-desktop-docs-corrections-log.md`

**Nota de autoridad documental:**

- Este documento es principalmente de **dirección de producto y principios arquitectónicos**.
- La evaluación del estado actual del codebase vive normativamente en `odessay-desktop-migration-diagnostic.md`.
- La partición del sistema en core/adapters vive normativamente en `odessay-desktop-target-architecture.md`.
- La secuencia de ejecución vive normativamente en `odessay-desktop-migration-plan.md`.

Las secciones históricas de evaluación o implementación temprana que aún permanezcan aquí deben leerse como contexto de transición, no como autoridad principal frente a esos documentos.

---

## El principio que define desktop

En desktop, Odessay no es una web app empaquetada. Es una herramienta de escritura local, orientada a archivos, con sincronización y servicios remotos como capacidades secundarias.

La consecuencia principal es esta:

> En desktop, el documento vive primero en el disco del usuario. La red respalda, sincroniza, publica o asiste. No define la existencia del documento.

Esto cambia varias suposiciones del runtime web actual:

- El usuario debe poder abrir, editar y guardar sin red.
- El login no debe ser requisito para arrancar la app.
- El documento no debe depender de una base local operativa para existir.
- Supabase deja de ser la fuente de verdad primaria del writing en desktop.

---

## Formato canónico del documento

### Markdown como fuente de verdad

El formato canónico de los writings en desktop es **`.md`**.

No es solo un formato de import/export. Es el formato nativo del producto por tres razones:

1. Es legible y editable fuera de Odessay.
2. Es el formato más natural para flujos con AI, skills y contexto textual.
3. Obliga a que el editor rico permanezca dentro de un subconjunto controlado y durable.

### `.txt` no es par de `.md`

`.txt` se soporta como formato de compatibilidad, no como formato canónico equivalente.

Reglas:

- Un `.txt` puede abrirse e importarse.
- Un `.txt` puede exportarse.
- Si el usuario trabaja sobre `.txt`, el documento opera en modo plain-text y no puede prometer round-trip de estructura Markdown.
- El producto no debe diseñarse alrededor de `.txt`; debe diseñarse alrededor de `.md`.

### Fuente de verdad única

En desktop, la fuente de verdad persistida del documento es el contenido Markdown del archivo.

Esto implica:

- TipTap no es la fuente de verdad persistida.
- JSON de ProseMirror no es la fuente de verdad persistida.
- Caches, índices, previews o materializaciones ricas son derivados re-generables.

---

## Odessay Markdown Profile

Odessay ya tiene de facto un perfil Markdown controlado en el código actual. Desktop y web deben compartir **el mismo perfil**.

Ese perfil debe seguir estas reglas:

- Solo soportar formato que pueda round-tripear de forma fiable.
- Mantener el documento útil fuera de Odessay.
- Evitar dialectos excesivos o sintaxis propietaria difícil de leer.

### Subconjunto soportado

El subconjunto objetivo es el que hoy ya está implícito en editor y export:

- headings `#`, `##`, `###`
- paragraphs
- bold
- italic
- strike
- highlight `==...==`
- links
- blockquotes
- ordered lists
- bullet lists
- inline code
- fenced code blocks
- tables simples
- images
- footnotes

### Regla de diseño de formato

Si una feature no puede vivir de forma limpia en este perfil Markdown, entonces una de estas cosas debe ocurrir:

1. La feature no entra al core del producto.
2. La feature se degrada razonablemente al salir de Odessay.
3. La feature vive fuera del documento canónico como dato transitorio o derivado.

Lo que no se debe hacer es deformar el `.md` con una capa propietaria grande solo para soportar UI rica.

### Inspiración correcta

La referencia adecuada no es convertir Markdown en un lenguaje de componentes arbitrario. La referencia adecuada es el enfoque de iA Writer:

- Markdown sigue siendo el centro.
- El editor puede renderizarlo de forma rica.
- Algunas extensiones muy controladas son aceptables.
- El archivo sigue siendo buen Markdown para otros editores y para AI.

---

## Qué debe vivir dentro del `.md`

Todo lo que sea **contenido durable** del writing debe vivir en el `.md` siempre que el perfil lo soporte limpiamente.

Ejemplos:

- cuerpo del texto
- estructura del documento
- headings
- enlaces
- blockquotes
- código
- tablas soportadas
- imágenes referenciadas
- footnotes

### Preferencia fuerte

La preferencia arquitectónica es que el documento sea un solo `.md` legible y autocontenido en la mayor medida posible.

La app debe preferir:

- footnotes antes que metadata opaca
- sintaxis Markdown estándar antes que inventar bloques nuevos
- convenciones mínimas antes que sidecars

### Excepciones controladas

No todo debe forzarse dentro del `.md`.

Hay categorías que no son contenido durable y por tanto no deben contaminar el archivo principal:

- estado del cursor
- panel activo
- posición de scroll
- estado temporal de sugerencias AI
- hashes internos de sync
- estado de subida de assets
- telemetría

Si alguna de estas necesita persistencia local, debe vivir fuera del documento canónico.

---

## TipTap y modo Rich en desktop

Odessay ya tiene un flujo funcional TipTap <-> Markdown en web. Desktop debe construir sobre esa base, no reemplazarla.

La regla de desktop es:

> TipTap es una vista rica y editable del `.md`, no una fuente de verdad paralela.

### Modelo operativo

```text
Archivo .md
   ↓ parse
AST / ProseMirror JSON derivado
   ↓ edición rica
Serialización de vuelta a .md
   ↓ save
Archivo .md actualizado
```

### Modo Rich y Modo Source

Desktop debe mantener dos superficies legítimas sobre el mismo documento:

- **Rich mode**: TipTap, restringido al perfil Markdown soportado.
- **Source mode**: edición directa del `.md`.

Ambos modos operan sobre el mismo documento canónico. No son documentos distintos ni caches separadas.

### Guardrail clave

No se deben consolidar dos serializadores canónicos distintos de Markdown.

El código actual ya muestra dos rutas:

- serialización runtime desde `tiptap-markdown`
- serialización de export basada en `buildWritingMarkdown(...)`

Antes de que `.md` pase a ser la fuente de verdad en desktop, debe existir un contrato claro:

- o una sola ruta canónica de serialización,
- o tests estrictos que demuestren equivalencia funcional entre ambas.

---

## Filesystem como base operativa

Desktop es file-based first.

Eso implica:

- abrir archivos existentes del usuario
- crear nuevos `.md`
- auto-save sobre el filesystem local
- detectar cambios externos al archivo cuando aplique
- resolver rutas relativas para imágenes y otros assets

### Principio de apertura

La app debe poder trabajar con:

- un archivo Markdown individual
- una carpeta de writings
- una carpeta de proyecto del usuario

La implementación inicial puede empezar por archivo individual, pero no debe cerrarse a un modelo por carpeta si los assets locales lo requieren.

### Assets

Si un writing usa imágenes u otros binarios locales, el sistema debe preferir rutas simples y portables.

No se debe asumir que todo asset será remoto o subido a Supabase. En desktop, el caso base es local.

---

## Índice local e información derivada

Aunque el documento viva en `.md`, la app puede necesitar estructuras derivadas para rapidez operativa:

- recientes
- búsqueda
- colecciones
- árbol de correspondencias
- cache de previews

Regla:

- El `.md` es la fuente de verdad del contenido.
- Un índice local puede existir como acelerador.
- El índice local nunca debe convertirse silenciosamente en la fuente de verdad del writing.

Si se implementa un índice, debe ser explícitamente derivable y reconstruible.

---

## Sync y respaldo remoto

En desktop, sync deja de ser el write-path principal. Pasa a ser una capacidad secundaria:

- backup
- sync entre dispositivos
- publicación
- sharing
- colaboración futura

### Nueva jerarquía de verdad

```text
Desktop filesystem = fuente de verdad primaria
Índice/cache local = acelerador derivado
Supabase/remote = respaldo y sincronización
```

### Implicación importante

El usuario no debe percibir que “guardar” depende de Supabase. El documento ya quedó guardado cuando el archivo local se escribió correctamente.

### Conflictos

Los conflictos de sync ya no se parecen a los de una app CRUD web.

La estrategia futura debe modelarse como sync de archivos/documentos, no como `PATCH` incremental sobre una fila remota. Eso exige considerar:

- hash del documento
- timestamp de modificación local
- versiones por dispositivo
- cambios externos en archivo

No hace falta resolver todos esos problemas en el MVP, pero desktop no debe heredar sin más el modelo de sync de la web actual.

---

## Auth en desktop

En desktop, auth no es gate de arranque. Es una capacidad opt-in.

El usuario debe poder usar la app sin login para:

- crear writings
- abrir writings
- editar writings
- guardar localmente
- exportar

Login solo se pide cuando se necesita:

- sync
- backup remoto
- publishing
- sharing
- AI remota si aplica

Esta diferencia es estructural. Desktop no debe portar sin más el esquema actual de auth SSR/middleware/cookies de la web.

---

## AI como input y output nativo de Markdown

Odessay debe asumir que `.md` es un formato nativo para AI, no solo una exportación legible.

### Input

Los modelos deben poder recibir:

- el archivo Markdown completo
- fragmentos del archivo
- secciones seleccionadas
- footnotes relevantes

sin una capa de traducción propietaria pesada.

### Output

La AI debe poder devolver resultados útiles sobre Markdown:

- sugerencias textuales
- bloques reescritos
- observaciones puntuales
- títulos alternativos
- propuestas de estructura

La app luego decide cómo presentar o aplicar esos cambios. Pero el contrato textual ideal sigue siendo Markdown.

### Regla de seguridad semántica

Las features AI no deben empujar al producto a introducir sintaxis propietaria grande solo para transportar contexto interno del editor.

---

## Relación entre web y desktop

El objetivo no es que web y desktop tengan el mismo runtime. El objetivo es que compartan el mismo modelo documental.

### Debe compartirse

- perfil Markdown
- parser/serializer
- reglas de round-trip
- semántica editorial
- renderer de lectura
- comportamiento del editor dentro del subconjunto soportado

### Puede divergir

- auth
- storage operativo
- sync
- publicación
- apertura de archivos
- integración con filesystem
- empaquetado y shell

La compatibilidad estratégica no está en compartir middleware de Next, sino en compartir el contrato del documento.

---

## Distribución de servicios: Local/Rust vs Nube

La migración a desktop no consiste en mover "todo el server-side" a Rust. Consiste en reclasificar cada servicio según su naturaleza.

### Regla de clasificación

Un servicio debe tender a **Local/Rust** cuando:

- depende del filesystem o del sistema operativo
- debe funcionar offline
- no requiere secretos globales de Odessay
- es parte de la experiencia base del documento en la máquina del usuario

Un servicio debe tender a **Nube** cuando:

- requiere una API key compartida del producto
- coordina múltiples dispositivos o múltiples usuarios
- maneja billing, auth de cuenta o publicación remota
- requiere control centralizado, rate limiting u observabilidad del servicio

### Tabla operativa

| Servicio | Destino recomendado | Motivo principal |
|---|---|---|
| Abrir/guardar writings `.md` | Local/Rust | El archivo vive en el disco del usuario. |
| Auto-save del documento | Local/Rust | Debe funcionar sin red y sentirse inmediato. |
| Watch de cambios externos en archivos | Local/Rust | Es una capacidad del sistema de archivos local. |
| Gestión de carpeta/workspace local | Local/Rust | Es desktop-native y depende del sistema operativo. |
| Resolución de rutas relativas de assets | Local/Rust | Pertenece al documento local y a su carpeta. |
| Inserción/copia de imágenes locales | Local/Rust | Es I/O local, no una capacidad remota. |
| Export a PDF/DOCX/Markdown | Local/Rust | No requiere nube ni secretos del producto. |
| Índice local de recientes/búsqueda/previews | Local/Rust | Es acelerador de UX sobre archivos locales. |
| Settings y preferencias locales | Local/Rust | Son datos del usuario en su dispositivo. |
| Guardado de credenciales del propio usuario | Local/Rust | Debe vivir en storage seguro local, no en el renderer. |
| Sync multi-device | Nube | Coordina dispositivos y estado remoto. |
| Backup remoto | Nube | Es una capacidad compartida del producto. |
| Auth de cuenta Odessay | Nube | Es identidad remota, no función del dispositivo. |
| Suscripciones / billing | Nube | Requiere control central y seguridad. |
| Publicación web | Nube | Crea estado compartido fuera del dispositivo. |
| Sharing / invitaciones / acceso compartido | Nube | Implica usuarios múltiples y permisos remotos. |
| Márgenes/comentarios compartidos | Nube | Son colaboración o lectura remota compartida. |
| AI pagada por Odessay | Nube | La API key del proveedor no debe distribuirse a los clientes. |
| Búsqueda local en el workspace | Local/Rust | Debe seguir funcionando offline y leer archivos locales. |
| Búsqueda cross-device / corpus remoto | Nube | Exige indexado centralizado y estado compartido. |
| Modelo local opcional | Local/Rust | No requiere proveedor remoto ni key compartida. |
| BYOK AI (key del usuario) | Local/Rust | La credencial pertenece al usuario, no a Odessay. |

### Casos mixtos

Hay servicios que pueden existir en dos variantes:

- **AI**:
  - default: Nube
  - opcional: Local/Rust si el usuario trae su propia key o usa modelo local
- **Search**:
  - local del workspace: Local/Rust
  - global o cross-device: Nube
- **Assets**:
  - referencia local en el `.md`: Local/Rust
  - publicación o sharing del asset: Nube

### Regla para implementación

Cuando un servicio exista tanto en web como en desktop, no se debe compartir la capa de infraestructura a la fuerza. Lo que sí debe compartirse es:

- el contrato de entrada/salida
- los tipos
- la validación
- la lógica pura cuando exista

La implementación concreta puede divergir:

- `FilesystemDocumentService` en desktop
- `SupabaseDocumentService` o `RemoteDocumentService` en web/nube

---

## Evaluación del estado actual: separación Frontend / Backend

### Diagnóstico general

La separación actual es **parcialmente buena**, pero todavía está demasiado orientada al runtime web de Next.

Hay una base reusable importante:

- buena cantidad de lógica pura en `lib/editor/*`
- utilidades puras de dominio en `lib/margins/margins.ts`
- utilidades puras de sharing en `lib/sharing/writing-shares.ts`
- lógica local-first razonablemente encapsulada en `lib/local-db/*` y `lib/sync/*`
- import/export Markdown relativamente bien aislado en `lib/import/*` y `lib/export/*`

Pero el acoplamiento al transporte web sigue siendo alto:

- muchos clientes llaman `fetch("/api/...")` directamente
- muchas rutas API contienen lógica de negocio además del transporte HTTP
- auth y sesión dependen del modelo SSR/cookies/middleware de Next
- varias capacidades "de servicio" hoy están modeladas como Route Handlers en lugar de servicios transport-agnostic

### Dónde la separación sí está bien

La separación es buena o prometedora en estas áreas:

| Área | Estado actual | Lectura para desktop |
|---|---|---|
| Editor + Markdown | Buena | Reusable casi completa, cambiando storage y adapters. |
| Import/export | Buena | Encaja bien en un servicio local desktop. |
| Utilidades de margins/sharing | Buena | Son lógica pura y portable. |
| Estado local y stores | Aceptable | Reutilizable, aunque habrá que revisar dependencias de rutas web. |
| Sync queue / retry | Aceptable | La lógica sirve, pero el transporte debe abstraerse. |

### Dónde la separación aún no está bien

Estas áreas todavía están muy acopladas al runtime web:

| Área | Problema actual | Implicación |
|---|---|---|
| Cliente -> API interna | Muchas llamadas directas a `/api/...` | Desktop no debe depender de Route Handlers locales estilo Next. |
| Auth | SSR, cookies, middleware y redirects | Debe re-modelarse por completo para desktop. |
| CRUD remoto de writings/collections | Sync worker y bootstrap acoplados a HTTP local de Next | Hay que extraer interfaces de servicio/remoto. |
| AI routes | Mezclan transporte HTTP, auth y orquestación del proveedor | Conviene extraer un `AIService` reusable. |
| Upload de imágenes | Route Handler con `service_role` y Supabase Storage | En desktop base el flujo debe ser local primero. |
| Publicación / sharing | Lógica remota dispersa en varias rutas | Debe consolidarse como servicios de nube explícitos. |

### Ejemplos concretos del acoplamiento actual

- `lib/sync/worker.ts` y `lib/sync/remote-bootstrap.ts` dependen de `fetch("/api/...")` como transporte operativo.
- `components/editor/editor-shell.tsx` dispara features remotas vía endpoints internos de Next para AI y export remoto.
- `lib/supabase/server.ts` y `lib/supabase/middleware.ts` dependen directamente del modelo SSR/cookies.
- varias rutas bajo `app/api/*` combinan validación, auth, acceso a Supabase y transformación de respuesta en una sola capa.

### Conclusión de arquitectura

La separación actual no está mal para una web app local-first con Next, pero **no está todavía en el punto ideal para una estrategia multi-runtime web + desktop**.

La buena noticia es que el problema no está en el editor ni en Markdown. El mayor problema está en la capa de servicios.

La refactorización correcta no es "mover todo a Rust", sino partir la app en capas más explícitas:

1. **UI**
2. **Application services / use cases**
3. **Domain / pure logic**
4. **Infrastructure adapters**
   - web/Next/Supabase/HTTP
   - desktop/Tauri/filesystem/local secure storage

### Veredicto corto

- **Editor/Markdown**: bien separado y reutilizable.
- **Lógica pura de dominio**: aceptable, con buena base.
- **Servicios y transporte**: todavía demasiado acoplados a Next y Supabase.
- **Auth/sync/publicación/AI remota**: deben extraerse como servicios explícitos antes o durante la migración desktop.

---

## Sugerencias de implementación

La migración a desktop **no** debe empezar con una refactor masiva abstracta del codebase, pero **sí** debe introducir una separación táctica de servicios antes de depender de Tauri como runtime principal.

### Recomendación principal

Antes de implementar desktop en serio, la UI debe dejar de depender directamente de:

- `fetch("/api/...")`
- `createClient()` / `createAdminClient()` dispersos por features
- el modelo SSR/cookies/middleware de Next como backend implícito

La UI debe empezar a depender de interfaces de servicio explícitas.

### Qué separar primero

Estas interfaces son las primeras candidatas:

- `DocumentService`
  - abrir
  - guardar
  - listar
  - renombrar
  - exportar
- `AIService`
  - improve text
  - title suggestions
  - publication review
- `SyncService`
  - push/pull
  - backup remoto
  - sincronización entre dispositivos
- `AuthService`
  - login/logout
  - sesión
  - estado de cuenta
- `SharingService` / `PublishingService`
  - publicación
  - shared access
  - invitaciones
- `AssetService`
  - imágenes
  - adjuntos
  - resolución de rutas o subida remota según el runtime

### Qué NO hacer primero

No conviene:

- reescribir todo el backend antes de probar desktop
- abstraer absolutamente todas las rutas API de golpe
- sustituir Supabase en toda la app antes de tener seams claros
- pausar el producto para una limpieza arquitectónica total sin entregables intermedios

Eso convertiría la migración en una refactor larga, costosa y difícil de validar.

### Estrategia recomendada por etapas

#### Etapa 1 — extraer seams

Extraer contratos de servicio sin cambiar el comportamiento actual del producto.

Ejemplo:

- la UI deja de llamar `fetch("/api/writings/...")`
- la UI llama `documentService.save(...)`
- la implementación web actual sigue usando Next/Supabase por debajo

#### Etapa 2 — adapters web

Crear implementaciones explícitas para el runtime actual:

- `WebDocumentService`
- `CloudAIService`
- `SupabaseSyncService`
- `WebAuthService`

Esto permite mantener la web funcionando sin una migración radical inmediata.

#### Etapa 3 — adapters desktop

Implementar variantes específicas para desktop:

- `TauriDocumentService`
- `TauriAssetService`
- `TauriSettingsService`
- `CloudSyncService`
- `CloudAIService` o `LocalAIService` según el caso

#### Etapa 4 — convergencia

Con la UI consumiendo contratos estables, web y desktop pueden divergir en infraestructura sin divergir en el modelo documental ni en la semántica del editor.

### Criterio de prioridad

Si solo se hace una mejora arquitectónica antes de desktop, debe ser esta:

> eliminar la dependencia directa del frontend a `/api/...` y reemplazarla por servicios explícitos.

Ese cambio genera el mayor retorno porque:

- reduce el acoplamiento a Next
- permite runtime web y desktop con la misma UI
- aclara qué vive en local/Rust y qué vive en nube
- prepara la app para mover capacidades sin reescribir cada pantalla

### Principio final

La meta no es "mejor arquitectura" en abstracto.

La meta es:

- mantener `.md` como contrato documental estable
- permitir dos runtimes distintos
- separar filesystem local de servicios remotos
- mover solo las responsabilidades correctas a Rust

Desktop debe apoyarse en una separación de servicios suficiente para avanzar con seguridad, no en una refactor completa previa del producto.

---

## Tauri vs Electron

La decisión de shell no es el centro del problema.

Si desktop es realmente file-based first y markdown-first, la arquitectura encaja especialmente bien con Tauri:

- mejor encaje con filesystem como caso base
- shell más liviano
- menos necesidad de reproducir un backend Node completo

Electron sigue siendo válido si la implementación necesita un runtime Node más fuerte o si ciertas integraciones de escritorio lo hacen más pragmático.

Regla:

- primero definir el contrato documental y operacional desktop
- después elegir la shell final

No al revés.

---

## No objetivos

Desktop no debe diseñarse como:

- una copia empaquetada del runtime web actual
- una app que requiere red para existir
- una app cuya verdad viva en Supabase
- una app que soporte formato arbitrario imposible de round-tripear a Markdown
- una app que convierta el `.md` en un dialecto excesivamente propietario

---

## Criterio de implementación futura

Cuando se implemente la Desktop App, estas decisiones deben gobernar:

1. `.md` es la fuente de verdad del writing.
2. `.txt` es compatibilidad, no formato canónico equivalente.
3. El perfil Markdown es compartido entre web y desktop.
4. TipTap es vista rica del `.md`, no fuente de verdad paralela.
5. El filesystem local define el write-path principal.
6. Sync, backup, publishing y sharing son capacidades secundarias.
7. Auth en desktop es opcional al arranque.
8. Toda expansión del formato debe justificarse contra legibilidad, portabilidad y utilidad para AI.

---

## Relación con el estado actual del código

Hoy el runtime web aún persiste `body_json` como fuente interna principal. Sin embargo, el código ya demuestra varias bases correctas para esta transición:

- TipTap ya serializa a Markdown.
- existe modo source real
- existe round-trip controlado
- el subconjunto soportado ya está delimitado por extensiones y normalización

Por lo tanto, la implementación desktop no parte de cero. Parte de una base existente que ya restringe el editor a lo que Markdown puede sostener razonablemente.

La tarea futura no es inventar el formato. Es convertir el perfil actual en el contrato canónico de persistencia.
