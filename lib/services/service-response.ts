import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"

type EnvelopeError = {
  code: string
  message: string
}

type ApiEnvelope<T> = {
  data: T | null
  error: EnvelopeError | null
}

export function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

export function err<T>(error: ServiceError): ServiceResponse<T> {
  return { data: null, error }
}

export async function parseServiceEnvelope<T>(
  response: Response,
  fallbackCode: ServiceError["code"],
  fallbackMessage: string,
): Promise<ServiceResponse<T>> {
  let envelope: ApiEnvelope<T> | null = null

  try {
    envelope = (await response.json()) as ApiEnvelope<T>
  } catch {
    envelope = null
  }

  if (!response.ok || !envelope?.data || envelope.error) {
    return err({
      code: envelope?.error?.code ?? fallbackCode,
      message: envelope?.error?.message ?? fallbackMessage,
      retryable: response.status >= 500,
    })
  }

  return ok(envelope.data)
}
