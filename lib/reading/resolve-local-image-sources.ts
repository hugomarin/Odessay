"use client"

import { getAssetService } from "@/lib/services/asset-service-factory"
import { isLocalImageSource } from "@/lib/editor/local-image-extension"

const IMG_SRC_REGEX = /<img\b[^>]*\bsrc="([^"]*)"[^>]*>/g

export type ResolvedLocalImages = {
  html: string
  objectUrls: string[]
}

/**
 * Rewrites `<img src="...">` references to desktop-local files into
 * displayable blob: URLs. The live editor resolves these itself, per image,
 * via LocalImageExtension's NodeView — this covers read-only surfaces (a
 * preview modal) that render straight to an HTML string instead, where
 * nothing else ever resolves a local source. Returns the created object
 * URLs so the caller can revoke them once done with this render.
 */
export async function resolveLocalImageSources(html: string, documentPath: string): Promise<ResolvedLocalImages> {
  const sources = Array.from(html.matchAll(IMG_SRC_REGEX), (match) => match[1])
  const localSources = Array.from(new Set(sources.filter(isLocalImageSource)))

  if (localSources.length === 0) {
    return { html, objectUrls: [] }
  }

  const assetService = getAssetService()
  const objectUrls: string[] = []
  const replacements = new Map<string, string>()

  await Promise.all(
    localSources.map(async (source) => {
      const result = await assetService.readLocalImageAsset({ documentPath, source })
      if (result.error) return
      const objectUrl = URL.createObjectURL(
        new Blob([result.data.bytes.buffer as ArrayBuffer], { type: result.data.mimeType }),
      )
      objectUrls.push(objectUrl)
      replacements.set(source, objectUrl)
    }),
  )

  if (replacements.size === 0) {
    return { html, objectUrls }
  }

  const rewritten = html.replace(IMG_SRC_REGEX, (tag, source: string) => {
    const objectUrl = replacements.get(source)
    return objectUrl ? tag.replace(`src="${source}"`, `src="${objectUrl}"`) : tag
  })

  return { html: rewritten, objectUrls }
}
