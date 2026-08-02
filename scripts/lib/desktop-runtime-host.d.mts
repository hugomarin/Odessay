export type FrontendAsset = {
  path: string
  contents: string
}

export type RuntimeManifest = {
  appUrl?: string
  tauriBuild?: boolean
  generatedAt?: string
}

export type EmbeddedHostVerdict = {
  ok: boolean
  reason: "missing-manifest" | "manifest-mismatch" | "local-host" | "remote-host"
  scanned: number
  appUrl: string | null
  carriers: string[]
}

export declare const SCANNABLE_ASSET_EXTENSIONS: string[]
export declare const RUNTIME_MANIFEST_FILENAME: string

export declare function isLocalRuntimeHost(value: unknown): boolean

export declare function stripCspMeta(html: string): string

export declare function findLocalRuntimeHosts(
  contents: unknown,
  options?: { isHtml?: boolean },
): string[]

export declare function evaluateEmbeddedRuntimeHost(input: {
  manifest: RuntimeManifest | null
  assets: FrontendAsset[]
  allowLocalhost?: boolean
}): EmbeddedHostVerdict

export declare function readRuntimeManifest(candidateDirs: Array<string | null>): {
  path: string | null
  manifest: RuntimeManifest | null
}

export declare function listFrontendAssetPaths(dir: string | null, collected?: string[]): string[]

export declare function collectFrontendAssets(candidateDirs: Array<string | null>): {
  baseDir: string | null
  assets: FrontendAsset[]
}

export declare function formatEmbeddedHostFailure(verdict: EmbeddedHostVerdict): string
