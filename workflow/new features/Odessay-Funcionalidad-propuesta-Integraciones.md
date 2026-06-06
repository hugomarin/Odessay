# Funcionalidad propuesta: enviar writings y anotaciones a Linear / Notion

## 1. Tesis de producto

Odessay puede permitir enviar writings, selecciones o anotaciones hacia herramientas externas como Linear o Notion.

La idea no es convertir Odessay en un hub genérico de integraciones, sino permitir que el pensamiento capturado en un texto llegue al sistema donde debe vivir.

> Convertir una anotación en tarea. Guardar una nota en una base de conocimiento.

## 2. Casos de uso

### Linear

Para convertir una anotación, selección o idea en una tarea o issue.

Ejemplo:

```txt
Anotación:
“Esto hay que convertirlo en una regla del skill de refactor.”

Send to Linear:
Issue title: Add refactor skill rule for transition states
Description: incluye fragmento seleccionado, nota y link de vuelta a Odessay.
```

### Notion

Para guardar una anotación, nota o writing en una knowledge base.

Ejemplo:

```txt
Anotación:
“Este argumento conecta con la tesis de Context Workspace.”

Send to Notion:
Página en Research Notes con título, fragmento, nota, tags y source link.
```

## 3. Niveles de complejidad

### Nivel 1 — Export simple

```txt
Send to Linear
Send to Notion
```

Crea un issue o una página. Guarda un link de referencia.

Complejidad baja-media.

### Nivel 2 — Integración con plantilla

```txt
Send as bug
Send as task
Send as research note
Send as product idea
```

Complejidad media.

### Nivel 3 — Sync real

```txt
- Estado bidireccional.
- Webhooks.
- Comentarios sincronizados.
- Actualizaciones automáticas.
```

Complejidad alta. No recomendado para MVP.

## 4. MVP recomendado

```txt
Seleccionar texto o anotación
↓
Send to...
↓
Linear / Notion
↓
Odessay genera draft
↓
Usuario confirma
↓
Se crea item externo
↓
Odessay guarda externalReference
```

Regla:

```txt
Crear afuera y guardar link. No hacer sync bidireccional en MVP.
```

## 5. Modelo de datos

```ts
type ExternalReference = {
  id: string;
  annotationId?: string;
  writingId?: string;
  provider: "linear" | "notion";
  externalId: string;
  externalUrl: string;
  title: string;
  createdAt: string;
  createdBy: string;
};
```

## 6. Linear: alcance inicial

Crear issue con:

```txt
teamId
title
description
label opcional
project opcional
priority opcional
```

### Ejemplo de issue

```txt
Title:
Revisar framing del harness como sistema operativo del agente

Description:
Fragmento seleccionado:
“descompone el harness en palancas técnicas...”

Nota:
¿Cuántos son configurables en práctica? Necesito datos concretos.

Source:
Odessay document: El harness como sistema operativo del agente
```

## 7. Notion: alcance inicial

Crear página en una database o página elegida.

Campos:

```txt
title
source document
selected text
annotation body
tags
createdAt
source link
```

### Decisión importante

Notion requiere mapear propiedades de una database. Esto puede complicar el MVP.

Opción simple:

```txt
Crear página hija bajo una página elegida.
```

Opción más potente:

```txt
Crear item en database elegida con property mapping.
```

Recomendación MVP:

```txt
Primero página simple.
Después database mapping.
```

## 8. OAuth vs API keys

### OAuth

Recomendado para integración multiusuario real.

Pros:

```txt
- Mejor UX.
- Más seguro.
- Revocable.
- Adecuado para SaaS.
```

Contras:

```txt
- Más complejo.
```

### API key / token manual

Útil para prototipo o uso personal.

Pros:

```txt
- Más rápido.
```

Contras:

```txt
- Menos elegante.
- Más riesgo de seguridad.
- Peor UX.
```

Recomendación:

```txt
MVP real de producto: OAuth.
Prototipo interno: token manual.
```

## 9. UI propuesta

Acción desde anotación:

```txt
Send to...
- Linear
- Notion
```

Desde writing:

```txt
Share
Export
Send to Linear
Send to Notion
```

Desde selección:

```txt
Create annotation
Send to Linear
Send to Notion
```

## 10. Draft modal antes de enviar

No enviar directo sin revisión.

### Linear draft

```txt
Create Linear issue

Team: [Product]
Project: [Odessay]
Title: [editable]
Description: [editable]
Labels: [optional]

[Cancel] [Create issue]
```

### Notion draft

```txt
Send to Notion

Destination: [Research Notes]
Title: [editable]
Body: [editable]
Tags: [optional]

[Cancel] [Create page]
```

## 11. Guardar referencia externa

Después de crear el item externo:

```txt
- Guardar externalReference.
- Mostrar link en Odessay.
- Permitir abrir en Linear/Notion.
```

Ejemplo en annotation:

```txt
Sent to Linear: ODE-123
```

Ejemplo en writing:

```txt
External references
- Linear: ODE-123
- Notion: Research Note
```

## 12. Qué no construir al inicio

```txt
- Sync bidireccional.
- Webhooks.
- Importar comentarios.
- Crear dashboards.
- Actualizar status automáticamente.
- Mapear todas las propiedades de Notion.
- Convertir Odessay en panel de integraciones.
```

## 13. Issues sugeridos para Linear

### Issue 1 — Add external references model

Crear modelo `ExternalReference`.

Criterios:

```txt
- provider.
- externalId.
- externalUrl.
- title.
- relation con annotation o writing.
```

### Issue 2 — Add Send to menu

Agregar acción `Send to...` en anotaciones, selección y writing preview.

Criterios:

```txt
- Mostrar Linear si integración conectada.
- Mostrar Notion si integración conectada.
- Mostrar connect prompt si no está conectada.
```

### Issue 3 — Add Linear OAuth integration

Conectar cuenta Linear.

Criterios:

```txt
- OAuth.
- Guardar tokens de forma segura.
- Listar workspaces/teams.
- Revocar conexión.
```

### Issue 4 — Create Linear issue from annotation

Crear issue desde anotación o selección.

Criterios:

```txt
- Draft editable.
- Seleccionar team.
- Crear issue.
- Guardar externalReference.
```

### Issue 5 — Add Notion OAuth integration

Conectar workspace Notion.

Criterios:

```txt
- OAuth.
- Seleccionar página/database destino.
- Guardar tokens seguros.
- Revocar conexión.
```

### Issue 6 — Create Notion page from annotation

Crear página en Notion desde anotación o selección.

Criterios:

```txt
- Draft editable.
- Destination picker.
- Crear page.
- Guardar externalReference.
```

### Issue 7 — Add external reference display

Mostrar referencias externas en annotation/writing.

Criterios:

```txt
- Mostrar provider.
- Mostrar title/id.
- Link para abrir.
```

## 14. Prioridad recomendada

### P0

```txt
1. ExternalReference model.
2. Send to menu.
3. Linear create issue.
```

### P1

```txt
4. Linear OAuth.
5. Notion create page.
6. Notion OAuth.
```

### P2

```txt
7. Templates.
8. Notion database mapping.
9. Webhooks/sync.
```

## 15. Principio final

> No es “conectar apps”. Es mover una idea desde el texto hacia el sistema donde debe vivir.

Para Odessay:

```txt
Convertir anotación en tarea → Linear
Guardar anotación como conocimiento → Notion
```
