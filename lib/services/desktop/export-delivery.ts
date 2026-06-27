import { save } from "@tauri-apps/plugin-dialog"
import { tauriWriteBinaryFile } from "@/lib/services/desktop/tauri-commands"

type DesktopBinaryExport = {
  bytes: Uint8Array
  fileName: string
  mimeType: string
}

const getExtension = (fileName: string) => {
  const match = fileName.match(/\.([^.]+)$/)
  return match?.[1]?.toLowerCase() ?? null
}

const getDialogFilterName = (mimeType: string, extension: string | null) => {
  if (mimeType === "application/pdf" || extension === "pdf") {
    return "PDF"
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return "Word Document"
  }

  return "Export"
}

export async function saveDesktopBinaryExport(artifact: DesktopBinaryExport): Promise<boolean> {
  const extension = getExtension(artifact.fileName)
  const filePath = await save({
    defaultPath: artifact.fileName,
    filters: extension
      ? [{ name: getDialogFilterName(artifact.mimeType, extension), extensions: [extension] }]
      : undefined,
  })

  if (!filePath) {
    return false
  }

  await tauriWriteBinaryFile(filePath, artifact.bytes)
  return true
}
