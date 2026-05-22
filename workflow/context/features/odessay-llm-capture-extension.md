# ODESSAY — LLM Capture Extension

**Documento de referencia para agentes de desarrollo.**
Lee `workflow/context/features/odessay-desktop-app.md`, `workflow/context/features/odessay-editor.md`, `workflow/context/features/odessay-prosemirror-tiptap.md`, `workflow/context/features/odessay-sync.md` y `workflow/context/core/odessay-stack.md` antes de implementar.

Este documento define cómo funcionaría una extensión de navegador para capturar conversaciones de LLM y enviarlas directamente a Odessay como writings o inserciones editoriales.

---

## Propósito

Odessay necesita una forma más rápida que copiar y pegar para incorporar material proveniente de conversaciones con LLMs.

La intención del feature es:

- capturar una conversación completa de ChatGPT o Claude
- transformarla a Markdown compatible con Odessay
- enviarla directamente a Odessay
- crear un writing nuevo o insertarla en uno existente

La experiencia deseada es:

> “Guardar esta conversación en Odessay” con una acción explícita, rápida y no invasiva.

---

## Principio rector

La extensión no debe comportarse como un producto archivador paralelo. Debe comportarse como un **puente de captura** hacia Odessay.

Eso implica:

- no capturar todo automáticamente
- no construir una base de datos paralela de conversaciones como producto final
- no duplicar auth, storage y organización que ya pertenecen a Odessay

La extensión existe para reducir fricción de importación, no para competir con el editor ni con el sistema de writings.

---

## Alcance v1

### Sí entra

- captura **manual** de conversación completa
- activación por **click derecho contextual** y/o shortcut
- soporte inicial para:
  - ChatGPT
  - Claude
- conversión a Markdown compatible con Odessay
- creación de writing nuevo en Odessay

### No entra

- captura automática de cada prompt enviado
- captura continua en background
- dashboard propio de conversaciones como producto principal
- sync propio de la extensión
- auth propia compleja de la extensión
- edición del contenido dentro de la extensión

---

## Decisión principal: manual full conversation only

La variante correcta para Odessay es la **captura manual de conversación completa**.

No conviene portar la captura automática prompt-by-prompt del prototipo existente porque:

- es invasiva
- genera demasiado ruido
- crea un archivo paralelo innecesario
- contradice la naturaleza curada y editorial de Odessay
- complica auth, storage, deduplicación y UX sin aportar suficiente valor al caso de uso principal

La acción correcta es intencional:

- el usuario decide que una conversación merece entrar a Odessay
- la captura ocurre una vez
- el resultado se trata como material de escritura

---

## UX objetivo

### Activación

La captura debe poder activarse por dos vías:

1. **Click derecho contextual**
   - `Guardar conversación en Odessay`
2. **Atajo de teclado**
   - equivalente al comando de captura manual

### Resultado esperado

Al dispararse la captura:

1. la extensión detecta la plataforma actual
2. parsea la conversación completa
3. genera un payload estructurado y Markdown
4. entrega el payload a Odessay
5. Odessay:
   - crea un writing nuevo, o
   - inserta el contenido en un flujo editorial definido

### V1 recomendada

La V1 debe crear un **writing nuevo**.

No conviene empezar con “insertar en writing actual” porque eso exige:

- descubrir el estado del editor activo
- resolver foco entre tabs
- coordinar mejor selección/posición de cursor

Eso puede venir después.

---

## Arquitectura conceptual

```text
Usuario en ChatGPT/Claude
  ↓
Extensión Chrome (acción manual)
  ↓
Content script parsea conversación
  ↓
Payload estructurado + Markdown
  ↓
Odessay autenticado en el navegador
  ↓
Nuevo writing creado con la conversación capturada
```

La extensión no debe ser la fuente de verdad del contenido final. La fuente de verdad sigue siendo Odessay.

---

## Reutilización desde Narratif

Existe un prototipo previo en el proyecto hermano `Narratif` que ya resuelve la parte más frágil: el parseo resiliente de conversaciones desde DOMs cambiantes de ChatGPT y Claude.

### Qué sí reutilizar

Las piezas candidatas a reutilización son:

- configuración por plataforma
  - selectores DOM
  - patrones de URL
  - extracción de IDs
  - limpieza de texto
- parser de conversación completa
- wrappers finos por plataforma
- comando/context menu y patrón de activación

### Qué NO reutilizar como base

No se debe portar como base funcional:

- DB local de la extensión
- dashboard de conversaciones
- sistema de stats/badges
- auto-captura incremental
- modelo de producto de Narratif como archivador

### Lectura correcta del prototipo

Narratif debe usarse como:

- **motor de extracción**

no como:

- producto final o arquitectura completa del feature de Odessay

---

## Payload canónico

La extensión debe entregar un payload estructurado que Odessay pueda validar y convertir de forma determinista.

```ts
type LlmCapturePayload = {
  source: "chatgpt" | "claude";
  mode: "full_conversation";
  conversationId: string | null;
  conversationTitle: string | null;
  conversationUrl: string | null;
  capturedAt: string;
  markdown: string;
  messages: Array<{
    role: "user" | "assistant";
    text: string;
    order: number;
    timestamp: string;
  }>;
};
```

### Regla importante

El campo `markdown` no es opcional ornamental. Es el artefacto editorial principal.

`messages[]` se conserva para:

- trazabilidad
- debug
- posibles mejoras futuras
- generación alternativa de formato

Pero el flujo natural de Odessay debe operar sobre el Markdown resultante.

---

## Formato Markdown de salida

El contenido capturado debe serializarse como Markdown compatible con el perfil actual de Odessay.

Ejemplo de estructura recomendada:

```md
# Conversation from Claude

Source: https://claude.ai/...
Captured: 2026-05-20T18:30:00.000Z

## User

...

## Assistant

...

## User

...
```

### Reglas

- mantener formato legible fuera de Odessay
- no introducir sintaxis propietaria innecesaria
- usar headings y separación simple
- no serializar metadata interna rara dentro del cuerpo

### Metadata mínima permitida

Se permite incluir al inicio:

- platform/source
- URL origen
- timestamp de captura

Eso aporta trazabilidad sin contaminar el documento.

---

## Autenticación

### Principio

La extensión no debe implementar en V1 una autenticación propia compleja ni gestionar directamente credenciales de Supabase.

La estrategia correcta es:

> reutilizar la sesión web existente de Odessay en ese mismo navegador.

### Modelo recomendado

1. El usuario está logueado en Odessay en Chrome.
2. La extensión captura la conversación.
3. La extensión entrega el payload a una superficie autenticada de Odessay.
4. Odessay crea el writing usando su auth normal.

### Qué evita este enfoque

- login separado de la extensión
- guardar tokens dentro de la extensión
- hablar directo con Supabase desde la extensión
- duplicar reglas de auth y permisos fuera de Odessay

### Si no hay sesión

Si el usuario no está autenticado en Odessay:

- Odessay debe llevarlo al login
- después del login, la importación pendiente debe poder retomarse

La retención temporal del payload puede resolverse en una fase inicial con storage efímero del lado de la extensión o con un handoff intermedio.

---

## Handoff extensión -> Odessay

La extensión necesita transferir el payload a Odessay sin depender de query params gigantes ni de un modelo frágil.

### Opción recomendada para V1

Usar una **superficie web de importación** en Odessay y un handoff controlado desde la extensión.

Ejemplo conceptual:

- la extensión abre o enfoca una ruta dedicada en Odessay
  - `/capture/import`
- la extensión entrega el payload a esa superficie
- esa superficie crea el writing

### Reglas del handoff

- no meter el documento completo en query params
- no asumir que el payload cabe en la URL
- no hacer POST directo a endpoints sensibles desde la extensión si la auth aún no está resuelta de forma robusta

### Recomendación de implementación

La forma exacta del handoff puede variar, pero el diseño debe preservar esto:

- la extensión entrega
- Odessay autentica
- Odessay persiste

La extensión no se convierte en writer remoto directo.

---

## Superficie en Odessay

Odessay debe exponer una feature clara para recibir la captura.

### Ruta / pantalla sugerida

`/capture/import`

### Responsabilidades

- validar el payload
- mostrar feedback al usuario
- crear writing nuevo
- redirigir al writing creado

### V1 recomendada

La V1 puede ser minimalista:

- “Importing conversation…”
- crear writing
- abrir editor con el writing recién creado

No hace falta una pantalla compleja de revisión desde el inicio.

---

## Servicio interno sugerido

Odessay debe modelar esta integración como un servicio explícito, no como un parche dentro del editor o una route aislada sin contrato.

### `CaptureImportService`

Responsabilidades:

- validar `LlmCapturePayload`
- normalizar títulos y source metadata
- asegurar compatibilidad Markdown
- crear el writing local/remoto según el runtime
- devolver la identidad del writing creado

### Contrato conceptual

```ts
type CaptureImportResult = {
  writingId: string;
  title: string;
  createdAt: string;
};
```

---

## Seguridad

La extensión debe tener un principio de mínimo alcance.

### Reglas

- solo pedir permisos necesarios
- limitar `host_permissions` a plataformas soportadas
- no capturar páginas arbitrarias
- no guardar el contenido permanentemente en la extensión si no es imprescindible
- no hablar directo con proveedores AI
- no meter lógica de auth sensible dentro de la extensión

### Importante

Esta feature no requiere claves de AI ni secretos del producto dentro de la extensión.

Eso simplifica mucho el diseño y evita mover lógica sensible fuera de Odessay.

---

## Desktop y futuro

Esta feature debe diseñarse primero para el runtime web actual, pero sin cerrarse al futuro desktop.

### Compatibilidad futura deseada

En desktop, el mismo payload debería poder:

- crear un `.md` local nuevo
- anexarse a un writing existente
- entrar al runtime desktop sin pasar necesariamente por la web

Por eso el contrato importante no es el transporte, sino el payload y el Markdown final.

La extensión debe entregar un artefacto que siga siendo útil en web y en desktop.

---

## Qué no debe pasar

No se debe convertir este feature en:

- otro sistema de organización de conversaciones
- un dashboard paralelo a Odessay
- una captura automática de todo lo que escribe el usuario
- una integración frágil basada solo en DOM scraping sin contratos
- una extensión que persiste su propia verdad por largo tiempo

La extensión es un puente editorial. No una segunda app.

---

## Estrategia de implementación recomendada

### Fase 1

- extraer/reutilizar parser de conversación completa desde Narratif
- crear extensión mínima con:
  - context menu
  - shortcut
  - content script por plataforma
- crear superficie `/capture/import` en Odessay
- crear writing nuevo desde payload capturado

### Fase 2

- mejorar feedback UX del import
- soportar más metadatos
- revisar títulos
- harden de autenticación y reanudación post-login

### Fase 3

- soporte de “append to current writing”
- soporte de selección parcial además de conversación completa
- integración desktop si aplica

---

## Decisiones explícitas

1. La feature empieza con **captura manual de conversación completa**.
2. La **auto-captura de prompts** no forma parte del diseño de Odessay.
3. La extensión reutiliza la **sesión web existente** de Odessay para auth.
4. El resultado principal de la captura es **Markdown compatible con Odessay**.
5. El payload estructurado existe como soporte de trazabilidad, no como fuente editorial primaria.
6. El prototipo `Narratif` se reutiliza como **motor de extracción**, no como arquitectura completa.

---

## Criterio de éxito

La implementación es correcta si el usuario puede:

1. estar en ChatGPT o Claude,
2. hacer click derecho `Guardar conversación en Odessay`,
3. quedar en un writing nuevo dentro de Odessay,
4. ver la conversación serializada como Markdown útil,
5. y continuar trabajando desde ahí sin fricción manual adicional.
