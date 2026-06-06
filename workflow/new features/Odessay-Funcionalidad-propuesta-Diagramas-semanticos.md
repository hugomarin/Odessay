# Funcionalidad propuesta: Diagramas semánticos en Odessay

## 1. Tesis de producto

La funcionalidad de diagramas en Odessay debe convertir diagramas torpes, ASCII, Markdown desordenado o descripciones naturales en diagramas visuales claros, editables y semánticamente estables.

La idea central:

> No convertir texto directamente en SVG. Convertir pensamiento visual desordenado en estructura.

El SVG debe ser el output final, no la fuente de verdad.

## 2. Problema que resuelve

Muchos usuarios escriben diagramas así:

```txt
Browser -> NextAuth -> API Gateway -> Skills Runtime -> LLM
Skills Runtime -> Connector Layer -> Postgres
Connector Layer -> Zendesk, Fathom, LogRocket
```

O hacen diagramas ASCII difíciles de mantener:

```txt
+---------+      +----------+
| Browser | ---> | API      |
+---------+      +----------+
```

Problemas:

```txt
- Son visualmente feos.
- Se rompen con espacios y alineación.
- Son difíciles de editar.
- No son semánticamente estables.
- No se pueden exportar bien.
- El significado se pierde si se convierten directo a imagen.
```

## 3. Pipeline recomendado

No hacer:

```txt
ASCII -> LLM -> SVG
```

Hacer:

```txt
ASCII / Markdown / descripción natural
↓
LLM extractor
↓
Diagram AST / JSON semántico
↓
Generador D2
↓
D2 render
↓
SVG
↓
Componente visual en Odessay
```

La fuente de verdad debería ser una representación intermedia propia.

## 4. Por qué no generar SVG directo

Generar SVG directo con IA puede producir algo visualmente atractivo, pero frágil.

Riesgos:

```txt
- El modelo inventa relaciones.
- Se pierde jerarquía.
- Es difícil editar.
- Es difícil versionar.
- No se puede exportar a otros formatos.
- No hay forma estable de validar nodos y conexiones.
```

Regla:

```txt
SVG = output.
Diagram AST = source of truth.
```

## 5. Representación intermedia

Modelo sugerido:

```ts
type DiagramNode = {
  id: string;
  label: string;
  description?: string;
  groupId?: string;
  metadata?: Record<string, string>;
};

type DiagramGroup = {
  id: string;
  label: string;
  description?: string;
};

type DiagramEdge = {
  from: string;
  to: string;
  label?: string;
  type?: "default" | "dependency" | "data_flow" | "auth" | "read_only";
};

type DiagramAst = {
  title?: string;
  type: "architecture" | "flow" | "concept_map";
  groups: DiagramGroup[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};
```

## 6. Ejemplo de AST

```json
{
  "title": "Clarity app architecture",
  "type": "architecture",
  "groups": [
    {
      "id": "browser",
      "label": "Browser / PM workstation"
    },
    {
      "id": "app",
      "label": "Clarity app"
    },
    {
      "id": "external",
      "label": "Read-only external connectors"
    }
  ],
  "nodes": [
    {
      "id": "google_sso",
      "label": "Google Workspace SSO",
      "groupId": "browser"
    },
    {
      "id": "nextauth",
      "label": "NextAuth 4",
      "groupId": "browser"
    },
    {
      "id": "api_gateway",
      "label": "API gateway",
      "groupId": "app"
    },
    {
      "id": "skills_runtime",
      "label": "Skills runtime",
      "groupId": "app"
    },
    {
      "id": "llm",
      "label": "LLM",
      "groupId": "app"
    }
  ],
  "edges": [
    {
      "from": "google_sso",
      "to": "nextauth"
    },
    {
      "from": "nextauth",
      "to": "api_gateway",
      "label": "HTTPS"
    },
    {
      "from": "api_gateway",
      "to": "skills_runtime"
    },
    {
      "from": "skills_runtime",
      "to": "llm"
    }
  ]
}
```

## 7. D2 como motor de render

D2 es una buena opción para diagramas técnicos porque permite:

```txt
- Declarar nodos y relaciones.
- Agrupar elementos.
- Renderizar automáticamente.
- Exportar SVG.
- Mantener código textual versionable.
- Representar arquitectura de software mejor que Mermaid en muchos casos.
```

D2 no interpreta ASCII por sí solo. D2 renderiza código D2.

La IA convierte ASCII/texto a estructura. Odessay convierte estructura a D2. D2 renderiza SVG.

## 8. Ejemplo de D2 generado

```d2
direction: down

browser: "Browser / PM workstation" {
  direction: right

  google: "Google Workspace SSO"
  nextauth: "NextAuth 4\nOAuth 2.0 + JWT"

  google -> nextauth
}

app: "Clarity app\nNext.js 16, Node 20, Dokploy" {
  direction: down

  flow: {
    direction: right

    chat: "Chat UI"
    gateway: "API gateway\nrate limit\nauth check"
    skills: "Skills runtime\ntoken budget\ncontext build"
    llm: "LLM"

    chat -> gateway -> skills -> llm
  }

  data: {
    direction: down

    connector: "Connector layer\nPII redaction"
    postgres: "Postgres\nRLS + app wrapper\nconversations, runs\naudit log"

    connector -> postgres
  }

  flow.skills -> data.connector
}

external: "Read-only external connectors" {
  direction: right

  zendesk: "Zendesk Support\nread-only API token"
  fathom: "Fathom Calls\nread-only API token"
  logrocket: "LogRocket Sessions\nread-only Bearer / MCP"
  sprig: "Sprig Surveys\nread-only bearer"
  openai: "OpenAI Web\nread-only API token"
}

browser.nextauth -> app.flow.gateway: "HTTPS\nCloudflare TLS\nTraefik ingress"

app.data.connector -> external.zendesk
app.data.connector -> external.fathom
app.data.connector -> external.logrocket
app.data.connector -> external.sprig
app.data.connector -> external.openai
```

## 9. API interna de Odessay

D2 no necesita tener una API hosted oficial. Odessay puede montar su propia API.

### Endpoint sugerido

```txt
POST /api/diagrams/render
```

Body:

```json
{
  "source": "x -> y -> z",
  "engine": "d2",
  "format": "svg"
}
```

Response:

```json
{
  "svg": "<svg>...</svg>",
  "source": "x -> y -> z",
  "warnings": []
}
```

## 10. Render con D2 CLI

Backend conceptual:

```ts
import { spawn } from "node:child_process";

export async function renderD2(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const d2 = spawn("d2", ["-", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let svg = "";
    let err = "";

    d2.stdout.on("data", chunk => (svg += chunk));
    d2.stderr.on("data", chunk => (err += chunk));

    d2.on("close", code => {
      if (code === 0) resolve(svg);
      else reject(new Error(err || `D2 exited with code ${code}`));
    });

    d2.stdin.write(source);
    d2.stdin.end();
  });
}
```

## 11. Seguridad y límites

No ejecutar render sin límites.

Recomendaciones:

```txt
- Timeout por render.
- Tamaño máximo de input.
- Sanitizar SVG antes de insertar en DOM.
- Cache por hash del source.
- Rate limit.
- Preview debounced para no renderizar cada tecla.
```

### SVG en React

```tsx
export function DiagramPreview({ svg }: { svg: string }) {
  return (
    <div
      className="diagram-preview"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
```

Antes de usar `dangerouslySetInnerHTML`, sanitizar SVG.

## 12. UX propuesta

### Acción principal

```txt
Convert to diagram
```

O más específico:

```txt
Convert textual diagram
Generate structured diagram
Clarify diagram
```

### Flujo

```txt
Usuario pega ASCII / bullets / descripción
↓
Odessay detecta posible diagrama
↓
Ofrece convertirlo
↓
IA extrae estructura
↓
Odessay muestra revisión
↓
Usuario aprueba/corrige nodos y relaciones
↓
Se genera D2
↓
D2 renderiza SVG
```

## 13. Tabla de revisión semántica

Antes de renderizar, Odessay debería mostrar una revisión.

```txt
Detected diagram: architecture
Found 12 nodes, 3 groups, 11 connections.

Groups:
- Browser / PM workstation
- Clarity app
- External connectors

Relations:
- Google Workspace SSO -> NextAuth 4
- Chat UI -> API gateway
- API gateway -> Skills runtime
- Skills runtime -> LLM
```

Acciones:

```txt
Approve
Edit structure
Edit D2
Cancel
```

## 14. Edición

Tres niveles posibles:

```txt
1. Visual preview
2. D2 source
3. Semantic structure
```

### Para usuarios técnicos

Permitir editar D2.

### Para usuarios no técnicos

Permitir editar:

```txt
- Nodos
- Grupos
- Relaciones
- Labels
```

## 15. Formatos de export

MVP:

```txt
SVG
PNG
D2 source
Markdown block
```

Futuro:

```txt
Mermaid
Excalidraw
PDF
React Flow
```

## 16. Mermaid vs D2

### Mermaid

Bueno para:

```txt
- Flowcharts simples.
- Sequence diagrams.
- State diagrams.
- Compatibilidad Markdown.
```

### D2

Bueno para:

```txt
- Arquitectura técnica.
- Sistemas con contenedores.
- Nodos agrupados.
- Relaciones menos rígidas.
- Visual más moderno.
```

### Recomendación

```txt
D2 como motor principal para arquitectura técnica.
Mermaid como import/export opcional.
SVG como output visual.
Diagram AST como source of truth.
```

## 17. Tipos de diagramas iniciales

No intentar soportar todo desde el inicio.

MVP:

```txt
Architecture diagram
Process flow
Concept map
```

Postergar:

```txt
ERD
UML completo
Cloud architecture compleja
Mindmaps avanzados
C4 completo
```

## 18. Integración con Markdown

Bloque posible:

```md
```odessay-diagram
{
  "type": "architecture",
  "nodes": [],
  "edges": []
}
```

```

O:

```md
```d2
x -> y -> z
```

```

O una sintaxis más amigable:

```md
```diagram
Browser -> NextAuth -> API Gateway
API Gateway -> Skills Runtime -> LLM
```

```

Recomendación:

```txt
Guardar AST propio.
Permitir ver/exportar D2.
Renderizar SVG en editor.
```

## 19. AI behavior

La IA debe ser conservadora.

Reglas:

```txt
- No inventar relaciones no presentes.
- Marcar relaciones inferidas como uncertain.
- Separar nodos de metadata.
- Distinguir grupos de elementos.
- Pedir revisión si hay ambigüedad.
```

Output recomendado:

```ts
type DiagramExtractionResult = {
  ast: DiagramAst;
  uncertainNodes?: string[];
  uncertainEdges?: DiagramEdge[];
  warnings?: string[];
};
```

## 20. MVP recomendado

```txt
1. Crear endpoint de render D2 -> SVG.
2. Crear parser/generator desde DiagramAst -> D2.
3. Crear UI para pegar diagram text.
4. Usar LLM para convertir texto/ASCII -> DiagramAst.
5. Mostrar revisión semántica.
6. Renderizar SVG.
7. Guardar AST + D2 source.
8. Exportar SVG.
```

## 21. Issues sugeridos para Linear

### Issue 1 — Add Diagram AST model

Crear representación intermedia para diagramas.

Criterios:

```txt
- Nodes.
- Groups.
- Edges.
- Metadata.
- Diagram type.
```

### Issue 2 — Add D2 generator from Diagram AST

Convertir AST semántico a código D2.

Criterios:

```txt
- Soportar grupos.
- Soportar edges.
- Soportar labels.
- Soportar direction básica.
```

### Issue 3 — Add D2 render endpoint

Crear endpoint backend que reciba D2 source y devuelva SVG.

Criterios:

```txt
- Usar D2 CLI o render service.
- Timeout.
- Error handling.
- Cache por hash.
```

### Issue 4 — Add SVG sanitization for diagram previews

Sanitizar SVG antes de renderizarlo en React.

Criterios:

```txt
- Prevenir scripts.
- Whitelist de tags/attrs.
- Seguro para insertar en DOM.
```

### Issue 5 — Add AI diagram extraction

Crear endpoint que convierta ASCII/Markdown/descripción en Diagram AST.

Criterios:

```txt
- Output JSON estructurado.
- Marcar ambigüedad.
- No inventar relaciones.
- Soportar architecture/process/concept map.
```

### Issue 6 — Add diagram review UI

Mostrar nodos, grupos y relaciones detectadas antes de renderizar.

Criterios:

```txt
- Editar suggested labels.
- Eliminar nodos.
- Editar relaciones.
- Aprobar estructura.
```

### Issue 7 — Add diagram block to editor

Permitir insertar y renderizar diagramas dentro del writing.

Criterios:

```txt
- Guardar AST/source.
- Renderizar SVG.
- Abrir editor de diagrama.
- Exportar.
```

### Issue 8 — Add Mermaid export

Permitir exportar diagramas simples a Mermaid.

Criterios:

```txt
- Usar AST como fuente.
- Soportar flowcharts básicos.
- Mostrar warning si no se puede representar algo.
```

## 22. Prioridad recomendada

### P0

```txt
1. Diagram AST.
2. D2 generator.
3. D2 render endpoint.
4. Diagram preview component.
```

### P1

```txt
5. AI extraction.
6. Review UI.
7. Editor block.
```

### P2

```txt
8. Mermaid export.
9. Excalidraw export.
10. Visual editor.
```

## 23. Principio final

> Odessay no debe vender “diagramas bonitos”. Debe vender diagramas legibles desde pensamiento desordenado.

La promesa:

> Pega un diagrama torpe, una arquitectura escrita o una explicación desordenada. Odessay extrae la estructura, conserva las relaciones y la convierte en un diagrama editable.
