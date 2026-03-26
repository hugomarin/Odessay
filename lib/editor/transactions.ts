type TransactionMetaReader = {
  getMeta: (key: string) => unknown
}

export const isPasteTransaction = (transaction: TransactionMetaReader): boolean =>
  transaction.getMeta("paste") === true || transaction.getMeta("uiEvent") === "paste"
