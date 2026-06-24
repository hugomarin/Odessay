export type PendingOpenFile = {
  path: string
  content: string
}

let pendingOpenFile: PendingOpenFile | null = null

export function setPendingOpenFile(file: PendingOpenFile) {
  pendingOpenFile = file
}

export function consumePendingOpenFile(): PendingOpenFile | null {
  const file = pendingOpenFile
  pendingOpenFile = null
  return file
}
