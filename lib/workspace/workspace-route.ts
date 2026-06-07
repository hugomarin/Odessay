type WorkspaceRouteSource = {
  slug: string
}

type WorkspaceFileRouteSource = WorkspaceRouteSource & {
  fileId: string
}

const isTauriBuild = process.env.NEXT_PUBLIC_TAURI_BUILD === "true"

export const buildWorkspaceHref = ({ slug }: WorkspaceRouteSource) => {
  if (isTauriBuild) {
    return `/workspace?slug=${encodeURIComponent(slug)}`
  }

  return `/workspace/${slug}`
}

export const buildWorkspaceFileHref = ({ slug, fileId }: WorkspaceFileRouteSource) => {
  if (isTauriBuild) {
    const params = new URLSearchParams({
      slug,
      fileId,
    })

    return `/workspace?${params.toString()}`
  }

  return `/workspace/${slug}/files/${fileId}`
}
