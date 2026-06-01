# ODESSAY — Desktop Migration Plan

**Plan técnico de migración hacia la arquitectura multi-runtime de Odessay.**
Lee `workflow/context/features/odessay-desktop-app.md` para la dirección de producto, `workflow/context/features/odessay-desktop-migration-diagnostic.md` para el diagnóstico del codebase actual y `workflow/context/features/odessay-desktop-target-architecture.md` para la arquitectura objetivo.

Este documento responde: **en qué orden conviene cambiar el sistema para llegar a desktop sin convertir el proceso en una refactor abstracta, riesgosa o interminable**.

---

## Rol de este documento

La secuencia documental de desktop queda así:

1. `odessay-desktop-app.md`
2. `odessay-desktop-migration-diagnostic.md`
3. `odessay-desktop-target-architecture.md`
4. `odessay-desktop-migration-plan.md`

Este documento no redefine la arquitectura. Traduce la arquitectura objetivo en:

- fases
- dependencias
- entregables
- riesgos
- criterios de salida

---

## Objetivo del plan

La meta no es “tener desktop” lo más rápido posible.

La meta es esta:

> mover Odessay a una arquitectura donde web, desktop y futuro mobile compartan core de producto, mientras la infraestructura de cada runtime queda encapsulada en adapters explícitos.

Eso implica dos restricciones:

1. no tocar código en todos lados a la vez
2. no introducir abstracciones prematuras sin un flujo concreto que las justifique

---

## Principios de ejecución

### 1. Primero seams, después runtimes

Antes de introducir Tauri o Electron, la UI debe dejar de depender directamente de `fetch("/api/...")`, cookies SSR implícitas y detalles concretos de Supabase.

### 2. Primero write-path, después capacidades secundarias

El primer foco no es auth, billing o sharing.

El primer foco es:

- abrir documento
- guardar documento
- sincronizar cambios
- fijar el contrato documental

### 3. Primero contratos, después reemplazos

No conviene “migrar a filesystem” sustituyendo todo de una vez.

Conviene:

- definir `DocumentService`
- adaptar la web a ese contrato
- luego implementar adapter desktop

### 4. El contrato documental es un gate estructural

No conviene avanzar hacia desktop real mientras la relación entre:

- `.md`
- `body_json`
- serializer canónico
- caches derivadas

siga ambigua.

---

## Resumen de fases

| Fase | Objetivo principal | Resultado |
|---|---|---|
| Fase 1 | Extraer el write-path del frontend | UI deja de depender directo de `/api/writings` |
| Fase 2 | Extraer sync como servicio explícito | cola, retry e hydration quedan desacoplados del transporte web |
| Fase 3 | Fijar contrato documental compartido | `.md`, serializer y derivaciones quedan definidos y testeados |
| Fase 4 | Extraer AI y auth de la UI | endpoints internos dejan de ser dependencia directa del producto |
| Fase 5 | Introducir adapters desktop | filesystem, índice local y secure storage |
| Fase 6 | Integrar capacidades remotas en desktop | sync, AI, sharing, publishing como capacidades secundarias |
| Fase 7 | Elegir y conectar shell desktop | Tauri o Electron sobre una arquitectura ya preparada |

---

## Fase 1 — Extraer el write-path del frontend

### Objetivo

Hacer que el flujo de guardar writings deje de estar acoplado directamente a:

- `fetch("/api/writings/...")`
- componentes grandes
- detalles del runtime web

### Alcance

- introducir `DocumentService`
- identificar un primer flujo de save
- hacer que la UI consuma ese contrato en vez de transporte directo

### Entregables

- contrato `DocumentService`
- implementación web inicial
- primer flujo de save usando ese servicio
- documentación del contrato

### Áreas afectadas

- `components/editor/editor-shell.tsx`
- `lib/sync/queue.ts`
- `lib/sync/remote-bootstrap.ts`
- `app/api/writings/*`

### No objetivos

- migrar aún a filesystem desktop
- rediseñar toda la UI
- reescribir todos los route handlers

### Riesgos

- abstraer demasiado pronto sin un caso de uso concreto
- mover demasiada lógica del editor en una sola iteración

### Criterio de salida

La UI puede guardar un writing sin construir ni conocer un `fetch("/api/writings/...")` directamente.

---

## Fase 2 — Extraer sync como servicio explícito

### Objetivo

Convertir sync en una capacidad de aplicación e infraestructura separada del transporte web.

### Alcance

- introducir `SyncService`
- separar cola, retry e hydration del mecanismo HTTP actual
- reducir dependencia directa de `window`, `navigator`, `fetch("/api/...")`

### Entregables

- contrato `SyncService`
- adapter web inicial de sync
- worker y bootstrap reubicados detrás del contrato

### Áreas afectadas

- `lib/sync/worker.ts`
- `lib/sync/queue.ts`
- `lib/sync/remote-bootstrap.ts`
- `lib/collections/remote-bootstrap.ts`

### No objetivos

- resolver ya sync por archivos
- introducir conflictos complejos multi-device

### Riesgos

- intentar resolver desktop sync completo antes del contrato
- mezclar sync documental futuro con el sync remoto actual web

### Criterio de salida

La aplicación puede pedir push/pull/hydration sin conocer el adapter web concreto que hoy usa Next + Supabase.

---

## Fase 3 — Fijar el contrato documental compartido

### Objetivo

Definir la relación canónica entre:

- `.md`
- TipTap / representación rica derivada
- `body_json`
- export/import

### Alcance

- decidir serializer canónico
- decidir si `body_json` queda como derivado, caché o persistencia transitoria
- formalizar tests de round-trip

### Entregables

- definición canónica del perfil Markdown
- contrato serializer/parser compartido
- tests de round-trip
- decisión explícita sobre el rol futuro de `body_json`

### Áreas afectadas

- `lib/import/*`
- `lib/export/*`
- `lib/editor/*`
- `workflow/context/features/odessay-prosemirror-tiptap.md`
- `workflow/context/core/odessay-modelo-datos.md`

### No objetivos

- mover todavía toda la persistencia web a `.md`
- rediseñar toda la capa local-first

### Riesgos

- empujar desktop sin resolver este punto
- dejar dos serializadores “más o menos equivalentes” sin gate formal

### Criterio de salida

Existe una respuesta explícita, testeada y documentada sobre cuál es el contrato documental compartido y cómo se relaciona con la representación rica.

---

## Fase 4 — Extraer AI y auth de la UI

### Objetivo

Convertir AI y auth en servicios explícitos del producto, no en dependencias directas del runtime web.

### Alcance

- introducir `AIService`
- introducir `AuthService`
- desacoplar UI de `/api/ai/*`, `/api/user/*` y flows directos de Supabase Auth

### Entregables

- contratos `AIService` y `AuthService`
- adapters web iniciales
- documentación de capacidades opcionales en desktop

### Áreas afectadas

- `components/settings/*`
- `components/auth/*`
- `lib/corrections/persistence.ts`
- `app/api/ai/*`
- `app/api/user/*`

### No objetivos

- rediseñar cuenta o billing
- introducir auth desktop final

### Riesgos

- intentar resolver todos los flows de cuenta en el mismo bloque
- mezclar auth de desktop con sesión SSR web demasiado pronto

### Criterio de salida

AI y auth dejan de ser acoplamientos directos de la UI a endpoints internos o a Supabase browser client.

---

## Fase 5 — Introducir adapters desktop

### Objetivo

Crear infraestructura desktop explícita sobre contratos ya existentes.

### Alcance

- `FilesystemDocumentService`
- índice local derivado
- `SettingsService` desktop
- secure credential storage
- asset handling local

### Entregables

- adapter de documentos sobre filesystem
- adapter local de settings
- estrategia de índice local
- estrategia de assets locales

### Áreas afectadas

- capa nueva de adapters desktop
- integración con document engine
- persistencia local derivada

### No objetivos

- conectar aún todas las capacidades remotas
- resolver todas las features colaborativas

### Riesgos

- intentar montar desktop shell antes de tener adapters listos
- convertir SQLite otra vez en fuente de verdad en vez de índice derivado

### Criterio de salida

Desktop puede abrir, crear, editar y guardar writings localmente sobre `.md` sin login y sin depender del runtime web.

---

## Fase 6 — Integrar capacidades remotas en desktop

### Objetivo

Agregar capacidades de nube como extensiones del producto desktop, no como prerequisito para su existencia.

### Alcance

- sync remoto
- backup
- sharing
- publishing
- AI remota

### Entregables

- conexión de `SyncService` desktop -> nube
- conexión de `AIService` desktop -> nube o local/BYOK
- conexión de `SharingService` y `AuthService`

### No objetivos

- colaboración en tiempo real
- merge automático de documentos

### Riesgos

- volver a hacer que guardar dependa de red
- arrastrar supuestos del runtime web actual

### Criterio de salida

Desktop mantiene su write-path local aunque fallen auth, sync o AI.

---

## Fase 7 — Elegir y conectar shell desktop

### Objetivo

Montar el runtime final cuando la arquitectura ya soporte desktop de forma natural.

### Alcance

- evaluación final Tauri vs Electron
- integración con adapters desktop
- packaging
- testing del shell

### Entregables

- decisión final de shell
- build funcional desktop
- validación de flows core en el bundle de producción (no solo en `tauri dev`)

### No objetivos

- usar la shell como excusa para resolver arquitectura pendiente

### Riesgos

- elegir shell demasiado pronto
- condicionar la arquitectura a una API específica del shell
- asumir que lo que funciona en `tauri dev` funciona en el DMG distribuido (son entornos distintos — ver `odessay-desktop-migration-diagnostic.md §Diferencias entre tauri dev y tauri build`)

### Prerequisitos de merge para cualquier issue de Fase 7

Todo PR de Fase 7 debe validarse contra el bundle de producción antes de mergear:

1. **Bifurcación `isTauriBuild` en toda página `(app)` nueva con server auth.** Sin esto, `redirect("/login")` se bake en el RSC payload del static export y la página bouncea al usuario aunque haya sesión. Ver patrón en `app/(app)/layout.tsx`, `app/(app)/write/[id]/page.tsx`, `app/(app)/settings/account/page.tsx`.

2. **CI parity validation (ODE-225) debe estar Done** antes de cerrar Fase 7. Valida que las capacidades del bundle de producción son idénticas a las de `tauri dev`. No es un issue de cierre opcional — es el gate de calidad de toda la fase.

3. **DevTools habilitado** (`tauri = { features = ["devtools"] }` en `Cargo.toml`) mientras Fase 7 esté abierta. Sin acceso a consola en el DMG, los bugs son indiagnosticables.

### Criterio de salida

La shell solo hospeda el producto; no define el core ni fuerza la estructura del sistema. El DMG distribuido es usable como app real, no solo como salida del comando `tauri build`.

---

## Dependencias entre fases

```text
Fase 1 (DocumentService)
   ↓
Fase 2 (SyncService)
   ↓
Fase 3 (Contrato documental)
   ↓
Fase 4 (AI/Auth services)
   ↓
Fase 5 (Desktop adapters)
   ↓
Fase 6 (Remote capabilities in desktop)
   ↓
Fase 7 (Shell)
```

### Matiz importante

La Fase 3 puede empezar en paralelo parcial con Fase 2, pero no debería cerrarse después de iniciar desktop real. Es un gate estructural.

---

## Primeros refactors recomendados

Cuando llegue el momento de tocar código, el orden recomendado es:

1. introducir `DocumentService`
2. mover el flujo principal de save del editor a ese contrato
3. introducir `SyncService`
4. encapsular hydration remota y retry detrás del contrato
5. fijar serializer/parser canónico

Este orden existe porque reduce riesgo y mantiene la app usable durante la transición.

---

## Riesgos globales del programa

### Riesgo 1 — Refactor abstracta sin entregables

Si la migración se formula como “limpiar arquitectura” sin seams concretos, se vuelve infinita.

### Riesgo 2 — Introducir desktop shell demasiado pronto

Eso desplaza el problema real: el acoplamiento del producto al runtime web.

### Riesgo 3 — No resolver el contrato documental

Sin esto, desktop se convierte en una adaptación incómoda de `body_json`, no en un producto file-based real.

### Riesgo 4 — Compartir infraestructura en vez de core

Forzar shared code en middleware, cookies, route handlers o APIs del sistema operativo crea más deuda, no menos.

---

## Gates de decisión

Antes de pasar de una fase a la siguiente, conviene validar:

### Gate A — después de Fase 1

¿La UI ya no conoce el transporte directo de writings?

### Gate B — después de Fase 2

¿Sync ya es una capacidad desacoplada del transporte web?

### Gate C — después de Fase 3

¿El contrato documental ya es explícito y testeado?

### Gate D — antes de Fase 5

¿Desktop adapters pueden implementarse sin redefinir dominio ni aplicación?

### Gate E — antes de Fase 7

¿La shell es ya una decisión operativa y no una apuesta arquitectónica?

---

## Definición de éxito

La migración va bien si al final de este plan se puede afirmar:

1. el core del producto no depende de Next, Supabase ni Tauri
2. la UI no depende de `/api/...`
3. desktop puede funcionar offline y sin login
4. sync, AI y sharing son capacidades conectables, no prerequisitos del write-path
5. web y desktop comparten el mismo contrato documental

---

## Qué sigue después de este documento

Después de este plan, el siguiente paso ya sí puede ser trabajo de implementación, pero no de forma difusa.

Los siguientes artefactos recomendados serían uno de estos dos:

- un documento de **execution slices** con los primeros refactors concretos
- o directamente un issue/roadmap técnico por fase empezando por `DocumentService`

Ese punto ya marca el inicio de trabajo sobre código, pero solo después de que este plan esté aceptado.
