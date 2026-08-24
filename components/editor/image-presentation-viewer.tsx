"use client"

import type { Editor } from "@tiptap/react"
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FullOverlay } from "@/components/ui/full-overlay"
import type { ResolvedLocalImage } from "@/lib/editor/local-image-extension"

export type PresentationImage = { source: string; alt: string }

export function collectPresentationImages(editor: Editor): PresentationImage[] {
  const images: PresentationImage[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") {
      images.push({ source: String(node.attrs.src ?? ""), alt: String(node.attrs.alt ?? "") })
    }
  })
  return images
}

type ImagePresentationViewerProps = {
  open: boolean
  editor: Editor | null
  initialSource: string | null
  resolveImage?: (source: string) => Promise<ResolvedLocalImage>
  onOpenChange: (open: boolean) => void
}

type LoadedImage = { url: string; revoke?: () => void }
type ImageState = { status: "idle" | "loading" | "ready" | "error"; url?: string }

export function ImagePresentationViewer({
  open,
  editor,
  initialSource,
  resolveImage,
  onOpenChange,
}: ImagePresentationViewerProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [images, setImages] = useState<PresentationImage[]>([])
  const [states, setStates] = useState<Record<string, ImageState>>({})
  const cacheRef = useRef(new Map<string, LoadedImage>())
  const revisionRef = useRef(0)

  const syncImages = useCallback(() => {
    if (!editor) return
    const next = collectPresentationImages(editor)
    setImages(next)
    setActiveIndex((current) => {
      const source = initialSource ?? next[current]?.source
      const nextIndex = next.findIndex((image) => image.source === source)
      return nextIndex >= 0 ? nextIndex : Math.min(current, Math.max(0, next.length - 1))
    })
  }, [editor, initialSource])

  useEffect(() => {
    if (!open || !editor) return
    syncImages()
    const handleTransaction = () => syncImages()
    editor.on("transaction", handleTransaction)
    return () => {
      editor.off("transaction", handleTransaction)
    }
  }, [editor, open, syncImages])

  useEffect(() => {
    if (!open) return
    revisionRef.current += 1
    const revision = revisionRef.current
    const indexes = [activeIndex - 1, activeIndex, activeIndex + 1].filter(
      (index) => index >= 0 && index < images.length,
    )

    for (const index of indexes) {
      const item = images[index]
      if (!item) continue
      const key = `${index}:${item.source}`
      if (cacheRef.current.has(key)) {
        setStates((current) => ({ ...current, [key]: { status: "ready", url: cacheRef.current.get(key)?.url } }))
        continue
      }
      setStates((current) => ({ ...current, [key]: { status: "loading" } }))
      void (async () => {
        try {
          const resolved = resolveImage ? await resolveImage(item.source) : { renderUrl: item.source }
          const loaded: LoadedImage = { url: resolved.renderUrl, revoke: resolved.revoke }
          cacheRef.current.set(key, loaded)
          if (revision !== revisionRef.current) return
          setStates((current) => ({ ...current, [key]: { status: "ready", url: loaded.url } }))
          const preload = new window.Image()
          preload.src = loaded.url
        } catch {
          if (revision === revisionRef.current) setStates((current) => ({ ...current, [key]: { status: "error" } }))
        }
      })()
    }
  }, [activeIndex, images, open, resolveImage])

  useEffect(() => {
    if (open) return
    revisionRef.current += 1
    for (const value of cacheRef.current.values()) value.revoke?.()
    cacheRef.current.clear()
    setStates({})
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setActiveIndex((current) => Math.max(0, current - 1))
      if (event.key === "ArrowRight") setActiveIndex((current) => Math.min(images.length - 1, current + 1))
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [images.length, open])

  const active = images[activeIndex]
  const activeKey = active ? `${activeIndex}:${active.source}` : ""
  const activeState = states[activeKey]
  const hasNavigation = images.length > 1
  const panel = useMemo(() => (
    <div className="image-presentation-panel" data-testid="image-presentation-panel">
      {hasNavigation ? (
        <button type="button" aria-label="Previous image" disabled={activeIndex === 0} onClick={() => setActiveIndex((current) => Math.max(0, current - 1))} className="image-presentation-nav image-presentation-prev">
          <ArrowLeft strokeWidth={1.5} />
        </button>
      ) : null}
      <div className="image-presentation-stage">
        {activeState?.status === "loading" || !activeState ? <LoaderCircle aria-label="Loading image" className="image-presentation-loading" strokeWidth={1.5} /> : null}
        {activeState?.status === "error" ? <p className="image-presentation-error">Unable to display image</p> : null}
        {activeState?.status === "ready" ? <img src={activeState.url} alt={active.alt} className="image-presentation-image" onError={() => setStates((current) => ({ ...current, [activeKey]: { status: "error" } }))} /> : null}
      </div>
      {hasNavigation ? (
        <button type="button" aria-label="Next image" disabled={activeIndex === images.length - 1} onClick={() => setActiveIndex((current) => Math.min(images.length - 1, current + 1))} className="image-presentation-nav image-presentation-next">
          <ArrowRight strokeWidth={1.5} />
        </button>
      ) : null}
      {hasNavigation ? <span className="image-presentation-counter">{activeIndex + 1} / {images.length}</span> : null}
    </div>
  ), [active, activeIndex, activeKey, activeState, hasNavigation, images.length, onOpenChange])

  return (
    <FullOverlay
      open={open}
      onOpenChange={onOpenChange}
      title="Image viewer"
      hideTitle
      closeLabel="Close viewer"
      className="image-presentation-overlay"
      chromeClassName="image-presentation-chrome"
      overlayClassName="image-presentation-scrim"
      contentClassName="image-presentation-overlay-content"
    >
      {panel}
    </FullOverlay>
  )
}
