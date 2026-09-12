# Addendum — instrumentar también `classifyWorkspace` en el probe

Contexto: `openai-provider-probe.jsonl` de la corrida anterior solo capturó
llamadas a `/api/ai/workspace-ask`. La tarjeta de clasificación del panel
("Clasificación semántica") mostró `0 seleccionados` y sin evidencia visible
en una corrida, y no hay forma de confirmar si fue porque el modelo no citó
nada verbatim o porque el documento ya estaba en el status propuesto — sin
una traza de esa llamada específica, es una hipótesis, no un hecho.

`classifyWorkspace` llama a `/api/ai/workspace-classification`. Captura esa
llamada exactamente con el mismo método que ya usaste para `workspace-ask`
(lectura del body de red del request/response, no instrumentación de código
— el repo no tiene ningún mecanismo de logging para esto), y agrega una
entrada al mismo `openai-provider-probe.jsonl` por cada llamada, con esta
forma:

**Request** (`type: "openai-classification-request"`):
```json
{
  "type": "openai-classification-request",
  "callId": "<id>",
  "at": "<iso timestamp>",
  "targetDocumentIds": ["..."],
  "documents": [
    {
      "id": "...",
      "title": "...",
      "currentStatus": "...",
      "currentArtifactType": "...",
      "markdownState": "present|null",
      "markdownChars": 0
    }
  ]
}
```

**Response** (`type: "openai-classification-response"`):
```json
{
  "type": "openai-classification-response",
  "callId": "<id>",
  "at": "<iso timestamp>",
  "status": 200,
  "durationMs": 0,
  "result": {
    "summaryPreview": "primeros ~250 caracteres de summary",
    "proposals": [
      {
        "documentId": "...",
        "decision": "change|keep|needs-review",
        "modelEvidenceCount": 0,
        "note": "cuántas citas trae el proposal EN LA RESPUESTA CRUDA del modelo, antes de cualquier verificación de la app"
      }
    ]
  }
}
```

El campo que más importa es `modelEvidenceCount` por proposal — cuenta las
citas que el modelo devolvió en crudo (antes de que la app las verifique
línea por línea contra el markdown real). Compáralo después contra lo que
la UI termina mostrando en el acordeón de esa fila (Evidencia) y contra
`decision`. Si `modelEvidenceCount > 0` pero la fila queda con
`decision: needs-review` y sin evidencia visible, confirma que el motivo es
que ninguna cita hizo match verbatim contra el documento (mecanismo en
`normalizeClassificationProposal`, `lib/services/workspace-agent-service.ts`)
— y en ese caso vale la pena ver el texto exacto de al menos una cita
rechazada para saber si es un problema de formato (comillas, saltos de
línea, markdown) o el modelo simplemente no cita verbatim.

Repite el mismo escenario de la corrida anterior para tener algo comparable:
clasificar un documento vía el botón Classify o vía texto libre
("Classify this document and propose its status"), abrir "Revisar en
contexto", y expandir la fila del documento antes de tomar la captura —
la evidencia solo se muestra ahí, con la fila abierta.
