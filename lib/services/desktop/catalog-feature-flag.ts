export function isDesktopCatalogDualWriteEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DESKTOP_CATALOG_DUAL_WRITE === "true"
}
