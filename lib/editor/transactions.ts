type TransactionMetaReader = {
  getMeta: (key: string) => unknown
}

export const isPasteTransaction = (transaction: TransactionMetaReader): boolean =>
  transaction.getMeta("paste") === true || transaction.getMeta("uiEvent") === "paste"

export const isPointerTransaction = (transaction: TransactionMetaReader): boolean =>
  transaction.getMeta("pointer") === true || transaction.getMeta("uiEvent") === "click"

export const shouldDeferRichModeSideEffects = (transaction: TransactionMetaReader): boolean =>
  isPasteTransaction(transaction) || isPointerTransaction(transaction)
