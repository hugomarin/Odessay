export const SERVICE_CONTRACT_NAMES = [
  "DocumentService",
  "SyncService",
  "AIService",
  "AuthService",
  "SharingService",
  "AssetService",
  "SettingsService",
] as const

export type ServiceContractName = (typeof SERVICE_CONTRACT_NAMES)[number]

export const SERVICE_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "CONFLICT",
  "RATE_LIMITED",
  "TIMEOUT",
  "DB_ERROR",
  "STORAGE_ERROR",
  "AI_REQUEST_FAILED",
  "UNAVAILABLE",
  "UNSUPPORTED",
  "UNKNOWN",
] as const

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number]

export type ServiceError = {
  code: ServiceErrorCode | (string & {})
  message: string
  retryable: boolean
  details?: Record<string, unknown>
}

export type ServiceResponse<T> =
  | {
      data: T
      error: null
    }
  | {
      data: null
      error: ServiceError
    }

export type ContractLayer = "domain" | "application" | "adapter"
export type RuntimeScope = "shared-core" | "web" | "desktop" | "cloud" | "mobile-future"
export type ServiceOwner = "frontend" | "backend" | "database" | "architecture-first"
export type ServiceOperationKind = "query" | "command" | "stream" | "session"

export type ServiceOperationDescriptor<Name extends string = string> = {
  name: Name
  kind: ServiceOperationKind
  summary: string
  input: string[]
  output: string[]
  errorCodes: ServiceErrorCode[]
}

export type ServiceHotspot = {
  id: string
  summary: string
  layer: ContractLayer[]
  runtimeScope: RuntimeScope[]
  owner: ServiceOwner
  currentEntrypoints: string[]
}

export type ServiceContractDescriptor<
  Name extends ServiceContractName = ServiceContractName,
  OperationName extends string = string,
> = {
  name: Name
  summary: string
  responsibilities: string[]
  layer: ContractLayer[]
  runtimeScope: RuntimeScope[]
  owner: ServiceOwner
  invariants: string[]
  errorEnvelope: string
  operations: ServiceOperationDescriptor<OperationName>[]
  hotspots: ServiceHotspot[]
  requiredDocs: string[]
}

export const PHASE_4_REQUIRED_DOCS = [
  "workflow/context/features/odessay-desktop-app.md",
  "workflow/context/features/odessay-desktop-migration-diagnostic.md",
  "workflow/context/features/odessay-desktop-target-architecture.md",
  "workflow/context/features/odessay-desktop-migration-plan.md",
  ".agents/skills/skill-architecture/SKILL.md",
] as const

export const SERVICE_RESPONSE_ENVELOPE =
  "ServiceResponse<T> = { data: T, error: null } | { data: null, error: { code, message, retryable, details? } }"
