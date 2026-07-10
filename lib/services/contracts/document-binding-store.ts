import type { DocumentBindingRecord } from "@/lib/services/contracts/document-catalog"

export type BindingRootRecord = {
  id: string
  rootPath: string
  manifestVersion: number
  visibleAsWorkspace: boolean
  lastScannedAt: number | null
}

export type UpsertBindingInput = {
  root: BindingRootRecord
  binding: DocumentBindingRecord
}

export interface DocumentBindingStore {
  getBinding(documentId: string): Promise<DocumentBindingRecord | null>
  resolveCanonicalPath(path: string): Promise<DocumentBindingRecord | null>
  upsertBinding(input: UpsertBindingInput): Promise<void>
  removeBinding(documentId: string): Promise<void>
}
