import Image, { type ImageOptions } from "@tiptap/extension-image"
import type { NodeViewRendererProps } from "@tiptap/core"

export type ResolvedLocalImage = {
  renderUrl: string
  revoke?: () => void
}

export type LocalImageBackupRequest = {
  source: string
  alt: string
  replaceSource: (onlineUrl: string) => (() => boolean) | null
}

export type ImagePresentationRequest = {
  source: string
  alt: string
  element: HTMLElement
}

export type LocalImageExtensionOptions = ImageOptions & {
  resolveImage?: (source: string) => Promise<ResolvedLocalImage>
  onRequestBackup?: (request: LocalImageBackupRequest) => void
  onOpenPresentation?: (request: ImagePresentationRequest) => void
}

const NON_LOCAL_SCHEMES = /^(?:https?:|data:|blob:|asset:)/i
const WEB_RUNTIME_PATHS = /^(?:\/api\/|\/_next\/)/

export function isLocalImageSource(source: string): boolean {
  const value = source.trim()
  return value.length > 0
    && !NON_LOCAL_SCHEMES.test(value)
    && !WEB_RUNTIME_PATHS.test(value)
    && !value.startsWith("//")
}

function cloudUploadIcon(): SVGElement {
  const namespace = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(namespace, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("width", "14")
  svg.setAttribute("height", "14")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "1.5")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  const paths = [
    "M12 13v8",
    "m16 17-4-4-4 4",
    "M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3",
  ]
  for (const value of paths) {
    const path = document.createElementNS(namespace, "path")
    path.setAttribute("d", value)
    svg.append(path)
  }
  return svg
}

export const LocalImageExtension = Image.extend<LocalImageExtensionOptions>({
  addOptions() {
    const parent = this.parent?.()
    return {
      ...parent,
      HTMLAttributes: parent?.HTMLAttributes ?? {},
      resize: parent?.resize ?? false,
      allowBase64: false,
      inline: false,
      resolveImage: undefined,
      onRequestBackup: undefined,
      onOpenPresentation: undefined,
    }
  },

  addNodeView() {
    return ({ node, editor, getPos }: NodeViewRendererProps) => {
      const wrapper = document.createElement("span")
      wrapper.className = "odessay-local-image"
      wrapper.dataset.localImage = "false"
      wrapper.contentEditable = "false"

      const image = document.createElement("img")
      image.alt = node.attrs.alt ?? ""
      image.tabIndex = 0
      image.draggable = true
      wrapper.append(image)

      const backup = document.createElement("button")
      backup.type = "button"
      backup.className = "odessay-local-image-backup"
      backup.setAttribute("aria-label", "Back up image online")
      backup.title = "Back up online"
      backup.append(cloudUploadIcon())
      wrapper.append(backup)

      const presentation = document.createElement("button")
      presentation.type = "button"
      presentation.className = "odessay-local-image-presentation"
      presentation.setAttribute("aria-label", "Open image viewer")
      presentation.title = "Open image viewer"
      presentation.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 0-2v-3"/></svg>`
      wrapper.append(presentation)

      let currentNode = node
      let currentSource = ""
      let revokeRenderUrl: (() => void) | undefined
      let resolutionRevision = 0

      const replaceSource = (expectedSource: string, onlineUrl: string) => {
        const position = getPos()
        if (typeof position !== "number") return null
        const liveNode = editor.state.doc.nodeAt(position)
        if (!liveNode || liveNode.type.name !== currentNode.type.name || liveNode.attrs.src !== expectedSource) {
          return null
        }
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(position, undefined, { ...liveNode.attrs, src: onlineUrl }),
        )
        return () => replaceSource(onlineUrl, expectedSource) !== null
      }

      const render = async () => {
        const source = String(currentNode.attrs.src ?? "")
        currentSource = source
        image.alt = currentNode.attrs.alt ?? ""
        revokeRenderUrl?.()
        revokeRenderUrl = undefined
        const revision = ++resolutionRevision

        const resolver = this.options.resolveImage
        const local = isLocalImageSource(source) && typeof resolver === "function"
        wrapper.dataset.localImage = String(local)
        backup.hidden = !local

        if (typeof resolver !== "function") {
          image.src = source
          wrapper.dataset.localImageState = "ready"
          return
        }

        wrapper.dataset.localImageState = "loading"
        image.removeAttribute("src")
        try {
          const resolved = await resolver(source)
          if (revision !== resolutionRevision || source !== currentSource) {
            resolved.revoke?.()
            return
          }
          image.src = resolved.renderUrl
          revokeRenderUrl = resolved.revoke
          wrapper.dataset.localImageState = "ready"
        } catch {
          if (revision === resolutionRevision) wrapper.dataset.localImageState = "missing"
        }
      }

      backup.addEventListener("mousedown", (event) => event.preventDefault())
      backup.addEventListener("click", () => {
        const source = currentSource
        this.options.onRequestBackup?.({
          source,
          alt: currentNode.attrs.alt ?? "",
          replaceSource: (onlineUrl) => replaceSource(source, onlineUrl),
        })
      })
      presentation.addEventListener("mousedown", (event) => event.preventDefault())
      presentation.addEventListener("click", () => {
        this.options.onOpenPresentation?.({ source: currentSource, alt: currentNode.attrs.alt ?? "", element: wrapper })
      })
      image.addEventListener("mousedown", (event) => event.preventDefault())
      image.addEventListener("click", () => {
        this.options.onOpenPresentation?.({ source: currentSource, alt: currentNode.attrs.alt ?? "", element: wrapper })
      })

      void render()

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type !== currentNode.type) return false
          const sourceChanged = updatedNode.attrs.src !== currentNode.attrs.src
          currentNode = updatedNode
          image.alt = currentNode.attrs.alt ?? ""
          if (sourceChanged) void render()
          return true
        },
        destroy: () => {
          resolutionRevision += 1
          revokeRenderUrl?.()
        },
      }
    }
  },
})
