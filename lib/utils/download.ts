export const downloadBlob = (blob: Blob, filename: string) => {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")

  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = "noreferrer"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
}

type BinaryArtifact = {
  bytes: Uint8Array
  fileName: string
  mimeType: string
}

const toExactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const sliced = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return sliced as ArrayBuffer
}

export const saveBinaryArtifact = async (artifact: BinaryArtifact): Promise<boolean> => {
  const { isDesktopRuntime } = await import("@/lib/services/desktop/runtime-detection")

  if (isDesktopRuntime()) {
    const { saveDesktopBinaryExport } = await import("@/lib/services/desktop/export-delivery")
    return saveDesktopBinaryExport(artifact)
  }

  const blob = new Blob([toExactArrayBuffer(artifact.bytes)], { type: artifact.mimeType })
  downloadBlob(blob, artifact.fileName)
  return true
}
