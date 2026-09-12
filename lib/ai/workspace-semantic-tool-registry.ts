import type {
  WorkspaceSemanticToolCall,
  WorkspaceSemanticToolDescriptor,
} from "@/lib/services/contracts/ai-service"
import type {
  WorkspaceAgentEvidence,
  WorkspaceAgentEvidenceReadResult,
} from "@/lib/services/contracts/workspace-agent"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"

export const WORKSPACE_SEMANTIC_READ_TOOL_NAME = "read_document_evidence" as const
export const WORKSPACE_SEMANTIC_MAX_EVIDENCE_CHARS = 12_000
export const WORKSPACE_SEMANTIC_MAX_LINE_SPAN = 200

export type WorkspaceSemanticReadArguments = {
  documentId: string
  expectedDocumentVersion: string
  expectedContentHash: string | null
  lineStart: number
  lineEnd: number
  maxChars: number
}

export type WorkspaceSemanticDocumentSnapshot = {
  documentVersion: string
  contentHash: string | null
}

export type WorkspaceSemanticToolResult = {
  evidence: WorkspaceAgentEvidence
  /** Provider-facing output; intentionally excludes canonical paths and approvals. */
  output: string
}

export type WorkspaceSemanticReadEvidenceHandler = (
  input: WorkspaceSemanticReadArguments,
) => Promise<ServiceResponse<WorkspaceAgentEvidenceReadResult>>

export type WorkspaceSemanticValidatedToolCall = {
  callId: string
  name: typeof WORKSPACE_SEMANTIC_READ_TOOL_NAME
  arguments: WorkspaceSemanticReadArguments
}

export type WorkspaceSemanticToolRegistry = {
  descriptors: WorkspaceSemanticToolDescriptor[]
  validateCall(call: WorkspaceSemanticToolCall): ServiceResponse<WorkspaceSemanticValidatedToolCall>
  execute(call: WorkspaceSemanticToolCall): Promise<ServiceResponse<WorkspaceSemanticToolResult>>
}

const readDocumentEvidenceDescriptor: WorkspaceSemanticToolDescriptor = {
  name: WORKSPACE_SEMANTIC_READ_TOOL_NAME,
  description: "Read one bounded line range from a known document snapshot for semantic evidence. Read-only.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "Opaque document UUID from the supplied evidence scope." },
      expectedDocumentVersion: { type: "string", description: "Exact catalog snapshot version supplied by the application." },
      expectedContentHash: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "Exact catalog content hash, or null when the catalog has no hash.",
      },
      lineStart: { type: "integer", minimum: 1, description: "1-based inclusive line start." },
      lineEnd: { type: "integer", minimum: 1, description: "1-based inclusive line end, at most 200 lines from lineStart." },
      maxChars: { type: "integer", minimum: 1, maximum: WORKSPACE_SEMANTIC_MAX_EVIDENCE_CHARS },
    },
    required: [
      "documentId",
      "expectedDocumentVersion",
      "expectedContentHash",
      "lineStart",
      "lineEnd",
      "maxChars",
    ],
    additionalProperties: false,
  },
}

function error<T>(code: ServiceError["code"], message: string, details?: Record<string, unknown>): ServiceResponse<T> {
  return {
    data: null,
    error: { code, message, retryable: false, ...(details ? { details } : {}) },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPathLikeDocumentId(documentId: string): boolean {
  return documentId.includes("/") || documentId.includes("\\") || documentId === "." || documentId === ".."
}

function asReadArguments(value: unknown): WorkspaceSemanticReadArguments | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value).sort()
  const expectedKeys = [
    "documentId",
    "expectedContentHash",
    "expectedDocumentVersion",
    "lineEnd",
    "lineStart",
    "maxChars",
  ]
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return null
  if (
    typeof value.documentId !== "string"
    || typeof value.expectedDocumentVersion !== "string"
    || (typeof value.expectedContentHash !== "string" && value.expectedContentHash !== null)
    || !Number.isInteger(value.lineStart)
    || !Number.isInteger(value.lineEnd)
    || !Number.isInteger(value.maxChars)
  ) return null
  const lineStart = value.lineStart as number
  const lineEnd = value.lineEnd as number
  const maxChars = value.maxChars as number
  return {
    documentId: value.documentId,
    expectedDocumentVersion: value.expectedDocumentVersion,
    expectedContentHash: value.expectedContentHash,
    lineStart,
    lineEnd,
    maxChars,
  }
}

function serializedEvidence(evidence: WorkspaceAgentEvidence): string {
  return JSON.stringify({
    type: "document_evidence",
    evidence: {
      evidenceId: evidence.evidenceId,
      documentId: evidence.documentId,
      documentVersion: evidence.documentVersion,
      contentHash: evidence.contentHash,
      lineStart: evidence.lineStart,
      lineEnd: evidence.lineEnd,
      text: evidence.text,
    },
  })
}

function descriptorFor(name: string): WorkspaceSemanticToolDescriptor | null {
  return name === WORKSPACE_SEMANTIC_READ_TOOL_NAME
    ? readDocumentEvidenceDescriptor
    : null
}

export function getWorkspaceSemanticToolDescriptors(
  names: readonly string[] = [WORKSPACE_SEMANTIC_READ_TOOL_NAME],
): WorkspaceSemanticToolDescriptor[] {
  const seen = new Set<string>()
  return names.flatMap((name) => {
    if (seen.has(name)) return []
    seen.add(name)
    const descriptor = descriptorFor(name)
    return descriptor ? [{ ...descriptor, parameters: { ...descriptor.parameters } }] : []
  })
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function isCanonicalWorkspaceSemanticToolDescriptor(
  descriptor: WorkspaceSemanticToolDescriptor,
): boolean {
  const canonical = descriptorFor(descriptor.name)
  return Boolean(canonical && stableJson(descriptor) === stableJson(canonical))
}

export function createWorkspaceSemanticToolRegistry(input: {
  knownDocuments: ReadonlyMap<string, WorkspaceSemanticDocumentSnapshot>
  readEvidence?: WorkspaceSemanticReadEvidenceHandler
  allowedToolNames?: readonly string[]
}): WorkspaceSemanticToolRegistry {
  const descriptors = getWorkspaceSemanticToolDescriptors(input.allowedToolNames)
  const allowedNames = new Set(descriptors.map((descriptor) => descriptor.name))

  const validateCall = (call: WorkspaceSemanticToolCall): ServiceResponse<WorkspaceSemanticValidatedToolCall> => {
    if (!call.callId.trim() || call.callId.length > 128) {
      return error("INVALID_INPUT", "The semantic tool call id is invalid.")
    }
    if (!allowedNames.has(call.name)) {
      return error("FORBIDDEN", "The semantic loop received a tool that is outside its read-only allowlist.", {
        toolName: call.name,
      })
    }
    const args = asReadArguments(call.arguments)
    if (!args || !args.documentId.trim() || args.documentId.length > 128 || isPathLikeDocumentId(args.documentId)) {
      return error("INVALID_INPUT", "Semantic evidence must identify a document by opaque id, not by path.")
    }
    if (!args.expectedDocumentVersion.trim() || args.expectedDocumentVersion.length > 256) {
      return error("INVALID_INPUT", "A bounded semantic evidence call requires a document version.")
    }
    if (typeof args.expectedContentHash === "string" && args.expectedContentHash.length > 512) {
      return error("INVALID_INPUT", "The semantic evidence content hash is too long.")
    }
    if (
      args.lineStart < 1
      || args.lineEnd < args.lineStart
      || args.lineEnd - args.lineStart + 1 > WORKSPACE_SEMANTIC_MAX_LINE_SPAN
      || args.maxChars < 1
      || args.maxChars > WORKSPACE_SEMANTIC_MAX_EVIDENCE_CHARS
    ) {
      return error("INVALID_INPUT", "Semantic evidence range or character budget is outside the allowed bounds.")
    }

    const snapshot = input.knownDocuments.get(args.documentId)
    if (!snapshot) {
      return error("NOT_FOUND", "The requested document is outside the evidence scope.", { documentId: args.documentId })
    }
    if (
      snapshot.documentVersion !== args.expectedDocumentVersion
      || snapshot.contentHash !== args.expectedContentHash
    ) {
      return error("CONFLICT", "The requested document snapshot is stale; semantic review must stop and be refreshed.", {
        documentId: args.documentId,
      })
    }
    return {
      data: {
        callId: call.callId,
        name: WORKSPACE_SEMANTIC_READ_TOOL_NAME,
        arguments: args,
      },
      error: null,
    }
  }

  return {
    descriptors,
    validateCall,
    async execute(call) {
      const validated = validateCall(call)
      if (validated.error || !validated.data) return validated as ServiceResponse<WorkspaceSemanticToolResult>
      if (!input.readEvidence) return error("UNAVAILABLE", "Semantic evidence reading is unavailable in this runtime.")
      const result = await input.readEvidence(validated.data.arguments)
      if (result.error || !result.data) return result as ServiceResponse<WorkspaceSemanticToolResult>
      return {
        data: {
          evidence: result.data.evidence,
          output: serializedEvidence(result.data.evidence),
        },
        error: null,
      }
    },
  }
}
