import { AppSplash } from "@/components/auth/app-splash"

/**
 * Evidence surface for ODE-429. The splash only mounts under the Tauri runtime,
 * so this renders it directly for capture and for the network/TTI trace.
 */
export default function SplashHarnessPage() {
  return <AppSplash />
}
