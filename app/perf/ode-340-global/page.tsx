import { Ode340GlobalHarnessClient } from "@/app/perf/ode-340-global/ode-340-global-harness-client"

export default function Ode340GlobalHarnessPage() {
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    return null
  }

  return <Ode340GlobalHarnessClient />
}
