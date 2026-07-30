export type FrontendAsset = {
  path: string
  contents: string
}

export type EmbeddedHostOffender = {
  path: string
  hosts: string[]
}

export type EmbeddedHostVerdict = {
  ok: boolean
  scanned: number
  offenders: EmbeddedHostOffender[]
}

export declare const SCANNABLE_ASSET_EXTENSIONS: string[]

export declare function isLocalRuntimeHost(value: unknown): boolean

export declare function stripCspMeta(html: string): string

export declare function findLocalRuntimeHosts(
  contents: unknown,
  options?: { isHtml?: boolean },
): string[]

export declare function evaluateEmbeddedRuntimeHost(input: {
  assets: FrontendAsset[]
  allowLocalhost?: boolean
}): EmbeddedHostVerdict

export declare function listFrontendAssetPaths(dir: string | null, collected?: string[]): string[]

export declare function collectFrontendAssets(candidateDirs: Array<string | null>): {
  baseDir: string | null
  assets: FrontendAsset[]
}

export declare function formatEmbeddedHostFailure(offenders: EmbeddedHostOffender[]): string
