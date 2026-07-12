export function isDesktopCatalogDualWriteEnabled(): boolean {
  // M4 ships the unified desktop catalog as the normal runtime path. Keep an
  // explicit kill switch for rollback, but do not require a build-time opt-in:
  // an unset variable must behave like the production default (enabled).
  return process.env.NEXT_PUBLIC_DESKTOP_CATALOG_DUAL_WRITE !== "false"
}
