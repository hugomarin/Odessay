import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

type WorkspaceRouteSource = {
  slug: string
}

type WorkspaceFileRouteSource = WorkspaceRouteSource & {
  fileId: string
}

export const buildWorkspaceHref = ({ slug }: WorkspaceRouteSource) => {
  if (isDesktopRuntime()) {
    return `/workspace?slug=${encodeURIComponent(slug)}`
  }

  return `/workspace/${slug}`
}

export const buildWorkspaceFileHref = ({ slug, fileId }: WorkspaceFileRouteSource) => {
  if (isDesktopRuntime()) {
    const params = new URLSearchParams({
      slug,
      fileId,
    })

    return `/workspace?${params.toString()}`
  }

  return `/workspace/${slug}/files/${fileId}`
}
